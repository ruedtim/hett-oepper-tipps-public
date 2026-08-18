import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createMap, fitToPoints, pinIcon } from '../lib/leaflet';
import { personKey } from '../lib/filter';
import type { Category, Tip } from '../lib/types';

interface Props {
  tips: Tip[];
  categoriesById: Map<string, Category>;
  /** Auf diesen Tipp zoomen und sein Popup öffnen. Leer für die Übersicht. */
  focusId?: string;
  onOpen: (tipId: string) => void;
}

/**
 * Wer den Tipp empfohlen hat.
 *
 * Steht im Popup dort, wo vorher der Ort stand: Wo der Punkt liegt, sagt die
 * Karte schon selbst — wessen Tipp es ist, sagt sonst niemand. Zusammengefasst
 * über den normalisierten Namen, damit «Tim» und «tim» eine Person bleiben.
 */
function recommendedBy(tip: Tip): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const note of tip.notes) {
    const key = personKey(note.by);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(note.by);
  }
  if (names.length === 0) return '';
  if (names.length === 1) return `von ${names[0]}`;
  if (names.length === 2) return `von ${names[0]} und ${names[1]}`;
  return `von ${names[0]} und ${names.length - 1} weiteren`;
}

/**
 * Die Tipps auf einer Karte.
 *
 * Wird ausschliesslich über React.lazy geladen. Der `import 'leaflet/dist/leaflet.css'`
 * hier oben ist Absicht: Vite zieht das CSS eines nachgeladenen Chunks mit in einen
 * eigenen Chunk, sodass die Listenansicht kein Byte schwerer wird.
 */
export default function MapView({ tips, categoriesById, focusId, onOpen }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Die Callback-Referenz frisch halten, ohne die Karte neu aufzubauen.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  // Gemerkt, weil dieses Feld in den Abhängigkeiten des Effekts steht: Ein
  // frisches Feld bei jedem Rendern bauten die Karte jedes Mal neu auf und
  // warfen dabei den selbst gewählten Ausschnitt weg.
  const withCoords = useMemo(() => tips.filter((tip) => tip.coords), [tips]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    // React 19 ruft Effekte im Entwicklungsmodus doppelt auf. Ohne diesen Abbruch
    // gäbe es «Map container is already initialized» und zwei Karten übereinander.
    if (element.dataset.mapReady === 'ja') return;
    element.dataset.mapReady = 'ja';

    const handle = createMap(element, { center: [46.8, 8.2], zoom: 3 });
    let focused: L.Marker | null = null;

    for (const tip of withCoords) {
      const category = tip.categories.map((id) => categoriesById.get(id)).find(Boolean);
      const marker = L.marker([tip.coords!.lat, tip.coords!.lng], {
        icon: pinIcon(category?.color ?? '#9c3d2e', { dimmed: tip.closed }),
        title: tip.name,
        alt: tip.name,
        keyboard: true,
      }).addTo(handle.map);
      if (tip.id === focusId) focused = marker;

      const chips = tip.categories
        .map((id) => categoriesById.get(id))
        .filter(Boolean)
        .map((c) => `${c!.emoji} ${c!.label}`)
        .join(' · ');

      const by = recommendedBy(tip);

      marker.bindPopup(
        `<strong>${escapeHtml(tip.name)}</strong>` +
          (by ? `<br><span class="mappop__by">${escapeHtml(by)}</span>` : '') +
          (chips ? `<br><span class="mappop__cats">${escapeHtml(chips)}</span>` : '') +
          `<br><button type="button" class="mappop__open" data-tip="${escapeHtml(tip.id)}">Ansehen</button>`,
      );
    }

    // Ein hervorgehobener Punkt gewinnt gegen den Gesamtausschnitt: Wer aus einem
    // Tipp heraus hierherkommt, will diesen einen sehen, nicht ganz Europa.
    if (focused) {
      handle.map.setView(focused.getLatLng(), 16);
      focused.openPopup();
    } else {
      fitToPoints(
        handle.map,
        withCoords.map((tip) => [tip.coords!.lat, tip.coords!.lng] as L.LatLngExpression),
      );
    }

    // Der Knopf im Popup wird von Leaflet erzeugt, nicht von React — deshalb ein
    // Ereignis auf dem Container statt eines onClick.
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest('.mappop__open');
      const id = target?.getAttribute('data-tip');
      if (id) openRef.current(id);
    };
    element.addEventListener('click', onClick);

    // Der Container ist beim ersten Rendern womöglich noch nicht sichtbar; ohne
    // das hier zeichnet Leaflet nur ein Viertel der Kacheln.
    const timer = setTimeout(() => handle.map.invalidateSize(), 50);

    return () => {
      clearTimeout(timer);
      element.removeEventListener('click', onClick);
      handle.destroy();
      delete element.dataset.mapReady;
    };
  }, [withCoords, categoriesById, focusId]);

  return <div className="mapview" ref={container} role="application" aria-label="Karte der Tipps" />;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
