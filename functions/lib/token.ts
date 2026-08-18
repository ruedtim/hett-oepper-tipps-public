/**
 * Kurzlebige, signierte Tokens für die zwei Wege, die per Mail hinausgehen:
 * Passwort zurücksetzen und E-Mail-Adresse bestätigen.
 *
 * Aufgebaut wie das Sitzungs-Cookie (functions/lib/session.ts): Nutzlast im
 * Klartext, HMAC dahinter. Absichtlich OHNE Tabelle — ein Token-Speicher wäre
 * die dritte stillschweigende Lücke im Backup-Spiegel, bräuchte ein Aufräumen,
 * und Cloudflare **Pages** kennt keinen Cron dafür (dieselbe Einschränkung, die
 * schon das Wegräumen abgelaufener Wünsche an die Schreibvorgänge hängt).
 *
 * Der Fingerabdruck ersetzt die fehlende Tabelle:
 *
 * - **Reset** («pr») bindet an den Passwort-Hash. Das Zurücksetzen erzeugt ein
 *   frisches Salt, also einen anderen Hash — derselbe Link ein zweites Mal
 *   geöffnet passt nicht mehr. Damit ist der Token faktisch einmalig, ohne dass
 *   irgendwo «verbraucht» stehen müsste. Aus demselben Grund entwertet jeder
 *   andere Passwortwechsel einen noch offenen Link.
 * - **Bestätigung** («ev») bindet an die Adresse. Wer die Adresse inzwischen
 *   geändert hat, dessen alter Link läuft ins Leere; zweimal geöffnet passiert
 *   schlicht dasselbe nochmal.
 *
 * Die Gültigkeit ist entsprechend kurz: Ein Reset-Link ist ein Schlüssel zum
 * Konto und liegt im Postfach.
 */

import { constantTimeEqual, fingerprint, sign } from './session';

export type TokenArt = 'pr' | 'ev';

/** Eine Stunde: lange genug fürs Postfach, kurz genug für einen Kontoschlüssel. */
export const RESET_GUELTIG_SEK = 60 * 60;

/** Ein Tag — Bestätigen ist unkritisch und darf auch morgen früh noch klappen. */
export const VERIFIKATION_GUELTIG_SEK = 60 * 60 * 24;

/** Format: `<art>.<userId>.<ablauf>.<fp>.<hmac>` */
export async function erzeugeToken(
  secret: string,
  art: TokenArt,
  userId: number,
  gebundenAn: string,
  gueltigSek: number,
): Promise<string> {
  const ablauf = Math.floor(Date.now() / 1000) + gueltigSek;
  const nutzlast = `${art}.${userId}.${ablauf}.${await fingerprint(gebundenAn)}`;
  return `${nutzlast}.${await sign(secret, nutzlast)}`;
}

/**
 * Prüft Art, Ablauf und Signatur. Den Fingerabdruck prüft der AUFRUFER, sobald
 * er die Kontozeile geladen hat — genau wie die Middleware es mit dem Cookie
 * hält: Ein gefälschter Token soll keinen Datenbankzugriff kosten.
 */
export async function pruefeToken(
  secret: string,
  art: TokenArt,
  wert: string | null,
): Promise<{ userId: number; fp: string } | null> {
  if (!wert) return null;

  const teile = wert.split('.');
  if (teile.length !== 5) return null;
  const [artRoh, userIdRoh, ablauf, fp, signatur] = teile as [string, string, string, string, string];
  if (artRoh !== art) return null;

  const userId = Number(userIdRoh);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const ablaufAt = Number(ablauf);
  if (!Number.isFinite(ablaufAt) || ablaufAt < Date.now() / 1000) return null;

  const erwartet = await sign(secret, `${artRoh}.${userIdRoh}.${ablauf}.${fp}`);
  if (!constantTimeEqual(signatur, erwartet)) return null;

  return { userId, fp };
}

/** Passt der Token noch zu dem, woran er gebunden wurde? */
export async function passtZu(fp: string, gebundenAn: string): Promise<boolean> {
  return constantTimeEqual(fp, await fingerprint(gebundenAn));
}
