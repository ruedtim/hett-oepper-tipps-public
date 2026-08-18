/**
 * Kartenkacheln von OpenStreetMap.
 *
 * Die [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
 * erlaubt genau unsere Nutzung — «Normal interactive viewing by a human where the
 * client requests only the tiles needed for the current viewport» — und stellt
 * dafür Bedingungen, von denen ein Browser die meisten von selbst erfüllt. Was WIR
 * einhalten müssen:
 *
 *   1. Die Attribution bleibt sichtbar. Nicht ausblenden, nicht überdecken.
 *   2. Keine restriktive Referrer-Policy — die Origin muss als Referer mitgehen.
 *   3. Kein Vorabladen, kein «Karte offline speichern». Ausdrücklich verboten.
 *   4. Nicht über unsere eigene Function proxen.
 *
 * Die Adresse steht hier als Konstante, weil die Policy ausdrücklich verlangt, den
 * Dienst ohne neue Programmversion wechseln zu können.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';
export const TILE_MAX_ZOOM = 19;

/**
 * Der Karten-Link selbst wohnt in `shared/maps.mjs` — die geteilte Ansicht baut
 * ihn serverseitig, und zwei Kopien liefen mit der Zeit auseinander. Hier steht
 * nur noch die Weiterleitung, damit kein Aufrufer im Frontend das merken muss.
 */
export { mapsUrl } from '../../shared/maps.mjs';
