/**
 * Die Seite hinter dem Link aus der Reset-Mail.
 *
 * Kein `/api/`-Pfad, weil sie für Menschen ist: eine eigenständige HTML-Seite
 * mit einem echten `<form method="post">` und ganz OHNE JavaScript — wer sein
 * Passwort vergessen hat, sitzt womöglich gerade an einem fremden oder sparsam
 * eingerichteten Browser. Aussehen und Hülle kommen aus lib/htmlSeite.ts,
 * dasselbe Stylesheet wie der Anmeldebildschirm.
 *
 * Sie liegt VOR dem Gate (Ausnahme in functions/_middleware.ts, exakter Pfad und
 * exakt GET|POST) — hätte sie eine Sitzung nötig, wäre sie nutzlos. Der Token
 * IST die Berechtigung: signiert, eine Stunde gültig und an den aktuellen
 * Passwort-Hash gebunden. Damit ist er einmalig — das erfolgreiche Setzen
 * erzeugt ein frisches Salt, und derselbe Link passt danach zu nichts mehr.
 *
 * Der 303 am Ende führt in die App: Die Antwort setzt schon ein frisches
 * Sitzungs-Cookie, man ist also angemeldet. Alle anderen Geräte fliegen dabei
 * raus, und genau das will man, wenn man sein Passwort zurücksetzt.
 */

import { configurationError, missingSecrets } from './lib/env';
import type { Env } from './lib/env';
import { escapeHtml, htmlSeite } from './lib/htmlSeite';
import { createSessionValue, SESSION_COOKIE, sessionCookieHeader } from './lib/session';
import { passtZu, pruefeToken } from './lib/token';
import {
  getUserById,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './lib/users';
import type { UserRow } from './lib/users';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const token = new URL(request.url).searchParams.get('token') ?? '';
  // Schon beim Öffnen VOLL prüfen, Kontozeile inklusive. Anders als das Gate,
  // das bei jedem Request die Signatur vorschaltet, um den D1-Read zu sparen:
  // Hier kommt niemand mit gefälschtem Token bis zur Datenbank — die Signatur
  // steckt in `pruefeToken` und scheitert vorher. Wer bis hierher kommt, hat
  // einen Token, den WIR ausgestellt haben, und ausgestellt wird nur über den
  // ratenbegrenzten Weg. Die halbe Prüfung spart also nichts und kostet
  // Zumutung: Ein längst benutzter Link zeigte sonst brav ein Formular und
  // sagte erst nach dem Ausfüllen, dass er tot ist.
  const konto = await ladeKonto(env, token);
  if (!konto.ok) return konto.antwort;

  return formular(token);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const db = env.DB as D1Database;
  const secret = env.SESSION_SECRET as string;

  // Nur Formulardaten: Diese Seite hat kein JavaScript, das JSON schicken würde.
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('token') ?? '');
  const neu = String(form?.get('neu') ?? '');
  const wiederholung = String(form?.get('wiederholung') ?? '');

  const konto = await ladeKonto(env, token);
  if (!konto.ok) return konto.antwort;
  const user = konto.user;

  if (neu !== wiederholung) return formular(token, 'Die beiden Eingaben stimmen nicht überein.');
  if (neu.length < MIN_PASSWORD_LENGTH) {
    return formular(token, `Das neue Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  }
  if (neu.length > MAX_PASSWORD_LENGTH) return formular(token, 'Das neue Passwort ist zu lang.');

  const hash = await hashPassword(neu);
  await db
    .prepare(
      `UPDATE users SET password_hash = ?1, must_change_password = 0,
       password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?2`,
    )
    .bind(hash, user.id)
    .run();

  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: '/' });
  headers.append(
    'Set-Cookie',
    sessionCookieHeader(SESSION_COOKIE, await createSessionValue(secret, user.id, hash), secure),
  );
  return new Response(null, { status: 303, headers });
};

/**
 * Token prüfen und das Konto dazu holen — für GET und POST dasselbe, damit die
 * beiden Wege nicht unterschiedlich streng werden können.
 *
 * Abgelaufen, gefälscht, deaktiviert, Gast, Link schon benutzt: alles derselbe
 * Ausgang. Was aus dem Konto geworden ist, geht den Aufrufer nichts an — und
 * «schon benutzt» ist ohnehin nicht von «abgelaufen» zu unterscheiden, weil der
 * Fingerabdruck in beiden Fällen einfach nicht mehr passt.
 */
async function ladeKonto(
  env: Env,
  token: string,
): Promise<{ ok: true; user: UserRow } | { ok: false; antwort: Response }> {
  const gueltig = await pruefeToken(env.SESSION_SECRET as string, 'pr', token);
  if (!gueltig) return { ok: false, antwort: abgelaufen() };

  let user: UserRow | null;
  try {
    user = await getUserById(env.DB as D1Database, gueltig.userId);
  } catch (error) {
    console.error('D1 beim Passwort-Reset nicht erreichbar:', error);
    return {
      ok: false,
      antwort: formular(token, 'Die Datenbank ist gerade nicht erreichbar. Bitte gleich nochmal.'),
    };
  }

  if (
    !user ||
    user.disabled === 1 ||
    user.is_guest === 1 ||
    !(await passtZu(gueltig.fp, user.password_hash))
  ) {
    return { ok: false, antwort: abgelaufen() };
  }

  return { ok: true, user };
}

function formular(token: string, fehler?: string): Response {
  return htmlSeite({
    titel: 'Neues Passwort',
    status: fehler ? 400 : 200,
    inhalt: `    <h1>Neues Passwort</h1>
    <p class="lead">Gleich geschafft — wähl ein Passwort mit mindestens ${MIN_PASSWORD_LENGTH} Zeichen.</p>
    <form method="post" action="/passwort-neu">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <input
        type="password" name="neu" required minlength="${MIN_PASSWORD_LENGTH}" autofocus
        autocomplete="new-password" placeholder="Neues Passwort"
        aria-label="Neues Passwort">
      <input
        type="password" name="wiederholung" required minlength="${MIN_PASSWORD_LENGTH}"
        autocomplete="new-password" placeholder="Neues Passwort, nochmal"
        aria-label="Neues Passwort wiederholen">
      <button type="submit">Passwort setzen</button>
      ${fehler ? `<p class="error" role="alert">${escapeHtml(fehler)}</p>` : ''}
      <p class="hint">
        Danach bist du hier angemeldet. Auf allen anderen Geräten heisst es einmal neu anmelden.
      </p>
    </form>`,
  });
}

/** Ein Ausgang für alles, was nicht (mehr) gilt — abgelaufen, benutzt, gefälscht. */
function abgelaufen(): Response {
  return htmlSeite({
    titel: 'Link abgelaufen',
    status: 400,
    inhalt: `    <h1>Der Link gilt nicht mehr</h1>
    <p class="lead">
      Reset-Links gelten eine Stunde und nur ein einziges Mal. Wenn du inzwischen schon ein neues
      Passwort gesetzt hast, ist alles in Ordnung — melde dich einfach damit an.
    </p>
    <form method="get" action="/">
      <button type="submit">Zur Anmeldung</button>
    </form>`,
  });
}
