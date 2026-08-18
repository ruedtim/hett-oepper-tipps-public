/**
 * Baut die AppData-Antwort für /api/data — dieselbe Form, die früher
 * scripts/build-data.mjs als public/data.json geschrieben hat. Das Frontend
 * merkt vom Umzug auf D1 nichts: gleiche Felder, gleiche Sortierung, gleiche
 * Alias-Auflösung.
 *
 * Mit `fuerGast` fällt heraus, was dem Gäste-Zugang nicht gehört: Wünsche,
 * Namen und Fotos. Das passiert HIER und nicht in der Oberfläche — sonst stünde
 * alles weiterhin in der Antwort, und «unsichtbar» hiesse bloss «einen
 * Netzwerk-Tab entfernt». Die Form bleibt dieselbe, damit das Frontend nicht
 * zwei Datenmodelle kennen muss: leere Liste, leerer Name, kein Foto.
 *
 * Daneben wohnt hier `buildGeteilteAnsicht` für die Freigabelinks. Bewusst eine
 * eigene Funktion und kein drittes Flag an `buildAppData` — die Begründung steht
 * dort. Sie liegt aber in DIESER Datei, weil sie dieselben Helfer braucht
 * (`ohnePerson`, `anzeigeNamen`, `mitAktuellemNamen`); die für einen zweiten
 * Aufrufer zu exportieren, hiesse den Weg aufzumachen, sie irgendwo anders
 * halb anzuwenden.
 */

import { heuteIso } from '../../shared/datum.mjs';
import { resolvePlace, searchKey } from '../../shared/normalize.mjs';
import { getAliases, getAllAggregates, getCategories } from './db';
import type { Category, NoteFile, TipFile } from './db';
import { nameKeysOf } from './users';
import { getSichtbareWuensche } from './wuensche';
import type { WunschFile } from './wuensche';

export interface AppTip extends TipFile {
  /** Kanonische Schreibweise, zur Lesezeit aus place_aliases aufgelöst. */
  placeKey: string;
  notes: NoteFile[];
}

export interface AppWunsch extends WunschFile {
  /**
   * Gruppierungsschlüssel, derselbe Raum wie AppTip.placeKey. Leer, wenn der
   * Wunsch keinen Ort nennt — dann gruppiert die Oberfläche nach Land.
   */
  ortKey: string;
}

export interface AppData {
  generatedAt: string;
  categories: Category[];
  tips: AppTip[];
  /**
   * Offene und erfüllte Gesuche, alles Abgelaufene bereits weggelassen.
   *
   * Kommen bewusst mit /api/data statt aus einem eigenen Endpunkt: Die Zeile
   * unter dem Titel braucht sie bei jedem Aufruf der Liste, und aus einem
   * Schnappschuss können Kopfzeile und Zählerzeile nie widersprechen.
   */
  wuensche: AppWunsch[];
}

/**
 * Die Gäste-Sicht auf eine Notiz: ohne Namen und ohne Foto.
 *
 * Die ID wird mitgetauscht, denn sie IST der Name — Notiz-IDs heissen
 * «2026-07-26-sara». Sie hier stehen zu lassen, während `by` leer ist, hiesse
 * den Namen im Netzwerk-Tab weiterhin auszuliefern; das Weglassen wäre dann nur
 * Anstrich. Ersatz ist die Position, die einzige Eigenschaft der Notiz, die
 * nichts verrät und innerhalb eines Tipps eindeutig bleibt (das Frontend
 * braucht sie nur als React-Schlüssel; die Formulare, die echte IDs brauchen,
 * sind für Gäste ohnehin zu).
 *
 * Das Datum bleibt: Es sagt, wann jemand dort war, nicht wer.
 */
function ohnePerson(note: NoteFile, index: number): NoteFile {
  return { id: `n${index + 1}`, by: '', text: note.text, photo: null, added: note.added };
}

/**
 * Schlüssel → aktueller Anzeigename, für jedes Konto und jeden Namen, den es je
 * getragen hat.
 *
 * Das ist die Anzeige-Hälfte der Umbenennung (die Speicher-Hälfte steht in
 * functions/lib/umbenennen.ts): Gespeichert bleibt in `notes.by` der Name von
 * damals — die Notiz-ID trägt ihn ohnehin, der Backup-Spiegel muss
 * byte-deterministisch bleiben, und der Verlauf ist ein Protokoll. Aufgelöst
 * wird beim LESEN, genau wie bei den Ortsnamen ein paar Zeilen weiter unten.
 *
 * Damit stimmt nebenbei auch alles wieder, was das Frontend aus dem gelieferten
 * Namen ableitet: Der Personen-Filter behält einen Eintrag statt in zwei zu
 * zerfallen, und die Höflichkeits-Prüfungen der Oberfläche («ist das meine
 * Beschreibung?») treffen dieselbe Entscheidung wie der Server.
 *
 * Nur der Export geht bewusst NICHT durch diese Funktion — er liest über
 * `getAllAggregates` direkt, damit der Spiegel unverändert bleibt.
 */
async function anzeigeNamen(db: D1Database): Promise<Map<string, string>> {
  const namen = new Map<string, string>();

  let zeilen;
  try {
    zeilen = await db
      .prepare('SELECT name, name_key, alte_namen FROM users')
      .all<{ name: string; name_key: string; alte_namen: string | null }>();
  } catch (error) {
    // Fehlt die Spalte (Deployment vor migrations/0006), bleibt die Karte leer
    // und alles zeigt den gespeicherten Namen — also den Stand von vorher. Ohne
    // dieses try/catch stünde die GANZE App still, nicht bloss ein Formular.
    console.error('Anzeigenamen nicht lesbar:', error);
    return namen;
  }

  // Zwei Durchgänge: Erst die früheren Schlüssel, dann die aktuellen. Sollten
  // sich beide je in die Quere kommen, gewinnt das Konto, das den Namen HEUTE
  // trägt (verhindern tut das ohnehin `pruefeNeuenNamen`).
  for (const zeile of zeilen.results) {
    for (const key of nameKeysOf(zeile)) namen.set(key, zeile.name);
  }
  for (const zeile of zeilen.results) namen.set(zeile.name_key, zeile.name);

  return namen;
}

/** Gibt die Notiz unverändert zurück, wenn der Name schon der aktuelle ist. */
function mitAktuellemNamen(note: NoteFile, namen: Map<string, string>): NoteFile {
  const aktuell = namen.get(searchKey(note.by));
  return aktuell && aktuell !== note.by ? { ...note, by: aktuell } : note;
}

export async function buildAppData(
  db: D1Database,
  options: { fuerGast?: boolean } = {},
): Promise<AppData> {
  const fuerGast = options.fuerGast === true;
  const heute = heuteIso();
  const [categories, aliases, aggregates, wuenscheRoh, namen] = await Promise.all([
    getCategories(db),
    getAliases(db),
    getAllAggregates(db),
    // Für Gäste gar nicht erst holen: Was nie geladen wird, kann auch nicht
    // versehentlich durchrutschen — und es spart zwei D1-Reads.
    fuerGast ? Promise.resolve([] as WunschFile[]) : getSichtbareWuensche(db, heute),
    // Ebenso: Gäste sehen gar keine Namen, da ist nichts aufzulösen.
    fuerGast ? Promise.resolve(new Map<string, string>()) : anzeigeNamen(db),
  ]);

  const tips: AppTip[] = [];
  for (const { tip, notes } of aggregates) {
    // Tipps ohne Notizen gibt es per Konstruktion nicht (eine Löschung entfernt
    // das ganze Aggregat) — falls doch, lieber ausblenden als kaputt anzeigen.
    if (notes.length === 0) continue;

    // Die Alias-Auflösung passiert bewusst beim LESEN, nicht beim Schreiben:
    // Ein später ergänzter Alias korrigiert alte Einträge rückwirkend.
    const place = resolvePlace(tip.place, aliases);
    tips.push({
      ...tip,
      place: place.label,
      placeKey: place.key,
      notes: fuerGast ? notes.map(ohnePerson) : notes.map((note) => mitAktuellemNamen(note, namen)),
    });
  }

  tips.sort((a, b) =>
    a.added < b.added ? 1 : a.added > b.added ? -1 : a.name.localeCompare(b.name, 'de'),
  );

  // Dieselbe Alias-Auflösung wie bei den Tipps, damit «Lissabon» im Wunsch und
  // «Lissabon» im Tipp denselben Schlüssel bekommen — daran hängt der Sprung
  // vom Wunsch in die gefilterte Tippliste. Ohne Ort gilt der Wunsch dem
  // ganzen Land, dann bleibt der Schlüssel leer.
  const wuensche: AppWunsch[] = wuenscheRoh.map((wunsch) => {
    // `von` zieht die Umbenennung schon per SQL nach; `erfuellt.von` kann sie
    // nicht treffen, weil es dafür keine Schlüsselspalte gibt (zwei Spalten
    // wären für ein reines Anzeigefeld zu viel Buchhaltung). Beide hier
    // aufzulösen kostet nichts und hält die Seite einheitlich.
    const mitNamen = {
      ...wunsch,
      von: namen.get(searchKey(wunsch.von)) ?? wunsch.von,
      ...(wunsch.erfuellt
        ? {
            erfuellt: {
              ...wunsch.erfuellt,
              von: namen.get(searchKey(wunsch.erfuellt.von)) ?? wunsch.erfuellt.von,
            },
          }
        : {}),
    };

    if (!mitNamen.ort) return { ...mitNamen, ortKey: '' };
    const ort = resolvePlace(mitNamen.ort, aliases);
    return { ...mitNamen, ort: ort.label, ortKey: ort.key };
  });

  return { generatedAt: new Date().toISOString(), categories, tips, wuensche };
}

/** Was die geteilte Seite zum Rendern braucht. */
export interface GeteilteAnsicht {
  categories: Category[];
  tips: AppTip[];
  /**
   * Wie viele der eingefrorenen IDs es nicht mehr gibt. Die Seite sagt es dazu:
   * Schweigen hiesse, jemandem eine kürzere Liste zu zeigen, als die teilende
   * Person verschickt hat — und niemand könnte sagen, woran das liegt.
   */
  verschwunden: number;
}

/**
 * Die Sicht auf eine geteilte Liste: fremde Beiträge ohne Namen und Foto, die
 * eigenen vollständig.
 *
 * Eine eigene Funktion statt eines dritten Flags an `buildAppData`, aus vier
 * Gründen, die man sonst wieder herleiten müsste:
 *
 * 1. **Andere Rückgabe.** Weder Wünsche noch `generatedAt` noch alle Tipps.
 *    `AppData` ist der Vertrag mit dem React-Frontend; diese Seite ist
 *    server-gerendertes HTML und hat mit dem Vertrag nichts zu tun. Gekoppelt
 *    müsste jede künftige Änderung an `/api/data` für eine ÖFFENTLICHE Seite
 *    mitgedacht werden.
 * 2. **Andere Eingabe.** Es bräuchte zwei weitere Parameter (IDs und Schlüssel),
 *    und aus `{ fuerGast?: boolean }` würde ein Optionsobjekt, das Identität
 *    transportiert — das `functions/api/data.ts` dann versehentlich füllen kann.
 * 3. **Asymmetrisches Risiko.** `buildAppData` bedient den Lesepfad ALLER
 *    angemeldeten Konten. Ein Zweig darin, den nur ein anonymer Pfad auslöst,
 *    ist genau die Stelle, an der eine falsche Vorgabe später Daten öffnet.
 * 4. **Andere Reihenfolge.** `buildAppData` sortiert nach `added`; hier zählt
 *    die eingefrorene Reihenfolge des Moments, in dem geteilt wurde.
 *
 * `fuerGast` ist eine Subtraktion, das hier eine Auswahl mit Naht — zwei
 * verschiedene Dinge unter einer Signatur wären derselbe Fehler wie ein
 * Kreuzchen, dessen Beschriftung zwei Sachen meint.
 *
 * Geladen wird über `getAllAggregates` und ein Filtern gegen ein Set, nicht über
 * `WHERE id IN (…)`: D1 begrenzt die gebundenen Parameter, bei bis zu 200 IDs
 * bräuchte es Stückelung — und zwei parameterlose Abfragen über ein paar hundert
 * Tipps sind billiger als der Code, der das umgeht.
 */
export async function buildGeteilteAnsicht(
  db: D1Database,
  tippIds: string[],
  besitzerKeys: string[],
): Promise<GeteilteAnsicht> {
  const [categories, aliases, aggregates, namen] = await Promise.all([
    getCategories(db),
    getAliases(db),
    getAllAggregates(db),
    anzeigeNamen(db),
  ]);

  const nachId = new Map(aggregates.map((aggregat) => [aggregat.tip.id, aggregat]));
  const meine = new Set(besitzerKeys);

  const tips: AppTip[] = [];
  let verschwunden = 0;

  // Über die eingefrorenen IDs laufen, nicht über die Aggregate: Das hält die
  // Reihenfolge des geteilten Moments und zählt nebenbei, was fehlt.
  for (const id of tippIds) {
    const aggregat = nachId.get(id);
    if (!aggregat || aggregat.notes.length === 0) {
      verschwunden += 1;
      continue;
    }

    const place = resolvePlace(aggregat.tip.place, aliases);
    tips.push({
      ...aggregat.tip,
      place: place.label,
      placeKey: place.key,
      // Die Naht: pro Notiz entschieden, wie in `planNoteEdits`. Die Sachdaten
      // des Tipps daneben — Name, Ort, Adresse, Koordinaten — sind niemandes
      // Beitrag und bleiben deshalb vollständig stehen.
      notes: aggregat.notes.map((note, index) =>
        meine.has(searchKey(note.by)) ? mitAktuellemNamen(note, namen) : ohnePerson(note, index),
      ),
    });
  }

  return { categories, tips, verschwunden };
}
