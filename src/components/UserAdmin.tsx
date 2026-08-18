import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  createUser,
  ladeZugangEin,
  listeZugangsbitten,
  listUsers,
  nimmZugangZurueck,
  updateUser,
  verwirfZugang,
} from '../lib/admin';
import type { AdminUser, Zugangsbitte } from '../lib/admin';
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
 * Hier stand bis #70 auch der Gäste-Zugang («nur schauen»). Er ist zu, der
 * Abschnitt ist weg; die Begründung steht in migrations/0012_gast_zu.sql.
 *
 * An seiner Stelle stehen seit #71 die Zugangsbitten: was jemand auf dem
 * Anmeldebildschirm eingetippt hat, und der Knopf, der ihm einen
 * Einladungslink schickt. Das ist der einzige Ort, an dem so ein Link
 * entsteht — von allein kommt niemand herein.
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

  const [bitten, setBitten] = useState<Zugangsbitte[]>([]);
  const [bittenBusy, setBittenBusy] = useState<number | null>(null);
  /**
   * Getrennt von `bitten.length === 0`, weil beides sonst gleich aussähe: «es
   * bittet gerade niemand» ist eine Aussage über die Runde, «ich konnte nicht
   * nachsehen» eine über die App. Dieselbe Regel wie bei der Wunschseite für
   * Gäste — ein leerer Zustand darf nichts behaupten, was der Server bloss
   * nicht geliefert hat.
   */
  const [bittenFehler, setBittenFehler] = useState(false);

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

    // Getrennt und mit eigenem Auffangnetz — wie früher beim Gäste-Abschnitt:
    // Solange die Migration 0013 remote nicht angewandt ist, antwortet dieser
    // Endpunkt mit einem Fehler, und dann wäre es besonders schlecht, wenn
    // deswegen die ganze Kontenverwaltung ausfiele. Ohne Antwort fehlt bloss
    // der Abschnitt «Zugangsbitten».
    try {
      setBitten((await listeZugangsbitten()).bitten);
      setBittenFehler(false);
    } catch {
      setBitten([]);
      setBittenFehler(true);
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

  /**
   * Ein Handgriff an einer Zugangsbitte. Wie `patch()` daneben, nur mit der
   * Bitte statt dem Konto als Sperre — und mit einer Meldung, die der Aufrufer
   * erst aus dem Ergebnis baut: Beim Einladen hängt sie daran, ob die Mail
   * wirklich rausging.
   */
  async function bittenLauf<T>(
    bitte: Zugangsbitte,
    was: () => Promise<T>,
    doneText: (ergebnis: T) => string,
  ) {
    setBittenBusy(bitte.id);
    setError(null);
    setNotice(null);
    try {
      setNotice(doneText(await was()));
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBittenBusy(null);
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

      <h2 className="form__title">Zugangsbitten</h2>
      <p className="form__context">
        Wer auf dem Anmeldebildschirm um Zugang gebeten hat. «Einladung schicken» erzeugt
        einen einmaligen Link und schickt ihn an die angegebene Adresse — die Person legt
        sich damit ihr Konto selbst an, mit eigenem Passwort. Diese Einladungen gehen nicht
        von deinen drei ab.
      </p>

      {bittenFehler ? (
        <p className="pending__meta">
          Die Zugangsbitten liessen sich gerade nicht laden.
        </p>
      ) : bitten.length === 0 ? (
        <p className="pending__meta">Gerade bittet niemand um Zugang.</p>
      ) : (
        bitten.map((bitte) => (
          <article key={bitte.id} className="pending">
            <h3 className="pending__title">
              {bitte.vorname} {bitte.nachname}
            </h3>
            <p className="pending__meta">
              {bitte.email} · gefragt am {formatDay(bitte.erstellt)}
            </p>
            {/* Name und Adresse kommen von jemandem ohne Konto — das muss
                dabeistehen, sonst liest sich die Zeile wie eine Auskunft der App. */}
            <p className="pending__meta">
              Ungeprüfte Angaben einer fremden Person.
            </p>

            {bitte.einladung ? (
              <>
                <p className="pending__meta">
                  Einladung geschickt
                  {bitte.einladung.von && ` von ${bitte.einladung.von}`} am{' '}
                  {formatDay(bitte.einladung.geschicktAm)} ·{' '}
                  {bitte.einladung.status === 'offen'
                    ? `noch nicht eingelöst, gilt bis ${formatDay(bitte.einladung.bis)}`
                    : bitte.einladung.status === 'eingeloest'
                      ? 'eingelöst'
                      : bitte.einladung.status === 'widerrufen'
                        ? 'zurückgezogen'
                        : 'abgelaufen'}
                </p>
                {/* Zum Weitergeben von Hand, falls die Mail nicht ankam. Nur
                    solange der Link überhaupt noch etwas tut. */}
                {bitte.einladung.status === 'offen' && (
                  <input
                    className="teilenlink__url"
                    readOnly
                    value={bitte.einladung.url}
                    onFocus={(event) => event.target.select()}
                    aria-label={`Einladungslink für ${bitte.vorname} ${bitte.nachname}`}
                  />
                )}
                <footer className="pending__actions">
                  {bitte.einladung.status === 'offen' && (
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={bittenBusy === bitte.id}
                      onClick={() =>
                        void bittenLauf(
                          bitte,
                          () => nimmZugangZurueck(bitte.id),
                          () =>
                            `Die Einladung an ${bitte.vorname} ${bitte.nachname} ist zurückgezogen — ` +
                            'die Bitte steht wieder offen.',
                        )
                      }
                    >
                      Einladung zurückziehen
                    </button>
                  )}
                </footer>
              </>
            ) : (
              <footer className="pending__actions">
                <button
                  type="button"
                  className="button"
                  disabled={bittenBusy === bitte.id}
                  onClick={() =>
                    void bittenLauf(
                      bitte,
                      () => ladeZugangEin(bitte.id),
                      (ergebnis) =>
                        ergebnis.versandFehler
                          ? `Die Einladung ist erzeugt, aber die Mail an ${bitte.email} ging nicht ` +
                            'raus. Der Link steht bei der Bitte — gib ihn von Hand weiter.'
                          : `Einladungslink an ${bitte.email} geschickt.`,
                    )
                  }
                >
                  {bittenBusy === bitte.id ? 'Moment…' : 'Einladung schicken'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={bittenBusy === bitte.id}
                  onClick={() =>
                    void bittenLauf(
                      bitte,
                      () => verwirfZugang(bitte.id),
                      () => `Die Bitte von ${bitte.vorname} ${bitte.nachname} ist verworfen.`,
                    )
                  }
                >
                  Verwerfen
                </button>
              </footer>
            )}
          </article>
        ))
      )}
    </div>
  );
}
