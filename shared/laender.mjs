/**
 * Ländername und Flagge aus einem ISO-Code — ohne Dependency und ohne Liste.
 *
 * `Intl.DisplayNames` liefert die deutschen Namen aus der Runtime, das Emoji
 * lässt sich direkt aus dem Code rechnen. Damit entfällt eine 30-KB-Länderliste
 * im Bundle, und die Namen sind automatisch korrekt.
 *
 * Wohnt hier, seit die geteilte Ansicht dieselbe Beschriftung serverseitig
 * braucht — Cloudflare Workers bringen das volle ICU mit. Die Liste ALLER
 * Länder ist in `src/lib/countries.ts` geblieben: Die braucht nur das
 * Auswahlfeld im Formular, und die gehört nicht in eine Worker-Antwort.
 */

const anzeigeNamen = new Intl.DisplayNames(['de'], { type: 'region', fallback: 'code' });

/**
 * «IT» → «Italien»
 * @param {string} code
 * @returns {string}
 */
export function countryName(code) {
  try {
    return anzeigeNamen.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * «IT» → «🇮🇹». Regional Indicator Symbols liegen 127397 Codepoints über 'A'–'Z'.
 * @param {string} code
 * @returns {string}
 */
export function countryFlag(code) {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(...[...upper].map((char) => char.charCodeAt(0) + 127397));
}
