import { useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { saveCategories } from '../lib/admin';
import type { Category } from '../lib/types';

interface Props {
  categories: Category[];
  onClose: () => void;
  /** Nach dem Speichern soll die App die frischen Kategorien sofort laden. */
  onChanged: () => void;
}

const NEW_COLORS = ['#7a5c9e', '#2f8f8f', '#b06a30', '#5a7d3a', '#a8425c', '#3f6f9e'];

/**
 * Eine Zeile im Editor: die Kategorie und ein Schlüssel, der ihr gehört.
 *
 * Der Schlüssel ist nicht die ID — die ist bei einer frisch angelegten Zeile
 * leer und wächst beim Tippen, was React die Zeile bei jedem Buchstaben neu
 * aufbauen liesse. Er ist auch nicht die Position: Genau die ändert sich beim
 * Sortieren, und dann setzt React nicht die Zeile um, sondern schreibt die
 * Werte um. Der Fokus bliebe damit an der Position hängen statt an der
 * Kategorie, und der zweite Druck auf «nach oben» verschöbe die Nachbarin.
 */
interface Zeile {
  schluessel: number;
  wert: Category;
}

export default function CategoryEditor({ categories, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<Zeile[]>(() =>
    categories.map((c, index) => ({ schluessel: index, wert: { ...c } })),
  );
  const naechsterSchluessel = useRef(categories.length);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (index: number, patch: Partial<Category>) =>
    setRows((current) =>
      current.map((zeile, i) =>
        i === index ? { ...zeile, wert: { ...zeile.wert, ...patch } } : zeile,
      ),
    );

  /**
   * Eine Kategorie eine Zeile höher oder tiefer (#34).
   *
   * Die Reihenfolge hier IST die Reihenfolge überall: Der Server schreibt sie
   * beim Speichern als `position` fort, und `getCategories` liest danach.
   * Deshalb genügt es, das Feld umzustellen — es braucht kein eigenes Feld und
   * keinen eigenen Endpunkt.
   */
  const verschiebe = (index: number, richtung: -1 | 1) =>
    setRows((current) => {
      const ziel = index + richtung;
      const zeile = current[index];
      const andere = current[ziel];
      if (!zeile || !andere) return current;
      const next = [...current];
      next[index] = andere;
      next[ziel] = zeile;
      return next;
    });

  const addRow = () => {
    naechsterSchluessel.current += 1;
    setRows((current) => [
      ...current,
      {
        schluessel: naechsterSchluessel.current,
        wert: {
          id: '',
          label: '',
          emoji: '✨',
          color: NEW_COLORS[current.length % NEW_COLORS.length] ?? '#7a5c9e',
          active: true,
        },
      },
    ]);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveCategories(rows.map((zeile) => zeile.wert));
      setSaved(true);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }

  // IDs bestehender Kategorien sind unveränderlich — eine Umbenennung würde
  // jeden Tipp verwaisen lassen, der die alte ID noch nennt.
  const existingIds = new Set(categories.map((c) => c.id));

  return (
    <div className="admin">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zurück
        </button>
      </div>

      <h1 className="form__title">Kategorien</h1>
      <p className="form__context">
        Die Reihenfolge hier ist die Reihenfolge überall — in der Filterleiste wie im Formular.
        Umbenennen ist gefahrlos. Löschen geht nicht — wer eine Kategorie loswerden will,
        deaktiviert sie: Sie verschwindet aus Filter und Formular, bleibt aber auf bestehenden
        Tipps stehen.
      </p>

      {rows.map(({ schluessel, wert: row }, index) => (
        <div className="catrow" key={schluessel}>
          {/* Die Pfeile stehen neben der ganzen Zeile, nicht in einer ihrer
              beiden Reihen: Sie bewegen die Kategorie als Ganzes. */}
          <div className="catrow__sort">
            <button
              type="button"
              onClick={() => verschiebe(index, -1)}
              disabled={index === 0}
              aria-label={`${row.label || 'Kategorie'} nach oben`}
              title="Nach oben"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => verschiebe(index, 1)}
              disabled={index === rows.length - 1}
              aria-label={`${row.label || 'Kategorie'} nach unten`}
              title="Nach unten"
            >
              ↓
            </button>
          </div>
          <input
            className="catrow__emoji"
            value={row.emoji}
            onChange={(event) => update(index, { emoji: event.target.value })}
            aria-label="Emoji"
            maxLength={8}
          />
          <input
            className="catrow__label"
            value={row.label}
            onChange={(event) => update(index, { label: event.target.value })}
            placeholder="Anzeigename"
            aria-label="Anzeigename"
            maxLength={30}
          />
          <input
            className="catrow__color"
            type="color"
            value={row.color}
            onChange={(event) => update(index, { color: event.target.value })}
            aria-label="Farbe"
          />
          <input
            className="catrow__id"
            value={row.id}
            onChange={(event) => update(index, { id: event.target.value })}
            placeholder="kurz-id"
            aria-label="Interne ID"
            disabled={existingIds.has(row.id)}
            maxLength={30}
          />
          <label className="catrow__active">
            <input
              type="checkbox"
              checked={row.active}
              onChange={(event) => update(index, { active: event.target.checked })}
            />
            aktiv
          </label>
        </div>
      ))}

      <button type="button" className="linkbutton" onClick={addRow}>
        + Kategorie hinzufügen
      </button>

      {error && <p className="form__error" role="alert">{error}</p>}
      {saved && (
        <p className="admin__done" role="status">
          Gespeichert — sofort überall sichtbar.
        </p>
      )}

      <div className="form__actions">
        <button type="button" className="button" onClick={() => void save()} disabled={busy}>
          {busy ? 'Wird gespeichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}
