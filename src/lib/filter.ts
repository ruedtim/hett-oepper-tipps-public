import { distanzKm, mittelpunkt } from '../../shared/geo.mjs';
import { searchKey } from '../../shared/normalize.mjs';
import { countryName } from './countries';
import type { Coords, Tip } from './types';

export interface Filters {
  /** Kategorie-IDs. Ein Tipp passt, wenn er MINDESTENS eine davon hat. */
  categories: string[];
  /** ISO-Code oder leer für «alle». */
  country: string;
  /** placeKey oder leer für «alle». */
  place: string;
  /**
   * Umkreis um den gewählten Ort in Kilometern, `0` für «nur dieser Ort» (#58).
   * Im Feld heisst diese Stufe «+ 0 km».
   *
   * Ohne Ort wirkungslos — es gibt keinen Punkt, um den herum gesucht werden
   * könnte.
   */
  radius: number;
  /**
   * Normalisierte Namen. Ein Tipp passt, wenn IRGENDEINE Notiz von IRGENDEINER
   * dieser Personen ist — «von Tim und Matto» ist eine Frage, die man wirklich
   * stellt, «von Tim UND Matto zugleich» praktisch nie.
   */
  people: string[];
  /** Freitext. */
  query: string;
  /** Geschlossene Orte mitzeigen. */
  includeClosed: boolean;
}

export const EMPTY_FILTERS: Filters = {
  categories: [],
  country: '',
  place: '',
  radius: 0,
  people: [],
  query: '',
  includeClosed: false,
};

/** Die anwählbaren Umkreise über null. Was nicht hier steht, gilt als «+ 0 km». */
export const RADIEN = [5, 10, 30, 50] as const;

export function isEmpty(filters: Filters): boolean {
  return (
    filters.categories.length === 0 &&
    !filters.country &&
    !filters.place &&
    filters.radius === 0 &&
    filters.people.length === 0 &&
    !filters.query.trim() &&
    !filters.includeClosed
  );
}

/** Normalisierter Schlüssel einer Person, damit «Chrigi» und «chrigi» dieselbe sind. */
export function personKey(name: string): string {
  return searchKey(name);
}

/**
 * Alles Durchsuchbare eines Tipps in einem normalisierten String.
 *
 * Wird einmal pro Datensatz berechnet und gecacht: Bei jedem Tastendruck erneut
 * über alle Notizen zu normalisieren wäre auf einem älteren Handy spürbar.
 */
const haystacks = new WeakMap<Tip, string>();

function haystack(tip: Tip): string {
  const cached = haystacks.get(tip);
  if (cached !== undefined) return cached;

  const parts = [
    tip.name,
    tip.place,
    countryName(tip.country),
    tip.country,
    tip.address ?? '',
    ...tip.notes.map((note) => `${note.by} ${note.text}`),
  ];
  const built = searchKey(parts.join(' '));
  haystacks.set(tip, built);
  return built;
}

/**
 * Der Punkt, um den ein Umkreis gelegt wird.
 *
 * Ein Ort hat keine eigenen Koordinaten — es gibt keine `places`-Tabelle,
 * `placeKey` ist ein Schlüssel, der beim Lesen aus den Tipps entsteht. Also ist
 * der Anker der Schwerpunkt der Tipps dieses Orts.
 *
 * Gruppiert nach Land, es gewinnt das grösste Grüppchen: Trüge ein `placeKey`
 * Tipps in zwei Ländern (Berlin in Deutschland und Berlin in Maryland), läge
 * ihr gemeinsamer Schwerpunkt im Atlantik — und der Umkreis fände nichts.
 */
export function ortMittelpunkt(tips: Tip[], placeKey: string): Coords | null {
  if (!placeKey) return null;

  const proLand = new Map<string, Coords[]>();
  for (const tip of tips) {
    if (tip.placeKey !== placeKey || !tip.coords) continue;
    const liste = proLand.get(tip.country) ?? [];
    liste.push(tip.coords);
    proLand.set(tip.country, liste);
  }

  let groesste: Coords[] = [];
  for (const liste of proLand.values()) {
    if (liste.length > groesste.length) groesste = liste;
  }
  return mittelpunkt(groesste);
}

export function applyFilters(tips: Tip[], filters: Filters): Tip[] {
  const query = searchKey(filters.query);
  const categories = new Set(filters.categories);
  const people = new Set(filters.people);

  // Ohne Ort kein Anker und damit kein Umkreis: `radius` allein ist wirkungslos.
  const umkreis = filters.radius > 0 ? ortMittelpunkt(tips, filters.place) : null;

  return tips.filter((tip) => {
    if (tip.closed && !filters.includeClosed) return false;
    if (umkreis) {
      // Der Umkreis ERWEITERT die Ortswahl, statt sie zu ersetzen: Ein Tipp ohne
      // Koordinaten (die sind optional) soll nicht aus seinem eigenen Ort
      // verschwinden, bloss weil jemand am Regler gedreht hat.
      //
      // Und er schlägt das Land: Ein Umkreis um Kreuzlingen, der Konstanz wegen
      // des Landfilters weglässt, wäre genau der Fall, für den es ihn gibt.
      // Die Filterleiste leert das Landfeld deshalb beim Wählen mit — diese
      // Zeile ist das Netz für Links, die von Hand zusammengesetzt wurden.
      const nah =
        tip.placeKey === filters.place ||
        (tip.coords ? distanzKm(tip.coords, umkreis) <= filters.radius : false);
      if (!nah) return false;
    } else {
      if (filters.country && tip.country !== filters.country) return false;
      if (filters.place && tip.placeKey !== filters.place) return false;
    }
    if (people.size > 0 && !tip.notes.some((note) => people.has(personKey(note.by)))) {
      return false;
    }
    if (categories.size > 0 && !tip.categories.some((id) => categories.has(id))) return false;
    if (query && !haystack(tip).includes(query)) return false;
    return true;
  });
}

export interface PlaceOption {
  key: string;
  label: string;
  country: string;
  count: number;
}

/**
 * Orte für das Auswahlfeld. Zählt gegen die bereits nach Land und Kategorie
 * gefilterte Menge, damit dort keine Orte stehen, die zu null Treffern führen.
 */
export function placeOptions(tips: Tip[]): PlaceOption[] {
  const byKey = new Map<string, PlaceOption>();
  for (const tip of tips) {
    const existing = byKey.get(tip.placeKey);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(tip.placeKey, { key: tip.placeKey, label: tip.place, country: tip.country, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

export interface CountryOption {
  code: string;
  name: string;
  count: number;
}

export function countryOptions(tips: Tip[]): CountryOption[] {
  const byCode = new Map<string, CountryOption>();
  for (const tip of tips) {
    const existing = byCode.get(tip.country);
    if (existing) {
      existing.count += 1;
    } else {
      byCode.set(tip.country, { code: tip.country, name: countryName(tip.country), count: 1 });
    }
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export interface PersonOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Alle Personen, die irgendwo eine Notiz geschrieben haben.
 *
 * Bewusst über ALLE Notizen und nicht nur über die erste: Wer zu einem fremden
 * Tipp etwas beigesteuert hat, soll ihn unter seinem Namen wiederfinden.
 *
 * Als angezeigte Form gewinnt die häufigste Schreibweise — tippt jemand einmal
 * «tim» und dreimal «Tim», steht «Tim» im Auswahlfeld.
 */
export function personOptions(tips: Tip[]): PersonOption[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();

  for (const tip of tips) {
    // Pro Tipp zählt eine Person nur einmal, sonst hätte jemand mit drei
    // Notizen zum selben Lokal dort die Zahl 3 stehen.
    const seenHere = new Set<string>();
    for (const note of tip.notes) {
      const key = personKey(note.by);
      if (!key || seenHere.has(key)) continue;
      seenHere.add(key);

      const entry = byKey.get(key) ?? { count: 0, spellings: new Map() };
      entry.count += 1;
      entry.spellings.set(note.by, (entry.spellings.get(note.by) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }

  return [...byKey.entries()]
    .map(([key, entry]) => {
      let label = key;
      let best = -1;
      for (const [spelling, times] of entry.spellings) {
        if (times > best) {
          best = times;
          label = spelling;
        }
      }
      return { key, label, count: entry.count };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/** Wie viele Tipps hätte jede Kategorie unter den übrigen Filtern? */
export function categoryCounts(tips: Tip[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tip of tips) {
    for (const id of tip.categories) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// ------------------------------------------------------------ URL-Zustand ---

/**
 * Filter im URL-Hash ablegen, damit ein gefilterter Blick teilbar ist:
 * «schickt mir mal die Beizen in Rom» wird zu einem Link in den Gruppenchat.
 */
export function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.categories.length > 0) params.set('k', filters.categories.join(','));
  if (filters.country) params.set('l', filters.country);
  if (filters.place) params.set('o', filters.place);
  // Ohne Ort ist der Umkreis wirkungslos und hätte im Link nichts zu suchen.
  if (filters.place && filters.radius > 0) params.set('u', String(filters.radius));
  if (filters.people.length > 0) params.set('p', filters.people.join(','));
  if (filters.query.trim()) params.set('q', filters.query.trim());
  if (filters.includeClosed) params.set('zu', '1');
  return params.toString();
}

/** Liste oder Karte. */
export type View = 'liste' | 'karte';

/** Reihenfolge der Liste. `neu` ist die Vorgabe und entspricht der Bau-Sortierung. */
export type Sort = 'neu' | 'alt' | 'az';

/**
 * Alles, was einen Blick auf die Sammlung ausmacht, ausser den Filtern selbst.
 *
 * Steht neben den Filtern im Hash, damit ein Kartenblick auf «Saufen in Italien»
 * als ein Link verschickbar ist. Bewusst kein eigener Zustand in React: Sonst
 * spränge die Ansicht beim Zurück-Knopf des Browsers zurück auf die Liste.
 */
export interface ViewState {
  view: View;
  sort: Sort;
  /** Hervorgehobener Tipp auf der Karte, leer für keinen. */
  focus: string;
}

export const DEFAULT_VIEW: ViewState = { view: 'liste', sort: 'neu', focus: '' };

export function viewStateFromQuery(search: string): ViewState {
  const params = new URLSearchParams(search);
  const sort = params.get('s');
  return {
    view: params.get('a') === 'karte' ? 'karte' : 'liste',
    sort: sort === 'alt' || sort === 'az' ? sort : 'neu',
    focus: params.get('t') ?? '',
  };
}

/** Filter und Ansicht in einen Query-String. Die einzige Stelle, die die Kürzel kennt. */
export function toQuery(filters: Filters, state: ViewState): string {
  const params = new URLSearchParams(filtersToQuery(filters));
  if (state.view === 'karte') params.set('a', 'karte');
  if (state.sort !== 'neu') params.set('s', state.sort);
  if (state.focus) params.set('t', state.focus);
  return params.toString();
}

/**
 * Reihenfolge der Liste. Kopiert vorher — `sort()` würde sonst das gefilterte
 * Feld an Ort und Stelle umstellen, das React als unveränderlich behandelt.
 *
 * Bei gleichem Datum entscheidet der Name, damit die Reihenfolge zwischen zwei
 * Besuchen dieselbe bleibt: An einem Abend eingetragene Tipps haben alle dasselbe.
 */
export function applySort(tips: Tip[], sort: Sort): Tip[] {
  const byName = (a: Tip, b: Tip) => a.name.localeCompare(b.name, 'de');
  if (sort === 'az') return [...tips].sort(byName);
  const direction = sort === 'alt' ? 1 : -1;
  return [...tips].sort((a, b) =>
    a.added === b.added ? byName(a, b) : (a.added < b.added ? -1 : 1) * direction,
  );
}

export function filtersFromQuery(search: string): Filters {
  const params = new URLSearchParams(search);
  const categories = params.get('k');
  // `p` trug früher genau einen Namen — als einelementige Liste gelesen bleiben
  // schon verschickte Links gültig.
  const people = params.get('p');
  // Nur die angebotenen Stufen gelten lassen: Ein fremder Link mit «u=800»
  // zeigte sonst halb Europa und sähe dabei aus wie ein Ortsfilter.
  const radius = Number(params.get('u'));
  return {
    categories: categories ? categories.split(',').filter(Boolean) : [],
    country: params.get('l') ?? '',
    place: params.get('o') ?? '',
    radius: (RADIEN as readonly number[]).includes(radius) ? radius : 0,
    people: people ? people.split(',').filter(Boolean) : [],
    query: params.get('q') ?? '',
    includeClosed: params.get('zu') === '1',
  };
}
