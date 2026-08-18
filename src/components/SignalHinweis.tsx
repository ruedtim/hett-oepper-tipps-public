import { useEffect, useRef, useState } from 'react';

/**
 * Die Einladung in den Signal-Chat, einmal beim ersten Besuch (#62) — und
 * seither zugleich die kurze Liste dessen, was neu ist.
 *
 * Ein Overlay und nicht bloss die Zeile unter der Liste: Die Fusszeile steht am
 * Ende einer Liste, die je nach Anzahl Tipps eine halbe Ewigkeit Scrollen
 * entfernt ist — genau das Argument, mit dem der alte Footer damals in die
 * Kopfzeile gewandert ist. Der Hinweis soll EINMAL wirklich gesehen werden;
 * danach übernimmt die Fusszeile, die niemanden mehr unterbricht.
 *
 * Warum die Neuigkeiten HIER stehen und nicht auf der Infos-Seite: Die Infos
 * beschreiben, wie die Seite funktioniert — wer sie liest, sucht bereits etwas.
 * Eine neue Möglichkeit sucht niemand, von der er nicht weiss; sie muss einmal
 * von selbst vorbeikommen. Deshalb bleibt die Liste auch kurz und nennt nur,
 * was jemand TUN kann, nicht was gebaut wurde: Ein Änderungsprotokoll wäre
 * schon beim zweiten Punkt ungelesen.
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
const SCHLUESSEL = 'hot:signal-gesehen:5';

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
  /** Führt auf die Konto-Seite — dort wohnen Einladungen, Mail und Download. */
  onKonto: () => void;
}

export default function SignalHinweis({ url, onKonto }: Props) {
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

        {/* Die Neuigkeiten stehen NACH der Frage und optisch abgesetzt: Die
            Frage ist der Anlass des Overlays, die Liste die Zugabe. Umgekehrt
            gerahmt läse sich das Ganze als Änderungsprotokoll mit einer Bitte
            im Kleingedruckten. */}
        <div className="hinweis__neu">
          <h3 className="hinweis__neu-titel">Ausserdem neu</h3>
          <ul className="hinweis__liste">
            <li>
              Du kannst jetzt <strong>selbständig weitere Leute einladen</strong> — drei
              Einladungslinks pro Konto.
            </li>
            <li>
              Du kannst die Seite <strong>als App auf den Home-Bildschirm legen</strong> — im
              Browser-Menü «Zum Home-Bildschirm hinzufügen» wählen. Eigenes Icon, keine
              Adressleiste, und die Tipps sind auch ohne Netz lesbar.
            </li>
            <li>
              Du kannst dich <strong>per Mail informieren lassen</strong>, wenn konkrete Tipps
              gesucht werden — oder wenn jemand etwas zu deinen Tipps schreibt.
            </li>
            <li>
              Du kannst <strong>eine Auswahl von Tipps als Liste teilen</strong>, mit einem Link
              auch für Leute ohne Konto.
            </li>
            <li>
              Du kannst <strong>deine eigenen Daten herunterladen</strong> — alle deine Tipps in einer
              ZIP-Datei.
            </li>
          </ul>
          {/* Drei der fünf Punkte wohnen auf derselben Seite. Ohne diesen Weg
              bliebe die Liste eine Ankündigung, der man hinterhersuchen muss —
              und gesucht wird nur, was man schon kennt. */}
          <p className="hinweis__text">
            Einladungen, Mail-Einstellungen und der Download stehen unter{' '}
            <button
              type="button"
              className="linkbutton"
              onClick={() => {
                setOffen(false);
                onKonto();
              }}
            >
              Konto
            </button>
            .
          </p>
        </div>

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
          {/* Hiess «Nein», solange das Feld nur die eine Frage stellte. Jetzt
              steht die Neuigkeitenliste dazwischen, und ein «Nein» am Ende
              beantwortete scheinbar sie. */}
          <button type="button" className="button button--ghost" onClick={() => setOffen(false)}>
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}
