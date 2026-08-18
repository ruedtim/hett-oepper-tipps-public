export interface SubmitResult {
  ok: true;
  /** null bei einer erkannten Wiederholung. */
  tipId: string | null;
  /** Nummer des Verlaufseintrags, unter dem die Änderung steht. */
  commit: string;
  repeated: boolean;
}

/** Antwort von /api/me — wer gerade angemeldet ist. */
export interface Me {
  name: string;
  admin: boolean;
  mustChangePassword: boolean;
  /**
   * Der Gäste-Zugang («nur schauen»): darf lesen, sonst nichts. Wo dieses Flag
   * einen Knopf ausblendet, ist das reine Höflichkeit — verboten wird das
   * Schreiben im Gate (functions/_middleware.ts), nicht hier.
   */
  gast: boolean;
  /** Hinterlegte Adresse — auch eine noch unbestätigte. `null` = keine. */
  email: string | null;
  /**
   * Erst eine bestätigte Adresse zählt: fürs Anmelden, fürs Zurücksetzen und
   * für Benachrichtigungen. Ohne sie sind die Schalter unten wirkungslos, und
   * die Oberfläche sagt das auch.
   */
  emailVerifiziert: boolean;
  benachrichtigungWuensche: boolean;
  benachrichtigungEigeneTipps: boolean;
  benachrichtigungEigeneWuensche: boolean;
  /**
   * Beitritts-Link zum Signal-Chat der Runde. Kommt vom Server statt als
   * Konstante im Bundle (das ist vor dem Gate abrufbar) und ist für Gäste
   * `null` — die Stellen, die ihn zeigen, verschwinden dann einfach.
   */
  signalChat: string | null;
}

/** Antwort von /api/account/email. */
export interface EmailResult {
  ok: true;
  email: string;
  verifiziert: boolean;
  hinweis?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Bei diesen Fehlern lohnt sich «nochmal senden», bei anderen nicht. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Keine Verbindung. Der Entwurf bleibt gespeichert.', 0);
  }

  if (response.status === 401) {
    // Sitzung abgelaufen — neu laden bringt den Anmeldebildschirm.
    throw new ApiError('Die Anmeldung ist abgelaufen. Bitte die Seite neu laden.', 401);
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? 'Das hat nicht geklappt.', response.status);
  }
  return data as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function submit(payload: unknown): Promise<SubmitResult> {
  return post<SubmitResult>('/api/submit', payload);
}

export function sendFeedback(payload: { text: string; from: string }) {
  return post<{ ok: true; issue: number; url: string }>('/api/feedback', payload);
}

export function fetchMe(): Promise<Me> {
  return request<Me>('/api/me');
}

export function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: true }> {
  return post<{ ok: true }>('/api/account/password', { oldPassword, newPassword });
}

/**
 * Den eigenen Anzeigenamen ändern. Das Passwort ist Pflicht — ein liegen
 * gelassenes Handy soll nicht reichen, um unter fremdem Namen aufzutreten.
 */
export function umbenennen(neuerName: string, passwort: string): Promise<{ ok: true; name: string }> {
  return post<{ ok: true; name: string }>('/api/account/name', { neuerName, passwort });
}

/**
 * Adresse setzen oder erneut bestätigen lassen — beides derselbe Aufruf: Wer
 * dieselbe unbestätigte Adresse nochmal schickt, bekommt eine neue Mail.
 */
export function setzeEmail(email: string, benachrichtigungWuensche?: boolean): Promise<EmailResult> {
  return post<EmailResult>('/api/account/email', {
    email,
    ...(benachrichtigungWuensche === undefined ? {} : { benachrichtigungWuensche }),
  });
}

export function entferneEmail(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/account/email', { method: 'DELETE' });
}

/**
 * Die Benachrichtigungs-Schalter. Ohne bestätigte Adresse laufen sie ins Leere
 * — der Server lässt sie trotzdem zu, damit man sie vorbereiten kann.
 */
export function setzeBenachrichtigungen(patch: {
  wuensche?: boolean;
  eigeneTipps?: boolean;
  eigeneWuensche?: boolean;
}): Promise<{ ok: true }> {
  return post<{ ok: true }>('/api/account/benachrichtigungen', patch);
}

// ------------------------------------------------------------- Wünsche ---

export interface WunschResult {
  ok: true;
  /** null bei einer erkannten Wiederholung. */
  id: string | null;
  repeated: boolean;
}

export function wunschAnbringen(payload: unknown): Promise<WunschResult> {
  return post<WunschResult>('/api/wuensche', payload);
}

/** Als erfüllt markieren (`true`) oder wieder öffnen (`false`). */
export function wunschErfuellt(id: string, erfuellt: boolean): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/wuensche/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ erfuellt }),
  });
}

/** Den eigenen Wunsch inhaltlich ändern — Ziel, Frist, Kategorien, Text. */
export function wunschAendern(id: string, felder: unknown): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/wuensche/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(felder),
  });
}

export function wunschLoeschen(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/wuensche/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Einen bestehenden Tipp einem Wunsch zuordnen (`true`) oder die Zuordnung lösen (`false`). */
export function wunschTippVerknuepfen(
  wunschId: string,
  tipId: string,
  verknuepft: boolean,
): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/api/wuensche/${encodeURIComponent(wunschId)}/tipps`, {
    tipId,
    verknuepft,
  });
}

// ------------------------------------------------------- Geteilte Listen ---

/** Ein Freigabelink, wie ihn die Konto-Seite auflistet. */
export interface GeteilteListe {
  id: string;
  url: string;
  /** Tag, an dem geteilt wurde. */
  erstellt: string;
  /** Letzter gültiger Tag — inklusiv, wie bei den Wünschen. */
  bis: string;
  anzahl: number;
}

export interface TeilenResult {
  ok: true;
  id: string;
  url: string;
  bis: string;
  anzahl: number;
}

/**
 * Die gerade sichtbaren Tipps als Link teilen.
 *
 * Übergeben werden die IDs und nicht der Filter: Geteilt wird die
 * Resultatmenge dieses Moments, nicht ein Abonnement auf alles, was künftig
 * dazupasst.
 */
export function teileListe(tippIds: string[]): Promise<TeilenResult> {
  return post<TeilenResult>('/api/geteilt', { tippIds });
}

export function listeGeteilte(): Promise<{ listen: GeteilteListe[] }> {
  return request<{ listen: GeteilteListe[] }>('/api/geteilt');
}

export function widerrufeGeteilte(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/geteilt/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ------------------------------------------------------------ Einladungen ---

/** Eine eigene Einladung, wie sie die Konto-Seite auflistet. */
export interface Einladung {
  id: string;
  url: string;
  /** Tag, an dem der Link erzeugt wurde. */
  erstellt: string;
  /** Letzter gültiger Tag — inklusiv, wie bei den Freigabelinks. */
  bis: string;
  status: 'offen' | 'eingeloest' | 'widerrufen' | 'abgelaufen';
  /** Aktueller Name des entstandenen Kontos, wenn eingelöst. */
  eingeloestVon: string | null;
  eingeloestAm: string | null;
}

export interface EinladungenAntwort {
  einladungen: Einladung[];
  /** Wie viele Links noch erzeugt werden können (Budget minus je Erzeugte). */
  verbleibend: number;
  /** Ob eine Bestellung («mehr Einladungen, bitte») bei den Admins offen ist. */
  bestellt: boolean;
}

export function listeEinladungen(): Promise<EinladungenAntwort> {
  return request<EinladungenAntwort>('/api/einladungen');
}

export function erstelleEinladung(): Promise<{ ok: true; id: string; url: string; bis: string }> {
  return post<{ ok: true; id: string; url: string; bis: string }>('/api/einladungen', {});
}

export function widerrufeEinladung(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/einladungen/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function bestelleEinladungen(): Promise<{ ok: true; bestellt: boolean }> {
  return post<{ ok: true; bestellt: boolean }>('/api/einladungen/bestellung', {});
}

// Der Datenexport braucht hier nichts: Er ist ein <a href download>. Der
// Wrapper oben liest jede Antwort als JSON und käme mit einem ZIP nicht weit.

export async function logout(): Promise<void> {
  // Über den Wrapper, damit «kein Netz» als sichtbare ApiError ankommt statt
  // stumm zu verpuffen (die 204-Antwort hat keinen Body — das fängt der Wrapper ab).
  await request<unknown>('/api/login', { method: 'DELETE' });

  // Der Offline-Vorrat des Service Workers (public/sw.js) gehört zur Sitzung
  // und stirbt mit ihr — wer sich auf einem geteilten Gerät abmeldet, lässt
  // keine lesbaren Tipps zurück. Über das Präfix statt über den vollen Namen,
  // damit ein Versions-Sprung im Worker diese Stelle nicht überholt. Hülle und
  // Bundle bleiben stehen: Code, keine Daten.
  try {
    const namen = await caches.keys();
    await Promise.all(
      namen
        .filter((name) => name.startsWith('daten-') || name.startsWith('fotos-'))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // Kein Cache-Zugriff (alter Browser, gesperrter Speicher): Dann gab es
    // auch keinen Vorrat, der zu löschen wäre.
  }
}
