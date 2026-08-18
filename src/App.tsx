import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { searchKey } from '../shared/normalize.mjs';
import Account from './components/Account';
import CategoryEditor from './components/CategoryEditor';
import Feedback from './components/Feedback';
import FilterBar from './components/FilterBar';
import History from './components/History';
import Infos from './components/Infos';
import RemoveTip from './components/RemoveTip';
import SignalHinweis from './components/SignalHinweis';
import SubmitForm from './components/SubmitForm';
import TeilenKnopf from './components/TeilenKnopf';
import Thanks from './components/Thanks';
import TipCard from './components/TipCard';
import TipDetail from './components/TipDetail';
import UserAdmin from './components/UserAdmin';
import Wuensche from './components/Wuensche';
import WunschForm from './components/WunschForm';
import WunschZeile from './components/WunschZeile';
import { fetchMe } from './lib/api';
import type { Me } from './lib/api';
import {
  applyFilters,
  applySort,
  categoryCounts,
  countryOptions,
  EMPTY_FILTERS,
  filtersFromQuery,
  isEmpty,
  personKey,
  personOptions,
  placeOptions,
  toQuery,
  viewStateFromQuery,
} from './lib/filter';
import type { Filters, ViewState } from './lib/filter';
import { navigate, replaceSearch, screenFromPath, useRoute } from './lib/router';
import { suchIndex } from './lib/vorschlaege';
import { zielZuFilter } from './lib/wunschZiel';
import type { AppData, Category, Tip } from './lib/types';

/**
 * Leaflet wiegt 45 KB gzip und wird nur geladen, wer die Karte auch öffnet.
 * Vite legt dabei auch das Leaflet-CSS in einen eigenen Chunk.
 */
const MapView = lazy(() => import('./components/MapView'));

/** «1 Tipp» statt «1 Tipps» — fällt sofort auf, sobald die Sammlung klein ist. */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Seiten, die es für den Gäste-Zugang nicht gibt. Als Menge und nicht als
 * Bedingung an jeder einzelnen Stelle: Eine neue solche Seite fällt beim
 * Eintragen hier auf, und wer sie vergisst, sieht es am 403 aus dem Gate.
 *
 * Zwei Gründe, dieselbe Antwort: Alles bis `feedback` schreibt (das Gate liesse
 * es ohnehin nicht durch), `wuensche` dagegen ist reines Lesen — aber der Server
 * schickt Gästen keine Wünsche, und eine Liste, die dann «Gerade sucht niemand
 * Tipps» behauptet, wäre schlicht falsch.
 *
 * Die Admin-Seiten fehlen absichtlich: Der Gast ist kein Admin, dort greift
 * schon die Meldung «Dafür braucht es Admin-Rechte».
 */
const GAST_GESPERRT = new Set([
  'neu',
  'ergaenzen',
  'korrigieren',
  'weg',
  'wunsch-neu',
  'wunsch-bearbeiten',
  'feedback',
  'wuensche',
]);

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [thanks, setThanks] = useState<{ repeated: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const route = useRoute();

  // Merkt sich, wo man war, bevor man auf «Rückmeldung» gedrückt hat — sonst
  // steht in jedem Issue nur «/» und es braucht eine Rückfrage.
  const [cameFrom, setCameFrom] = useState('/');
  useEffect(() => {
    if (route.path !== '/feedback') setCameFrom(window.location.hash || '#/');
  }, [route.path]);

  /**
   * Lädt den Datenbestand — beim Start und nach jedem erfolgreichen Schreiben.
   * Seit die Daten aus D1 kommen, ist eine Änderung damit SOFORT sichtbar,
   * nicht erst nach dem nächsten Deployment.
   */
  const reload = useCallback(() => {
    fetch('/api/data')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AppData>;
      })
      .then((fresh) => {
        setData(fresh);
        setError(null);
      })
      .catch((cause: unknown) => {
        // Offline ist kein Defekt: Seit die App installierbar ist (#76),
        // öffnet sie auch ohne Netz — «Failed to fetch» sagt dann niemandem
        // etwas, «kein Netz» schon.
        if (!navigator.onLine) setError('kein Netz');
        else setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  useEffect(() => reload(), [reload]);

  // Zurück im Netz → frisch laden. Die installierte App hat keinen
  // Browser-Reload-Knopf; wer aus dem Flugmodus kommt, soll nicht auf
  // «kein Netz» sitzen bleiben.
  useEffect(() => {
    window.addEventListener('online', reload);
    return () => window.removeEventListener('online', reload);
  }, [reload]);

  // Auch nach einem Passwortwechsel neu laden — sonst bliebe das
  // Startpasswort-Banner stehen, bis jemand die Seite neu lädt.
  const reloadMe = useCallback(() => {
    fetchMe().then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(() => reloadMe(), [reloadMe]);

  /**
   * Der Gäste-Zugang darf nur lesen, und er sieht weniger: keine Wünsche, keine
   * Namen, keine Fotos. Weggelassen wird das im Server (functions/api/data.ts) —
   * hier hängt nur die Oberfläche daran, damit sie nicht Knöpfe und Felder
   * zeigt, die ins Leere führen.
   */
  const nurLesen = me?.gast ?? false;

  const filters = useMemo(() => {
    const ausUrl = filtersFromQuery(route.search);
    // Ohne Namen gibt es keinen Personen-Filter. Ein geteilter Link mit `p=`
    // filterte sonst unsichtbar: Das Auswahlfeld dazu ist ausgeblendet, die
    // Liste bliebe aber leer, und niemand sähe warum.
    return nurLesen ? { ...ausUrl, people: [] } : ausUrl;
  }, [route.search, nurLesen]);
  const viewState = useMemo(() => viewStateFromQuery(route.search), [route.search]);
  const screen = useMemo(() => screenFromPath(route.path), [route.path]);

  /**
   * Der Query-String für jeden Sprung innerhalb der App.
   *
   * Filter, Ansicht, Reihenfolge und der hervorgehobene Punkt reisen zusammen —
   * sonst landet man beim Zurück aus einem Tipp wieder in der ungefilterten Liste.
   */
  const query = (over: Partial<ViewState> = {}, next: Filters = filters) =>
    toQuery(next, { ...viewState, ...over });

  const categoriesById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const category of data?.categories ?? []) map.set(category.id, category);
    return map;
  }, [data]);

  const tips = data?.tips ?? [];

  // Abgelaufenes hat der Server schon weggelassen; in die Kopfzeile gehören
  // zusätzlich nur die offenen — ein erfüllter Wunsch ist keine Frage mehr.
  const wuensche = data?.wuensche ?? [];
  const offeneWuensche = useMemo(() => wuensche.filter((wunsch) => !wunsch.erfuellt), [wuensche]);

  const knownPlaces = useMemo(
    () => tips.map((tip) => ({ label: tip.place, country: tip.country })),
    [tips],
  );

  // Startpunkt für die Ortswahl, ohne dafür einen Dienst zu fragen.
  const knownCoords = useMemo(
    () => tips.flatMap((tip) => (tip.coords ? [tip.coords] : [])),
    [tips],
  );

  // Die Auswahllisten zählen jeweils gegen die ANDEREN Filter, nicht gegen sich
  // selbst. Sonst zeigte das Chip «Essen» nach dem Anklicken die Zahl aller
  // Essens-Tipps, statt zu verraten, was ein zusätzlicher Filter brächte.
  const withoutCategory = useMemo(() => applyFilters(tips, { ...filters, categories: [] }), [tips, filters]);
  // `radius: 0` steht hier, obwohl ein Umkreis ohne Ort ohnehin nichts tut —
  // die Absicht soll dastehen und nicht aus `applyFilters` hergeleitet werden.
  const withoutPlace = useMemo(
    () => applyFilters(tips, { ...filters, place: '', radius: 0 }),
    [tips, filters],
  );
  const withoutPeople = useMemo(() => applyFilters(tips, { ...filters, people: [] }), [tips, filters]);
  const withoutCountry = useMemo(
    () => applyFilters(tips, { ...filters, country: '', place: '', radius: 0 }),
    [tips, filters],
  );
  const visible = useMemo(
    () => applySort(applyFilters(tips, filters), viewState.sort),
    [tips, filters, viewState.sort],
  );

  const closedCount = useMemo(
    () => applyFilters(tips, { ...filters, includeClosed: true }).filter((tip) => tip.closed).length,
    [tips, filters],
  );

  // Einmal pro Datensatz gebaut, nicht pro Tastendruck: Das Suchfeld sucht
  // darin, statt bei jedem Buchstaben alle Tipps neu zu zerlegen.
  const suchEintraege = useMemo(() => suchIndex(tips), [tips]);

  /**
   * Wie viele Tipps die Volltextsuche fände — für die letzte Zeile der
   * Vorschlagsliste. Gezählt wird UNTER den übrigen Filtern, weil die nach der
   * Wahl stehen bleiben: «in allen Texten suchen (4)» soll nicht 4 versprechen
   * und dann 0 zeigen, weil noch eine Kategorie angehakt war.
   */
  const volltextTreffer = useCallback(
    (text: string) => applyFilters(tips, { ...filters, query: text }).length,
    [tips, filters],
  );

  /**
   * Warum ein Tipp aus einem anderen Ort in der Liste steht, muss dastehen —
   * sonst sieht der Umkreis aus wie ein kaputter Ortsfilter.
   */
  const umkreisHinweis = useMemo(() => {
    if (!filters.place || filters.radius === 0) return '';
    const ort = tips.find((tip) => tip.placeKey === filters.place)?.place;
    return ort ? `inkl. ${filters.radius} km um ${ort}` : '';
  }, [tips, filters.place, filters.radius]);

  // Ohne Koordinaten kein Marker — aber auch kein stilles Verschwinden.
  const withoutCoords = useMemo(() => visible.filter((tip) => !tip.coords), [visible]);

  /**
   * Wer von einem Tipp aus «Auf der Karte» drückt, will diesen Punkt sehen —
   * auch wenn ein Filter ihn gerade ausblendet oder er als geschlossen gilt.
   */
  const mapTips = useMemo(() => {
    const focused = viewState.focus ? tips.find((tip) => tip.id === viewState.focus) : undefined;
    return focused?.coords && !visible.includes(focused) ? [focused, ...visible] : visible;
  }, [tips, visible, viewState.focus]);

  const openTip = (tipId: string) => navigate(`/tipp/${tipId}`, query());

  // Ein geänderter Filter beendet die Hervorhebung: Sonst bliebe ein Punkt auf
  // der Karte stehen, den der neue Filter gar nicht mehr durchlässt.
  const setFilters = (next: Filters) => replaceSearch('/', query({ focus: '' }, next));
  const backToList = () => {
    setThanks(null);
    navigate('/', query());
  };
  /**
   * Der Titel führt zurück auf «alles» — als echtes Neuladen der Seite (#73).
   *
   * Vorher lud er nur die Daten nach; was in Komponenten-Zustand wohnt — etwa
   * ein erzeugter Teilen-Link —, blieb dabei stehen. Das Neuladen räumt alles
   * ab und holt nebenbei den frischen Stand: Genau dort drückt man den Titel,
   * wenn man sehen will, ob jemand etwas Neues eingetragen hat.
   *
   * `#/` ohne Query IST der Ausgangszustand (Liste, keine Filter) — die Kürzel
   * lassen Vorgabewerte ohnehin weg. Auf der Liste ersetzt der Sprung den
   * History-Eintrag (Filterei ist kein Weg, den «zurück» ablaufen soll), von
   * Unterseiten bleibt er einer — wie bisher.
   */
  const goHome = () => {
    if (screen.name === 'liste') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
    } else {
      window.location.hash = '#/';
    }
    window.location.reload();
  };
  // Nach einer Änderung: zurück zur Liste, und reload() holt den frischen Stand.
  const afterChange = (message: string) => {
    setNotice(message);
    reload();
    navigate('/', query());
  };
  const showOnMap = (tipId: string) => navigate('/', query({ view: 'karte', focus: tipId }));

  /**
   * Vom Wunsch in die Tippliste. Ein Ortswunsch filtert auf den Ort (dieselben
   * Schlüssel wie `Tip.placeKey`), ein Landwunsch aufs Land — beides kann die
   * Filterleiste schon, es braucht nur die richtige Zuordnung.
   *
   * Scrollt nach oben, weil der Sprung aus einer weit gescrollten Wunschliste
   * kommen kann — sonst landet man mitten in einer Liste, die man noch nie
   * gesehen hat.
   */
  const zeigeZiel = (zielKey: string) => {
    const { place, country } = zielZuFilter(zielKey);
    navigate('/', query({ view: 'liste', focus: '' }, { ...EMPTY_FILTERS, place, country }));
    window.scrollTo({ top: 0 });
  };

  /**
   * Von einem Tipp zu allen Tipps mit demselben Ort, Land oder Namen (#32).
   *
   * Alle übrigen Filter fallen weg — wer auf «Parma» drückt, will Parma sehen
   * und nicht Parma unter den Kategorien, die zufällig noch angehakt waren.
   * Genau das tut der Sprung von einem Wunsch in die Liste schon.
   *
   * `navigate` und nicht `replaceSearch` wie beim Filtern von Hand: Der Sprung
   * ist einer, kein Herumschieben an Reglern — der Zurück-Knopf soll zurück
   * auf die Liste führen, aus der man gekommen ist.
   */
  const zeigeGefiltert = (nur: Partial<Filters>) => {
    navigate('/', query({ view: 'liste', focus: '' }, { ...EMPTY_FILTERS, ...nur }));
    window.scrollTo({ top: 0 });
  };

  // Das Land kommt beim Ort mit: `placeKey` allein liesse Berlin in Deutschland
  // und Berlin in Maryland zusammenfallen.
  const zeigeOrt = (tip: Tip) => zeigeGefiltert({ place: tip.placeKey, country: tip.country });
  const zeigeLand = (tip: Tip) => zeigeGefiltert({ country: tip.country });

  // Über den normalisierten Schlüssel, nicht über die Schreibweise: Ältere
  // Beiträge tragen den Namen aus dem früheren Freitextfeld, «tim» und «Tim»
  // sind aber dieselbe Person — und `Filters.people` hält ohnehin Schlüssel.
  const zeigePerson = (name: string) => zeigeGefiltert({ people: [personKey(name)] });

  // Nur ohne bereits geladene Daten ist ein Fehler ein Vollbild-Problem — ein
  // gescheiterter Refetch nach dem Speichern soll die App nicht leeren.
  if (error && !data) {
    return (
      <main className="shell">
        <p className="status status--error">Die Tipps konnten nicht geladen werden ({error}).</p>
        <p>
          <button type="button" className="button" onClick={reload}>
            Nochmal versuchen
          </button>
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="shell">
        <p className="status">Lädt…</p>
      </main>
    );
  }

  if (thanks) {
    return (
      <Subpage onHome={goHome}>
        <Thanks repeated={thanks.repeated} onBack={backToList} />
      </Subpage>
    );
  }

  const findTip = (id: string): Tip | undefined => data.tips.find((tip) => tip.id === id);

  // Seiten, die es für einen Gast nicht gibt — erreichbar bleiben sie über die
  // Adresszeile, also braucht es die Meldung. Sonst liefe man in ein Formular,
  // dessen Absenden am Ende 403 ergäbe, oder in eine Wunschliste, die
  // «Gerade sucht niemand Tipps» behauptet, weil der Server keine mitschickt.
  if (nurLesen && GAST_GESPERRT.has(screen.name)) {
    return (
      <Subpage onHome={goHome}>
        <div className="admin">
          <div className="detail__bar">
            <button type="button" className="linkbutton" onClick={backToList}>
              ← Zur Liste
            </button>
          </div>
          <h1 className="form__title">Nur schauen</h1>
          <p className="form__context">
            Diese Seite ist für Gäste zu. Die Tipps kannst du alle lesen — Wünsche, Namen und Fotos
            bleiben in der Runde, und Eintragen braucht ein eigenes Konto. Frag dort nach einem.
          </p>
        </div>
      </Subpage>
    );
  }

  if (screen.name === 'admin') {
    return (
      <Subpage onHome={goHome}>
        <History
          onClose={backToList}
          onEditCategories={() => navigate('/admin/kategorien')}
          onManageUsers={() => navigate('/admin/konten')}
          onChanged={reload}
        />
      </Subpage>
    );
  }

  if (screen.name === 'kategorien') {
    return (
      <Subpage onHome={goHome}>
        <CategoryEditor
          categories={data.categories}
          onClose={() => navigate('/admin')}
          onChanged={reload}
        />
      </Subpage>
    );
  }

  if (screen.name === 'admin-konten') {
    return (
      <Subpage onHome={goHome}>
        <UserAdmin onClose={() => navigate('/admin')} />
      </Subpage>
    );
  }

  if (screen.name === 'konto') {
    return (
      <Subpage onHome={goHome}>
        {/* Nach einem Namenswechsel muss auch der Datenbestand neu geholt
            werden: Der Server liefert die alten Beiträge dann unter dem neuen
            Namen aus, und daran hängen Personen-Filter und die
            «gehört mir»-Erkennung der Formulare. */}
        <Account
          me={me}
          onClose={backToList}
          onChanged={() => {
            reloadMe();
            reload();
          }}
          onVerlauf={() => navigate('/admin')}
          onKategorien={() => navigate('/admin/kategorien')}
          onKonten={() => navigate('/admin/konten')}
        />
      </Subpage>
    );
  }

  if (screen.name === 'feedback') {
    return (
      <Subpage onHome={goHome}>
        <Feedback from={cameFrom} onCancel={backToList} signalChat={me?.signalChat ?? null} />
      </Subpage>
    );
  }

  if (screen.name === 'infos') {
    return (
      <Subpage onHome={goHome}>
        <Infos onClose={backToList} signalChat={me?.signalChat ?? null} />
      </Subpage>
    );
  }

  if (screen.name === 'wuensche') {
    return (
      <Subpage onHome={goHome}>
        <Wuensche
          wuensche={wuensche}
          tips={tips}
          categoriesById={categoriesById}
          meinName={me?.name ?? null}
          istAdmin={me?.admin ?? false}
          zielFilter={new URLSearchParams(route.search).get('z') ?? ''}
          onClose={backToList}
          onAlleOrte={() => navigate('/wuensche')}
          onZielAnsehen={zeigeZiel}
          onTippOeffnen={(tipId) => navigate(`/tipp/${tipId}`)}
          onNeu={() => navigate('/wuensche/neu')}
          onBearbeiten={(wunschId) => {
            navigate(`/wuensche/${wunschId}/bearbeiten`);
            window.scrollTo({ top: 0 });
          }}
          // Der Wunsch reist als `w=` mit und ist im Formular vorausgewählt.
          // Nach oben scrollen, weil der Sprung aus einer weit gescrollten
          // Wunschliste kommt — sonst startet man mitten im Formular.
          onTippHinzufuegen={(id) => {
            navigate('/neu', `w=${encodeURIComponent(id)}`);
            window.scrollTo({ top: 0 });
          }}
          onChanged={reload}
          // Die Seite entscheidet selbst, was sie zeigt: Kreuzchen bei
          // bestätigter Adresse, Hinweis bei ausstehender, sonst das Feld zum
          // Eintragen. null nur für den Gast, der hier ohnehin nicht hinkommt.
          benachrichtigung={
            me && !me.gast
              ? {
                  email: me.email,
                  verifiziert: me.emailVerifiziert,
                  an: me.benachrichtigungWuensche,
                }
              : null
          }
          onMeGeaendert={reloadMe}
        />
      </Subpage>
    );
  }

  if (screen.name === 'wunsch-bearbeiten') {
    const wunsch = wuensche.find((eintrag) => eintrag.id === screen.wunschId);
    // Weg, abgelaufen oder von jemand anderem: Der Server weist es ohnehin ab,
    // aber ein Formular zu zeigen, das nicht speichern kann, wäre unhöflich.
    if (!wunsch) return <NotFound onBack={() => navigate('/wuensche')} onHome={goHome} />;
    return (
      <Subpage onHome={goHome}>
        <WunschForm
          categories={data.categories}
          knownPlaces={knownPlaces}
          bearbeiten={wunsch}
          onCancel={() => navigate('/wuensche')}
          onDone={() => {
            reload();
            navigate('/wuensche');
            window.scrollTo({ top: 0 });
          }}
        />
      </Subpage>
    );
  }

  if (screen.name === 'wunsch-neu') {
    return (
      <Subpage onHome={goHome}>
        <WunschForm
          categories={data.categories}
          knownPlaces={knownPlaces}
          onCancel={() => navigate('/wuensche')}
          // Keine Erfolgsmeldung: Die Notice-Zeile steht nur in der
          // Listenansicht, hier landet man aber auf der Wunschseite — und dort
          // ist der frisch angebrachte Wunsch selbst die beste Bestätigung.
          // Nach oben scrollen muss es trotzdem, sonst steht man mitten in der
          // Liste, wo man das Formular verlassen hat.
          onDone={() => {
            reload();
            navigate('/wuensche');
            window.scrollTo({ top: 0 });
          }}
        />
      </Subpage>
    );
  }

  if (screen.name === 'weg') {
    const tip = findTip(screen.tipId);
    if (!tip) return <NotFound onBack={backToList} onHome={goHome} />;

    // Ganz löschen darf nur, wem der Tipp ganz gehört — und jeder Admin. Hängt
    // auch nur eine fremde Beschreibung daran, bleibt «Gibt’s nicht mehr»;
    // durchgesetzt wird das in functions/api/submit.ts, hier fällt bloss die
    // halbe Auswahl weg. Ohne geladenes `me` wird nichts angeboten: Ein leerer
    // Schlüssel träfe sonst über `every` auch fremde Beiträge.
    const meinKey = searchKey(me?.name ?? '');
    const darfLoeschen =
      (me?.admin ?? false) ||
      (meinKey !== '' && tip.notes.every((note) => searchKey(note.by) === meinKey));

    return (
      <Subpage onHome={goHome}>
        <RemoveTip
          tip={tip}
          darfLoeschen={darfLoeschen}
          onCancel={() => navigate(`/tipp/${tip.id}`, query())}
          onDone={afterChange}
        />
      </Subpage>
    );
  }

  if (screen.name === 'neu') {
    const ausWunsch = new URLSearchParams(route.search).get('w') ?? undefined;
    return (
      <Subpage onHome={goHome}>
        <SubmitForm
          // Ein Wechsel des vorgewählten Wunsches hängt das Formular neu ein —
          // sonst bliebe die Auswahl aus dem ersten Aufruf stehen, weil sie im
          // useState-Startwert steckt.
          key={`neu:${ausWunsch ?? ''}`}
          kind="tipp"
          categories={data.categories}
          knownPlaces={knownPlaces}
          nearbyCoords={knownCoords}
          wuensche={wuensche}
          wunschId={ausWunsch}
          onCancel={ausWunsch ? () => navigate('/wuensche') : backToList}
          onDone={(repeated) => {
            setThanks({ repeated });
            reload();
          }}
        />
      </Subpage>
    );
  }

  if (screen.name === 'ergaenzen' || screen.name === 'korrigieren') {
    const tip = findTip(screen.tipId);
    if (!tip) return <NotFound onBack={backToList} onHome={goHome} />;
    return (
      <Subpage onHome={goHome}>
        <SubmitForm
          kind={screen.name === 'ergaenzen' ? 'ergaenzung' : 'korrektur'}
          categories={data.categories}
          tip={tip}
          userName={me?.name ?? null}
          isAdmin={me?.admin ?? false}
          knownPlaces={knownPlaces}
          nearbyCoords={knownCoords}
          onCancel={() => navigate(`/tipp/${tip.id}`, query())}
          onDone={(repeated) => {
            setThanks({ repeated });
            reload();
          }}
        />
      </Subpage>
    );
  }

  if (screen.name === 'detail') {
    const tip = findTip(screen.tipId);
    if (!tip) return <NotFound onBack={backToList} onHome={goHome} />;
    return (
      <Subpage onHome={goHome}>
        <TipDetail
          tip={tip}
          categoriesById={categoriesById}
          wuensche={wuensche.filter((wunsch) => wunsch.tipps?.includes(tip.id))}
          nurLesen={nurLesen}
          onWunschAnsehen={() => navigate('/wuensche')}
          onClose={backToList}
          onShowPlace={() => zeigeOrt(tip)}
          onShowCountry={() => zeigeLand(tip)}
          onShowPerson={zeigePerson}
          onShowOnMap={() => showOnMap(tip.id)}
          onAddNote={() => navigate(`/tipp/${tip.id}/ergaenzen`, query())}
          onSuggestFix={() => navigate(`/tipp/${tip.id}/korrigieren`, query())}
          onRemove={() => navigate(`/tipp/${tip.id}/weg`, query())}
        />
      </Subpage>
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead__row">
          {/* Der Titel ist der Weg zurück auf «alles». Wer sich in Filtern
              verlaufen hat, drückt erfahrungsgemäss zuerst dorthin. */}
          <h1>
            <button
              type="button"
              className="hometitle"
              onClick={goHome}
              title="Alle Tipps zeigen und neu laden"
            >
              Hett öpper Tipps?
            </button>
          </h1>
          <div className="masthead__actions">
            {/* Eine Rückmeldung schreibt ein GitHub-Issue — auch das bleibt dem
                Gäste-Zugang verwehrt, sonst wäre «nur lesen» nur halb wahr. */}
            {!nurLesen && (
              <button
                type="button"
                className="pillbutton"
                onClick={() => navigate('/feedback')}
                title="Etwas kaputt oder unklar? Sag Bescheid."
                // Auf schmalen Geräten bleibt nur das Symbol übrig — ohne
                // ausdrücklichen Namen hiesse der Knopf dann «Sprechblase».
                aria-label="Rückmeldung geben"
              >
                <span aria-hidden="true">💬</span> Rückmeldung
              </button>
            )}
            <button
              type="button"
              className="pillbutton"
              onClick={() => navigate('/infos')}
              title="Guidelines und was das hier ist."
              aria-label="Infos"
            >
              <span aria-hidden="true">ℹ️</span> Infos
            </button>
            {/* Früher stand «Konto» in einem Footer unter der ganzen Liste —
                je mehr Tipps, desto weiter weg. Auch für Gäste: Abmelden geht
                nur dort. */}
            <button
              type="button"
              className="pillbutton"
              onClick={() => navigate('/konto')}
              title="Konto und Einstellungen."
              aria-label="Konto"
            >
              <span aria-hidden="true">👤</span> Konto
            </button>
          </div>
        </div>
        {/* Die Frage aus dem Titel, konkret gemacht: Wer gerade Tipps sucht,
            steht direkt beim Titel — dort schaut man hin, bevor man zu filtern
            anfängt. */}
        {/* Für Gäste gar nicht: Der Server schickt ihnen keine Wünsche, die
            Zeile stünde also dauerhaft auf «Gerade sucht niemand Tipps» — eine
            Behauptung über die Runde, die schlicht nicht stimmt. */}
        {!nurLesen && (
          <WunschZeile
            wuensche={offeneWuensche}
            // `z=` statt `o=`: Der Schlüssel trägt sein Präfix («o:» für einen
            // Ort, «l:» für ein Land) und ist damit nicht mehr derselbe Wert wie
            // der Ortsfilter der Tippliste.
            onZiel={(zielKey) => navigate('/wuensche', `z=${encodeURIComponent(zielKey)}`)}
            onAlle={() => navigate('/wuensche')}
          />
        )}
        <p className="masthead__sub">
          {plural(data.tips.length, 'Tipp', 'Tipps')} von euch, aus{' '}
          {plural(countryOptions(data.tips).length, 'Land', 'Ländern')}
        </p>
      </header>

      {notice && (
        <p className="admin__done" role="status">
          {notice}
        </p>
      )}

      {me?.mustChangePassword && (
        <p className="admin__done" role="status">
          Du bist noch mit dem Startpasswort unterwegs —{' '}
          <button type="button" className="linkbutton" onClick={() => navigate('/konto')}>
            bitte ein eigenes wählen
          </button>
          .
        </p>
      )}

      {/* Warum die Knöpfe fehlen. Ohne diese Zeile sieht die App für einen Gast
          bloss kaputt aus — ein Fehler beim Absenden erklärt sich später von
          selbst, ein fehlender Knopf nie. */}
      {nurLesen && (
        <p className="admin__done" role="status">
          Du schaust als Gast: Tipps lesen ja, eintragen nein — und Wünsche, Namen und Fotos
          bleiben in der Runde. Für einen eigenen Zugang frag dort nach.
        </p>
      )}

      <FilterBar
        categories={data.categories}
        categoryCounts={categoryCounts(withoutCategory)}
        countries={countryOptions(withoutCountry)}
        places={placeOptions(withoutPlace)}
        people={personOptions(withoutPeople)}
        suchEintraege={suchEintraege}
        volltextTreffer={volltextTreffer}
        filters={filters}
        onChange={setFilters}
        onOpenTip={openTip}
        sort={viewState.sort}
        onSortChange={(sort) => replaceSearch('/', query({ sort }))}
        closedCount={closedCount}
      />

      <div className="viewbar">
        <div className="viewbar__info">
          <p className="resultcount" role="status">
            {visible.length === data.tips.length
              ? plural(visible.length, 'Tipp', 'Tipps')
              : `${visible.length} von ${plural(data.tips.length, 'Tipp', 'Tipps')}`}
            {umkreisHinweis ? ` — ${umkreisHinweis}` : ''}
          </p>
          {/* Genau das, was die Zeile daneben zählt, wird geteilt. Für Gäste
              nicht — reine Höflichkeit, abgewiesen wird im Gate. Und nicht bei
              einer leeren Liste: Ein Link auf nichts ist kein Angebot. */}
          {!nurLesen && visible.length > 0 && (
            <TeilenKnopf tippIds={visible.map((tip) => tip.id)} />
          )}
        </div>
        <div className="viewswitch" role="group" aria-label="Ansicht">
          <button
            type="button"
            aria-pressed={viewState.view === 'liste'}
            onClick={() => replaceSearch('/', query({ view: 'liste' }))}
          >
            Liste
          </button>
          <button
            type="button"
            aria-pressed={viewState.view === 'karte'}
            onClick={() => replaceSearch('/', query({ view: 'karte' }))}
          >
            Karte
          </button>
        </div>
      </div>

      {viewState.view === 'karte' ? (
        <>
          <Suspense fallback={<p className="status">Karte lädt…</p>}>
            <MapView
              tips={mapTips}
              categoriesById={categoriesById}
              focusId={viewState.focus}
              onOpen={openTip}
            />
          </Suspense>
          {withoutCoords.length > 0 && (
            <p className="mapnote">
              {withoutCoords.length}{' '}
              {withoutCoords.length === 1 ? 'Tipp hat' : 'Tipps haben'} noch keine Position und
              {withoutCoords.length === 1 ? ' fehlt' : ' fehlen'} auf der Karte:{' '}
              {withoutCoords.map((tip, index) => (
                <span key={tip.id}>
                  {index > 0 && ', '}
                  <button type="button" className="linkbutton" onClick={() => openTip(tip.id)}>
                    {tip.name}
                  </button>
                </span>
              ))}
            </p>
          )}
        </>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>Nichts gefunden.</p>
          {!isEmpty(filters) && (
            <button type="button" className="button" onClick={() => setFilters(EMPTY_FILTERS)}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      ) : (
        <ul className="cards">
          {visible.map((tip) => (
            <TipCard
              key={tip.id}
              tip={tip}
              categoriesById={categoriesById}
              personFilter={filters.people}
              onOpen={() => openTip(tip.id)}
              onShowPlace={() => zeigeOrt(tip)}
              onShowCountry={() => zeigeLand(tip)}
              onShowPerson={zeigePerson}
            />
          ))}
        </ul>
      )}

      {!nurLesen && (
        <button type="button" className="fab" onClick={() => navigate('/neu')}>
          <span aria-hidden="true">＋</span> Tipp hinzufügen
        </button>
      )}

      {/* Konto und die Admin-Wege wohnen seit dem Kopfzeilen-Knopf auf der
          Konto-Seite — ein Footer unter der ganzen Liste war je nach Anzahl
          Tipps eine halbe Ewigkeit Scrollen entfernt. Der Signal-Hinweis (#62)
          darf hier trotzdem stehen: Er ist keine Navigation, die jemand sucht,
          sondern eine Einladung für die, die ohnehin bis unten lesen. */}
      {me?.signalChat && (
        <footer className="sitefoot">
          <a href={me.signalChat} target="_blank" rel="noopener">
            Bock mitzureden? Komm in den Signal-Chat.
          </a>
        </footer>
      )}

      {/* Dieselbe Einladung einmalig als Overlay, samt der kurzen Liste dessen,
          was neu ist — der Hinweis merkt sich selbst, dass er dran war. Nur auf
          der Liste: Wer über einen geteilten Tipp-Link hereinkommt, soll nicht
          als Erstes ein Overlay über dem Tipp sehen, und weil der Merker erst
          beim ZEIGEN gesetzt wird, geht dabei nichts verloren — er wartet
          einfach, bis jemand auf der Liste landet. */}
      {me?.signalChat && <SignalHinweis url={me.signalChat} onKonto={() => navigate('/konto')} />}
    </main>
  );
}

/**
 * Rahmen für alles ausser der Liste. Der Titel steht auch hier oben — er ist
 * auf jeder Seite der Weg zurück auf «alles», nicht nur auf der Startseite.
 */
function Subpage({ onHome, children }: { onHome: () => void; children: ReactNode }) {
  return (
    <main className="shell">
      <div className="pagehead">
        <button
          type="button"
          className="hometitle"
          onClick={onHome}
          title="Alle Tipps zeigen und neu laden"
        >
          Hett öpper Tipps?
        </button>
      </div>
      {children}
    </main>
  );
}

function NotFound({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  return (
    <Subpage onHome={onHome}>
      <p className="status">Diesen Tipp gibt es nicht (mehr).</p>
      <div className="empty">
        <button type="button" className="button" onClick={onBack}>
          Zur Liste
        </button>
      </div>
    </Subpage>
  );
}
