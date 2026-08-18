import L from 'leaflet';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL } from './maps';

/**
 * Die dünne Schicht zwischen Leaflet und React.
 *
 * Bewusst kein `react-leaflet`: Das brächte eigene React-Peer-Zwänge mit, und wir
 * brauchen nur Karte aufsetzen, Marker setzen, Klicks entgegennehmen. Leaflet
 * selbst kennt React nicht — deshalb können künftige React-Versionen es gar nicht
 * brechen.
 *
 * Diese Datei wird nur aus nachgeladenen Komponenten importiert. Landete sie im
 * Hauptbundle, kämen 45 KB dazu, die niemand braucht, der nur die Liste ansieht.
 */

export interface MapHandle {
  map: L.Map;
  /** Räumt Karte und Ereignisse ab. Muss im Cleanup laufen. */
  destroy: () => void;
}

export function createMap(
  container: HTMLElement,
  options: { center: L.LatLngExpression; zoom: number },
): MapHandle {
  const map = L.map(container, {
    center: options.center,
    zoom: options.zoom,
    // Zeichnet alle Marker in ein einziges <canvas> statt in hunderte DOM-Knoten.
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    maxZoom: TILE_MAX_ZOOM,
    // Kein Vorabladen über den sichtbaren Bereich hinaus — die OSM-Richtlinie
    // erlaubt nur «the tiles needed for the current viewport».
    keepBuffer: 1,
  }).addTo(map);

  return {
    map,
    destroy: () => {
      map.off();
      map.remove();
    },
  };
}

/**
 * Marker als Inline-SVG statt als Bild.
 *
 * Leaflets Standard-Icons brechen unter Vite, weil Leaflet die PNG-Pfade relativ
 * zum CSS auflöst und Vite die Dateien umbenennt. Ein `divIcon` umgeht das
 * vollständig — und erlaubt nebenbei, den Pin in der Kategoriefarbe zu zeichnen,
 * ohne für jede Farbe eine eigene Bilddatei zu brauchen.
 */
export function pinIcon(color: string, options: { dimmed?: boolean } = {}): L.DivIcon {
  const fill = options.dimmed ? '#9a938a' : color;
  return L.divIcon({
    className: 'pin',
    html:
      `<svg viewBox="0 0 24 32" width="26" height="35" aria-hidden="true">` +
      `<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12z" ` +
      `fill="${fill}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>` +
      `<circle cx="12" cy="12" r="4.5" fill="#faf7f2"/>` +
      `</svg>`,
    iconSize: [26, 35],
    // Die Spitze des Pins zeigt auf den Punkt, nicht seine Mitte.
    iconAnchor: [13, 35],
    popupAnchor: [0, -32],
  });
}

/**
 * Fasst alle Punkte ins Bild. Bei einem einzelnen Punkt bleibt der Zoom brauchbar.
 *
 * `animate: false` ist hier keine Geschmacksfrage. Animiert schiebt Leaflet die
 * Karte erst über eine viertel Sekunde hin und setzt seine innere Position ganz
 * am Ende — bis dahin gibt `getCenter()` noch die ALTE Mitte zurück. Die
 * Ortswahl liest genau dort ihre Mitte ab; mit Animation stünde in der
 * Positionszeile ein Punkt, den niemand gewählt hat und der nicht unter dem
 * Fadenkreuz liegt. Beide Aufrufer setzen den Ausschnitt ohnehin beim Aufbau
 * der Karte, wo es nichts zu animieren gibt.
 */
export function fitToPoints(map: L.Map, points: L.LatLngExpression[], maxZoom = 15): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0] as L.LatLngExpression, maxZoom, { animate: false });
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom, animate: false });
}
