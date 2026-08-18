import { json, requireAdmin } from '../../lib/admin';
import { categoriesInUse, getCategories, resurrectUsedCategories } from '../../lib/db';
import type { Category } from '../../lib/db';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';
import { verlaufInsertStmt } from '../../lib/verlauf';

/**
 * Kategorien ändern.
 *
 * Die harte Regel steckt hier drin und nicht bloss in der Oberfläche: Eine
 * einmal vergebene ID verschwindet nie. Würde sie gelöscht, verwiesen alle
 * Tipps, die sie noch nennen, ins Leere — sie fielen aus jedem Filter, und das
 * Backup bräche bei der Validierung ab. Deaktivieren nimmt sie aus Filter und
 * Formular, lässt sie auf bestehenden Tipps aber stehen.
 *
 * Neu gegenüber der Git-Zeit: Die Änderung steht als Verlaufseintrag mit
 * Snapshot da — Kategorien-Änderungen sind damit erstmals rückgängig machbar.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ request, env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;

  const body = (await request.json().catch(() => null)) as { categories?: unknown } | null;
  if (!Array.isArray(body?.categories)) return json({ error: 'Keine Kategorien übergeben.' }, 400);

  const current = await getCategories(db);
  const inUse = await categoriesInUse(db);
  const validated = validate(body.categories, current, inUse);
  if (typeof validated === 'string') return json({ error: validated }, 400);

  if (JSON.stringify(validated) === JSON.stringify(current)) {
    return json({ ok: true, unchanged: true });
  }

  await db.batch([
    db.prepare('DELETE FROM categories'),
    ...validated.map((c, index) =>
      db
        .prepare(
          'INSERT INTO categories (id, label, emoji, color, active, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        )
        .bind(c.id, c.label, c.emoji, c.color, c.active ? 1 : 0, index),
    ),
    verlaufInsertStmt(db, {
      kind: 'kategorien',
      title: 'Kategorien angepasst',
      by: data.user.name,
      before: current,
      after: validated,
    }),
  ]);

  const healed = await resurrectUsedCategories(
    db,
    current.filter((category) => !validated.some((v) => v.id === category.id)),
  );
  if (healed.length > 0) {
    console.warn(`Kategorien im Schreibfenster wieder eingefügt (inaktiv): ${healed.join(', ')}`);
  }

  return json({ ok: true, unchanged: false });
};

function validate(input: unknown[], current: Category[], inUse: Set<string>): Category[] | string {
  if (input.length === 0) return 'Es muss mindestens eine Kategorie geben.';
  if (input.length > 20) return 'Höchstens zwanzig Kategorien.';

  const result: Category[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return 'Eine Kategorie hat das falsche Format.';
    const entry = raw as Record<string, unknown>;

    const id = String(entry.id ?? '');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      return `«${id}» ist keine gültige ID — nur Kleinbuchstaben, Ziffern und Bindestriche.`;
    }
    if (seen.has(id)) return `Die ID «${id}» kommt doppelt vor.`;
    seen.add(id);

    const label = String(entry.label ?? '').trim();
    if (!label || label.length > 30) return `Der Name von «${id}» fehlt oder ist zu lang.`;

    const emoji = String(entry.emoji ?? '').trim();
    if (!emoji || emoji.length > 8) return `Das Emoji von «${label}» fehlt.`;

    const color = String(entry.color ?? '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) return `Die Farbe von «${label}» ist keine Hex-Farbe.`;

    result.push({ id, label, emoji, color, active: entry.active !== false });
  }

  // Der eigentliche Schutz: Eine ID, auf die Tipps oder Wünsche verweisen, darf
  // nicht verschwinden. Eine Kategorie, die niemand benutzt (typischerweise
  // gerade vertippt angelegt), darf dagegen weg.
  const stillReferenced = current.filter(
    (category) => !seen.has(category.id) && inUse.has(category.id),
  );
  if (stillReferenced.length > 0) {
    const names = stillReferenced.map((c) => c.label).join('», «');
    return `«${names}» wird noch benutzt und kann nicht gelöscht werden. Stattdessen deaktivieren.`;
  }

  if (!result.some((category) => category.active)) {
    return 'Mindestens eine Kategorie muss aktiv bleiben, sonst lässt sich nichts mehr einreichen.';
  }

  return result;
}
