import { useEffect, useState } from 'react';
import { ApiError, submit } from '../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import type { Tip } from '../lib/types';

interface Props {
  tip: Tip;
  /**
   * Ganz löschen darf nur, wem der Tipp ganz gehört — und jeder Admin. Hier
   * blendet das Flag bloss die halbe Auswahl weg; verboten wird die Löschung in
   * functions/api/submit.ts.
   */
  darfLoeschen: boolean;
  onCancel: () => void;
  onDone: (message: string) => void;
}

type Choice = 'geschlossen' | 'weg';

interface FormValues {
  choice: Choice;
  reason: string;
}

export default function RemoveTip({ tip, darfLoeschen, onCancel, onDone }: Props) {
  const draftName = `weg:${tip.id}`;
  const [draft, setDraft] = useState(() =>
    loadDraft<FormValues>(draftName, { choice: 'geschlossen', reason: '' }),
  );
  const values = draft.values;

  // Nicht im Startwert, sondern bei jedem Rendern: Ein liegen gebliebener
  // Entwurf kann «weg» tragen, obwohl inzwischen jemand anderes am Tipp
  // geschrieben hat und der Weg damit zu ist.
  const choice: Choice = darfLoeschen ? values.choice : 'geschlossen';

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => saveDraft(draftName, draft), [draftName, draft]);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft((current) => ({ ...current, values: { ...current.values, [field]: value } }));

  async function run(event: React.FormEvent) {
    event.preventDefault();

    // Löschen nimmt alle Notizen und Fotos am Tipp mit; bei einem Admin auch
    // fremde. Zurückholen könnte es nur ein Admin über den Verlauf — ein
    // zweiter Klick ist billiger.
    if (choice === 'weg' && !confirming) {
      setConfirming(true);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (choice === 'weg') {
        await submit({
          kind: 'loeschung',
          tipId: tip.id,
          idempotencyKey: draft.key,
          reason: { text: values.reason },
        });
        clearDraft(draftName);
        onDone('Gelöscht — ist sofort überall weg.');
      } else {
        await submit({
          kind: 'korrektur',
          tipId: tip.id,
          idempotencyKey: draft.key,
          tip: {
            name: tip.name,
            country: tip.country,
            place: tip.place,
            categories: tip.categories,
            address: tip.address || undefined,
            link: tip.link || undefined,
            coords: tip.coords ?? undefined,
            closed: true,
          },
        });
        clearDraft(draftName);
        onDone('Als «gibt’s nicht mehr» markiert — sofort für alle sichtbar.');
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <form className="form" onSubmit={run}>
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onCancel}>
          ← Abbrechen
        </button>
      </div>

      <h1 className="form__title">Gibt&rsquo;s nicht mehr?</h1>
      <p className="form__context">{tip.name}, {tip.place}</p>

      {/* Ohne Löschrecht bleibt nur ein Weg — und eine Auswahl mit einer
          einzigen Möglichkeit ist keine. Dann steht hier schlicht, was passiert
          und warum der andere Weg fehlt. */}
      {darfLoeschen ? (
        <div className="choices" role="radiogroup" aria-label="Was soll passieren?">
          <label className={`choice${choice === 'geschlossen' ? ' choice--on' : ''}`}>
            <input
              type="radio"
              name="choice"
              checked={choice === 'geschlossen'}
              onChange={() => { set('choice', 'geschlossen'); setConfirming(false); }}
            />
            <span>
              <strong>Gibt&rsquo;s nicht mehr</strong>
              <small>
                Bleibt in der Liste, ausgegraut. Alle Notizen und Fotos bleiben lesbar — man findet
                den Eintrag später wieder, wenn jemand fragt, wie die Bar nochmal hiess.
              </small>
            </span>
          </label>

          <label className={`choice${choice === 'weg' ? ' choice--on' : ''}`}>
            <input
              type="radio"
              name="choice"
              checked={choice === 'weg'}
              onChange={() => set('choice', 'weg')}
            />
            <span>
              <strong>Ganz löschen</strong>
              <small>
                Verschwindet mit allen Notizen und Fotos, die daran hängen. Für Fehleinträge und
                Dubletten. Zurückholen kann es danach nur ein Admin über den Verlauf.
              </small>
            </span>
          </label>
        </div>
      ) : (
        <>
          <p className="form__context">
            Der Eintrag bleibt in der Liste, ausgegraut. Alle Notizen und Fotos bleiben lesbar —
            man findet ihn später wieder, wenn jemand fragt, wie die Bar nochmal hiess.
          </p>
          <p className="form__context">
            Ganz löschen geht hier nicht: An diesem Tipp hängen auch Beiträge von anderen, und die
            würden mitverschwinden. Soll er wirklich weg, macht das ein Admin.
          </p>
        </>
      )}

      {choice === 'weg' && (
        <label className="field">
          <span>Warum weg?</span>
          <textarea
            required
            rows={3}
            value={values.reason}
            onChange={(event) => set('reason', event.target.value)}
            placeholder="Doppelt erfasst, falscher Ort, gehört hier nicht hin…"
            maxLength={1000}
          />
          <small className="field__hint">Steht später im Verlauf.</small>
        </label>
      )}

      {error && <p className="form__error" role="alert">{error}</p>}

      {confirming && (
        <p className="form__error" role="alert">
          Sicher? «{tip.name}» verschwindet mit {tip.notes.length}{' '}
          {tip.notes.length === 1 ? 'Notiz' : 'Notizen'}. Nochmal drücken zum Bestätigen.
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button" disabled={busy}>
          {busy
            ? 'Einen Moment…'
            : choice === 'weg'
              ? confirming
                ? 'Ja, löschen'
                : 'Löschen'
              : 'Als geschlossen markieren'}
        </button>
      </div>
    </form>
  );
}
