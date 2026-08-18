import type { Env } from '../lib/env';

/**
 * Ortssuche und Rückwärtssuche — über Photon.
 *
 * WARUM ÜBER EINEN EIGENEN ENDPUNKT und nicht direkt aus dem Browser:
 *
 *   1. Solche Dienste verlangen einen identifizierenden User-Agent. Ein Browser
 *      lässt den nicht setzen — nur serverseitig ist das erfüllbar.
 *   2. Die Anbieter-Adresse steckt so nicht im Bundle. Photon ist offiziell eine
 *      Demo-Instanz ohne Verfügbarkeitszusage; ein Wechsel darf keinen neuen
 *      Build brauchen.
 *   3. Antworten lassen sich zwischenspeichern, was die Last dort spürbar senkt.
 *
 * WARUM PHOTON UND NICHT NOMINATIM: Nominatims Nutzungsrichtlinie verbietet
 * Suche-während-des-Tippens wörtlich — «you must not implement such a service on
 * the client side using the API» — und das steht unter «strictly forbidden and
 * will get you banned». Photon bewirbt genau das als Hauptzweck.
 *
 * Achtung bei den Kacheln: Dort gilt das Umgekehrte. Die OSM-Kachelrichtlinie
 * VERBIETET einen Proxy ausdrücklich («tunnel all clients behind a single,
 * anonymous identity»). Diese Asymmetrie ist beabsichtigt — nicht «vereinheitlichen».
 */

const PHOTON = 'https://photon.komoot.io';
// Die Richtlinie verlangt eine erreichbare Kontaktadresse — sie muss also dem
// kanonischen Host aus functions/lib/hosts.ts folgen, wenn der je wechselt.
const USER_AGENT = 'hett-oepper-tipps/1.0 (privater Freundeskreis; +https://tipps.beispiel.example)';
const CACHE_SECONDS = 60 * 60 * 24 * 30;

export interface GeoTreffer {
  label: string;
  lat: number;
  lng: number;
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  country?: string;
  countrycode?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  let upstream: string;
  if (q) {
    if (q.length < 2) return json({ treffer: [] });
    upstream = `${PHOTON}/api?q=${encodeURIComponent(q)}&lang=de&limit=8`;
    // Näher an einem bekannten Ort suchen, wenn das Formular schon einen hat.
    if (lat && lng && isCoord(lat, lng)) {
      upstream += `&lat=${Number(lat)}&lon=${Number(lng)}&location_bias_scale=0.3`;
    }
  } else if (lat && lng) {
    if (!isCoord(lat, lng)) return json({ error: 'Ungültige Koordinaten.' }, 400);
    upstream = `${PHOTON}/reverse?lat=${Number(lat)}&lon=${Number(lng)}&lang=de&limit=1`;
  } else {
    return json({ error: 'Weder Suchtext noch Koordinaten übergeben.' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(upstream, { method: 'GET' });

  const gespeichert = await cache.match(cacheKey);
  if (gespeichert) return gespeichert;

  let antwort: Response;
  try {
    antwort = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
  } catch (fehler) {
    console.error('Photon nicht erreichbar:', fehler);
    return json({ error: 'Die Ortssuche antwortet gerade nicht. Du kannst den Punkt trotzdem auf der Karte antippen.' }, 503);
  }

  if (!antwort.ok) {
    console.error('Photon-Fehler:', antwort.status);
    return json({ error: 'Die Ortssuche antwortet gerade nicht. Du kannst den Punkt trotzdem auf der Karte antippen.' }, 503);
  }

  const daten = (await antwort.json()) as { features?: PhotonFeature[] };
  const ergebnis = json({ treffer: (daten.features ?? []).map(zuTreffer) });

  // Der Cache braucht eine eigene Kopie, weil der Körper nur einmal lesbar ist.
  const zumSpeichern = ergebnis.clone();
  zumSpeichern.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  await cache.put(cacheKey, zumSpeichern);

  return ergebnis;
};

/**
 * Photon liefert GeoJSON — dort steht die LÄNGE zuerst, dann die Breite.
 * Unser `coords`-Feld ist umgekehrt aufgebaut. Die Umrechnung passiert genau
 * hier und nirgends sonst; verwechselt man sie, liegt der Pin im Meer.
 */
function zuTreffer(feature: PhotonFeature): GeoTreffer {
  const [lon, lat] = feature.geometry.coordinates;
  const p = feature.properties;

  // «Lokalname, Strasse Nr, PLZ Stadt, Land» — leere Stufen fallen weg, und
  // wenn der Lokalname zufällig der Strassenname ist, steht er nicht doppelt da.
  const strasse = [p.street, p.housenumber].filter(Boolean).join(' ');
  const ort = [p.postcode, p.city ?? p.county].filter(Boolean).join(' ');
  const teile = [p.name, strasse, ort, p.country].filter(
    (teil): teil is string => Boolean(teil) && teil!.length > 0,
  );

  return {
    label: [...new Set(teile)].join(', '),
    lat,
    lng: lon,
    ...(p.name ? { name: p.name } : {}),
    ...(p.street ? { street: p.street } : {}),
    ...(p.housenumber ? { housenumber: p.housenumber } : {}),
    ...(p.postcode ? { postcode: p.postcode } : {}),
    ...(p.city ?? p.county ? { city: p.city ?? p.county } : {}),
    ...(p.country ? { country: p.country } : {}),
    ...(p.countrycode ? { countrycode: p.countrycode.toUpperCase() } : {}),
  };
}

function isCoord(lat: string, lng: string): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': status === 200 ? 'private, max-age=600' : 'no-store' },
  });
}
