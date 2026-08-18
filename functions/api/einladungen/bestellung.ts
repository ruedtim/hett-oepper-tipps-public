import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';

/**
 * «Mehr Einladungen bestellen» — ein Klick, wenn das Budget aufgebraucht ist.
 *
 * Die Bestellung ist eine Markierung an der Kontozeile
 * (`einladungen_bestellt_am`), keine Nachricht: Admins sehen sie in der
 * Kontenverwaltung hervorgehoben und geben dort mit «+3» nach, was die
 * Markierung wieder leert. Die Bedingungen stehen IM Statement: nur bei
 * aufgebrauchtem Budget (sonst gibt es nichts zu bestellen) und nur, wenn
 * nicht schon eine Bestellung offen ist. Ein zweiter Klick antwortet darum
 * freundlich statt doppelt zu bestellen.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  const db = env.DB as D1Database;

  if (data.user.isGuest) {
    return json({ error: 'Der Gäste-Zugang darf nur schauen.' }, 403);
  }

  const ergebnis = await db
    .prepare(
      `UPDATE users SET einladungen_bestellt_am = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?1 AND einladungen_bestellt_am IS NULL
         AND (SELECT COUNT(*) FROM einladungen WHERE von_id = ?1) >= einladungs_budget`,
    )
    .bind(data.user.id)
    .run();

  // `changes === 0` heisst: schon bestellt oder noch Budget übrig. Beides ist
  // kein Fehler — die Antwort sagt einfach, wo die Bestellung steht.
  return json({ ok: true, bestellt: true, neu: ergebnis.meta.changes === 1 });
};
