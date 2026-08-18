/**
 * Die eigene E-Mail-Adresse setzen, erneut bestätigen lassen oder entfernen.
 *
 * Freiwillig, und sie zählt erst, wenn der Link in der Bestätigungsmail geklickt
 * wurde (`email_verifiziert_am`). Vorher ist sie nichts als ein Eintrag: kein
 * Anmeldename, kein Reset-Weg, keine Benachrichtigung. Ein Tippfehler schickt
 * sonst Reset-Links an Fremde, und wer eine fremde Adresse einträgt, bekäme Post
 * über die Runde.
 *
 * Ohne Mail-Dienst geht das gar nicht erst: Eine Adresse zu speichern, die
 * niemand bestätigen kann, hilft niemandem. Deshalb 503 statt stiller Annahme —
 * dasselbe Muster wie bei den GitHub-Endpunkten.
 *
 * Der Gast kommt hier nicht an: Für ihn endet jede Methode ausser GET und HEAD
 * schon im Gate.
 */

import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import { mailKonfiguriert, normalisiereEmail, sendeMail, zuFrueh } from '../../lib/mail';
import { erzeugeToken, VERIFIKATION_GUELTIG_SEK } from '../../lib/token';
import { getUserById } from '../../lib/users';
import type { RequestData } from '../../lib/users';

/** Eine Bestätigungsmail pro Konto und fünf Minuten. */
const DECKEL_MINUTEN = 5;

export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  const db = env.DB as D1Database;

  if (!mailKonfiguriert(env)) {
    return json(
      { error: 'Diese Seite kann gerade keine E-Mails verschicken — bitte später nochmal.' },
      503,
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    benachrichtigungWuensche?: unknown;
  };
  const eingabe = typeof body.email === 'string' ? body.email : '';
  const wuensche = typeof body.benachrichtigungWuensche === 'boolean' ? body.benachrichtigungWuensche : null;

  const email = normalisiereEmail(eingabe);
  if (!email) return json({ error: 'Das sieht nicht nach einer E-Mail-Adresse aus.' }, 400);

  const user = await getUserById(db, data.user.id);
  if (!user) return json({ error: 'Dieses Konto gibt es nicht (mehr).' }, 403);

  const unveraendert = user.email === email;
  const schonBestaetigt = unveraendert && Boolean(user.email_verifiziert_am);

  // Dieselbe Adresse, schon bestätigt: nichts anfassen, keine Mail. Nur das
  // Kreuzchen aus dem Erstanmelde-Formular darf trotzdem durch.
  if (schonBestaetigt) {
    if (wuensche !== null) await setzeWunschSchalter(db, user.id, wuensche);
    return json({ ok: true, email, verifiziert: true, hinweis: 'Diese Adresse ist schon bestätigt.' });
  }

  if (zuFrueh(user.verifikation_gesendet_am, DECKEL_MINUTEN)) {
    return json(
      {
        error: `Eben ist schon eine Bestätigungsmail rausgegangen. Bitte ein paar Minuten warten — und im Spam-Ordner nachsehen.`,
      },
      429,
    );
  }

  try {
    await db
      .prepare(
        `UPDATE users SET email = ?2, email_verifiziert_am = NULL,
         verifikation_gesendet_am = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         ${wuensche !== null ? ', benachrichtigung_wuensche = ?3' : ''}
         WHERE id = ?1`,
      )
      .bind(user.id, email, ...(wuensche !== null ? [wuensche ? 1 : 0] : []))
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Diese Adresse ist schon bei einem anderen Konto eingetragen.' }, 409);
    }
    throw error;
  }

  // Gespeichert ist gespeichert: Scheitert erst der Versand, ist das kein
  // Fehlschlag der Handlung, sondern ein Hinweis — die Konto-Seite bietet
  // «nochmal senden» an.
  try {
    const url = new URL(request.url);
    const token = await erzeugeToken(
      env.SESSION_SECRET as string,
      'ev',
      user.id,
      email,
      VERIFIKATION_GUELTIG_SEK,
    );
    await sendeMail(env, {
      an: email,
      betreff: 'Bitte bestätigen: E-Mail für «Hett öpper Tipps?»',
      text:
        `Hallo ${user.name}\n\n` +
        'Diese Adresse wurde beim Konto hinterlegt. Ein Klick, und sie gilt:\n\n' +
        `${url.origin}/email-bestaetigen?token=${encodeURIComponent(token)}\n\n` +
        'Der Link gilt einen Tag. Danach kannst du dich auch mit der Adresse anmelden, ' +
        'ein vergessenes Passwort selbst zurücksetzen und dich über neue Wünsche ' +
        'benachrichtigen lassen.\n\n' +
        'Hast du damit nichts zu tun, ignorier diese Nachricht einfach — ohne Klick ' +
        'passiert nichts.\n',
    });
  } catch (error) {
    console.error('Bestätigungsmail konnte nicht verschickt werden:', error);
    return json({
      ok: true,
      email,
      verifiziert: false,
      hinweis: 'Gespeichert — die Bestätigungsmail kam aber nicht raus. Bitte gleich nochmal senden.',
    });
  }

  return json({
    ok: true,
    email,
    verifiziert: false,
    hinweis: 'Bestätigungsmail unterwegs — schau auch im Spam-Ordner nach.',
  });
};

/** Adresse entfernen. Benachrichtigungen laufen damit automatisch leer. */
export const onRequestDelete: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  await (env.DB as D1Database)
    .prepare(
      `UPDATE users SET email = NULL, email_verifiziert_am = NULL,
       verifikation_gesendet_am = NULL WHERE id = ?1`,
    )
    .bind(data.user.id)
    .run();
  return json({ ok: true });
};

function setzeWunschSchalter(db: D1Database, id: number, an: boolean): Promise<unknown> {
  return db
    .prepare('UPDATE users SET benachrichtigung_wuensche = ?2 WHERE id = ?1')
    .bind(id, an ? 1 : 0)
    .run();
}
