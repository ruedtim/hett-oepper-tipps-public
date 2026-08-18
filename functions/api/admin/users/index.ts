import { searchKey } from '../../../../shared/normalize.mjs';
import { json, requireAdmin } from '../../../lib/admin';
import type { Env } from '../../../lib/env';
import { pruefeNeuenNamen } from '../../../lib/umbenennen';
import { alteNamenOf, hashPassword } from '../../../lib/users';
import type { RequestData, UserRow } from '../../../lib/users';

/**
 * Kontenverwaltung: auflisten und anlegen.
 *
 * Ein Admin legt Konten mit einem Startpasswort an und gibt es weiter; beim
 * ersten Anmelden wird ein eigenes Passwort verlangt (weicher Zwang). Gelöscht
 * wird nie — Namen stehen in Notizen und im Verlauf; wer gehen soll, wird
 * deaktiviert (PATCH auf /api/admin/users/<id>).
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  // Ohne den Gäste-Zugang: Der ist kein Konto einer Person, hat weder
  // Startpasswort noch Admin-Flag und wird unter /api/admin/gast verwaltet. In
  // dieser Liste stünde er nur da, damit man ihn versehentlich deaktiviert.
  //
  // Die E-Mail-Adresse steht seit #64 MIT in der Liste — Entscheid des
  // Besitzers: Admins sollen sehen können, wie jemand erreichbar ist. Dazu
  // «eingeladen von»: aufgelöst beim LESEN über die Einladungszeile, die beim
  // Einlösen dauerhaft stehen bleibt — analog zu den alten Namen daneben.
  const rows = await (env.DB as D1Database)
    .prepare(
      `SELECT u.id, u.name, u.name_key, u.alte_namen, u.is_admin, u.disabled,
              u.must_change_password, u.created_at, u.email, u.email_verifiziert_am,
              u.einladungs_budget, u.einladungen_bestellt_am,
              (SELECT COUNT(*) FROM einladungen WHERE von_id = u.id) AS einladungen_erzeugt,
              einlader.name AS eingeladen_von
       FROM users u
       LEFT JOIN einladungen e ON e.eingeloest_von = u.id
       LEFT JOIN users einlader ON einlader.id = e.von_id
       WHERE u.is_guest = 0 ORDER BY u.name COLLATE NOCASE`,
    )
    .all<
      Pick<
        UserRow,
        | 'id'
        | 'name'
        | 'name_key'
        | 'alte_namen'
        | 'is_admin'
        | 'disabled'
        | 'must_change_password'
        | 'created_at'
        | 'email'
        | 'email_verifiziert_am'
      > & {
        einladungs_budget: number;
        einladungen_bestellt_am: string | null;
        einladungen_erzeugt: number;
        eingeladen_von: string | null;
      }
    >();

  return json({
    users: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      // Die früher getragenen Namen, zuletzt getragener zuerst. Nur hier
      // ausgeliefert: In der App selbst löst `buildAppData` alles auf den
      // aktuellen Namen auf — wer wissen will, wer früher wie hiess, ist ein
      // Admin in der Kontenverwaltung. Nur die Schreibweise, nicht der
      // Schlüssel: Der ist Innenleben und sagt niemandem etwas.
      alteNamen: alteNamenOf(row).map((alt) => alt.name),
      isAdmin: row.is_admin === 1,
      disabled: row.disabled === 1,
      mustChangePassword: row.must_change_password === 1,
      createdAt: row.created_at,
      email: row.email,
      emailVerifiziert: row.email_verifiziert_am != null,
      eingeladenVon: row.eingeladen_von,
      einladungen: {
        budget: row.einladungs_budget,
        erzeugt: row.einladungen_erzeugt,
        verbleibend: Math.max(0, row.einladungs_budget - row.einladungen_erzeugt),
        bestelltAm: row.einladungen_bestellt_am,
      },
    })),
  });
};

const MIN_PASSWORD = 8;

export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ request, env, data }) => {
  const denied = requireAdmin(data);
  if (denied) return denied;

  const db = env.DB as D1Database;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    startPassword?: unknown;
    isAdmin?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const startPassword = typeof body.startPassword === 'string' ? body.startPassword : '';
  const isAdmin = body.isAdmin === true;

  // Prüft Länge, Brauchbarkeit und Kollision — Letzteres auch gegen Namen, die
  // ein anderes Konto FRÜHER getragen hat. Ohne diese Hälfte liesse sich ein
  // frei gewordener Name annehmen und man bekäme über den searchKey-Vergleich
  // in submit.ts die alten Beiträge der Vorgängerin zum Ändern und Löschen.
  // Die UNIQUE-Verletzung unten bleibt trotzdem: Sie entscheidet das Rennen.
  const fehler = await pruefeNeuenNamen(db, name, 0);
  if (fehler) return json({ error: fehler.text }, fehler.status);
  const nameKey = searchKey(name);
  if (startPassword.length < MIN_PASSWORD) {
    return json({ error: `Das Startpasswort braucht mindestens ${MIN_PASSWORD} Zeichen.` }, 400);
  }

  const hash = await hashPassword(startPassword);
  try {
    const result = await db
      .prepare(
        'INSERT INTO users (name, name_key, password_hash, is_admin, must_change_password) VALUES (?1, ?2, ?3, ?4, 1)',
      )
      .bind(name, nameKey, hash, isAdmin ? 1 : 0)
      .run();
    return json({ ok: true, id: result.meta.last_row_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Diesen Namen (oder einen zum Verwechseln ähnlichen) gibt es schon.' }, 409);
    }
    throw error;
  }
};
