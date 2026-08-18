import { searchKey } from '../../shared/normalize.mjs';
import { countryFlag, countryName } from './countries';
import { personOptions } from './filter';
import type { Tip } from './types';

/**
 * Was das Suchfeld vorschlagen kann.
 *
 * Der Punkt der ganzen Datei: Ein Freitextfeld weiss nicht, ob «Hamburg» der
 * Ort, die Hamburgerstrasse oder das Lokal «Fresh Hamburgers» sein soll — es
 * fand alle drei und legte sich auf keines fest. Hier legt sich stattdessen der
 * MENSCH fest: Jeder Vorschlag trägt sein Etikett («Ort», «Adresse», «Tipp»),
 * und was beim Anklicken passiert, hängt daran.
 *
 * Zwei Sorten, sichtbar am Etikett: `ort`, `land` und `person` SETZEN einen
 * Filter — genau denselben, den die Auswahlfelder darunter setzen. `tipp` und
 * `adresse` meinen einen einzelnen Eintrag und SPRINGEN dorthin; eine gefilterte
 * Liste der Länge eins wäre ein Umweg um das, was gemeint war.
 */
export type VorschlagArt = 'ort' | 'land' | 'person' | 'tipp' | 'adresse';

export const ETIKETT: Record<VorschlagArt, string> = {
  ort: 'Ort',
  land: 'Land',
  person: 'Person',
  tipp: 'Tipp',
  adresse: 'Adresse',
};

interface Basis {
  /** Eindeutig über alle Arten — React-Schlüssel und `aria-activedescendant`. */
  id: string;
  /** Erste Zeile, in der Schreibweise der Sammlung. */
  label: string;
  /** Zweite Zeile: wo das steht, wie oft es vorkommt. */
  zusatz: string;
  /** Normalisierter Volltext des Labels, ohne Leerzeichen (siehe `searchKey`). */
  key: string;
  /**
   * Die normalisierten Einzelwörter. Nötig, weil `searchKey` die Leerzeichen
   * mitfrisst: «Fresh Hamburgers» wird zu «freshhamburgers», und darin ist
   * «hamburg» kein Wortanfang mehr, sondern irgendwo in der Mitte.
   */
  woerter: string[];
}

export type SuchEintrag =
  | (Basis & { art: 'ort'; place: string; country: string })
  | (Basis & { art: 'land'; country: string })
  | (Basis & { art: 'person'; person: string })
  | (Basis & { art: 'tipp'; tipId: string })
  | (Basis & { art: 'adresse'; tipId: string });

function woerterVon(text: string): string[] {
  return text
    .split(/[\s,./-]+/)
    .map((wort) => searchKey(wort))
    .filter(Boolean);
}

function basis(id: string, label: string, zusatz: string): Basis {
  return { id, label, zusatz, key: searchKey(label), woerter: woerterVon(label) };
}

const anzahl = (n: number) => `${n} ${n === 1 ? 'Tipp' : 'Tipps'}`;

/**
 * Der durchsuchbare Bestand, einmal pro Datensatz gebaut.
 *
 * Bewusst über ALLE Tipps und nicht über die gerade gefilterten: Wer «Parma»
 * tippt, während noch «Saufen» angehakt ist, soll Parma trotzdem angeboten
 * bekommen — die Vorschlagsliste ist der Weg zu einem Filter, nicht sein
 * Ergebnis.
 */
export function suchIndex(tips: Tip[]): SuchEintrag[] {
  const eintraege: SuchEintrag[] = [];

  // Orte nach Schlüssel UND Land: «Berlin» in Deutschland und «Berlin» in
  // Maryland sind zwei Zeilen mit zwei Fahnen — und beim Anklicken wird das
  // Land mitgesetzt, sonst zeigte der Filter beide.
  const orte = new Map<string, { label: string; place: string; country: string; count: number }>();
  const laender = new Map<string, number>();

  for (const tip of tips) {
    const ortSchluessel = `${tip.placeKey}|${tip.country}`;
    const ort = orte.get(ortSchluessel);
    if (ort) ort.count += 1;
    else orte.set(ortSchluessel, { label: tip.place, place: tip.placeKey, country: tip.country, count: 1 });

    laender.set(tip.country, (laender.get(tip.country) ?? 0) + 1);

    eintraege.push({
      ...basis(`tipp:${tip.id}`, tip.name, `${tip.place} · ${countryName(tip.country)}`),
      art: 'tipp',
      tipId: tip.id,
    });

    if (tip.address) {
      eintraege.push({
        ...basis(`adresse:${tip.id}`, tip.address, `${tip.name} · ${tip.place}`),
        art: 'adresse',
        tipId: tip.id,
      });
    }
  }

  for (const [schluessel, ort] of orte) {
    eintraege.push({
      ...basis(
        `ort:${schluessel}`,
        ort.label,
        `${countryFlag(ort.country)} ${countryName(ort.country)} · ${anzahl(ort.count)}`,
      ),
      art: 'ort',
      place: ort.place,
      country: ort.country,
    });
  }

  for (const [code, count] of laender) {
    eintraege.push({
      ...basis(`land:${code}`, countryName(code), `${countryFlag(code)} ${anzahl(count)}`),
      art: 'land',
      country: code,
    });
  }

  // Über `personOptions`, damit hier dieselbe Schreibweise gewinnt wie im
  // Auswahlfeld daneben. In der Gäste-Sicht schickt der Server keine Namen mit,
  // dann ist die Liste leer und es gibt schlicht keine Personen-Vorschläge.
  for (const person of personOptions(tips)) {
    eintraege.push({
      ...basis(`person:${person.key}`, person.label, anzahl(person.count)),
      art: 'person',
      person: person.key,
    });
  }

  return eintraege;
}

/**
 * Bei Gleichstand entscheidet die Art. Ein Ort steht vor einem Lokal, weil er
 * die gröbere Frage beantwortet — wer «Parma» tippt, meint fast immer die Stadt
 * und nicht den Tipp, der zufällig so heisst. Eine Adresse steht zuletzt: Sie
 * ist die genaueste Angabe und zugleich die, die am seltensten gemeint ist.
 */
const RANG: Record<VorschlagArt, number> = { ort: 0, land: 1, person: 2, tipp: 3, adresse: 4 };

/**
 * Wie gut ein Eintrag passt, klein ist besser. `null` heisst «gar nicht».
 *
 * Die Stufen sind der Grund, warum «Hamburg» den Ort vor die Hamburgerstrasse
 * und die vor «Fresh Hamburgers» stellt: exakt schlägt Anfang schlägt
 * Wortanfang schlägt irgendwo.
 */
function guete(eintrag: SuchEintrag, q: string): number | null {
  if (eintrag.key === q) return 0;
  if (eintrag.key.startsWith(q)) return 1;
  if (eintrag.woerter.some((wort) => wort.startsWith(q))) return 2;
  if (eintrag.key.includes(q)) return 3;
  return null;
}

/** Ab wie vielen Zeichen vorgeschlagen wird — darunter passt einfach zu viel. */
export const AB_ZEICHEN = 2;

/** Mehr als das füllt auf dem Handy den Bildschirm und hilft niemandem mehr. */
const HOECHSTENS = 7;

export function findeVorschlaege(eintraege: SuchEintrag[], text: string): SuchEintrag[] {
  const q = searchKey(text);
  if (text.trim().length < AB_ZEICHEN || !q) return [];

  return eintraege
    .flatMap((eintrag) => {
      const wert = guete(eintrag, q);
      return wert === null ? [] : [{ eintrag, wert }];
    })
    .sort(
      (a, b) =>
        a.wert - b.wert ||
        RANG[a.eintrag.art] - RANG[b.eintrag.art] ||
        a.eintrag.label.localeCompare(b.eintrag.label, 'de'),
    )
    .slice(0, HOECHSTENS)
    .map((treffer) => treffer.eintrag);
}
