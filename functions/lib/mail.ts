/**
 * E-Mail-Versand über Resend.
 *
 * Gebaut wie functions/lib/github.ts: ein schmaler Adapter um genau den einen
 * REST-Aufruf, den die App braucht. Workers können kein SMTP — es muss ein
 * Dienst über HTTP sein; welcher, entscheidet allein diese Datei.
 *
 * Reiner Text, kein HTML: Die Nachrichten sind drei Sätze und ein Link. Eine
 * HTML-Fassung wäre eine zweite Fassung, die auseinanderdriftet.
 *
 * WICHTIG — der fehlende Schlüssel sperrt NICHT die Seite. `missingSecrets()`
 * in env.ts bleibt bei SESSION_SECRET, DB und FOTOS: Das Gate ist fail-closed,
 * damit ein vergessenes Secret nie zu einer OFFENEN Seite führt. Beim Mailen ist
 * es umgekehrt — nichts zu verschicken macht nichts auf, es macht nur weniger.
 * Also wie bei GitHub: Der betroffene Endpunkt antwortet 503, Benachrichtigungen
 * entfallen still, alles andere läuft.
 */

const API = 'https://api.resend.com/emails';

export class MailError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Resend ${status}: ${detail}`);
    this.name = 'MailError';
  }
}

interface MailEnv {
  RESEND_API_KEY?: string;
  MAIL_ABSENDER?: string;
}

/** Ohne beides geht kein Versand — und das ist kein Fehler, sondern ein Zustand. */
export function mailKonfiguriert(env: MailEnv): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_ABSENDER);
}

export async function sendeMail(
  env: MailEnv,
  { an, betreff, text }: { an: string; betreff: string; text: string },
): Promise<void> {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.MAIL_ABSENDER, to: [an], subject: betreff, text }),
  });

  if (!response.ok) {
    // Wie bei GitHub: Der Text des Dienstes bleibt im Log und geht nie an den
    // Browser zurück — eine durchgereichte Fehlerantwort kann Kopfzeilen oder
    // Schlüsselfragmente enthalten.
    const detail = await response.text().catch(() => '');
    throw new MailError(response.status, detail.slice(0, 500));
  }
}

/**
 * Der Deckel gegen Massenversand: Liegt der letzte Versand an dieses Konto
 * weniger als `minuten` zurück, wird übersprungen.
 *
 * Die Zeitstempel in `users` kommen aus SQLite (`strftime('…%SZ','now')`) und
 * tragen das Z bereits — `Date.parse` liest sie direkt als UTC. Ein unlesbarer
 * Wert lässt durch statt zu sperren: Der Deckel ist Höflichkeit gegenüber dem
 * fremden Postfach, kein Sicherheitsmerkmal.
 */
export function zuFrueh(zuletzt: string | null | undefined, minuten: number): boolean {
  if (!zuletzt) return false;
  const alt = Date.parse(zuletzt);
  if (!Number.isFinite(alt)) return false;
  return Date.now() - alt < minuten * 60 * 1000;
}

/**
 * Vereinheitlicht eine eingetippte Adresse und weist offensichtlichen Unsinn ab.
 *
 * Bewusst grosszügig: Wer eine Adresse wirklich prüfen will, schickt eine Mail
 * hin — genau das passiert hier ja anschliessend. Diese Prüfung fängt nur
 * Tippfehler, die gar keine Adresse sein KÖNNEN, damit sie nicht als
 * «Bestätigung ausstehend» liegen bleiben.
 *
 * Klein geschrieben, weil die Adresse zugleich Anmeldeschlüssel ist und der
 * UNIQUE-Index zeichengenau vergleicht — «Tim@…» und «tim@…» wären sonst zwei
 * Konten. Der lokale Teil darf das streng genommen unterscheiden; kein Anbieter,
 * der hier vorkommt, tut es.
 */
export function normalisiereEmail(wert: string): string | null {
  const email = wert.trim().toLowerCase();
  if (!email || email.length > 200) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}
