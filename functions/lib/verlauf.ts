/**
 * Der Verlauf: eine Handlung = ein Eintrag mit Vorher/Nachher-Snapshot.
 *
 * Das ersetzt das alte «eine Handlung = ein Commit»: Der Eintrag entsteht in
 * derselben D1-Transaktion wie die Änderung selbst, und «Rückgängig» stellt
 * schlicht snapshot_before wieder her. Die Snapshots sind Tipp-Aggregate im
 * data/-Dateiformat — dieselben Strukturen wie Export und Restore.
 */

import type { Category, TipAggregate } from './db';

export type VerlaufKind =
  | 'tipp'
  | 'ergaenzung'
  | 'korrektur'
  | 'loeschung'
  | 'kategorien'
  | 'rueckgaengig';

export interface VerlaufRow {
  id: number;
  at: string;
  kind: VerlaufKind;
  title: string;
  by: string;
  note: string | null;
  tip_id: string | null;
  reverts: number | null;
  snapshot_before: string | null;
  snapshot_after: string | null;
  idempotency_key: string | null;
}

export function verlaufInsertStmt(
  db: D1Database,
  entry: {
    kind: VerlaufKind;
    title: string;
    by: string;
    note?: string;
    tipId?: string;
    reverts?: number;
    /** TipAggregate, bei kind='kategorien' das Kategorien-Array. */
    before: TipAggregate | Category[] | null;
    after: TipAggregate | Category[] | null;
    idempotencyKey?: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO verlauf (kind, title, by, note, tip_id, reverts, snapshot_before, snapshot_after, idempotency_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      entry.kind,
      entry.title,
      entry.by,
      entry.note ?? null,
      entry.tipId ?? null,
      entry.reverts ?? null,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.idempotencyKey ?? null,
    );
}

export function findVerlaufByKey(db: D1Database, key: string): Promise<{ id: number } | null> {
  return db
    .prepare('SELECT id FROM verlauf WHERE idempotency_key = ?1')
    .bind(key)
    .first<{ id: number }>();
}

export function getVerlaufEntry(db: D1Database, id: number): Promise<VerlaufRow | null> {
  return db.prepare('SELECT * FROM verlauf WHERE id = ?1').bind(id).first<VerlaufRow>();
}

/**
 * Synthetisiert aus den Snapshots die Dateiliste, die die Admin-Oberfläche
 * unter «Was wurde geändert?» zeigt — dieselben Pfade und Statuswerte
 * (added/modified/removed), die früher aus dem Commit kamen.
 */
export function diffToFiles(
  before: TipAggregate | null,
  after: TipAggregate | null,
): { path: string; status: 'added' | 'modified' | 'removed' }[] {
  const tipId = before?.tip.id ?? after?.tip.id;
  if (!tipId) return [];

  const files: { path: string; status: 'added' | 'modified' | 'removed' }[] = [];
  const base = `data/tips/${tipId}`;

  if (before && after) {
    if (JSON.stringify(before.tip) !== JSON.stringify(after.tip)) {
      files.push({ path: `${base}/tip.json`, status: 'modified' });
    }
  } else {
    files.push({ path: `${base}/tip.json`, status: after ? 'added' : 'removed' });
  }

  const beforeNotes = new Map((before?.notes ?? []).map((note) => [note.id, note]));
  const afterNotes = new Map((after?.notes ?? []).map((note) => [note.id, note]));

  for (const [id, note] of afterNotes) {
    const old = beforeNotes.get(id);
    if (!old) {
      files.push({ path: `${base}/notes/${id}.json`, status: 'added' });
      if (note.photo) files.push({ path: `public/photos/${tipId}/${note.photo}`, status: 'added' });
    } else if (JSON.stringify(old) !== JSON.stringify(note)) {
      files.push({ path: `${base}/notes/${id}.json`, status: 'modified' });
    }
  }
  for (const [id, note] of beforeNotes) {
    if (!afterNotes.has(id)) {
      files.push({ path: `${base}/notes/${id}.json`, status: 'removed' });
      if (note.photo) files.push({ path: `public/photos/${tipId}/${note.photo}`, status: 'removed' });
    }
  }

  return files;
}

/** Alle Foto-Dateinamen eines Aggregats, als R2-Keys (<tipId>/<datei>). */
export function photoKeysOf(agg: TipAggregate | null): string[] {
  if (!agg) return [];
  return agg.notes.flatMap((note) => (note.photo ? [`${agg.tip.id}/${note.photo}`] : []));
}
