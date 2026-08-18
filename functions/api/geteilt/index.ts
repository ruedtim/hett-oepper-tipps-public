import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import {
  getListenVon,
  gueltigBis,
  listeInsertStmt,
  MAX_TIPPS,
  neueListenId,
  raeumeAbgelaufeneListen,
} from '../../lib/geteilt';
import type { RequestData } from '../../lib/users';

/**
 * Eine Tipp-Liste teilen und die eigenen Freigabelinks verwalten.
 *
 * Geteilt wird die RESULTATMENGE eines Moments — das Frontend schickt die IDs
 * dessen, was gerade in der Liste steht. Ausdrücklich nicht der Filter: Der
 * wäre ein Abonnement auf alles, was künftig dazupasst, verschickt wurde aber
 * «das hier». Die längere Begründung steht in der Migration 0010.
 *
 * Kein Idempotenzschlüssel, anders als bei Wünschen und Einreichungen: Es gibt
 * keinen Formular-Entwurf, aus dem einer käme, ein zweiter Klick ist eine
 * zweite Absicht, und beide Links sind einzeln widerrufbar und laufen von selbst
 * ab. Ein doppelter Link kostet eine Zeile, kein Durcheinander.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  const db = env.DB as D1Database;

  // Das Gate beendet für einen Gast schon jede Methode ausser GET und HEAD.
  // Hier steht es trotzdem, weil dieser Endpunkt sonst als einziger nicht
  // sagen könnte, warum er nichts tut.
  if (data.user.isGuest) {
    return json({ error: 'Der Gäste-Zugang darf nur schauen.' }, 403);
  }

  const body = (await request.json().catch(() => ({}))) as { tippIds?: unknown };
  const roh = Array.isArray(body.tippIds) ? body.tippIds : [];
  // Doppelte fallen raus, die Reihenfolge bleibt: Sie ist die Sortierung, die
  // die teilende Person gerade vor sich hatte.
  const tippIds = [...new Set(roh.filter((wert): wert is string => typeof wert === 'string'))];

  if (tippIds.length === 0) {
    return json({ error: 'Eine leere Liste ergibt keinen Link.' }, 400);
  }
  if (tippIds.length > MAX_TIPPS) {
    return json(
      { error: `Das sind zu viele auf einmal (höchstens ${MAX_TIPPS}) — filter noch etwas.` },
      400,
    );
  }

  // Nur IDs, die es wirklich gibt. Unbekannte fallen still weg statt den ganzen
  // Vorgang abzuweisen: Der Browser könnte einen Tipp anzeigen, den jemand
  // anderes eine Sekunde vorher gelöscht hat, und daran soll das Teilen nicht
  // scheitern.
  const platzhalter = tippIds.map((_, index) => `?${index + 1}`).join(', ');
  const vorhanden = await db
    .prepare(`SELECT id FROM tips WHERE id IN (${platzhalter})`)
    .bind(...tippIds)
    .all<{ id: string }>();
  const echt = new Set(vorhanden.results.map((zeile) => zeile.id));
  const gefiltert = tippIds.filter((id) => echt.has(id));

  if (gefiltert.length === 0) {
    return json({ error: 'Diese Tipps gibt es nicht mehr.' }, 400);
  }

  const heute = heuteIso();
  const id = neueListenId();
  const bis = gueltigBis(heute);

  await listeInsertStmt(db, { id, vonId: data.user.id, tippIds: gefiltert, erstellt: heute, bis }).run();

  // Hygiene nach dem Schreiben, in try/catch — Pages kennt keinen Cron.
  await raeumeAbgelaufeneListen(db, heute);

  return json({
    ok: true,
    id,
    // Aus der Anfrage und nicht aus einer Konstanten: So stimmt der Link lokal,
    // im Preview und in der Produktion, ohne dass jemand daran denken muss.
    url: `${new URL(request.url).origin}/geteilt/${id}`,
    bis,
    anzahl: gefiltert.length,
  });
};

/** Die eigenen, noch gültigen Links — für die Übersicht auf der Konto-Seite. */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  // Ein Gast hat keine eigenen Links und bekommt darum eine leere Liste statt
  // eines Fehlers: Die Konto-Seite fragt hier ungefragt an, und ein 403 wäre
  // dort eine rote Meldung ohne Anlass.
  if (data.user.isGuest) return json({ listen: [] });

  const db = env.DB as D1Database;
  const herkunft = new URL(request.url).origin;
  const listen = await getListenVon(db, data.user.id, heuteIso());

  return json({
    listen: listen.map((liste) => ({
      id: liste.id,
      url: `${herkunft}/geteilt/${liste.id}`,
      erstellt: liste.erstellt,
      bis: liste.bis,
      anzahl: liste.tippIds.length,
    })),
  });
};
