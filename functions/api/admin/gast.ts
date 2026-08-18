import { json, requireAdmin } from '../../lib/admin';
import type { Env } from '../../lib/env';
import { getGuestUser, hashPassword } from '../../lib/users';
import type { RequestData } from '../../lib/users';

/**
 * Der Gäste-Zugang («nur schauen»), aus Admin-Sicht: Passwort setzen, auf- und
 * zumachen.
 *
 * Ein eigener Endpunkt und nicht der Weg über /api/admin/users/<id>, obwohl der
 * Gast dort als Zeile liegt: Das Konten-Formular vergibt Startpasswörter, die
 * beim ersten Anmelden gewechselt werden müssen, und schützt den letzten Admin.
 * Beides passt hier nicht — ein Gäste-Passwort wird herumgegeben und nie
 * gewechselt. Die beiden Endpunkte getrennt zu halten ist billiger, als das
 * Konten-Formular mit Sonderfällen zu durchsetzen.
 *
 * Ein neues Passwort beendet automatisch alle laufenden Gäste-Sitzungen: Der
 * frische Hash hat ein frisches Salt, und der Fingerabdruck im Cookie passt
 * nicht mehr (siehe functions/lib/session.ts). Genau darum liegt der Gast in
 * `users` und nicht in einer Einstellungstabelle.
 */

const MIN_PASSWORD = 8;

export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const gast = await getGuestUser(env.DB as D1Database);
  if (!gast) return json({ error: 'Der Gäste-Zugang fehlt in der Datenbank.' }, 500);

  return json({
    aktiv: gast.disabled === 0,
    // Wann zuletzt eines gesetzt wurde. null heisst: noch nie — dann ist der
    // Zugang zu, und es steht auch kein Passwort herum, das jemand kennen könnte.
    passwortGesetztAm: gast.password_changed_at,
  });
};

export const onRequestPatch: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;
  const gast = await getGuestUser(db);
  if (!gast) return json({ error: 'Der Gäste-Zugang fehlt in der Datenbank.' }, 500);

  const body = (await request.json().catch(() => ({}))) as {
    neuesPasswort?: unknown;
    aktiv?: unknown;
  };

  const neuesPasswort = typeof body.neuesPasswort === 'string' ? body.neuesPasswort : null;
  const setzeAktiv = typeof body.aktiv === 'boolean' ? body.aktiv : null;

  if (neuesPasswort === null && setzeAktiv === null) return json({ error: 'Nichts zu ändern.' }, 400);
  if (neuesPasswort !== null && neuesPasswort.length < MIN_PASSWORD) {
    return json({ error: `Das Gäste-Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` }, 400);
  }
  // Aufmachen ohne Passwort geht nicht: In der Zeile steht dann noch der
  // gesperrte Platzhalter aus der Migration. Der Zugang wäre zwar nicht offen
  // (kein Passwort passt darauf), aber die Oberfläche würde «aktiv» melden —
  // und das ist die Art Halbwahrheit, die man später glaubt.
  if (setzeAktiv === true && neuesPasswort === null && gast.password_changed_at === null) {
    return json({ error: 'Erst ein Gäste-Passwort setzen, dann geht der Zugang auf.' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (neuesPasswort !== null) {
    sets.push(`password_hash = ?${binds.length + 2}`);
    binds.push(await hashPassword(neuesPasswort));
    sets.push("password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
    // Ein gesetztes Passwort macht den Zugang auf — sonst wäre das Setzen ein
    // Schritt, der sichtbar nichts tut, und man setzte es zweimal.
    if (setzeAktiv === null) sets.push('disabled = 0');
  }
  if (setzeAktiv !== null) {
    sets.push(`disabled = ?${binds.length + 2}`);
    binds.push(setzeAktiv ? 0 : 1);
  }

  await db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?1 AND is_guest = 1`)
    .bind(gast.id, ...binds)
    .run();

  return json({ ok: true });
};
