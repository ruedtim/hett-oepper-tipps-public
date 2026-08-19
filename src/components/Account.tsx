import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  bestelleEinladungen,
  changePassword,
  entferneEmail,
  erstelleEinladung,
  listeEinladungen,
  listeGeteilte,
  logout,
  setzeBenachrichtigungen,
  setzeEmail,
  umbenennen,
  widerrufeEinladung,
  widerrufeGeteilte,
} from '../lib/api';
import type { Einladung, GeteilteListe, Me } from '../lib/api';
import { formatDay } from '../lib/dates';

interface Props {
  me: Me | null;
  onClose: () => void;
  /**
   * Nach einem Passwortwechsel soll die App /api/me neu laden (Banner!) — nach
   * einem Namenswechsel zusätzlich den Datenbestand, weil die alten Beiträge
   * dann unter dem neuen Namen kommen.
   */
  onChanged: () => void;
  /** Die drei Admin-Wege — Höflichkeit wie überall: Der Server prüft selbst. */
  onVerlauf: () => void;
  onKategorien: () => void;
  onKonten: () => void;
}

/**
 * Die Konto-Ecke: Wer bin ich, Name ändern, Passwort ändern, abmelden.
 *
 * Nach einem Passwortwechsel enden die Sitzungen auf allen anderen Geräten —
 * die eigene bleibt, weil der Server der Antwort ein frisches Cookie mitgibt.
 * Ein Namenswechsel lässt alle Sitzungen bestehen: Der Passwort-Hash ändert
 * sich nicht, und daran hängt der Fingerabdruck im Cookie.
 */
export default function Account({ me, onClose, onChanged, onVerlauf, onKategorien, onKonten }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [neuerName, setNeuerName] = useState('');
  const [namePasswort, setNamePasswort] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameDone, setNameDone] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailHinweis, setEmailHinweis] = useState<string | null>(null);

  const [geteilte, setGeteilte] = useState<GeteilteListe[]>([]);
  const [teilenError, setTeilenError] = useState<string | null>(null);

  /**
   * Eigenes try/catch und ein eigener Fehlerplatz: Fehlt die Tabelle aus
   * migrations/0010 auf der Zieldatenbank, kostet das diesen einen Abschnitt
   * und nicht die ganze Konto-Seite.
   */
  const ladeGeteilte = useCallback(() => {
    if (me?.gast) return;
    listeGeteilte()
      .then((antwort) => {
        setGeteilte(antwort.listen);
        setTeilenError(null);
      })
      .catch((cause: unknown) =>
        setTeilenError(
          cause instanceof ApiError ? cause.message : 'Die geteilten Listen liessen sich nicht laden.',
        ),
      );
  }, [me?.gast]);
  useEffect(() => ladeGeteilte(), [ladeGeteilte]);

  async function widerrufen(id: string) {
    setTeilenError(null);
    try {
      await widerrufeGeteilte(id);
      setGeteilte((bisher) => bisher.filter((liste) => liste.id !== id));
    } catch (cause) {
      setTeilenError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    }
  }

  const [einladungen, setEinladungen] = useState<Einladung[]>([]);
  const [einladungenVerbleibend, setEinladungenVerbleibend] = useState(0);
  const [einladungenBestellt, setEinladungenBestellt] = useState(false);
  const [einladungBusy, setEinladungBusy] = useState(false);
  const [einladungError, setEinladungError] = useState<string | null>(null);

  /**
   * Wie bei den geteilten Listen: eigenes try/catch, eigener Fehlerplatz.
   * Fehlt die Tabelle aus migrations/0011 auf der Zieldatenbank, kostet das
   * diesen einen Abschnitt und nicht die ganze Konto-Seite.
   */
  const ladeEinladungen = useCallback(() => {
    if (me?.gast) return;
    listeEinladungen()
      .then((antwort) => {
        setEinladungen(antwort.einladungen);
        setEinladungenVerbleibend(antwort.verbleibend);
        setEinladungenBestellt(antwort.bestellt);
        setEinladungError(null);
      })
      .catch((cause: unknown) =>
        setEinladungError(
          cause instanceof ApiError ? cause.message : 'Die Einladungen liessen sich nicht laden.',
        ),
      );
  }, [me?.gast]);
  useEffect(() => ladeEinladungen(), [ladeEinladungen]);

  async function einladungsAktion(was: () => Promise<unknown>) {
    setEinladungBusy(true);
    setEinladungError(null);
    try {
      await was();
      ladeEinladungen();
    } catch (cause) {
      setEinladungError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setEinladungBusy(false);
    }
  }

  async function lauf(was: () => Promise<string | null>) {
    setEmailBusy(true);
    setEmailError(null);
    setEmailHinweis(null);
    try {
      setEmailHinweis(await was());
      onChanged();
    } catch (cause) {
      setEmailError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setEmailBusy(false);
    }
  }

  function speichereEmail(event: React.FormEvent) {
    event.preventDefault();
    void lauf(async () => {
      const result = await setzeEmail(email.trim());
      setEmail('');
      return result.hinweis ?? 'Gespeichert.';
    });
  }

  /** Dieselbe Adresse nochmal schicken heisst auf dem Server: neue Bestätigung. */
  function nochmalSenden() {
    void lauf(async () => (await setzeEmail(me?.email ?? '')).hinweis ?? 'Bestätigungsmail unterwegs.');
  }

  function entfernen() {
    void lauf(async () => {
      await entferneEmail();
      return 'Adresse entfernt. Benachrichtigungen und die Anmeldung per E-Mail gehen damit nicht mehr.';
    });
  }

  function schalte(patch: { wuensche?: boolean; eigeneTipps?: boolean; eigeneWuensche?: boolean }) {
    void lauf(async () => {
      await setzeBenachrichtigungen(patch);
      return null;
    });
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    setNameBusy(true);
    setNameError(null);
    setNameDone(null);
    try {
      const result = await umbenennen(neuerName.trim(), namePasswort);
      setNameDone(result.name);
      setNeuerName('');
      setNamePasswort('');
      onChanged();
    } catch (cause) {
      setNameError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setNameBusy(false);
    }
  }

  async function change(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== repeatPassword) {
      setError('Die beiden Eingaben stimmen nicht überein.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(oldPassword, newPassword);
      setDone(true);
      setOldPassword('');
      setNewPassword('');
      setRepeatPassword('');
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch {
      setError('Keine Verbindung — Abmelden hat nicht geklappt.');
      return;
    }
    // Neu laden bringt den Anmeldebildschirm.
    window.location.reload();
  }

  return (
    <div className="admin">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zurück
        </button>
      </div>

      <h1 className="form__title">Konto</h1>
      {me?.gast ? (
        <p className="form__context">
          Du schaust als <strong>Gast</strong> — alles lesen, nichts eintragen. Das Gäste-Passwort
          gehört der ganzen Runde; ändern kann es nur ein Admin. Für ein eigenes Konto frag in der
          Runde.
        </p>
      ) : (
        <p className="form__context">
          Angemeldet als <strong>{me?.name ?? '…'}</strong>
          {me?.admin ? ' — mit Admin-Rechten' : ''}.
        </p>
      )}

      {/* Die Admin-Wege stehen alle nebeneinander — Kategorien und Konten
          hinter dem Verlauf zu verstecken, hiess einen Umweg über eine Seite,
          die man dafür gar nicht sehen wollte. Und sie stehen OBEN: Wer
          verwalten will, soll nicht erst an allen Formularen vorbeiscrollen. */}
      {me?.admin && (
        <nav className="adminlinks" aria-label="Verwaltung">
          <button type="button" className="linkbutton" onClick={onVerlauf}>
            Verlauf
          </button>
          <button type="button" className="linkbutton" onClick={onKategorien}>
            Kategorien bearbeiten
          </button>
          <button type="button" className="linkbutton" onClick={onKonten}>
            Konten verwalten
          </button>
        </nav>
      )}

      {me?.mustChangePassword && !done && (
        <p className="form__error" role="alert">
          Du bist noch mit dem Startpasswort unterwegs — bitte hier ein eigenes wählen.
        </p>
      )}

      {/* Der Gast hat keinen Namen, den er ändern könnte — «Gast» ist kein
          Konto einer Person, sondern ein herumgereichtes Passwort. */}
      {!me?.gast && (
        <>
          <h2 className="form__title">Anzeigename</h2>
          <p className="form__context">
            So stehst du bei deinen Tipps und Wünschen. Änderst du ihn, zeigen auch deine
            bisherigen Beiträge den neuen Namen — im Verlauf bleibt der alte stehen, denn der sagt,
            wer damals gehandelt hat. Ein geteilter Link, der nach deinem alten Namen filtert,
            findet danach nichts mehr.
          </p>
          <form className="form" onSubmit={rename}>
            <label className="field">
              <span>Neuer Name</span>
              <input
                required
                maxLength={40}
                value={neuerName}
                onChange={(event) => setNeuerName(event.target.value)}
                placeholder={me?.name ?? ''}
              />
            </label>
            <label className="field">
              <span>Dein Passwort <em>zur Sicherheit</em></span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={namePasswort}
                onChange={(event) => setNamePasswort(event.target.value)}
              />
            </label>

            {nameError && <p className="form__error" role="alert">{nameError}</p>}
            {nameDone && (
              <p className="admin__done" role="status">
                Du heisst jetzt «{nameDone}».
              </p>
            )}

            <div className="form__actions">
              <button type="submit" className="button" disabled={nameBusy}>
                {nameBusy ? 'Moment…' : 'Namen ändern'}
              </button>
            </div>
          </form>

          <h2 className="form__title">E-Mail</h2>
          <p className="form__context">
            Freiwillig. Mit einer bestätigten Adresse kannst du dich auch damit anmelden, ein vergessenes Passwort selbst zurücksetzen und
            dich benachrichtigen lassen.
          </p>

          {me?.email && (
            <p className="pending__meta">
              {me.emailVerifiziert ? (
                <>
                  <strong>{me.email}</strong> — bestätigt.
                </>
              ) : (
                <>
                  <strong>{me.email}</strong> — noch nicht bestätigt. Schau im Postfach nach, auch
                  im Spam-Ordner.
                </>
              )}
            </p>
          )}

          <form className="form" onSubmit={speichereEmail}>
            <label className="field">
              <span>{me?.email ? 'Andere Adresse' : 'Deine Adresse'}</span>
              <input
                type="email"
                required
                maxLength={200}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="du@beispiel.ch"
              />
            </label>

            {emailError && <p className="form__error" role="alert">{emailError}</p>}
            {emailHinweis && <p className="admin__done" role="status">{emailHinweis}</p>}

            <div className="form__actions">
              <button type="submit" className="button" disabled={emailBusy}>
                {emailBusy ? 'Moment…' : me?.email ? 'Adresse ändern' : 'Adresse speichern'}
              </button>
              {/* Nur solange es etwas zu bestätigen gibt — bei einer bestätigten
                  Adresse würde der Knopf nichts tun ausser Verwirrung stiften. */}
              {me?.email && !me.emailVerifiziert && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={emailBusy}
                  onClick={nochmalSenden}
                >
                  Bestätigung nochmal senden
                </button>
              )}
              {me?.email && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={emailBusy}
                  onClick={entfernen}
                >
                  Adresse entfernen
                </button>
              )}
            </div>
          </form>

          <h2 className="form__title">Benachrichtigungen</h2>
          <p className="form__context">
            {me?.emailVerifiziert
              ? 'Kommen als schlichte E-Mail, ein paar Zeilen und ein Link.'
              : 'Dafür braucht es eine bestätigte E-Mail-Adresse — siehe oben. Einstellen kannst du es trotzdem schon.'}
          </p>
          <label className="toggle toggle--block">
            <input
              type="checkbox"
              checked={me?.benachrichtigungWuensche ?? false}
              disabled={emailBusy}
              onChange={(event) => schalte({ wuensche: event.target.checked })}
            />
            Wenn jemand Tipps sucht
          </label>
          <label className="toggle toggle--block">
            <input
              type="checkbox"
              checked={me?.benachrichtigungEigeneTipps ?? false}
              disabled={emailBusy}
              onChange={(event) => schalte({ eigeneTipps: event.target.checked })}
            />
            Wenn jemand einen Tipp ergänzt, an dem ich beteiligt bin
          </label>
          <label className="toggle toggle--block">
            <input
              type="checkbox"
              checked={me?.benachrichtigungEigeneWuensche ?? false}
              disabled={emailBusy}
              onChange={(event) => schalte({ eigeneWuensche: event.target.checked })}
            />
            Wenn jemand einen Tipp zu meinem Wunsch beisteuert
          </label>

          <h2 className="form__title">Geteilte Listen</h2>
          <p className="form__context">
            Über «Diese Liste teilen» wird aus den gerade sichtbaren Tipps ein Link für
            Leute ohne Passwort. Er zeigt einen festen Ausschnitt — was du später
            hinzufügst, taucht dort nicht auf. Name und Fotos gehen nur bei deinen
            eigenen Beiträgen mit.
          </p>

          {teilenError && (
            <p className="form__error" role="alert">
              {teilenError}
            </p>
          )}

          {geteilte.length === 0 ? (
            <p className="field__hint">Gerade ist nichts geteilt.</p>
          ) : (
            <ul className="geteilt">
              {geteilte.map((liste) => (
                <li key={liste.id} className="geteilt__eintrag">
                  <input
                    className="teilenlink__url"
                    type="text"
                    readOnly
                    value={liste.url}
                    onFocus={(event) => event.target.select()}
                    aria-label={`Adresse der Liste vom ${formatDay(liste.erstellt)}`}
                  />
                  <p className="geteilt__meta">
                    {liste.anzahl === 1 ? '1 Tipp' : `${liste.anzahl} Tipps`} · geteilt am{' '}
                    {formatDay(liste.erstellt)} · gilt bis {formatDay(liste.bis)}
                  </p>
                  <button
                    type="button"
                    className="linkbutton"
                    onClick={() => void widerrufen(liste.id)}
                  >
                    Widerrufen
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 className="form__title">Einladungen</h2>
          <p className="form__context">
            Hol jemanden in die Runde: Ein Einladungslink lässt eine Person sich selbst ein
            Konto anlegen. Jeder Link gilt einmal
            und 90 Tage; jedes Konto hat drei Einladungslinks. Falls das nicht reicht, kann man zusätzliche anfordern.
          </p>

          {einladungError && (
            <p className="form__error" role="alert">
              {einladungError}
            </p>
          )}

          {einladungen.length > 0 && (
            <ul className="geteilt">
              {einladungen.map((einladung) => (
                <li key={einladung.id} className="geteilt__eintrag">
                  {einladung.status === 'offen' && (
                    <input
                      className="teilenlink__url"
                      type="text"
                      readOnly
                      value={einladung.url}
                      onFocus={(event) => event.target.select()}
                      aria-label={`Einladungslink vom ${formatDay(einladung.erstellt)}`}
                    />
                  )}
                  <p className="geteilt__meta">
                    {einladung.status === 'offen' &&
                      `erstellt am ${formatDay(einladung.erstellt)} · gilt bis ${formatDay(einladung.bis)}`}
                    {einladung.status === 'eingeloest' &&
                      `eingelöst${einladung.eingeloestVon ? ` von ${einladung.eingeloestVon}` : ''}${
                        einladung.eingeloestAm ? ` am ${formatDay(einladung.eingeloestAm)}` : ''
                      }`}
                    {einladung.status === 'widerrufen' && `widerrufen · erstellt am ${formatDay(einladung.erstellt)}`}
                    {einladung.status === 'abgelaufen' && `abgelaufen am ${formatDay(einladung.bis)}`}
                  </p>
                  {einladung.status === 'offen' && (
                    <button
                      type="button"
                      className="linkbutton"
                      disabled={einladungBusy}
                      onClick={() => void einladungsAktion(() => widerrufeEinladung(einladung.id))}
                    >
                      Widerrufen
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="form__actions">
            {einladungenVerbleibend > 0 ? (
              <button
                type="button"
                className="button"
                disabled={einladungBusy}
                onClick={() => void einladungsAktion(() => erstelleEinladung())}
              >
                Einladung erstellen (noch {einladungenVerbleibend})
              </button>
            ) : einladungenBestellt ? (
              <span className="field__hint">
                Deine Bestellung liegt bei den Admins — sobald jemand nachfüllt, geht es hier
                weiter.
              </span>
            ) : (
              <button
                type="button"
                className="button"
                disabled={einladungBusy}
                onClick={() => void einladungsAktion(() => bestelleEinladungen())}
              >
                Mehr Einladungen bestellen
              </button>
            )}
          </p>

          <h2 className="form__title">Deine Daten</h2>
          <p className="form__context">
            Alles, was dir gehört, in einer ZIP-Datei: dein Konto, deine Beschreibungen
            samt der Tipps, zu denen sie gehören, deine Wünsche und deine Fotos.
          </p>
          <p className="form__actions">
            {/* Ein Link und kein Knopf mit fetch: Der Browser übernimmt Download,
                Dateinamen und Fortschritt, das Cookie geht von selbst mit, und es
                funktioniert auch ohne JavaScript. */}
            <a className="button" href="/api/account/export">
              Daten herunterladen (ZIP)
            </a>
          </p>

          <h2 className="form__title">Passwort</h2>
        </>
      )}

      {/* Kein Passwort-Formular für Gäste: Das Gäste-Passwort ist geteilt, und
          wer es ändern darf, ist ein Admin — nicht der Gast selbst. Ein Gast
          würde damit allen anderen den Zugang wegnehmen. */}
      {!me?.gast && (
        <form className="form" onSubmit={change}>
          <label className="field">
            <span>Bisheriges Passwort</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Neues Passwort <em>mind. 8 Zeichen</em></span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Neues Passwort, nochmal</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
            />
          </label>

          {error && <p className="form__error" role="alert">{error}</p>}
          {done && (
            <p className="admin__done" role="status">
              Passwort geändert. Auf anderen Geräten heisst es einmal neu anmelden.
            </p>
          )}

          <div className="form__actions">
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Moment…' : 'Passwort ändern'}
            </button>
          </div>
        </form>
      )}

      {/* Ohne Formular fehlt dem Gast die Stelle, an der eine Meldung stünde —
          und «Abmelden» kann auch für ihn scheitern. */}
      {me?.gast && error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <footer className="sitefoot">
        <button type="button" className="linkbutton" onClick={() => void signOut()}>
          Abmelden
        </button>
      </footer>
    </div>
  );
}
