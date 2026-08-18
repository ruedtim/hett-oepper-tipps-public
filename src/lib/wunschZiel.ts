/**
 * Wonach ein Wunsch fragt — ein Ort oder ein ganzes Land.
 *
 * Seit der Ort optional ist (Issue #22), reicht `ortKey` als
 * Gruppierungsschlüssel nicht mehr: Er ist bei allen ortlosen Wünschen leer,
 * und «irgendwas in Portugal» fiele mit «irgendwas in Italien» zusammen.
 * Deshalb ein Schlüssel mit Präfix, der beide Fälle auseinanderhält und
 * zugleich sagt, wonach zu filtern ist.
 */

import { countryName } from './countries';
import type { Wunsch } from './types';

/** «o:lissabon» oder «l:PT». */
export function wunschZielKey(wunsch: Wunsch): string {
  return wunsch.ortKey ? `o:${wunsch.ortKey}` : `l:${wunsch.land}`;
}

/** «Lissabon» oder «Portugal» — was im Chip und in der Überschrift steht. */
export function wunschZielLabel(wunsch: Wunsch): string {
  return wunsch.ort || countryName(wunsch.land);
}

/**
 * Zerlegt einen Zielschlüssel für den Tipp-Filter.
 *
 * Ein Ortswunsch filtert die Tippliste auf den Ort, ein Landwunsch aufs Land —
 * beides kann `filter.ts` bereits, es braucht nur die richtige Zuordnung.
 */
export function zielZuFilter(zielKey: string): { place: string; country: string } {
  if (zielKey.startsWith('o:')) return { place: zielKey.slice(2), country: '' };
  if (zielKey.startsWith('l:')) return { place: '', country: zielKey.slice(2) };
  return { place: '', country: '' };
}
