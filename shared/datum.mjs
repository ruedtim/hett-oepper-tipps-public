/**
 * Tagesdaten in Zürcher Ortszeit.
 *
 * Wie normalize.mjs die EINZIGE Quelle: Das Wunsch-Formular setzt `min` am
 * Datumsfeld, der Server prüft dasselbe Datum gegen dieselbe Grenze. Zwei Kopien
 * würden auseinanderdriften, und dann lehnte der Server ein Datum ab, das der
 * Browser eine Sekunde vorher noch angeboten hat.
 *
 * Warum nicht UTC: Abends in der Schweiz weicht das UTC-Datum einen Tag ab
 * (00:31 Uhr MESZ ist noch 22:31 Uhr UTC des Vortags). Der Freundeskreis lebt
 * in der Schweiz, darum zählt hier die Zürcher Ortszeit — dieselbe Zone, in der
 * auch `tips.added` entsteht.
 */

const ZUERICH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Heute als «JJJJ-MM-TT».
 *
 * @param {Date} [jetzt] Nur zum Testen — im Betrieb immer die echte Uhr.
 * @returns {string}
 */
export function heuteIso(jetzt = new Date()) {
  return ZUERICH.format(jetzt);
}

/**
 * Ist das ein Tag, den es wirklich gibt?
 *
 * Die Formprüfung allein reicht nicht: «2026-02-31» besteht jede Regex und
 * jedes SQLite-GLOB, ist aber kein Datum. Der Umweg über den Vergleich mit der
 * zurückformatierten Zeichenkette fängt genau das — `new Date()` rollt den
 * 31. Februar stillschweigend auf den 3. März weiter.
 *
 * @param {string} iso
 * @returns {boolean}
 */
export function istEchterTag(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const datum = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(datum.getTime()) && datum.toISOString().slice(0, 10) === iso;
}

/**
 * Ein Tagesdatum um N Tage verschieben — für die Obergrenze im Formular.
 *
 * Rechnet in UTC, nicht in Ortszeit: Bei reinen Tagesangaben ist das die einzige
 * Arithmetik, die keine Sommerzeit-Sprünge kennt.
 *
 * @param {string} iso
 * @param {number} tage
 * @returns {string} «JJJJ-MM-TT», oder `iso` unverändert, wenn es kein Tag war.
 */
export function tageSpaeter(iso, tage) {
  if (!istEchterTag(iso)) return iso;
  const datum = new Date(`${iso}T00:00:00Z`);
  datum.setUTCDate(datum.getUTCDate() + tage);
  return datum.toISOString().slice(0, 10);
}

// ------------------------------------------------------------- Anzeige ---

/**
 * Datumsangaben aus den Daten sind reine Tagesangaben («2026-07-26») ohne Zeit
 * und ohne Zone. Ohne das angehängte `T00:00:00Z` und `timeZone: 'UTC'` läse ein
 * Browser sie als Mitternacht Ortszeit und zeigte westlich von Greenwich den
 * Vortag an — ein Tipp vom 1. wäre im Verlauf plötzlich vom 31.
 *
 * Das Formatieren steht hier neben der Tagesrechnung, seit die geteilte Ansicht
 * dieselben Datumsangaben serverseitig setzt. Eine zweite Kopie hätte nicht
 * gekracht, sie hätte bloss anders ausgesehen als die App.
 *
 * @param {string} iso
 * @param {Intl.DateTimeFormatOptions} optionen
 * @returns {string}
 */
function formatiere(iso, optionen) {
  const datum = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(datum.getTime())) return iso;
  return datum.toLocaleDateString('de-CH', { ...optionen, timeZone: 'UTC' });
}

/** «Juli 2026» — für Notizen, wo der genaue Tag niemanden interessiert. */
export function formatMonth(iso) {
  return formatiere(iso, { month: 'long', year: 'numeric' });
}

/** «26. Juli 2026» — für die Detailseite. */
export function formatDay(iso) {
  return formatiere(iso, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** «26.07.2026» — für die Karte, wo neben Name und Person kaum Platz bleibt. */
export function formatShort(iso) {
  return formatiere(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
