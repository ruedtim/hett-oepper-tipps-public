/**
 * Tests für den ZIP-Bauer. Mit `node --test` laufen zu lassen.
 *
 * Aus demselben Grund wie bei `geo.test.mjs` und `placeLinks.test.mjs`: Die
 * Fehler dieses Codes werfen keine Ausnahme. Ein falscher Offset, eine
 * Namenslänge in Zeichen statt Bytes, ein vorzeichenbehafteter CRC — alles das
 * ergibt ein Archiv, das je nach Entpacker aufgeht oder nicht. Deshalb wird hier
 * nicht «lässt sich öffnen» geprüft, sondern jedes einzelne Feld an seiner
 * Byte-Position.
 *
 * Die CRC-Sollwerte sind die öffentlich dokumentierten Prüfvektoren für
 * CRC-32/ISO-HDLC.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipBytes, zipStrom } from './zip.mjs';

const kodierer = new TextEncoder();
const bytes = (text) => kodierer.encode(text);
const sicht = (archiv) => new DataView(archiv.buffer, archiv.byteOffset, archiv.byteLength);

const LOKAL = 0x04034b50;
const ZENTRAL = 0x02014b50;
const ENDE = 0x06054b50;

test('crc32 trifft die bekannten Prüfvektoren', () => {
  assert.equal(crc32(bytes('')), 0x00000000);
  assert.equal(crc32(bytes('a')), 0xe8b7be43);
  assert.equal(crc32(bytes('abc')), 0x352441c2);
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('crc32 bleibt vorzeichenlos', () => {
  // Ein vergessenes `>>> 0` liefert hier eine negative Zahl. Die sieht in einem
  // Vergleich harmlos aus und macht `setUint32` still zu etwas anderem.
  const gross = new Uint8Array(1024 * 1024).fill(0xa5);
  const wert = crc32(gross);
  assert.ok(wert >= 0 && wert <= 0xffffffff, `${wert} liegt ausserhalb von uint32`);
  assert.ok(Number.isInteger(wert));
});

test('ein leeres Archiv sind genau die 22 Bytes des Abschlusses', async () => {
  const archiv = await zipBytes([]);
  assert.equal(archiv.length, 22);
  const s = sicht(archiv);
  assert.equal(s.getUint32(0, true), ENDE);
  assert.equal(s.getUint16(8, true), 0, 'Einträge auf dieser Diskette');
  assert.equal(s.getUint16(10, true), 0, 'Einträge gesamt');
  assert.equal(s.getUint32(12, true), 0, 'Grösse des Central Directory');
  assert.equal(s.getUint32(16, true), 0, 'Offset des Central Directory');
});

test('ein Eintrag: lokaler Kopf, Daten, Central Directory, Abschluss', async () => {
  const inhalt = bytes('Hallo Welt');
  const archiv = await zipBytes([{ name: 'a.txt', bytes: inhalt }]);
  const s = sicht(archiv);

  assert.equal(s.getUint32(0, true), LOKAL);
  assert.equal(s.getUint16(8, true), 0, 'Methode 0 = unkomprimiert');
  assert.equal(s.getUint32(14, true), crc32(inhalt));
  assert.equal(s.getUint32(18, true), inhalt.length, 'komprimierte Grösse');
  assert.equal(s.getUint32(22, true), inhalt.length, 'unkomprimierte Grösse');
  assert.equal(s.getUint16(26, true), 5, 'Namenslänge');
  assert.equal(s.getUint16(28, true), 0, 'kein Extra-Feld');
  assert.deepEqual(archiv.slice(30, 35), bytes('a.txt'));
  assert.deepEqual(archiv.slice(35, 35 + inhalt.length), inhalt);

  const offsetCd = 30 + 5 + inhalt.length;
  assert.equal(s.getUint32(offsetCd, true), ZENTRAL);
  assert.equal(s.getUint32(offsetCd + 42, true), 0, 'Offset des lokalen Kopfes');

  const offsetEnde = offsetCd + 46 + 5;
  assert.equal(s.getUint32(offsetEnde, true), ENDE);
  assert.equal(s.getUint16(offsetEnde + 10, true), 1);
  assert.equal(s.getUint32(offsetEnde + 12, true), 46 + 5);
  assert.equal(s.getUint32(offsetEnde + 16, true), offsetCd);
  assert.equal(archiv.length, offsetEnde + 22);
});

test('Umlaute: UTF-8-Flag gesetzt und die Namenslänge in Bytes', async () => {
  const name = 'fotos/münchen-café.webp';
  const archiv = await zipBytes([{ name, bytes: bytes('x') }]);
  const s = sicht(archiv);

  const inBytes = kodierer.encode(name).length;
  assert.equal(inBytes, 25);
  assert.notEqual(inBytes, name.length, 'sonst prüft dieser Test nichts');

  assert.equal(s.getUint16(6, true) & 0x0800, 0x0800, 'Bit 11 im lokalen Kopf');
  assert.equal(s.getUint16(26, true), inBytes, 'Namenslänge im lokalen Kopf');

  const offsetCd = 30 + inBytes + 1;
  assert.equal(s.getUint16(offsetCd + 8, true) & 0x0800, 0x0800, 'Bit 11 im zentralen Kopf');
  assert.equal(s.getUint16(offsetCd + 28, true), inBytes, 'Namenslänge im zentralen Kopf');
});

test('mehrere Einträge: Offsets und Grössen stimmen mit den Positionen überein', async () => {
  const eintraege = [
    { name: 'eins.txt', bytes: bytes('a') },
    { name: 'zwei/lang.json', bytes: bytes('{"x":123456}') },
    { name: 'drei.bin', bytes: new Uint8Array(500).fill(7) },
  ];
  const archiv = await zipBytes(eintraege);
  const s = sicht(archiv);

  // Die Offsets, die im Central Directory stehen MÜSSEN, laufend aufaddiert.
  const erwartet = [];
  let laufend = 0;
  for (const eintrag of eintraege) {
    erwartet.push(laufend);
    laufend += 30 + kodierer.encode(eintrag.name).length + eintrag.bytes.length;
  }
  const offsetCd = laufend;

  let position = offsetCd;
  for (let i = 0; i < eintraege.length; i += 1) {
    assert.equal(s.getUint32(position, true), ZENTRAL, `zentraler Kopf ${i}`);
    assert.equal(s.getUint32(position + 42, true), erwartet[i], `Offset von Eintrag ${i}`);
    // Und an diesem Offset muss auch wirklich ein lokaler Kopf liegen.
    assert.equal(s.getUint32(erwartet[i], true), LOKAL, `lokaler Kopf ${i}`);
    assert.equal(s.getUint32(position + 24, true), eintraege[i].bytes.length);
    position += 46 + kodierer.encode(eintraege[i].name).length;
  }

  assert.equal(s.getUint32(position, true), ENDE);
  assert.equal(s.getUint16(position + 10, true), 3);
  assert.equal(s.getUint32(position + 12, true), position - offsetCd);
  assert.equal(s.getUint32(position + 16, true), offsetCd);
  assert.equal(archiv.length, position + 22);
});

test('eine leere Datei ist ein gültiger Eintrag', async () => {
  const archiv = await zipBytes([{ name: 'leer.txt', bytes: new Uint8Array(0) }]);
  const s = sicht(archiv);
  assert.equal(s.getUint32(14, true), 0, 'CRC einer leeren Datei');
  assert.equal(s.getUint32(18, true), 0);
  assert.equal(s.getUint32(22, true), 0);
  assert.equal(archiv.length, 30 + 8 + 0 + 46 + 8 + 22);
});

test('Array und async-Generator ergeben dieselben Bytes', async () => {
  const eintraege = [
    { name: 'a.txt', bytes: bytes('eins') },
    { name: 'b.txt', bytes: bytes('zwei') },
  ];
  async function* nachUndNach() {
    for (const eintrag of eintraege) yield eintrag;
  }
  const ausArray = await zipBytes(eintraege);
  const ausGenerator = await zipBytes(nachUndNach());
  assert.deepEqual(ausArray, ausGenerator);
});

test('zweimal dasselbe ergibt dieselben Bytes', async () => {
  const bauen = () => zipBytes([{ name: 'a.txt', bytes: bytes('stabil') }]);
  assert.deepEqual(await bauen(), await bauen());
});

test('ein Zeitstempel landet in den DOS-Feldern', async () => {
  // 2026-08-18 14:30:44 UTC → Datum ((2026-1980)<<9)|(8<<5)|18, Zeit
  // (14<<11)|(30<<5)|22. Die Sekunde zählt in Zweiern, 44 wird also zu 22.
  const archiv = await zipBytes([{ name: 'a.txt', bytes: bytes('x') }], {
    zeit: new Date(Date.UTC(2026, 7, 18, 14, 30, 44)),
  });
  const s = sicht(archiv);
  assert.equal(s.getUint16(10, true), (14 << 11) | (30 << 5) | 22, 'Uhrzeit');
  assert.equal(s.getUint16(12, true), (46 << 9) | (8 << 5) | 18, 'Datum');
});

test('derselbe Pfad zweimal ist ein Fehler und kein stilles Archiv', async () => {
  await assert.rejects(
    zipBytes([
      { name: 'a.txt', bytes: bytes('eins') },
      { name: 'a.txt', bytes: bytes('zwei') },
    ]),
    /Zweimal derselbe Pfad/,
  );
});

test('der Strom bricht ab, statt ein halbes Archiv zu schliessen', async () => {
  async function* mitFehler() {
    yield { name: 'a.txt', bytes: bytes('eins') };
    throw new Error('R2 mag gerade nicht');
  }
  const leser = zipStrom(mitFehler()).getReader();
  await leser.read(); // der lokale Kopf kommt noch
  await assert.rejects(
    (async () => {
      for (;;) {
        const { done } = await leser.read();
        if (done) return;
      }
    })(),
    /R2 mag gerade nicht/,
  );
});
