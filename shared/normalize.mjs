/**
 * Slug- und Suchschlüssel-Logik.
 *
 * Diese Datei ist die EINZIGE Quelle dieser Funktionen. Sie wird vom Build-Skript
 * (Node), vom Frontend (Vite) und von den Cloudflare Functions importiert. Zwei
 * Kopien würden auseinanderdriften, und dann wären «Zürich» und «Zurich»
 * plötzlich zwei Orte in der Liste.
 *
 * Es gibt bewusst ZWEI Normalisierungen, weil sie Gegensätzliches wollen:
 *
 *   slugify()   erzeugt lesbare, dauerhafte IDs für URLs. Deutsch korrekt:
 *               «München» → «muenchen».
 *   searchKey() erzeugt Vergleichsschlüssel, die in beide Richtungen treffen
 *               müssen. Umlaut auf den nackten Vokal: «München» → «munchen»,
 *               damit auch «Munchen» denselben Schlüssel ergibt.
 *
 * Eine gemeinsame Funktion für beides ginge nicht: «ue» pauschal zu «u» zu
 * falten würde «Prague» zu «pragu» und «Queenstown» zu «qenstown» verstümmeln.
 * Die verbleibende Lücke — jemand tippt «Zuerich» statt «Zürich» — deckt
 * data/place-aliases.json ab, und das Build-Skript weist darauf hin.
 */

/** Zeichen ohne NFD-Zerlegung. Ohne Ersatz würden sie beim Akzent-Strippen ersatzlos verschwinden. */
const INDECOMPOSABLE = {
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ı: 'i',
};

/** Für IDs: die deutsche Schreibkonvention, damit URLs lesbar bleiben. */
const GERMAN_EXPANSIONS = {
  ...INDECOMPOSABLE,
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  å: 'aa',
};

const INDECOMPOSABLE_RE = /[ßøæœðþłđħı]/g;
const GERMAN_RE = /[äöüåßøæœðþłđħı]/g;

/** Kombinierende Akzente entfernen: «é» → «e», «ř» → «r», «ä» → «a». */
function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * ID-Slug: lesbar, stabil, reines ASCII-Kleingeschriebenes mit Bindestrichen.
 *
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  const expanded = String(input ?? '')
    .toLowerCase()
    .replace(GERMAN_RE, (char) => GERMAN_EXPANSIONS[char] ?? char);

  return stripDiacritics(expanded)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * Vergleichsschlüssel für Suche und Ortsgruppierung.
 * «Zürich», «Zurich» und «ZÜRICH» ergeben alle «zurich».
 *
 * @param {string} input
 * @returns {string}
 */
export function searchKey(input) {
  const expanded = String(input ?? '')
    .toLowerCase()
    .replace(INDECOMPOSABLE_RE, (char) => INDECOMPOSABLE[char] ?? char);

  return stripDiacritics(expanded).replace(/[^a-z0-9]+/g, '');
}

/**
 * Absichtlich grobe Variante von searchKey: faltet zusätzlich die ausgeschriebenen
 * Umlaute. Wird NICHT zum Gruppieren benutzt — nur, damit das Build-Skript merken
 * kann, dass «Zuerich» und «Zürich» wohl derselbe Ort sind, und einen Alias
 * vorschlagen kann.
 *
 * @param {string} input
 * @returns {string}
 */
export function looseKey(input) {
  return searchKey(input)
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/ss/g, 's');
}

/**
 * Ortsschlüssel inklusive Alias-Auflösung.
 *
 * Der Schlüssel wird bewusst aus dem KANONISCHEN Namen abgeleitet, nicht aus der
 * Eingabe. Sonst behielte «Rom» den Schlüssel «rom», «Roma» den Schlüssel «roma»,
 * und der Alias hätte nur beide Gruppen gleich beschriftet statt sie zu vereinen.
 *
 * @param {string} place Freitext, wie ihn jemand eingetippt hat
 * @param {Record<string, string>} [aliases] searchKey → kanonische Schreibweise
 * @returns {{ key: string, label: string }}
 */
export function resolvePlace(place, aliases = {}) {
  const raw = String(place ?? '').trim();
  const label = aliases[searchKey(raw)] ?? raw;
  return { key: searchKey(label), label };
}

/**
 * Trefferprüfung für die Freitextsuche. Beide Seiten werden normalisiert,
 * damit die Richtung der Eingabe egal ist.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
export function matches(haystack, needle) {
  const n = searchKey(needle);
  if (!n) return true;
  return searchKey(haystack).includes(n);
}
