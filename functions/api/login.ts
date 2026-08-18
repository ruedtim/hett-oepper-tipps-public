import { searchKey } from '../../shared/normalize.mjs';
import { configurationError, missingSecrets } from '../lib/env';
import type { Env } from '../lib/env';
import { loginPage } from '../lib/loginPage';
import {
  clearCookieHeader,
  createSessionValue,
  SESSION_COOKIE,
  sessionCookieHeader,
} from '../lib/session';
import { normalisiereEmail } from '../lib/mail';
import {
  DUMMY_HASH,
  getGuestUser,
  getUserByEmail,
  getUserByNameKey,
  verifyPassword,
} from '../lib/users';
import type { UserRow } from '../lib/users';

/** Bremst Rateversuche aus. Kostet keine CPU-Zeit, nur Wartezeit. */
const WRONG_PASSWORD_DELAY_MS = 500;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const secret = env.SESSION_SECRET as string;
  const db = env.DB as D1Database;
  const secure = new URL(request.url).protocol === 'https:';

  // Ohne JavaScript kommt ein normales Formular an, mit JavaScript JSON.
  const contentType = request.headers.get('Content-Type') ?? '';
  const isForm = contentType.includes('form');

  let name = '';
  let password = '';
  let asGuest = false;
  if (isForm) {
    const form = await request.formData();
    name = String(form.get('name') ?? '');
    password = String(form.get('password') ?? '');
    asGuest = form.get('gast') !== null;
  } else {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      password?: unknown;
      gast?: unknown;
    };
    name = typeof body.name === 'string' ? body.name : '';
    password = typeof body.password === 'string' ? body.password : '';
    asGuest = body.gast === true;
  }

  name = name.trim();

  // «Nur schauen» fragt nach keinem Namen: Hinter dem Gäste-Zugang steht keine
  // Person, das Passwort ist das ganze Merkmal. Es ist deshalb der einzige Weg
  // in die App, bei dem ein Name fehlen darf.
  if (asGuest) {
    if (!password) return respond(isForm, 400, 'Bitte das Gäste-Passwort eingeben.');
  } else if (!name || !password) {
    return respond(isForm, 400, 'Bitte Name oder E-Mail und das Passwort eingeben.');
  }

  // «Tim», «tim» und «Müller»/«Mueller» treffen dasselbe Konto — searchKey ist
  // im Projekt genau die Normalisierung für solche beidseitigen Vergleiche.
  //
  // Ein «@» in der Eingabe heisst: gemeint ist die Adresse. Ein Kontoname kann
  // kein «@» tragen, denn searchKey wirft alles Nicht-Alphanumerische weg —
  // die beiden Räume können sich also nicht überschneiden. Nötig wurde dieser
  // zweite Weg, als die Namen änderbar wurden: Die Adresse bleibt.
  const user = asGuest ? await getGuestUser(db) : await findeKonto(db, name);
  // Zwei getrennte Türen: Über das Namensfeld ist der Gäste-Zugang nicht zu
  // erreichen, auch nicht, wenn jemand «Gast» eintippt. Sonst hinge derselbe
  // Zugang an zwei Wegen, und nur einer davon liesse sich zumachen.
  const usable = user && user.disabled === 0 && (asGuest || user.is_guest === 0) ? user : null;

  // Immer GENAU EINE PBKDF2-Prüfung: Gibt es das Konto nicht oder ist es
  // deaktiviert, läuft sie gegen den Dummy-Hash — «unbekannter Name» antwortet
  // dadurch nicht schneller als «falsches Passwort». Und eine einzige, immer
  // gleiche Fehlermeldung, damit die Antwort nicht verrät, welcher Teil falsch war.
  // Für den Gast gilt dasselbe: Ob noch kein Passwort gesetzt ist, verrät die
  // Antwort nicht — sonst wüsste ein Fremder, dass hier ein zweiter Weg offen steht.
  const passwordOk = await verifyPassword(password, usable ? usable.password_hash : DUMMY_HASH);

  if (!usable || !passwordOk) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return asGuest
      ? respond(isForm, 401, 'Das Gäste-Passwort stimmt nicht.', 'gast')
      : respond(isForm, 401, 'Das stimmt so nicht — bitte nochmal.');
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append(
    'Set-Cookie',
    sessionCookieHeader(
      SESSION_COOKIE,
      await createSessionValue(secret, usable.id, usable.password_hash),
      secure,
    ),
  );

  if (isForm) {
    headers.set('Location', '/');
    return new Response(null, { status: 303, headers });
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(
    JSON.stringify({
      ok: true,
      name: usable.name,
      admin: usable.is_admin === 1,
      mustChangePassword: usable.must_change_password === 1,
      gast: usable.is_guest === 1,
    }),
    { status: 200, headers },
  );
};

/** Abmelden. */
export const onRequestDelete: PagesFunction<Env> = async () => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearCookieHeader(SESSION_COOKIE));
  return new Response(null, { status: 204, headers });
};

/**
 * Name oder E-Mail — je nachdem, was eingetippt wurde.
 *
 * Der E-Mail-Zweig steht in try/catch, weil die Spalte vor migrations/0007
 * fehlt: Ohne das antwortete der Anmeldebildschirm im Fenster zwischen
 * Deployment und Migration mit einem 500 statt mit «stimmt nicht».
 */
async function findeKonto(db: D1Database, eingabe: string): Promise<UserRow | null> {
  if (!eingabe.includes('@')) return getUserByNameKey(db, searchKey(eingabe));

  const email = normalisiereEmail(eingabe);
  if (!email) return null;
  try {
    return await getUserByEmail(db, email);
  } catch (error) {
    console.error('E-Mail-Anmeldung nicht möglich:', error);
    return null;
  }
}

/**
 * `bereich` sagt nur dem Anmeldebildschirm ohne JavaScript, welcher der vier
 * Abschnitte offen bleiben und die Meldung tragen soll — sonst stünde der
 * Gäste-Fehler unter dem Namensformular.
 */
function respond(
  isForm: boolean,
  status: number,
  message: string,
  bereich: 'anmelden' | 'gast' = 'anmelden',
): Response {
  if (isForm) return loginPage({ error: message, status, bereich });
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
