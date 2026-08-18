#!/usr/bin/env node
/**
 * Spielt den Stand aus data/ (und public/photos/) in die D1-Datenbank ein.
 *
 * Das ist der EINZIGE Weg von Git zurück in die Datenbank — absichtlich ein
 * lokales Skript und kein Endpunkt: Ein HTTP-Import wäre ein stehender Pfad,
 * über den alte Daten die neuen überschreiben könnten. Hier dagegen sitzt der
 * Besitzer davor, sieht die Zahlen und bestätigt ausdrücklich.
 *
 *   node scripts/restore-to-d1.mjs             gegen die lokale Simulation
 *   node scripts/restore-to-d1.mjs --remote    gegen die echte Datenbank
 *   node scripts/restore-to-d1.mjs --preview   gegen die Preview-DB (mit/ohne --remote)
 *
 * Schutzmassnahmen bei --remote:
 *   1. data/ wird zuerst validiert (dasselbe Netz wie in der CI).
 *   2. Es wird angezeigt, wie viele Tipps DB und data/ enthalten, und die
 *      Bestätigung «ERSETZE <X> DURCH <Y>» muss wörtlich getippt werden.
 *   3. Vorher wird automatisch ein SQL-Export der DB gesichert
 *      (backup-vor-restore-<zeitstempel>.sql, gitignored lassen!).
 *
 * Konten (users) und Verlauf (verlauf) werden NIE angefasst — das Skript
 * ersetzt nur die Inhalte: categories, place_aliases, tips, notes, wuensche,
 * Fotos. Voraussetzung: Die Migrationen sind bereits angewendet.
 *
 * Bekannte Grenze: Fotos werden hochgeladen, aber überzählige R2-Objekte
 * (Fotos, die es im wiederhergestellten Stand nicht mehr gibt) bleiben im
 * Bucket liegen — wrangler kann Objekte nicht auflisten. Sie stören nur als
 * Ballast im nächsten Backup; bei Bedarf im Cloudflare-Dashboard aufräumen.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { searchKey } from '../shared/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TIPS = join(DATA, 'tips');
const PHOTOS = join(ROOT, 'public', 'photos');

const REMOTE = process.argv.includes('--remote');
const PREVIEW = process.argv.includes('--preview');

// Namen wie in wrangler.toml — bei Änderungen dort auch hier nachziehen.
// Die Preview-DB ist nur unter [env.preview] definiert; ohne «--env preview»
// findet wrangler ihren Namen nicht.
const DB_NAME = PREVIEW ? 'hett-oepper-tipps-preview' : 'hett-oepper-tipps';
const BUCKET = PREVIEW ? 'hett-oepper-fotos-preview' : 'hett-oepper-fotos';
const TARGET_FLAG = REMOTE ? '--remote' : '--local';
const ENV_ARGS = PREVIEW ? ['--env', 'preview'] : [];

function run(args, options = {}) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\n✖  «wrangler ${args.join(' ')}» ist fehlgeschlagen.`);
    process.exit(1);
  }
  return result.stdout ?? '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const sql = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;

// ------------------------------------------------------------ 1. Validieren ---

console.log('Validiere data/ …');
const check = spawnSync('node', [join(ROOT, 'scripts', 'build-data.mjs'), '--check'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (check.status !== 0) {
  console.error('\n✖  data/ ist nicht gültig — nichts eingespielt.');
  process.exit(1);
}

// ---------------------------------------------------------------- 2. Lesen ---

const categories = readJson(join(DATA, 'categories.json'));
const aliases = readJson(join(DATA, 'place-aliases.json')).aliases ?? {};

// Optional: Ein Repo-Stand von vor dem Wunsch-Feature hat die Datei nicht.
const wunschPath = join(DATA, 'wuensche.json');
const wuensche = existsSync(wunschPath) ? readJson(wunschPath) : [];

const tipDirs = existsSync(TIPS)
  ? readdirSync(TIPS).filter((d) => !d.startsWith('.') && statSync(join(TIPS, d)).isDirectory())
  : [];

const tips = [];
for (const dir of tipDirs) {
  const tip = readJson(join(TIPS, dir, 'tip.json'));
  const notesDir = join(TIPS, dir, 'notes');
  const notes = readdirSync(notesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(join(notesDir, f)));
  tips.push({ tip, notes });
}

// ------------------------------------------------- 3. Zahlen und Bestätigung ---

const countOut = run(
  ['d1', 'execute', DB_NAME, ...ENV_ARGS, TARGET_FLAG, '--json', '--command', 'SELECT COUNT(*) AS n FROM tips'],
  { capture: true },
);
let dbCount = 0;
try {
  const parsed = JSON.parse(countOut.slice(countOut.indexOf('[')));
  dbCount = parsed[0]?.results?.[0]?.n ?? 0;
} catch {
  console.error('✖  Konnte die Datenbank nicht abfragen. Migrationen schon angewendet?');
  process.exit(1);
}

console.log(`\nZiel: ${DB_NAME} (${REMOTE ? 'ECHT, in der Cloud' : 'lokale Simulation'})`);
console.log(`Die Datenbank enthält ${dbCount} Tipps, data/ enthält ${tips.length}.`);

if (REMOTE) {
  const phrase = `ERSETZE ${dbCount} DURCH ${tips.length}`;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Zum Bestätigen wörtlich tippen: «${phrase}»\n> `, resolve),
  );
  rl.close();
  if (answer.trim() !== phrase) {
    console.error('Abgebrochen — nichts geändert.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `backup-vor-restore-${stamp}.sql`;
  console.log(`Sichere den aktuellen DB-Stand nach ${backupFile} …`);
  run(['d1', 'export', DB_NAME, ...ENV_ARGS, '--remote', '--output', backupFile]);
}

// ------------------------------------------------------------ 4. SQL bauen ---

// Die verweisenden Tabellen zuerst, damit die Fremdschlüssel nie kurz ins
// Leere zeigen.
const statements = [
  'DELETE FROM wunsch_tipps;',
  'DELETE FROM notes;',
  'DELETE FROM tips;',
  'DELETE FROM wuensche;',
  'DELETE FROM place_aliases;',
  'DELETE FROM categories;',
];

categories.forEach((c, index) => {
  statements.push(
    `INSERT INTO categories (id, label, emoji, color, active, position) VALUES ` +
      `(${sql(c.id)}, ${sql(c.label)}, ${sql(c.emoji)}, ${sql(c.color)}, ${c.active ? 1 : 0}, ${index});`,
  );
});

for (const [key, label] of Object.entries(aliases)) {
  statements.push(`INSERT INTO place_aliases (key, label) VALUES (${sql(key)}, ${sql(label)});`);
}

for (const { tip, notes } of tips) {
  statements.push(
    `INSERT INTO tips (id, schema, name, country, place, categories, address, link, lat, lng, closed, added) VALUES ` +
      `(${sql(tip.id)}, ${tip.schema ?? 1}, ${sql(tip.name)}, ${sql(tip.country)}, ${sql(tip.place)}, ` +
      `${sql(JSON.stringify(tip.categories))}, ${sql(tip.address ?? null)}, ${sql(tip.link ?? null)}, ` +
      `${tip.coords ? tip.coords.lat : 'NULL'}, ${tip.coords ? tip.coords.lng : 'NULL'}, ` +
      `${tip.closed ? 1 : 0}, ${sql(tip.added)});`,
  );
  for (const note of notes) {
    statements.push(
      `INSERT INTO notes (tip_id, id, by, text, photo, added) VALUES ` +
        `(${sql(tip.id)}, ${sql(note.id)}, ${sql(note.by)}, ${sql(note.text)}, ` +
        `${sql(note.photo ?? null)}, ${sql(note.added)});`,
    );
  }
}

// `von_key` steht nicht in der Datei, sondern wird hier neu gerechnet: Er ist
// abgeleitet und würde im Backup nur die Gelegenheit schaffen, dass er nicht
// mehr zu `von` passt. `vorgang` bleibt NULL — Vorgangsschlüssel sind
// Transportbuchhaltung, kein Inhalt, und stehen darum wie
// verlauf.idempotency_key nicht im Spiegel.
for (const w of wuensche) {
  statements.push(
    `INSERT INTO wuensche (id, schema, von, von_key, land, ort, kategorien, text, bis, erstellt, erfuellt_am, erfuellt_von, vorgang) VALUES ` +
      // `ort` fehlt in der Datei, wenn der Wunsch dem ganzen Land gilt.
      `(${sql(w.id)}, ${w.schema ?? 1}, ${sql(w.von)}, ${sql(searchKey(w.von))}, ${sql(w.land)}, ${sql(w.ort ?? null)}, ` +
      `${sql(JSON.stringify(w.kategorien))}, ${sql(w.text ?? null)}, ${sql(w.bis)}, ${sql(w.erstellt)}, ` +
      `${sql(w.erfuellt?.am ?? null)}, ${sql(w.erfuellt?.von ?? null)}, NULL);`,
  );
  // Die Zuordnungen stehen im Wunsch, nicht in einer eigenen Datei — sie
  // gehören ihm und verschwinden mit ihm. Die Tipps sind oben schon
  // eingefügt, der Fremdschlüssel greift also.
  for (const tipId of w.tipps ?? []) {
    statements.push(
      `INSERT INTO wunsch_tipps (wunsch_id, tip_id) VALUES (${sql(w.id)}, ${sql(tipId)});`,
    );
  }
}

// -------------------------------------------------------- 5. Ausführen ---

const tmpFile = join(tmpdir(), `restore-d1-${Date.now()}.sql`);
writeFileSync(tmpFile, statements.join('\n'), 'utf8');
try {
  console.log(`\nSpiele ${statements.length} Statements ein …`);
  run(['d1', 'execute', DB_NAME, ...ENV_ARGS, TARGET_FLAG, '--yes', '--file', tmpFile]);
} finally {
  unlinkSync(tmpFile);
}

// ------------------------------------------------------------- 6. Fotos ---

if (existsSync(PHOTOS)) {
  for (const dir of readdirSync(PHOTOS).filter((d) => !d.startsWith('.'))) {
    for (const file of readdirSync(join(PHOTOS, dir)).filter((f) => !f.startsWith('.'))) {
      const key = `${dir}/${file}`;
      console.log(`Foto → r2://${BUCKET}/${key}`);
      run(['r2', 'object', 'put', `${BUCKET}/${key}`, TARGET_FLAG, '--file', join(PHOTOS, dir, file)]);
    }
  }
}

const noteCount = tips.reduce((sum, t) => sum + t.notes.length, 0);
const wunschTeil =
  wuensche.length > 0 ? `, ${wuensche.length} ${wuensche.length === 1 ? 'Wunsch' : 'Wünsche'}` : '';
console.log(
  `\n✔  Eingespielt: ${tips.length} Tipps, ${noteCount} Notizen, ${categories.length} Kategorien${wunschTeil}.`,
);
