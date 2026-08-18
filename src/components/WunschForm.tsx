import { useEffect, useMemo, useState } from 'react';
import { heuteIso, tageSpaeter } from '../../shared/datum.mjs';
import { ApiError, wunschAendern, wunschAnbringen } from '../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import type { Category, Wunsch } from '../lib/types';
import CountryPick from './CountryPick';

interface Props {
  categories: Category[];
  /** Bekannte Orte aus den Tipps — als Vorschlagsliste, nicht als Zwang. */
  knownPlaces: { label: string; country: string }[];
  onCancel: () => void;
  onDone: () => void;
  /**
   * Gesetzt heisst «bearbeiten statt anbringen». Dann kommen die Werte aus dem
   * bestehenden Wunsch, und der Entwurfs-Speicher bleibt aussen vor: Ein
   * liegengebliebener Entwurf würde beim nächsten Öffnen ältere Angaben über
   * den inzwischen gespeicherten Stand legen.
   */
  bearbeiten?: Wunsch;
}

interface FormValues {
  land: string;
  ort: string;
  bis: string;
  kategorien: string[];
  text: string;
}

const MAX_TEXT = 1000;

/** Weiter voraus plant niemand — und ein Tippfehler im Jahr fiele sonst nicht auf. */
const MAX_TAGE_VORAUS = 730;

/** Kein Vorgabeland, aus demselben Grund wie im Tipp-Formular. */
const LEER: FormValues = { land: '', ort: '', bis: '', kategorien: [], text: '' };

/**
 * Einen Wunsch anbringen.
 *
 * Bewusst schlanker als SubmitForm: kein Foto, keine Karte, kein PlacePicker.
 * Ein Wunsch ist «Lissabon», kein Punkt — und Leaflet nachzuladen, nur um eine
 * Stadt zu benennen, wäre 45 KB für nichts.
 */
export default function WunschForm({
  categories,
  knownPlaces,
  onCancel,
  onDone,
  bearbeiten,
}: Props) {
  const draftName = 'wunsch:neu';
  const [draft, setDraft] = useState(() =>
    bearbeiten
      ? {
          key: '',
          values: {
            land: bearbeiten.land,
            ort: bearbeiten.ort ?? '',
            bis: bearbeiten.bis,
            kategorien: [...bearbeiten.kategorien],
            text: bearbeiten.text ?? '',
          } satisfies FormValues,
        }
      : loadDraft<FormValues>(draftName, LEER),
  );
  const values = draft.values;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Einmal pro Aufbau festhalten: Über Mitternacht hinweg zu tippen ist selten
  // genug, dass ein Neuladen als Antwort reicht — und der Server prüft ohnehin.
  const heute = useMemo(() => heuteIso(), []);

  useEffect(() => {
    if (!bearbeiten) saveDraft(draftName, draft);
  }, [draftName, draft, bearbeiten]);

  // Abbrechen und Zurück verwerfen den Entwurf, ein Neuladen behält ihn.
  useEffect(() => {
    if (bearbeiten) return;
    return () => clearDraft(draftName);
  }, [draftName, bearbeiten]);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft((current) => ({ ...current, values: { ...current.values, [field]: value } }));

  const aktiveKategorien = useMemo(() => categories.filter((c) => c.active), [categories]);

  // Orte, die es im gewählten Land schon gibt. Wer nach Lissabon fährt, wo wir
  // schon zwei Tipps haben, soll den Ort gleich gleich schreiben — sonst fällt
  // der Wunsch nicht mit den Tipps zusammen.
  const ortsVorschlaege = useMemo(() => {
    const gesehen = new Set<string>();
    for (const place of knownPlaces) {
      if (place.country === values.land) gesehen.add(place.label);
    }
    return [...gesehen].sort((a, b) => a.localeCompare(b, 'de'));
  }, [knownPlaces, values.land]);

  function toggleKategorie(id: string) {
    set(
      'kategorien',
      values.kategorien.includes(id)
        ? values.kategorien.filter((entry) => entry !== id)
        : [...values.kategorien, id],
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    // Leer heisst «kein Ort» — der Server macht daraus NULL.
    const felder = {
      land: values.land,
      ort: values.ort || undefined,
      bis: values.bis,
      kategorien: values.kategorien,
      text: values.text || undefined,
    };

    try {
      if (bearbeiten) {
        await wunschAendern(bearbeiten.id, felder);
      } else {
        await wunschAnbringen({ idempotencyKey: draft.key, ...felder });
        clearDraft(draftName);
      }
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={send}>
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onCancel}>
          ← Abbrechen
        </button>
      </div>

      <h1 className="form__title">{bearbeiten ? 'Wunsch bearbeiten' : 'Tipps wünschen'}</h1>
      <p className="form__context">
        {bearbeiten
          ? 'Ändere, was nicht mehr stimmt. Wer den Wunsch angebracht hat und wann, bleibt gleich; schon zugeordnete Tipps bleiben dran.'
          : 'Wohin geht’s? Dein Wunsch steht danach oben auf der Startseite, damit ihn sieht, wer sich dort auskennt.'}
      </p>

      <div className="field-row">
        <CountryPick value={values.land} onChange={(code) => set('land', code)} />

        <label className="field">
          <span>
            Ort <em>optional</em>
          </span>
          <input
            list="wunsch-orte"
            value={values.ort}
            onChange={(event) => set('ort', event.target.value)}
            placeholder="Stadt, Region oder Insel"
            maxLength={80}
          />
          <datalist id="wunsch-orte">
            {ortsVorschlaege.map((ort) => (
              <option key={ort} value={ort} />
            ))}
          </datalist>
        </label>
      </div>

      <small className="field__hint">
        Ohne Ort gilt der Wunsch dem ganzen Land — «irgendwas in Portugal» ist eine
        vollwertige Frage.
      </small>

      <label className="field">
        <span>Bis wann brauchst du die Tipps?</span>
        <input
          required
          type="date"
          value={values.bis}
          min={heute}
          max={tageSpaeter(heute, MAX_TAGE_VORAUS)}
          onChange={(event) => set('bis', event.target.value)}
        />
        <small className="field__hint">
          Zum Beispiel dein Abreisetag — an dem Tag steht der Wunsch noch. Danach verschwindet er
          von selbst, du musst ihn nicht aufräumen.
        </small>
      </label>

      <fieldset className="field">
        <legend>
          Kategorien <em>optional</em>
        </legend>
        <div className="form__chips">
          {aktiveKategorien.map((category) => (
            <button
              key={category.id}
              type="button"
              className="chip"
              style={{ '--chip-color': category.color } as React.CSSProperties}
              aria-pressed={values.kategorien.includes(category.id)}
              onClick={() => toggleKategorie(category.id)}
            >
              <span aria-hidden="true">{category.emoji}</span> {category.label}
            </button>
          ))}
        </div>
        <small className="field__hint">
          Ohne Auswahl gilt der Wunsch für alles — auch gut.
        </small>
      </fieldset>

      <label className="field">
        <span>
          Was suchst du genau? <em>optional</em>
        </span>
        <textarea
          rows={5}
          value={values.text}
          onChange={(event) => set('text', event.target.value)}
          placeholder="Reiseplan, mit wem du unterwegs bist, Vorlieben und Abneigungen."
          maxLength={MAX_TEXT}
        />
        <small className="field__hint">
          {values.text.length} von {MAX_TEXT} Zeichen
        </small>
      </label>

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Einen Moment…' : bearbeiten ? 'Änderungen speichern' : 'Wunsch anbringen'}
        </button>
      </div>

      <p className="form__note">
        Du kannst deinen Wunsch jederzeit ändern, als erfüllt markieren oder löschen. Spätestens
        am gewählten Tag verschwindet er von selbst.
      </p>
    </form>
  );
}
