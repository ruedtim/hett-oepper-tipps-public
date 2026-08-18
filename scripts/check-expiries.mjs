#!/usr/bin/env node
/**
 * Meldet Zugänge aus ops/expiries.json, die in den nächsten 30 Tagen ablaufen.
 *
 * Schreibt GitHub-Actions-Ausgabevariablen nach stdout. Ohne Argumente kann man
 * es auch von Hand laufen lassen, um den Stand zu sehen.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WARN_DAYS = 30;

const config = JSON.parse(readFileSync(join(ROOT, 'ops', 'expiries.json'), 'utf8'));
const today = new Date();

const lines = [];

for (const item of config.items ?? []) {
  if (!item.expires) continue;

  const expires = new Date(`${item.expires}T00:00:00Z`);
  if (Number.isNaN(expires.getTime())) {
    lines.push(`- **${item.name}**: «${item.expires}» ist kein gültiges Datum (erwartet JJJJ-MM-TT).`);
    continue;
  }

  const days = Math.floor((expires.getTime() - today.getTime()) / 86_400_000);
  if (days > WARN_DAYS) continue;

  const when =
    days < 0
      ? `**ist seit ${Math.abs(days)} Tagen abgelaufen**`
      : days === 0
        ? '**läuft heute ab**'
        : `läuft in ${days} Tagen ab (${item.expires})`;

  lines.push(`- **${item.name}** ${when}\n\n  ${item.note ?? ''}`);
}

const isCI = Boolean(process.env.GITHUB_OUTPUT);

if (lines.length === 0) {
  if (isCI) console.log('warn=false');
  else console.log('Alles im grünen Bereich.');
  process.exit(0);
}

const body = [
  'Ein Zugang, den «Hett öpper Tipps?» braucht, läuft bald ab. Ohne Erneuerung',
  'können Freunde keine Tipps mehr einreichen — die Seite selbst bleibt erreichbar.',
  '',
  ...lines,
  '',
  'Nach dem Erneuern das neue Datum in `ops/expiries.json` eintragen und dieses Issue schliessen.',
].join('\n');

if (isCI) {
  console.log('warn=true');
  // Mehrzeilige Ausgabewerte brauchen dieses Trennzeichen-Format.
  console.log('body<<EXPIRY_EOF');
  console.log(body);
  console.log('EXPIRY_EOF');
} else {
  console.log(body);
}
