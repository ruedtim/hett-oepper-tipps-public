import { ApiError } from './api';

/**
 * Die Art einer Handlung, wie sie in `verlauf.kind` steht. Bewusst hier
 * nachgebildet statt aus `functions/` importiert — die Oberfläche baut gegen
 * ein anderes tsconfig, und ein einzelner String-Union rechtfertigt keine
 * gemeinsame Datei unter `shared/`.
 */
export type VerlaufArt =
  | 'tipp'
  | 'ergaenzung'
  | 'korrektur'
  | 'loeschung'
  | 'kategorien'
  | 'rueckgaengig';

/** Was der Verlauf zeigen soll. «loeschungen» meint auch löschende Rücknahmen. */
export type HistoryFilter = 'alle' | 'loeschungen';

export interface HistoryEntry {
  /** Nummer des Verlaufseintrags (historisch «sha» — die Oberfläche nutzt sie nur als Schlüssel). */
  sha: string;
  date: string;
  /** Art der Handlung — die Oberfläche macht daraus das farbige Etikett. */
  kind: VerlaufArt;
  /** Überschrift des Eintrags. */
  title: string;
  /** Wer es ausgelöst hat — seit den Konten immer gesetzt. */
  by: string | null;
  /** Begründung, sofern eine angegeben wurde. */
  note: string | null;
}

export interface HistoryPage {
  page: number;
  art: HistoryFilter;
  hasMore: boolean;
  entries: HistoryEntry[];
}

export interface AdminUser {
  id: number;
  name: string;
  /**
   * Früher getragene Namen, zuletzt getragener zuerst. Leer bei allen, die nie
   * umbenannt wurden. Nur die Kontenverwaltung bekommt sie — in der App selbst
   * zeigt alles den aktuellen Namen.
   */
  alteNamen: string[];
  isAdmin: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  /** Hinterlegte Adresse — Admins sehen sie seit #64 (Entscheid des Besitzers). */
  email: string | null;
  emailVerifiziert: boolean;
  /** Wer die Person hereingeholt hat — aufgelöst auf den aktuellen Namen. */
  eingeladenVon: string | null;
  einladungen: {
    budget: number;
    erzeugt: number;
    verbleibend: number;
    /** Offene Bestellung («mehr Einladungen, bitte»), null = keine. */
    bestelltAm: string | null;
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Keine Verbindung.', 0);
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? 'Das hat nicht geklappt.', response.status);
  }
  return data as T;
}

function send<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  return call<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchHistory(page = 1, art: HistoryFilter = 'alle'): Promise<HistoryPage> {
  return call(`/api/admin/history?seite=${page}&art=${art}`);
}

export function fetchChangedFiles(sha: string): Promise<{ files: { path: string; status: string }[] }> {
  return call(`/api/admin/history?sha=${encodeURIComponent(sha)}`);
}

/** Wer zurücknimmt, steht im Sitzungs-Cookie — kein Namensfeld mehr nötig. */
export function revert(sha: string) {
  return send<{ ok: true; commit: string; touched: number }>('/api/admin/revert', 'POST', { sha });
}

export function saveCategories(categories: unknown[]) {
  return send<{ ok: true; unchanged: boolean }>('/api/admin/categories', 'POST', { categories });
}

export function listUsers(): Promise<{ users: AdminUser[] }> {
  return call('/api/admin/users');
}

export function createUser(payload: { name: string; startPassword: string; isAdmin?: boolean }) {
  return send<{ ok: true; id: number }>('/api/admin/users', 'POST', payload);
}

/**
 * `neuerName` und `mehrEinladungen` gehen nur ALLEIN durch — der Server weist
 * die Mischung mit den anderen Feldern ab, weil Umbenennen ein Batch über zwei
 * Tabellen ist und der Rest ein einzelnes UPDATE mit dem Letzte-Admin-Wächter
 * im Statement. `mehrEinladungen` gibt dem Konto drei Einladungen dazu und
 * erledigt eine offene Bestellung.
 */
export function updateUser(
  id: number,
  patch: {
    isAdmin?: boolean;
    disabled?: boolean;
    newStartPassword?: string;
    neuerName?: string;
    mehrEinladungen?: boolean;
  },
) {
  return send<{ ok: true }>(`/api/admin/users/${id}`, 'PATCH', patch);
}


// ---------------------------------------------------------- Zugangsbitten ---

/** Eine Bitte um Zugang vom Anmeldebildschirm (#71). */
export interface Zugangsbitte {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  /** Tag, an dem gefragt wurde. */
  erstellt: string;
  /** Gesetzt, sobald ein Admin einen Einladungslink verschickt hat. */
  einladung: {
    id: string;
    url: string;
    /** Letzter gültiger Tag — inklusiv, wie bei den Freigabelinks. */
    bis: string;
    status: 'offen' | 'eingeloest' | 'widerrufen' | 'abgelaufen';
    geschicktAm: string;
    von: string | null;
  } | null;
}

export function listeZugangsbitten(): Promise<{ bitten: Zugangsbitte[] }> {
  return call('/api/admin/zugang');
}

/**
 * Den Einladungslink erzeugen und an die angegebene Adresse schicken. Die
 * Antwort trägt die `url` immer mit: Ging die Mail nicht raus (`versandFehler`),
 * ist die Einladung trotzdem da und lässt sich von Hand weitergeben.
 */
export function ladeZugangEin(id: number) {
  return send<{ ok: true; url: string; versandFehler: boolean }>(
    `/api/admin/zugang/${id}`,
    'POST',
    {},
  );
}

/** Die verschickte Einladung zurückziehen — die Bitte steht danach wieder offen. */
export function nimmZugangZurueck(id: number) {
  return send<{ ok: true }>(`/api/admin/zugang/${id}`, 'PATCH', {});
}

/** Verwerfen. Die Zeile ist danach weg, samt der Adresse. */
export function verwirfZugang(id: number) {
  return call<{ ok: true }>(`/api/admin/zugang/${id}`, { method: 'DELETE' });
}
