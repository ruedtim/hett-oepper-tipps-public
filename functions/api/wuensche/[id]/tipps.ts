import { heuteIso } from '../../../../shared/datum.mjs';
import { json } from '../../../lib/admin';
import { sendeWunschAntwortMails } from '../../../lib/benachrichtigung';
import type { Env } from '../../../lib/env';
import type { RequestData } from '../../../lib/users';
import { getWunsch, loeseVerknuepfungStmt, verknuepfeStmt } from '../../../lib/wuensche';

/**
 * Einen bestehenden Tipp einem Wunsch zuordnen — oder die Zuordnung lösen.
 *
 * Warum es das braucht: «Was wir schon haben» springt in den Ortsfilter, und
 * der vergleicht den Ortsschlüssel exakt. Ein Wunsch heisst aber oft «Thurgau»
 * oder «Dolomiten», während die Tipps in «Frauenfeld» und «Cortina» stehen —
 * eine Region lässt sich aus dem Ortsnamen nicht ableiten. Also von Hand.
 *
 * Erlaubt ist das JEDEM mit Konto, nicht nur der Autorin des Wunsches: Ein
 * Wunsch ist eine Frage an alle, und wer die Antwort kennt, soll sie zuordnen
 * dürfen. Dieselbe Haltung wie beim fehlenden Freigabeschritt.
 *
 * Ein Verlaufseintrag entsteht nicht — wie bei allem, was Wünsche betrifft
 * (siehe CLAUDE.md).
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async (context) => {
  const { request, env, params, data } = context;
  const db = env.DB as D1Database;

  const wunschId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!wunschId) return json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 400);

  const body = (await request.json().catch(() => ({}))) as {
    tipId?: unknown;
    verknuepft?: unknown;
  };

  const tipId = typeof body.tipId === 'string' ? body.tipId : '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tipId)) {
    return json({ error: 'Diesen Tipp gibt es nicht (mehr).' }, 400);
  }
  if (typeof body.verknuepft !== 'boolean') return json({ error: 'Nichts zu ändern.' }, 400);

  const wunsch = await getWunsch(db, wunschId);
  if (!wunsch) return json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 404);
  // Einem abgelaufenen Wunsch nichts mehr zuordnen: Er ist für alle unsichtbar,
  // und die Zuordnung wäre beim nächsten Aufräumen ohnehin wieder weg.
  if (wunsch.bis < heuteIso()) return json({ error: 'Dieser Wunsch ist abgelaufen.' }, 409);

  if (body.verknuepft) {
    const tipp = await db
      .prepare('SELECT name, place FROM tips WHERE id = ?1')
      .bind(tipId)
      .first<{ name: string; place: string }>();
    if (!tipp) return json({ error: 'Diesen Tipp gibt es nicht (mehr).' }, 404);
    await verknuepfeStmt(db, wunschId, tipId).run();

    // Nur beim Zuordnen, nie beim Lösen: «jemand hat etwas beigesteuert» ist
    // eine Neuigkeit, «jemand hat es wieder weggenommen» ist keine, die man per
    // Mail erfahren möchte. Wie überall über waitUntil — die Zuordnung steht,
    // ob die Nachricht rausgeht oder nicht.
    context.waitUntil(
      sendeWunschAntwortMails(env, {
        origin: new URL(request.url).origin,
        tipId,
        tipName: tipp.name,
        tipPlace: tipp.place,
        von: data.user.name,
        einreicherId: data.user.id,
        wuensche: [{ vonKey: wunsch.von_key, ort: wunsch.ort, land: wunsch.land }],
      }),
    );
  } else {
    await loeseVerknuepfungStmt(db, wunschId, tipId).run();
  }

  return json({ ok: true });
};
