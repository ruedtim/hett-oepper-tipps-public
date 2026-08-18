/**
 * Ein ZIP-Archiv von Hand, ohne Kompression.
 *
 * Workers bringen keinen Packer mit, und für diesen Zweck bräuchte es auch
 * keinen: Im Archiv liegen ein bisschen JSON und Fotos, und WebP wie JPEG sind
 * längst komprimiert. Also Methode 0 («store») — die Bytes wandern unverändert
 * hinein, und der ganze Aufwand steckt in den Kopfstrukturen.
 *
 * Warum hier unter `shared/` und nicht in `functions/lib/`, obwohl das Frontend
 * kein ZIP baut: weil `npm run test` genau auf `shared/*.test.mjs` schaut. Das
 * ist derselbe Grund, aus dem `geo.mjs` und `placeLinks.mjs` hier wohnen, und er
 * gilt hier besonders — die Fehler dieses Codes krachen nicht. Ein um vier Bytes
 * verschobener Offset im Central Directory ergibt ein Archiv, das der Finder
 * anstandslos öffnet und `unzip` mit «bad zipfile offset» abweist, oder
 * umgekehrt. Ein vergessenes `>>> 0` beim CRC ergibt eine negative Zahl, die
 * `setUint32` still zum falschen Wert macht.
 *
 * Kein ZIP64: über 65535 Einträgen oder 4 GB wirft die Funktion, statt stumm
 * falsche Grössen zu schreiben. Ein Konto dieses Freundeskreises kommt dort nie
 * hin, aber ein Archiv, das lügt, wäre die schlechtere Antwort als ein Fehler.
 */

/** Vorberechnete CRC-32-Tabelle (IEEE 802.3, Polynom 0xEDB88320). */
const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabelle[n] = c >>> 0;
  }
  return tabelle;
})();

/**
 * CRC-32 über einen Puffer, vorzeichenlos.
 *
 * @param {Uint8Array} bytes
 * @returns {number} 0 … 4294967295
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  // Das `>>> 0` ist nicht Kosmetik: Ohne es liefert der XOR eine vorzeichen-
  // behaftete Zahl, und die schreibt `setUint32` als etwas ganz anderes.
  return (c ^ 0xffffffff) >>> 0;
}

/** Die DOS-Epoche. Vorgabe, damit gleiche Eingaben gleiche Bytes ergeben. */
const DOS_EPOCHE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/** MS-DOS packt Datum und Uhrzeit in je 16 Bit; die Sekunde zählt in Zweiern. */
function dosZeit(datum) {
  const jahr = datum.getUTCFullYear();
  if (jahr < 1980) return { datum: (1 << 5) | 1, zeit: 0 };
  return {
    datum: ((jahr - 1980) << 9) | ((datum.getUTCMonth() + 1) << 5) | datum.getUTCDate(),
    zeit:
      (datum.getUTCHours() << 11) |
      (datum.getUTCMinutes() << 5) |
      (datum.getUTCSeconds() >> 1),
  };
}

const KODIERER = new TextEncoder();

/**
 * Bit 11 der General-Purpose-Flags sagt «der Dateiname ist UTF-8».
 *
 * Immer gesetzt, auch bei reinem ASCII: Dann stimmt es ebenfalls, und ein Flag,
 * das mal so und mal so steht, ist eine Fehlerquelle mehr. Ohne das Bit zeigt
 * ein Archiv mit «münchen» auf manchen Entpackern Buchstabensalat.
 */
const FLAG_UTF8 = 0x0800;

function lokalerKopf(eintrag) {
  const kopf = new Uint8Array(30 + eintrag.name.length);
  const sicht = new DataView(kopf.buffer);
  sicht.setUint32(0, 0x04034b50, true);
  sicht.setUint16(4, 20, true); // Version, die zum Entpacken reicht
  sicht.setUint16(6, FLAG_UTF8, true);
  sicht.setUint16(8, 0, true); // Methode 0 = unkomprimiert
  sicht.setUint16(10, eintrag.zeit, true);
  sicht.setUint16(12, eintrag.datum, true);
  sicht.setUint32(14, eintrag.crc, true);
  sicht.setUint32(18, eintrag.groesse, true); // komprimiert …
  sicht.setUint32(22, eintrag.groesse, true); // … und unkomprimiert, hier gleich
  sicht.setUint16(26, eintrag.name.length, true);
  sicht.setUint16(28, 0, true); // kein Extra-Feld
  kopf.set(eintrag.name, 30);
  return kopf;
}

function zentralerKopf(eintrag) {
  const kopf = new Uint8Array(46 + eintrag.name.length);
  const sicht = new DataView(kopf.buffer);
  sicht.setUint32(0, 0x02014b50, true);
  sicht.setUint16(4, 20, true); // von welcher Version erzeugt
  sicht.setUint16(6, 20, true); // welche zum Entpacken reicht
  sicht.setUint16(8, FLAG_UTF8, true);
  sicht.setUint16(10, 0, true);
  sicht.setUint16(12, eintrag.zeit, true);
  sicht.setUint16(14, eintrag.datum, true);
  sicht.setUint32(16, eintrag.crc, true);
  sicht.setUint32(20, eintrag.groesse, true);
  sicht.setUint32(24, eintrag.groesse, true);
  sicht.setUint16(28, eintrag.name.length, true);
  sicht.setUint16(30, 0, true); // Extra
  sicht.setUint16(32, 0, true); // Kommentar
  sicht.setUint16(34, 0, true); // Diskette, auf der der Eintrag beginnt
  sicht.setUint16(36, 0, true); // interne Attribute
  sicht.setUint32(38, 0, true); // externe Attribute
  sicht.setUint32(42, eintrag.offset, true);
  kopf.set(eintrag.name, 46);
  return kopf;
}

function abschluss(anzahl, groesseCd, offsetCd) {
  const ende = new Uint8Array(22);
  const sicht = new DataView(ende.buffer);
  sicht.setUint32(0, 0x06054b50, true);
  sicht.setUint16(4, 0, true); // Nummer dieser Diskette
  sicht.setUint16(6, 0, true); // Diskette mit dem Central Directory
  sicht.setUint16(8, anzahl, true);
  sicht.setUint16(10, anzahl, true);
  sicht.setUint32(12, groesseCd, true);
  sicht.setUint32(16, offsetCd, true);
  sicht.setUint16(20, 0, true); // kein Archivkommentar
  return ende;
}

const GRENZE_4GB = 0xffffffff;
const GRENZE_EINTRAEGE = 0xffff;

/**
 * Ein ZIP-Archiv als Strom.
 *
 * Als Strom und nicht als ein grosses `Uint8Array`: Jeder Eintrag wird einmal
 * ganz gepuffert — der CRC muss VOR den Bytes im lokalen Kopf stehen, daran
 * führt ohne Data Descriptor kein Weg vorbei —, aber nie das ganze Archiv.
 * Sonst läge ein Export mit vierzig Fotos am Speicherlimit des Workers.
 *
 * `eintraege` darf ein Array sein oder ein async iterierbares Ding; `for await`
 * frisst beides. Die Tests geben eine Liste, der Export-Endpunkt einen
 * Generator, der die Fotos einzeln aus R2 holt.
 *
 * @param {Iterable<{name: string, bytes: Uint8Array}>
 *        | AsyncIterable<{name: string, bytes: Uint8Array}>} eintraege
 * @param {{zeit?: Date}} [optionen] Zeitstempel aller Einträge. Vorgabe ist die
 *   DOS-Epoche, damit dieselben Eingaben dieselben Bytes ergeben — sonst wäre
 *   das Ergebnis nicht prüfbar.
 * @returns {ReadableStream<Uint8Array>}
 */
export function zipStrom(eintraege, optionen = {}) {
  const { datum, zeit } = dosZeit(optionen.zeit ?? DOS_EPOCHE);

  return new ReadableStream({
    async start(steuerung) {
      const verzeichnis = [];
      const namenGesehen = new Set();
      let offset = 0;

      try {
        for await (const eintrag of eintraege) {
          // Kodiert, weil in die Kopffelder die BYTE-Länge gehört und nicht
          // `eintrag.name.length`: «café» hat vier Zeichen, aber fünf Bytes.
          // Das falsche Feld hier bemerkt man erst an einem Archiv mit Umlauten.
          const name = KODIERER.encode(eintrag.name);

          if (namenGesehen.has(eintrag.name)) {
            throw new Error(`Zweimal derselbe Pfad im Archiv: ${eintrag.name}`);
          }
          namenGesehen.add(eintrag.name);

          const meta = {
            name,
            crc: crc32(eintrag.bytes),
            groesse: eintrag.bytes.length,
            offset,
            datum,
            zeit,
          };
          if (meta.groesse > GRENZE_4GB) {
            throw new Error(`Zu gross für ZIP ohne ZIP64: ${eintrag.name}`);
          }

          const kopf = lokalerKopf(meta);
          steuerung.enqueue(kopf);
          steuerung.enqueue(eintrag.bytes);
          offset += kopf.length + meta.groesse;
          if (offset > GRENZE_4GB) throw new Error('Archiv zu gross für ZIP ohne ZIP64.');

          verzeichnis.push(meta);
        }

        if (verzeichnis.length > GRENZE_EINTRAEGE) {
          throw new Error('Zu viele Einträge für ZIP ohne ZIP64.');
        }

        const offsetCd = offset;
        let groesseCd = 0;
        for (const meta of verzeichnis) {
          const kopf = zentralerKopf(meta);
          steuerung.enqueue(kopf);
          groesseCd += kopf.length;
        }
        steuerung.enqueue(abschluss(verzeichnis.length, groesseCd, offsetCd));
        steuerung.close();
      } catch (fehler) {
        steuerung.error(fehler);
      }
    },
  });
}

/**
 * Dasselbe Archiv am Stück — für Tests und kleine Fälle.
 *
 * @param {Iterable<{name: string, bytes: Uint8Array}>
 *        | AsyncIterable<{name: string, bytes: Uint8Array}>} eintraege
 * @param {{zeit?: Date}} [optionen]
 * @returns {Promise<Uint8Array>}
 */
export async function zipBytes(eintraege, optionen = {}) {
  const stuecke = [];
  let laenge = 0;
  const leser = zipStrom(eintraege, optionen).getReader();
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    stuecke.push(value);
    laenge += value.length;
  }
  const alles = new Uint8Array(laenge);
  let position = 0;
  for (const stueck of stuecke) {
    alles.set(stueck, position);
    position += stueck.length;
  }
  return alles;
}
