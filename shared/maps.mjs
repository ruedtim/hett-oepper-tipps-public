/**
 * Der Google-Maps-Link zu einem Tipp.
 *
 * Wohnt hier und nicht mehr in `src/lib/maps.ts`, seit die geteilte Ansicht
 * (`functions/geteilt/`) denselben Link serverseitig braucht. Zwei Kopien wären
 * genau der Fehler, den `shared/datum.mjs` im Kopf beschreibt: Sie sehen so
 * lange gleich aus, bis jemand eine anfasst — und dann zeigt der geteilte Link
 * auf eine andere Stelle als die App, ohne dass irgendwo etwas kracht.
 *
 * Die Leaflet-Kachel-Konstanten sind DA geblieben: Die betreffen nur die eigene
 * Kartenansicht im Browser, und die OSM-Richtlinie verlangt ausdrücklich, dass
 * die Kacheln nicht über eine eigene Function laufen.
 */

/**
 * Karten-Link zur Laufzeit erzeugen statt in den Daten einfrieren.
 *
 * Eine gespeicherte Google-URL ist auf einem iPhone der falsche Link und in drei
 * Jahren womöglich tot. Aus Koordinaten oder Adresse gebaut, öffnet der Link auf
 * jedem Gerät die dort installierte Karten-App.
 *
 * Das Ansehen übernimmt seit der eigenen Kartenansicht diese selbst. Hierher
 * führt nur noch «Auf Google Maps» — für Route, Öffnungszeiten und alles, was
 * die eigene Karte nicht kann. Ohne Koordinaten wird daraus eine Suche, und
 * die kann danebenliegen.
 *
 * @param {{name: string, place: string, country: string, address?: string | null,
 *          coords?: {lat: number, lng: number} | null}} tip
 * @returns {string}
 */
export function mapsUrl(tip) {
  if (tip.coords) {
    const { lat, lng } = tip.coords;
    // Der q-Parameter setzt die Stecknadel, das Label macht sie benennbar.
    return `https://maps.google.com/maps?q=${lat},${lng}(${encodeURIComponent(tip.name)})`;
  }
  const query = [tip.name, tip.address, tip.place, tip.country].filter(Boolean).join(', ');
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}`;
}
