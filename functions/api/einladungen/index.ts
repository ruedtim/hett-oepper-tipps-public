import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import {
  einladungInsertStmt,
  getEinladungenVon,
  getEinladungsStand,
  gueltigBis,
  neueListenId,
} from '../../lib/einladungen';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';

/**
 * Eigene Einladungslinks erzeugen und auflisten (#64).
 *
 * Das Budget («drei insgesamt») steht IM INSERT, nicht in einem Check davor —
 * `meta.changes === 0` heisst aufgebraucht. Kein Aufräumen wie bei den
 * geteilten Listen: Die Zeilen sind der Zähler gegen das Budget und das
 * Herkunfts-Gedächtnis der Admins, sie bleiben (Migration 0011).
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

  const heute = heuteIso();
  const id = neueListenId();
  const bis = gueltigBis(heute);

  const ergebnis = await einladungInsertStmt(db, {
    id,
    vonId: data.user.id,
    erstellt: heute,
    bis,
  }).run();

  if (!ergebnis.meta.changes) {
    return json(
      { error: 'Alle Einladungen sind aufgebraucht — bestell unten neue bei den Admins.' },
      409,
    );
  }

  return json({
    ok: true,
    id,
    // Aus der Anfrage und nicht aus einer Konstanten: So stimmt der Link lokal,
    // im Preview und in der Produktion, ohne dass jemand daran denken muss.
    url: `${new URL(request.url).origin}/einladung?token=${id}`,
    bis,
  });
};

/** Alle eigenen Einladungen samt Stand — für die Übersicht auf der Konto-Seite. */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  // Ein Gast hat keine Einladungen und bekommt eine leere Liste statt eines
  // Fehlers — dieselbe Begründung wie bei den geteilten Listen.
  if (data.user.isGuest) return json({ einladungen: [], verbleibend: 0, bestellt: false });

  const db = env.DB as D1Database;
  const herkunft = new URL(request.url).origin;
  const [einladungen, stand] = await Promise.all([
    getEinladungenVon(db, data.user.id),
    getEinladungsStand(db, data.user.id),
  ]);

  return json({
    einladungen: einladungen.map((einladung) => ({
      id: einladung.id,
      url: `${herkunft}/einladung?token=${einladung.id}`,
      erstellt: einladung.erstellt,
      bis: einladung.bis,
      status: einladung.status,
      eingeloestVon: einladung.eingeloestVon,
      eingeloestAm: einladung.eingeloestAm,
    })),
    verbleibend: stand.verbleibend,
    bestellt: stand.bestelltAm != null,
  });
};
