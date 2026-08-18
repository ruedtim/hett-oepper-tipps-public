import { getAllAggregates, getAliases, getCategories } from '../lib/db';
import {
  aliasesFileText,
  categoriesFileText,
  noteFileText,
  tipFileText,
  wuenscheFileText,
} from '../lib/dataFormat';
import type { Env } from '../lib/env';
import { requireBackupToken } from '../lib/exportAuth';
import { getAlleWuensche } from '../lib/wuensche';

/**
 * Der komplette Datenbestand im data/-Dateiformat — für den täglichen
 * Backup-Job (.github/workflows/backup.yml).
 *
 * Die Middleware lässt Requests mit Authorization-Header hierher durch; die
 * Autorisierung (Bearer BACKUP_TOKEN) erzwingt requireBackupToken selbst.
 *
 * Die Inhalte kommen als FERTIG SERIALISIERTE Strings: Der Job vergleicht
 * byte-genau mit dem Repo («kein Diff = kein Commit»), das darf nicht vom
 * JSON-Serializer des Workflows abhängen. Fotobytes sind nicht inline —
 * das Manifest (Key, md5, Grösse) reicht zum Abgleich, die Bytes liefert
 * /api/export/photo einzeln.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireBackupToken(request, env);
  if (denied) return denied;

  const db = env.DB as D1Database;
  const fotos = env.FOTOS as R2Bucket;

  const [categories, aliases, aggregates, wuensche] = await Promise.all([
    getCategories(db),
    getAliases(db),
    getAllAggregates(db),
    // Alle Zeilen, auch abgelaufene — wie hier auch geschlossene Tipps stehen.
    // Sonst änderte sich die Datei allein durch den Kalenderwechsel und der
    // Backup-Job committete Tag für Tag ohne echte Änderung.
    getAlleWuensche(db),
  ]);

  const files: { path: string; content: string }[] = [
    { path: 'data/categories.json', content: categoriesFileText(categories) },
    { path: 'data/place-aliases.json', content: aliasesFileText(aliases) },
    { path: 'data/wuensche.json', content: wuenscheFileText(wuensche) },
  ];
  for (const agg of aggregates) {
    files.push({ path: `data/tips/${agg.tip.id}/tip.json`, content: tipFileText(agg.tip) });
    for (const note of agg.notes) {
      files.push({
        path: `data/tips/${agg.tip.id}/notes/${note.id}.json`,
        content: noteFileText(note),
      });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  // Alles ausser trash/ — der Papierkorb gehört nicht ins Backup.
  const photos: { key: string; path: string; md5: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const listed = await fotos.list({ cursor });
    for (const object of listed.objects) {
      if (object.key.startsWith('trash/')) continue;
      photos.push({
        key: object.key,
        path: `public/photos/${object.key}`,
        // Bei einfachen Puts (unsere sind es immer) ist das ETag die MD5-Summe.
        md5: object.etag,
        size: object.size,
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  photos.sort((a, b) => (a.path < b.path ? -1 : 1));

  return Response.json(
    { format: 1, generatedAt: new Date().toISOString(), files, photos },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};
