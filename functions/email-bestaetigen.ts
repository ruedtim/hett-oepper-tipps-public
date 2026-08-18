/**
 * Die Seite hinter dem Link aus der Bestätigungsmail.
 *
 * Wie /passwort-neu eine eigenständige HTML-Seite vor dem Gate, aber nur GET und
 * ohne Formular: Der Klick IST die Handlung. Wer den Link im Postfach öffnet,
 * ist womöglich in einem anderen Browser als dem, in dem er angemeldet ist —
 * eine Sitzung zu verlangen hiesse, die halbe Runde auszusperren.
 *
 * Der Token ist an die Adresse gebunden. Zweimal geöffnet passiert schlicht
 * dasselbe nochmal; wurde die Adresse inzwischen geändert, passt er nicht mehr.
 * Angemeldet wird hier NICHT — anders als beim Passwort-Reset weist ein Klick im
 * Postfach niemanden als Kontoinhaber aus.
 */

import { configurationError, missingSecrets } from './lib/env';
import type { Env } from './lib/env';
import { htmlSeite } from './lib/htmlSeite';
import { passtZu, pruefeToken } from './lib/token';
import { getUserById } from './lib/users';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const token = new URL(request.url).searchParams.get('token');
  const gueltig = await pruefeToken(env.SESSION_SECRET as string, 'ev', token);
  if (!gueltig) return schiefgelaufen();

  const db = env.DB as D1Database;
  const user = await getUserById(db, gueltig.userId);
  if (!user || user.disabled === 1 || !user.email) return schiefgelaufen();
  if (!(await passtZu(gueltig.fp, user.email))) return schiefgelaufen();

  // Idempotent: Ein zweiter Klick setzt denselben Zustand nochmal. Der
  // Zeitstempel bleibt beim ersten Mal stehen, damit «seit wann bestätigt»
  // stimmt.
  await db
    .prepare(
      `UPDATE users SET email_verifiziert_am = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?1 AND email_verifiziert_am IS NULL`,
    )
    .bind(user.id)
    .run();

  return htmlSeite({
    titel: 'E-Mail bestätigt',
    inhalt: `    <h1>Passt, danke</h1>
    <p class="lead">
      Deine Adresse ist bestätigt. Du kannst dich jetzt auch damit anmelden, ein vergessenes
      Passwort selbst zurücksetzen und dich benachrichtigen lassen — was, entscheidest du unter
      «Konto».
    </p>
    <form method="get" action="/">
      <button type="submit">Zu den Tipps</button>
    </form>`,
  });
};

function schiefgelaufen(): Response {
  return htmlSeite({
    titel: 'Link gilt nicht mehr',
    status: 400,
    inhalt: `    <h1>Der Link gilt nicht mehr</h1>
    <p class="lead">
      Bestätigungslinks gelten einen Tag, und sie verfallen, sobald die Adresse geändert wird.
      Unter «Konto» lässt sich eine neue Bestätigung anfordern.
    </p>
    <form method="get" action="/">
      <button type="submit">Zur Anmeldung</button>
    </form>`,
  });
}
