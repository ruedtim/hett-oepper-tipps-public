import { ApiError } from './api';
import { suchtextStufen } from '../../shared/placeLinks.mjs';
import type { Coords } from './types';

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

async function ask(params: URLSearchParams): Promise<GeoTreffer[]> {
  let response: Response;
  try {
    response = await fetch(`/api/geo?${params.toString()}`);
  } catch {
    throw new ApiError('Keine Verbindung.', 0);
  }

  const data = (await response.json().catch(() => ({}))) as { treffer?: GeoTreffer[]; error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Die Ortssuche antwortet nicht.', response.status);
  return data.treffer ?? [];
}

/**
 * Ortssuche. Wird nur auf Knopfdruck ausgelöst, nie bei jedem Tastendruck —
 * die Suche wandert über unseren Endpunkt zu einem gespendeten Dienst.
 */
export function searchPlaces(query: string, near?: Coords): Promise<GeoTreffer[]> {
  const params = new URLSearchParams({ q: query });
  if (near && (near.lat !== 0 || near.lng !== 0)) {
    params.set('lat', String(near.lat));
    params.set('lng', String(near.lng));
  }
  return ask(params);
}

/**
 * Ortssuche mit Rückfallstufe: erst der volle Text, dann — wenn nichts kam —
 * die Adresse ohne den Namensteil (Regeln in `suchtextStufen`). Nötig für die
 * «Name, Strasse, PLZ Ort, Land»-Texte aus geteilten Links: Steht das Lokal
 * nicht im Verzeichnis, findet der volle Text nichts, die Adresse sehr wohl.
 * Höchstens eine Anfrage mehr, und nur im Fall, der sonst leer ausginge.
 */
export async function searchPlacesStaged(query: string, near?: Coords): Promise<GeoTreffer[]> {
  for (const stufe of suchtextStufen(query)) {
    const treffer = await searchPlaces(stufe, near);
    if (treffer.length > 0) return treffer;
  }
  return [];
}

/**
 * Adresse zu einem Punkt. Ausdrücklich NICHT bei jeder Kartenbewegung aufrufen —
 * beim Verschieben entstünden Dutzende Anfragen pro Sekunde, und das fällt unter
 * die systematischen Abfragen, die solche Dienste untersagen.
 */
export async function reverseGeocode(coords: Coords): Promise<GeoTreffer | null> {
  const params = new URLSearchParams({ lat: String(coords.lat), lng: String(coords.lng) });
  const treffer = await ask(params);
  return treffer[0] ?? null;
}
