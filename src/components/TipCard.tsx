import { countryFlag, countryName } from '../lib/countries';
import { formatShort } from '../lib/dates';
import { personKey } from '../lib/filter';
import type { Category, Tip } from '../lib/types';
import CategoryChip from './CategoryChip';

interface Props {
  tip: Tip;
  categoriesById: Map<string, Category>;
  /** Aktive Personen-Filter, normalisiert. Steuern nur die Beschriftung. */
  personFilter?: string[];
  onOpen: () => void;
  /** Alle Tipps dieses Ortes zeigen. */
  onShowPlace: () => void;
  /** Alle Tipps dieses Landes zeigen. */
  onShowCountry: () => void;
  /** Alle Tipps dieser Person zeigen. */
  onShowPerson: (name: string) => void;
}

/**
 * «Tim», «Tim und Matto», «Tim, Matto und Nadia» — jeder Name ein Knopf, der
 * die Liste auf seine Tipps filtert. Die Trenner stehen ausserhalb der Knöpfe,
 * damit das Komma nicht mitfiltert.
 */
function Namen({ namen, onPerson }: { namen: string[]; onPerson: (name: string) => void }) {
  return (
    <>
      {namen.map((name, index) => (
        <span key={name}>
          {index > 0 && (index === namen.length - 1 ? ' und ' : ', ')}
          <button
            type="button"
            className="filterlink"
            onClick={() => onPerson(name)}
            title={`Alle Tipps von ${name} zeigen`}
          >
            {name}
          </button>
        </span>
      ))}
    </>
  );
}

/** Erste Notiz = die ursprüngliche Empfehlung. */
function excerpt(text: string, max = 150): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : max).trimEnd()}…`;
}

export default function TipCard({
  tip,
  categoriesById,
  personFilter,
  onOpen,
  onShowPlace,
  onShowCountry,
  onShowPerson,
}: Props) {
  const first = tip.notes[0];
  const extra = tip.notes.length - 1;
  const photo = tip.notes.find((note) => note.photo);

  // Filtert jemand nach «Nadia» und Nadia hat hier nur ergänzt, stünde auf der
  // Karte «von Tim» — und der Treffer sähe wie ein Fehler aus. Also sagen wir,
  // worin ihr Beitrag bestand. Bei mehreren gefilterten Leuten stehen alle da,
  // die zu diesem Tipp etwas beigesteuert haben.
  const wanted = new Set(personFilter);
  const contributors: string[] = [];
  if (wanted.size > 0 && first) {
    const seen = new Set([personKey(first.by)]);
    for (const note of tip.notes) {
      const key = personKey(note.by);
      if (seen.has(key) || !wanted.has(key)) continue;
      seen.add(key);
      contributors.push(note.by);
    }
  }

  return (
    <li className={`card${tip.closed ? ' card--closed' : ''}`}>
      <div className="card__body">
        <h2 className="card__title">
          {/* Die ganze Kachel bleibt der Klickbereich — auf dem Handy trifft
              man sonst daneben. Der Knopf umschliesst sie aber nicht mehr,
              sondern hängt am Namen und deckt die Kachel mit einem ::after zu:
              Der Ort eine Zeile tiefer ist selbst ein Knopf, und ein Knopf im
              Knopf ist nicht erlaubt. So bleibt der Name die Beschriftung. */}
          <button type="button" className="card__hit" onClick={onOpen}>
            {tip.name}
          </button>
          {tip.closed && <span className="badge badge--closed">gibt&rsquo;s nicht mehr</span>}
        </h2>

        <p className="card__where">
          <span aria-hidden="true">{countryFlag(tip.country)}</span>{' '}
          <button
            type="button"
            className="filterlink"
            onClick={onShowPlace}
            title={`Alle Tipps in ${tip.place} zeigen`}
          >
            {tip.place}
          </button>
          {/* Der Trenner « · » steckt als ::before an diesem span und bleibt
              damit ausserhalb des Knopfes — sonst führte auch der Punkt
              dazwischen ins Land. */}
          <span className="card__country">
            <button
              type="button"
              className="filterlink"
              onClick={onShowCountry}
              title={`Alle Tipps in ${countryName(tip.country)} zeigen`}
            >
              {countryName(tip.country)}
            </button>
          </span>
        </p>

        {first && <p className="card__text">{excerpt(first.text)}</p>}

        <div className="card__meta">
          <div className="card__cats">
            {tip.categories.map((id) => {
              const category = categoriesById.get(id);
              return category ? <CategoryChip key={id} category={category} readOnly /> : null;
            })}
          </div>
          <p className="card__by">
            {/* `first.by` ist in der Gäste-Sicht leer — dann steht die Zahl der
                Ergänzungen allein da, was stimmt und nichts verrät. */}
            {first?.by && (
              <>
                von <Namen namen={[first.by]} onPerson={onShowPerson} /> ·{' '}
              </>
            )}
            {contributors.length > 0 ? (
              <>
                ergänzt von <Namen namen={contributors} onPerson={onShowPerson} /> ·{' '}
              </>
            ) : extra > 0 ? (
              <>
                {extra} Ergänzung{extra === 1 ? '' : 'en'} ·{' '}
              </>
            ) : null}
            {/* Das Datum steht hier, weil man danach sortieren kann — eine
                Reihenfolge, deren Kriterium man nicht sieht, wirkt zufällig. */}
            <time dateTime={tip.added}>{formatShort(tip.added)}</time>
          </p>
        </div>
      </div>

      {/* Das Foto steht unter dem Text, nicht darüber: Oben schob es Name und
          Ort so weit nach unten, dass beim Blättern reihenweise Bilder ohne
          Beschriftung vorbeizogen. Gelesen wird zuerst der Tipp, das Bild ist
          die Zugabe — wie in der Detailansicht unter der Empfehlung. */}
      {photo?.photo && (
        <img
          className="card__photo"
          src={`/photos/${tip.id}/${photo.photo}`}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
    </li>
  );
}
