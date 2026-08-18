import { useEffect, useRef, useState } from 'react';
import type { PersonOption } from '../lib/filter';

interface Props {
  /** Auswählbare Personen, bereits gegen die übrigen Filter gezählt. */
  people: PersonOption[];
  /** Normalisierte Namen. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Mehrfachauswahl für Personen.
 *
 * Ein `<select multiple>` ist auf dem Handy kaum bedienbar, und eine zweite
 * Chip-Reihe hätte die ohnehin klebende Filterleiste weiter aufgeblasen. Also
 * ein Knopf, der aussieht wie die Auswahlfelder daneben und eine Liste
 * ausklappt — die Reihe bleibt eine Reihe, egal wie viele Leute mitschreiben.
 */
export default function PeoplePick({ people, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Ohne das bliebe die Liste offen stehen, sobald man daneben tippt.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Wer ausgewählt ist, aber unter den übrigen Filtern zu null Treffern führt,
  // fällt aus den Optionen — er muss trotzdem sichtbar und abwählbar bleiben,
  // sonst sitzt man vor einer leeren Liste ohne erkennbaren Grund.
  const missing = selected
    .filter((key) => !people.some((person) => person.key === key))
    .map((key) => ({ key, label: key, count: 0 }));
  const shown = [...people, ...missing];

  // Gibt es niemanden, gibt es nichts zu filtern — in der Gäste-Sicht schickt
  // der Server keine Namen mit. Ein ausgegrautes «Alle Leute» wäre dort ein
  // Feld, das nie etwas tun kann.
  if (shown.length === 0) return null;

  const chosen = selected.map(
    (key) => shown.find((person) => person.key === key)?.label ?? key,
  );
  const label =
    chosen.length === 0
      ? 'Alle Leute'
      : chosen.length <= 2
        ? chosen.join(', ')
        : `${chosen.length} Leute`;

  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <div className="peoplepick" ref={box}>
      <button
        type="button"
        className="peoplepick__button"
        aria-expanded={open}
        aria-label={`Nach Personen filtern (${label})`}
        disabled={shown.length < 2}
        onClick={() => setOpen(!open)}
      >
        <span className="peoplepick__label">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="peoplepick__panel">
          {shown.map((person) => (
            <label key={person.key} className="peoplepick__row">
              <input
                type="checkbox"
                checked={selected.includes(person.key)}
                onChange={() => toggle(person.key)}
              />
              {/* «Lukas (1)» — dieselbe Schreibweise wie in den Auswahlfeldern. */}
              <span className="peoplepick__name">
                {person.label} ({person.count})
              </span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="linkbutton peoplepick__clear"
              onClick={() => onChange([])}
            >
              Alle Leute zeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
