import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createMap, fitToPoints } from '../lib/leaflet';
import { searchPlacesStaged } from '../lib/geo';
import type { GeoTreffer } from '../lib/geo';
import type { Coords } from '../lib/types';

export interface PickResult {
  coords: Coords;
  /** Nur gefüllt, wenn ausdrücklich «Adresse übernehmen» gedrückt wurde. */
  address?: string;
  city?: string;
  countrycode?: string;
}

interface Props {
  initial?: Coords | null;
  /** Koordinaten anderer Tipps am selben Ort — der beste Startpunkt, ohne einen Dienst zu fragen. */
  nearby?: Coords[];
  /** Was im Formular schon steht, als Vorschlag fürs Suchfeld. */
  suggestion?: string;
  /**
   * Beim Öffnen sofort nach `suggestion` suchen und den besten Treffer nehmen.
   *
   * Gesetzt, wenn ein eingefügter Link Name und Adresse mitbrachte, aber keine
   * Koordinaten — der häufigste Fall beim Teilen aus der Google-Maps-App. Ohne
   * das stand hier nur der Text im Suchfeld, das Fadenkreuz aber weiterhin auf
   * dem zuletzt benutzten Ausschnitt. Wer dann «Diesen Punkt nehmen» drückte,
   * trug den Ort aus Hamburg in Zürich ein.
   */
  sofortSuchen?: boolean;
  onCancel: () => void;
  onPick: (result: PickResult) => void;
}

/**
 * Neuer Schlüssel seit dem Umbau des Startausschnitts: Unter dem alten liegt in
 * jedem Browser, der die App schon benutzt hat, ein Ausschnitt, den die frühere
 * Regel erzeugt hat — bei weit verstreuten Tipps der Mittelwert mitten in der
 * Sahara. Der würde den neuen Startausschnitt beim ersten Öffnen gleich wieder
 * schlagen und alles sähe aus wie vorher.
 */
const LAST_VIEW = 'hot:lastMapView2';

/**
 * Ort auf der Karte wählen.
 *
 * Bewusst ein Overlay über dem Formular und keine eigene Route: Ein Routenwechsel
 * würde das Formular aushängen, und damit wäre ein bereits verkleinertes Foto weg —
 * das liegt im React-State, nicht im gespeicherten Entwurf.
 *
 * Bedienung: Fadenkreuz fest in der Mitte, Karte darunter verschieben. Kein
 * ziehbarer Marker — beim Ziehen liegt der Finger genau auf dem Punkt, den man
 * treffen will. Antippen zentriert grob, Verschieben justiert fein.
 */
export default function PlacePicker({
  initial,
  nearby,
  suggestion,
  sofortSuchen,
  onCancel,
  onPick,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const [center, setCenter] = useState<Coords>(initial ?? { lat: 0, lng: 0 });
  const [query, setQuery] = useState(suggestion ?? '');
  const [results, setResults] = useState<GeoTreffer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [address, setAddress] = useState<PickResult | null>(null);

  /** Adresse und Hinweis gehören zu einem gefundenen Punkt — und nur zu dem. */
  const verwerfeTreffer = () => {
    setAddress(null);
    setHinweis(null);
  };

  // Der Zurück-Knopf des Handys soll das Overlay schliessen, nicht die App
  // verlassen. Der Hash bleibt dabei unangetastet, der Hash-Router merkt nichts.
  useEffect(() => {
    window.history.pushState({ picker: true }, '');
    const onPop = () => onCancel();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    const element = container.current;
    if (!element || element.dataset.mapReady === 'ja') return;
    element.dataset.mapReady = 'ja';

    const start = startView(initial, nearby);
    const handle = createMap(element, { center: [start.lat, start.lng], zoom: start.zoom });
    mapRef.current = handle.map;

    const onMove = () => {
      const c = handle.map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    };
    // Antippen zentriert grob; die Feinarbeit macht das Verschieben.
    const onClick = (event: L.LeafletMouseEvent) => {
      verwerfeTreffer();
      handle.map.panTo(event.latlng);
    };

    handle.map.on('moveend', onMove);
    handle.map.on('click', onClick);
    // Der Treffer aus der Suche gilt, bis die Person die Karte SELBST bewegt.
    // Deshalb hängt das Verwerfen an Ziehen, Zoomen und Antippen — und nicht an
    // `moveend`: Leaflet meldet auch Bewegungen, die niemand ausgelöst hat
    // (`invalidateSize` rückt die Karte gerade, sobald der Container seine
    // endgültige Höhe hat, und meldet das 200 ms später als Bewegung). Wer
    // daran leerte, warf den gerade gefundenen Treffer weg: Der Punkt blieb
    // stehen, Ort, Land und Adresse waren still verschwunden.
    //
    // Ein Abstandsvergleich statt Ereignissen wäre die falsche Kur — Leaflet
    // rundet die Mitte auf ganze Pixel, und wie viele Meter das sind, hängt am
    // Zoom. Es gibt keine Schwelle, die auf Zoom 3 und auf Zoom 19 stimmt.
    handle.map.on('dragstart', verwerfeTreffer);
    handle.map.on('zoomstart', verwerfeTreffer);

    // Alle bekannten Punkte ins Bild rücken — und erst DANACH die Mitte
    // ablesen. `fitToPoints` setzt den Ausschnitt ohne Animation, sonst stünde
    // hier noch die alte Mitte (siehe dort).
    if (start.fit) {
      fitToPoints(handle.map, start.fit.map((c) => [c.lat, c.lng] as L.LatLngExpression), 11);
    }

    const mitte = handle.map.getCenter();
    setCenter({ lat: mitte.lat, lng: mitte.lng });

    const timer = setTimeout(() => handle.map.invalidateSize(), 50);

    return () => {
      clearTimeout(timer);
      try {
        localStorage.setItem(
          LAST_VIEW,
          JSON.stringify({ ...handle.map.getCenter(), zoom: handle.map.getZoom() }),
        );
      } catch {
        // Privater Modus — dann eben ohne Erinnerung.
      }
      handle.map.off();
      mapRef.current = null;
      handle.destroy();
      delete element.dataset.mapReady;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setHinweis(null);
    try {
      const found = await searchPlacesStaged(query.trim(), center);
      setResults(found);
      if (found.length === 0) setError('Nichts gefunden. Du kannst den Punkt trotzdem antippen.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die Suche antwortet nicht.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Aus einem Link kam Name und Adresse, aber kein Punkt: dann selbst suchen und
   * den besten Treffer nehmen.
   *
   * Google gibt beim Teilen aus der Handy-App eine Adresse ohne Koordinaten
   * heraus und schlägt die Position über seine interne Kennung (`ftid`) selbst
   * nach — dafür bräuchte es einen Google-Schlüssel. Name und Adresse stehen
   * aber ausgeschrieben da, und damit findet die Ortssuche den Punkt selbst.
   * Gesucht wird gestuft (siehe `searchPlacesStaged`): Lokale, die das
   * Verzeichnis nicht kennt, findet erst die Adresse ohne den Namen davor.
   *
   * Das Ergebnis wird ausdrücklich benannt, statt es still zu übernehmen: Der
   * Punkt kommt aus einer zweiten Quelle, das darf man sehen. Falsch liegen
   * kann er trotzdem — deshalb steht daneben, wie man ihn korrigiert.
   *
   * Trägt der Link NUR einen Namen («Teilen» aus der Google-Suche via
   * share.google — kein Komma, keine Hausnummer, keine PLZ), ist ein einzelner
   * Welt-Treffer schwache Evidenz: OpenStreetMap kennt dann womöglich bloss
   * einen Namensvetter ganz woanders. Ein «Il Focacciaio» aus der Ostschweiz
   * landete so kommentarlos wirkend in Berlin — beim einzigen Lokal dieses
   * Namens im Verzeichnis. Der Sprung zum Treffer bleibt (ist er richtig, ist
   * alles getan), aber der Hinweis sagt ausdrücklich, dass es ein anderes
   * Lokal gleichen Namens sein kann.
   */
  useEffect(() => {
    const text = (suggestion ?? '').trim();
    if (!sofortSuchen || text.length < 2) return;

    const nurName = !text.includes(',') && !/\d/.test(text);

    let abgebrochen = false;
    setBusy(true);
    searchPlacesStaged(text)
      .then((found) => {
        if (abgebrochen) return;
        const bester = found[0];
        if (!bester) {
          setError('Zu diesem Link liess sich kein Punkt finden. Bitte selbst setzen.');
          return;
        }
        goTo(bester);
        setHinweis(
          nurName
            ? `Der Link nennt nur den Namen, keinen Punkt. Gefunden: ${bester.label} — ` +
              'das kann ein anderes Lokal mit demselben Namen sein. Bitte prüfen; ' +
              (found.length > 1 ? '«Suchen» zeigt die anderen Treffer.' : 'stimmt es nicht, Karte verschieben.')
            : found.length > 1
              ? `Aus dem Link gefunden: ${bester.label}. Stimmt das nicht, «Suchen» zeigt die anderen Treffer.`
              : `Aus dem Link gefunden: ${bester.label}. Stimmt das nicht, Karte verschieben.`,
        );
      })
      .catch(() => {
        if (!abgebrochen) setError('Die Suche antwortet nicht — bitte den Punkt selbst setzen.');
      })
      .finally(() => {
        if (!abgebrochen) setBusy(false);
      });

    return () => {
      abgebrochen = true;
    };
    // Einmal beim Öffnen. Später gilt, was die Person auf der Karte tut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(treffer: GeoTreffer) {
    // Ohne `animate: false` verschiebt sich die Karte bei einem NAHEN Treffer
    // sanft — und das `moveend` am Ende der Bewegung löscht die Adresse, die
    // zwei Zeilen weiter unten gerade gesetzt wurde. Man bekäme dann still nur
    // den Punkt statt Adresse, Ort und Land. Bei einem fernen Treffer springt
    // Leaflet ohnehin, deshalb fiel es nie auf.
    mapRef.current?.setView([treffer.lat, treffer.lng], 17, { animate: false });
    setResults(null);
    setAddress({
      coords: { lat: treffer.lat, lng: treffer.lng },
      ...(treffer.street
        ? { address: [treffer.street, treffer.housenumber].filter(Boolean).join(' ') }
        : {}),
      ...(treffer.city ? { city: treffer.city } : {}),
      ...(treffer.countrycode ? { countrycode: treffer.countrycode } : {}),
    });
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setError('Dieses Gerät gibt seinen Standort nicht her.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        verwerfeTreffer();
        mapRef.current?.setView([position.coords.latitude, position.coords.longitude], 17);
        setBusy(false);
      },
      () => {
        setError('Standort nicht verfügbar — bitte den Punkt antippen.');
        setBusy(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  /**
   * Steht `address` noch, hat niemand die Karte seither angefasst — dann gilt
   * der gefundene Punkt mitsamt Adresse, Ort und Land. Bewusst DESSEN
   * Koordinaten und nicht die Kartenmitte: Leaflet rundet die Mitte auf ganze
   * Pixel, der Treffer ist die genauere Zahl.
   */
  const übernehmen = () => onPick(address ?? { coords: center });

  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label="Ort auf der Karte wählen">
      <form className="picker__search" onSubmit={search}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Adresse oder Name suchen"
          aria-label="Adresse oder Name suchen"
          enterKeyHint="search"
        />
        <button type="submit" className="button" disabled={busy}>
          {busy ? '…' : 'Suchen'}
        </button>
      </form>

      {results && results.length > 0 && (
        <ul className="picker__results">
          {results.map((treffer, index) => (
            <li key={`${treffer.lat},${treffer.lng},${index}`}>
              <button type="button" onClick={() => goTo(treffer)}>
                {treffer.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Das Fadenkreuz MUSS in derselben Box wie die Karte sitzen. Läge es im
          Overlay, zeigte es 46 px unter die Kartenmitte — weil Suchleiste oben
          und Fussleiste unten unterschiedlich hoch sind. Die Koordinaten kämen
          weiterhin aus der Kartenmitte, und jeder Pin landete systematisch
          daneben, ohne dass es jemandem auffiele. */}
      <div className="picker__mapwrap">
        <div className="picker__map" ref={container} />
        <div className="picker__cross" aria-hidden="true">
          <svg viewBox="0 0 24 32" width="30" height="40">
            <path
              d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12z"
              fill="#9c3d2e"
              stroke="rgba(0,0,0,.3)"
              strokeWidth="1"
            />
            <circle cx="12" cy="12" r="4.5" fill="#faf7f2" />
          </svg>
        </div>
      </div>

      <div className="picker__bar">
        {error && <p className="picker__error" role="alert">{error}</p>}
        {hinweis && <p className="picker__hint" role="status">{hinweis}</p>}

        <div className="picker__coords">
          <label>
            <span className="visually-hidden">Breitengrad</span>
            <input
              type="number"
              step="0.000001"
              value={center.lat.toFixed(6)}
              onChange={(event) => {
                const lat = Number(event.target.value);
                if (!Number.isFinite(lat)) return;
                // Von Hand getippte Zahlen sind ein eigener Punkt, kein Treffer.
                verwerfeTreffer();
                mapRef.current?.setView([lat, center.lng]);
              }}
            />
          </label>
          <label>
            <span className="visually-hidden">Längengrad</span>
            <input
              type="number"
              step="0.000001"
              value={center.lng.toFixed(6)}
              onChange={(event) => {
                const lng = Number(event.target.value);
                if (!Number.isFinite(lng)) return;
                verwerfeTreffer();
                mapRef.current?.setView([center.lat, lng]);
              }}
            />
          </label>
          <button type="button" className="linkbutton" onClick={locateMe}>
            Mein Standort
          </button>
        </div>

        <div className="picker__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="button" onClick={übernehmen}>
            Diesen Punkt nehmen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wohin die Karte anfangs schaut — ohne einen einzigen Dienst zu fragen.
 * Reihenfolge: schon gesetzter Punkt, zuletzt benutzter Ausschnitt, alle
 * bekannten Tipps, Weltkarte.
 *
 * Der MITTELWERT der bekannten Punkte stand hier einmal an zweiter Stelle. Bei
 * Tipps aus Kapstadt, Parma und Zürich liegt der mitten in der Sahara — und
 * das auf Strassenzoom, also auf einer leeren sandfarbenen Fläche ohne einen
 * einzigen Namen. Deshalb jetzt der umschliessende Ausschnitt (`fit`) statt der
 * Mitte: Er zeigt alles, was die Runde kennt, und man sieht auf einen Blick,
 * wo man ist.
 *
 * Auch die beiden Zoomstufen sind bewusst klein: Lieber zwei Wischer zu weit
 * draussen anfangen als nicht zu wissen, welche Stadt man vor sich hat.
 */
function startView(
  initial: Coords | null | undefined,
  nearby: Coords[] | undefined,
): { lat: number; lng: number; zoom: number; fit?: Coords[] } {
  if (initial) return { ...initial, zoom: 17 };

  try {
    const gespeichert = localStorage.getItem(LAST_VIEW);
    if (gespeichert) {
      const v = JSON.parse(gespeichert) as { lat: number; lng: number; zoom: number };
      if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
        // Ein NaN käme als Zoomstufe bei Leaflet an und ergäbe eine leere Karte.
        return { lat: v.lat, lng: v.lng, zoom: Number.isFinite(v.zoom) ? Math.min(v.zoom, 12) : 12 };
      }
    }
  } catch {
    // egal
  }

  const erster = nearby?.[0];
  if (erster) {
    // Der Mittelpunkt hier ist nur der Startwert; `fit` rückt gleich zurecht.
    return { ...erster, zoom: 3, fit: nearby };
  }

  return { lat: 47.0, lng: 8.3, zoom: 3 };
}
