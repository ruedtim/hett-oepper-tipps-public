/**
 * Prüfung und Normalisierung eingereichter Beiträge.
 *
 * Hier wird bewusst NICHT mit ajv validiert, obwohl das Build-Skript es tut:
 * ajv übersetzt Schemas zur Laufzeit über `new Function`, und das ist in Workers
 * nicht erlaubt. Also von Hand — dafür mit Fehlermeldungen, die jemand versteht,
 * der gerade in einer Bar sitzt und einen Tipp eintippen will.
 */

import { heuteIso } from '../../shared/datum.mjs';
import { searchKey, slugify } from '../../shared/normalize.mjs';

export type SubmissionKind = 'tipp' | 'ergaenzung' | 'korrektur' | 'loeschung';


export interface PhotoInput {
  /** Reines Base64 ohne «data:»-Präfix. */
  base64: string;
  ext: 'webp' | 'jpg';
}

export interface TipFields {
  name: string;
  country: string;
  place: string;
  categories: string[];
  address?: string;
  link?: string;
  coords?: { lat: number; lng: number };
  closed?: boolean;
}

export interface NoteFields {
  by: string;
  text: string;
  photo?: PhotoInput;
}

/**
 * Eine eigene Beschreibung, die im Korrektur-Vorgang mitgeändert wird.
 *
 * `photo` unterscheidet drei Fälle, weil «nichts geschickt» und «weg damit»
 * zwei verschiedene Dinge sind: Auf der Leitung steht dafür ein fehlendes Feld
 * (behalten), `null` (weg) oder ein Foto-Objekt (ersetzen).
 */
export interface NoteEdit {
  id: string;
  text: string;
  photo: 'behalten' | 'weg' | PhotoInput;
}

export interface Submission {
  kind: SubmissionKind;
  tipId?: string;
  tip?: TipFields;
  note?: NoteFields;
  /** Bei einer Korrektur: Änderungen an eigenen Beschreibungen. */
  notes?: NoteEdit[];
  /**
   * Bei einem neuen Tipp: Wünsche, denen er zugeordnet wird. Ob es die
   * Wünsche gibt und ob sie noch gelten, prüft api/submit.ts gegen die
   * Datenbank — hier steht nur die Form fest.
   */
  wunschIds?: string[];
  /** Nur bei einer Löschung: wer und warum. */
  reason?: { by: string; text: string };
  /** Bei einer Korrektur: wer sie gemacht hat. */
  by?: string;
  idempotencyKey: string;
}

export class ValidationError extends Error {}

/**
 * «UNIQUE constraint failed: tips.id» → «tips.id», sonst null.
 *
 * Der einzige Weg, ein erwartetes Schreib-Rennen von einem echten Fehler zu
 * unterscheiden: D1 gibt die verletzte Spalte nur im Meldungstext preis.
 */
export function uniqueViolation(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /UNIQUE constraint failed: ([\w.]+)/.exec(message);
  return match?.[1] ?? null;
}

/** ~1.5 MB Bilddaten, nach dem Verkleinern im Browser reichlich. */
const MAX_PHOTO_BYTES = 1_500_000;
const MAX_TEXT = 4000;
/** So viele Beschreibungen hat niemand an einem Tipp — eine Obergrenze gegen Unfug. */
const MAX_NOTE_EDITS = 20;
/** Zu so vielen Wünschen auf einmal passt kein Tipp. */
const MAX_WUNSCH_IDS = 10;

/**
 * Eine Zeichenkette prüfen und trimmen.
 *
 * `field` steht im Nominativ mit Artikel («Der Name», «Die Adresse»), damit
 * `${field} fehlt.` einen ganzen Satz ergibt. Auch von lib/wuensche.ts benutzt —
 * die Wünsche sollen dieselben Sätze sagen wie die Tipps.
 */
export function str(value: unknown, field: string, { max, required = true }: { max: number; required?: boolean }): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} fehlt.`);
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} hat das falsche Format.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} fehlt.`);
  if (trimmed.length > max) throw new ValidationError(`${field} ist zu lang (max. ${max} Zeichen).`);
  return trimmed;
}

function parseTip(raw: unknown, activeCategoryIds: Set<string>): TipFields {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Die Angaben zum Ort fehlen.');
  const input = raw as Record<string, unknown>;

  const name = str(input.name, 'Der Name', { max: 120 });
  const place = str(input.place, 'Der Ort', { max: 80 });
  // Ein Ort nur aus Satzzeichen/Emoji ergäbe einen leeren Suchschlüssel — die
  // Ortsgruppierung und die Backup-Validierung brechen daran. Früh ablehnen.
  if (!searchKey(place)) {
    throw new ValidationError('Der Ort braucht mindestens einen Buchstaben oder eine Zahl.');
  }

  // Grosszügige Längengrenze, damit hier die Formatmeldung greift und nicht
  // «zu lang» — wer «Italien» statt «IT» schickt, soll das auch lesen können.
  const country = str(input.country, 'Das Land', { max: 60 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ValidationError('Das Land muss ein zweibuchstabiger Ländercode sein, z. B. IT.');
  }

  if (!Array.isArray(input.categories) || input.categories.length === 0) {
    throw new ValidationError('Mindestens eine Kategorie auswählen.');
  }
  if (input.categories.length > 5) throw new ValidationError('Höchstens fünf Kategorien.');

  const categories: string[] = [];
  for (const entry of input.categories) {
    if (typeof entry !== 'string' || !activeCategoryIds.has(entry)) {
      throw new ValidationError(`Die Kategorie «${String(entry)}» gibt es nicht.`);
    }
    if (!categories.includes(entry)) categories.push(entry);
  }

  const tip: TipFields = { name, country, place, categories };

  const address = str(input.address, 'Die Adresse', { max: 200, required: false });
  if (address) tip.address = address;

  const link = str(input.link, 'Der Link', { max: 500, required: false });
  if (link) {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new ValidationError('Der Link ist keine gültige Adresse.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ValidationError('Der Link muss mit http:// oder https:// beginnen.');
    }
    tip.link = parsed.toString();
  }

  if (input.coords !== undefined && input.coords !== null) {
    const coords = input.coords as Record<string, unknown>;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new ValidationError('Die Koordinaten liegen ausserhalb des Gültigen.');
    }
    tip.coords = { lat, lng };
  }

  if (typeof input.closed === 'boolean') tip.closed = input.closed;

  return tip;
}

function parseNote(raw: unknown, userName: string): NoteFields {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Der Text fehlt.');
  const input = raw as Record<string, unknown>;

  const note: NoteFields = {
    by: userName,
    text: str(input.text, 'Der Text', { max: MAX_TEXT }),
  };

  if (input.photo !== undefined && input.photo !== null) {
    note.photo = parsePhoto(input.photo);
  }

  return note;
}

function parsePhoto(raw: unknown): PhotoInput {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Das Foto ist beschädigt.');
  const photo = raw as Record<string, unknown>;
  const base64 = typeof photo.base64 === 'string' ? photo.base64.replace(/\s/g, '') : '';
  const ext = photo.ext === 'jpg' ? 'jpg' : 'webp';

  if (!base64) throw new ValidationError('Das Foto ist leer.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ValidationError('Das Foto ist beschädigt.');

  // Base64 bläht um Faktor 4/3 auf; wir wollen die echte Dateigrösse begrenzen.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_PHOTO_BYTES) {
    throw new ValidationError('Das Foto ist zu gross. Bitte ein kleineres wählen.');
  }
  if (!looksLikeImage(base64, ext)) {
    throw new ValidationError('Die Datei sieht nicht nach einem Bild aus.');
  }

  return { base64, ext };
}

/**
 * Änderungen an eigenen Beschreibungen. WEM eine Beschreibung gehört, steht
 * hier bewusst nicht zur Debatte — das prüft api/submit.ts gegen den
 * gespeicherten Stand, denn nur dort ist `note.by` bekannt.
 */
function parseNoteEdits(raw: unknown): NoteEdit[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Die Beschreibungen haben das falsche Format.');
  if (raw.length > MAX_NOTE_EDITS) throw new ValidationError('Das sind zu viele Beschreibungen auf einmal.');

  const edits: NoteEdit[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ValidationError('Die Beschreibungen haben das falsche Format.');
    }
    const input = entry as Record<string, unknown>;

    const id = str(input.id, 'Die Beschreibung', { max: 120 });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new ValidationError('Die Beschreibung ist unbekannt.');
    if (edits.some((edit) => edit.id === id)) {
      throw new ValidationError('Dieselbe Beschreibung wurde doppelt geschickt.');
    }

    edits.push({
      id,
      text: str(input.text, 'Der Text', { max: MAX_TEXT }),
      photo:
        input.photo === undefined
          ? 'behalten'
          : input.photo === null
            ? 'weg'
            : parsePhoto(input.photo),
    });
  }

  return edits;
}

/**
 * Wünsche, denen der neue Tipp zugeordnet wird.
 *
 * Nur die Form: dass es die Wünsche gibt und dass sie noch gelten, weiss allein
 * die Datenbank — das prüft api/submit.ts.
 */
function parseWunschIds(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Die Wünsche haben das falsche Format.');
  if (raw.length > MAX_WUNSCH_IDS) throw new ValidationError('Das sind zu viele Wünsche auf einmal.');

  const ids: string[] = [];
  for (const entry of raw) {
    // UUID-Form, wie crypto.randomUUID() sie liefert.
    if (typeof entry !== 'string' || !/^[0-9a-f-]{8,40}$/.test(entry)) {
      throw new ValidationError('Diesen Wunsch gibt es nicht.');
    }
    if (!ids.includes(entry)) ids.push(entry);
  }
  return ids;
}

/**
 * Prüft die ersten Bytes, statt der Dateiendung zu glauben.
 * WebP beginnt mit «RIFF», JPEG mit FF D8 FF.
 */
function looksLikeImage(base64: string, ext: 'webp' | 'jpg'): boolean {
  const head = atob(base64.slice(0, 32));
  if (ext === 'webp') return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
}

/**
 * `userName` ist der Name des angemeldeten Kontos — er füllt alle by-Felder.
 * Die Zeiten, in denen der Name ein Freitextfeld im Formular war, sind mit den
 * persönlichen Konten vorbei: Wer etwas tut, steht jetzt fest.
 */
export function parseSubmission(
  raw: unknown,
  activeCategoryIds: Set<string>,
  userName: string,
): Submission {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Die Anfrage war leer.');
  const input = raw as Record<string, unknown>;

  const kind = input.kind;
  if (kind !== 'tipp' && kind !== 'ergaenzung' && kind !== 'korrektur' && kind !== 'loeschung') {
    throw new ValidationError('Unbekannte Art der Einreichung.');
  }

  const idempotencyKey = str(input.idempotencyKey, 'Der Vorgangsschlüssel', { max: 64 });
  if (!/^[A-Za-z0-9-]+$/.test(idempotencyKey)) {
    throw new ValidationError('Der Vorgangsschlüssel hat das falsche Format.');
  }

  const submission: Submission = { kind, idempotencyKey };

  if (kind !== 'tipp') {
    const tipId = str(input.tipId, 'Der Tipp', { max: 80 });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tipId)) throw new ValidationError('Der Tipp ist unbekannt.');
    submission.tipId = tipId;
  }

  if (kind === 'tipp' || kind === 'korrektur') {
    submission.tip = parseTip(input.tip, activeCategoryIds);
  }
  if (kind === 'tipp') {
    submission.wunschIds = parseWunschIds(input.wunschIds);
  }
  if (kind === 'korrektur') {
    submission.by = userName;
    submission.notes = parseNoteEdits(input.notes);
  }
  if (kind === 'tipp' || kind === 'ergaenzung') {
    submission.note = parseNote(input.note, userName);
  }
  if (kind === 'loeschung') {
    const reason = (input.reason ?? {}) as Record<string, unknown>;
    submission.reason = {
      by: userName,
      // Eine Begründung ist Pflicht. Wer einen Eintrag samt aller Notizen
      // anderer Leute wegwerfen will, soll einen Satz dazu schreiben können.
      text: str(reason.text, 'Die Begründung', { max: 1000 }),
    };
  }

  return submission;
}

// ---------------------------------------------------------------- IDs ---

/**
 * So lang darf die ID werden. Nicht wegen der Datenbank (die Bereichsabfrage in
 * `freeTipId` kennt kein Limit mehr), sondern wegen der Links: Die ID steht in
 * den Chats der Freunde, und ein Google-Name wie «Tharge's Momo King Take Away
 * und Lieferservice» ergäbe eine URL über mehrere Zeilen.
 */
const MAX_TIP_ID = 48;

/** «Da Enzo al 29» in «Roma» → «da-enzo-al-29-roma» */
export function tipIdFor(name: string, place: string): string {
  let slug = slugify(`${name} ${place}`);
  if (slug.length > MAX_TIP_ID) {
    // Am Wortende kappen, nicht mitten im Wort — «lieferservic» sähe kaputt aus.
    const cut = slug.lastIndexOf('-', MAX_TIP_ID);
    slug = cut > 0 ? slug.slice(0, cut) : slug.slice(0, MAX_TIP_ID);
  }
  return slug || `tipp-${Date.now().toString(36)}`;
}

/** «2026-07-26-sara» — der Dateiname einer Notiz. */
export function noteIdFor(by: string, isoDate: string): string {
  const person = slugify(by) || 'anonym';
  return `${isoDate}-${person}`;
}

/**
 * Heute in Zürcher Ortszeit.
 *
 * Die Zeitrechnung wohnt in shared/datum.mjs, weil sie das Frontend auch
 * braucht: Das Wunsch-Formular setzt damit `min` am Datumsfeld, und liefe das
 * auseinander, lehnte der Server ein Datum ab, das der Browser gerade noch
 * angeboten hat. Der Name bleibt hier stehen — die Aufrufer in api/submit.ts
 * meinen genau das.
 */
export function todayIso(): string {
  return heuteIso();
}
