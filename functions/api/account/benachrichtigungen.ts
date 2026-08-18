/**
 * Die zwei Schalter: über neue Wünsche und über Ergänzungen zu eigenen Tipps.
 *
 * Getrennt vom E-Mail-Endpunkt, weil sie etwas anderes tun — hier geht nie eine
 * Nachricht raus, und deshalb gibt es hier auch keinen 503 ohne Mail-Dienst. Ein
 * Schalter darf man auch umlegen, wenn gerade nichts verschickt werden kann;
 * ohne bestätigte Adresse läuft er ohnehin ins Leere (die Empfänger-Abfragen in
 * lib/benachrichtigung.ts verlangen `email_verifiziert_am`).
 *
 * Angesprochen von der Konto-Seite und vom Kreuzchen auf der Wunschseite.
 */

import { json } from '../../lib/admin';
import type { Env } from '../../lib/env';
import type { RequestData } from '../../lib/users';

export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({
  request,
  env,
  data,
}) => {
  const body = (await request.json().catch(() => ({}))) as {
    wuensche?: unknown;
    eigeneTipps?: unknown;
    eigeneWuensche?: unknown;
  };

  const wuensche = typeof body.wuensche === 'boolean' ? body.wuensche : null;
  const eigeneTipps = typeof body.eigeneTipps === 'boolean' ? body.eigeneTipps : null;
  const eigeneWuensche = typeof body.eigeneWuensche === 'boolean' ? body.eigeneWuensche : null;

  if (wuensche === null && eigeneTipps === null && eigeneWuensche === null) {
    return json({ error: 'Nichts zu ändern.' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (wuensche !== null) {
    sets.push(`benachrichtigung_wuensche = ?${binds.length + 2}`);
    binds.push(wuensche ? 1 : 0);
  }
  if (eigeneTipps !== null) {
    sets.push(`benachrichtigung_eigene_tipps = ?${binds.length + 2}`);
    binds.push(eigeneTipps ? 1 : 0);
  }
  if (eigeneWuensche !== null) {
    sets.push(`benachrichtigung_eigene_wuensche = ?${binds.length + 2}`);
    binds.push(eigeneWuensche ? 1 : 0);
  }

  await (env.DB as D1Database)
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?1`)
    .bind(data.user.id, ...binds)
    .run();

  return json({ ok: true });
};
