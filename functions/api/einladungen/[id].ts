import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import { ID_MUSTER, widerrufStmt } from '../../lib/einladungen';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';

/**
 * Eine eigene, noch offene Einladung widerrufen.
 *
 * Besitz und Zustand stehen in der WHERE-Klausel des UPDATE — dieselbe Regel
 * wie beim Widerruf der Freigabelinks. «Gibt es nicht», «gehört jemand
 * anderem» und «schon eingelöst» bekommen bewusst dieselbe Antwort:
 * Unterschieden, wäre der Endpunkt ein Verzeichnis fremder Einladungen.
 *
 * Das Budget kommt dabei nicht zurück (Migration 0011): Die Zeile wird
 * markiert, nicht gelöscht.
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
    return json({ error: 'Diese Einladung gibt es nicht (mehr).' }, 404);
  }

  const ergebnis = await widerrufStmt(db, id, data.user.id, heuteIso()).run();
  if (!ergebnis.meta.changes) {
    return json({ error: 'Diese Einladung gibt es nicht (mehr).' }, 404);
  }

  return json({ ok: true });
};
