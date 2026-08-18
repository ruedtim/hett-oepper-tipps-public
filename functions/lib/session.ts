/**
 * Signierte Sitzungs-Cookies.
 *
 * Das Cookie enthält keine Geheimnisse: Version, Benutzer-ID, Ablaufzeitpunkt
 * und einen Fingerabdruck des gespeicherten Passwort-Hashes, alles
 * HMAC-signiert. Der Fingerabdruck ist der Punkt, an dem «Passwort ändern»
 * tatsächlich etwas bewirkt: Jedes Setzen eines Passworts erzeugt ein frisches
 * Salt und damit einen anderen Hash-String — der Fingerabdruck in allen
 * ausgegebenen Cookies DIESES Kontos passt nicht mehr, und nur dessen
 * Sitzungen enden. Wer das Konto ist und ob es (noch) darf, prüft die
 * Middleware bei jedem Request gegen die Datenbank.
 */

const encoder = new TextEncoder();

/**
 * Ein Jahr — die App ist für Freunde, nicht für ein Bankkonto. Seit es
 * persönliche Konten gibt, ist die lange Dauer weniger heikel als früher:
 * Deaktivieren oder ein Passwort-Reset wirkt serverseitig sofort.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export const SESSION_COOKIE = 'hot_session';

function base64url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Auch von functions/lib/token.ts benutzt — dieselbe Signatur, andere Nutzlast. */
export async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/** Vergleich ohne früh abzubrechen. Nur für gleich lange Werte gedacht (HMACs, Hashes). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Kurzer Fingerabdruck eines Werts, um Cookies bei Passwortwechsel ungültig zu machen. */
export async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Format: `2.<userId>.<expires>.<fp>.<hmac>` — Version 1 (geteiltes Passwort) gilt nicht mehr. */
export async function createSessionValue(
  secret: string,
  userId: number,
  passwordHash: string,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `2.${userId}.${expires}.${await fingerprint(passwordHash)}`;
  return `${payload}.${await sign(secret, payload)}`;
}

/**
 * Prüft Version, Ablauf und Signatur — NICHT den Fingerabdruck: Dafür braucht
 * es die Benutzerzeile aus der Datenbank, und die holt die Middleware erst,
 * wenn die Signatur stimmt. So kostet ein gefälschtes Cookie keinen D1-Read.
 */
export async function parseSession(
  secret: string,
  cookieValue: string | undefined,
): Promise<{ userId: number; fp: string } | null> {
  if (!cookieValue) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 5) return null;
  const [version, userIdRaw, expires, fp, signature] = parts as [string, string, string, string, string];
  if (version !== '2') return null;

  const userId = Number(userIdRaw);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

  const expected = await sign(secret, `${version}.${userIdRaw}.${expires}.${fp}`);
  if (!constantTimeEqual(signature, expected)) return null;

  return { userId, fp };
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function sessionCookieHeader(name: string, value: string, secure: boolean): string {
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  // Auf http://localhost gäbe `Secure` ein Cookie, das der Browser wegwirft.
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
