#!/usr/bin/env node
/**
 * Holt den Datenbestand von /api/export und legt ihn als data/ und
 * public/photos/ ins Arbeitsverzeichnis — der Schreibteil des täglichen
 * Backups (.github/workflows/backup.yml). Committet wird dort, nicht hier.
 *
 * Umgebung:
 *   EXPORT_URL     https://<domain>/api/export
 *   BACKUP_TOKEN   der Bearer-Token (Cloudflare-Secret, hier GitHub-Secret)
 *   FORCE          'true' übersteuert den Schrumpf-Wächter
 *
 * Der Schrumpf-Wächter ist die Kernabsicherung der Einweg-Regel: Liefert der
 * Export 0 Tipps oder >30 % weniger als im Repo stehen, wird NICHTS
 * geschrieben und der Lauf schlägt fehl — eine leergelaufene oder halb
 * migrierte Datenbank darf das Backup nicht leeren. Absichtliche grosse
 * Löschaktionen bestätigt man mit einem manuellen Lauf (workflow_dispatch,
 * force=true).
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TIPS = join(DATA, 'tips');
const PHOTOS = join(ROOT, 'public', 'photos');

const EXPORT_URL = process.env.EXPORT_URL ?? '';
const TOKEN = process.env.BACKUP_TOKEN ?? '';
const FORCE = process.env.FORCE === 'true';

if (!EXPORT_URL || !TOKEN) {
  console.error('EXPORT_URL und BACKUP_TOKEN müssen gesetzt sein.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };

async function fetchWithRetry(url, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`Versuch ${attempt} fehlgeschlagen (${error.message}) — warte 15 s.`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

console.log(`Hole ${EXPORT_URL} …`);
const exported = await (await fetchWithRetry(EXPORT_URL)).json();
if (exported.format !== 1 || !Array.isArray(exported.files) || !Array.isArray(exported.photos)) {
  console.error('✖  Unerwartetes Export-Format.');
  process.exit(1);
}

// ------------------------------------------------------- Pfade absichern ---
// Der Export ist eine authentifizierte, eigene API — aber ein Skript, das
// Dateien löscht und schreibt, prüft seine Eingaben trotzdem.

const FILE_RE = /^data\/[a-zA-Z0-9._/-]+$/;
const PHOTO_RE = /^public\/photos\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg)$/;

for (const file of exported.files) {
  if (!FILE_RE.test(file.path) || file.path.includes('..') || typeof file.content !== 'string') {
    console.error(`✖  Verdächtiger Dateipfad im Export: ${file.path}`);
    process.exit(1);
  }
}
for (const photo of exported.photos) {
  if (!PHOTO_RE.test(photo.path) || photo.path.includes('..')) {
    console.error(`✖  Verdächtiger Fotopfad im Export: ${photo.path}`);
    process.exit(1);
  }
}

// ------------------------------------------------------ Schrumpf-Wächter ---

const exportTips = exported.files.filter((f) => /^data\/tips\/[^/]+\/tip\.json$/.test(f.path)).length;
const repoTips = existsSync(TIPS)
  ? readdirSync(TIPS).filter((d) => !d.startsWith('.') && statSync(join(TIPS, d)).isDirectory()).length
  : 0;

if (!FORCE && (exportTips === 0 || (repoTips > 0 && exportTips < repoTips * 0.7))) {
  console.error(
    `✖  Schrumpf-Wächter: Der Export enthält ${exportTips} Tipps, das Repo ${repoTips}. ` +
      'Nichts geschrieben. Ist das Absicht (grosse Aufräumaktion), den Workflow ' +
      'manuell mit force=true starten.',
  );
  process.exit(1);
}

// ---------------------------------------------------------- data/ ersetzen ---

rmSync(DATA, { recursive: true, force: true });
for (const file of exported.files) {
  const target = join(ROOT, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content, 'utf8');
}

// ------------------------------------------------- Fotos per md5 abgleichen ---

/** Lokale Bestandsaufnahme: Repo-Pfad → md5. */
const local = new Map();
if (existsSync(PHOTOS)) {
  for (const dir of readdirSync(PHOTOS).filter((d) => !d.startsWith('.'))) {
    for (const file of readdirSync(join(PHOTOS, dir)).filter((f) => !f.startsWith('.'))) {
      const path = `public/photos/${dir}/${file}`;
      local.set(path, createHash('md5').update(readFileSync(join(ROOT, path))).digest('hex'));
    }
  }
}

const wanted = new Map(exported.photos.map((photo) => [photo.path, photo]));
let downloaded = 0;

for (const [path, photo] of wanted) {
  if (local.get(path) === photo.md5) continue;
  const url = new URL(EXPORT_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/photo`;
  url.searchParams.set('key', photo.key);
  const bytes = Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
  const target = join(ROOT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  downloaded += 1;
}

let removed = 0;
for (const path of local.keys()) {
  if (wanted.has(path)) continue;
  unlinkSync(join(ROOT, path));
  removed += 1;
}
// Leer gewordene Foto-Ordner mitnehmen — Git kennt keine leeren Ordner,
// aber der nächste Lauf soll sie nicht wieder durchkämmen müssen.
if (existsSync(PHOTOS)) {
  for (const dir of readdirSync(PHOTOS).filter((d) => !d.startsWith('.'))) {
    if (readdirSync(join(PHOTOS, dir)).length === 0) rmdirSync(join(PHOTOS, dir));
  }
  if (readdirSync(PHOTOS).length === 0) rmdirSync(PHOTOS);
}

const noteFiles = exported.files.filter((f) => /\/notes\//.test(f.path)).length;
console.log(
  `✔  ${exportTips} Tipps, ${noteFiles} Notizen übernommen; ` +
    `${wanted.size} Fotos im Bestand (${downloaded} geladen, ${removed} entfernt).`,
);
