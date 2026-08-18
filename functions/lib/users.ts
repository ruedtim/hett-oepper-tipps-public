/**
 * Konten: Passwort-Hashing und Zugriff auf die users-Tabelle.
 *
 * Gehasht wird mit PBKDF2-HMAC-SHA-256 über WebCrypto — bcrypt/argon2 gäbe es
 * in Workers nur als WASM-Paket, und ein Paket mehr ist hier der falsche
 * Tausch. Die Iterationszahl ist bewusst konservativ gewählt: Das CPU-Limit im
 * Free Tier liegt bei ~10 ms pro Aufruf, und der Login-Pfad darf daran nicht
 * scheitern. Sie steht im Hash-String und lässt sich später ohne Migration
 * erhöhen. Das Threat-Model trägt das: privater Freundeskreis, die Datenbank
 * sieht nur der Besitzer, und Online-Raten bremst zusätzlich das 500-ms-Delay
 * im Login.
 *
 * WICHTIG: Format und Parameter müssen exakt zu scripts/hash-password.mjs
 * passen — das Skript ist der Bootstrap- und Notfall-Weg für Konten.
 */

import { constantTimeEqual } from './session';

const encoder = new TextEncoder();

const PBKDF2_ITERATIONS = 25_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/**
 * Gültig geformter Hash, der zu keinem Passwort passt. Gegen ihn wird geprüft,
 * wenn es das Konto nicht gibt oder es deaktiviert ist — so kostet «unbekannter
 * Name» exakt gleich viel Zeit wie «falsches Passwort».
 */
export const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${'A'.repeat(22)}$${'A'.repeat(43)}`;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** → 'pbkdf2$<iterationen>$<salt-b64url>$<hash-b64url>' */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const salt = fromBase64url(parts[2] ?? '');
  const expected = parts[3] ?? '';
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expected) return false;

  const actual = base64url(await derive(password, salt, iterations));
  return constantTimeEqual(actual, expected);
}

// ------------------------------------------------------------------ Tabelle ---

/** Eine Zeile aus `users`, wie D1 sie liefert. */
export interface UserRow {
  id: number;
  name: string;
  name_key: string;
  password_hash: string;
  is_admin: number;
  disabled: number;
  must_change_password: number;
  created_at: string;
  password_changed_at: string | null;
  /** 1 nur beim Gäste-Zugang («nur schauen»): darf lesen, sonst nichts. */
  is_guest: number;
  /**
   * JSON-Array der früher getragenen Namen, je Eintrag `{key, name}`. Seit
   * Anzeigenamen änderbar sind, reicht der aktuelle Schlüssel nicht mehr: Alte
   * Beiträge stehen unter dem Namen von damals (functions/lib/umbenennen.ts).
   *
   * Der Schlüssel entscheidet über Besitz und Namensvergabe, die Schreibweise
   * beantwortet «wie hiess dieses Konto vorher?» in der Kontenverwaltung. Beides
   * in EINEM Eintrag statt in zwei Listen — zwei Listen, die immer gleich lang
   * und gleich sortiert sein müssen, laufen irgendwann auseinander.
   */
  alte_namen: string;
  /** Freiwillig, normalisiert (getrimmt, klein). NULL = keine hinterlegt. */
  email: string | null;
  /**
   * NULL heisst «noch nicht bestätigt» — und eine unbestätigte Adresse zählt
   * NIRGENDS: nicht beim Anmelden, nicht beim Zurücksetzen, nicht beim
   * Benachrichtigen. Sonst genügte ein Tippfehler, um Reset-Links an Fremde zu
   * schicken.
   */
  email_verifiziert_am: string | null;
  benachrichtigung_wuensche: number;
  benachrichtigung_eigene_tipps: number;
  benachrichtigung_eigene_wuensche: number;
  /** Deckel gegen Massenversand: wann zuletzt eine Bestätigungsmail rausging. */
  verifikation_gesendet_am: string | null;
  /** Derselbe Deckel für «Passwort vergessen». */
  reset_angefordert_am: string | null;
}

/** Mindestlänge für alle Passwörter — Start-, Gäste- und selbst gewählte. */
export const MIN_PASSWORD_LENGTH = 8;

/** Obergrenze, damit PBKDF2 nicht mit einem Roman gefüttert wird. */
export const MAX_PASSWORD_LENGTH = 200;

/** Ein früher getragener Name: Schlüssel zum Vergleichen, Name zum Anzeigen. */
export interface AlterName {
  key: string;
  name: string;
}

/** Nur diese Felder braucht, wer die früheren Namen wissen will. */
type MitAltenNamen = { name_key: string; alte_namen?: string | null };

/**
 * Die früheren Namen eines Kontos, in der Reihenfolge, in der sie abgelegt sind.
 *
 * Defensiv aus drei Gründen, die alle real sind: Die Spalte fehlt vor
 * migrations/0008, sie kann vor der Umwandlung noch blosse Zeichenketten
 * enthalten (dann ist der Schlüssel zugleich die beste verfügbare Schreibweise),
 * und kaputtes JSON darf hier niemals eine Anmeldung verhindern. Im Zweifel ist
 * die Liste leer — dann gilt nur der aktuelle Schlüssel, also exakt das
 * Verhalten von vor der Umbenennung.
 */
export function alteNamenOf(row: MitAltenNamen): AlterName[] {
  let roh: unknown;
  try {
    roh = JSON.parse(row.alte_namen ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(roh)) return [];

  const namen: AlterName[] = [];
  for (const eintrag of roh) {
    if (typeof eintrag === 'string') {
      namen.push({ key: eintrag, name: eintrag });
    } else if (
      typeof eintrag === 'object' &&
      eintrag !== null &&
      typeof (eintrag as AlterName).key === 'string'
    ) {
      const { key, name } = eintrag as AlterName;
      namen.push({ key, name: typeof name === 'string' && name ? name : key });
    }
  }
  return namen;
}

/**
 * Alle Schlüssel eines Kontos — der aktuelle zuerst, dann die früheren.
 *
 * Das ist der Vergleichsmassstab für Besitz: «gehört mir» heisst seit den
 * änderbaren Namen «trägt einen meiner Schlüssel», nicht mehr «trägt meinen
 * Schlüssel».
 */
export function nameKeysOf(row: MitAltenNamen): string[] {
  return [...new Set([row.name_key, ...alteNamenOf(row).map((alt) => alt.key)])];
}

/** Was die Middleware nach erfolgreicher Prüfung an die Endpunkte durchreicht. */
export interface SessionUser {
  id: number;
  name: string;
  /** Aktueller und alle früheren `searchKey`s — siehe `nameKeysOf`. */
  nameKeys: string[];
  isAdmin: boolean;
  mustChangePassword: boolean;
  /**
   * Gast statt Person. Erzwungen wird «nur lesen» nicht hier, sondern im Gate
   * (functions/_middleware.ts) über die HTTP-Methode — dieses Flag ist nur die
   * Auskunft für die Oberfläche, damit sie keine Knöpfe zeigt, die nichts tun.
   */
  isGuest: boolean;
  /** Auch die noch unbestätigte Adresse — die Konto-Seite zeigt beide Zustände. */
  email: string | null;
  emailVerifiziert: boolean;
  benachrichtigungWuensche: boolean;
  benachrichtigungEigeneTipps: boolean;
  benachrichtigungEigeneWuensche: boolean;
}

/** Typ von `context.data` hinter dem Gate. */
export interface RequestData extends Record<string, unknown> {
  user: SessionUser;
}

/**
 * Die `?? null`/`?? 0`-Fallbacks decken das Fenster ab, in dem der neue Code
 * schon läuft und die Migration noch nicht angewandt ist: D1 liefert die
 * Spalten dann gar nicht, und ohne Fallback stünde in der Antwort `undefined`.
 */
export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    nameKeys: nameKeysOf(row),
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
    isGuest: row.is_guest === 1,
    email: row.email ?? null,
    emailVerifiziert: Boolean(row.email && row.email_verifiziert_am),
    benachrichtigungWuensche: (row.benachrichtigung_wuensche ?? 0) === 1,
    benachrichtigungEigeneTipps: (row.benachrichtigung_eigene_tipps ?? 0) === 1,
    benachrichtigungEigeneWuensche: (row.benachrichtigung_eigene_wuensche ?? 0) === 1,
  };
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
}

export function getUserByNameKey(db: D1Database, nameKey: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE name_key = ?1').bind(nameKey).first<UserRow>();
}

/**
 * Der zweite Weg zum Konto, seit der Name änderbar ist. Nur BESTÄTIGTE Adressen
 * — eine bloss eingetippte wäre sonst ein Anmeldename, den sich jeder für ein
 * fremdes Postfach ausdenken könnte. Der Gast ist ausgeschlossen: Er hat keine
 * Adresse und soll auch nie eine bekommen können.
 */
export function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare(
      'SELECT * FROM users WHERE email = ?1 AND email_verifiziert_am IS NOT NULL AND is_guest = 0',
    )
    .bind(email)
    .first<UserRow>();
}

/**
 * Der Gäste-Zugang. Ohne Namen nachgeschlagen — «nur schauen» fragt bloss nach
 * einem Passwort. Dass es höchstens eine solche Zeile gibt, sichert der
 * partielle UNIQUE-Index aus migrations/0005_gast.sql.
 */
export function getGuestUser(db: D1Database): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE is_guest = 1').first<UserRow>();
}
