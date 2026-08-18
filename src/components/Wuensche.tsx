import { useMemo, useState } from 'react';
import { matches, searchKey } from '../../shared/normalize.mjs';
import {
  ApiError,
  setzeBenachrichtigungen,
  setzeEmail,
  wunschErfuellt,
  wunschLoeschen,
  wunschTippVerknuepfen,
} from '../lib/api';
import { countryName } from '../lib/countries';
import { formatDay } from '../lib/dates';
import { wunschZielKey, wunschZielLabel } from '../lib/wunschZiel';
import type { Category, Tip, Wunsch } from '../lib/types';
import CategoryChip from './CategoryChip';

interface Props {
  wuensche: Wunsch[];
  tips: Tip[];
  categoriesById: Map<string, Category>;
  /** Kontoname des angemeldeten Kontos, null wenn unbekannt. */
  meinName: string | null;
  istAdmin: boolean;
  /** Zielschlüssel aus der URL («o:…» oder «l:…»), leer für «alle». */
  zielFilter: string;
  onClose: () => void;
  onAlleOrte: () => void;
  /** In die Tippliste springen, gefiltert auf Ort oder Land des Wunsches. */
  onZielAnsehen: (zielKey: string) => void;
  /** Einen einzelnen Tipp öffnen. */
  onTippOeffnen: (tipId: string) => void;
  onNeu: () => void;
  /** Den eigenen Wunsch bearbeiten — führt auf das Wunsch-Formular. */
  onBearbeiten: (wunschId: string) => void;
  /** Neuen Tipp anlegen, dem Wunsch bereits zugeordnet. */
  onTippHinzufuegen: (wunschId: string) => void;
  /** Nach jeder Änderung: Daten neu laden. */
  onChanged: () => void;
  /**
   * Zustand der Wunsch-Benachrichtigung. Genau hier gehört sie hin, weil man
   * hier merkt, dass man von einem Wunsch fast zu spät erfahren hätte — und
   * darum kann man die Adresse auch gleich hier eintragen statt erst unter
   * «Konto». `null` beim Gast, der die Seite ohnehin nicht erreicht.
   */
  benachrichtigung: { email: string | null; verifiziert: boolean; an: boolean } | null;
  /** Nach jeder Änderung an den eigenen Kontodaten: /api/me neu laden. */
  onMeGeaendert: () => void;
}

/** So viele Vorschläge auf einmal — mehr liest niemand, und die Liste bliebe nicht überschaubar. */
const MAX_VORSCHLAEGE = 8;

/**
 * Die Wünsche als eigene Seite — die Kopfzeile zeigt nur die Orte, hier steht
 * das Ganze: von wem, bis wann, wonach genau.
 *
 * Erfüllte Wünsche bleiben bis zum Ablauf stehen (gedimmt, mit Abzeichen). Das
 * ist Absicht: Auch Admins dürfen fremde Wünsche schliessen, und ohne den
 * sichtbaren Zustand wüsste die Autorin nie, was mit ihrem Wunsch passiert ist.
 */
export default function Wuensche({
  wuensche,
  tips,
  categoriesById,
  meinName,
  istAdmin,
  zielFilter,
  onClose,
  onAlleOrte,
  onZielAnsehen,
  onTippOeffnen,
  onNeu,
  onBearbeiten,
  onTippHinzufuegen,
  onChanged,
  benachrichtigung,
  onMeGeaendert,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [bestaetigt, setBestaetigt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Wunsch-ID, bei der die Suchliste offen ist. */
  const [verknuepfeBei, setVerknuepfeBei] = useState<string | null>(null);
  const [suche, setSuche] = useState('');

  const meinKey = meinName ? searchKey(meinName) : '';

  const tippsById = useMemo(() => new Map(tips.map((tip) => [tip.id, tip])), [tips]);

  // Wie viele Tipps der Filter für ein Ziel fände — bei einem Ortswunsch der
  // Ortsfilter, bei einem Landwunsch der Landfilter. Genau die Zahl entscheidet,
  // ob «Alles in …» überhaupt Sinn hat: Bei einem Regionswunsch («Thurgau») ist
  // sie null, und dann führte der Knopf auf ein ratloses «Nichts gefunden».
  const tippsProZiel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tip of tips) {
      counts.set(`o:${tip.placeKey}`, (counts.get(`o:${tip.placeKey}`) ?? 0) + 1);
      counts.set(`l:${tip.country}`, (counts.get(`l:${tip.country}`) ?? 0) + 1);
    }
    return counts;
  }, [tips]);

  const sichtbar = useMemo(
    () =>
      zielFilter ? wuensche.filter((wunsch) => wunschZielKey(wunsch) === zielFilter) : wuensche,
    [wuensche, zielFilter],
  );

  // Wie das Ziel heisst — für die Überschrift, wenn gefiltert wird.
  const zielLabel = sichtbar[0] ? wunschZielLabel(sichtbar[0]) : zielFilter;

  /** Eigener «busy»-Schlüssel: Die Abo-Zeile gehört zu keinem einzelnen Wunsch. */
  const ABO = '\u0000abo';
  const [email, setEmail] = useState('');
  const [aboHinweis, setAboHinweis] = useState<string | null>(null);

  /** Adresse eintragen UND abonnieren — ein Aufruf, ein Klick. */
  async function melde(event: React.FormEvent) {
    event.preventDefault();
    setAboHinweis(null);
    await lauf(ABO, async () => {
      const ergebnis = await setzeEmail(email.trim(), true);
      setEmail('');
      setAboHinweis(ergebnis.hinweis ?? 'Gespeichert.');
      onMeGeaendert();
    });
  }

  async function abonniere(an: boolean) {
    setAboHinweis(null);
    await lauf(ABO, async () => {
      await setzeBenachrichtigungen({ wuensche: an });
      onMeGeaendert();
    });
  }

  async function lauf(id: string, tun: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await tun();
      setBestaetigt(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  }

  function loeschen(wunsch: Wunsch) {
    // Zweiter Klick: Wünsche stehen nicht im Verlauf, es gibt also kein Zurück.
    if (bestaetigt !== wunsch.id) {
      setBestaetigt(wunsch.id);
      return;
    }
    void lauf(wunsch.id, () => wunschLoeschen(wunsch.id));
  }

  /**
   * Vorschläge für «Tipp verknüpfen»: alles, was noch nicht zugeordnet ist,
   * über Name, Ort und Land durchsuchbar. Ohne Suchwort stehen die Tipps im
   * passenden Land zuerst — bei einem Wunsch für die Dolomiten sind die
   * italienischen die einzigen ernsthaften Kandidaten.
   */
  function vorschlaege(wunsch: Wunsch): Tip[] {
    const schon = new Set(wunsch.tipps ?? []);
    const offen = tips.filter((tip) => !schon.has(tip.id));
    const gesucht = suche.trim();

    if (gesucht) {
      return offen
        .filter(
          (tip) =>
            matches(tip.name, gesucht) ||
            matches(tip.place, gesucht) ||
            matches(countryName(tip.country), gesucht),
        )
        .slice(0, MAX_VORSCHLAEGE);
    }

    return [...offen]
      .sort((a, b) => {
        const aLand = a.country === wunsch.land ? 0 : 1;
        const bLand = b.country === wunsch.land ? 0 : 1;
        return aLand - bLand || a.name.localeCompare(b.name, 'de');
      })
      .slice(0, MAX_VORSCHLAEGE);
  }

  function verknuepfungOeffnen(wunschId: string) {
    setSuche('');
    setVerknuepfeBei((current) => (current === wunschId ? null : wunschId));
  }

  return (
    <div className="admin">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zur Liste
        </button>
      </div>

      <h1 className="form__title">Wünsche</h1>

      {zielFilter ? (
        <p className="form__context">
          Nur für {zielLabel} ·{' '}
          <button type="button" className="linkbutton" onClick={onAlleOrte}>
            alle zeigen
          </button>
        </p>
      ) : (
        <p className="form__context">
          Wer gerade Tipps sucht. Jeder Wunsch verschwindet spätestens am angegebenen Tag.
        </p>
      )}

      {benachrichtigung?.verifiziert ? (
        <label className="toggle toggle--block">
          <input
            type="checkbox"
            checked={benachrichtigung.an}
            disabled={busy === ABO}
            onChange={(event) => void abonniere(event.target.checked)}
          />
          Über neue Wünsche benachrichtigen
        </label>
      ) : benachrichtigung?.email ? (
        // Adresse da, aber noch nicht bestätigt: Ein Kreuzchen wäre hier ein
        // Versprechen, das die Seite nicht halten kann.
        <p className="form__context">
          Wir haben <strong>{benachrichtigung.email}</strong> — sobald du den Bestätigungslink
          darin geklickt hast, sagen wir dir Bescheid, wenn jemand Tipps sucht. Schau auch im
          Spam-Ordner nach.
        </p>
      ) : benachrichtigung ? (
        // Der eigentliche Punkt: Adresse eintragen und abonnieren in EINEM
        // Schritt. Der Umweg über «Konto» ist genau der Moment, in dem man es
        // sein lässt — und der Server nimmt beides ohnehin im selben Aufruf
        // entgegen (api/account/email.ts).
        <form className="form" onSubmit={melde}>
          <label className="field">
            <span>Bescheid bekommen, wenn jemand Tipps sucht</span>
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
          <p className="form__context">
            Freiwillig. Du kannst dich damit auch anmelden und ein vergessenes Passwort selbst
            zurücksetzen. Abschalten geht jederzeit unter «Konto».
          </p>
          <div className="form__actions">
            <button type="submit" className="button" disabled={busy === ABO}>
              {busy === ABO ? 'Moment…' : 'Sag mir Bescheid'}
            </button>
          </div>
        </form>
      ) : null}

      {aboHinweis && (
        <p className="admin__done" role="status">
          {aboHinweis}
        </p>
      )}

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {sichtbar.length === 0 ? (
        <div className="empty">
          <p>{zielFilter ? 'Dafür sucht gerade niemand Tipps.' : 'Gerade sucht niemand Tipps.'}</p>
          <button type="button" className="button" onClick={onNeu}>
            Tipps wünschen
          </button>
        </div>
      ) : (
        <ul className="wunschliste">
          {sichtbar.map((wunsch) => {
            const meins = meinKey !== '' && searchKey(wunsch.von) === meinKey;
            const darfAendern = meins || istAdmin;
            const erfuellt = Boolean(wunsch.erfuellt);
            // Zugeordnete Tipps können inzwischen gelöscht sein — der Server
            // räumt die Zuordnung dann zwar mit, aber die Antwort im Browser
            // kann älter sein als die Löschung.
            const verknuepfte = (wunsch.tipps ?? []).flatMap((id) => {
              const tip = tippsById.get(id);
              return tip ? [tip] : [];
            });
            const zielKey = wunschZielKey(wunsch);
            const zielTreffer = tippsProZiel.get(zielKey) ?? 0;
            const gefunden = verknuepfeBei === wunsch.id ? vorschlaege(wunsch) : [];

            return (
              <li key={wunsch.id} className={`wunsch${erfuellt ? ' wunsch--erfuellt' : ''}`}>
                <div className="wunsch__kopf">
                  {/* Ohne Ort steht das Land allein in der Überschrift, statt
                      als blasser Zusatz neben einer Leerstelle. */}
                  <h2 className="wunsch__ort">
                    {wunsch.ort ? (
                      <>
                        {wunsch.ort} <span className="wunsch__land">{countryName(wunsch.land)}</span>
                      </>
                    ) : (
                      countryName(wunsch.land)
                    )}
                  </h2>
                  {!wunsch.ort && <span className="badge badge--land">ganzes Land</span>}
                  {erfuellt && <span className="badge badge--erfuellt">erfüllt</span>}
                </div>

                <p className="wunsch__bis">
                  Bis <time dateTime={wunsch.bis}>{formatDay(wunsch.bis)}</time>
                </p>

                {wunsch.kategorien.length > 0 && (
                  <div className="wunsch__cats">
                    {wunsch.kategorien.map((id) => {
                      const category = categoriesById.get(id);
                      return category ? <CategoryChip key={id} category={category} readOnly /> : null;
                    })}
                  </div>
                )}

                {wunsch.text && <p className="wunsch__text">{wunsch.text}</p>}

                {/* Die zugeordneten Tipps. Der eigentliche Zweck der
                    Verknüpfung: Bei «Thurgau» oder «Dolomiten» ist das die
                    einzige Antwort, die überhaupt zustande kommt. */}
                {verknuepfte.length > 0 && (
                  <div className="wunsch__treffer">
                    <span className="wunsch__treffer-titel">Dazu passt schon</span>
                    <ul>
                      {verknuepfte.map((tip) => (
                        <li key={tip.id}>
                          <button
                            type="button"
                            className="linkbutton"
                            onClick={() => onTippOeffnen(tip.id)}
                          >
                            {tip.name}
                          </button>
                          <span className="wunsch__treffer-ort">
                            {tip.place} · {countryName(tip.country)}
                          </span>
                          <button
                            type="button"
                            className="linkbutton wunsch__loesen"
                            disabled={busy === wunsch.id}
                            title="Zuordnung wieder lösen"
                            onClick={() =>
                              void lauf(wunsch.id, () =>
                                wunschTippVerknuepfen(wunsch.id, tip.id, false),
                              )
                            }
                          >
                            lösen
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="wunsch__meta">
                  Von {wunsch.von}
                  {wunsch.erfuellt &&
                    ` · erfüllt am ${formatDay(wunsch.erfuellt.am)} von ${wunsch.erfuellt.von}`}
                </p>

                <div className="wunsch__aktionen">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => onTippHinzufuegen(wunsch.id)}
                  >
                    Tipp hinzufügen
                  </button>
                  <button
                    type="button"
                    className="linkbutton"
                    onClick={() => verknuepfungOeffnen(wunsch.id)}
                  >
                    {verknuepfeBei === wunsch.id ? 'Abbrechen' : 'Tipp verknüpfen'}
                  </button>
                  {/* Nur wenn der Filter auch etwas fände — bei einem
                      Regionswunsch führte der Knopf sonst auf «Nichts gefunden». */}
                  {zielTreffer > 0 && (
                    <button
                      type="button"
                      className="linkbutton"
                      onClick={() => onZielAnsehen(zielKey)}
                    >
                      Alles in {wunschZielLabel(wunsch)} ({zielTreffer})
                    </button>
                  )}
                  {darfAendern && (
                    <>
                      {/* Bearbeiten nur, solange der Wunsch offen ist: An einem
                          erfüllten etwas zu ändern hiesse, die Frage nachträglich
                          umzuschreiben, die schon beantwortet wurde. */}
                      {!erfuellt && (
                        <button
                          type="button"
                          className="linkbutton"
                          disabled={busy === wunsch.id}
                          onClick={() => onBearbeiten(wunsch.id)}
                        >
                          Bearbeiten
                        </button>
                      )}
                      <button
                        type="button"
                        className="linkbutton"
                        disabled={busy === wunsch.id}
                        onClick={() =>
                          void lauf(wunsch.id, () => wunschErfuellt(wunsch.id, !erfuellt))
                        }
                      >
                        {erfuellt ? 'Doch noch offen' : 'Als erfüllt markieren'}
                      </button>
                      <button
                        type="button"
                        className="linkbutton"
                        disabled={busy === wunsch.id}
                        onClick={() => loeschen(wunsch)}
                      >
                        {bestaetigt === wunsch.id ? 'Wirklich löschen?' : 'Löschen'}
                      </button>
                    </>
                  )}
                </div>

                {bestaetigt === wunsch.id && (
                  <p className="form__error" role="alert">
                    {meins
                      ? 'Der Wunsch verschwindet spurlos — nochmal drücken zum Bestätigen.'
                      : `Der Wunsch von ${wunsch.von} verschwindet spurlos. Nochmal drücken zum Bestätigen.`}
                  </p>
                )}

                {verknuepfeBei === wunsch.id && (
                  <div className="wunsch__suche">
                    <label className="field">
                      <span>Welcher Tipp passt dazu?</span>
                      {/* Kein autoFocus: Das Feld steht direkt unter dem Knopf,
                          den man gerade gedrückt hat, ist also ohnehin im Blick.
                          Der Fokussprung würde die Seite verschieben und auf dem
                          Handy die Tastatur über die Vorschläge legen. */}
                      <input
                        type="search"
                        value={suche}
                        onChange={(event) => setSuche(event.target.value)}
                        placeholder="Name, Ort oder Land"
                        maxLength={80}
                      />
                    </label>
                    {gefunden.length === 0 ? (
                      <p className="field__hint">
                        {suche.trim() ? 'Nichts gefunden.' : 'Alle Tipps sind schon zugeordnet.'}
                      </p>
                    ) : (
                      <ul className="wunsch__vorschlaege">
                        {gefunden.map((tip) => (
                          <li key={tip.id}>
                            <button
                              type="button"
                              className="wunsch__vorschlag"
                              disabled={busy === wunsch.id}
                              onClick={() =>
                                void lauf(wunsch.id, async () => {
                                  await wunschTippVerknuepfen(wunsch.id, tip.id, true);
                                  setVerknuepfeBei(null);
                                  setSuche('');
                                })
                              }
                            >
                              <strong>{tip.name}</strong>
                              <span>
                                {tip.place} · {countryName(tip.country)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Nur wenn schon etwas dasteht — im leeren Zustand steht der Knopf oben
          mitten im Blick, ein zweiter unten wäre einer zu viel. */}
      {sichtbar.length > 0 && (
        <button type="button" className="fab" onClick={onNeu}>
          <span aria-hidden="true">＋</span> Tipps wünschen
        </button>
      )}
    </div>
  );
}
