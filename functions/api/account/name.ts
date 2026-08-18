import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import { pruefeNeuenNamen, umbenennungsStmts } from '../../lib/umbenennen';
import { getUserById, verifyPassword } from '../../lib/users';
import type { RequestData } from '../../lib/users';

const WRONG_PASSWORD_DELAY_MS = 500;

/**
 * Den eigenen Anzeigenamen ändern.
 *
 * Das Passwort ist Pflicht, aus demselben Grund wie beim Passwortwechsel: Ein
 * liegen gelassenes, angemeldetes Handy soll nicht reichen, um unter fremdem
 * Namen aufzutreten.
 *
 * Was danach passiert, steht in functions/lib/umbenennen.ts: Konto und Wünsche
 * ändern sich in einem Batch, Notizen und Verlauf bleiben unangetastet, und die
 * alten Beiträge zeigen den neuen Namen, weil `buildAppData` beim Ausliefern
 * auflöst. Der Gast kommt hier nicht an — für ihn endet jede Methode ausser GET
 * und HEAD schon im Gate.
 */
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  const db = env.DB as D1Database;

  const body = (await request.json().catch(() => ({}))) as {
    neuerName?: unknown;
    passwort?: unknown;
  };
  const neuerName = typeof body.neuerName === 'string' ? body.neuerName.trim() : '';
  const passwort = typeof body.passwort === 'string' ? body.passwort : '';

  if (!neuerName) return json({ error: 'Bitte einen Namen angeben.' }, 400);
  if (!passwort) return json({ error: 'Bitte das Passwort angeben.' }, 400);

  const user = await getUserById(db, data.user.id);
  if (!user) return json({ error: 'Dieses Konto gibt es nicht (mehr).' }, 403);

  if (!(await verifyPassword(passwort, user.password_hash))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return json({ error: 'Das Passwort stimmt nicht.' }, 403);
  }

  if (neuerName === user.name) return json({ ok: true, name: user.name });

  const fehler = await pruefeNeuenNamen(db, neuerName, user.id);
  if (fehler) return json({ error: fehler.text }, fehler.status);

  try {
    await db.batch(umbenennungsStmts(db, user, neuerName));
  } catch (error) {
    // Zwei gleichzeitige Umbenennungen auf denselben Namen: Der UNIQUE-Index
    // auf name_key entscheidet, die Prüfung oben ist nur die freundliche Hälfte.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Diesen Namen (oder einen zum Verwechseln ähnlichen) gibt es schon.' }, 409);
    }
    throw error;
  }

  return json({ ok: true, name: neuerName });
};
