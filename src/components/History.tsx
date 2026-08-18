import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchChangedFiles, fetchHistory, revert } from '../lib/admin';
import type { HistoryEntry, HistoryFilter, VerlaufArt } from '../lib/admin';

interface Props {
  onClose: () => void;
  onEditCategories: () => void;
  onManageUsers: () => void;
  /** Nach einem Rückgängig sollen Liste und Karte sofort den neuen Stand zeigen. */
  onChanged: () => void;
}

export default function History({ onClose, onEditCategories, onManageUsers, onChanged }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [art, setArt] = useState<HistoryFilter>('alle');
  const [hasMore, setHasMore] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busySha, setBusySha] = useState<string | null>(null);
  const [reverted, setReverted] = useState<Set<string>>(new Set());

  const load = useCallback(async (which: number, welche: HistoryFilter) => {
    setError(null);
    try {
      const result = await fetchHistory(which, welche);
      setEntries(result.entries);
      setHasMore(result.hasMore);
      setPage(result.page);
      // Die Filterart kommt aus der Antwort, nicht aus dem Klick: Nur so steht
      // in der Überschrift, was tatsächlich geladen wurde.
      setArt(result.art);
      setDenied(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        // Admin ist seit den Konten ein Flag, kein zweites Passwort — hier
        // lässt sich also nichts mehr «nachanmelden».
        setDenied(true);
        setEntries(null);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : 'Der Verlauf liess sich nicht laden.');
    }
  }, []);

  useEffect(() => void load(1, 'alle'), [load]);

  /** Ein Filterwechsel fängt wieder auf Seite 1 an — Seite 3 der Löschungen ist eine andere Seite 3. */
  function filtern(welche: HistoryFilter) {
    if (welche === art) return;
    setEntries(null);
    setDone(null);
    void load(1, welche);
  }

  async function undo(entry: HistoryEntry) {
    setBusySha(entry.sha);
    setError(null);
    setDone(null);
    try {
      const result = await revert(entry.sha);
      setReverted((current) => new Set(current).add(entry.sha));
      setDone(
        `Zurückgenommen (${result.touched} ${result.touched === 1 ? 'Datei' : 'Dateien'}) — sofort überall sichtbar.`,
      );
      await load(page, art);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBusySha(null);
    }
  }

  if (denied) {
    return (
      <div className="admin">
        <div className="detail__bar">
          <button type="button" className="linkbutton" onClick={onClose}>
            ← Zurück
          </button>
        </div>
        <h1 className="form__title">Verlauf</h1>
        <p className="form__context">
          Dafür braucht es Admin-Rechte. Dein Konto hat sie nicht — die Admins können sie unter
          «Konten» vergeben.
        </p>
      </div>
    );
  }

  return (
    <div className="admin">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zurück
        </button>
      </div>

      <h1 className="form__title">Verlauf</h1>
      <p className="form__context">
        {art === 'loeschungen'
          ? 'Nur Handlungen, nach denen etwas weg war — Löschungen und Rücknahmen, die einen Tipp entfernt haben. Neueste zuerst.'
          : 'Jede Änderung an den Tipps, neueste zuerst. Zurücknehmen löscht nichts — es schreibt eine Gegenbuchung, die sich ihrerseits zurücknehmen lässt.'}
      </p>

      {/* Der Filter, damit eine Löschung in der Flut der Ergänzungen nicht
          untergeht: Was verschwunden ist, soll man ohne Blättern sehen. */}
      <div className="viewswitch" role="group" aria-label="Verlauf filtern">
        <button type="button" aria-pressed={art === 'alle'} onClick={() => filtern('alle')}>
          Alles
        </button>
        <button
          type="button"
          aria-pressed={art === 'loeschungen'}
          onClick={() => filtern('loeschungen')}
        >
          Nur Löschungen
        </button>
      </div>

      {done && <p className="admin__done" role="status">{done}</p>}
      {error && <p className="form__error" role="alert">{error}</p>}

      {entries === null && !error && <p className="status">Lädt…</p>}

      {/* Verlaufszeilen kommen nur dazu, nie weg — leer heisst hier also immer
          «gab es noch nie», nicht «auf dieser Seite gerade nicht». */}
      {entries?.length === 0 && (
        <p className="status">
          {art === 'loeschungen' ? 'Es wurde noch nichts gelöscht.' : 'Noch keine Einträge.'}
        </p>
      )}

      {entries?.map((entry) => (
        <HistoryRow
          key={entry.sha}
          entry={entry}
          busy={busySha === entry.sha}
          done={reverted.has(entry.sha)}
          onUndo={() => void undo(entry)}
        />
      ))}

      {entries && (
        <div className="history__pager">
          <button
            type="button"
            className="linkbutton"
            disabled={page <= 1}
            onClick={() => void load(page - 1, art)}
          >
            ← Neuere
          </button>
          <span className="history__page">Seite {page}</span>
          <button
            type="button"
            className="linkbutton"
            disabled={!hasMore}
            onClick={() => void load(page + 1, art)}
          >
            Ältere →
          </button>
        </div>
      )}

      <footer className="sitefoot">
        <button type="button" className="linkbutton" onClick={onEditCategories}>
          Kategorien bearbeiten
        </button>
        <button type="button" className="linkbutton" onClick={onManageUsers}>
          Konten verwalten
        </button>
      </footer>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  added: 'neu',
  modified: 'geändert',
  removed: 'gelöscht',
  renamed: 'umbenannt',
};

/** Die Art der Handlung als Etikett — «Gelöscht» soll man von weitem sehen. */
const KIND_LABEL: Record<VerlaufArt, string> = {
  tipp: 'Neuer Tipp',
  ergaenzung: 'Ergänzung',
  korrektur: 'Korrektur',
  loeschung: 'Gelöscht',
  kategorien: 'Kategorien',
  rueckgaengig: 'Rückgängig',
};

function HistoryRow({
  entry,
  busy,
  done,
  onUndo,
}: {
  entry: HistoryEntry;
  busy: boolean;
  done: boolean;
  onUndo: () => void;
}) {
  const [files, setFiles] = useState<{ path: string; status: string }[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function showFiles() {
    setLoading(true);
    try {
      const result = await fetchChangedFiles(entry.sha);
      setFiles(result.files);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className={`pending${done ? ' pending--done' : ''}`}>
      <header className="pending__head">
        <span className={`pending__kind pending__kind--${entry.kind}`}>
          {KIND_LABEL[entry.kind] ?? entry.kind}
        </span>
        <span className="pending__link">
          {formatDate(entry.date)} · <code>#{entry.sha}</code>
        </span>
      </header>

      <h2 className="pending__title">{entry.title}</h2>
      {entry.note && <p className="pending__meta">{entry.note}</p>}
      <p className="pending__meta">{entry.by ? `Von ${entry.by}` : 'Nicht aus der App'}</p>

      {files ? (
        <ul className="history__files">
          {files.length === 0 && <li>Keine Dateien.</li>}
          {files.map((file) => (
            <li key={file.path}>
              <span className="history__status">{STATUS_LABEL[file.status] ?? file.status}</span>{' '}
              {file.path}
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" className="linkbutton" onClick={() => void showFiles()} disabled={loading}>
          {loading ? 'Lädt…' : 'Was wurde geändert?'}
        </button>
      )}

      <footer className="pending__actions">
        <button type="button" className="button button--ghost" onClick={onUndo} disabled={busy || done}>
          {busy ? 'Moment…' : done ? 'Zurückgenommen' : 'Rückgängig machen'}
        </button>
      </footer>
    </article>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
