#!/usr/bin/env node
/**
 * Baut die öffentliche, datenfreie Kopie dieses Repos in ein Zielverzeichnis —
 * der Bau- und Prüfteil der Code-Spiegelung. Geklont, committet und gepusht
 * wird in .github/workflows/spiegel.yml, nicht hier.
 *
 *   node scripts/spiegel.mjs <zielverzeichnis>
 *
 * Drei Schritte, in dieser Reihenfolge:
 *
 *   1. AUSWÄHLEN. Die Dateiliste kommt von `git ls-files`, nicht von einem
 *      Verzeichnisdurchlauf. Das ist keine Bequemlichkeit, sondern die
 *      Sicherheitsgrenze: Im Arbeitsverzeichnis liegen .dev.vars, .wrangler/,
 *      dist/, node_modules/, backup-vor-restore-*.sql und — nicht einmal
 *      gitignoriert — .claude/worktrees/<branch>/ mit einem KOMPLETTEN
 *      Zweit-Checkout samt data/ und public/photos/. Ein Durchlauf müsste das
 *      alles einzeln wieder ausschliessen und würde beim nächsten Werkzeug,
 *      das sich einen Ordner anlegt, still undicht. Git kennt Untracktes nicht.
 *
 *   2. ERSETZEN. Hostnamen und D1-Datenbank-IDs werden durch Platzhalter
 *      getauscht, die README bekommt ihren Spiegel-Kopf. Was ersetzt wird,
 *      steht in ops/spiegel.json — siehe KONFIG weiter unten.
 *
 *   3. NACHSEHEN (der Wächter). Der FERTIGE Baum wird von der Platte
 *      zurückgelesen und durchsucht — nach den Originalwerten, nach
 *      Zugangsdaten-Mustern und nach Pfaden, die es dort nicht geben darf. Er
 *      prüft das Ergebnis, nicht die Absicht: Nur so kann die Ersetzungstabelle
 *      nicht still verrotten, wenn jemand eine dritte Datenbank oder einen
 *      neuen Hostnamen einträgt.
 *
 * Der Spiegel wächst — jeder Lauf hängt einen Commit an, nie ein Force-Push.
 * Was einmal draussen ist, bleibt draussen. Dieses Skript ist die einzige Tür
 * davor, und der Workflow klont den Spiegel erst, wenn es fehlerfrei
 * durchgelaufen ist.
 *
 * Exit-Codes:
 *   0  in Ordnung
 *   1  Bedienfehler (kein Ziel, Ziel im Repo, Symlink, Datei fehlt)
 *   2  der Wächter hat etwas gefunden
 *   3  die Ersetzungstabelle ist verrottet
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));

// -------------------------------------------------------------- Tabellen ---

/**
 * Was ersetzt und was zusätzlich gesucht wird, steht in ops/spiegel.json und
 * NICHT hier — und das ist keine Ordnungsliebe, sondern die einzige Stelle, an
 * der sich dieses Skript nicht selbst spiegeln kann. Es geht ja mit hinaus:
 * Die Werte selbst würde die Ersetzung im Vorbeigehen erwischen, aber jede
 * Erwähnung in einem Kommentar oder in einem Suchmuster bliebe stehen — und
 * der Wächter schlug beim ersten Lauf prompt bei sich selbst an. ops/ ist
 * ohnehin ausgenommen, und ops/expiries.json ist dasselbe Muster:
 * Betriebswissen als JSON, gelesen von einem Skript in scripts/.
 *
 * Die Begründungen zu den einzelnen Werten stehen als «$comment» in der Datei.
 */
const KONFIG = join(ROOT, 'ops', 'spiegel.json');

if (!existsSync(KONFIG)) {
  console.error(
    `✖  ${KONFIG} fehlt. Ohne die Ersetzungstabelle wird nichts gespiegelt — ` +
      'im Spiegel selbst liegt sie bewusst nicht, das Skript ist dort also nicht lauffähig.',
  );
  process.exit(1);
}

const konfig = JSON.parse(readFileSync(KONFIG, 'utf8'));

/**
 * Wörtliche Zeichenketten, keine Regex — was in der Tabelle steht, ist wörtlich
 * gemeint, und kein Metazeichen kann es verbiegen. Geprüft wird die Form beim
 * Laden: Ein Tippfehler im Feldnamen darf keine Ersetzung stillschweigend
 * ausfallen lassen.
 */
const ERSETZUNGEN = konfig.ersetzungen ?? [];

if (ERSETZUNGEN.length === 0) {
  console.error(`✖  ${KONFIG} enthält keine Ersetzungen. Das ist fast sicher ein Versehen.`);
  process.exit(1);
}
for (const e of ERSETZUNGEN) {
  if (typeof e.original === 'string' && e.original && typeof e.ersatz === 'string' && e.ersatz) continue;
  console.error(`✖  Eintrag in ${KONFIG} ohne «original» oder «ersatz»: ${JSON.stringify(e)}`);
  process.exit(1);
}

/**
 * Was in den Spiegel darf — nach oberster Ebene, alles andere fliegt raus. Die
 * Richtung ist Absicht: Ein NEUER Ordner im Wurzelverzeichnis ist erst einmal
 * draussen und wird gemeldet. Andersherum (Liste der verbotenen Ordner) käme
 * ein künftiges `geheim/` still mit. Vergisst jemand die Liste, fehlt im
 * Spiegel etwas — statt dass etwas Privates darin auftaucht.
 *
 * Der Wert ist die Liste der Verbotsmuster INNERHALB des Eintrags. Neue
 * Dateien in einem erlaubten Ordner kommen also von selbst mit: Wer eine
 * Komponente anlegt, soll nicht an diese Tabelle denken müssen.
 *
 * Die Muster stehen bewusst ohne /g — ein globales Muster merkt sich seine
 * Position zwischen den Aufrufen und liesse jede zweite Datei durch.
 */
const ERLAUBT = new Map([
  ['.dev.vars.example', []], // nur Platzhalterwerte; erklärt, welche Secrets es gibt
  ['.github', []], // die Workflows kommen mit, laufen im Spiegel aber nicht (Job-Wächter)
  ['.gitignore', []],
  ['README.md', []],
  ['functions', []],
  ['index.html', []],
  ['migrations', []],
  ['package-lock.json', []],
  ['package.json', []],
  ['public', [/^public\/photos\//]], // Icons, Manifest, _routes.json ja — Fotos nein
  ['schema', []],
  ['scripts', []],
  ['shared', []],
  ['src', []],
  ['tsconfig.json', []],
  ['vite.config.ts', []],
  ['wrangler.toml', []],
]);

/**
 * Bewusst draussen. Steht hier nur, damit der Melder unten schweigt: Diese
 * Einträge sind eine Entscheidung, keine Lücke.
 */
const BEWUSST_DRAUSSEN = new Set(['data', 'ops', 'CLAUDE.md']);

/** Pfade, die im fertigen Baum unter keinen Umständen liegen dürfen. */
const VERBOTENE_PFADE = [
  /^data\//,
  /^public\/photos\//,
  /^ops\//,
  /^CLAUDE\.md$/,
  /^\.git\//,
  /^\.claude\//,
  /^\.wrangler\//,
  /^node_modules\//,
  /^dist\//,
  /^\.dev\.vars$/,
  /^public\/data\.json$/,
  /^backup-vor-restore-/,
];

/** Regex-Metazeichen entschärfen, damit die Tabelle wörtlich bleibt. */
const woertlich = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Was im FERTIGEN Baum nicht vorkommen darf.
 *
 * Die ersten Einträge entstehen aus ERSETZUNGEN und fangen, was die Ersetzung
 * nicht erwischt hat — etwa in einer Binärdatei. Die drei danach sind der
 * eigentliche Rost-Schutz: Sie kennen die Tabelle nicht und schlagen auch bei
 * etwas an, das noch niemand eingetragen hat.
 */
const VERBOTENE_MUSTER = [
  ...ERSETZUNGEN.map((e) => ({
    name: `Originalwert «${e.original}»`,
    muster: new RegExp(woertlich(e.original), 'gi'),
    hinweis: 'Die Ersetzung hat diese Stelle nicht erwischt.',
  })),
  // Die zusätzlichen Muster aus der Konfiguration. Sie tragen dieselben Namen,
  // die hier nicht stehen dürfen, und fangen, was die wörtliche Ersetzung nicht
  // trifft: andere Schreibweisen, die Domain in Prosa.
  ...(konfig.verbotene_muster ?? []).map((m) => ({
    name: m.name,
    muster: new RegExp(m.muster, m.flags ?? 'g'),
    hinweis: m.hinweis ?? '',
  })),
  {
    // Jede D1-ID, die kein Platzhalter ist. Damit meldet sich eine DRITTE
    // Datenbank von selbst, an die niemand gedacht hat.
    name: 'Echte database_id',
    muster: /database_id\s*=\s*"(?!00000000-)[^"]*"/g,
    hinweis: 'Neue D1-Datenbank? Dann in ops/spiegel.json aufnehmen.',
  },
  {
    // Dieselben Muster, die validate.yml im privaten Repo sucht — hier noch
    // einmal, weil ein Fund im öffentlichen Repo nicht zurückzuholen ist.
    name: 'Zugangsdaten',
    muster: /(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY)/g,
    hinweis: 'Sofort widerrufen und aus der History entfernen.',
  },
];

/**
 * Kopfzeilen, die nur die Spiegel-Fassung der README bekommt. Wer im
 * öffentlichen Repo landet, soll in den ersten Zeilen wissen, was er NICHT vor
 * sich hat — sonst sucht er eine halbe Stunde nach `data/`.
 */
const README_KOPF = `<!-- Von scripts/spiegel.mjs erzeugt. Änderungen hier überschreibt der nächste Lauf. -->

> ## Öffentlicher Code-Spiegel
>
> Dieses Repo ist eine **automatisch erzeugte, datenfreie Kopie** eines privaten
> Repos. Es wird bei jeder Änderung dort neu geschrieben; hier vorgenommene
> Commits und Pull Requests gehen beim nächsten Lauf verloren. Wer etwas
> beitragen oder fragen möchte: bitte ein Issue aufmachen.
>
> **Was fehlt:** der gesamte Datenbestand (\`data/\`), die Fotos
> (\`public/photos/\`), die Betriebsanleitungen (\`ops/\`) und die interne
> Arbeitsanleitung (\`CLAUDE.md\`). Die Tipps sind private Empfehlungen eines
> Freundeskreises und gehören nicht ins Netz — hier steht nur, wie die App sie
> verwaltet.
>
> **Was ersetzt ist:** die Hostnamen der Seite und die Absenderadresse der Mails
> (überall \`beispiel.example\` statt der echten Domain) sowie die beiden
> \`database_id\`-Werte in \`wrangler.toml\` (Platzhalter, die mit \`00000000-\`
> beginnen). Der Code selbst ist unangetastet — nur die Adressen, auf die er
> zeigt, führen nirgendwohin.
>
> **Was daraus folgt:** \`npm run build\` läuft hier ganz normal durch — Tests,
> Typprüfung für \`src/\` und \`functions/\`, Vite-Build. Die App braucht
> \`data/\` zum Bauen nicht; ihre Daten kommen zur Laufzeit aus Cloudflare D1.
> \`npm run validate\` dagegen prüft genau den fehlenden Datenbestand und bricht
> deshalb sofort ab. Das ist kein Fehler im Spiegel, sondern seine Definition.
> Die mitgelieferten GitHub-Workflows laufen hier aus demselben Grund nicht:
> Jeder Job prüft zuerst, in welchem Repo er steckt.
>
> Alles Weitere ist die README des privaten Repos, bis auf die genannten
> Ersetzungen unverändert.

`;

// ----------------------------------------------------------- Ziel prüfen ---

if (!process.argv[2]) {
  console.error('✖  Aufruf: node scripts/spiegel.mjs <zielverzeichnis>');
  process.exit(1);
}
const ZIEL = resolve(process.argv[2]);

// Der Zielordner wird vollständig geleert. Zwei Handbremsen, damit das nie das
// eigene Repo trifft — `node scripts/spiegel.mjs .` wäre sonst ein Totalschaden.
if (!relative(ROOT, ZIEL).startsWith('..')) {
  console.error(`✖  ${ZIEL} liegt im Repo selbst. Bitte ein Ziel ausserhalb wählen.`);
  process.exit(1);
}
if (existsSync(join(ZIEL, '.git'))) {
  console.error(`✖  ${ZIEL} enthält ein .git — das ist ein Repo, kein Bauplatz.`);
  process.exit(1);
}

// ------------------------------------------------------ Dateien auswählen ---

// -z, weil Git Namen mit Umlauten oder Leerzeichen sonst zitiert zurückgibt.
// cwd: ROOT, weil `git ls-files` aus einem Unterordner heraus nur diesen
// Unterordner auflistet.
const alleDateien = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const genommen = [];
const neueEintraege = new Set();

for (const pfad of alleDateien) {
  const oberste = pfad.split('/')[0];
  const verbote = ERLAUBT.get(oberste);

  if (verbote === undefined) {
    if (!BEWUSST_DRAUSSEN.has(oberste)) neueEintraege.add(oberste);
    continue;
  }
  if (verbote.some((muster) => muster.test(pfad))) continue;

  genommen.push(pfad);
}

for (const eintrag of [...neueEintraege].sort()) {
  const text =
    `Neu im Wurzelverzeichnis: «${eintrag}» — NICHT gespiegelt. Gehört es in den ` +
    'Spiegel, in ERLAUBT aufnehmen; sonst in BEWUSST_DRAUSSEN — dann schweigt ' +
    'diese Meldung künftig.';
  console.warn(`⚠  ${text}`);
  // Als Annotation, sonst liest es in einem grünen Lauf niemand.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Spiegel::${text}`);
}

if (genommen.length === 0) {
  console.error('✖  Keine einzige Datei ausgewählt. Läuft das Skript wirklich im Repo?');
  process.exit(1);
}

// -------------------------------------------------- Kopieren und ersetzen ---

rmSync(ZIEL, { recursive: true, force: true });
mkdirSync(ZIEL, { recursive: true });

/** Wie oft jede Ersetzung gegriffen hat — Grundlage des Rost-Schutzes unten. */
const treffer = new Map(ERSETZUNGEN.map((e) => [e.original, 0]));

/**
 * Text oder Bytes? Keine Endungsliste — die verrottet wie jede Liste, und eine
 * unbekannte Endung wäre entweder ungeprüft (schlecht) oder zerschossen
 * (schlechter). Entschieden wird am Inhalt, nach Gits eigener Faustregel: ein
 * Nullbyte in den ersten 8000 Bytes heisst binär. Zusätzlich muss der Puffer
 * sauber durch UTF-8 und zurück gehen — sonst veränderte das Zurückschreiben
 * still Bytes (ungültige Sequenzen werden zu U+FFFD).
 */
function istText(bytes) {
  if (bytes.subarray(0, 8000).includes(0)) return false;
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

for (const pfad of genommen) {
  const quelle = join(ROOT, pfad);
  const info = lstatSync(quelle, { throwIfNoEntry: false });

  if (!info) {
    console.error(`✖  ${pfad} steht im Git-Index, liegt aber nicht auf der Platte.`);
    process.exit(1);
  }
  // Ein Symlink zeigt womöglich nach data/ oder aus dem Repo heraus. Kopiert
  // würde nur sein Ziel-PFAD — entweder ein toter Link im Spiegel oder ein
  // Wegweiser auf etwas Privates. Heute gibt es keinen; kommt einer, soll er
  // auffallen statt still durchzurutschen.
  if (info.isSymbolicLink()) {
    console.error(`✖  ${pfad} ist ein Symlink. Der Spiegel kopiert keine Symlinks.`);
    process.exit(1);
  }

  const ziel = join(ZIEL, pfad);
  mkdirSync(dirname(ziel), { recursive: true });
  const bytes = readFileSync(quelle);

  if (!istText(bytes)) {
    // Binär: unverändert übernehmen. Der Wächter sieht sie sich trotzdem an —
    // eine Domain kann auch in den Metadaten eines Bildes stehen.
    writeFileSync(ziel, bytes);
  } else {
    let text = bytes.toString('utf8');
    for (const { original, ersatz } of ERSETZUNGEN) {
      const teile = text.split(original);
      if (teile.length === 1) continue;
      treffer.set(original, treffer.get(original) + teile.length - 1);
      text = teile.join(ersatz);
    }
    if (pfad === 'README.md') text = README_KOPF + text;
    writeFileSync(ziel, text, 'utf8');
  }

  // Ausführbar-Bit mitnehmen. Heute hat es keine Datei; ein künftiges
  // Hilfsskript mit Shebang soll im Spiegel nicht plötzlich unausführbar sein.
  chmodSync(ziel, info.mode & 0o777);
}

// -------------------------------------------------------------- Rost-Schutz ---

let verrottet = false;
for (const { original, mindestens } of ERSETZUNGEN) {
  if (treffer.get(original) >= (mindestens ?? 1)) continue;
  console.error(
    `✖  «${original}» kommt im Repo nicht mehr vor. Entweder ist der Eintrag ` +
      `überflüssig (raus aus ${KONFIG}) oder das Original heisst inzwischen ` +
      'anders (dann den neuen Wert eintragen). Es wird nichts gespiegelt.',
  );
  verrottet = true;
}
if (verrottet) process.exit(3);

// ------------------------------------------------------------------ Wächter ---
// Ab hier zählt nur, was WIRKLICH im Zielordner liegt — deshalb wird von der
// Platte zurückgelesen statt im Speicher weitergerechnet.

let funde = 0;

for (const pfad of genommen) {
  for (const muster of VERBOTENE_PFADE) {
    if (!muster.test(pfad)) continue;
    console.error(`✖  Wächter: ${pfad} darf im Spiegel nicht liegen.`);
    funde += 1;
  }
}

for (const pfad of genommen) {
  const bytes = readFileSync(join(ZIEL, pfad));
  // latin1 für Binärdateien: verlustfrei, wirft nie, und unsere Muster sind
  // ohnehin ASCII.
  const text = istText(bytes) ? bytes.toString('utf8') : bytes.toString('latin1');

  for (const { name, muster, hinweis } of VERBOTENE_MUSTER) {
    muster.lastIndex = 0; // /g merkt sich die Position zwischen den Dateien
    const fund = muster.exec(text);
    if (!fund) continue;
    const zeile = text.slice(0, fund.index).split('\n').length;
    console.error(`✖  Wächter: ${name} in ${pfad}:${zeile} — «${fund[0].slice(0, 60)}». ${hinweis}`);
    funde += 1;
  }
}

if (funde > 0) {
  console.error(`✖  ${funde} Fund(e). Es wird nichts gespiegelt.`);
  process.exit(2);
}

const ersetzt = [...treffer.values()].reduce((a, b) => a + b, 0);
console.log(`✔  ${genommen.length} Dateien gespiegelt, ${ersetzt} Stellen ersetzt, Wächter sauber → ${ZIEL}`);
