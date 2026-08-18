import { searchKey } from '../../shared/normalize.mjs';
import { sendeErgaenzungsMails, sendeWunschAntwortMails } from '../lib/benachrichtigung';
import {
  activeCategoryIds,
  freeNoteId,
  freeTipId,
  getTipAggregate,
  noteInsertStmt,
  noteUpdateStmt,
  sortNotes,
  tipDeleteStmts,
  tipInsertStmts,
  tipUpdateStmt,
} from '../lib/db';
import type { NoteFile, TipAggregate, TipFile } from '../lib/db';
import type { Env } from '../lib/env';
import { photoKey, putPhotoFromBase64, moveToTrash } from '../lib/fotos';
import {
  noteIdFor,
  parseSubmission,
  tipIdFor,
  todayIso,
  uniqueViolation,
  ValidationError,
} from '../lib/submission';
import type { NoteEdit, Submission, TipFields } from '../lib/submission';
import type { RequestData, SessionUser } from '../lib/users';
import { findVerlaufByKey, photoKeysOf, verlaufInsertStmt } from '../lib/verlauf';
import { gueltigeWunschIds, verknuepfeStmt } from '../lib/wuensche';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Rennen zweier gleichzeitiger Einreichungen: so oft wird neu angesetzt. */
const ATTEMPTS = 3;

/**
 * Alles, was Tipps verändert: anlegen, ergänzen, korrigieren, löschen.
 *
 * Jede Handlung ist genau EIN D1-Batch — Datenänderung und Verlaufseintrag in
 * einer Transaktion, ganz oder gar nicht. Es gibt keinen Freigabeschritt: Wer
 * ein Konto hat, schreibt direkt. Das Sicherheitsnetz ist der Verlauf mit
 * seinen Snapshots — unter #/admin lässt sich jede Änderung ansehen und
 * zurücknehmen.
 *
 * Wer etwas getan hat, kommt aus dem angemeldeten Konto, nicht mehr aus einem
 * Freitextfeld. Fotos gehen VOR dem Batch nach R2 (R2 kann nicht Teil der
 * Transaktion sein): schlägt der Batch fehl, bleibt schlimmstenfalls ein
 * verwaistes, nie referenziertes Objekt zurück — die Umkehrung, eine Notiz mit
 * fehlendem Foto, gäbe es so nie.
 *
 * Das Admin-Flag reist getrennt von der Einreichung durch: Es steht in der
 * Sitzung, nicht im Formular, und darf nie aus dem Rumpf lesbar sein.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async (context) => {
  const { request, env, data } = context;
  const db = env.DB as D1Database;
  const fotos = env.FOTOS as R2Bucket;

  try {
    const activeIds = await activeCategoryIds(db);
    if (activeIds.size === 0) return problem(503, 'Es sind gerade keine Kategorien verfügbar.');

    const submission = parseSubmission(
      await request.json().catch(() => null),
      activeIds,
      data.user.name,
    );

    // Bricht die Verbindung ab, nachdem gespeichert wurde, schickt das Formular
    // denselben Vorgang nochmal. Der UNIQUE-Index auf verlauf.idempotency_key
    // erkennt das — dauerhaft, nicht nur im Fenster der letzten 30 Einträge wie
    // früher bei der Commit-Suche.
    const already = await findVerlaufByKey(db, submission.idempotencyKey);
    if (already) {
      return Response.json(
        { ok: true, tipId: null, commit: String(already.id), repeated: true },
        { headers: NO_STORE },
      );
    }

    const ergebnis = await apply(db, fotos, submission, data.user);

    // NACH der Antwort und ausserhalb von ihr: Die Mail darf weder das
    // Speichern verzögern noch es scheitern lassen — und `ergaenzung` gehört
    // nie in den Rumpf, den das Formular zurückbekommt.
    if (ergebnis.ergaenzung) {
      context.waitUntil(
        sendeErgaenzungsMails(env, {
          ...ergebnis.ergaenzung,
          origin: new URL(request.url).origin,
          einreicherId: data.user.id,
        }),
      );
    }

    if (ergebnis.wunschAntwort) {
      context.waitUntil(
        sendeWunschAntwortMails(env, {
          ...ergebnis.wunschAntwort,
          origin: new URL(request.url).origin,
          einreicherId: data.user.id,
        }),
      );
    }

    return Response.json(ergebnis.body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ValidationError) return problem(400, error.message);
    console.error('Unerwarteter Fehler beim Speichern:', error);
    return problem(500, 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.');
  }
};

interface SubmitBody {
  ok: true;
  tipId: string | null;
  commit: string;
  repeated: boolean;
}

/**
 * Was `apply` zurückgibt: die Antwort für das Formular — und getrennt davon,
 * was danach noch zu tun ist.
 *
 * Getrennt, damit die Benachrichtigung nicht versehentlich in der JSON-Antwort
 * landet: `ergaenzung` trägt den Notiztext und den Namen der Autorin, und beides
 * hat im Rumpf nichts verloren. Gesetzt wird es NUR im Ergänzungs-Zweig nach
 * einem erfolgreichen, nicht wiederholten Batch. Eine Korrektur ist ausdrücklich
 * keine Ergänzung: Sie fasst eine bestehende Beschreibung an und ist keine
 * Neuigkeit für die anderen Beteiligten.
 */
interface Ergebnis {
  body: SubmitBody;
  ergaenzung?: {
    tipId: string;
    tipName: string;
    tipPlace: string;
    von: string;
    text: string;
    vorherigeAutoren: string[];
  };
  /**
   * Gesetzt, wenn ein NEUER Tipp gleich einem oder mehreren Wünschen zugeordnet
   * wurde. Die Autorinnen dieser Wünsche haben eine Frage gestellt und bekommen
   * die Antwort — dieselbe Nachricht wie beim Zuordnen eines bestehenden Tipps
   * (api/wuensche/[id]/tipps.ts).
   */
  wunschAntwort?: {
    tipId: string;
    tipName: string;
    tipPlace: string;
    von: string;
    wuensche: { vonKey: string; ort: string | null; land: string }[];
  };
}

async function apply(
  db: D1Database,
  fotos: R2Bucket,
  submission: Submission,
  user: SessionUser,
): Promise<Ergebnis> {
  const today = todayIso();
  const isAdmin = user.isAdmin;
  // «Gehört mir» heisst: trägt EINEN meiner Schlüssel. Seit Anzeigenamen
  // änderbar sind, stehen alte Beiträge unter dem Namen von damals — mit nur
  // dem aktuellen Schlüssel verlöre man sie beim Umbenennen aus der Hand.
  const meineKeys = new Set(user.nameKeys);

  if (submission.kind === 'loeschung') {
    const tipId = submission.tipId!;
    const before = await getTipAggregate(db, tipId);
    if (!before) throw new ValidationError('Diesen Tipp gibt es nicht (mehr).');

    pruefeLoeschrecht(before.notes, meineKeys, isAdmin);

    const outcome = await runBatch(
      db,
      [
        ...tipDeleteStmts(db, tipId),
        verlaufInsertStmt(db, {
          kind: 'loeschung',
          title: `Gelöscht: ${tipId}`,
          by: submission.reason!.by,
          note: submission.reason!.text,
          tipId,
          before,
          after: null,
          idempotencyKey: submission.idempotencyKey,
        }),
      ],
      submission.idempotencyKey,
    );
    if (outcome.repeated) return { body: { ok: true, tipId: null, commit: String(outcome.id), repeated: true } };

    // Erst nach der Transaktion: Fotos in den Papierkorb (trash/), damit ein
    // späteres «Rückgängig» die Bytes zurückholen kann.
    await moveToTrash(fotos, photoKeysOf(before));
    return { body: { ok: true, tipId, commit: String(outcome.id), repeated: false } };
  }

  if (submission.kind === 'korrektur') {
    const tipId = submission.tipId!;
    const before = await getTipAggregate(db, tipId);
    if (!before) throw new ValidationError('Diesen Tipp gibt es nicht (mehr).');

    // Wer eine Beschreibung geschrieben hat, darf sie hier mitkorrigieren —
    // Tippfehler waren sonst nur durch Löschen des ganzen Tipps zu beheben.
    // Admins dürfen es an jeder Beschreibung.
    const changes = planNoteEdits(
      tipId,
      before.notes,
      submission.notes ?? [],
      meineKeys,
      submission.idempotencyKey,
      isAdmin,
    );
    const changed = new Map(changes.map((change) => [change.note.id, change.note]));

    const after: TipAggregate = {
      tip: mergeTip(before.tip, submission.tip!),
      notes: before.notes.map((note) => changed.get(note.id) ?? note),
    };

    // Neue Fotobytes VOR dem Batch nach R2, wie überall sonst: Scheitert die
    // Transaktion, bleibt schlimmstenfalls ein unreferenziertes Objekt liegen —
    // nie eine Notiz, die auf ein fehlendes Foto zeigt.
    for (const change of changes) {
      if (change.upload) await putPhotoFromBase64(fotos, change.upload.key, change.upload.base64);
    }

    let outcome: { repeated: boolean; id: number };
    try {
      outcome = await runBatch(
        db,
        [
          tipUpdateStmt(db, after.tip),
          ...changes.map((change) => noteUpdateStmt(db, tipId, change.note)),
          verlaufInsertStmt(db, {
            kind: 'korrektur',
            title: `Korrigiert: ${tipId}`,
            by: submission.by!,
            tipId,
            before,
            after,
            idempotencyKey: submission.idempotencyKey,
          }),
        ],
        submission.idempotencyKey,
      );
    } catch (error) {
      // Aufräumen ist gefahrlos: Der Vorgangs-Abdruck im Dateinamen gehört
      // genau dieser Einreichung.
      for (const change of changes) {
        if (change.upload) await fotos.delete(change.upload.key).catch(() => {});
      }
      throw error;
    }

    if (outcome.repeated) return { body: { ok: true, tipId: null, commit: String(outcome.id), repeated: true } };

    // Ersetzte und entfernte Fotos erst nach der Transaktion in den Papierkorb —
    // ein «Rückgängig» braucht die Bytes zurück.
    await moveToTrash(fotos, changes.flatMap((change) => (change.trashKey ? [change.trashKey] : [])));

    return { body: { ok: true, tipId, commit: String(outcome.id), repeated: false } };
  }

  // «tipp» und «ergaenzung» schreiben eine Notiz (ggf. mit Foto) und können an
  // einem ID-Rennen scheitern — dann wird mit frischer ID neu angesetzt.
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const isNew = submission.kind === 'tipp';

    const before = isNew ? null : await getTipAggregate(db, submission.tipId!);
    if (!isNew && !before) throw new ValidationError('Diesen Tipp gibt es nicht (mehr).');

    const tipId = isNew
      ? await freeTipId(db, tipIdFor(submission.tip!.name, submission.tip!.place))
      : submission.tipId!;
    const noteId = await freeNoteId(db, tipId, noteIdFor(submission.note!.by, today));

    // Der Vorgangs-Abdruck macht den Dateinamen pro Einreichung eindeutig:
    // Zwei Geräte, die gleichzeitig dieselbe Note-ID berechnen, überschreiben
    // sich so nie gegenseitig die R2-Bytes — und auch trash/-Keys späterer
    // Löschungen kollidieren nicht mehr (die alte Welt teilte den Key
    // <noteId>.<ext> über Vorgänge hinweg).
    const photo = submission.note!.photo ?? null;
    const photoName = photo ? `${noteId}-${vorgangsAbdruck(submission.idempotencyKey)}.${photo.ext}` : null;
    const note: NoteFile = {
      id: noteId,
      by: submission.note!.by,
      text: submission.note!.text,
      photo: photoName,
      added: today,
    };
    const after: TipAggregate = isNew
      ? { tip: buildTip(tipId, submission.tip!, today), notes: [note] }
      : { tip: before!.tip, notes: sortNotes([...before!.notes, note]) };

    if (photo && photoName) {
      await putPhotoFromBase64(fotos, photoKey(tipId, photoName), photo.base64);
    }

    // Nur Wünsche, die es noch gibt und die noch gelten. Verschwundene werden
    // stillschweigend übergangen statt den ganzen Tipp abzulehnen: Zwischen
    // Formular-Aufruf und Senden kann ein Wunsch abgelaufen sein, und dann wäre
    // eine Fehlermeldung über etwas, das gar nicht mehr existiert, nur ärgerlich.
    const wuenscheDazu = isNew ? await gueltigeWunschIds(db, submission.wunschIds ?? [], today) : [];

    try {
      const outcome = await runBatch(
        db,
        [
          ...(isNew ? tipInsertStmts(db, after) : [noteInsertStmt(db, tipId, note)]),
          ...wuenscheDazu.map((wunsch) => verknuepfeStmt(db, wunsch.id, tipId)),
          verlaufInsertStmt(db, {
            kind: submission.kind,
            title: isNew
              ? `Tipp: ${submission.tip!.name} (${submission.tip!.place})`
              : `Ergänzung zu ${tipId}`,
            by: submission.note!.by,
            tipId,
            before,
            after,
            idempotencyKey: submission.idempotencyKey,
          }),
        ],
        submission.idempotencyKey,
      );
      // Bei einer erkannten Wiederholung bleibt das eben hochgeladene Foto
      // liegen: Gleicher Vorgang heisst gleicher Dateiname — der Upload hat das
      // Original also nur mit denselben Bytes überschrieben. Löschen wäre falsch.
      if (outcome.repeated) return { body: { ok: true, tipId: null, commit: String(outcome.id), repeated: true } };

      return {
        body: { ok: true, tipId, commit: String(outcome.id), repeated: false },
        // Nur bei einer echten Ergänzung an einem bestehenden Tipp: `before`
        // hält genau die Beschreibungen, die vorher schon dranstanden — also
        // die Leute, für die das eine Neuigkeit ist. Ein neuer Tipp hat noch
        // niemanden zu benachrichtigen, und die Wiederholung oben ist schon
        // abgebogen.
        ...(isNew && wuenscheDazu.length > 0
          ? {
              wunschAntwort: {
                tipId,
                tipName: submission.tip!.name,
                tipPlace: submission.tip!.place,
                von: note.by,
                wuensche: wuenscheDazu.map((wunsch) => ({
                  vonKey: wunsch.von_key,
                  ort: wunsch.ort,
                  land: wunsch.land,
                })),
              },
            }
          : {}),
        ...(isNew
          ? {}
          : {
              ergaenzung: {
                tipId,
                tipName: before!.tip.name,
                tipPlace: before!.tip.place,
                von: note.by,
                text: note.text,
                vorherigeAutoren: before!.notes.map((vorher) => vorher.by),
              },
            }),
      };
    } catch (error) {
      // Aufräumen ist dank Vorgangs-Abdruck immer gefahrlos: Kein anderer
      // Vorgang kann denselben Key haben.
      if (photoName) await fotos.delete(photoKey(tipId, photoName)).catch(() => {});
      const violated = uniqueViolation(error);
      const idRace = violated === 'tips.id' || violated?.startsWith('notes.') === true;
      if (idRace && attempt < ATTEMPTS) continue; // neue IDs, neuer Versuch — Foto wird neu hochgeladen
      throw idRace
        ? new ValidationError('Jemand hat im selben Moment dasselbe eingetragen. Bitte nochmal versuchen.')
        : error;
    }
  }

  throw new ValidationError('Jemand hat im selben Moment dasselbe eingetragen. Bitte nochmal versuchen.');
}

/**
 * Darf diese Person den ganzen Tipp löschen?
 *
 * Nur, wem er ganz gehört — und jedem Admin. Löschen ist die einzige Handlung,
 * die fremde Beiträge mitreisst: Eine Korrektur fasst genau die eigene Zeile an,
 * eine Löschung nimmt alle Notizen und Fotos mit. Die Eigentumsregel von
 * `planNoteEdits` gilt hier deshalb für das GANZE Aggregat; hängt auch nur eine
 * fremde Beschreibung daran, bleibt «Gibt’s nicht mehr» (eine Korrektur mit
 * `closed`) — die weiche Hälfte desselben Formulars steht weiter allen offen.
 *
 * Verglichen wird über `searchKey`, aus demselben Grund wie dort: Ältere Notizen
 * tragen die Schreibweise aus dem früheren Freitextfeld. Und verglichen wird
 * gegen ALLE Schlüssel des Kontos, nicht nur den aktuellen — sonst gäbe eine
 * Umbenennung die eigenen Beiträge aus der Hand.
 */
function pruefeLoeschrecht(notes: NoteFile[], meineKeys: Set<string>, isAdmin: boolean): void {
  if (isAdmin) return;

  if (notes.every((note) => meineKeys.has(searchKey(note.by)))) return;

  throw new ValidationError(
    'Löschen kann einen Tipp nur, wem er ganz gehört — hier stehen auch Beiträge von anderen. ' +
      '«Gibt’s nicht mehr» geht trotzdem; ganz weg macht ein Admin.',
  );
}

/** Eine Beschreibung, die sich ändert: neuer Stand, neue Bytes, altes Foto. */
interface NoteChange {
  note: NoteFile;
  /** Neue Fotobytes, die vor dem Batch nach R2 gehen. */
  upload: { key: string; base64: string } | null;
  /** Das bisherige Foto, das nach dem Batch in den Papierkorb wandert. */
  trashKey: string | null;
}

/**
 * Prüft die gewünschten Änderungen an Beschreibungen gegen den gespeicherten
 * Stand und lässt weg, was gar keine Änderung ist.
 *
 * Ändern darf, wer geschrieben hat — und ein Admin an jeder Beschreibung
 * (Entscheid des Besitzers: Admins sollen alles können, was Autor*innen
 * können). `note.by` bleibt dabei unangetastet: Die Beschreibung gehört
 * weiterhin der Person, die sie verfasst hat; wer sie angefasst hat, steht im
 * Verlaufseintrag dieser Korrektur.
 *
 * Verglichen wird über `searchKey`, nicht zeichengenau: Ältere Notizen tragen
 * die Schreibweise aus dem alten Freitextfeld, und die trifft den Kontonamen
 * nicht immer buchstäblich («Sära»/«Saera»). Genau dafür gibt es diese
 * Normalisierung — sie ist seit den Konten auch der Login-Schlüssel. Verglichen
 * wird gegen alle Schlüssel des Kontos: Wer sich umbenennt, behält seine alten
 * Beschreibungen.
 */
function planNoteEdits(
  tipId: string,
  before: NoteFile[],
  edits: NoteEdit[],
  meineKeys: Set<string>,
  idempotencyKey: string,
  isAdmin: boolean,
): NoteChange[] {
  const changes: NoteChange[] = [];

  for (const edit of edits) {
    const current = before.find((note) => note.id === edit.id);
    if (!current) throw new ValidationError('Diese Beschreibung gibt es nicht (mehr).');
    if (!isAdmin && !meineKeys.has(searchKey(current.by))) {
      throw new ValidationError('Ändern kann eine Beschreibung nur, wer sie geschrieben hat.');
    }

    const photoName =
      edit.photo === 'behalten'
        ? current.photo
        : edit.photo === 'weg'
          ? null
          : `${current.id}-${vorgangsAbdruck(idempotencyKey)}.${edit.photo.ext}`;

    if (edit.text === current.text && photoName === current.photo) continue;

    changes.push({
      note: { ...current, text: edit.text, photo: photoName },
      upload:
        typeof edit.photo === 'object' && photoName
          ? { key: photoKey(tipId, photoName), base64: edit.photo.base64 }
          : null,
      trashKey:
        current.photo && current.photo !== photoName ? photoKey(tipId, current.photo) : null,
    });
  }

  return changes;
}

/**
 * Führt den Batch aus und fängt genau EIN erwartetes Scheitern ab: Zwei
 * gleichzeitige Sendungen desselben Vorgangs — der Verlierer bekommt die
 * UNIQUE-Verletzung auf dem Idempotenzschlüssel und antwortet «schon da».
 */
async function runBatch(
  db: D1Database,
  stmts: D1PreparedStatement[],
  idempotencyKey: string,
): Promise<{ repeated: boolean; id: number }> {
  try {
    const results = await db.batch(stmts);
    const last = results[results.length - 1];
    return { repeated: false, id: last?.meta.last_row_id ?? 0 };
  } catch (error) {
    if (uniqueViolation(error) === 'verlauf.idempotency_key') {
      const already = await findVerlaufByKey(db, idempotencyKey);
      if (already) return { repeated: true, id: already.id };
    }
    throw error;
  }
}

/** Kurzer, dateinamentauglicher Abdruck des Vorgangsschlüssels. */
function vorgangsAbdruck(idempotencyKey: string): string {
  return idempotencyKey.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'x';
}

function buildTip(id: string, tip: TipFields, today: string): TipFile {
  return {
    schema: 1,
    id,
    name: tip.name,
    country: tip.country,
    place: tip.place,
    categories: tip.categories,
    ...(tip.address ? { address: tip.address } : {}),
    ...(tip.link ? { link: tip.link } : {}),
    ...(tip.coords ? { coords: tip.coords } : {}),
    closed: false,
    added: today,
  };
}

/**
 * `id` und `added` bleiben unangetastet: Die ID ist unveränderlich, sonst
 * brechen alle Links, die schon im Gruppenchat stehen.
 */
function mergeTip(current: TipFile, changes: TipFields): TipFile {
  return {
    schema: current.schema,
    id: current.id,
    name: changes.name,
    country: changes.country,
    place: changes.place,
    categories: changes.categories,
    ...(changes.address ? { address: changes.address } : {}),
    ...(changes.link ? { link: changes.link } : {}),
    ...(changes.coords ? { coords: changes.coords } : {}),
    closed: changes.closed ?? false,
    added: current.added,
  };
}

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}
