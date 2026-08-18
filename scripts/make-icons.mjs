#!/usr/bin/env node
/**
 * Erzeugt die App-Icons.
 *
 * Bewusst ohne Bildbibliothek: ein paar hundert Zeilen Abhängigkeit für vier
 * Dateien, die sich alle drei Jahre einmal ändern, lohnen nicht. Gezeichnet
 * wird eine Stecknadel — Kreis plus Kegel —, weil sich das exakt rechnen lässt.
 * Kantenglättung über vierfaches Überabtasten.
 *
 *   node scripts/make-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BACKGROUND = [156, 61, 46]; // --accent
const FOREGROUND = [250, 247, 242]; // --bg hell

// ------------------------------------------------------------------- PNG ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** @param {Uint8Array} rgb  size*size*3 Bytes */
function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Truecolor RGB

  // Jede Zeile bekommt ein Filter-Byte vorangestellt; 0 = kein Filter.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const target = y * (1 + size * 3);
    raw[target] = 0;
    rgb.copy
      ? Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, target + 1)
      : raw.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), target + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- Zeichnen ---

/**
 * Deckungsgrad der Stecknadel an einem Punkt: 1 innerhalb, 0 ausserhalb.
 * Koordinaten laufen von 0 bis 1 über die Motivfläche.
 */
function pinCoverage(x, y) {
  const cx = 0.5;
  const headY = 0.38;
  const headR = 0.2;
  const holeR = 0.078;
  const tipY = 0.84;

  const dx = x - cx;
  const dy = y - headY;
  const inHead = dx * dx + dy * dy <= headR * headR;
  const inHole = dx * dx + dy * dy <= holeR * holeR;

  // Kegel vom Kopf zur Spitze: Breite nimmt linear ab.
  let inCone = false;
  if (y >= headY && y <= tipY) {
    const t = (y - headY) / (tipY - headY);
    const halfWidth = headR * (1 - t) * 0.96;
    inCone = Math.abs(dx) <= halfWidth;
  }

  return (inHead || inCone) && !inHole ? 1 : 0;
}

/** Abgerundetes Quadrat, ebenfalls als Deckungsgrad. */
function squareCoverage(x, y, radius) {
  if (radius <= 0) return 1;
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius ? 1 : 0;
}

function render(size, { maskable = false } = {}) {
  const rgb = new Uint8Array(size * size * 3);
  const SS = 4; // Überabtastung pro Achse
  const radius = maskable ? 0 : 0.22;
  // Android beschneidet maskable Icons kreisförmig — Motiv kleiner halten.
  const inset = maskable ? 0.2 : 0.16;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let inSquare = 0;
      let inPin = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          inSquare += squareCoverage(x, y, radius);

          const mx = (x - inset) / (1 - inset * 2);
          const my = (y - inset) / (1 - inset * 2);
          if (mx >= 0 && mx <= 1 && my >= 0 && my <= 1) inPin += pinCoverage(mx, my);
        }
      }

      const samples = SS * SS;
      const squareAlpha = inSquare / samples;
      const pinAlpha = inPin / samples;

      const offset = (py * size + px) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        // Ausserhalb des abgerundeten Quadrats: Hintergrundfarbe der Seite,
        // damit der Rand ohne Alphakanal sauber aussieht.
        const base = BACKGROUND[channel] * squareAlpha + FOREGROUND[channel] * (1 - squareAlpha);
        rgb[offset + channel] = Math.round(base * (1 - pinAlpha) + FOREGROUND[channel] * pinAlpha);
      }
    }
  }

  return encodePng(rgb, size);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];

for (const [name, size, options] of targets) {
  const png = render(size, options);
  writeFileSync(join(OUT, name), png);
  console.log(`✔  ${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
