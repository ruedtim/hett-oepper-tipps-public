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
import { DUMMY_HASH, getUserByEmail, getUserByNameKey, verifyPassword } from '../lib/users';
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
  if (isForm) {
    const form = await request.formData();
    name = String(form.get('name') ?? '');
    password = String(form.get('password') ?? '');
  } else {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      password?: unknown;
    };
    name = typeof body.name === 'string' ? body.name : '';
    password = typeof body.password === 'string' ? body.password : '';
  }

  name = name.trim();

  if (!name || !password) {
    return respond(isForm, 400, 'Bitte Name oder E-Mail und das Passwort eingeben.');
  }

  // «Tim», «tim» und «Müller»/«Mueller» treffen dasselbe Konto — searchKey ist
  // im Projekt genau die Normalisierung für solche beidseitigen Vergleiche.
  //
  // Ein «@» in der Eingabe heisst: gemeint ist die Adresse. Ein Kontoname kann
  // kein «@» tragen, denn searchKey wirft alles Nicht-Alphanumerische weg —
  // die beiden Räume können sich also nicht überschneiden. Nötig wurde dieser
  // zweite Weg, als die Namen änderbar wurden: Die Adresse bleibt.
  const user = await findeKonto(db, name);
  // Die Gäste-Zeile ist über das Namensfeld nicht zu erreichen, auch nicht, wenn
  // jemand «Gast» eintippt. Seit #70 gibt es überhaupt keinen zweiten Weg mehr
  // zu ihr — die Bedingung bleibt trotzdem stehen: Sie ist das, was den
  // gesperrten Zustand aus migrations/0012_gast_zu.sql im Code festhält.
  const usable = user && user.disabled === 0 && user.is_guest === 0 ? user : null;

  // Immer GENAU EINE PBKDF2-Prüfung: Gibt es das Konto nicht oder ist es
  // deaktiviert, läuft sie gegen den Dummy-Hash — «unbekannter Name» antwortet
  // dadurch nicht schneller als «falsches Passwort». Und eine einzige, immer
  // gleiche Fehlermeldung, damit die Antwort nicht verrät, welcher Teil falsch war.
  const passwordOk = await verifyPassword(password, usable ? usable.password_hash : DUMMY_HASH);

  if (!usable || !passwordOk) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return respond(isForm, 401, 'Das stimmt so nicht — bitte nochmal.');
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
 * Ohne JavaScript ist die neu gerenderte Seite die einzige Rückmeldung. Der
 * Fehler gehört ans Hauptformular — `bereich` steht deshalb fest auf
 * «anmelden»; die beiden Nebenwege beantworten ihre Fehler selbst.
 */
function respond(isForm: boolean, status: number, message: string): Response {
  if (isForm) return loginPage({ error: message, status, bereich: 'anmelden' });
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
