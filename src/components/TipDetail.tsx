import { countryFlag, countryName } from '../lib/countries';
import { formatDay, formatMonth } from '../lib/dates';
import { mapsUrl } from '../lib/maps';
import { wunschZielLabel } from '../lib/wunschZiel';
import type { Category, Tip, Wunsch } from '../lib/types';
import CategoryChip from './CategoryChip';

interface Props {
  tip: Tip;
  categoriesById: Map<string, Category>;
  /** Wünsche, denen dieser Tipp zugeordnet ist. Leer, sobald sie ablaufen. */
  wuensche?: Wunsch[];
  /** Gäste-Zugang: alles lesen, nichts ändern. */
  nurLesen?: boolean;
  onClose: () => void;
  /** Alle Tipps dieses Ortes zeigen. */
  onShowPlace: () => void;
  /** Alle Tipps dieses Landes zeigen. */
  onShowCountry: () => void;
  /** Alle Tipps dieser Person zeigen. */
  onShowPerson: (name: string) => void;
  onShowOnMap: () => void;
  onAddNote: () => void;
  onSuggestFix: () => void;
  onRemove: () => void;
  onWunschAnsehen?: () => void;
}

export default function TipDetail({
  tip,
  categoriesById,
  wuensche = [],
  nurLesen = false,
  onClose,
  onShowPlace,
  onShowCountry,
  onShowPerson,
  onShowOnMap,
  onAddNote,
  onSuggestFix,
  onRemove,
  onWunschAnsehen,
}: Props) {
  return (
    <article className="detail">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zurück
        </button>
      </div>

      <header className="detail__head">
        <h1>
          {tip.name}
          {tip.closed && <span className="badge badge--closed">gibt&rsquo;s nicht mehr</span>}
        </h1>
        {/* Ort und Land führen beide in die Liste — von hier aus die Frage,
            die man beim Lesen eines Tipps am ehesten stellt: «und was gibt's
            dort sonst noch?» */}
        <p className="detail__where">
          <span aria-hidden="true">{countryFlag(tip.country)}</span>{' '}
          <button
            type="button"
            className="filterlink"
            onClick={onShowPlace}
            title={`Alle Tipps in ${tip.place} zeigen`}
          >
            {tip.place}
          </button>
          ,{' '}
          <button
            type="button"
            className="filterlink"
            onClick={onShowCountry}
            title={`Alle Tipps in ${countryName(tip.country)} zeigen`}
          >
            {countryName(tip.country)}
          </button>
        </p>
        <div className="detail__cats">
          {tip.categories.map((id) => {
            const category = categoriesById.get(id);
            return category ? <CategoryChip key={id} category={category} readOnly /> : null;
          })}
        </div>
      </header>

      {/* «Auf der Karte» bleibt in der App; «Auf Google Maps» ist der Weg nach
          draussen — für Route, Öffnungszeiten und alles, was die eigene Karte
          nicht kann. */}
      <div className="detail__actions">
        {/* Ohne Koordinaten ist «Auf der Karte» sinnlos, und der Weg zum
            Nachtragen führt durchs Korrektur-Formular — für einen Gast bleibt
            hier nur der Weg nach draussen zu Google Maps. */}
        {tip.coords ? (
          <button type="button" className="button" onClick={onShowOnMap}>
            Auf der Karte
          </button>
        ) : (
          !nurLesen && (
            <button type="button" className="button" onClick={onSuggestFix}>
              Ort auf der Karte setzen
            </button>
          )
        )}
        <a
          className="button button--ghost"
          href={mapsUrl(tip)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {tip.coords ? 'Auf Google Maps' : 'In Google Maps suchen'}
        </a>
        {tip.link && (
          <a className="button button--ghost" href={tip.link} target="_blank" rel="noreferrer noopener">
            Website
          </a>
        )}
      </div>

      {tip.address && <p className="detail__address">{tip.address}</p>}

      {/* Zeigt, warum dieser Tipp gerade jetzt kam. Verschwindet mit dem Ablauf
          des Wunsches von selbst — dann ist die Frage beantwortet oder vorbei. */}
      {wuensche.length > 0 && (
        <p className="detail__wunsch">
          {/* Kein Genitiv: «Hanss Wunsch» wäre falsch, «Hans’ Wunsch» bräuchte
              eine Sonderregel für Namen auf s/ß/x/z. «von» stimmt immer. */}
          <span aria-hidden="true">💡</span> Eingetragen für den Wunsch von{' '}
          {wuensche.map((wunsch, index) => (
            <span key={wunsch.id}>
              {index > 0 && ', '}
              {onWunschAnsehen ? (
                <button type="button" className="linkbutton" onClick={onWunschAnsehen}>
                  {wunsch.von} nach {wunschZielLabel(wunsch)}
                </button>
              ) : (
                `${wunsch.von} nach ${wunschZielLabel(wunsch)}`
              )}
            </span>
          ))}{' '}
          <span className="detail__wunsch-bis">
            (bis <time dateTime={wuensche[0]!.bis}>{formatDay(wuensche[0]!.bis)}</time>)
          </span>
        </p>
      )}

      <section className="notes" aria-label="Empfehlungen">
        {tip.notes.map((note, index) => (
          <article key={note.id} className="note">
            <header className="note__head">
              {/* Ohne Namen — Gäste-Sicht — bleibt das Datum allein stehen, statt
                  ein leeres Fettgedrucktes davor zu setzen. Der Name führt zu
                  allem, was diese Person empfohlen hat; fett bleibt er, weil
                  .filterlink die Schrift der Umgebung erbt. */}
              {note.by && (
                <strong>
                  <button
                    type="button"
                    className="filterlink"
                    onClick={() => onShowPerson(note.by)}
                    title={`Alle Tipps von ${note.by} zeigen`}
                  >
                    {note.by}
                  </button>
                </strong>
              )}
              <span className="note__date">
                {formatMonth(note.added)}
                {index === 0 && tip.notes.length > 1 && ' · zuerst empfohlen'}
              </span>
            </header>
            <p className="note__text">{note.text}</p>
            {note.photo && (
              <img
                className="note__photo"
                src={`/photos/${tip.id}/${note.photo}`}
                alt={note.by ? `Foto von ${note.by}` : 'Foto zum Tipp'}
                loading="lazy"
                decoding="async"
              />
            )}
          </article>
        ))}
      </section>

      <p className="detail__added">
        Hinzugefügt am <time dateTime={tip.added}>{formatDay(tip.added)}</time>
      </p>

      {/* «Ergänzen» stand hier früher und las sich wie Datenpflege — dabei ist
          es der Knopf für den häufigsten Fall überhaupt: Man kennt den Ort auch
          und hat etwas dazu zu sagen. Über dem Knopf stehen immer schon
          Empfehlungen, das «auch» hat also stets einen Bezug. */}
      {!nurLesen && (
        <footer className="detail__foot">
          <button type="button" className="button" onClick={onAddNote}>
            Ich war auch da
          </button>
          <button type="button" className="button button--ghost" onClick={onSuggestFix}>
            Korrigieren
          </button>
          <button type="button" className="linkbutton detail__remove" onClick={onRemove}>
            Gibt&rsquo;s nicht mehr / löschen
          </button>
        </footer>
      )}
    </article>
  );
}
