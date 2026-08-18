/**
 * Einladungslinks — der Weg, auf dem jemand OHNE Konto eines bekommt (#64).
 *
 * Aufgebaut wie `lib/geteilt.ts`: Leser geben fertige Formen zurück, Schreiber
 * geben Statements zurück, und Budget, Besitz und Zustand stehen IM Statement
 * und nicht bloss in einem vorangehenden SELECT — so können Prüfen und
 * Schreiben nicht auseinanderfallen. Beim Einlösen ist das mehr als Stil:
 * Zwei gleichzeitige POSTs mit demselben Link bestünden beide einen
 * Vorab-Check, und D1 bricht einen Batch nicht ab, nur weil ein UPDATE null
 * Zeilen trifft. Der Guard muss darum im INSERT selbst stecken.
 *
 * Die Begründungen für Tabelle, Budget-Zählung, Ablauf und Spiegel-Ausnahme
 * stehen in `migrations/0011_einladungen.sql`.
 *
 * `aus_bitte = 1` (seit #71) ist die eine Sorte Einladung, die NICHT jemandem
 * persönlich gehört: Ein Admin hat sie auf eine Zugangsbitte hin verschickt.
 * Sie zählt deshalb nicht gegen das Budget und steht nicht in der Liste unter
 * «Konto» — jede Abfrage hier, die «meine Einladungen» meint, trägt darum
 * `aus_bitte = 0`. Verwaltet wird sie in `lib/zugangsbitten.ts`, bei der Bitte,
 * aus der sie entstanden ist.
 */

import { heuteIso } from '../../shared/datum.mjs';
import { gueltigBis, ID_MUSTER, neueListenId } from './geteilt';

// Derselbe Generator wie bei den Freigabelinks: 20 Zeichen à 5 Bit = 100 Bit,
// ohne verwechselbare Zeichen. Eine Kopie hier wäre der Anfang von zwei
// Alphabeten, die genau so lange gleich aussehen, bis jemand eines anfasst.
export { gueltigBis, ID_MUSTER, neueListenId };

/** Wie viele Einladungen ein +3 der Admins dazugibt. */
export const NACHSCHUB = 3;

export interface EinladungRow {
  id: string;
  von_id: number;
  erstellt: string;
  bis: string;
  eingeloest_am: string | null;
  eingeloest_von: number | null;
  widerrufen_am: string | null;
}

export type EinladungsStatus = 'offen' | 'eingeloest' | 'widerrufen' | 'abgelaufen';

/** Was die Konto-Seite über eine eigene Einladung wissen muss. */
export interface Einladung {
  id: string;
  erstellt: string;
  bis: string;
  status: EinladungsStatus;
  /** Aktueller Name des entstandenen Kontos — aufgelöst beim LESEN, wie überall. */
  eingeloestVon: string | null;
  eingeloestAm: string | null;
}

/**
 * Nimmt nur die drei Felder, die den Zustand ausmachen, statt der ganzen Zeile:
 * `lib/zugangsbitten.ts` liest die Einladung über einen JOIN mit umbenannten
 * Spalten und hat keine vollständige `EinladungRow` zur Hand.
 */
export function statusOf(
  zeile: Pick<EinladungRow, 'bis' | 'eingeloest_am' | 'widerrufen_am'>,
  heute: string,
): EinladungsStatus {
  if (zeile.eingeloest_am) return 'eingeloest';
  if (zeile.widerrufen_am) return 'widerrufen';
  return zeile.bis >= heute ? 'offen' : 'abgelaufen';
}

/**
 * Alle je erzeugten Einladungen eines Kontos — auch eingelöste und widerrufene,
 * aber ohne die im Amt verschickten (`aus_bitte = 1`): Die gehören nicht dieser
 * Person, und sie zählen unten auch nicht gegen ihr Budget. Beides muss
 * zusammenpassen, sonst widersprächen sich die Liste und die Zahl «noch N»
 * darunter.
 */
export async function getEinladungenVon(
  db: D1Database,
  vonId: number,
  heute = heuteIso(),
): Promise<Einladung[]> {
  const zeilen = await db
    .prepare(
      `SELECT e.*, u.name AS eingeloest_name
       FROM einladungen e LEFT JOIN users u ON u.id = e.eingeloest_von
       WHERE e.von_id = ?1 AND e.aus_bitte = 0 ORDER BY e.erstellt DESC, e.id`,
    )
    .bind(vonId)
    .all<EinladungRow & { eingeloest_name: string | null }>();

  return zeilen.results.map((zeile) => ({
    id: zeile.id,
    erstellt: zeile.erstellt,
    bis: zeile.bis,
    status: statusOf(zeile, heute),
    eingeloestVon: zeile.eingeloest_name,
    eingeloestAm: zeile.eingeloest_am,
  }));
}

/** Budget, Zähler und offene Bestellung eines Kontos, in einem Read. */
export async function getEinladungsStand(
  db: D1Database,
  vonId: number,
): Promise<{ budget: number; erzeugt: number; verbleibend: number; bestelltAm: string | null }> {
  const zeile = await db
    .prepare(
      `SELECT einladungs_budget AS budget, einladungen_bestellt_am AS bestellt,
              (SELECT COUNT(*) FROM einladungen WHERE von_id = ?1 AND aus_bitte = 0) AS erzeugt
       FROM users WHERE id = ?1`,
    )
    .bind(vonId)
    .first<{ budget: number; bestellt: string | null; erzeugt: number }>();

  const budget = zeile?.budget ?? 0;
  const erzeugt = zeile?.erzeugt ?? 0;
  return {
    budget,
    erzeugt,
    verbleibend: Math.max(0, budget - erzeugt),
    bestelltAm: zeile?.bestellt ?? null,
  };
}

/**
 * Eine noch einlösbare Einladung samt Namen des Einladenden — für die
 * Formularseite. Ein deaktiviertes Konto macht seine offenen Links beim LESEN
 * tot, wie bei den geteilten Listen: Deaktivieren muss sofort wirken.
 *
 * Entstand die Einladung aus einer Zugangsbitte (#71), kommen die dort schon
 * eingetippten Angaben mit — das Formular füllt sie vor. Alles NULL bei einer
 * persönlichen Einladung, und der LEFT JOIN kostet nichts: `einladung_id` ist
 * in `zugangsbitten` höchstens einmal belegt.
 */
export function getOffeneEinladung(
  db: D1Database,
  id: string,
  heute: string,
): Promise<{
  id: string;
  von_id: number;
  von_name: string;
  bitte_vorname: string | null;
  bitte_nachname: string | null;
  bitte_email: string | null;
} | null> {
  return db
    .prepare(
      `SELECT e.id, e.von_id, u.name AS von_name,
              z.vorname AS bitte_vorname, z.nachname AS bitte_nachname,
              z.email AS bitte_email
       FROM einladungen e
       JOIN users u ON u.id = e.von_id
       LEFT JOIN zugangsbitten z ON z.einladung_id = e.id
       WHERE e.id = ?1 AND e.eingeloest_am IS NULL AND e.widerrufen_am IS NULL
         AND e.bis >= ?2 AND u.disabled = 0`,
    )
    .bind(id, heute)
    .first();
}

/**
 * Das Budget steht IM Statement: `meta.changes === 0` heisst aufgebraucht.
 * Gezählt werden ALLE je erzeugten Zeilen — Widerruf und Ablauf geben nichts
 * zurück, sonst wäre «drei insgesamt» in Wahrheit «drei offene». Nicht gezählt
 * werden die im Amt verschickten (`aus_bitte = 1`, #71): Sie gehören der Runde,
 * nicht dem Konto, das sie ausgelöst hat.
 */
export function einladungInsertStmt(
  db: D1Database,
  eintrag: { id: string; vonId: number; erstellt: string; bis: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO einladungen (id, von_id, erstellt, bis)
       SELECT ?1, ?2, ?3, ?4
       WHERE (SELECT COUNT(*) FROM einladungen WHERE von_id = ?2 AND aus_bitte = 0)
           < (SELECT einladungs_budget FROM users WHERE id = ?2)`,
    )
    .bind(eintrag.id, eintrag.vonId, eintrag.erstellt, eintrag.bis);
}

/**
 * Widerrufen heisst markieren, nicht löschen: Die Zeile bleibt Zähler und
 * Herkunfts-Gedächtnis (Migration 0011). Besitz und Zustand stehen in der
 * WHERE-Klausel — eine schon eingelöste Einladung lässt sich nicht mehr
 * zurückziehen, das entstandene Konto bliebe ja.
 */
export function widerrufStmt(
  db: D1Database,
  id: string,
  vonId: number,
  heute: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE einladungen SET widerrufen_am = ?3
       WHERE id = ?1 AND von_id = ?2 AND eingeloest_am IS NULL AND widerrufen_am IS NULL`,
    )
    .bind(id, vonId, heute);
}

/**
 * Konto anlegen und Einladung entwerten, atomar.
 *
 * Der Claim-Guard steckt als EXISTS im INSERT (siehe Kopfkommentar): Von zwei
 * gleichzeitigen Einlösungen legt genau eine das Konto an — für die andere
 * fügt das INSERT nichts ein und das UPDATE trifft nichts, der Batch «gelingt»
 * leer. Deshalb ist nach dem Batch `results[0].meta.changes === 1` die einzige
 * Wahrheit. `eingeloest_von` kommt über das UNIQUE `name_key` aus derselben
 * Transaktion — `last_insert_rowid()` über Statement-Grenzen wäre eine Wette
 * auf Ausführungsdetails.
 *
 * `must_change_password = 0`: Das Passwort ist selbst gewählt, kein
 * Startpasswort. `verifikation_gesendet_am` wird nur gesetzt, wenn gleich
 * wirklich eine Mail rausgeht — sonst blockierte der «Nochmal senden»-Deckel
 * der Konto-Seite einen Versand, den es nie gab.
 */
export function einloesungsStmts(
  db: D1Database,
  eintrag: {
    einladungId: string;
    heute: string;
    name: string;
    nameKey: string;
    passwortHash: string;
    email: string;
    mailGehtRaus: boolean;
    benachrichtigungWuensche: boolean;
  },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO users
           (name, name_key, password_hash, is_admin, must_change_password,
            email, verifikation_gesendet_am, benachrichtigung_wuensche)
         SELECT ?1, ?2, ?3, 0, 0, ?4,
                CASE WHEN ?5 = 1 THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END, ?6
         WHERE EXISTS (
           SELECT 1 FROM einladungen e JOIN users u ON u.id = e.von_id
           WHERE e.id = ?7 AND e.eingeloest_am IS NULL AND e.widerrufen_am IS NULL
             AND e.bis >= ?8 AND u.disabled = 0
         )`,
      )
      .bind(
        eintrag.name,
        eintrag.nameKey,
        eintrag.passwortHash,
        eintrag.email,
        eintrag.mailGehtRaus ? 1 : 0,
        eintrag.benachrichtigungWuensche ? 1 : 0,
        eintrag.einladungId,
        eintrag.heute,
      ),
    db
      .prepare(
        `UPDATE einladungen
         SET eingeloest_am = ?1,
             eingeloest_von = (SELECT id FROM users WHERE name_key = ?2)
         WHERE id = ?3 AND eingeloest_am IS NULL AND widerrufen_am IS NULL`,
      )
      .bind(eintrag.heute, eintrag.nameKey, eintrag.einladungId),
  ];
}
