/**
 * Entwürfe lokal halten.
 *
 * Der typische Fall ist nicht der Fehlklick, sondern schlechtes Netz: Jemand
 * tippt in einer Bar in Lissabon fünf Sätze, drückt senden, und das WLAN ist weg.
 * Ohne Zwischenspeicher ist der Text dann weg — mit ist er beim nächsten Öffnen
 * wieder da.
 *
 * Der Vorgangsschlüssel gehört zum Entwurf, nicht zum Absendeversuch: Nur so
 * erkennt der Server einen zweiten Versuch als Wiederholung und legt keinen
 * zweiten Pull Request an.
 */

const PREFIX = 'hot:draft:';

export interface Draft<T> {
  key: string;
  values: T;
}

function storageKey(name: string): string {
  return `${PREFIX}${name}`;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function loadDraft<T>(name: string, fallback: T): Draft<T> {
  try {
    const raw = localStorage.getItem(storageKey(name));
    if (raw) {
      const parsed = JSON.parse(raw) as Draft<T>;
      if (parsed && typeof parsed.key === 'string' && parsed.values) return parsed;
    }
  } catch {
    // Privater Modus oder voller Speicher — dann eben ohne Entwurf.
  }
  return { key: newKey(), values: fallback };
}

export function saveDraft<T>(name: string, draft: Draft<T>): void {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(draft));
  } catch {
    // Nicht speichern zu können darf das Formular nicht blockieren.
  }
}

export function clearDraft(name: string): void {
  try {
    localStorage.removeItem(storageKey(name));
  } catch {
    // egal
  }
}
