import { json, requireAdmin } from '../../../lib/admin';
import type { Env } from '../../../lib/env';
import { pruefeNeuenNamen, umbenennungsStmts } from '../../../lib/umbenennen';
import { getUserById, hashPassword } from '../../../lib/users';
import type { RequestData } from '../../../lib/users';

const MIN_PASSWORD = 8;

/**
 * Ein Konto ändern: Admin-Flag, deaktivieren/reaktivieren, Passwort
 * zurücksetzen, umbenennen. Deaktivieren sperrt nicht nur den Login, sondern
 * über die Fingerprint-Prüfung der Middleware auch alle laufenden Sitzungen;
 * ein Passwort-Reset entwertet sie ebenso (frisches Salt → neuer Hash).
 *
 * Umbenennen können Admins auch für andere — vor allem, um Schreibweisen an
 * bestehende `note.by`-Werte anzugleichen, damit der Personen-Filter nicht
 * zerfällt. Dass jemand seinen eigenen Namen ändern darf, steht in
 * functions/api/account/name.ts; dort kostet es das eigene Passwort.
 */
export const onRequestPatch: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
  params,
}) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;

  const idRaw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Unbekanntes Konto.' }, 400);

  const user = await getUserById(db, id);
  if (!user) return json({ error: 'Unbekanntes Konto.' }, 404);
  // Der Gäste-Zugang liegt in derselben Tabelle, gehört aber nicht hierher: Ein
  // Startpasswort mit must_change_password ergäbe für ihn keinen Sinn, und
  // «zum Admin machen» erst recht nicht. Er hat seinen eigenen Endpunkt.
  if (user.is_guest === 1) {
    return json({ error: 'Der Gäste-Zugang wird unter «Nur schauen» verwaltet.' }, 400);
  }

  const body = (await request.json().catch(() => ({}))) as {
    isAdmin?: unknown;
    disabled?: unknown;
    newStartPassword?: unknown;
    neuerName?: unknown;
  };

  const setAdmin = typeof body.isAdmin === 'boolean' ? body.isAdmin : null;
  const setDisabled = typeof body.disabled === 'boolean' ? body.disabled : null;
  const newStartPassword = typeof body.newStartPassword === 'string' ? body.newStartPassword : null;
  const neuerName = typeof body.neuerName === 'string' ? body.neuerName.trim() : null;

  if (setAdmin === null && setDisabled === null && newStartPassword === null && neuerName === null) {
    return json({ error: 'Nichts zu ändern.' }, 400);
  }

  // Umbenennen läuft als eigener Ast und nie zusammen mit etwas anderem: Es ist
  // ein Batch über zwei Tabellen, während der Rest ein einzelnes UPDATE mit dem
  // Letzte-Admin-Wächter IM Statement ist. Beides zu verschränken hiesse, diesen
  // Wächter anzufassen — für eine Bequemlichkeit, die niemand braucht.
  if (neuerName !== null) {
    if (setAdmin !== null || setDisabled !== null || newStartPassword !== null) {
      return json({ error: 'Umbenennen bitte für sich allein, nicht zusammen mit anderem.' }, 400);
    }
    if (neuerName === user.name) return json({ ok: true });

    const fehler = await pruefeNeuenNamen(db, neuerName, user.id);
    if (fehler) return json({ error: fehler.text }, fehler.status);

    try {
      await db.batch(umbenennungsStmts(db, user, neuerName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE constraint failed')) {
        return json({ error: 'Diesen Namen (oder einen zum Verwechseln ähnlichen) gibt es schon.' }, 409);
      }
      throw error;
    }
    return json({ ok: true });
  }

  // Letzter-Admin-Schutz, serverseitig und nicht nur in der Oberfläche: Wer dem
  // letzten aktiven Admin das Flag nimmt oder ihn deaktiviert, sperrt alle aus.
  const losesAdmin =
    user.is_admin === 1 && user.disabled === 0 && (setAdmin === false || setDisabled === true);
  if (losesAdmin) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0')
      .first<{ n: number }>();
    if ((row?.n ?? 0) <= 1) {
      return json({ error: 'Ohne Admins geht es nicht — erst jemand anderem Admin geben.' }, 409);
    }
  }

  if (newStartPassword !== null && newStartPassword.length < MIN_PASSWORD) {
    return json({ error: `Das Startpasswort braucht mindestens ${MIN_PASSWORD} Zeichen.` }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (setAdmin !== null) {
    sets.push(`is_admin = ?${binds.length + 2}`);
    binds.push(setAdmin ? 1 : 0);
  }
  if (setDisabled !== null) {
    sets.push(`disabled = ?${binds.length + 2}`);
    binds.push(setDisabled ? 1 : 0);
  }
  if (newStartPassword !== null) {
    sets.push(`password_hash = ?${binds.length + 2}`);
    binds.push(await hashPassword(newStartPassword));
    sets.push('must_change_password = 1');
  }

  // Der Zähl-Check oben ist nur die freundliche Meldung — gegen das Rennen
  // zweier Admins, die sich gleichzeitig gegenseitig entmachten, wacht diese
  // Bedingung IM Statement: Ein einzelnes UPDATE ist atomar, der Verlierer
  // ändert schlicht nichts (changes = 0).
  const guard = losesAdmin
    ? ' AND (SELECT COUNT(*) FROM users WHERE is_admin = 1 AND disabled = 0) > 1'
    : '';

  const result = await db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?1${guard}`)
    .bind(id, ...binds)
    .run();

  if (losesAdmin && result.meta.changes === 0) {
    return json({ error: 'Ohne Admins geht es nicht — erst jemand anderem Admin geben.' }, 409);
  }

  return json({ ok: true });
};
