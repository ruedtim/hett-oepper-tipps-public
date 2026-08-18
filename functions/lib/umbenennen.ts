/**
 * Ein Konto umbenennen.
 *
 * Der Anzeigename war einmal die Identität; seit migrations/0006 ist er es
 * nicht mehr. Stabil ist `users.id` (daran hängt schon das Sitzungs-Cookie),
 * und was ein Konto je an Schlüsseln getragen hat, steht in `alte_namen`.
 *
 * Was hier NICHT passiert, und warum:
 *
 * - **Notizen werden nicht umgeschrieben.** `notes.by` und die Notiz-ID
 *   («2026-07-26-sara») sind Teil des Backup-Spiegels, die ID ist zudem
 *   unveränderlich (sie steckt auch in Foto-Dateinamen und R2-Keys). Der neue
 *   Name erscheint trotzdem überall: `buildAppData` löst beim Ausliefern auf.
 * - **Der Verlauf wird nicht umgeschrieben.** `verlauf.by` ist ein Protokoll:
 *   Es soll sagen, wer damals handelte, unter dem Namen von damals.
 * - **Wünsche werden sehr wohl umgeschrieben**, in derselben Transaktion. Sie
 *   stehen im Spiegel, und `scripts/restore-to-d1.mjs` rechnet `von_key` beim
 *   Wiederherstellen aus `von` neu — nur den Schlüssel nachzuziehen wäre nach
 *   dem nächsten Restore wieder weg. Ein Wunsch gehört ausserdem genau einer
 *   Person, ist vergänglich und trägt keine Beiträge Dritter; ihn mitzuführen
 *   ist deshalb kein Eingriff in fremde Geschichte, anders als bei Notizen.
 */

import { searchKey } from '../../shared/normalize.mjs';
import { alteNamenOf, nameKeysOf } from './users';
import type { AlterName, UserRow } from './users';

export const MAX_NAME_LENGTH = 40;

/** Eine abgelehnte Umbenennung: fertige Meldung samt HTTP-Status. */
export interface Namensfehler {
  text: string;
  status: number;
}

/**
 * Prüft einen gewünschten Namen — für die Umbenennung wie fürs Anlegen.
 *
 * `ausserId` ist das Konto, das den Namen bekommen soll (beim Anlegen 0): Nur
 * es darf seinen eigenen Schlüssel schon tragen.
 *
 * Geprüft wird gegen die aktuellen Schlüssel ALLER Konten und gegen die früher
 * getragenen. Letzteres ist der Kern: Ohne diese Hälfte könnte man den frei
 * gewordenen Namen einer anderen Person annehmen und bekäme über den
 * `searchKey`-Vergleich in `submit.ts` deren alte Beiträge zum Ändern und
 * Löschen. «Gast» sperrt schon der UNIQUE-Index der Gäste-Zeile.
 */
export async function pruefeNeuenNamen(
  db: D1Database,
  name: string,
  ausserId: number,
): Promise<Namensfehler | null> {
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { text: `Bitte einen Namen mit höchstens ${MAX_NAME_LENGTH} Zeichen.`, status: 400 };
  }

  const key = searchKey(name);
  if (!key) return { text: `«${name}» ergibt keinen brauchbaren Anmeldenamen.`, status: 400 };

  // Beide Hälften in einer Abfrage: ein D1-Read statt zwei. Verglichen wird das
  // `key`-Feld der Einträge — die Schreibweise daneben dient nur der Anzeige und
  // träfe «Sära» nicht, wenn jemand «saera» eintippt.
  const treffer = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM users WHERE id != ?2 AND name_key = ?1) AS aktuell,
         EXISTS (SELECT 1 FROM users u, json_each(u.alte_namen) a
                  WHERE u.id != ?2 AND json_extract(a.value, '$.key') = ?1) AS frueher`,
    )
    .bind(key, ausserId)
    .first<{ aktuell: number; frueher: number }>();

  if (treffer?.aktuell === 1) {
    return { text: 'Diesen Namen (oder einen zum Verwechseln ähnlichen) gibt es schon.', status: 409 };
  }
  if (treffer?.frueher === 1) {
    return {
      text: 'Diesen Namen hat früher jemand anderes getragen — seine alten Beiträge hängen noch daran.',
      status: 409,
    };
  }

  return null;
}

/**
 * Die Umbenennung als ein Batch: Konto und Wünsche ändern sich zusammen oder
 * gar nicht.
 *
 * Kein Verlaufseintrag — Kontenhandlungen stehen nie im Verlauf (der kennt nur
 * Tipps und Kategorien, und `verlauf.kind` hat einen CHECK-Constraint). Kein
 * frisches Cookie — der Passwort-Hash bleibt, der Fingerabdruck also auch: Wer
 * sich umbenennt, bleibt auf allen Geräten angemeldet.
 */
export function umbenennungsStmts(
  db: D1Database,
  user: UserRow,
  neuerName: string,
): D1PreparedStatement[] {
  const neuerKey = searchKey(neuerName);
  const bisherigeKeys = nameKeysOf(user);

  // Der bisherige Name kommt vorne dazu, die schon bekannten dahinter — so steht
  // der zuletzt getragene zuoberst, was in der Kontenverwaltung die nützlichere
  // Reihenfolge ist.
  //
  // Nur die Schreibweise geändert («sara» → «Sara»)? Dann kommt kein Eintrag
  // dazu. Und wer zu einem früheren Namen zurückkehrt, holt ihn aus der Liste
  // heraus statt ihn doppelt zu führen.
  const gesehen = new Set<string>();
  const alte: AlterName[] = [];
  for (const eintrag of [{ key: user.name_key, name: user.name }, ...alteNamenOf(user)]) {
    if (eintrag.key === neuerKey || gesehen.has(eintrag.key)) continue;
    gesehen.add(eintrag.key);
    alte.push(eintrag);
  }

  const platzhalter = bisherigeKeys.map((_, index) => `?${index + 3}`).join(', ');

  return [
    db
      .prepare('UPDATE users SET name = ?1, name_key = ?2, alte_namen = ?3 WHERE id = ?4')
      .bind(neuerName, neuerKey, JSON.stringify(alte), user.id),
    // Trifft auch Wünsche, die noch unter einem vorletzten Namen laufen: Nach
    // zwei Umbenennungen ohne diese Liste hinge der älteste Wunsch fest.
    db
      .prepare(`UPDATE wuensche SET von = ?1, von_key = ?2 WHERE von_key IN (${platzhalter})`)
      .bind(neuerName, neuerKey, ...bisherigeKeys),
  ];
}
