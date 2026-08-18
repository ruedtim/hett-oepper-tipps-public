import { useEffect, useRef, useState } from 'react';
import { teileListe } from '../lib/api';
import type { TeilenResult } from '../lib/api';
import { formatDay } from '../lib/dates';

/**
 * «Diese Liste teilen» — macht aus dem, was gerade in der Liste steht, einen
 * Link für Leute ohne Passwort.
 *
 * Steht in der Ergebniszeile und nicht im Fuss der Filterleiste: Der rendert nur
 * bei gesetzten Filtern, und dann liesse sich die ungefilterte Sammlung nie
 * teilen. Daneben steht ohnehin schon die Zahl, um die es geht.
 *
 * Kein Modal — den Stil gibt es im Projekt nicht; alles Grössere ist eine eigene
 * Seite, und dafür ist das hier zu klein. Das Ergebnis erscheint als Block
 * darunter, im Idiom von `.admin__done`.
 */
export default function TeilenKnopf({ tippIds }: { tippIds: string[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ergebnis, setErgebnis] = useState<TeilenResult | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const feld = useRef<HTMLInputElement>(null);

  /**
   * Ändert sich die Auswahl, ist der Link von eben nicht mehr der, den man
   * gerade sieht. Ihn stehen zu lassen wäre die eine Lüge, die dieses Feature
   * sich nicht leisten darf — es verspricht «genau diese Resultate».
   */
  const schluessel = tippIds.join(',');
  useEffect(() => {
    setErgebnis(null);
    setError(null);
    setKopiert(false);
  }, [schluessel]);

  async function teilen() {
    setBusy(true);
    setError(null);
    try {
      setErgebnis(await teileListe(tippIds));
      setKopiert(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }

  async function kopieren(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setKopiert(true);
    } catch {
      // Kein Zugriff auf die Zwischenablage (älterer Browser, kein HTTPS):
      // Dann wenigstens markieren, damit ein Handgriff reicht.
      feld.current?.select();
      setKopiert(false);
    }
  }

  if (!ergebnis) {
    return (
      <>
        <button type="button" className="linkbutton" onClick={() => void teilen()} disabled={busy}>
          {busy ? 'Moment…' : 'Diese Liste teilen'}
        </button>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="teilenlink" role="status">
      <p className="teilenlink__titel">Link für Leute ohne Passwort</p>
      <div className="teilenlink__zeile">
        <input
          ref={feld}
          className="teilenlink__url"
          type="text"
          readOnly
          value={ergebnis.url}
          onFocus={(event) => event.target.select()}
          aria-label="Adresse der geteilten Liste"
        />
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void kopieren(ergebnis.url)}
        >
          {kopiert ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <p className="teilenlink__hinweis">
        Zeigt {ergebnis.anzahl === 1 ? 'diesen einen Tipp' : `diese ${ergebnis.anzahl} Tipps`},
        so wie sie jetzt sind, und gilt bis zum {formatDay(ergebnis.bis)}. Namen und Fotos
        gehen nur bei deinen eigenen Beiträgen mit. Zurücknehmen kannst du ihn unter «Konto».
      </p>
    </div>
  );
}
