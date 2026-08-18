import { useEffect, useMemo, useRef, useState } from 'react';
import { allCountries, COUNTRY_ALIASES, countryFromText, countryName } from '../lib/countries';

interface Props {
  /** ISO-Code — leer, solange im Feld nichts Auflösbares steht. */
  value: string;
  onChange: (code: string) => void;
}

/**
 * Das Land eintippen statt scrollen (#30).
 *
 * Ein `<select>` mit 250 Einträgen ist auf dem Handy ein Rad, an dem man dreht,
 * bis der Daumen glüht — tippen kann man dort nicht. Ein `<input list>` kann
 * beides: aufklappen und blättern wie bisher, oder «ital» tippen. Dieselbe
 * Bauart wie das Ortsfeld gleich daneben, das seit immer eine Vorschlagsliste
 * hat.
 *
 * Nach draussen geht weiterhin nur der ISO-Code: Im Feld steht «Italien», im
 * Formular «IT». Passt das Getippte zu keinem Land, ist der Code leer, und die
 * eingebaute Formularprüfung des Browsers hält das Absenden auf — lieber eine
 * Meldung als ein Tipp, der still im falschen Land landet.
 */
export default function CountryPick({ value, onChange }: Props) {
  const laender = useMemo(() => allCountries(), []);
  const [text, setText] = useState(() => (value ? countryName(value) : ''));

  /**
   * Von aussen gesetzt wird das Land auch: Die Rückwärtssuche im Tipp-Formular
   * holt es aus dem Punkt auf der Karte. Dann muss der Text folgen — aber nur
   * dann. Beim Tippen ist der Text die Quelle, und ihn dort zu überschreiben
   * risse den Cursor mitten im Wort ans Ende.
   */
  const [zuletzt, setZuletzt] = useState(value);
  if (value !== zuletzt) {
    setZuletzt(value);
    if (countryFromText(text) !== value) setText(value ? countryName(value) : '');
  }

  /**
   * Ohne gültigen Code ist das Feld ungültig. Die Meldung kommt damit vom
   * Browser und an derselben Stelle wie bei einem leeren Pflichtfeld — ein
   * eigener roter Satz unter dem Feld erschiene schon beim dritten Buchstaben,
   * wo noch gar nichts falsch ist.
   */
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    feld.current?.setCustomValidity(
      value ? '' : 'Bitte ein Land wählen — zum Beispiel «Italien» oder «IT».',
    );
  }, [value]);

  return (
    <label className="field">
      <span>Land</span>
      <input
        ref={feld}
        list="laender"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(countryFromText(event.target.value));
        }}
        // Beim Verlassen den amtlichen Namen hinschreiben. Das ist die
        // Bestätigung, dass das Getippte verstanden wurde — und es sagt, was
        // die App unter «USA» oder «England» versteht, bevor der Tipp mit
        // «US» respektive «GB» gespeichert ist.
        onBlur={() => value && setText(countryName(value))}
        placeholder="Land eintippen oder wählen"
        // Sonst legt der Browser seine eigene Autofill-Liste über die Vorschläge.
        autoComplete="off"
        maxLength={60}
      />
      {/* Die Optionen tragen NUR einen value, keinen Kindtext. Kindtext ist in
          einem datalist das Label, und Firefox zeigt dann das Label statt des
          Werts und filtert auch dagegen: Mit dem Flaggen-Emoji als Label fand
          «De» Deutschland nicht mehr (Label «🇩🇪»), dafür «Niederlande» (Treffer
          im Alias-Label), und die Aliasse standen doppelt da, weil zwei Werte
          dasselbe Label trugen. Die Flaggen im Aufklappmenü sind den Verlust
          nicht wert — im Feld selbst stand ohnehin nie eine. */}
      <datalist id="laender">
        {laender.map((land) => (
          <option key={land.code} value={land.name} />
        ))}
        {COUNTRY_ALIASES.map((alias) => (
          <option key={alias.text} value={alias.text} />
        ))}
      </datalist>
    </label>
  );
}
