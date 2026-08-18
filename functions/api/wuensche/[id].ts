import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import { activeCategoryIds } from '../../lib/db';
import type { Env } from '../../lib/env';
import { ValidationError } from '../../lib/submission';
import type { RequestData } from '../../lib/users';
import {
  getWunsch,
  parseWunschFelder,
  raeumeAbgelaufeneWuensche,
  wunschAendernStmt,
  wunschDeleteStmts,
  wunschErfuelltStmt,
} from '../../lib/wuensche';
import type { WunschRow } from '../../lib/wuensche';

/**
 * Einen Wunsch als erfüllt markieren, wieder öffnen, bearbeiten oder löschen.
 *
 * Erlaubt ist das der Autorin und den Admins. Geprüft wird doppelt: Der SELECT
 * liefert die verständliche Meldung, die WHERE-Klausel im Statement die
 * Garantie — so können Prüfen und Schreiben nicht auseinanderfallen.
 *
 * Löschen ist hier endgültig: Wünsche stehen nicht im Verlauf, es gibt also
 * kein Zurück. Die Oberfläche sagt das vor dem zweiten Klick.
 */
export const onRequestPatch: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
  params,
}) => {
  const db = env.DB as D1Database;

  const geprueft = await pruefe(db, params, data);
  if ('fehler' in geprueft) return geprueft.fehler;

  const body = (await request.json().catch(() => ({}))) as { erfuellt?: unknown };

  // Zwei Handlungen an derselben Adresse, aber sauber getrennt: `erfuellt` ist
  // ein Schalter, alles andere ist der Inhalt. Beides zu mischen liesse offen,
  // was gilt, wenn jemand beides schickt.
  if (typeof body.erfuellt === 'boolean') {
    const heute = heuteIso();
    const result = await wunschErfuelltStmt(db, geprueft.wunsch.id, {
      am: body.erfuellt ? heute : null,
      von: body.erfuellt ? data.user.name : null,
      vonKeys: data.user.nameKeys,
      istAdmin: data.user.isAdmin,
    }).run();

    if (result.meta.changes === 0) {
      return json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 404);
    }
    return json({ ok: true });
  }

  // Bearbeiten. Ein abgelaufener Wunsch lässt sich nicht mehr anfassen — er ist
  // für alle unsichtbar und beim nächsten Aufräumen ohnehin weg; eine Frist
  // rückwirkend zu verlängern hiesse, ihn von den Toten zu holen.
  if (geprueft.wunsch.bis < heuteIso()) {
    return json({ error: 'Dieser Wunsch ist abgelaufen.' }, 409);
  }

  let felder;
  try {
    felder = parseWunschFelder(body, await activeCategoryIds(db));
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400);
    throw error;
  }

  const result = await wunschAendernStmt(db, geprueft.wunsch.id, felder, {
    vonKeys: data.user.nameKeys,
    istAdmin: data.user.isAdmin,
  }).run();

  if (result.meta.changes === 0) return json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 404);

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env, string, RequestData> = async ({
  env,
  data,
  params,
}) => {
  const db = env.DB as D1Database;

  const geprueft = await pruefe(db, params, data);
  if ('fehler' in geprueft) return geprueft.fehler;

  // Ein Batch: Zuordnungen und Wunsch fallen zusammen, ganz oder gar nicht.
  const ergebnisse = await db.batch(
    wunschDeleteStmts(db, geprueft.wunsch.id, {
      vonKeys: data.user.nameKeys,
      istAdmin: data.user.isAdmin,
    }),
  );

  // Der Wunsch selbst ist die letzte Anweisung — sie entscheidet.
  const letzte = ergebnisse[ergebnisse.length - 1];
  if ((letzte?.meta.changes ?? 0) === 0) {
    return json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 404);
  }

  // Der günstigste Moment fürs Aufräumen: Es wird ohnehin gerade geschrieben.
  await raeumeAbgelaufeneWuensche(db, heuteIso());

  return json({ ok: true });
};

/**
 * Gibt es den Wunsch, und darf diese Person daran? Liefert entweder die Zeile
 * oder die fertige Fehlerantwort.
 *
 * Verglichen wird über das Schlüssel-Set und nicht zeichengenau — derselbe
 * Schlüsselraum wie users.name_key und wie die Eigentumsprüfung an den
 * Beschreibungen in api/submit.ts.
 */
async function pruefe(
  db: D1Database,
  params: Record<string, string | string[]>,
  data: RequestData,
): Promise<{ wunsch: WunschRow } | { fehler: Response }> {
  const idRaw = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!idRaw) return { fehler: json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 400) };

  const wunsch = await getWunsch(db, idRaw);
  if (!wunsch) return { fehler: json({ error: 'Diesen Wunsch gibt es nicht (mehr).' }, 404) };

  // Gegen ALLE Schlüssel des Kontos, wie bei den Beschreibungen in
  // api/submit.ts: Nach einem Restore aus einem älteren Spiegel kann `von_key`
  // wieder auf einem früher getragenen Schlüssel stehen.
  const meins = data.user.nameKeys.includes(wunsch.von_key);
  if (!meins && !data.user.isAdmin) {
    return {
      fehler: json(
        { error: 'Ändern kann einen Wunsch nur, wer ihn angebracht hat — oder ein Admin.' },
        403,
      ),
    };
  }

  return { wunsch };
}
