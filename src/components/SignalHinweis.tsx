import { useEffect, useRef, useState } from 'react';

/**
 * Die Einladung in den Signal-Chat, einmal beim ersten Besuch (#62).
 *
 * Ein Overlay und nicht bloss die Zeile unter der Liste: Die Fusszeile steht am
 * Ende einer Liste, die je nach Anzahl Tipps eine halbe Ewigkeit Scrollen
 * entfernt ist — genau das Argument, mit dem der alte Footer damals in die
 * Kopfzeile gewandert ist. Der Hinweis soll EINMAL wirklich gesehen werden;
 * danach übernimmt die Fusszeile, die niemanden mehr unterbricht.
 *
 * Gemerkt wird im Browser, nicht am Konto: Es geht um «hat diese Person das
 * schon mal gesehen», nicht um einen Zustand, der einen Serverrundgang oder
 * gar eine Spalte in `users` verdient hätte.
 */

/**
 * Die Zahl am Ende ist die Fassung des Textes: Wer die vorige Einladung schon
 * weggeklickt hat, soll eine NEUE Botschaft trotzdem einmal zu sehen bekommen.
 * Wer also den Text unten austauscht, zählt hier hoch — sonst spricht das
 * Overlay nur noch zu denen, die vorher nie da waren.
 */
const SCHLUESSEL = 'hot:signal-gesehen:3';

function schonGesehen(): boolean {
  try {
    return localStorage.getItem(SCHLUESSEL) === 'ja';
  } catch {
    // Kein Speicher (privater Modus, gesperrte Cookies): Dann lieber einmal pro
    // Besuch zeigen als nie — die Einladung ist die Ausnahme, nicht die Regel.
    return false;
  }
}

function merkeGesehen(): void {
  try {
    localStorage.setItem(SCHLUESSEL, 'ja');
  } catch {
    // Nicht merken zu können darf den Hinweis nicht verschlucken.
  }
}

interface Props {
  /** Beitritts-Link. Fehlt er, hängt App.tsx den Hinweis gar nicht erst ein. */
  url: string;
}

export default function SignalHinweis({ url }: Props) {
  // Einmal beim ersten Rendern entschieden: Der Merker unten würde den Hinweis
  // sonst im selben Atemzug wieder wegnehmen, in dem er ihn zeigt.
  const [offen, setOffen] = useState(() => !schonGesehen());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;
    // Gemerkt wird beim ZEIGEN und nicht beim Wegklicken: Wer den Tab zumacht,
    // hat den Hinweis trotzdem gesehen. Und weil er ohne Link gar nicht erst
    // erscheint, brennt der Merker nicht, solange das Secret noch fehlt.
    merkeGesehen();
    box.current?.focus();
  }, [offen]);

  useEffect(() => {
    if (!offen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOffen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offen]);

  if (!offen) return null;

  return (
    <div className="hinweis" onClick={() => setOffen(false)}>
      <div
        className="hinweis__box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hinweis-titel"
        tabIndex={-1}
        ref={box}
        // Ein Klick INS Feld soll es nicht schliessen — sonst wäre schon das
        // Markieren des Textes ein Wegklicken.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="hinweis__titel" id="hinweis-titel">
          Wir suchen eine neue URL für diese Seite. Hast du eine Idee?
        </h2>
        <p className="hinweis__text">Komm in den Signal-Chat!</p>
        <div className="hinweis__aktionen">
          <a
            className="button"
            href={url}
            target="_blank"
            rel="noopener"
            onClick={() => setOffen(false)}
          >
            Zum Signal-Chat
          </a>
          <button type="button" className="button button--ghost" onClick={() => setOffen(false)}>
            Nein
          </button>
        </div>
      </div>
    </div>
  );
}
