import { useEffect, useMemo, useRef, useState } from 'react';
import { AB_ZEICHEN, ETIKETT, findeVorschlaege } from '../lib/vorschlaege';
import type { SuchEintrag } from '../lib/vorschlaege';

interface Props {
  /** Der durchsuchbare Bestand, in App.tsx einmal pro Datensatz gebaut. */
  eintraege: SuchEintrag[];
  /**
   * Wie viele Tipps die Volltextsuche unter den übrigen Filtern fände. Nur für
   * die letzte Zeile — ein Angebot, das auf «Nichts gefunden» führt, soll gar
   * nicht erst dastehen.
   */
  volltextTreffer: (text: string) => number;
  /** Der aktive Freitextfilter, damit das Feld ihn anzeigt und ihn losbekommt. */
  query: string;
  onEintrag: (eintrag: SuchEintrag) => void;
  onVolltext: (text: string) => void;
  platzhalter: string;
}

type Zeile = { art: 'eintrag'; eintrag: SuchEintrag } | { art: 'volltext'; treffer: number };

/**
 * Das Suchfeld, das nachfragt, statt zu raten.
 *
 * Wer «Hamburg» tippt, bekommt «Hamburg — Ort», «Hamburgerstraße 20 — Adresse»
 * und «Fresh Hamburgers — Tipp» nebeneinander und wählt selbst. Vorher suchte
 * das Feld stillschweigend in allen Texten zugleich: Die Trefferliste stimmte
 * irgendwie, aber der Ortsfilter blieb leer — und ohne Ort gibt es keinen Anker
 * für den Umkreis (#58). Ein Ort-Vorschlag setzt jetzt denselben Filter wie das
 * Auswahlfeld darunter und macht den Umkreis damit erreichbar.
 *
 * Die Volltextsuche gibt es weiter, aber als LETZTE Zeile und benannt: Notizen
 * durchsuchen ist eine eigene Absicht, keine Vorgabe.
 */
export default function SuchFeld({
  eintraege,
  volltextTreffer,
  query,
  onEintrag,
  onVolltext,
  platzhalter,
}: Props) {
  const [text, setText] = useState(query);
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Von aussen geänderte Filter — «Filter zurücksetzen», ein geteilter Link —
  // müssen im Feld ankommen. Sonst stünde dort ein Wort, das nichts mehr filtert.
  useEffect(() => setText(query), [query]);

  const zeilen = useMemo<Zeile[]>(() => {
    const gefunden = findeVorschlaege(eintraege, text);
    const treffer = text.trim().length >= AB_ZEICHEN ? volltextTreffer(text) : 0;
    return [
      ...gefunden.map((eintrag): Zeile => ({ art: 'eintrag', eintrag })),
      ...(treffer > 0 ? [{ art: 'volltext' as const, treffer }] : []),
    ];
  }, [eintraege, text, volltextTreffer]);

  // Die oberste Zeile ist vorgewählt: Enter soll etwas Sichtbares tun, und was
  // es tut, steht hervorgehoben da. Zurückgesetzt bei jeder neuen Liste, sonst
  // zeigte die Markierung nach dem nächsten Buchstaben irgendwohin.
  useEffect(() => setAktiv(0), [zeilen]);

  useEffect(() => {
    if (!offen) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOffen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [offen]);

  const zeigen = offen && zeilen.length > 0;

  const waehle = (zeile: Zeile) => {
    setOffen(false);
    if (zeile.art === 'volltext') {
      onVolltext(text);
      return;
    }
    // Der Filter steht danach im Auswahlfeld darunter — im Suchfeld stehen zu
    // lassen, was jetzt woanders sichtbar ist, sähe nach zwei Filtern aus.
    setText('');
    onEintrag(zeile.eintrag);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOffen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (zeilen.length === 0) return;
      event.preventDefault();
      setOffen(true);
      const schritt = event.key === 'ArrowDown' ? 1 : -1;
      setAktiv((alt) => (alt + schritt + zeilen.length) % zeilen.length);
      return;
    }
    if (event.key === 'Enter') {
      const zeile = zeigen ? zeilen[aktiv] : undefined;
      if (!zeile) return;
      event.preventDefault();
      waehle(zeile);
    }
  };

  return (
    <div className="suchfeld" ref={box}>
      <input
        type="search"
        inputMode="search"
        // Sonst legt der Browser seine eigene Vorschlagsliste über unsere.
        autoComplete="off"
        role="combobox"
        aria-expanded={zeigen}
        aria-controls="suchfeld-liste"
        aria-autocomplete="list"
        aria-activedescendant={zeigen ? `suchfeld-zeile-${aktiv}` : undefined}
        aria-label="Tipps durchsuchen"
        placeholder={platzhalter}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOffen(true);
        }}
        onFocus={() => setOffen(true)}
        onKeyDown={onKeyDown}
      />

      {zeigen && (
        <ul className="suchfeld__liste" id="suchfeld-liste" role="listbox">
          {zeilen.map((zeile, index) => (
            <li
              key={zeile.art === 'volltext' ? 'volltext' : zeile.eintrag.id}
              id={`suchfeld-zeile-${index}`}
              role="option"
              aria-selected={index === aktiv}
              className={`suchfeld__zeile${index === aktiv ? ' suchfeld__zeile--aktiv' : ''}`}
              // Nicht `onClick`: Ein Klick käme erst nach dem Blur des Feldes,
              // und auf dem Handy schliesst die Tastatur die Liste vorher weg.
              onPointerDown={(event) => {
                event.preventDefault();
                waehle(zeile);
              }}
              onPointerEnter={() => setAktiv(index)}
            >
              {zeile.art === 'volltext' ? (
                <span className="suchfeld__volltext">
                  «{text.trim()}» in allen Texten suchen ({zeile.treffer})
                </span>
              ) : (
                <>
                  <span className="suchfeld__haupt">
                    <span className="suchfeld__label">{zeile.eintrag.label}</span>
                    <span className="suchfeld__etikett">{ETIKETT[zeile.eintrag.art]}</span>
                  </span>
                  <span className="suchfeld__zusatz">{zeile.eintrag.zusatz}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
