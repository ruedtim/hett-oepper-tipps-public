#!/usr/bin/env node
/**
 * Prüft den Datenbestand unter data/ (und die Fotos unter public/photos/).
 *
 * Seit der D1-Umstellung ist data/ nicht mehr die Quelle der App, sondern ihr
 * tägliches Backup (.github/workflows/backup.yml) — und dieses Skript ist das
 * Sicherheitsnetz davor: Der Backup-Workflow lässt es VOR jedem Commit laufen
 * und committet einen kaputten Export gar nicht erst. Es bricht mit einer
 * verständlichen Meldung ab, sobald eine Datei nicht zum Schema passt, eine
 * Kategorie nicht existiert, ein Foto fehlt oder ein Ordnername nicht zur ID
 * passt. Geschrieben wird nichts (das frühere public/data.json gibt es nicht
 * mehr — die App liest aus /api/data).
 *
 *   node scripts/build-data.mjs   (»--check« wird noch akzeptiert, ist aber Standard)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// Nicht 'ajv': der Standard-Einstiegspunkt kann nur Draft-07, unsere Schemas sind 2020-12.
// Und ajv gehört weiterhin NUR hierher, nie in die Functions (new Function ist
// in Workers verboten) — serverseitig prüft functions/lib/submission.ts von Hand.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { resolvePlace, searchKey, looseKey } from '../shared/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TIPS = join(DATA, 'tips');
const PHOTOS = join(ROOT, 'public', 'photos');

/** Gesammelte Probleme. Wir brechen erst am Ende ab, damit man alle auf einmal sieht. */
const problems = [];
const warnings = [];

const fail = (where, message) => problems.push(`${where}\n    ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Kein gültiges JSON — ${error.message}`);
  }
}

function ajvErrors(validate) {
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath || '(Wurzel)'} ${e.message}${e.params?.allowedValues ? ` (erlaubt: ${e.params.allowedValues.join(', ')})` : ''}`)
    .join('\n    ');
}

// ---------------------------------------------------------------- Schemas ---

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateTip = ajv.compile(readJson(join(ROOT, 'schema', 'tip.schema.json')));
const validateNote = ajv.compile(readJson(join(ROOT, 'schema', 'note.schema.json')));
const validateCategories = ajv.compile(readJson(join(ROOT, 'schema', 'category.schema.json')));
const validateWuensche = ajv.compile(readJson(join(ROOT, 'schema', 'wunsch.schema.json')));

// ------------------------------------------------------------- Kategorien ---

const categories = readJson(join(DATA, 'categories.json'));
if (!validateCategories(categories)) {
  fail('data/categories.json', ajvErrors(validateCategories));
}

const categoryIds = new Set(categories.map((c) => c.id));
if (categoryIds.size !== categories.length) {
  fail('data/categories.json', 'Doppelte Kategorie-ID.');
}
const activeCategoryIds = new Set(categories.filter((c) => c.active).map((c) => c.id));

// ----------------------------------------------------------- Orts-Aliasse ---

const aliasFile = readJson(join(DATA, 'place-aliases.json'));
const aliases = aliasFile.aliases ?? {};
for (const [key, label] of Object.entries(aliases)) {
  if (searchKey(key) !== key) {
    fail('data/place-aliases.json', `Schlüssel «${key}» ist kein gültiger Suchschlüssel — erwartet «${searchKey(key)}».`);
  }
  if (typeof label !== 'string' || !label.trim()) {
    fail('data/place-aliases.json', `Alias «${key}» hat keinen Zielnamen.`);
  }
}

// ---------------------------------------------------------------- Wünsche ---

// Die Datei ist optional: Sie entsteht erst mit dem ersten Export, und ein
// Repo-Stand von vor diesem Feature hat sie nicht.
const wunschPath = join(DATA, 'wuensche.json');
let wuensche = [];
if (existsSync(wunschPath)) {
  wuensche = readJson(wunschPath);
  if (!validateWuensche(wuensche)) {
    fail('data/wuensche.json', ajvErrors(validateWuensche));
    wuensche = [];
  }

  const seenWunschIds = new Set();
  for (const wunsch of wuensche) {
    if (seenWunschIds.has(wunsch.id)) {
      fail('data/wuensche.json', `ID «${wunsch.id}» kommt mehrfach vor.`);
    }
    seenWunschIds.add(wunsch.id);

    // Der Ort ist optional (ein Wunsch darf dem ganzen Land gelten). Steht
    // einer da, muss er einen Schlüssel ergeben.
    if (wunsch.ort !== undefined && !searchKey(wunsch.ort)) {
      fail('data/wuensche.json', `Ort «${wunsch.ort}» ergibt keinen verwertbaren Schlüssel.`);
    }

    // Harter Fehler wie bei den Tipps: Eine tote Referenz bräche den nächsten
    // Export. Dass es nicht dazu kommt, sichert categoriesInUse() in
    // functions/lib/db.ts — dort zählen Wünsche mit.
    for (const categoryId of wunsch.kategorien) {
      if (!categoryIds.has(categoryId)) {
        fail(
          'data/wuensche.json',
          `Unbekannte Kategorie «${categoryId}» im Wunsch «${wunsch.id}». Bekannt sind: ${[...categoryIds].join(', ')}.`,
        );
      }
    }
  }
}

/**
 * Zugeordnete Tipps prüfen wir erst NACH den Tipps selbst — vorher gibt es
 * seenIds noch nicht. Der Aufruf steht darum weiter unten.
 */
function pruefeWunschTipps(seenTipIds) {
  for (const wunsch of wuensche) {
    for (const tipId of wunsch.tipps ?? []) {
      if (!seenTipIds.has(tipId)) {
        fail(
          'data/wuensche.json',
          `Der Wunsch «${wunsch.id}» verweist auf den Tipp «${tipId}», den es nicht gibt.`,
        );
      }
    }
  }
}

// ------------------------------------------------------------------ Tipps ---

const tipDirs = existsSync(TIPS)
  ? readdirSync(TIPS).filter((entry) => !entry.startsWith('.') && statSync(join(TIPS, entry)).isDirectory())
  : [];

const tips = [];
const seenIds = new Set();

for (const dir of tipDirs) {
  const where = `data/tips/${dir}`;
  const tipPath = join(TIPS, dir, 'tip.json');

  if (!existsSync(tipPath)) {
    fail(where, 'tip.json fehlt.');
    continue;
  }

  let tip;
  try {
    tip = readJson(tipPath);
  } catch (error) {
    fail(`${where}/tip.json`, error.message);
    continue;
  }

  if (!validateTip(tip)) {
    fail(`${where}/tip.json`, ajvErrors(validateTip));
    continue;
  }

  // Der Ordnername ist die ID. macOS ist case-insensitiv, der Linux-Build nicht —
  // ohne diesen Test läuft «Café-Central» lokal und bricht erst in der Cloud.
  if (tip.id !== dir) {
    fail(where, `Ordner heisst «${dir}», die ID im tip.json ist «${tip.id}». Beides muss identisch sein.`);
    continue;
  }
  if (dir !== dir.toLowerCase()) {
    fail(where, 'Ordnername enthält Grossbuchstaben. Nur Kleinbuchstaben, Ziffern und Bindestriche.');
    continue;
  }
  if (seenIds.has(tip.id)) {
    fail(where, `ID «${tip.id}» kommt mehrfach vor.`);
    continue;
  }
  seenIds.add(tip.id);

  for (const categoryId of tip.categories) {
    if (!categoryIds.has(categoryId)) {
      fail(where, `Unbekannte Kategorie «${categoryId}». Bekannt sind: ${[...categoryIds].join(', ')}.`);
    } else if (!activeCategoryIds.has(categoryId)) {
      warn(where, `nutzt die deaktivierte Kategorie «${categoryId}» — der Tipp bleibt sichtbar, ist aber nicht filterbar.`);
    }
  }

  // ------------------------------------------------------------- Notizen ---

  const notesDir = join(TIPS, dir, 'notes');
  const noteFiles = existsSync(notesDir)
    ? readdirSync(notesDir).filter((f) => f.endsWith('.json')).sort()
    : [];

  if (noteFiles.length === 0) {
    fail(where, 'Keine Notiz vorhanden. Jeder Tipp braucht mindestens die ursprüngliche Empfehlung.');
    continue;
  }

  const notes = [];
  for (const file of noteFiles) {
    const noteWhere = `${where}/notes/${file}`;
    let note;
    try {
      note = readJson(join(notesDir, file));
    } catch (error) {
      fail(noteWhere, error.message);
      continue;
    }

    if (!validateNote(note)) {
      fail(noteWhere, ajvErrors(validateNote));
      continue;
    }
    if (note.id !== basename(file, '.json')) {
      fail(noteWhere, `Dateiname und ID stimmen nicht überein (ID ist «${note.id}»).`);
      continue;
    }
    if (note.photo) {
      const photoPath = join(PHOTOS, dir, note.photo);
      if (!existsSync(photoPath)) {
        fail(noteWhere, `Foto «${note.photo}» fehlt — erwartet unter public/photos/${dir}/${note.photo}.`);
      }
    }
    notes.push(note);
  }

  if (notes.length === 0) continue;

  notes.sort((a, b) => (a.added < b.added ? -1 : a.added > b.added ? 1 : a.id.localeCompare(b.id)));

  const place = resolvePlace(tip.place, aliases);
  if (!place.key) {
    fail(where, `Ort «${tip.place}» ergibt keinen verwertbaren Schlüssel.`);
    continue;
  }

  tips.push({
    ...tip,
    closed: tip.closed ?? false,
    place: place.label,
    placeKey: place.key,
    notes,
  });
}

// --------------------------------------------------- Querschnitts-Prüfung ---

pruefeWunschTipps(seenIds);

// Derselbe Ort unter zwei Schreibweisen ist der häufigste stille Datenfehler.
// Wir können ihn nicht automatisch beheben, aber wir können darauf hinweisen.
const placesByKey = new Map();
for (const tip of tips) {
  const entry = placesByKey.get(tip.placeKey) ?? { labels: new Set(), country: tip.country, count: 0 };
  entry.labels.add(tip.place);
  entry.count += 1;
  placesByKey.set(tip.placeKey, entry);
}
for (const [key, entry] of placesByKey) {
  if (entry.labels.size > 1) {
    warn('Orte', `Schlüssel «${key}» wird verschieden geschrieben: ${[...entry.labels].join(' / ')}. Alias in data/place-aliases.json setzen.`);
  }
}

// Die Normalisierung führt «Zürich» und «Zurich» automatisch zusammen, «Zuerich»
// aber nicht — das wäre nur um den Preis zu haben, «Prague» zu «pragu» zu
// verstümmeln. Stattdessen erkennen wir den Fall hier und schlagen den Alias vor.
const byLooseKey = new Map();
for (const [key, entry] of placesByKey) {
  const loose = looseKey(key);
  const bucket = byLooseKey.get(loose) ?? [];
  bucket.push({ key, label: [...entry.labels][0], count: entry.count });
  byLooseKey.set(loose, bucket);
}
for (const bucket of byLooseKey.values()) {
  if (bucket.length < 2) continue;
  const winner = bucket.reduce((a, b) => (b.count > a.count ? b : a));
  const others = bucket.filter((e) => e.key !== winner.key);
  warn(
    'Orte',
    `${bucket.map((e) => `«${e.label}»`).join(' und ')} sind vermutlich derselbe Ort. ` +
      `In data/place-aliases.json ergänzen: ${others.map((e) => `"${e.key}": "${winner.label}"`).join(', ')}`,
  );
}

// Verwaiste Fotoordner deuten auf einen abgelehnten Tipp hin, dessen Bild liegen blieb.
if (existsSync(PHOTOS)) {
  for (const dir of readdirSync(PHOTOS).filter((d) => !d.startsWith('.'))) {
    if (!seenIds.has(dir)) {
      warn('Fotos', `public/photos/${dir}/ gehört zu keinem Tipp mehr.`);
    }
  }
}

// ------------------------------------------------------------------ Ende ---

if (warnings.length > 0) {
  console.warn(`\n⚠  ${warnings.length} Hinweis${warnings.length === 1 ? '' : 'e'}:`);
  for (const w of warnings) console.warn(`   ${w}`);
}

if (problems.length > 0) {
  console.error(`\n✖  ${problems.length} Problem${problems.length === 1 ? '' : 'e'} in den Daten:\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('Nichts geschrieben. Bitte die obigen Stellen korrigieren.\n');
  process.exit(1);
}

const noteCount = tips.reduce((sum, t) => sum + t.notes.length, 0);
const wunschTeil =
  wuensche.length > 0 ? `, ${wuensche.length} ${wuensche.length === 1 ? 'Wunsch' : 'Wünsche'}` : '';
console.log(
  `✔  ${tips.length} Tipps, ${noteCount} Notizen, ${categories.length} Kategorien${wunschTeil} — alles gültig.`,
);
