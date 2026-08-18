/**
 * Luftlinie und Ortsmittelpunkt — die Rechnung hinter dem Umkreisfilter (#58).
 *
 * Liegt in `shared/` und nicht in `src/lib/`, obwohl nur das Frontend rechnet:
 * `npm run test` läuft über `shared/*.test.mjs`, und diese Formeln gehören in
 * dieselbe Kategorie wie `placeLinks.mjs` — ihre Fehler krachen nicht, sie
 * liefern still die falsche Liste. Vertauschte lat/lng ergeben eine Zahl, die
 * plausibel aussieht und niemandem auffällt.
 */

/** Mittlerer Erdradius in Kilometern. */
const ERDRADIUS_KM = 6371;

const bogen = (grad) => (grad * Math.PI) / 180;

/**
 * Luftlinie zwischen zwei Punkten in Kilometern (Haversine).
 *
 * Die Erde als Kugel statt als Ellipsoid: Für Entfernungen unter hundert
 * Kilometern liegt das ein paar Meter daneben — bei einem Filter, dessen
 * kleinste Stufe fünf Kilometer beträgt, ist das ohne Bedeutung.
 *
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number} Entfernung in Kilometern
 */
export function distanzKm(a, b) {
  const dLat = bogen(b.lat - a.lat);
  const dLng = bogen(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(bogen(a.lat)) * Math.cos(bogen(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * ERDRADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Mittelpunkt einer Punktwolke — der Anker, den ein Ort selbst nicht hat.
 *
 * Es gibt keine `places`-Tabelle: Ein Ort ist ein String, der beim Lesen aus den
 * Tipps entsteht. Der Umkreis braucht aber einen Punkt, also nehmen wir den
 * Schwerpunkt der Tipps dieses Orts. Innerhalb einer Stadt ist das unkritisch —
 * über eine ganze Sammlung hinweg wäre es das nicht, weshalb die Kartenwahl
 * bewusst `fit` statt eines Mittelwerts nimmt (der Schwerpunkt von Kapstadt,
 * Parma und Zürich läge in der Sahara). Deshalb hier immer nur über die Punkte
 * EINES Orts aufrufen.
 *
 * Naiv über die Längengrade gemittelt: Ein Ort, dessen Tipps den 180. Meridian
 * umspannen, käme falsch heraus — den gibt es in dieser Sammlung nicht, und ein
 * Ort, der ihn umspannt, wäre auch kein Ort mehr.
 *
 * @param {Array<{ lat: number, lng: number }>} punkte
 * @returns {{ lat: number, lng: number } | null} null bei leerer Eingabe
 */
export function mittelpunkt(punkte) {
  if (punkte.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const punkt of punkte) {
    lat += punkt.lat;
    lng += punkt.lng;
  }
  return { lat: lat / punkte.length, lng: lng / punkte.length };
}
