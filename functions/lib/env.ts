export interface Env {
  /** 32 zufällige Bytes, signiert die Sitzungs-Cookies. */
  SESSION_SECRET?: string;
  /** Fine-grained PAT — für die zwei Endpunkte, die Issues schreiben: Rückmeldungen und Zugangsbitten. */
  GITHUB_TOKEN?: string;
  /** «ruedtim/hett-oepper-tipps» */
  GITHUB_REPO?: string;
  /**
   * «produktion» oder «preview» (wrangler.toml). Entscheidet in
   * `abweisungUnbekannterHost()`, welche Adressen antworten dürfen. Fehlt der
   * Wert, gilt die strenge Produktions-Regel.
   */
  UMGEBUNG?: string;
  /** Bearer-Token des täglichen Backup-Jobs. Kann ausschliesslich lesen. */
  BACKUP_TOKEN?: string;
  /**
   * API-Schlüssel von Resend. Fehlt er, antworten die Endpunkte rund um
   * E-Mail-Adressen mit 503 und Benachrichtigungen entfallen still — die Seite
   * selbst läuft weiter. Deshalb steht er NICHT in `missingSecrets()`: Das Gate
   * ist fail-closed, weil ein vergessenes Secret nie zu einer offenen Seite
   * führen darf; nicht mailen zu können macht dagegen nichts auf.
   */
  RESEND_API_KEY?: string;
  /** Absender, z. B. «Hett öpper Tipps <tipps@beispiel.example>» (wrangler.toml). */
  MAIL_ABSENDER?: string;
  /** D1 — der primäre Speicher für Tipps, Konten und Verlauf (wrangler.toml). */
  DB?: D1Database;
  /** R2-Bucket für die Fotobytes (wrangler.toml). */
  FOTOS?: R2Bucket;
  /** Statische Assets — implizite Pages-Bindung. */
  ASSETS?: Fetcher;
}

/**
 * Fehlt eine Zutat, wird gesperrt statt durchgelassen.
 *
 * Ein vergessenes Secret oder eine vergessene Bindung in der Preview-Umgebung
 * darf nicht dazu führen, dass die Seite offen im Netz steht — das ist genau
 * der Fehler, den man erst bemerkt, wenn es zu spät ist.
 */
export function missingSecrets(env: Env): string[] {
  const missing: string[] = [];
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!env.DB) missing.push('DB-Bindung (D1)');
  if (!env.FOTOS) missing.push('FOTOS-Bindung (R2)');
  return missing;
}

export function configurationError(missing: string[]): Response {
  return new Response(
    `Die Seite ist nicht vollständig eingerichtet: ${missing.join(', ')} fehlt.\n` +
      'Secrets stehen unter Cloudflare Pages → Settings → Environment variables ' +
      '(Production UND Preview), die D1-/R2-Bindings in wrangler.toml.\n',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
