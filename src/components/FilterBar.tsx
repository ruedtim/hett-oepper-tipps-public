import { countryFlag } from '../lib/countries';
import { EMPTY_FILTERS, isEmpty, RADIEN } from '../lib/filter';
import type { CountryOption, Filters, PersonOption, PlaceOption, Sort } from '../lib/filter';
import type { Category } from '../lib/types';
import type { SuchEintrag } from '../lib/vorschlaege';
import CategoryChip from './CategoryChip';
import PeoplePick from './PeoplePick';
import SuchFeld from './SuchFeld';

interface Props {
  categories: Category[];
  categoryCounts: Map<string, number>;
  countries: CountryOption[];
  places: PlaceOption[];
  people: PersonOption[];
  /** Der durchsuchbare Bestand fürs Suchfeld, gebaut über ALLE Tipps. */
  suchEintraege: SuchEintrag[];
  volltextTreffer: (text: string) => number;
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Für Vorschläge, die einen einzelnen Tipp meinen (Name oder Adresse). */
  onOpenTip: (tipId: string) => void;
  /** Reihenfolge. Kein Filter — «Filter zurücksetzen» lässt sie darum stehen. */
  sort: Sort;
  onSortChange: (next: Sort) => void;
  closedCount: number;
}

export default function FilterBar({
  categories,
  categoryCounts,
  countries,
  places,
  people,
  suchEintraege,
  volltextTreffer,
  filters,
  onChange,
  onOpenTip,
  sort,
  onSortChange,
  closedCount,
}: Props) {
  const toggleCategory = (id: string) => {
    const next = filters.categories.includes(id)
      ? filters.categories.filter((c) => c !== id)
      : [...filters.categories, id];
    onChange({ ...filters, categories: next });
  };

  // Nur aktive Kategorien anbieten — deaktivierte bleiben auf bestehenden Tipps
  // sichtbar, sollen aber nicht mehr filterbar sein.
  const selectable = categories.filter((c) => c.active || filters.categories.includes(c.id));

  /**
   * Ein gewählter Vorschlag tut genau das, was der Bedienteil darunter täte —
   * das ist der ganze Sinn der Übung. Und er räumt den Freitext weg: Das Feld
   * hat immer nur EINE Wirkung, sonst filterten Text und Ort unsichtbar
   * gemeinsam.
   */
  const waehleVorschlag = (eintrag: SuchEintrag) => {
    switch (eintrag.art) {
      // Ein einzelner Eintrag ist gemeint — eine gefilterte Liste der Länge eins
      // wäre ein Umweg um das, was jemand gerade gesucht hat.
      case 'tipp':
      case 'adresse':
        onOpenTip(eintrag.tipId);
        return;
      case 'ort':
        // Das Land kommt mit, wie überall beim Ortssprung: `placeKey` allein
        // liesse Berlin in Deutschland und Berlin in Maryland zusammenfallen.
        onChange({
          ...filters,
          query: '',
          place: eintrag.place,
          country: eintrag.country,
          radius: 0,
        });
        return;
      case 'land':
        onChange({ ...filters, query: '', country: eintrag.country, place: '', radius: 0 });
        return;
      case 'person':
        // Angehängt statt ersetzt, weil das Auswahlfeld daneben Kreuzchen hat
        // und «von Tim und Matto» eine Frage ist, die man wirklich stellt.
        onChange({
          ...filters,
          query: '',
          people: filters.people.includes(eintrag.person)
            ? filters.people
            : [...filters.people, eintrag.person],
        });
    }
  };

  return (
    <div className="filterbar">
      <SuchFeld
        eintraege={suchEintraege}
        volltextTreffer={volltextTreffer}
        query={filters.query}
        onEintrag={waehleVorschlag}
        onVolltext={(text) => onChange({ ...filters, query: text })}
        // Ohne Namen — Gäste-Sicht — wäre «Person» ein Versprechen, das das
        // Feld nicht halten kann: Der Server schickt sie gar nicht mit.
        platzhalter={
          people.length > 0 ? 'Suchen — Ort, Land, Tipp, Person' : 'Suchen — Ort, Land, Tipp'
        }
      />

      <div className="filterbar__chips" role="group" aria-label="Nach Kategorie filtern">
        {selectable.map((category) => (
          <CategoryChip
            key={category.id}
            category={category}
            count={categoryCounts.get(category.id) ?? 0}
            active={filters.categories.includes(category.id)}
            onClick={() => toggleCategory(category.id)}
          />
        ))}
      </div>

      <div className="filterbar__selects">
        <label>
          <span className="visually-hidden">Land</span>
          <select
            value={filters.country}
            // Der Ort fällt beim Landwechsel weg — und mit ihm der Umkreis, der
            // ohne Ort ohnehin keinen Anker hätte.
            onChange={(event) =>
              onChange({ ...filters, country: event.target.value, place: '', radius: 0 })
            }
          >
            <option value="">Alle Länder</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {countryFlag(country.code)} {country.name} ({country.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="visually-hidden">Ort</span>
          <select
            value={filters.place}
            // Kein Ort mehr, kein Umkreis: Er hinge sonst unsichtbar im Link.
            onChange={(event) =>
              onChange({
                ...filters,
                place: event.target.value,
                radius: event.target.value ? filters.radius : 0,
              })
            }
            // Auch EIN Ort ist seit #58 eine Wahl: Ihn zu setzen ist der einzige
            // Weg zum Umkreis, der ohne Ort keinen Anker hat. Gesperrt wird
            // darum nur noch, wenn wirklich nichts dasteht.
            disabled={places.length === 0}
          >
            <option value="">Alle Orte</option>
            {places.map((place) => (
              <option key={place.key} value={place.key}>
                {place.label} ({place.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="visually-hidden">Umkreis</span>
          <select
            value={String(filters.radius)}
            // Ein Umkreis leert das Landfeld: Er greift über Grenzen (Konstanz
            // im Umkreis von Kreuzlingen), und ein Feld, das «Schweiz» behauptet,
            // während deutsche Tipps in der Liste stehen, sagt die Unwahrheit.
            onChange={(event) => {
              const radius = Number(event.target.value);
              onChange({ ...filters, radius, country: radius > 0 ? '' : filters.country });
            }}
            disabled={!filters.place}
          >
            {/* «+ 0 km» und nicht «genau hier»: Als einziger Eintrag ohne
                Kilometerangabe sah die Vorgabe nicht nach der Nullstufe einer
                Skala aus, sondern nach einer Beschriftung — wer einen Umkreis
                suchte, erkannte das Feld gar nicht als das dafür. */}
            <option value="0">+ 0 km</option>
            {RADIEN.map((km) => (
              <option key={km} value={km}>
                + {km} km
              </option>
            ))}
          </select>
        </label>

        <PeoplePick
          people={people}
          selected={filters.people}
          onChange={(next) => onChange({ ...filters, people: next })}
        />

        <label>
          <span className="visually-hidden">Reihenfolge</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as Sort)}>
            <option value="neu">Neuste zuerst</option>
            <option value="alt">Älteste zuerst</option>
            <option value="az">Name A–Z</option>
          </select>
        </label>
      </div>

      {(!isEmpty(filters) || closedCount > 0) && (
        <div className="filterbar__footer">
          {closedCount > 0 && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.includeClosed}
                onChange={(event) => onChange({ ...filters, includeClosed: event.target.checked })}
              />
              Geschlossene zeigen ({closedCount})
            </label>
          )}
          {!isEmpty(filters) && (
            <button type="button" className="linkbutton" onClick={() => onChange(EMPTY_FILTERS)}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
