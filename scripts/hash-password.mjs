#!/usr/bin/env node
/**
 * Erzeugt den fertigen INSERT für ein Konto — inklusive Passwort-Hash.
 *
 * Das ist der Bootstrap-Weg für das allererste Admin-Konto und zugleich der
 * Notausgang, wenn kein Admin mehr an sein Passwort kommt: Er braucht keine
 * funktionierende Anmeldung, nur wrangler.
 *
 *   node scripts/hash-password.mjs "Tim" --admin --fertig
 *   # danach den ausgegebenen wrangler-Befehl ausführen
 *
 *   --admin    Konto bekommt das Admin-Flag
 *   --fertig   kein Passwortwechsel beim ersten Anmelden verlangt (fürs eigene Konto)
 *   --preview  zielt auf die Preview-Datenbank statt auf die Produktion
 *
 * WICHTIG: Hash-Format und Parameter müssen exakt zu functions/lib/users.ts
 * passen ('pbkdf2$<iter>$<salt-b64url>$<hash-b64url>', SHA-256, 32 Byte).
 * Wer dort etwas ändert, ändert es auch hier.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { searchKey } from '../shared/normalize.mjs';

const PBKDF2_ITERATIONS = 25_000;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const name = args.find((a) => !a.startsWith('--'))?.trim() ?? '';

if (!name || name.length > 40) {
  console.error('Aufruf: node scripts/hash-password.mjs "<Name>" [--admin] [--fertig] [--preview]');
  process.exit(1);
}

const nameKey = searchKey(name);
if (!nameKey) {
  console.error(`«${name}» ergibt keinen brauchbaren Anmeldenamen.`);
  process.exit(1);
}

/** Passwortabfrage ohne Echo — ein Passwort gehört nicht in die Shell-History. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const original = rl._writeToOutput;
    rl.question(question, (answer) => {
      rl._writeToOutput = original;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = function (text) {
      // Die Frage selbst anzeigen, die Eingabe nicht.
      if (text.includes(question)) original.call(rl, question);
    };
  });
}

const password = await askHidden('Passwort: ');
if (password.length < 8) {
  console.error('Mindestens 8 Zeichen.');
  process.exit(1);
}
const repeat = await askHidden('Nochmal: ');
if (password !== repeat) {
  console.error('Die Eingaben stimmen nicht überein.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
const stored = `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;

const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;
const insert =
  `INSERT INTO users (name, name_key, password_hash, is_admin, must_change_password) ` +
  `VALUES (${sql(name)}, ${sql(nameKey)}, ${sql(stored)}, ${flags.has('--admin') ? 1 : 0}, ` +
  `${flags.has('--fertig') ? 0 : 1});`;

// Shell-EINFACHE Anführungszeichen, nicht doppelte: Der Hash enthält
// $-Zeichen, die die Shell in doppelten Anführungszeichen expandieren und
// damit den Hash zerstören würde ($2… liest sie als Positionsparameter).
const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// Bewusst nur EIN fertiger Befehl: Standen hier zwei fast gleiche Zeilen
// untereinander (remote und local), erwischte man verlässlich die falsche —
// und die scheitert leise in einer bunten wrangler-Ausgabe.
const ziel = flags.has('--preview') ? 'DB --env preview' : 'hett-oepper-tipps';
const wo = flags.has('--preview') ? 'Preview-Datenbank' : 'Produktion';

console.log(`\n${insert}\n`);
console.log(`Einspielen (${wo}) — diese Zeile ausführen:\n`);
console.log(`  npx wrangler d1 execute ${ziel} --remote --command ${shellQuote(insert)}\n`);
console.log('Erwartete Bestätigung: «🚣 Executed 1 command».');
console.log('(Für die lokale Simulation dieselbe Zeile mit --local statt --remote.)');
