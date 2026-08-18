import { heuteIso } from '../../../../shared/datum.mjs';
import { json, requireAdmin } from '../../../lib/admin';
import { gueltigBis, neueListenId } from '../../../lib/einladungen';
import type { Env } from '../../../lib/env';
import { githubClient } from '../../../lib/github';
import { mailKonfiguriert, sendeMail } from '../../../lib/mail';
import type { RequestData } from '../../../lib/users';
import {
  einladungsStmts,
  getBitte,
  raeumeErledigteBitten,
  verwerfenStmt,
  zuruecknahmeStmts,
} from '../../../lib/zugangsbitten';

/**
 * Was ein Admin mit einer Zugangsbitte tun kann (#71): einladen, verwerfen,
 * eine verschickte Einladung zurückziehen.
 *
 * Hier liegt die Bedingung aus dem Issue — «ganz von alleine darf man sich
 * nicht anmelden können». Der Einladungslink entsteht ausschliesslich in
 * diesem POST; der öffentliche Endpunkt api/zugang.ts schreibt nur die Bitte
 * auf und verschickt gar nichts.
 */

export const onRequestPost: PagesFunction<Env, string, RequestData> = async (context) => {
  const { env, data, params, request } = context;
  const verweigert = requireAdmin(data);
  if (verweigert) return verweigert;

  const db = env.DB as D1Database;
  const bitte = await ladeBitte(db, params.id);
  if (!bitte) return json({ error: 'Diese Bitte gibt es nicht mehr.' }, 404);
  if (bitte.erledigt_am) return json({ error: 'Diese Bitte ist schon erledigt.' }, 409);

  // Dieser Endpunkt existiert zum Verschicken — ohne Mail-Konfiguration kann er
  // seine Aufgabe nicht erfüllen. Also 503 wie api/account/email.ts und nicht
  // stilles Übergehen wie bei den Benachrichtigungen: Eine Einladung zu
  // erzeugen, die niemand bekommt, verbrennt die Bitte ohne Wirkung.
  if (!mailKonfiguriert(env)) {
    return json(
      { error: 'Diese Seite kann gerade keine E-Mails verschicken. Bitte später nochmal.' },
      503,
    );
  }

  const heute = heuteIso();
  const einladungsId = neueListenId();
  const ergebnis = await db.batch(
    einladungsStmts(db, {
      bitteId: bitte.id,
      adminId: data.user.id,
      einladungsId,
      erstellt: heute,
      bis: gueltigBis(heute),
    }),
  );

  // Der Anspruch steckt im INSERT: Hat es nicht gegriffen, war jemand schneller.
  if (ergebnis[0]?.meta.changes !== 1) {
    return json({ error: 'Diese Bitte ist schon erledigt.' }, 409);
  }

  const url = `${new URL(request.url).origin}/einladung?token=${einladungsId}`;

  // Der Versand steht NICHT in waitUntil, anders als bei den
  // Benachrichtigungen: Dort ist die Mail eine Beigabe, hier ist sie der ganze
  // Zweck des Knopfs. Geht sie nicht raus, muss der Admin das erfahren — und
  // zwar zusammen mit dem Link, damit die Einladung nicht verloren ist.
  let versandFehler = false;
  try {
    await sendeMail(env, {
      an: bitte.email,
      betreff: 'Deine Einladung zu «Hett öpper Tipps?»',
      text:
        `Hallo ${bitte.vorname}\n\n` +
        'Du hast um Zugang zu «Hett öpper Tipps?» gebeten — der Reisetipp-Sammlung ' +
        'unserer Runde. Hier ist dein Einladungslink:\n\n' +
        `${url}\n\n` +
        'Damit legst du dir dein Konto selbst an, mit eigenem Passwort. Der Link gilt ' +
        `bis ${gueltigBis(heute)} und lässt sich genau einmal einlösen.\n\n` +
        'Hast du gar nicht gefragt? Dann ignorier diese Nachricht einfach — ohne den ' +
        'Link passiert nichts.\n',
    });
  } catch (error) {
    console.error('Einladungsmail auf eine Zugangsbitte fehlgeschlagen:', error);
    versandFehler = true;
  }

  context.waitUntil(schliesseIssue(env, bitte.issue_nummer));
  await raeumeErledigteBitten(db, heute);

  return json({ ok: true, url, versandFehler });
};

/**
 * Verwerfen. Die Zeile ist danach weg — kein «abgelehnt»-Zustand: Die Adresse
 * einer fremden Person aufzuheben, nachdem man Nein gesagt hat, wäre das
 * Falsche, und der Deckel gibt den Platz sofort wieder frei.
 */
export const onRequestDelete: PagesFunction<Env, string, RequestData> = async (context) => {
  const { env, data, params } = context;
  const verweigert = requireAdmin(data);
  if (verweigert) return verweigert;

  const db = env.DB as D1Database;
  const bitte = await ladeBitte(db, params.id);
  if (!bitte) return json({ error: 'Diese Bitte gibt es nicht mehr.' }, 404);

  const ergebnis = await verwerfenStmt(db, bitte.id).run();
  if (!ergebnis.meta.changes) {
    return json({ error: 'Diese Bitte ist schon erledigt.' }, 409);
  }

  context.waitUntil(schliesseIssue(env, bitte.issue_nummer));
  return json({ ok: true });
};

/**
 * Die verschickte Einladung zurückziehen. Ein echtes Rückgängig: Der Link ist
 * tot, und die Bitte steht wieder offen — sonst verschluckte ein Fehlklick sie,
 * und die Person müsste nochmal fragen, ohne je zu erfahren warum.
 */
export const onRequestPatch: PagesFunction<Env, string, RequestData> = async ({
  env,
  data,
  params,
}) => {
  const verweigert = requireAdmin(data);
  if (verweigert) return verweigert;

  const db = env.DB as D1Database;
  const bitte = await ladeBitte(db, params.id);
  if (!bitte) return json({ error: 'Diese Bitte gibt es nicht mehr.' }, 404);
  if (!bitte.einladung_id) return json({ error: 'Hier ist keine Einladung unterwegs.' }, 409);

  const ergebnis = await db.batch(
    zuruecknahmeStmts(db, bitte.id, bitte.einladung_id, heuteIso()),
  );
  if (ergebnis[1]?.meta.changes !== 1) {
    return json(
      { error: 'Die Einladung liess sich nicht zurückziehen — vielleicht ist sie schon eingelöst.' },
      409,
    );
  }

  return json({ ok: true });
};

/** `params.id` ist eine Zeichenkette aus dem Pfad — sonst greift kein Statement. */
async function ladeBitte(db: D1Database, roh: string | string[] | undefined) {
  const id = Number(Array.isArray(roh) ? roh[0] : roh);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getBitte(db, id);
}

/**
 * Das Benachrichtigungs-Issue schliessen, sobald die Bitte erledigt ist —
 * sonst stünde in der Issue-Liste für immer eine Aufgabe, die längst getan ist.
 * Bestbemüht und in try/catch: Ein Fehler hier darf die Einladung nicht
 * umstossen, die schon verschickt ist.
 */
async function schliesseIssue(env: Env, nummer: number | null): Promise<void> {
  if (!nummer || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return;

  try {
    const gh = githubClient(env.GITHUB_TOKEN, env.GITHUB_REPO);
    await gh.request(`/repos/${env.GITHUB_REPO}/issues/${nummer}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
  } catch (error) {
    console.error(`Issue ${nummer} liess sich nicht schliessen:`, error);
  }
}
