import { heuteIso } from '../../shared/datum.mjs';
import { searchKey } from '../../shared/normalize.mjs';
import type { Env } from '../lib/env';
import { githubClient, GitHubError } from '../lib/github';
import { loginPage } from '../lib/loginPage';
import { normalisiereEmail } from '../lib/mail';
import { bitteInsertStmt, merkeIssueStmt } from '../lib/zugangsbitten';

/**
 * «Gib mir bitte Zugang!» — die Bitte um ein Konto.
 *
 * Der einzige Endpunkt der App, der ohne Sitzung SCHREIBT (die Ausnahme dafür
 * steht in functions/_middleware.ts). Damit gilt die Begründung aus
 * api/feedback.ts hier ausdrücklich NICHT: Dort trägt das Passwort-Gate den
 * Spam-Schutz, hier gibt es keines. Deshalb:
 *
 *  1. Ein Deckel auf gleichzeitig OFFENEN Bitten (lib/zugangsbitten.ts). Er
 *     begrenzt nicht die Zahl der Versuche, sondern den Schaden — mehr als
 *     MAX_OFFEN Zeilen kann niemand erzeugen, egal wie oft er drückt. Und er
 *     geht von selbst wieder auf, sobald die Admins die Bitten in der App
 *     erledigen; früher hing das daran, dass jemand GitHub-Issues schloss.
 *  2. Dieselbe Adresse zweimal ergibt keine zweite Zeile (partieller
 *     UNIQUE-Index) — die Antwort bleibt dabei dasselbe freundliche «Danke».
 *  3. Kein Freitextfeld. Vorname, Nachname, Adresse — mehr nicht, also keine
 *     Bühne für Texte, die woanders gelesen werden sollen.
 *  4. Von hier geht KEINE Mail hinaus. Ein Mailversand an einer Stelle, die
 *     Fremden offensteht, wäre ein Verstärker: Man könnte die App fremde
 *     Postfächer anschreiben lassen. Verschickt wird erst, wenn ein Admin
 *     drückt (api/admin/zugang/[id].ts).
 *
 * DIE REIHENFOLGE IST ERST D1, DANN GITHUB, und das ist eine bewusste
 * Änderung: Früher antwortete dieser Endpunkt 503, wenn kein GitHub-Token
 * eingerichtet war — das Issue WAR die Bitte. Jetzt ist die Bitte in D1
 * aufgehoben und das Issue nur noch die Benachrichtigung. Also dieselbe Regel
 * wie beim Mailen: Nicht benachrichtigen zu können macht nichts auf, es macht
 * nur weniger. Ein Fehlschlag geht ins Log, die Bitte gilt trotzdem.
 *
 * Ein eigenes Label, NICHT `zugang`: Unter `zugang` sammelt
 * .github/workflows/expiry-check.yml die Warnungen über ablaufende Zugangsdaten
 * und öffnet dort kein zweites Issue, solange eines offen ist. Eine Bitte um ein
 * Konto unter demselben Label würde diese Warnungen stillschweigend
 * unterdrücken — und die kommen einmal pro Jahr und dürfen nicht ausfallen.
 */

export const LABEL = 'zugangswunsch';
const MAX_NAME = 40;
const MIN_NAME = 2;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Ohne JavaScript kommt ein normales Formular an, mit JavaScript JSON —
  // dieselbe Unterscheidung wie in api/login.ts.
  const contentType = request.headers.get('Content-Type') ?? '';
  const isForm = contentType.includes('form');

  const felder = isForm
    ? await ausFormular(request)
    : await ausJson(request);

  const vorname = saeubere(felder.vorname);
  const nachname = saeubere(felder.nachname);

  for (const [wert, was] of [
    [vorname, 'Vornamen'],
    [nachname, 'Nachnamen'],
  ] as const) {
    if (wert.length < MIN_NAME || wert.length > MAX_NAME) {
      return respond(isForm, 400, `Bitte einen ${was} mit ${MIN_NAME} bis ${MAX_NAME} Zeichen.`);
    }
  }

  // Dieselbe Hürde wie beim Anlegen eines Kontos: Was keinen Anmeldenamen
  // ergibt, hilft auch als Bitte nicht weiter — aus genau diesen beiden Teilen
  // baut functions/einladung.ts später den Kontonamen.
  if (!searchKey(`${vorname}${nachname}`)) {
    return respond(isForm, 400, `«${vorname} ${nachname}» ergibt keinen brauchbaren Namen.`);
  }

  const email = normalisiereEmail(felder.email);
  if (!email) {
    return respond(isForm, 400, 'Bitte eine gültige E-Mail-Adresse — dorthin geht der Einladungslink.');
  }

  const db = env.DB as D1Database;

  let bitteId: number;
  try {
    const ergebnis = await bitteInsertStmt(db, {
      vorname,
      nachname,
      email,
      erstellt: heuteIso(),
    }).run();

    // Der Deckel steht im Statement: keine Zeile heisst «gerade zu viele».
    if (!ergebnis.meta.changes) {
      return respond(
        isForm,
        429,
        'Es liegen gerade viele Anfragen. Bitte später nochmal — oder frag direkt in der Runde.',
      );
    }
    bitteId = ergebnis.meta.last_row_id as number;
  } catch (error) {
    // Der partielle UNIQUE-Index: Diese Adresse hat schon eine offene Bitte.
    // Nach draussen ist das kein Fehler, sondern dieselbe Antwort wie beim
    // ersten Mal — sonst wäre der Endpunkt ein Verzeichnis offener Bitten.
    if (String(error).includes('UNIQUE')) return respond(isForm, 200, DANKE);
    console.error('Zugangsbitte liess sich nicht speichern:', error);
    return respond(isForm, 500, 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.');
  }

  // Die Benachrichtigung hält nichts auf: Die Bitte steht, ob das Issue nun
  // entsteht oder nicht. Dieselbe Bauweise wie bei den Mails in
  // lib/benachrichtigung.ts.
  context.waitUntil(benachrichtige(env, db, bitteId, vorname, nachname));

  return respond(isForm, 200, DANKE);
};

const DANKE =
  'Danke — die Bitte ist angekommen. Meldet die Runde dich frei, kommt ein Einladungslink ' +
  'an diese Adresse, und damit legst du dir dein Konto selbst an.';

async function ausFormular(request: Request) {
  const form = await request.formData();
  return {
    vorname: String(form.get('vorname') ?? ''),
    nachname: String(form.get('nachname') ?? ''),
    email: String(form.get('email') ?? ''),
  };
}

async function ausJson(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    vorname?: unknown;
    nachname?: unknown;
    email?: unknown;
  };
  const text = (wert: unknown) => (typeof wert === 'string' ? wert : '');
  return {
    vorname: text(body.vorname),
    nachname: text(body.nachname),
    email: text(body.email),
  };
}

/**
 * Das Issue ist die Push-Nachricht an die Runde, mehr nicht — gehandelt wird in
 * der Kontenverwaltung. Die ADRESSE STEHT NICHT DRIN: Gebraucht wird sie nur da,
 * wo eingeladen wird, und das ist die App. Ein Issue liest man am Handy vor,
 * leitet es weiter, und es überlebt die Bitte um Jahre.
 */
async function benachrichtige(
  env: Env,
  db: D1Database,
  bitteId: number,
  vorname: string,
  nachname: string,
): Promise<void> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    console.warn('Zugangsbitte gespeichert, aber ohne GitHub-Zugangsdaten keine Nachricht.');
    return;
  }

  try {
    const gh = githubClient(env.GITHUB_TOKEN, env.GITHUB_REPO);
    const issue = await gh.request<{ number: number }>(`/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Zugang gewünscht: ${vorname} ${nachname}`,
        // Der Name steht im Codeblock: So wird nichts als Markdown gedeutet,
        // was ein Fremder in das Feld geschrieben hat.
        body: [
          'Jemand hat auf dem Anmeldebildschirm um Zugang gebeten:',
          '',
          '```',
          `${vorname} ${nachname}`,
          '```',
          '',
          'Die Bitte steht mitsamt der angegebenen E-Mail-Adresse in der App unter',
          '«Konten verwalten» → «Zugangsbitten». Dort geht beides mit einem Klick:',
          'einen Einladungslink an diese Adresse schicken — dann legt die Person das',
          'Konto selbst an — oder die Bitte verwerfen.',
          '',
          'Dieses Issue ist nur die Nachricht und darf jederzeit geschlossen werden;',
          'es schliesst sich von selbst, sobald jemand die Bitte in der App erledigt.',
          '',
          'Die Bitte kommt von einem nicht angemeldeten Besucher. Name und Adresse',
          'sind ungeprüft — sie sagen nur, wie sich jemand nennt.',
        ].join('\n'),
        labels: [LABEL],
      }),
    });

    await merkeIssueStmt(db, bitteId, issue.number).run();
  } catch (error) {
    // Nur ins Log: Der Besucher hat längst «Danke» gelesen, und die Bitte steht.
    if (error instanceof GitHubError) {
      console.error('GitHub-Fehler bei einer Zugangsbitte:', error.status, error.detail);
      return;
    }
    console.error('Unerwarteter Fehler beim Melden einer Zugangsbitte:', error);
  }
}

/**
 * Auf eine Zeile eindampfen. Zeilenumbrüche zerlegten den Issue-Titel,
 * Backticks brächen den Codeblock im Text auf, Steuerzeichen sind nie gewollt.
 */
function saeubere(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function respond(isForm: boolean, status: number, message: string): Response {
  if (isForm) {
    return status === 200
      ? loginPage({ notice: message, status: 200, bereich: 'zugang' })
      : loginPage({ error: message, status, bereich: 'zugang' });
  }
  const body = status === 200 ? { ok: true, hinweis: message } : { error: message };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
