import { useEffect, useState } from 'react';
import { ApiError, sendFeedback } from '../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';

interface Props {
  /** Wo der Nutzer war, als er auf «Rückmeldung» gedrückt hat. */
  from: string;
  onCancel: () => void;
}

interface FormValues {
  text: string;
}

export default function Feedback({ from, onCancel }: Props) {
  const [draft, setDraft] = useState(() => loadDraft<FormValues>('feedback', { text: '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => saveDraft('feedback', draft), [draft]);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft((current) => ({ ...current, values: { ...current.values, [field]: value } }));

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({ text: draft.values.text, from });
      clearDraft('feedback');
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="thanks">
        <p className="thanks__mark" aria-hidden="true">✓</p>
        <h1>Angekommen</h1>
        <p>Deine Rückmeldung ist bei den Admins. Danke fürs Melden.</p>
        <button type="button" className="button" onClick={onCancel}>
          Zurück zu den Tipps
        </button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={send}>
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onCancel}>
          ← Abbrechen
        </button>
      </div>

      <h1 className="form__title">Rückmeldung</h1>
      <p className="form__context">
        Etwas kaputt, unklar oder fehlt? Schreib es hier auf — es landet direkt bei den Admins.
        Für neue Tipps gibt&rsquo;s den Knopf unten auf der Liste.
      </p>

      <label className="field">
        <span>Worum geht&rsquo;s?</span>
        <textarea
          required
          autoFocus
          rows={7}
          value={draft.values.text}
          onChange={(event) => set('text', event.target.value)}
          placeholder="Was ist passiert, was hast du erwartet?"
          maxLength={4000}
        />
        <small className="field__hint">{draft.values.text.length} von 4000 Zeichen</small>
      </label>

      {error && <p className="form__error" role="alert">{error}</p>}

      <div className="form__actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Wird gesendet…' : 'Abschicken'}
        </button>
      </div>
    </form>
  );
}
