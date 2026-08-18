import { json, requireAdmin } from '../../lib/admin';
import {
  categoriesInUse,
  getCategories,
  getTipAggregate,
  resurrectUsedCategories,
  tipDeleteStmts,
  tipInsertStmts,
} from '../../lib/db';
import type { Category, TipAggregate } from '../../lib/db';
import type { Env } from '../../lib/env';
import { moveToTrash, restoreFromTrash } from '../../lib/fotos';
import type { RequestData } from '../../lib/users';
import { diffToFiles, getVerlaufEntry, photoKeysOf, verlaufInsertStmt } from '../../lib/verlauf';

/**
 * Nimmt eine Änderung zurück.
 *
 * Es wird nichts aus dem Verlauf entfernt: «Rückgängig» stellt den
 * snapshot_before des Eintrags wieder her und schreibt dabei selbst einen
 * Verlaufseintrag mit eigenen Snapshots — auch das Rücknehmen lässt sich damit
 * wieder rücknehmen, ohne Sonderfall.
 *
 * Bewusst kein Merge-Verhalten (wie schon beim Git-Vorgänger): Wurde seither
 * erneut geändert, gilt wieder der alte Stand. Das gilt auf Ebene des ganzen
 * Tipp-Aggregats — auch eine Notiz, die seit dem zurückgenommenen Eintrag
 * dazukam, verschwindet mit. Verloren ist sie nicht: Sie steckt im
 * snapshot_before des Rückgängig-Eintrags und kommt mit dessen Rücknahme
 * wieder. Der spätere Stand bleibt also immer rekonstruierbar.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ request, env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;
  const fotos = env.FOTOS as R2Bucket;
  const by = data.user.name;

  const body = (await request.json().catch(() => ({}))) as { sha?: unknown };
  const sha = typeof body.sha === 'string' ? body.sha : '';
  if (!/^\d{1,10}$/.test(sha)) return json({ error: 'Unbekannter Eintrag.' }, 400);

  const entry = await getVerlaufEntry(db, Number(sha));
  if (!entry) return json({ error: 'Unbekannter Eintrag.' }, 400);

  const before = entry.snapshot_before ? (JSON.parse(entry.snapshot_before) as unknown) : null;
  const after = entry.snapshot_after ? (JSON.parse(entry.snapshot_after) as unknown) : null;

  // Kategorien-Einträge (auch zurückgenommene) tragen Arrays als Snapshots.
  if (entry.kind === 'kategorien' || Array.isArray(before) || Array.isArray(after)) {
    return revertCategories(db, entry.id, entry.title, by, before as Category[] | null);
  }

  const tipId = (before as TipAggregate | null)?.tip.id ?? entry.tip_id;
  if (!tipId) return json({ error: 'An diesem Eintrag gibt es nichts zurückzunehmen.' }, 400);

  return revertTip(db, fotos, entry.id, entry.title, by, tipId, before as TipAggregate | null);
};

async function revertTip(
  db: D1Database,
  fotos: R2Bucket,
  entryId: number,
  entryTitle: string,
  by: string,
  tipId: string,
  target: TipAggregate | null,
): Promise<Response> {
  const current = await getTipAggregate(db, tipId);

  const files = diffToFiles(current, target);
  if (files.length === 0) {
    return json({ error: 'Das ist schon der aktuelle Stand — nichts zurückzunehmen.' }, 400);
  }

  // Die Invariante «eine benutzte Kategorie-ID verschwindet nie» rückwärts
  // gedacht: Der Snapshot könnte Kategorien nennen, die inzwischen (unbenutzt)
  // gelöscht wurden. Unbesehen einfügen hiesse eine Referenz ins Leere — und
  // das nächtliche Backup bräche bei der Validierung. Dann lieber ablehnen:
  // Die Kategorien-Änderung steht ja selbst im Verlauf und lässt sich zuerst
  // zurücknehmen.
  if (target) {
    const known = new Set((await getCategories(db)).map((category) => category.id));
    const missing = target.tip.categories.filter((id) => !known.has(id));
    if (missing.length > 0) {
      return json(
        {
          error:
            `Geht nicht: Der Tipp nutzt «${missing.join('», «')}» — diese Kategorie gibt es ` +
            'nicht mehr. Zuerst die Kategorien-Änderung im Verlauf zurücknehmen.',
        },
        400,
      );
    }
  }

  // R2 zuerst, D1 danach: Scheitert die Wiederherstellung der Bytes, ist noch
  // nichts geschrieben. Umgekehrt (erst Batch, dann R2) zeigte eine
  // wiederhergestellte Notiz ins Leere — und der «schon aktuell»-Frühausstieg
  // oben verhinderte jeden zweiten Anlauf.
  const currentKeys = new Set(photoKeysOf(current));
  const targetKeys = new Set(photoKeysOf(target));
  await restoreFromTrash(fotos, [...targetKeys].filter((key) => !currentKeys.has(key)));

  const results = await db.batch([
    ...tipDeleteStmts(db, tipId),
    ...(target ? tipInsertStmts(db, target) : []),
    verlaufInsertStmt(db, {
      kind: 'rueckgaengig',
      title: `Rückgängig: ${entryTitle}`,
      by,
      tipId,
      reverts: entryId,
      before: current,
      after: target,
    }),
  ]);

  // Wegfallende Fotos erst NACH dem Batch in den Papierkorb — schlägt das
  // fehl, bleibt nur ein unreferenziertes Objekt am alten Key liegen (hinter
  // dem Gate, harmlos); die Daten stimmen bereits.
  try {
    await moveToTrash(fotos, [...currentKeys].filter((key) => !targetKeys.has(key)));
  } catch (error) {
    console.error('Papierkorb-Verschiebung nach Revert fehlgeschlagen:', error);
  }

  const last = results[results.length - 1];
  return json({ ok: true, commit: String(last?.meta.last_row_id ?? 0), touched: files.length });
}

async function revertCategories(
  db: D1Database,
  entryId: number,
  entryTitle: string,
  by: string,
  target: Category[] | null,
): Promise<Response> {
  if (!target || target.length === 0) {
    return json({ error: 'An diesem Eintrag gibt es nichts zurückzunehmen.' }, 400);
  }

  // Die Invariante «eine benutzte Kategorie-ID verschwindet nie» gilt auch
  // rückwärts: Würde die Wiederherstellung eine inzwischen benutzte ID
  // entfernen, wird abgelehnt statt Tipps zu verwaisen.
  const targetIds = new Set(target.map((category) => category.id));
  const missing = [...(await categoriesInUse(db))].filter((id) => !targetIds.has(id));
  if (missing.length > 0) {
    return json(
      {
        error:
          `Geht nicht: «${missing.join('», «')}» wird inzwischen von Tipps benutzt ` +
          'und würde beim Zurücknehmen verschwinden.',
      },
      400,
    );
  }
  if (!target.some((category) => category.active)) {
    return json({ error: 'Geht nicht: Es bliebe keine aktive Kategorie übrig.' }, 400);
  }

  const current = await getCategories(db);
  const results = await db.batch([
    db.prepare('DELETE FROM categories'),
    ...target.map((c, index) =>
      db
        .prepare(
          'INSERT INTO categories (id, label, emoji, color, active, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        )
        .bind(c.id, c.label, c.emoji, c.color, c.active ? 1 : 0, index),
    ),
    verlaufInsertStmt(db, {
      kind: 'rueckgaengig',
      title: `Rückgängig: ${entryTitle}`,
      by,
      reverts: entryId,
      before: current,
      after: target,
    }),
  ]);

  const healed = await resurrectUsedCategories(
    db,
    current.filter((category) => !target.some((t) => t.id === category.id)),
  );
  if (healed.length > 0) {
    console.warn(`Kategorien im Schreibfenster wieder eingefügt (inaktiv): ${healed.join(', ')}`);
  }

  const last = results[results.length - 1];
  return json({ ok: true, commit: String(last?.meta.last_row_id ?? 0), touched: 1 });
}
