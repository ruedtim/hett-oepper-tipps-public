/**
 * Zugriff auf die Inhalts-Tabellen (tips, notes, categories, place_aliases).
 *
 * Die TypeScript-Formen TipFile/NoteFile entsprechen bewusst EXAKT den
 * bisherigen Dateien data/tips/<id>/tip.json bzw. notes/<id>.json — der
 * Export fürs Backup, die Verlaufs-Snapshots und das Restore-Skript sprechen
 * alle dieses eine Format.
 */

import { ValidationError } from './submission';

/** Inhalt von tip.json — Schlüsselreihenfolge ist Teil des Formats. */
export interface TipFile {
  schema: number;
  id: string;
  name: string;
  country: string;
  place: string;
  categories: string[];
  address?: string;
  link?: string;
  coords?: { lat: number; lng: number };
  closed: boolean;
  added: string;
}

/** Inhalt von notes/<id>.json. */
export interface NoteFile {
  id: string;
  by: string;
  text: string;
  photo: string | null;
  added: string;
}

/** Ein Tipp mit allen Notizen — die Einheit, in der gespeichert, gesichert und zurückgenommen wird. */
export interface TipAggregate {
  tip: TipFile;
  notes: NoteFile[];
}

export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  active: boolean;
}

interface TipRow {
  id: string;
  schema: number;
  name: string;
  country: string;
  place: string;
  categories: string;
  address: string | null;
  link: string | null;
  lat: number | null;
  lng: number | null;
  closed: number;
  added: string;
}

interface NoteRow {
  tip_id: string;
  id: string;
  by: string;
  text: string;
  photo: string | null;
  added: string;
}

export function rowToTipFile(row: TipRow): TipFile {
  return {
    schema: row.schema,
    id: row.id,
    name: row.name,
    country: row.country,
    place: row.place,
    categories: JSON.parse(row.categories) as string[],
    ...(row.address ? { address: row.address } : {}),
    ...(row.link ? { link: row.link } : {}),
    ...(row.lat !== null && row.lng !== null ? { coords: { lat: row.lat, lng: row.lng } } : {}),
    closed: row.closed === 1,
    added: row.added,
  };
}

function rowToNoteFile(row: NoteRow): NoteFile {
  return { id: row.id, by: row.by, text: row.text, photo: row.photo, added: row.added };
}

/** Dieselbe Reihenfolge wie im alten Build-Skript: nach Datum, dann nach ID. */
export function sortNotes(notes: NoteFile[]): NoteFile[] {
  return [...notes].sort((a, b) =>
    a.added < b.added ? -1 : a.added > b.added ? 1 : a.id.localeCompare(b.id),
  );
}

export async function getTipAggregate(db: D1Database, tipId: string): Promise<TipAggregate | null> {
  const tip = await db.prepare('SELECT * FROM tips WHERE id = ?1').bind(tipId).first<TipRow>();
  if (!tip) return null;
  const notes = await db.prepare('SELECT * FROM notes WHERE tip_id = ?1').bind(tipId).all<NoteRow>();
  return { tip: rowToTipFile(tip), notes: sortNotes(notes.results.map(rowToNoteFile)) };
}

export async function getAllAggregates(db: D1Database): Promise<TipAggregate[]> {
  const tips = await db.prepare('SELECT * FROM tips ORDER BY id').all<TipRow>();
  const notes = await db.prepare('SELECT * FROM notes').all<NoteRow>();

  const notesByTip = new Map<string, NoteFile[]>();
  for (const row of notes.results) {
    const bucket = notesByTip.get(row.tip_id) ?? [];
    bucket.push(rowToNoteFile(row));
    notesByTip.set(row.tip_id, bucket);
  }

  return tips.results.map((row) => ({
    tip: rowToTipFile(row),
    notes: sortNotes(notesByTip.get(row.id) ?? []),
  }));
}

export async function getCategories(db: D1Database): Promise<Category[]> {
  const rows = await db
    .prepare('SELECT id, label, emoji, color, active FROM categories ORDER BY position')
    .all<{ id: string; label: string; emoji: string; color: string; active: number }>();
  return rows.results.map((row) => ({ ...row, active: row.active === 1 }));
}

export async function activeCategoryIds(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare('SELECT id FROM categories WHERE active = 1').all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

/**
 * Welche Kategorien nennt aktuell mindestens ein Tipp ODER ein Wunsch? Eine
 * json_each-Abfrage statt ASSETS-Fetch.
 *
 * Wünsche zählen mit, obwohl sie vergänglich sind: Fiele eine Kategorie weg,
 * die noch in einem Wunsch steht, zeigte die Referenz ins Leere und die
 * nächtliche Backup-Validierung bräche daran — dasselbe Szenario, gegen das
 * resurrectUsedCategories unten argumentiert.
 */
export async function categoriesInUse(db: D1Database): Promise<Set<string>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT je.value AS id FROM tips, json_each(tips.categories) AS je
       UNION
       SELECT DISTINCT je.value AS id FROM wuensche, json_each(wuensche.kategorien) AS je`,
    )
    .all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

/**
 * TOCTOU-Heilung nach einem Kategorien-Schreiben: Die Nutzungsprüfung und der
 * Schreib-Batch sind zwei getrennte Round-Trips — genau in diesem Fenster kann
 * jemand einen Tipp mit einer gerade entfernten Kategorie einreichen (dessen
 * Aktiv-Prüfung lief noch gegen den alten Stand). Die Referenz zeigte dann ins
 * Leere, und die nächtliche Backup-Validierung bräche daran. Deshalb nach dem
 * Schreiben nachschauen und betroffene IDs inaktiv wieder einfügen.
 *
 * @returns die wieder eingefügten IDs (fürs Log).
 */
export async function resurrectUsedCategories(
  db: D1Database,
  removed: Category[],
): Promise<string[]> {
  if (removed.length === 0) return [];
  const used = await categoriesInUse(db);
  const resurrect = removed.filter((category) => used.has(category.id));
  if (resurrect.length === 0) return [];

  const row = await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM categories')
    .first<{ p: number }>();
  const base = (row?.p ?? -1) + 1;
  await db.batch(
    resurrect.map((c, index) =>
      db
        .prepare(
          'INSERT INTO categories (id, label, emoji, color, active, position) VALUES (?1, ?2, ?3, ?4, 0, ?5)',
        )
        .bind(c.id, c.label, c.emoji, c.color, base + index),
    ),
  );
  return resurrect.map((category) => category.id);
}

export async function getAliases(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, label FROM place_aliases').all<{ key: string; label: string }>();
  const aliases: Record<string, string> = {};
  for (const row of rows.results) aliases[row.key] = row.label;
  return aliases;
}

// ------------------------------------------------------------- freie IDs ---

/**
 * Eine freie ID finden. Zwei Leute, die dasselbe Lokal eintragen, landen sonst
 * auf derselben ID und überschreiben sich; das Suffix beginnt wie bisher bei
 * «-2». Bewusst KEIN LIKE: D1 begrenzt LIKE-Muster auf 50 Zeichen, und ein
 * langer Google-Name («Tharge's Momo King Take Away und Lieferservice») riss
 * die Grenze — jede Einreichung scheiterte mit «pattern too complex». Der
 * Bereichsvergleich sagt dasselbe («beginnt mit <base>-»), denn «.» ist im
 * ASCII das Zeichen nach «-» und der Slug enthält nur [a-z0-9-].
 */
export async function freeTipId(db: D1Database, base: string): Promise<string> {
  const rows = await db
    .prepare("SELECT id FROM tips WHERE id = ?1 OR (id >= ?1 || '-' AND id < ?1 || '.')")
    .bind(base)
    .all<{ id: string }>();
  const taken = new Set(rows.results.map((row) => row.id));

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 21; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ValidationError('Dieser Name ist zu oft vergeben. Bitte etwas genauer benennen.');
}

/** Dieselbe Person kann am selben Tag zweimal etwas schreiben. */
export async function freeNoteId(db: D1Database, tipId: string, base: string): Promise<string> {
  const rows = await db
    .prepare("SELECT id FROM notes WHERE tip_id = ?1 AND (id = ?2 OR (id >= ?2 || '-' AND id < ?2 || '.'))")
    .bind(tipId, base)
    .all<{ id: string }>();
  const taken = new Set(rows.results.map((row) => row.id));

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 21; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ValidationError('Heute schon sehr viel geschrieben. Bitte morgen weiter.');
}

// ----------------------------------------------------- Batch-Bausteine ---

/** INSERT-Statements für ein komplettes Aggregat (Tipp + alle Notizen). */
export function tipInsertStmts(db: D1Database, agg: TipAggregate): D1PreparedStatement[] {
  const { tip } = agg;
  const stmts = [
    db
      .prepare(
        `INSERT INTO tips (id, schema, name, country, place, categories, address, link, lat, lng, closed, added)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        tip.id,
        tip.schema,
        tip.name,
        tip.country,
        tip.place,
        JSON.stringify(tip.categories),
        tip.address ?? null,
        tip.link ?? null,
        tip.coords?.lat ?? null,
        tip.coords?.lng ?? null,
        tip.closed ? 1 : 0,
        tip.added,
      ),
  ];
  for (const note of agg.notes) {
    stmts.push(noteInsertStmt(db, tip.id, note));
  }
  return stmts;
}

export function noteInsertStmt(db: D1Database, tipId: string, note: NoteFile): D1PreparedStatement {
  return db
    .prepare('INSERT INTO notes (tip_id, id, by, text, photo, added) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(tipId, note.id, note.by, note.text, note.photo, note.added);
}

/**
 * Ändert Text und Foto einer Notiz. `by` und `added` bleiben stehen: Wer etwas
 * geschrieben hat und wann, ändert sich durch eine Korrektur nicht — und die
 * Notiz-ID trägt beides ohnehin schon in sich.
 */
export function noteUpdateStmt(db: D1Database, tipId: string, note: NoteFile): D1PreparedStatement {
  return db
    .prepare('UPDATE notes SET text = ?3, photo = ?4 WHERE tip_id = ?1 AND id = ?2')
    .bind(tipId, note.id, note.text, note.photo);
}

/** Überschreibt die veränderlichen Felder eines Tipps — `id` und `added` bleiben, was sie sind. */
export function tipUpdateStmt(db: D1Database, tip: TipFile): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tips SET name = ?2, country = ?3, place = ?4, categories = ?5,
       address = ?6, link = ?7, lat = ?8, lng = ?9, closed = ?10 WHERE id = ?1`,
    )
    .bind(
      tip.id,
      tip.name,
      tip.country,
      tip.place,
      JSON.stringify(tip.categories),
      tip.address ?? null,
      tip.link ?? null,
      tip.coords?.lat ?? null,
      tip.coords?.lng ?? null,
      tip.closed ? 1 : 0,
    );
}

/**
 * Löscht ein Aggregat. Notizen und Wunsch-Zuordnungen ausdrücklich zuerst —
 * verlässt sich nicht auf ON DELETE CASCADE.
 *
 * Die Zuordnungen kehren bei einem «Rückgängig» nicht zurück: Der Verlaufs-
 * Snapshot ist das Tipp-Aggregat, und Wünsche stehen nicht im Verlauf. Das ist
 * verkraftbar — die Zuordnung ist in zwei Klicks neu gesetzt, und der Wunsch
 * ist ohnehin bald abgelaufen.
 */
export function tipDeleteStmts(db: D1Database, tipId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM wunsch_tipps WHERE tip_id = ?1').bind(tipId),
    db.prepare('DELETE FROM notes WHERE tip_id = ?1').bind(tipId),
    db.prepare('DELETE FROM tips WHERE id = ?1').bind(tipId),
  ];
}
