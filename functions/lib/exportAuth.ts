import { json } from './admin';
import type { Env } from './env';
import { constantTimeEqual } from './session';

/**
 * Zugangsprüfung für den Export: der Backup-Job weist sich mit
 * `Authorization: Bearer <BACKUP_TOKEN>` aus. Der Token kann ausschliesslich
 * lesen — die Gegenrichtung (Git → Datenbank) hat absichtlich keinen Endpunkt.
 */
export async function requireBackupToken(request: Request, env: Env): Promise<Response | null> {
  // Fail-closed wie beim Rest der App: kein konfigurierter Token, kein Export.
  if (!env.BACKUP_TOKEN) {
    return json({ error: 'Der Export ist nicht eingerichtet (BACKUP_TOKEN fehlt).' }, 503);
  }

  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  // Beide Werte erst hashen, dann in konstanter Zeit vergleichen — so verrät
  // die Laufzeit weder Länge noch gemeinsames Präfix des echten Tokens.
  const [a, b] = await Promise.all([sha256hex(given), sha256hex(env.BACKUP_TOKEN)]);
  if (!given || !constantTimeEqual(a, b)) {
    return json({ error: 'Ungültiger Token.' }, 401);
  }
  return null;
}

async function sha256hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
