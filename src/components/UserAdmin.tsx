import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { createUser, fetchGast, listUsers, updateGast, updateUser } from '../lib/admin';
import type { AdminUser, GastZugang } from '../lib/admin';
import { formatDay } from '../lib/dates';

interface Props {
  onClose: () => void;
}

/**
 * Kontenverwaltung für Admins: anlegen, Admin-Flag, deaktivieren, Passwort
 * zurücksetzen. Startpasswörter vergibt der Admin und gibt sie persönlich
 * weiter; beim ersten Anmelden verlangt die App dann ein eigenes.
 *
 * Löschen gibt es absichtlich nicht — Namen stehen in Notizen und im Verlauf.
 *
 * Am Ende steht der Gäste-Zugang. Er liegt in derselben Tabelle, ist aber kein
 * Konto einer Person: ein Passwort, das herumgegeben wird, und nur Lesen.
 * Deshalb ein eigener Abschnitt statt einer Zeile in der Liste oben.
 */
export default function UserAdmin({ onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [startPassword, setStartPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');

  const [gast, setGast] = useState<GastZugang | null>(null);
  const [gastPassword, setGastPassword] = useState('');
  const [gastBusy, setGastBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await listUsers();
      setUsers(result.users);
      setDenied(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setDenied(true);
        setUsers(null);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : 'Die Konten liessen sich nicht laden.');
      return;
    }

    // Getrennt und mit eigenem Auffangnetz: Solange die Migration 0005 remote
    // noch nicht angewandt ist, antwortet dieser Endpunkt mit einem Fehler —
    // und dann wäre es besonders schlecht, wenn deswegen die Kontenverwaltung
    // ausfiele. Ohne Antwort fehlt bloss der Abschnitt «Nur schauen».
    try {
      setGast(await fetchGast());
    } catch {
      setGast(null);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createUser({ name: name.trim(), startPassword, isAdmin: newIsAdmin });
      setNotice(
        `Konto «${name.trim()}» angelegt — Startpasswort persönlich weitergeben; beim ersten ` +
          'Anmelden wird ein eigenes verlangt.',
      );
      setName('');
      setStartPassword('');
      setNewIsAdmin(false);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setCreating(false);
    }
  }

  async function patch(
    user: AdminUser,
    change: Parameters<typeof updateUser>[1],
    doneText: string,
  ): Promise<boolean> {
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      await updateUser(user.id, change);
      setNotice(doneText);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function submitReset(user: AdminUser, event: React.FormEvent) {
    event.preventDefault();
    const ok = await patch(
      user,
      { newStartPassword: resetPassword },
      `Startpasswort für «${user.name}» gesetzt — weitergeben. Alle Sitzungen des Kontos sind beendet.`,
    );
    // Bei einem Fehler bleibt das Formular samt Eingabe stehen — zuklappen
    // sähe nach Erfolg aus, obwohl nichts gesetzt wurde.
    if (!ok) return;
    setResetId(null);
    setResetPassword('');
  }

  async function submitRename(user: AdminUser, event: React.FormEvent) {
    event.preventDefault();
    const ok = await patch(
      user,
      { neuerName: renameName.trim() },
      `«${user.name}» heisst jetzt «${renameName.trim()}» — auch bei allen bisherigen Beiträgen.`,
    );
    if (!ok) return;
    setRenameId(null);
    setRenameName('');
  }

  async function gastLauf(patch: Parameters<typeof updateGast>[0], doneText: string) {
    setGastBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateGast(patch);
      setNotice(doneText);
      setGastPassword('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setGastBusy(false);
    }
  }

  function setzeGastPasswort(event: React.FormEvent) {
    event.preventDefault();
    void gastLauf(
      { neuesPasswort: gastPassword },
      'Gäste-Passwort gesetzt — der Zugang ist offen. Alle Gäste müssen sich neu anmelden.',
    );
  }

  // `password_changed_at` ist ein voller Zeitstempel, formatDay() erwartet eine
  // reine Tagesangabe — und der Tag ist hier alles, was interessiert.
  const gastTag = gast?.passwortGesetztAm ? formatDay(gast.passwortGesetztAm.slice(0, 10)) : null;

  if (denied) {
    return (
      <div className="admin">
        <div className="detail__bar">
          <button type="button" className="linkbutton" onClick={onClose}>
            ← Zurück
          </button>
        </div>
        <h1 className="form__title">Konten</h1>
        <p className="form__context">Dafür braucht es Admin-Rechte.</p>
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

      <h1 className="form__title">Konten</h1>
      <p className="form__context">
        Jede Person hat ihr eigenes Konto; der Name steht bei allem, was sie tut, im Verlauf.
        Konten werden deaktiviert statt gelöscht — die Namen stecken in alten Notizen.
      </p>

      {notice && <p className="admin__done" role="status">{notice}</p>}
      {error && <p className="form__error" role="alert">{error}</p>}

      {users === null && !error && <p className="status">Lädt…</p>}

      {users?.map((user) => (
        <article key={user.id} className={`pending${user.disabled ? ' pending--done' : ''}`}>
          <h2 className="pending__title">
            {user.name}
            {user.isAdmin && ' · Admin'}
            {user.disabled && ' · deaktiviert'}
          </h2>
          {/* Wer umbenannt wurde, hiess mal anders — und genau das steht sonst
              nirgends mehr: Die App löst alle Beiträge auf den aktuellen Namen
              auf, im Verlauf müsste man es zusammensuchen. */}
          {user.alteNamen.length > 0 && (
            <p className="pending__meta">Früher: {user.alteNamen.join(', ')}</p>
          )}
          {user.email && (
            <p className="pending__meta">
              E-Mail: {user.email}
              {!user.emailVerifiziert && ' (unbestätigt)'}
            </p>
          )}
          {/* Analog zu «Früher»: Wer die Person hereingeholt hat, steht sonst
              nirgends — die Einladungszeile bleibt genau dafür stehen. */}
          {user.eingeladenVon && (
            <p className="pending__meta">Eingeladen von {user.eingeladenVon}.</p>
          )}
          <p className="pending__meta">
            Einladungen: {user.einladungen.verbleibend} von {user.einladungen.budget} übrig
            {user.einladungen.bestelltAm && (
              <>
                {' '}
                · <strong>hat mehr Einladungen bestellt</strong>
              </>
            )}
          </p>
          {user.mustChangePassword && !user.disabled && (
            <p className="pending__meta">Startpasswort noch nicht gewechselt.</p>
          )}

          {resetId === user.id ? (
            <form className="form" onSubmit={(event) => void submitReset(user, event)}>
              <label className="field">
                <span>Neues Startpasswort <em>mind. 8 Zeichen</em></span>
                <input
                  autoFocus
                  required
                  minLength={8}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                />
              </label>
              <div className="form__actions">
                <button type="submit" className="button" disabled={busyId === user.id}>
                  Setzen
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setResetId(null);
                    setResetPassword('');
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : renameId === user.id ? (
            <form className="form" onSubmit={(event) => void submitRename(user, event)}>
              <label className="field">
                <span>Neuer Name</span>
                <input
                  autoFocus
                  required
                  maxLength={40}
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                />
              </label>
              <p className="form__context">
                Bisherige Beiträge zeigen danach den neuen Namen. Im Verlauf bleibt der alte stehen
                — der sagt, wer damals gehandelt hat.
              </p>
              <div className="form__actions">
                <button type="submit" className="button" disabled={busyId === user.id}>
                  Umbenennen
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setRenameId(null);
                    setRenameName('');
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <footer className="pending__actions">
              <button
                type="button"
                className="linkbutton"
                disabled={busyId === user.id}
                onClick={() =>
                  void patch(
                    user,
                    { isAdmin: !user.isAdmin },
                    user.isAdmin
                      ? `«${user.name}» ist kein Admin mehr.`
                      : `«${user.name}» ist jetzt Admin.`,
                  )
                }
              >
                {user.isAdmin ? 'Admin entziehen' : 'Zum Admin machen'}
              </button>
              <button
                type="button"
                className="linkbutton"
                disabled={busyId === user.id}
                onClick={() =>
                  void patch(
                    user,
                    { disabled: !user.disabled },
                    user.disabled
                      ? `«${user.name}» ist wieder aktiv.`
                      : `«${user.name}» ist deaktiviert — auch laufende Sitzungen sind beendet.`,
                  )
                }
              >
                {user.disabled ? 'Reaktivieren' : 'Deaktivieren'}
              </button>
              <button
                type="button"
                className="linkbutton"
                disabled={busyId === user.id}
                onClick={() => {
                  setResetId(user.id);
                  setResetPassword('');
                }}
              >
                Passwort zurücksetzen
              </button>
              <button
                type="button"
                className="linkbutton"
                disabled={busyId === user.id}
                onClick={() => {
                  setRenameId(user.id);
                  setRenameName(user.name);
                }}
              >
                Umbenennen
              </button>
              <button
                type="button"
                className="linkbutton"
                disabled={busyId === user.id}
                onClick={() =>
                  void patch(
                    user,
                    { mehrEinladungen: true },
                    `«${user.name}» hat 3 Einladungen dazubekommen.`,
                  )
                }
              >
                +3 Einladungen
              </button>
            </footer>
          )}
        </article>
      ))}

      <h2 className="form__title">Neues Konto</h2>
      <form className="form" onSubmit={create}>
        <label className="field">
          <span>Name</span>
          <input
            required
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Wie die Person in den Notizen heissen soll"
          />
        </label>
        <label className="field">
          <span>Startpasswort <em>mind. 8 Zeichen</em></span>
          <input
            required
            minLength={8}
            value={startPassword}
            onChange={(event) => setStartPassword(event.target.value)}
          />
        </label>
        <label className="toggle toggle--block">
          <input
            type="checkbox"
            checked={newIsAdmin}
            onChange={(event) => setNewIsAdmin(event.target.checked)}
          />
          Mit Admin-Rechten
        </label>
        <div className="form__actions">
          <button type="submit" className="button" disabled={creating}>
            {creating ? 'Moment…' : 'Konto anlegen'}
          </button>
        </div>
      </form>

      <h2 className="form__title">Nur schauen</h2>
      <p className="form__context">
        Ein Passwort ohne Namen, für alle, die bloss mitlesen sollen. Gäste sehen die Tipps mit
        Ort, Kategorie und Text — aber keine Wünsche, keine Namen und keine Fotos. Eintragen,
        Ändern und Rückmelden sind zu. Ein neues Passwort beendet sofort alle laufenden
        Gäste-Sitzungen.
      </p>

      {gast && (
        <>
          <p className="pending__meta">
            {gastTag === null
              ? 'Noch kein Gäste-Passwort gesetzt — der Zugang ist zu.'
              : gast.aktiv
                ? `Offen. Passwort gesetzt am ${gastTag}.`
                : `Zu. Das letzte Passwort wurde am ${gastTag} gesetzt.`}
          </p>

          <form className="form" onSubmit={setzeGastPasswort}>
            <label className="field">
              <span>
                {gast.passwortGesetztAm === null ? 'Gäste-Passwort' : 'Neues Gäste-Passwort'}{' '}
                <em>mind. 8 Zeichen</em>
              </span>
              <input
                required
                minLength={8}
                value={gastPassword}
                onChange={(event) => setGastPassword(event.target.value)}
                placeholder="Wird herumgegeben, nicht gewechselt"
              />
            </label>
            <div className="form__actions">
              <button type="submit" className="button" disabled={gastBusy}>
                {gastBusy ? 'Moment…' : 'Passwort setzen'}
              </button>
              {/* Zumachen geht nur, wenn es etwas zuzumachen gibt. Aufmachen
                  ohne gesetztes Passwort weist der Server ohnehin ab. */}
              {gast.passwortGesetztAm !== null && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={gastBusy}
                  onClick={() =>
                    void gastLauf(
                      { aktiv: !gast.aktiv },
                      gast.aktiv
                        ? 'Der Gäste-Zugang ist zu — laufende Gäste-Sitzungen sind beendet.'
                        : 'Der Gäste-Zugang ist wieder offen.',
                    )
                  }
                >
                  {gast.aktiv ? 'Zugang schliessen' : 'Zugang öffnen'}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
