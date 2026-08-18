/**
 * Zugriff auf die Wunsch-Tabelle: Gesuche nach Tipps zu einem Ort.
 *
 * Aufgebaut wie lib/db.ts — die Leser geben fertige Dateiformen zurück, die
 * Schreiber geben Statements ZURÜCK und führen nichts aus. Der Endpunkt setzt
 * sie zu genau einem db.batch() zusammen.
 *
 * WunschFile entspricht exakt einem Eintrag in data/wuensche.json; die
 * Schlüsselreihenfolge ist Teil des Formats, weil der Backup-Job byte-genau
 * vergleicht.
 *
 * Anders als bei den Tipps entsteht hier KEIN Verlaufseintrag (siehe CLAUDE.md).
 * Die Idempotenz hängt darum an wuensche.vorgang statt an
 * verlauf.idempotency_key.
 */

import { heuteIso, istEchterTag, tageSpaeter } from '../../shared/datum.mjs';
import { searchKey } from '../../shared/normalize.mjs';
import { str, ValidationError } from './submission';

/** Inhalt eines Eintrags in data/wuensche.json — Schlüsselreihenfolge ist Teil des Formats. */
export interface WunschFile {
  schema: number;
  id: string;
  von: string;
  land: string;
  /**
   * Optional: Ein Wunsch darf auch nur einem Land gelten («irgendwas in
   * Portugal»). Fehlt dann in der Datei.
   */
  ort?: string;
  kategorien: string[];
  text?: string;
  bis: string;
  erstellt: string;
  erfuellt?: { am: string; von: string };
  /**
   * IDs der zugeordneten Tipps, aufsteigend sortiert. Fehlt, wenn keine da
   * sind. Steht im Wunsch statt in einer eigenen Datei: Die Zuordnung gehört
   * ihm, und sie verschwindet mit ihm.
   */
  tipps?: string[];
}

export interface WunschRow {
  id: string;
  schema: number;
  von: string;
  von_key: string;
  land: string;
  /** NULL heisst «kein Ort» — der Wunsch gilt dem ganzen Land (Migration 0004). */
  ort: string | null;
  kategorien: string;
  text: string | null;
  bis: string;
  erstellt: string;
  erfuellt_am: string | null;
  erfuellt_von: string | null;
  vorgang: string | null;
}

/**
 * Der Inhalt eines Wunsches, geprüft — noch ohne ID und Datum vom Server.
 *
 * Ohne `vorgang`, denn den gibt es nur beim Anbringen: Der Idempotenzschlüssel
 * gehört dem einen Formular-Entwurf, aus dem der Wunsch entstand. Beim
 * Bearbeiten wird er nicht angefasst.
 */
export interface WunschFelder {
  land: string;
  /** Leer erlaubt — dann gilt der Wunsch dem ganzen Land. */
  ort: string;
  kategorien: string[];
  text?: string;
  bis: string;
}

/** Was beim Anbringen ankommt: der Inhalt plus der Vorgangsschlüssel. */
export interface WunschEingabe extends WunschFelder {
  vorgang: string;
}

/** Höchstens so lang darf der Freitext sein — ein Reiseplan, kein Roman. */
const MAX_TEXT = 1000;

/** Weiter voraus plant im Freundeskreis niemand, und ein Tippfehler im Jahr fiele sonst nicht auf. */
const MAX_TAGE_VORAUS = 730;

export function rowToWunschFile(row: WunschRow, tipps: string[] = []): WunschFile {
  return {
    schema: row.schema,
    id: row.id,
    von: row.von,
    land: row.land,
    ...(row.ort ? { ort: row.ort } : {}),
    kategorien: JSON.parse(row.kategorien) as string[],
    // Optionale Schlüssel nur wenn gesetzt — sonst stünde `"text": null` in
    // jeder zweiten Zeile des Backups.
    ...(row.text ? { text: row.text } : {}),
    bis: row.bis,
    erstellt: row.erstellt,
    ...(row.erfuellt_am && row.erfuellt_von
      ? { erfuellt: { am: row.erfuellt_am, von: row.erfuellt_von } }
      : {}),
    ...(tipps.length > 0 ? { tipps: [...tipps].sort() } : {}),
  };
}

// ------------------------------------------------------------------ Lesen ---

export async function getWunsch(db: D1Database, id: string): Promise<WunschRow | null> {
  return db.prepare('SELECT * FROM wuensche WHERE id = ?1').bind(id).first<WunschRow>();
}

/** Alle Zuordnungen als Map wunsch_id → Tipp-IDs. Eine Abfrage statt N. */
async function getVerknuepfungen(db: D1Database): Promise<Map<string, string[]>> {
  const rows = await db
    .prepare('SELECT wunsch_id, tip_id FROM wunsch_tipps')
    .all<{ wunsch_id: string; tip_id: string }>();
  const byWunsch = new Map<string, string[]>();
  for (const row of rows.results) {
    const bucket = byWunsch.get(row.wunsch_id) ?? [];
    bucket.push(row.tip_id);
    byWunsch.set(row.wunsch_id, bucket);
  }
  return byWunsch;
}

/**
 * Was die App zeigt: alles, was noch nicht abgelaufen ist.
 *
 * `bis` ist der letzte gültige Tag, darum `>=` und nie `>`. Erfüllte Wünsche
 * kommen mit — sie verschwinden nur aus der Kopfzeile, bleiben aber bis zum
 * Ablauf in der Liste stehen, damit ein Fehlklick sichtbar und rücknehmbar ist.
 */
export async function getSichtbareWuensche(db: D1Database, heute: string): Promise<WunschFile[]> {
  const [rows, verknuepft] = await Promise.all([
    // Nach Land vor Ort: Ortlose Wünsche stehen sonst zwischen den anderen
    // Ländern, obwohl sie mit ihrem Land zusammengehören.
    db
      .prepare('SELECT * FROM wuensche WHERE bis >= ?1 ORDER BY bis, land, ort, id')
      .bind(heute)
      .all<WunschRow>(),
    getVerknuepfungen(db),
  ]);
  return rows.results.map((row) => rowToWunschFile(row, verknuepft.get(row.id)));
}

/** Alles für den Export — auch Abgelaufenes, wie der Export auch geschlossene Tipps schreibt. */
export async function getAlleWuensche(db: D1Database): Promise<WunschFile[]> {
  const [rows, verknuepft] = await Promise.all([
    db.prepare('SELECT * FROM wuensche ORDER BY bis, id').all<WunschRow>(),
    getVerknuepfungen(db),
  ]);
  return rows.results.map((row) => rowToWunschFile(row, verknuepft.get(row.id)));
}

/**
 * Von den übergebenen IDs die, die es gibt und die noch gelten.
 *
 * Bewusst filtern statt ablehnen: Zwischen dem Öffnen des Formulars und dem
 * Senden kann ein Wunsch abgelaufen sein. Eine Fehlermeldung über etwas, das
 * gar nicht mehr existiert, hülfe niemandem — der Tipp soll trotzdem rein.
 */
export async function gueltigeWunschIds(
  db: D1Database,
  ids: string[],
  heute: string,
): Promise<GueltigerWunsch[]> {
  if (ids.length === 0) return [];
  const platzhalter = ids.map((_, index) => `?${index + 2}`).join(', ');
  const rows = await db
    .prepare(`SELECT id, von_key, ort, land FROM wuensche WHERE bis >= ?1 AND id IN (${platzhalter})`)
    .bind(heute, ...ids)
    .all<GueltigerWunsch>();
  return rows.results;
}

/**
 * Was der Einreichungs-Endpunkt von einem gültigen Wunsch braucht: die ID zum
 * Verknüpfen, den Rest für die Benachrichtigung an die Autorin. Alles in einer
 * Abfrage — ein zweiter Read nur für die drei Felder wäre Verschwendung.
 */
export interface GueltigerWunsch {
  id: string;
  von_key: string;
  ort: string | null;
  land: string;
}

/** Zu welchen (noch gültigen) Wünschen gehört dieser Tipp? Für die Prüfung beim Verknüpfen. */
export async function wunschHatTipp(
  db: D1Database,
  wunschId: string,
  tipId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM wunsch_tipps WHERE wunsch_id = ?1 AND tip_id = ?2')
    .bind(wunschId, tipId)
    .first<{ x: number }>();
  return row !== null;
}

export async function findWunschByVorgang(
  db: D1Database,
  vorgang: string,
): Promise<{ id: string } | null> {
  return db
    .prepare('SELECT id FROM wuensche WHERE vorgang = ?1')
    .bind(vorgang)
    .first<{ id: string }>();
}

// ----------------------------------------------------- Batch-Bausteine ---

export function wunschInsertStmt(
  db: D1Database,
  wunsch: WunschEingabe,
  { id, von, heute }: { id: string; von: string; heute: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO wuensche (id, schema, von, von_key, land, ort, kategorien, text, bis, erstellt, vorgang)
       VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      id,
      von,
      searchKey(von),
      wunsch.land,
      // Leerer Ort wird NULL — «kein Ort» ist ein Zustand, keine leere Zeichenkette.
      wunsch.ort || null,
      JSON.stringify(wunsch.kategorien),
      wunsch.text ?? null,
      wunsch.bis,
      heute,
      wunsch.vorgang,
    );
}

/**
 * Erfüllt setzen oder wieder öffnen.
 *
 * Die Berechtigung steht ausdrücklich in der WHERE-Klausel und nicht nur im
 * vorangegangenen SELECT: Sonst könnten Prüfen und Schreiben auseinanderfallen.
 * `am`/`von` sind null beim Wiederöffnen.
 */
/**
 * Wer darf an diesem Wunsch etwas ändern? Als SQL-Fragment plus Bindewerte.
 *
 * Verglichen wird gegen ALLE Schlüssel des Kontos, nicht nur den aktuellen —
 * dieselbe Regel wie bei den Beschreibungen in api/submit.ts. Normalerweise
 * zieht `umbenennungsStmts` die Wünsche beim Umbenennen ohnehin mit; nach einem
 * Restore aus einem älteren Spiegel kann `von_key` aber wieder auf einem
 * früheren Schlüssel stehen, und dann soll der Wunsch trotzdem seiner Person
 * gehören.
 */
function darfDaran(
  { vonKeys, istAdmin }: { vonKeys: string[]; istAdmin: boolean },
  abIndex: number,
): { sql: string; binds: unknown[] } {
  const platzhalter = vonKeys.map((_, i) => `?${abIndex + 1 + i}`).join(', ');
  return {
    sql: `(?${abIndex} = 1 OR von_key IN (${platzhalter}))`,
    binds: [istAdmin ? 1 : 0, ...vonKeys],
  };
}

export function wunschErfuelltStmt(
  db: D1Database,
  id: string,
  {
    am,
    von,
    vonKeys,
    istAdmin,
  }: { am: string | null; von: string | null; vonKeys: string[]; istAdmin: boolean },
): D1PreparedStatement {
  const darf = darfDaran({ vonKeys, istAdmin }, 4);
  return db
    .prepare(
      `UPDATE wuensche SET erfuellt_am = ?2, erfuellt_von = ?3
       WHERE id = ?1 AND ${darf.sql}`,
    )
    .bind(id, am, von, ...darf.binds);
}

/**
 * Den eigenen Wunsch inhaltlich ändern: Ziel, Frist, Kategorien, Text.
 *
 * `von`, `von_key` und `erstellt` bleiben unangetastet — wem der Wunsch gehört
 * und wann er entstand, ändert kein Bearbeiten. `vorgang` ebenfalls: Der
 * Idempotenzschlüssel gehört dem Anbringen, nicht dem Ändern.
 */
export function wunschAendernStmt(
  db: D1Database,
  id: string,
  felder: WunschFelder,
  { vonKeys, istAdmin }: { vonKeys: string[]; istAdmin: boolean },
): D1PreparedStatement {
  const darf = darfDaran({ vonKeys, istAdmin }, 7);
  return db
    .prepare(
      `UPDATE wuensche SET land = ?2, ort = ?3, kategorien = ?4, text = ?5, bis = ?6
       WHERE id = ?1 AND ${darf.sql}`,
    )
    .bind(
      id,
      felder.land,
      // Leerer Ort wird NULL, wie beim Anlegen.
      felder.ort || null,
      JSON.stringify(felder.kategorien),
      felder.text ?? null,
      felder.bis,
      ...darf.binds,
    );
}

/**
 * Löscht den Wunsch samt seiner Zuordnungen.
 *
 * Die Zuordnungen ausdrücklich zuerst und mit derselben Bedingung — nicht über
 * ON DELETE CASCADE, wie schon tipDeleteStmts es hält. Ohne die wiederholte
 * Bedingung verlöre ein Unbefugter zwar nicht den Wunsch, wohl aber dessen
 * Zuordnungen: Beide Anweisungen laufen in einem Batch, aber ein UPDATE ohne
 * Treffer ist kein Fehler und rollt darum nichts zurück.
 */
export function wunschDeleteStmts(
  db: D1Database,
  id: string,
  { vonKeys, istAdmin }: { vonKeys: string[]; istAdmin: boolean },
): D1PreparedStatement[] {
  const darf = darfDaran({ vonKeys, istAdmin }, 2);
  return [
    db
      .prepare(
        `DELETE FROM wunsch_tipps WHERE wunsch_id = ?1
         AND EXISTS (SELECT 1 FROM wuensche WHERE id = ?1 AND ${darf.sql})`,
      )
      .bind(id, ...darf.binds),
    db
      .prepare(`DELETE FROM wuensche WHERE id = ?1 AND ${darf.sql}`)
      .bind(id, ...darf.binds),
  ];
}

/**
 * Einen Tipp einem Wunsch zuordnen. `OR IGNORE`, weil zweimal dasselbe
 * zuzuordnen kein Fehler ist, sondern schlicht schon erledigt.
 */
export function verknuepfeStmt(db: D1Database, wunschId: string, tipId: string): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO wunsch_tipps (wunsch_id, tip_id) VALUES (?1, ?2)')
    .bind(wunschId, tipId);
}

export function loeseVerknuepfungStmt(
  db: D1Database,
  wunschId: string,
  tipId: string,
): D1PreparedStatement {
  return db
    .prepare('DELETE FROM wunsch_tipps WHERE wunsch_id = ?1 AND tip_id = ?2')
    .bind(wunschId, tipId);
}

/**
 * Abgelaufene Wünsche wegräumen.
 *
 * Läuft nach jedem Schreibvorgang, NACH dem Batch und in try/catch — wie der
 * Papierkorb bei den Fotos. Scheitert es, bleiben ein paar für niemanden
 * sichtbare Zeilen liegen; die Daten stimmen trotzdem. Ein Cron wäre der
 * sauberere Weg, aber Cloudflare Pages kennt keine Scheduled Workers, und ein
 * zweiter Worker samt eigenem Deployment für ein DELETE lohnt nicht.
 */
export async function raeumeAbgelaufeneWuensche(db: D1Database, heute: string): Promise<void> {
  try {
    // Die Zuordnungen zuerst, im selben Batch — das ist das «die Verknüpfung
    // wird mit Ablauf des Wunsches aufgelöst» aus der Anforderung. Der Tipp
    // selbst bleibt selbstverständlich stehen.
    await db.batch([
      db
        .prepare(
          'DELETE FROM wunsch_tipps WHERE wunsch_id IN (SELECT id FROM wuensche WHERE bis < ?1)',
        )
        .bind(heute),
      db.prepare('DELETE FROM wuensche WHERE bis < ?1').bind(heute),
    ]);
  } catch (error) {
    console.error('Aufräumen abgelaufener Wünsche fehlgeschlagen:', error);
  }
}

// ------------------------------------------------------------- Prüfung ---

/**
 * Prüft die Formulardaten von Hand — kein ajv, das ist in Workers verboten
 * (siehe lib/submission.ts). Feldnamen im Nominativ mit Artikel, damit
 * «${feld} fehlt.» einen ganzen Satz ergibt.
 */
export function parseWunsch(raw: unknown, aktiveKategorien: Set<string>): WunschEingabe {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Die Anfrage war leer.');
  const input = raw as Record<string, unknown>;

  const vorgang = str(input.idempotencyKey, 'Der Vorgangsschlüssel', { max: 64 });
  if (!/^[A-Za-z0-9-]+$/.test(vorgang)) {
    throw new ValidationError('Der Vorgangsschlüssel hat das falsche Format.');
  }

  return { ...parseWunschFelder(raw, aktiveKategorien), vorgang };
}

/**
 * Dieselbe Prüfung ohne den Vorgangsschlüssel — fürs Bearbeiten eines
 * bestehenden Wunsches. Eine gemeinsame Funktion, damit Anbringen und Ändern
 * nicht mit der Zeit verschieden streng werden.
 */
export function parseWunschFelder(raw: unknown, aktiveKategorien: Set<string>): WunschFelder {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('Die Anfrage war leer.');
  const input = raw as Record<string, unknown>;

  // Der Ort ist optional: Ein Wunsch darf auch nur einem Land gelten
  // («irgendwas in Portugal»). Steht aber einer da, muss er brauchbar sein —
  // ein Ort nur aus Satzzeichen ergäbe einen leeren Suchschlüssel und liesse
  // sich weder gruppieren noch mit einem Tipp zusammenbringen.
  const ort = str(input.ort, 'Der Ort', { max: 80, required: false });
  if (ort && !searchKey(ort)) {
    throw new ValidationError('Der Ort braucht mindestens einen Buchstaben oder eine Zahl.');
  }

  // Grosszügige Längengrenze, damit hier die Formatmeldung greift und nicht
  // «zu lang» — wer «Portugal» statt «PT» schickt, soll das auch lesen können.
  const land = str(input.land, 'Das Land', { max: 60 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(land)) {
    throw new ValidationError('Das Land muss ein zweibuchstabiger Ländercode sein, z. B. PT.');
  }

  const bis = str(input.bis, 'Das Ablaufdatum', { max: 10 });
  if (!istEchterTag(bis)) {
    throw new ValidationError('Das Ablaufdatum ist kein gültiger Tag (JJJJ-MM-TT).');
  }
  const heute = heuteIso();
  // «bis» ist der letzte gültige Tag: Wer heute abreist, darf heute noch fragen.
  if (bis < heute) throw new ValidationError('Das Ablaufdatum liegt in der Vergangenheit.');
  if (bis > tageSpaeter(heute, MAX_TAGE_VORAUS)) {
    throw new ValidationError('Das Ablaufdatum liegt zu weit in der Zukunft (höchstens zwei Jahre).');
  }

  // Kategorien sind hier optional — anders als beim Tipp. Wer nur «irgendwas in
  // Lissabon» sucht, soll nicht raten müssen, was er sucht.
  const roh = input.kategorien;
  if (roh !== undefined && roh !== null && !Array.isArray(roh)) {
    throw new ValidationError('Die Kategorien haben das falsche Format.');
  }
  const eingereicht = Array.isArray(roh) ? roh : [];
  if (eingereicht.length > 5) throw new ValidationError('Höchstens fünf Kategorien.');

  const kategorien: string[] = [];
  for (const eintrag of eingereicht) {
    if (typeof eintrag !== 'string' || !aktiveKategorien.has(eintrag)) {
      throw new ValidationError(`Die Kategorie «${String(eintrag)}» gibt es nicht.`);
    }
    if (!kategorien.includes(eintrag)) kategorien.push(eintrag);
  }

  const wunsch: WunschFelder = { land, ort, kategorien, bis };

  const text = str(input.text, 'Der Text', { max: MAX_TEXT, required: false });
  if (text) wunsch.text = text;

  return wunsch;
}
