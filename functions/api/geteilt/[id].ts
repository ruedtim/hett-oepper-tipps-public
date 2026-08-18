import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import { ID_MUSTER, listeDeleteStmt, raeumeAbgelaufeneListen } from '../../lib/geteilt';
import type { RequestData } from '../../lib/users';

/**
 * Einen Freigabelink widerrufen.
 *
 * Der Besitz steht in der WHERE-Klausel des DELETE und nicht in einem SELECT
 * davor — dieselbe Regel wie bei den Wünschen: So können Prüfen und Schreiben
 * nicht auseinanderfallen.
 *
 * «Gibt es nicht» und «gehört jemand anderem» bekommen bewusst dieselbe Antwort.
 * Unterschieden, wäre der Endpunkt ein Verzeichnis fremder Links: Wer IDs
 * durchprobiert, erführe, welche existieren.
 */
export const onRequestDelete: PagesFunction<Env, string, RequestData> = async ({
  env,
  data,
  params,
}) => {
  const db = env.DB as D1Database;

  const roh = params.id;
  const id = Array.isArray(roh) ? roh.join('/') : String(roh ?? '');
  if (!ID_MUSTER.test(id)) {
    return json({ error: 'Diesen Link gibt es nicht (mehr).' }, 404);
  }

  const ergebnis = await listeDeleteStmt(db, id, data.user.id).run();
  if (!ergebnis.meta.changes) {
    return json({ error: 'Diesen Link gibt es nicht (mehr).' }, 404);
  }

  await raeumeAbgelaufeneListen(db, heuteIso());

  return json({ ok: true });
};
