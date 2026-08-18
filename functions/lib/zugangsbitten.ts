/**
 * Zugangsbitten — «gib mir bitte Zugang», so aufgeschrieben, dass ein Admin
 * mit einem Klick antworten kann (#71).
 *
 * Aufgebaut wie `lib/einladungen.ts` und `lib/geteilt.ts`: Leser geben fertige
 * Formen zurück, Schreiber geben Statements zurück, und Deckel, Zustand und
 * Anspruch stehen IM Statement statt in einem vorangehenden SELECT. Beim
 * Einladen ist das mehr als Stil: Zwei schnelle Klicks bestünden beide einen
 * Vorab-Check, und D1 bricht einen Batch nicht ab, nur weil ein UPDATE null
 * Zeilen trifft.
 *
 * Die Begründungen für Tabelle, Spalten und Spiegel-Ausnahme stehen in
 * `migrations/0013_zugangsbitten.sql`.
 */

import { statusOf } from './einladungen';
import type { EinladungsStatus } from './einladungen';

/**
 * Wie viele Bitten gleichzeitig offen sein dürfen. Der Deckel begrenzt nicht
 * die Versuche, sondern den Schaden — mehr als so viele Zeilen kann niemand
 * erzeugen, egal wie oft er drückt. Anders als der frühere Deckel auf offenen
 * GitHub-Issues geht dieser von selbst wieder auf: Er zählt, was die Admins in
 * der App noch nicht erledigt haben.
 */
export const MAX_OFFEN = 10;

interface BitteRow {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  erstellt: string;
  issue_nummer: number | null;
  erledigt_am: string | null;
  erledigt_von: number | null;
  einladung_id: string | null;
}

/** Eine Bitte, wie sie die Kontenverwaltung auflistet. */
export interface Zugangsbitte {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  erstellt: string;
  /**
   * Gesetzt, sobald ein Admin eingeladen hat. Die Zeile bleibt danach stehen,
   * bis die Einladung eingelöst, widerrufen oder abgelaufen ist — solange soll
   * sichtbar sein, dass hier etwas unterwegs ist.
   */
  einladung: {
    id: string;
    bis: string;
    status: EinladungsStatus;
    /** Tag, an dem der Link verschickt wurde. */
    geschicktAm: string;
    /** Aktueller Name des Admins, der eingeladen hat. */
    von: string | null;
  } | null;
}

/**
 * Alle Bitten — offene zuerst, dann die mit verschickter Einladung. Verworfene
 * sind gelöscht und erledigte räumt `raeumeErledigteBitten` weg, sobald ihre
 * Einladung nicht mehr offen ist; was hier steht, ist also immer etwas, das
 * noch jemanden angeht.
 */
export async function getBitten(db: D1Database, heute: string): Promise<Zugangsbitte[]> {
  const zeilen = await db
    .prepare(
      `SELECT z.*, e.bis AS e_bis, e.erstellt AS e_erstellt,
              e.eingeloest_am AS e_eingeloest_am, e.widerrufen_am AS e_widerrufen_am,
              a.name AS admin_name
       FROM zugangsbitten z
       LEFT JOIN einladungen e ON e.id = z.einladung_id
       LEFT JOIN users a ON a.id = z.erledigt_von
       ORDER BY z.erledigt_am IS NOT NULL, z.erstellt DESC, z.id DESC`,
    )
    .all<
      BitteRow & {
        e_bis: string | null;
        e_erstellt: string | null;
        e_eingeloest_am: string | null;
        e_widerrufen_am: string | null;
        admin_name: string | null;
      }
    >();

  return zeilen.results.map((zeile) => ({
    id: zeile.id,
    vorname: zeile.vorname,
    nachname: zeile.nachname,
    email: zeile.email,
    erstellt: zeile.erstellt,
    einladung:
      zeile.einladung_id && zeile.e_bis && zeile.e_erstellt
        ? {
            id: zeile.einladung_id,
            bis: zeile.e_bis,
            status: statusOf(
              {
                bis: zeile.e_bis,
                eingeloest_am: zeile.e_eingeloest_am,
                widerrufen_am: zeile.e_widerrufen_am,
              },
              heute,
            ),
            geschicktAm: zeile.e_erstellt,
            von: zeile.admin_name,
          }
        : null,
  }));
}

/** Eine einzelne Bitte — für die Endpunkte, die an ihr handeln. */
export function getBitte(db: D1Database, id: number): Promise<BitteRow | null> {
  return db.prepare('SELECT * FROM zugangsbitten WHERE id = ?1').bind(id).first<BitteRow>();
}

/**
 * Der Deckel steht IM Statement: `meta.changes === 0` heisst «gerade zu viele
 * offene Bitten». Eine Dublette fängt dagegen der partielle UNIQUE-Index ab und
 * wirft — zwei unterscheidbare Signale für zwei verschiedene Antworten.
 */
export function bitteInsertStmt(
  db: D1Database,
  eintrag: { vorname: string; nachname: string; email: string; erstellt: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO zugangsbitten (vorname, nachname, email, erstellt)
       SELECT ?1, ?2, ?3, ?4
       WHERE (SELECT COUNT(*) FROM zugangsbitten WHERE erledigt_am IS NULL) < ?5`,
    )
    .bind(eintrag.vorname, eintrag.nachname, eintrag.email, eintrag.erstellt, MAX_OFFEN);
}

/**
 * Die Nummer des Benachrichtigungs-Issues nachtragen. Getrennt vom INSERT, weil
 * das Issue erst entstehen darf, wenn die Zeile den Deckel passiert hat —
 * sonst erzeugte auch eine abgewiesene Bitte noch ein Issue.
 */
export function merkeIssueStmt(
  db: D1Database,
  id: number,
  nummer: number,
): D1PreparedStatement {
  return db
    .prepare('UPDATE zugangsbitten SET issue_nummer = ?2 WHERE id = ?1')
    .bind(id, nummer);
}

/**
 * Einladen: die Einladung anlegen UND die Bitte als erledigt markieren, in
 * EINEM Batch.
 *
 * Der Anspruch steckt im INSERT (`WHERE EXISTS … erledigt_am IS NULL`), nicht
 * in einem Vorab-Check — genau wie bei `einloesungsStmts`. Zwei schnelle Klicks
 * bestünden beide einen Check, und der Batch liefe trotzdem durch. Nach dem
 * Batch ist `results[0].meta.changes === 1` die einzige Wahrheit.
 *
 * `aus_bitte = 1` hält fest, dass das keine persönliche Einladung ist: Sie
 * zählt nicht gegen das Budget des Admins und steht nicht in seiner Liste.
 */
export function einladungsStmts(
  db: D1Database,
  eintrag: {
    bitteId: number;
    adminId: number;
    einladungsId: string;
    erstellt: string;
    bis: string;
  },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO einladungen (id, von_id, erstellt, bis, aus_bitte)
         SELECT ?1, ?2, ?3, ?4, 1
         WHERE EXISTS (
           SELECT 1 FROM zugangsbitten WHERE id = ?5 AND erledigt_am IS NULL
         )`,
      )
      .bind(
        eintrag.einladungsId,
        eintrag.adminId,
        eintrag.erstellt,
        eintrag.bis,
        eintrag.bitteId,
      ),
    db
      .prepare(
        `UPDATE zugangsbitten
            SET erledigt_am = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                erledigt_von = ?2,
                einladung_id = ?3
          WHERE id = ?1 AND erledigt_am IS NULL`,
      )
      .bind(eintrag.bitteId, eintrag.adminId, eintrag.einladungsId),
  ];
}

/**
 * Zurückziehen: die Einladung widerrufen UND die Bitte wieder öffnen.
 *
 * Ein echtes Rückgängig, kein dritter Zustand — sonst verschluckte ein
 * Fehlklick die Bitte, und die Person müsste nochmal fragen, ohne je zu
 * erfahren warum. Ohne `von_id`-Wächter, anders als bei `widerrufStmt`: Was im
 * Amt verschickt wurde, muss auch ein anderer Admin zurücknehmen können.
 *
 * Das zweite Statement hängt am Ergebnis des ersten (`widerrufen_am IS NOT
 * NULL`) — innerhalb eines Batches sieht es dessen Schreibvorgang schon. Wurde
 * die Einladung in der Zwischenzeit eingelöst, greift das erste nicht, und die
 * Bitte bleibt zu Recht erledigt: Das Konto gibt es ja.
 */
export function zuruecknahmeStmts(
  db: D1Database,
  bitteId: number,
  einladungsId: string,
  heute: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE einladungen SET widerrufen_am = ?2
          WHERE id = ?1 AND eingeloest_am IS NULL AND widerrufen_am IS NULL`,
      )
      .bind(einladungsId, heute),
    db
      .prepare(
        `UPDATE zugangsbitten
            SET erledigt_am = NULL, erledigt_von = NULL, einladung_id = NULL
          WHERE id = ?1 AND einladung_id = ?2
            AND EXISTS (
              SELECT 1 FROM einladungen WHERE id = ?2 AND widerrufen_am IS NOT NULL
            )`,
      )
      .bind(bitteId, einladungsId),
  ];
}

/**
 * Verwerfen: die Zeile ist weg. Kein «abgelehnt»-Zustand — die Adresse einer
 * fremden Person aufzuheben, nachdem man Nein gesagt hat, wäre das Falsche, und
 * der Deckel soll den Platz sofort wieder freigeben. Nur offene Bitten, damit
 * ein Klick nicht eine schon verschickte Einladung aus der Übersicht nimmt.
 */
export function verwerfenStmt(db: D1Database, id: number): D1PreparedStatement {
  return db
    .prepare('DELETE FROM zugangsbitten WHERE id = ?1 AND erledigt_am IS NULL')
    .bind(id);
}

/**
 * Wegräumen als Hygiene nach dem Schreiben, in try/catch — dieselbe Bauweise
 * wie bei den Wünschen und den geteilten Listen und aus demselben Grund:
 * Cloudflare Pages kennt keine Scheduled Workers, und ein zweiter Worker samt
 * eigenem Deployment für ein DELETE lohnt nicht.
 *
 * Weg kommt jede erledigte Zeile, deren Einladung nicht mehr offen ist —
 * eingelöst (die Person ist da), widerrufen oder abgelaufen (der Link ist tot).
 * Solange die Einladung unterwegs ist, bleibt die Bitte stehen: Sie ist dann
 * die einzige Stelle, an der diese Einladung überhaupt angezeigt wird.
 */
export async function raeumeErledigteBitten(db: D1Database, heute: string): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM zugangsbitten
          WHERE erledigt_am IS NOT NULL
            AND (einladung_id IS NULL
                 OR NOT EXISTS (
                   SELECT 1 FROM einladungen e
                    WHERE e.id = zugangsbitten.einladung_id
                      AND e.eingeloest_am IS NULL AND e.widerrufen_am IS NULL
                      AND e.bis >= ?1
                 ))`,
      )
      .bind(heute)
      .run();
  } catch (error) {
    console.error('Aufräumen erledigter Zugangsbitten fehlgeschlagen:', error);
  }
}
