import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { searchKey } from '../../shared/normalize.mjs';
import { ApiError, submit } from '../lib/api';
import { formatMonth } from '../lib/dates';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { reverseGeocode } from '../lib/geo';
import { formatBytes, PhotoError, resizePhoto } from '../lib/image';
import { leseOrtsangabe } from '../lib/placeLink';
import { wunschZielLabel } from '../lib/wunschZiel';
import type { ResizedPhoto } from '../lib/image';
import type { Category, Coords, Note, Tip, Wunsch } from '../lib/types';
import CountryPick from './CountryPick';

/** Zieht Leaflet erst herunter, wenn jemand wirklich einen Ort setzen will. */
const PlacePicker = lazy(() => import('./PlacePicker'));

export type SubmitKind = 'tipp' | 'ergaenzung' | 'korrektur';

interface Props {
  kind: SubmitKind;
  categories: Category[];
  /** Bei Ergänzung und Korrektur der betroffene Tipp. */
  tip?: Tip;
  /** Name des angemeldeten Kontos — entscheidet, welche Beschreibungen einem gehören. */
  userName?: string | null;
  /** Admins dürfen in einer Korrektur auch fremde Beschreibungen ändern. */
  isAdmin?: boolean;
  /** Bereits vorhandene Orte, für die Vorschlagsliste. */
  knownPlaces: { label: string; country: string }[];
  /** Koordinaten anderer Tipps — damit die Ortswahl nicht auf der Weltkarte startet. */
  nearbyCoords?: Coords[];
  /** Offene Wünsche, denen der neue Tipp zugeordnet werden kann. Nur bei kind='tipp'. */
  wuensche?: Wunsch[];
  /** Vorausgewählter Wunsch — gesetzt, wenn man von der Wunschseite herkommt. */
  wunschId?: string;
  onCancel: () => void;
  onDone: (repeated: boolean) => void;
}

/** Was am eigenen Beitrag geändert werden soll. */
interface NoteEdit {
  text: string;
  photo: 'behalten' | 'weg';
}

interface FormValues {
  name: string;
  country: string;
  place: string;
  categories: string[];
  address: string;
  link: string;
  closed: boolean;
  text: string;
  /**
   * Der Punkt auf der Karte. Gehört in den Formularzustand, damit eine Korrektur
   * ihn mitschickt — `mergeTip` auf dem Server baut den Tipp aus dem Gesendeten
   * neu auf, was nicht mitkommt, ist danach weg.
   */
  coords: Coords | null;
  /**
   * Änderungen an eigenen Beschreibungen, nach Notiz-ID — nur bei einer
   * Korrektur gefüllt. Ein NEUES Foto steht bewusst nicht hier drin: Base64
   * gehört nicht in den localStorage, es liegt wie beim neuen Tipp im
   * React-State und ist nach einem Neuladen eben weg.
   */
  notes: Record<string, NoteEdit>;
}

// Der Vorgang heisst innen weiterhin «ergaenzung» — so steht er in der
// Datenbank, im Verlauf und in den Adressen. Nur die Beschriftung sagt jetzt,
// worum es tatsächlich geht (siehe TipDetail).
const TITLES: Record<SubmitKind, string> = {
  tipp: 'Neuer Tipp',
  ergaenzung: 'Ich war auch da',
  korrektur: 'Etwas korrigieren',
};

const SUBMIT_LABELS: Record<SubmitKind, string> = {
  tipp: 'Tipp speichern',
  ergaenzung: 'Speichern',
  korrektur: 'Korrektur speichern',
};

export default function SubmitForm({
  kind,
  categories,
  tip,
  userName,
  isAdmin = false,
  knownPlaces,
  nearbyCoords,
  wuensche = [],
  wunschId,
  onCancel,
  onDone,
}: Props) {
  const draftName = `${kind}:${tip?.id ?? 'neu'}`;

  /** Gehört diese Beschreibung mir? Über `searchKey`, siehe `editableNotes`. */
  const istEigene = (note: Note) => searchKey(note.by) === searchKey(userName ?? '');

  /**
   * Die Beschreibungen, die in dieser Korrektur mitgeändert werden dürfen: die
   * eigenen — und für Admins alle, damit sie dasselbe können wie Autor*innen.
   *
   * Verglichen wird über `searchKey`, weil ältere Beiträge die Schreibweise aus
   * dem alten Freitext-Namensfeld tragen; der Server prüft dasselbe nochmal
   * gegen den gespeicherten Stand — diese Liste ist Bequemlichkeit, keine
   * Zugangskontrolle.
   */
  const editableNotes = useMemo<Note[]>(() => {
    if (kind !== 'korrektur' || !userName) return [];
    const notes = tip?.notes ?? [];
    if (isAdmin) return notes;
    const mine = searchKey(userName);
    return notes.filter((note) => searchKey(note.by) === mine);
  }, [kind, tip, userName, isAdmin]);

  const initial = useMemo<FormValues>(
    () => ({
      name: tip?.name ?? '',
      // Kein Vorgabeland. «Schweiz» stand hier, bis das Feld ein Auswahlrad war
      // und irgendetwas darin stehen musste; getippt wird es schneller, als man
      // eine falsche Vorgabe bemerkt — und eine unbemerkte ist der stillste
      // Fehler im Formular.
      country: tip?.country ?? '',
      place: tip?.place ?? '',
      categories: tip?.categories ?? [],
      address: tip?.address ?? '',
      link: tip?.link ?? '',
      closed: tip?.closed ?? false,
      text: '',
      coords: tip?.coords ?? null,
      notes: Object.fromEntries(
        editableNotes.map((note) => [note.id, { text: note.text, photo: 'behalten' as const }]),
      ),
    }),
    [tip, editableNotes],
  );

  const [draft, setDraft] = useState(() => loadDraft<FormValues>(draftName, initial));
  const values = draft.values;

  /**
   * Wünsche, denen der Tipp zugeordnet wird.
   *
   * Bewusst NICHT im Entwurf: Der Entwurf überlebt Tage, ein Wunsch kann in der
   * Zwischenzeit abgelaufen sein — dann stünde beim Weiterschreiben ein Häkchen
   * bei etwas, das es nicht mehr gibt. Die Vorauswahl von der Wunschseite ist
   * genau deshalb auch nur der Startwert.
   */
  const [gewaehlteWuensche, setGewaehlteWuensche] = useState<string[]>(() =>
    wunschId ? [wunschId] : [],
  );

  // Nur offene Wünsche zur Auswahl: Ein erfüllter braucht keine Tipps mehr.
  // Abgelaufene hat der Server schon weggelassen.
  const offeneWuensche = useMemo(
    () => (kind === 'tipp' ? wuensche.filter((wunsch) => !wunsch.erfuellt) : []),
    [kind, wuensche],
  );

  const [photo, setPhoto] = useState<ResizedPhoto | null>(null);
  /** Neu gewählte Fotos für eigene Beschreibungen, nach Notiz-ID. */
  const [notePhotos, setNotePhotos] = useState<Record<string, ResizedPhoto>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteInfo, setPasteInfo] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pickerStart, setPickerStart] = useState<{
    coords: Coords | null;
    suchtext: string | null;
    sofortSuchen: boolean;
  }>({ coords: null, suchtext: null, sofortSuchen: false });
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveDraft(draftName, draft), [draftName, draft]);

  /**
   * Wer das Formular verlässt, ohne zu speichern, fängt beim nächsten Mal von
   * vorn an — «Abbrechen», der Seitentitel und der Zurück-Knopf werfen den
   * Entwurf weg.
   *
   * Der Entwurf ist für den anderen Fall da, und der bleibt erhalten: fünf
   * Sätze getippt, gesendet, das WLAN in der Bar ist weg. Dann scheitert das
   * Senden, das Formular bleibt stehen und der Text ist noch da; und wer die
   * Seite neu lädt oder den Tab schliesst, findet ihn wieder — ein Neuladen
   * räumt React nicht ab, dieses Aufräumen läuft also nur beim bewussten
   * Weggehen.
   *
   * Ohne das trug der nächste neue Tipp den halben vorigen mit sich herum,
   * Punkt auf der Karte inklusive — und der Punkt fällt am wenigsten auf.
   */
  useEffect(() => () => clearDraft(draftName), [draftName]);

  // Der Object-URL der Vorschau hält sonst Speicher fest, bis der Tab zugeht.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  /**
   * Dasselbe für die Fotos der eigenen Beschreibungen — aber erst beim
   * Verlassen des Formulars und über einen Ref: Ein Effekt mit `[notePhotos]`
   * würde beim Hinzufügen eines zweiten Fotos die Vorschau des ersten
   * freigeben, das noch auf dem Bildschirm steht. Beim Ersetzen und Verwerfen
   * gibt `stageNotePhoto` gezielt frei.
   */
  const notePhotosRef = useRef(notePhotos);
  useEffect(() => { notePhotosRef.current = notePhotos; }, [notePhotos]);
  useEffect(
    () => () => {
      for (const staged of Object.values(notePhotosRef.current)) URL.revokeObjectURL(staged.previewUrl);
    },
    [],
  );

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft((current) => ({ ...current, values: { ...current.values, [field]: value } }));

  /**
   * Ein älterer Entwurf im localStorage kennt das Feld `notes` noch nicht, und
   * eine Beschreibung kann seit dem Speichern dazugekommen sein — deshalb
   * immer mit dem gespeicherten Stand als Rückfallebene.
   */
  const noteEdit = (note: Note): NoteEdit =>
    values.notes?.[note.id] ?? { text: note.text, photo: 'behalten' };

  const setNoteEdit = (note: Note, patch: Partial<NoteEdit>) =>
    setDraft((current) => ({
      ...current,
      values: {
        ...current.values,
        notes: {
          ...current.values.notes,
          [note.id]: {
            ...(current.values.notes?.[note.id] ?? { text: note.text, photo: 'behalten' as const }),
            ...patch,
          },
        },
      },
    }));

  const wantsTipFields = kind === 'tipp' || kind === 'korrektur';
  const wantsNote = kind === 'tipp' || kind === 'ergaenzung';

  /** Stehen hier nur eigene Beiträge? Sonst redigiert gerade ein Admin. */
  const nurEigene = editableNotes.every(istEigene);

  const selectableCategories = categories.filter(
    (category) => category.active || values.categories.includes(category.id),
  );

  const placeSuggestions = useMemo(
    () =>
      [...new Set(knownPlaces.filter((p) => p.country === values.country).map((p) => p.label))].sort(
        (a, b) => a.localeCompare(b, 'de'),
      ),
    [knownPlaces, values.country],
  );

  const toggleCategory = (id: string) =>
    set(
      'categories',
      values.categories.includes(id)
        ? values.categories.filter((c) => c !== id)
        : [...values.categories, id],
    );

  /** Verkleinert im Browser; `null` heisst «hat nicht geklappt», die Meldung steht dann im Formular. */
  async function readPhoto(file: File | undefined): Promise<ResizedPhoto | null> {
    if (!file) return null;
    setPhotoBusy(true);
    setError(null);
    try {
      return await resizePhoto(file);
    } catch (cause) {
      setError(cause instanceof PhotoError ? cause.message : 'Das Foto konnte nicht gelesen werden.');
      return null;
    } finally {
      setPhotoBusy(false);
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const next = await readPhoto(file);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(next);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function chooseNotePhoto(noteId: string, file: File | undefined, input: HTMLInputElement) {
    const next = await readPhoto(file);
    // Damit dieselbe Datei nochmal gewählt werden kann — sonst feuert `change` nicht.
    input.value = '';
    if (next) stageNotePhoto(noteId, next);
  }

  function stageNotePhoto(noteId: string, next: ResizedPhoto | null) {
    const previous = notePhotos[noteId];
    if (previous) URL.revokeObjectURL(previous.previewUrl);
    setNotePhotos((current) => {
      const rest = { ...current };
      if (next) rest[noteId] = next;
      else delete rest[noteId];
      return rest;
    });
  }

  /**
   * Exakte Koordinaten (`!3d`/`!4d` und Verwandte) werden direkt übernommen —
   * der Punkt ist bei Google schon bestätigt, ein zweites Bestätigen wäre nur
   * ein Klick mehr (Entscheid des Besitzers). Er bleibt im Formular sichtbar
   * und lässt sich dort ändern; das ist das Sicherheitsnetz, falls Google sein
   * Format ändert. Nur Ungefähres (Kartenmitte) und Koordinatenloses geht
   * weiterhin in die Ortswahl.
   */
  async function readLink(eingabe: string) {
    const text = eingabe.trim();
    if (!text) return;

    setPasteBusy(true);
    setPasteError(null);
    setPasteInfo(null);

    try {
      const angabe = await leseOrtsangabe(text);

      if (angabe.art === 'unbrauchbar') {
        setPasteError(angabe.grund ?? 'Aus diesem Link kann die App nichts lesen.');
        return;
      }
      if (angabe.art === 'unbekannt') {
        setPasteError('Das sieht nicht nach einem Link oder nach Koordinaten aus.');
        return;
      }

      // Namen und Link nur füllen, wo noch nichts steht. Ins Link-Feld kommt
      // der EINGEFÜGTE Link, nicht der aufgelöste: Der Kurzlink ist das, was
      // geteilt wurde — die lange Google-URL wäre dreimal so lang und trüge
      // Tracking-Parameter mit. Das Feld bleibt normal änderbar.
      const istUrl = /^https?:\/\//i.test(text);
      setDraft((current) => ({
        ...current,
        values: {
          ...current.values,
          name: current.values.name || angabe.name || '',
          link: current.values.link || (istUrl ? text : ''),
          coords: angabe.genauigkeit === 'exakt' ? (angabe.coords ?? current.values.coords) : current.values.coords,
        },
      }));
      setPasteValue('');

      if (angabe.genauigkeit === 'exakt' && angabe.coords) {
        setPasteInfo('Punkt aus dem Link übernommen — der Tipp erscheint damit auf der Karte.');
        void fillPlaceFields(angabe.coords);
        return;
      }

      // Ohne Koordinaten, aber mit Text: Die Ortswahl schlägt ihn selbst nach.
      // Nur das Suchfeld vorzufüllen genügte nicht — das Fadenkreuz blieb auf
      // dem zuletzt benutzten Ausschnitt stehen, und wer den Punkt dann nahm,
      // trug den Ort aus Hamburg in Zürich ein.
      const suchtext = angabe.suchtext ?? angabe.name;
      setPickerStart({
        coords: angabe.coords,
        suchtext,
        sofortSuchen: !angabe.coords && Boolean(suchtext),
      });
      setPickerOpen(true);
      setPasteInfo(
        angabe.coords
          ? 'Nur die Kartenmitte gefunden. Bitte auf der Karte genau setzen.'
          : suchtext
            ? 'Keine Koordinaten im Link — die App sucht den Ort selbst.'
            // Kein Punkt UND kein Suchtext: Dann darf hier nicht stehen, es
            // werde etwas gesucht — es gibt nichts zu suchen.
            : 'Aus dem Link war nichts Genaues zu holen. Bitte den Punkt auf der Karte setzen.',
      );
    } catch (cause) {
      setPasteError(cause instanceof ApiError ? cause.message : 'Der Link liess sich nicht lesen.');
    } finally {
      setPasteBusy(false);
    }
  }

  /**
   * Ort, Land und Adresse aus dem Punkt herleiten — eine Rückwärtssuche, nur
   * für leere Felder. Beim Land war das einmal anders: Solange «CH» als Vorgabe
   * im Feld stand, durfte die Suche sie überschreiben, weil niemand sie gewählt
   * hatte. Ohne Vorgabe heisst leer wieder «noch nichts entschieden» und
   * ausgefüllt «so gewollt» — die Ausnahme braucht es nicht mehr.
   *
   * Schlägt die Suche fehl, fehlt nur Tipparbeit — der Punkt steht schon.
   */
  async function fillPlaceFields(coords: Coords) {
    try {
      const treffer = await reverseGeocode(coords);
      if (!treffer?.city && !treffer?.street) return;
      setDraft((current) => {
        const v = current.values;
        const placeUntouched = !v.place.trim();
        return {
          ...current,
          values: {
            ...v,
            place: placeUntouched ? (treffer.city ?? v.place) : v.place,
            country: v.country || (treffer.countrycode ?? ''),
            address: v.address || [treffer.street, treffer.housenumber].filter(Boolean).join(' '),
          },
        };
      });
      setPasteInfo('Punkt übernommen — Ort und Adresse ergänzt, wo noch nichts stand.');
    } catch {
      // Punkt steht — die Felder bleiben Handarbeit.
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();

    // Die übrigen Pflichtfelder erledigt der Browser über `required`. Chips
    // kennt er nicht — ohne diese Prüfung führe der Weg zur Erkenntnis
    // «Kategorie fehlt» einmal quer übers Netz und zurück.
    if (wantsTipFields && values.categories.length === 0) {
      setError('Bitte mindestens eine Kategorie auswählen.');
      setRetryable(false);
      return;
    }

    setBusy(true);
    setError(null);
    setRetryable(false);

    const payload: Record<string, unknown> = {
      kind,
      idempotencyKey: draft.key,
      ...(tip ? { tipId: tip.id } : {}),
    };

    if (wantsTipFields) {
      payload.tip = {
        name: values.name,
        country: values.country,
        place: values.place,
        categories: values.categories,
        address: values.address || undefined,
        link: values.link || undefined,
        coords: values.coords ?? undefined,
        closed: kind === 'korrektur' ? values.closed : false,
      };
    }

    // Abgelaufene Wünsche übergeht der Server stillschweigend — er filtert
    // gegen den echten Stand, nicht gegen den, den dieses Formular kannte.
    if (kind === 'tipp' && gewaehlteWuensche.length > 0) {
      payload.wunschIds = gewaehlteWuensche;
    }

    // Nur wirklich Geändertes mitschicken: Ein unveränderter Text soll keinen
    // Eintrag «geändert» im Verlauf erzeugen.
    if (kind === 'korrektur') {
      const edits = editableNotes.flatMap((note) => {
        const edit = noteEdit(note);
        const staged = notePhotos[note.id];
        const photoWeg = !staged && edit.photo === 'weg' && Boolean(note.photo);
        if (edit.text.trim() === note.text && !staged && !photoWeg) return [];
        return [
          {
            id: note.id,
            text: edit.text,
            // Fehlt das Feld, bleibt das bisherige Foto stehen; `null` entfernt es.
            ...(staged
              ? { photo: { base64: staged.base64, ext: staged.ext } }
              : photoWeg
                ? { photo: null }
                : {}),
          },
        ];
      });
      if (edits.length > 0) payload.notes = edits;
    }

    // Wer schreibt, weiss der Server aus der Anmeldung — ein Namensfeld
    // braucht es seit den persönlichen Konten nicht mehr.
    if (wantsNote) {
      payload.note = {
        text: values.text,
        ...(photo ? { photo: { base64: photo.base64, ext: photo.ext } } : {}),
      };
    }

    try {
      const result = await submit(payload);
      clearDraft(draftName);
      onDone(result.repeated);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setRetryable(cause.isRetryable);
      } else {
        setError('Das hat nicht geklappt.');
        setRetryable(true);
      }
      setBusy(false);
    }
  }

  return (
    <>
      {/* Als Overlay über dem Formular, nicht als eigene Route: Ein
          Routenwechsel würde dieses Formular aushängen und ein bereits
          verkleinertes Foto verlieren — das liegt im React-State. */}
      {pickerOpen && (
        <Suspense fallback={<div className="picker picker--loading">Karte lädt…</div>}>
          <PlacePicker
            initial={pickerStart.coords ?? values.coords}
            nearby={nearbyCoords}
            suggestion={pickerStart.suchtext ?? [values.name, values.place].filter(Boolean).join(', ')}
            sofortSuchen={pickerStart.sofortSuchen}
            onCancel={() => {
              setPickerOpen(false);
              setPickerStart({ coords: null, suchtext: null, sofortSuchen: false });
            }}
            onPick={(result) => {
              setPickerOpen(false);
              // Der Link ist damit abgearbeitet. Bliebe das stehen, suchte ein
              // späteres «Ändern» erneut von selbst und schöbe den Punkt weg,
              // den man gerade von Hand justiert hat.
              setPickerStart({ coords: null, suchtext: null, sofortSuchen: false });
              setDraft((current) => {
                const v = current.values;
                // Leere Felder mitfüllen, aber nie Getipptes überschreiben —
                // beim Land dieselbe Regel wie in `fillPlaceFields`.
                const placeUntouched = !v.place.trim();
                return {
                  ...current,
                  values: {
                    ...v,
                    coords: result.coords,
                    address: v.address || result.address || '',
                    place: placeUntouched ? (result.city ?? v.place) : v.place,
                    country: v.country || (result.countrycode ?? ''),
                  },
                };
              });
            }}
          />
        </Suspense>
      )}

      <form className="form" onSubmit={send}>
        <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onCancel}>
          ← Abbrechen
        </button>
      </div>

      <h1 className="form__title">{TITLES[kind]}</h1>
      {tip && <p className="form__context">{tip.name}, {tip.place}</p>}

      {wantsTipFields && (
        <>
          <div className="paste">
            <label className="field">
              <span>Link einfügen <em>spart Tipparbeit</em></span>
              <input
                type="text"
                inputMode="url"
                value={pasteValue}
                onChange={(event) => setPasteValue(event.target.value)}
                onPaste={(event) => {
                  const text = event.clipboardData.getData('text');
                  if (text) {
                    event.preventDefault();
                    setPasteValue(text);
                    void readLink(text);
                  }
                }}
                placeholder="Google Maps, Apple Karten, OSM oder Koordinaten"
              />
            </label>
            <div className="paste__row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void readLink(pasteValue)}
                disabled={pasteBusy || !pasteValue.trim()}
              >
                {pasteBusy ? 'Wird gelesen…' : 'Auslesen'}
              </button>
              {pasteInfo && <p className="paste__info">{pasteInfo}</p>}
            </div>
            {pasteError && <p className="form__error" role="alert">{pasteError}</p>}
          </div>

          <label className="field">
            <span>Name</span>
            <input
              required
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="Wie heisst der Ort?"
              maxLength={120}
            />
          </label>

          <div className="field-row">
            <CountryPick value={values.country} onChange={(code) => set('country', code)} />

            <label className="field">
              <span>Ort</span>
              <input
                required
                list="orte"
                value={values.place}
                onChange={(event) => set('place', event.target.value)}
                placeholder="Stadt oder Dorf"
                maxLength={80}
              />
              <datalist id="orte">
                {placeSuggestions.map((place) => (
                  <option key={place} value={place} />
                ))}
              </datalist>
            </label>
          </div>

          <fieldset className="field">
            <legend>Kategorien — mehrere möglich</legend>
            <div className="form__chips">
              {selectableCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="chip"
                  style={{ '--chip-color': category.color } as React.CSSProperties}
                  aria-pressed={values.categories.includes(category.id)}
                  onClick={() => toggleCategory(category.id)}
                >
                  <span aria-hidden="true">{category.emoji}</span> {category.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <span className="field__label">Punkt auf der Karte <em>optional</em></span>
            {values.coords ? (
              <div className="coordrow">
                <span className="coordrow__value">
                  {values.coords.lat.toFixed(5)}, {values.coords.lng.toFixed(5)}
                </span>
                <button type="button" className="linkbutton" onClick={() => setPickerOpen(true)}>
                  Ändern
                </button>
                <button type="button" className="linkbutton" onClick={() => set('coords', null)}>
                  Entfernen
                </button>
              </div>
            ) : (
              <button type="button" className="button button--ghost" onClick={() => setPickerOpen(true)}>
                Auf der Karte setzen
              </button>
            )}
            <small className="field__hint">
              Ohne Punkt erscheint der Tipp nicht auf der Karte — der Karten-Knopf sucht dann nur
              nach dem Namen.
            </small>
          </div>

          <label className="field">
            <span>Adresse <em>optional</em></span>
            <input
              value={values.address}
              onChange={(event) => set('address', event.target.value)}
              placeholder="Strasse und Nummer"
              maxLength={200}
            />
          </label>

          <label className="field">
            <span>Link <em>optional</em></span>
            <input
              type="url"
              inputMode="url"
              value={values.link}
              onChange={(event) => set('link', event.target.value)}
              placeholder="https://…"
              maxLength={500}
            />
          </label>

          {kind === 'korrektur' && (
            <label className="toggle toggle--block">
              <input
                type="checkbox"
                checked={values.closed}
                onChange={(event) => set('closed', event.target.checked)}
              />
              Gibt&rsquo;s nicht mehr
            </label>
          )}
        </>
      )}

      {/* Der eigene Beitrag: Ohne das war ein Tippfehler nur zu beheben, indem
          man den ganzen Tipp löschte — samt der Beiträge aller anderen. Admins
          sehen hier auch die fremden; der Server prüft das nochmal. */}
      {kind === 'korrektur' && editableNotes.length > 0 && (
        <div className="ownnotes">
          <h2 className="ownnotes__title">
            {nurEigene ? (editableNotes.length === 1 ? 'Dein Beitrag' : 'Deine Beiträge') : 'Beiträge'}
          </h2>
          {/* Nur wenn tatsächlich fremde dabei sind — sonst stünde bei jeder
              eigenen Korrektur ein Hinweis über etwas, das gar nicht passiert. */}
          {!nurEigene && (
            <p className="ownnotes__hint">
              Als Admin kannst du hier auch fremde Beiträge ändern. Wer sie geschrieben hat, bleibt
              stehen — dass du sie angefasst hast, steht im Verlauf.
            </p>
          )}
          {editableNotes.map((note) => {
            const edit = noteEdit(note);
            const staged = notePhotos[note.id];
            const eigene = istEigene(note);
            return (
              <div key={note.id} className="ownnote">
                <label className="field">
                  <span>
                    Beschreibung{' '}
                    {/* Stehen fremde Beiträge daneben, muss an jedem stehen, wem
                        er gehört — auch am eigenen, sonst rät man beim Lesen. */}
                    {!nurEigene ? (
                      <em>
                        von {eigene ? 'dir' : note.by}, {formatMonth(note.added)}
                      </em>
                    ) : (
                      editableNotes.length > 1 && <em>von {formatMonth(note.added)}</em>
                    )}
                  </span>
                  <textarea
                    required
                    rows={6}
                    value={edit.text}
                    onChange={(event) => setNoteEdit(note, { text: event.target.value })}
                    maxLength={4000}
                  />
                  <small className="field__hint">{edit.text.length} von 4000 Zeichen</small>
                </label>

                <div className="field">
                  <span className="field__label">Foto <em>optional</em></span>
                  {staged ? (
                    <div className="photo-preview">
                      <img src={staged.previewUrl} alt="Vorschau" />
                      <div>
                        <p>{formatBytes(staged.bytes)} · {staged.ext.toUpperCase()}</p>
                        <button
                          type="button"
                          className="linkbutton"
                          onClick={() => stageNotePhoto(note.id, null)}
                        >
                          Doch nicht
                        </button>
                      </div>
                    </div>
                  ) : note.photo && edit.photo === 'behalten' ? (
                    <div className="photo-preview">
                      <img
                        src={`/photos/${tip?.id}/${note.photo}`}
                        alt={eigene ? 'Dein bisheriges Foto' : `Bisheriges Foto von ${note.by}`}
                      />
                      <div>
                        <p>Bisheriges Foto</p>
                        <button
                          type="button"
                          className="linkbutton"
                          onClick={() => setNoteEdit(note, { photo: 'weg' })}
                        >
                          Entfernen
                        </button>
                      </div>
                    </div>
                  ) : note.photo ? (
                    <p className="field__hint">
                      Das Foto wird beim Speichern entfernt.{' '}
                      <button
                        type="button"
                        className="linkbutton"
                        onClick={() => setNoteEdit(note, { photo: 'behalten' })}
                      >
                        Doch behalten
                      </button>
                    </p>
                  ) : null}
                  {!staged && (
                    <input
                      type="file"
                      accept="image/*"
                      disabled={photoBusy}
                      onChange={(event) => {
                        const input = event.currentTarget;
                        void chooseNotePhoto(note.id, input.files?.[0], input);
                      }}
                    />
                  )}
                  {note.photo && !staged && edit.photo === 'behalten' && (
                    <small className="field__hint">Ein neues Foto ersetzt das bisherige.</small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {wantsNote && (
        <>
          <label className="field">
            <span>{kind === 'tipp' ? 'Warum lohnt es sich?' : 'Wie war es? Was sollte man wissen?'}</span>
            <textarea
              required
              rows={6}
              value={values.text}
              onChange={(event) => set('text', event.target.value)}
              placeholder="Was man wissen sollte — was bestellen, wann hingehen, was vermeiden."
              maxLength={4000}
            />
            <small className="field__hint">{values.text.length} von 4000 Zeichen</small>
          </label>

          {/* Steht ganz unten, weil es die Frage nach dem Tipp selbst nicht
              unterbricht: Erst schreibt man, was man weiss, dann sagt man, für
              wen. Und nur, wenn jemand tatsächlich etwas sucht — sonst wäre es
              ein leeres Feld, das bei jedem Tipp Fragen aufwirft. */}
          {offeneWuensche.length > 0 && (
            <fieldset className="field">
              <legend>
                Antwort auf einen Wunsch? <em>optional</em>
              </legend>
              <div className="form__chips">
                {offeneWuensche.map((wunsch) => (
                  <button
                    key={wunsch.id}
                    type="button"
                    className="wunschwahl"
                    aria-pressed={gewaehlteWuensche.includes(wunsch.id)}
                    onClick={() =>
                      setGewaehlteWuensche((current) =>
                        current.includes(wunsch.id)
                          ? current.filter((entry) => entry !== wunsch.id)
                          : [...current, wunsch.id],
                      )
                    }
                  >
                    {wunschZielLabel(wunsch)}{' '}
                    <span className="wunschwahl__von">von {wunsch.von}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="field">
            <span className="field__label">Foto <em>optional</em></span>
            {photo ? (
              <div className="photo-preview">
                <img src={photo.previewUrl} alt="Vorschau" />
                <div>
                  <p>{formatBytes(photo.bytes)} · {photo.ext.toUpperCase()}</p>
                  <button
                    type="button"
                    className="linkbutton"
                    onClick={() => {
                      URL.revokeObjectURL(photo.previewUrl);
                      setPhoto(null);
                    }}
                  >
                    Entfernen
                  </button>
                </div>
              </div>
            ) : (
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                disabled={photoBusy}
                onChange={(event) => void choosePhoto(event.target.files?.[0])}
              />
            )}
            {photoBusy && <small className="field__hint">Wird verkleinert…</small>}
          </div>
        </>
      )}

      {error && (
        <p className="form__error" role="alert">
          {error}
          {retryable && ' Der Entwurf ist gespeichert — einfach nochmal senden.'}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button" disabled={busy || photoBusy}>
          {busy ? 'Wird gesendet…' : SUBMIT_LABELS[kind]}
        </button>
      </div>

      <p className="form__note">
        Ist nach dem Speichern sofort für alle sichtbar. Jede Änderung steht mit deinem Namen im
        Verlauf und lässt sich von einem Admin zurücknehmen.
      </p>
      </form>
    </>
  );
}
