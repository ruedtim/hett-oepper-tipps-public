import { useMemo } from 'react';
import { wunschZielKey, wunschZielLabel } from '../lib/wunschZiel';
import type { Wunsch } from '../lib/types';

interface Props {
  /** Nur offene, nicht abgelaufene — die Auswahl trifft App.tsx. */
  wuensche: Wunsch[];
  /** Bekommt den Zielschlüssel — «o:<ortKey>» oder «l:<land>». */
  onZiel: (zielKey: string) => void;
  onAlle: () => void;
}

/**
 * Die Zeile direkt unter dem Titel: Wonach gerade gesucht wird.
 *
 * Steht bewusst ganz oben und nicht auf einer Unterseite — ein Wunsch nützt nur,
 * wenn ihn sieht, wer den Ort kennt.
 *
 * Nur EIN Knopf, «alle ansehen»: Einen Wunsch anbringen kann man auf der
 * Wunschseite, und zwei Schaltflächen nebeneinander auf der Startseite waren
 * eine zu viel. Deshalb steht er auch im leeren Zustand — sonst wäre die
 * Wunschseite unerreichbar, sobald gerade niemand sucht, und der erste Wunsch
 * liesse sich nie mehr anbringen.
 *
 * Nicht in .masthead__row hinein: Dort teilen sich Titel und Aktionen die Breite
 * per space-between, und unter 24 rem schrumpfen die Pillen schon auf blosse
 * Emoji — eine dritte Spalte bräche das.
 */
export default function WunschZeile({ wuensche, onZiel, onAlle }: Props) {
  const ziele = useMemo(() => {
    // Gruppiert wird über den Zielschlüssel, nicht über den Ort: Sonst fielen
    // alle ortlosen Wünsche zusammen — «irgendwas in Portugal» läge dann mit
    // «irgendwas in Italien» im selben Chip.
    const byKey = new Map<string, { key: string; label: string; anzahl: number }>();
    for (const wunsch of wuensche) {
      const key = wunschZielKey(wunsch);
      const vorhanden = byKey.get(key);
      if (vorhanden) {
        vorhanden.anzahl += 1;
      } else {
        byKey.set(key, { key, label: wunschZielLabel(wunsch), anzahl: 1 });
      }
    }
    // Das meistgesuchte Ziel zuerst; bei Gleichstand alphabetisch, damit die
    // Reihenfolge zwischen zwei Besuchen nicht springt.
    return [...byKey.values()].sort(
      (a, b) => b.anzahl - a.anzahl || a.label.localeCompare(b.label, 'de'),
    );
  }, [wuensche]);

  return (
    <p className="wunschzeile">
      {ziele.length === 0 ? (
        <span className="wunschzeile__leer">Gerade sucht niemand Tipps.</span>
      ) : (
        <>
          <span className="wunschzeile__label">Tipps gesucht für</span>
          {ziele.map((ziel) => (
            <button
              key={ziel.key}
              type="button"
              className="wunschort"
              onClick={() => onZiel(ziel.key)}
              title={`${ziel.anzahl === 1 ? 'Ein Wunsch' : `${ziel.anzahl} Wünsche`} für ${ziel.label}`}
            >
              {ziel.label}
              {ziel.anzahl > 1 && <span className="wunschort__zahl">{ziel.anzahl}</span>}
            </button>
          ))}
        </>
      )}
      <button type="button" className="linkbutton" onClick={onAlle}>
        alle ansehen
      </button>
    </p>
  );
}
