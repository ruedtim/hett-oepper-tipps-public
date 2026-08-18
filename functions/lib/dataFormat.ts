/**
 * Deterministische Datei-Serialisierung für Export und Backup.
 *
 * Der Backup-Job committet nur bei Änderungen — das funktioniert nur, wenn
 * derselbe Datenbestand byte-genau denselben Dateiinhalt ergibt. Deshalb ist
 * dieses Modul die einzige Stelle, die die data/-Dateiformate schreibt:
 * feste Schlüsselreihenfolge (kommt aus TipFile/NoteFile), zwei Leerzeichen
 * Einrückung, Zeilenumbruch am Ende, Aliasse alphabetisch, Kategorien eine
 * Zeile pro Eintrag (lesbare Diffs, wie es früher putCategories tat).
 */

import type { Category, NoteFile, TipFile } from './db';
import type { WunschFile } from './wuensche';

export function tipFileText(tip: TipFile): string {
  return `${JSON.stringify(tip, null, 2)}\n`;
}

/**
 * data/wuensche.json — eine Datei für alle, kein Ordner pro Eintrag.
 *
 * Die Ordnerstruktur der Tipps kam von Merge-Konflikten paralleler PRs; die
 * gibt es seit der D1-Umstellung nicht mehr, und Wünsche sind ohnehin wenige
 * und kurzlebig. Sortiert wird in der Abfrage (ORDER BY bis, id), damit die
 * Datei ohne echte Änderung byte-gleich bleibt.
 */
export function wuenscheFileText(wuensche: WunschFile[]): string {
  return `${JSON.stringify(wuensche, null, 2)}\n`;
}

export function noteFileText(note: NoteFile): string {
  return `${JSON.stringify(note, null, 2)}\n`;
}

export function categoriesFileText(categories: Category[]): string {
  const lines = categories.map(
    (c) =>
      `  { "id": ${JSON.stringify(c.id)}, "label": ${JSON.stringify(c.label)}, ` +
      `"emoji": ${JSON.stringify(c.emoji)}, "color": ${JSON.stringify(c.color)}, "active": ${c.active} }`,
  );
  return `[\n${lines.join(',\n')}\n]\n`;
}

/** Muss wörtlich dem Kopf von data/place-aliases.json entsprechen. */
const ALIASES_COMMENT = [
  'Führt unterschiedliche Schreibweisen desselben Ortes zusammen und legt die angezeigte Form fest.',
  'Schlüssel = searchKey(getippte Schreibweise) aus shared/normalize.mjs. Wert = so soll der Ort heissen.',
  'Nur nötig, wo die automatische Normalisierung nicht reicht: sie fängt Akzente und Umlaute bereits ab',
  "('Zürich'/'Zuerich'/'Zurich' fallen von selbst zusammen), aber keine echten Exonyme wie Rom/Roma.",
  'Die Datei wächst mit der Zeit — beim Freigeben fällt auf, wenn ein Ort doppelt auftaucht.',
];

export function aliasesFileText(aliases: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(aliases).sort()) sorted[key] = aliases[key] as string;
  return `${JSON.stringify({ $comment: ALIASES_COMMENT, aliases: sorted }, null, 2)}\n`;
}
