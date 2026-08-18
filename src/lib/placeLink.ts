import { ApiError } from './api';
import { parsePlaceInput } from '../../shared/placeLinks.mjs';
import type { Coords } from './types';

export interface Ortsangabe {
  art: 'ort' | 'kurzlink' | 'unbrauchbar' | 'unbekannt';
  coords: Coords | null;
  genauigkeit: 'exakt' | 'ungefaehr' | null;
  name: string | null;
  suchtext: string | null;
  url: string | null;
  grund: string | null;
}

/**
 * Liest einen eingefügten Link.
 *
 * Alles ausser Kurzlinks wird im Browser gelesen — ohne Netzaufruf und ohne
 * dass irgendein Server die Adresse zu sehen bekommt. Nur Kurzlinks gehen an
 * /api/link, weil CORS dem Browser das Folgen der Weiterleitung verbietet.
 */
export async function leseOrtsangabe(eingabe: string): Promise<Ortsangabe> {
  const lokal = parsePlaceInput(eingabe) as Ortsangabe;
  if (lokal.art !== 'kurzlink' || !lokal.url) return lokal;

  let response: Response;
  try {
    response = await fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: lokal.url }),
    });
  } catch {
    throw new ApiError('Keine Verbindung — du kannst den Punkt auch auf der Karte setzen.', 0);
  }

  const daten = (await response.json().catch(() => ({}))) as {
    ergebnis?: Ortsangabe;
    error?: string;
  };

  if (!response.ok) {
    throw new ApiError(daten.error ?? 'Der Link liess sich nicht auflösen.', response.status);
  }
  return daten.ergebnis ?? { ...lokal, art: 'unbrauchbar', grund: 'Der Link ergab keinen Ort.' };
}
