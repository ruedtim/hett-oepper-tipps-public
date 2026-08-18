import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import { createSessionValue, SESSION_COOKIE, sessionCookieHeader } from '../../lib/session';
import { getUserById, hashPassword, verifyPassword } from '../../lib/users';
import type { RequestData } from '../../lib/users';

const WRONG_PASSWORD_DELAY_MS = 500;
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

/**
 * Das eigene Passwort ändern.
 *
 * Das alte Passwort ist Pflicht: Ein liegen gelassenes, angemeldetes Handy
 * soll nicht reichen, um jemanden dauerhaft auszusperren. Nach dem Wechsel
 * enden alle Sitzungen dieses Kontos (der Fingerabdruck im Cookie passt nicht
 * mehr) — nur die eigene überlebt, weil die Antwort ein frisches Cookie setzt.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async (context) => {
  const { request, env, data } = context;
  const db = env.DB as D1Database;
  const secret = env.SESSION_SECRET as string;

  const body = (await request.json().catch(() => ({}))) as {
    oldPassword?: unknown;
    newPassword?: unknown;
  };
  const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!oldPassword || !newPassword) return json({ error: 'Bitte beide Passwörter angeben.' }, 400);
  if (newPassword.length < MIN_LENGTH) {
    return json({ error: `Das neue Passwort braucht mindestens ${MIN_LENGTH} Zeichen.` }, 400);
  }
  if (newPassword.length > MAX_LENGTH) {
    return json({ error: 'Das neue Passwort ist zu lang.' }, 400);
  }

  const user = await getUserById(db, data.user.id);
  if (!user) return json({ error: 'Dieses Konto gibt es nicht (mehr).' }, 403);

  if (!(await verifyPassword(oldPassword, user.password_hash))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return json({ error: 'Das bisherige Passwort stimmt nicht.' }, 403);
  }

  const newHash = await hashPassword(newPassword);
  await db
    .prepare(
      `UPDATE users SET password_hash = ?1, must_change_password = 0,
       password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?2`,
    )
    .bind(newHash, user.id)
    .run();

  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  headers.append(
    'Set-Cookie',
    sessionCookieHeader(SESSION_COOKIE, await createSessionValue(secret, user.id, newHash), secure),
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
