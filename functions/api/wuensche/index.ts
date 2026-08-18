import { heuteIso } from '../../../shared/datum.mjs';
import { json } from '../../lib/admin';
import { sendeWunschMails } from '../../lib/benachrichtigung';
import { activeCategoryIds } from '../../lib/db';
import type { Env } from '../../lib/env';
import { uniqueViolation, ValidationError } from '../../lib/submission';
import type { RequestData } from '../../lib/users';
import {
  findWunschByVorgang,
  parseWunsch,
  raeumeAbgelaufeneWuensche,
  wunschInsertStmt,
} from '../../lib/wuensche';

/**
 * Einen Wunsch anbringen: «zu diesem Ort suche ich Tipps, bis zu diesem Tag».
 *
 * Anders als /api/submit entsteht hier KEIN Verlaufseintrag — die Begründung
 * steht in CLAUDE.md. Der Idempotenzschlüssel hängt darum an wuensche.vorgang;
 * das Muster bleibt dasselbe wie dort: vorher nachschauen, beim Schreiben das
 * Rennen abfangen.
 *
 * Es gibt keinen Freigabeschritt. Wer ein Konto hat, schreibt direkt.
 *
 * Am Ende gehen Benachrichtigungen raus — an alle, die sie eingeschaltet und
 * ihre Adresse bestätigt haben, ausser an die Autorin selbst. Über
 * `context.waitUntil`, also NACH der Antwort: Der Wunsch ist angebracht, ob
 * Resend nun mag oder nicht. Die beiden «schon da»-Ausgänge oben liegen davor
 * und mailen deshalb nie — ein wiederholt gesendetes Formular soll die Runde
 * nicht zweimal anschreiben.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async (context) => {
  const { request, env, data } = context;
  const db = env.DB as D1Database;

  try {
    const aktiv = await activeCategoryIds(db);
    const eingabe = parseWunsch(await request.json().catch(() => null), aktiv);

    // Bricht die Verbindung ab, nachdem gespeichert wurde, schickt das Formular
    // denselben Vorgang nochmal. Der UNIQUE-Index erkennt das — dauerhaft,
    // solange der Wunsch lebt.
    const schonDa = await findWunschByVorgang(db, eingabe.vorgang);
    if (schonDa) return json({ ok: true, id: null, repeated: true });

    const heute = heuteIso();
    const id = crypto.randomUUID();

    try {
      await wunschInsertStmt(db, eingabe, { id, von: data.user.name, heute }).run();
    } catch (error) {
      // Zwei gleichzeitige Sendungen desselben Vorgangs: Der Verlierer bekommt
      // die UNIQUE-Verletzung und antwortet «schon da».
      if (uniqueViolation(error) === 'wuensche.vorgang') {
        const bereits = await findWunschByVorgang(db, eingabe.vorgang);
        if (bereits) return json({ ok: true, id: null, repeated: true });
      }
      throw error;
    }

    // Nach dem Schreiben, nicht davor: Ein gescheitertes Aufräumen darf den
    // gerade angebrachten Wunsch nicht gefährden.
    await raeumeAbgelaufeneWuensche(db, heute);

    context.waitUntil(
      sendeWunschMails(env, {
        origin: new URL(request.url).origin,
        wunsch: { ...eingabe, von: data.user.name },
        autorId: data.user.id,
      }),
    );

    return json({ ok: true, id, repeated: false });
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400);
    console.error('Unerwarteter Fehler beim Anbringen eines Wunsches:', error);
    return json({ error: 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.' }, 500);
  }
};
