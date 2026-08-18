/**
 * «Passwort vergessen» — der zweite Weg vor dem Gate, nach der Zugangsbitte.
 *
 * Wie dort gilt: Wer hier ankommt, hat per Definition keine Sitzung, also
 * schützt sich der Endpunkt selbst. Der Deckel sitzt an der Kontozeile
 * (`reset_angefordert_am`, ein Versand alle 15 Minuten) und begrenzt damit
 * nicht die Versuche, sondern den Schaden: Niemand kann ein fremdes Postfach
 * über diese Seite zumüllen.
 *
 * Die Antwort ist IMMER dieselbe, egal ob es das Konto gibt, ob es eine Adresse
 * hat, ob sie bestätigt ist und ob der Deckel gerade zu ist. Sonst wäre dieser
 * Endpunkt ein Verzeichnis der Runde — vor dem Gate, für jeden abfragbar.
 *
 * Auch das Timing verrät nichts: Gesucht und gesendet wird erst NACH der
 * Antwort, in `waitUntil`. Ein Versand dauert messbar länger als ein «Konto
 * unbekannt», und dieser Unterschied wäre so gut wie eine Auskunft.
 */

import { configurationError, missingSecrets } from '../lib/env';
import type { Env } from '../lib/env';
import { loginPage } from '../lib/loginPage';
import { mailKonfiguriert, normalisiereEmail, sendeMail, zuFrueh } from '../lib/mail';
import { erzeugeToken, RESET_GUELTIG_SEK } from '../lib/token';
import { getUserByEmail, getUserByNameKey } from '../lib/users';
import type { UserRow } from '../lib/users';
import { searchKey } from '../../shared/normalize.mjs';

/** Ein Reset-Versand pro Konto und Viertelstunde. */
const DECKEL_MINUTEN = 15;

const NEUTRAL =
  'Wenn es dazu ein Konto mit bestätigter E-Mail gibt, ist eine Nachricht unterwegs. ' +
  'Schau auch im Spam-Ordner nach.';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const contentType = request.headers.get('Content-Type') ?? '';
  const isForm = contentType.includes('form');

  let eingabe = '';
  if (isForm) {
    const form = await request.formData();
    eingabe = String(form.get('eingabe') ?? '');
  } else {
    const body = (await request.json().catch(() => ({}))) as { eingabe?: unknown };
    eingabe = typeof body.eingabe === 'string' ? body.eingabe : '';
  }
  eingabe = eingabe.trim();

  // Der einzige Fall, der ehrlich antworten darf: Er verrät nur, wie die Seite
  // eingerichtet ist, und kein einziges Konto.
  if (!mailKonfiguriert(env)) {
    return antwort(
      isForm,
      503,
      'Diese Seite kann gerade keine E-Mails verschicken. Bitte in der Runde nachfragen.',
      true,
    );
  }

  if (!eingabe) return antwort(isForm, 400, 'Bitte Name oder E-Mail angeben.', true);

  const url = new URL(request.url);
  context.waitUntil(versende(env, url.origin, eingabe));

  return antwort(isForm, 200, NEUTRAL, false);
};

/**
 * Läuft nach der Antwort. Jeder Ausgang ist ein stilles `return` — es gibt
 * niemanden mehr, dem man etwas sagen könnte, und im Log stünde sonst, welche
 * Adressen es gibt.
 */
async function versende(env: Env, origin: string, eingabe: string): Promise<void> {
  try {
    const db = env.DB as D1Database;
    const secret = env.SESSION_SECRET as string;

    let user: UserRow | null;
    if (eingabe.includes('@')) {
      const email = normalisiereEmail(eingabe);
      user = email ? await getUserByEmail(db, email) : null;
    } else {
      user = await getUserByNameKey(db, searchKey(eingabe));
    }

    if (!user || user.disabled === 1 || user.is_guest === 1) return;
    if (!user.email || !user.email_verifiziert_am) return;

    if (zuFrueh(user.reset_angefordert_am, DECKEL_MINUTEN)) return;

    // Zeitstempel VOR dem Versand: Bleibt der Dienst hängen, hat der Deckel
    // trotzdem gegriffen. Eine Mail zu wenig ist besser als hundert zu viel.
    await db
      .prepare(
        `UPDATE users SET reset_angefordert_am = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?1`,
      )
      .bind(user.id)
      .run();

    const token = await erzeugeToken(
      secret,
      'pr',
      user.id,
      user.password_hash,
      RESET_GUELTIG_SEK,
    );

    await sendeMail(env, {
      an: user.email,
      betreff: 'Neues Passwort für «Hett öpper Tipps?»',
      text:
        `Hallo ${user.name}\n\n` +
        'Jemand — hoffentlich du — möchte das Passwort zurücksetzen. Über diesen Link ' +
        'kannst du ein neues setzen:\n\n' +
        `${origin}/passwort-neu?token=${encodeURIComponent(token)}\n\n` +
        'Der Link gilt eine Stunde und nur ein einziges Mal.\n\n' +
        'Warst du das nicht, kannst du diese Nachricht ignorieren: Solange der Link ' +
        'ungenutzt bleibt, ändert sich nichts.\n',
    });
  } catch (error) {
    console.error('Passwort-Reset konnte nicht verschickt werden:', error);
  }
}

/**
 * Ohne JavaScript ist die neu gerenderte Seite die einzige Rückmeldung — und
 * sie muss im richtigen der vier Abschnitte stehen, sonst stünde «Nachricht
 * unterwegs» unter dem Anmeldeformular.
 */
function antwort(isForm: boolean, status: number, text: string, istFehler: boolean): Response {
  if (isForm) {
    return loginPage({
      ...(istFehler ? { error: text } : { notice: text }),
      status,
      bereich: 'vergessen',
    });
  }
  return Response.json(
    istFehler ? { error: text } : { ok: true, hinweis: text },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
