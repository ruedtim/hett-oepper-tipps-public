/**
 * Geteilte Tipp-Listen — der einzige Weg, auf dem jemand OHNE Konto etwas aus
 * der Sammlung sieht.
 *
 * Aufgebaut wie `lib/wuensche.ts`: Leser geben fertige Formen zurück, Schreiber
 * geben Statements zurück, und der Besitz steht IM Statement und nicht bloss in
 * einem vorangehenden SELECT — so können Prüfen und Schreiben nicht
 * auseinanderfallen.
 *
 * Die Begründungen für Tabelle, Ablauf und Spiegel-Ausnahme stehen in
 * `migrations/0010_geteilte_listen.sql`.
 */

import { heuteIso, tageSpaeter } from '../../shared/datum.mjs';

/**
 * 32 Zeichen — ohne i, l, o und 1, die sich beim Vorlesen und Abtippen
 * verwechseln. Genau 32, damit fünf Bits pro Zeichen ohne Modulo-Verzerrung
 * reichen.
 */
const ALPHABET = '023456789abcdefghjkmnpqrstuvwxyz';

/** 20 Zeichen à 5 Bit = 100 Bit. Der Link ist die Berechtigung. */
export const ID_LAENGE = 20;

/**
 * Geprüft wird beim Lesen gegen `[0-9a-z]`, nicht gegen das Alphabet: Ein
 * Zeichen, das es nicht gibt, findet die Datenbank ohnehin nicht — und das
 * Muster im Gate soll nicht stillschweigend mitwandern, wenn jemand hier oben
 * ein Zeichen ergänzt.
 */
export const ID_MUSTER = /^[0-9a-z]{20}$/;

/**
 * 90 Tage: lang genug für eine Reiseplanung und einen zweiten Blick Monate
 * später, kurz genug, dass ein vergessener Link in einem alten Chat irgendwann
 * von selbst zugeht.
 */
export const GUELTIG_TAGE = 90;

/**
 * Deckel auf einer einzelnen Liste. Die Seite entsteht in EINER Worker-Antwort,
 * und eine ungefilterte Sammlung zu verschicken ist keine Empfehlung mehr,
 * sondern ein Datenabzug.
 */
export const MAX_TIPPS = 200;

export interface GeteilteListeRow {
  id: string;
  von_id: number;
  tipp_ids: string;
  erstellt: string;
  bis: string;
}

/** Was die Konto-Seite über einen eigenen Link wissen muss. */
export interface GeteilteListe {
  id: string;
  erstellt: string;
  bis: string;
  tippIds: string[];
}

/**
 * `byte & 31` wirft drei Bits weg, statt einen Modulo zu rechnen: Bei einem
 * Alphabet, dessen Länge keine Zweierpotenz ist, wären die ersten Zeichen sonst
 * messbar häufiger.
 */
export function neueListenId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LAENGE));
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte & 31];
  return id;
}

/** Der letzte Tag, an dem ein heute erzeugter Link noch gilt. */
export function gueltigBis(heute = heuteIso()): string {
  return tageSpaeter(heute, GUELTIG_TAGE);
}

/**
 * Ein kaputtes `tipp_ids` darf die Seite nicht mit einem TypeError beenden —
 * dann lieber eine leere Liste, die ehrlich «da ist nichts mehr» sagt.
 */
export function tippIdsOf(row: Pick<GeteilteListeRow, 'tipp_ids'>): string[] {
  try {
    const roh = JSON.parse(row.tipp_ids) as unknown;
    return Array.isArray(roh) ? roh.filter((wert): wert is string => typeof wert === 'string') : [];
  } catch (error) {
    console.error('tipp_ids nicht lesbar:', error);
    return [];
  }
}

/**
 * `bis >= heute`, nie `>` — der letzte gültige Tag zählt noch ganz, genau wie
 * bei den Wünschen. Ein abgelaufener Link ist damit sofort für alle tot, auch
 * bevor das Aufräumen ihn wirklich entfernt hat.
 */
export function getGueltigeListe(
  db: D1Database,
  id: string,
  heute: string,
): Promise<GeteilteListeRow | null> {
  return db
    .prepare('SELECT * FROM geteilte_listen WHERE id = ?1 AND bis >= ?2')
    .bind(id, heute)
    .first<GeteilteListeRow>();
}

export async function getListenVon(
  db: D1Database,
  vonId: number,
  heute: string,
): Promise<GeteilteListe[]> {
  const zeilen = await db
    .prepare('SELECT * FROM geteilte_listen WHERE von_id = ?1 AND bis >= ?2 ORDER BY erstellt DESC, id')
    .bind(vonId, heute)
    .all<GeteilteListeRow>();
  return zeilen.results.map((zeile) => ({
    id: zeile.id,
    erstellt: zeile.erstellt,
    bis: zeile.bis,
    tippIds: tippIdsOf(zeile),
  }));
}

export function listeInsertStmt(
  db: D1Database,
  eintrag: { id: string; vonId: number; tippIds: string[]; erstellt: string; bis: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO geteilte_listen (id, von_id, tipp_ids, erstellt, bis)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      eintrag.id,
      eintrag.vonId,
      JSON.stringify(eintrag.tippIds),
      eintrag.erstellt,
      eintrag.bis,
    );
}

/**
 * Der Besitz steht in der WHERE-Klausel und nicht nur in einem SELECT davor:
 * Ein Widerruf, der die fremde Zeile findet und dann doch nicht löscht, wäre
 * eine Prüfung, die sich vom Schreiben lösen kann.
 */
export function listeDeleteStmt(db: D1Database, id: string, vonId: number): D1PreparedStatement {
  return db
    .prepare('DELETE FROM geteilte_listen WHERE id = ?1 AND von_id = ?2')
    .bind(id, vonId);
}

/**
 * Wegräumen als Hygiene nach dem Schreiben, in try/catch — dieselbe Bauweise
 * wie bei den Wünschen und aus demselben Grund: Cloudflare Pages kennt keine
 * Scheduled Workers, und ein zweiter Worker samt eigenem Deployment für ein
 * DELETE lohnt nicht. Scheitert es, bleiben ein paar Zeilen liegen, die ohnehin
 * niemand mehr sieht — der Lesefilter hält sie schon draussen.
 */
export async function raeumeAbgelaufeneListen(db: D1Database, heute: string): Promise<void> {
  try {
    await db.prepare('DELETE FROM geteilte_listen WHERE bis < ?1').bind(heute).run();
  } catch (error) {
    console.error('Aufräumen abgelaufener Freigabelinks fehlgeschlagen:', error);
  }
}
