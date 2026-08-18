import { json, requireAdmin } from '../../lib/admin';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';
import { diffToFiles, getVerlaufEntry } from '../../lib/verlauf';
import type { VerlaufRow } from '../../lib/verlauf';
import type { TipAggregate } from '../../lib/db';

const PAGE_SIZE = 25;

/**
 * «Nur Löschungen» — der Filter, der Vandalismus nicht untergehen lässt.
 *
 * Bewusst nicht `kind = 'loeschung'` allein: Ein «Rückgängig» auf einen neuen
 * Tipp löscht ihn genauso, steht aber unter `kind = 'rueckgaengig'`. Was zählt,
 * ist der leere Nachher-Snapshot — genau das heisst «danach war es weg», und
 * für Kategorien-Einträge (Arrays) wird er nie leer. Beides zusammen, damit der
 * Filter auch dann hält, wenn eine Löschung einmal doch einen Nachher-Stand
 * mitbrächte.
 */
const NUR_LOESCHUNGEN = `WHERE kind = 'loeschung' OR snapshot_after IS NULL`;

/**
 * Die Bearbeitungshistorie — jetzt aus der Verlaufstabelle statt aus dem
 * Git-Log. Seit alle direkt schreiben dürfen, ist das das Sicherheitsnetz:
 * Wer aus Versehen einen Tipp gelöscht hat, wird hier gefunden und
 * zurückgenommen.
 *
 * Das Antwortformat ist absichtlich das alte geblieben (`sha` ist heute die
 * Verlaufs-ID als String) — die Oberfläche musste dafür kaum angepasst werden.
 * Zu beachten: Der Verlauf zeigt nur App-Handlungen; wer Daten von Hand per
 * `wrangler d1 execute` ändert, taucht hier nicht auf.
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ request, env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const sha = url.searchParams.get('sha');
  if (sha) {
    if (!/^\d{1,10}$/.test(sha)) return json({ error: 'Unbekannter Eintrag.' }, 400);
    const entry = await getVerlaufEntry(db, Number(sha));
    if (!entry) return json({ error: 'Unbekannter Eintrag.' }, 404);
    return json({ files: filesFor(entry) });
  }

  const page = Math.max(1, Number(url.searchParams.get('seite') ?? '1') || 1);
  // Unbekannte Werte zeigen alles: Ein Filter, den die Oberfläche nicht kennt,
  // soll den Verlauf nicht verstecken.
  const nurLoeschungen = url.searchParams.get('art') === 'loeschungen';

  // Eine Zeile mehr abfragen als angezeigt wird — so kostet «gibt es noch
  // ältere?» keine zweite Abfrage.
  const rows = await db
    .prepare(
      `SELECT id, at, kind, title, by, note FROM verlauf
       ${nurLoeschungen ? NUR_LOESCHUNGEN : ''}
       ORDER BY id DESC LIMIT ?1 OFFSET ?2`,
    )
    .bind(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all<Pick<VerlaufRow, 'id' | 'at' | 'kind' | 'title' | 'by' | 'note'>>();

  return json({
    page,
    art: nurLoeschungen ? 'loeschungen' : 'alle',
    hasMore: rows.results.length > PAGE_SIZE,
    entries: rows.results.slice(0, PAGE_SIZE).map((row) => ({
      sha: String(row.id),
      date: row.at,
      // Die Art stand bisher nur verklausuliert im Titel («Gelöscht: …»); die
      // Oberfläche macht daraus jetzt ein Etikett, damit eine Löschung auch in
      // der ungefilterten Liste sofort auffällt.
      kind: row.kind,
      title: row.title,
      by: row.by,
      note: row.note,
    })),
  });
};

/** «Was wurde geändert?» — synthetisiert aus den Snapshots die alte Dateiliste. */
function filesFor(entry: VerlaufRow): { path: string; status: string }[] {
  const before = entry.snapshot_before ? (JSON.parse(entry.snapshot_before) as unknown) : null;
  const after = entry.snapshot_after ? (JSON.parse(entry.snapshot_after) as unknown) : null;

  // Kategorien-Snapshots sind Arrays — auch bei einem Rückgängig von Kategorien.
  if (entry.kind === 'kategorien' || Array.isArray(before) || Array.isArray(after)) {
    return [{ path: 'data/categories.json', status: 'modified' }];
  }
  return diffToFiles(before as TipAggregate | null, after as TipAggregate | null);
}
