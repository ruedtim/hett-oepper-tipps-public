/** Die Struktur der Antwort von /api/data (functions/lib/appdata.ts). */

export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  active: boolean;
}

export interface Note {
  /**
   * «2026-07-26-sara» — enthält den Namen. In der Gäste-Sicht steht hier
   * stattdessen die Position («n1»), sie taugt dann nur noch als Schlüssel.
   */
  id: string;
  /**
   * Kontoname. **Leer in der Gäste-Sicht**: Der Server schickt Namen nicht mit
   * (functions/lib/appdata.ts). Wer diesen Wert anzeigt, muss den leeren Fall
   * behandeln — «von » ist kein Text, den jemand lesen will.
   */
  by: string;
  text: string;
  /** Dateiname in /photos/<tipId>/, nicht der volle Pfad. Null in der Gäste-Sicht. */
  photo: string | null;
  added: string;
}

export interface Coords {
  lat: number;
  lng: number;
}

export interface Tip {
  schema: number;
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Kanonische Schreibweise, beim Build aus place-aliases.json aufgelöst. */
  place: string;
  /** Gruppierungsschlüssel, beim Build erzeugt — nie in der Quelldatei. */
  placeKey: string;
  categories: string[];
  address?: string;
  link?: string;
  coords?: Coords;
  closed: boolean;
  added: string;
  notes: Note[];
}

/** Ein Gesuch: «zu diesem Ort suche ich Tipps, bis zu diesem Tag». */
export interface Wunsch {
  schema: number;
  id: string;
  /** Kontoname der Person, die den Wunsch angebracht hat. */
  von: string;
  /** ISO 3166-1 alpha-2. */
  land: string;
  /**
   * Kanonische Schreibweise, zur Lesezeit aus place-aliases.json aufgelöst.
   * Fehlt, wenn der Wunsch dem ganzen Land gilt («irgendwas in Portugal»).
   */
  ort?: string;
  /** Gruppierungsschlüssel, derselbe Raum wie Tip.placeKey. Leer ohne Ort. */
  ortKey: string;
  kategorien: string[];
  text?: string;
  /** Letzter gültiger Tag — am Tag danach ist der Wunsch weg. */
  bis: string;
  erstellt: string;
  erfuellt?: { am: string; von: string };
  /**
   * IDs der zugeordneten Tipps. Fehlt, wenn keine da sind.
   *
   * Nötig, weil der Ortsfilter nur exakte Ortsnamen trifft: Ein Wunsch für
   * «Thurgau» findet den Tipp in Frauenfeld nie von allein.
   */
  tipps?: string[];
}

export interface AppData {
  generatedAt: string;
  categories: Category[];
  tips: Tip[];
  /**
   * Abgelaufenes hat der Server schon weggelassen; Erfüllte sind noch dabei.
   * **Immer leer in der Gäste-Sicht** — ein Wunsch nennt seine Autorin und ist
   * eine Frage an die Runde, nicht an Zuschauer.
   */
  wuensche: Wunsch[];
}
