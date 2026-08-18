import { searchKey } from '../../shared/normalize.mjs';
import type { Env } from '../lib/env';
import { githubClient, GitHubError } from '../lib/github';
import { loginPage } from '../lib/loginPage';

/**
 * «Gib mir bitte Zugang!» — die Bitte um ein Konto, als GitHub-Issue.
 *
 * Der einzige Endpunkt der App, der etwas nach draussen schickt, OHNE dass
 * jemand angemeldet ist (die Ausnahme dafür steht in functions/_middleware.ts).
 * Damit gilt die Begründung aus api/feedback.ts hier ausdrücklich NICHT: Dort
 * trägt das Passwort-Gate den Spam-Schutz, hier gibt es keines. Deshalb:
 *
 *  1. Ein Deckel auf gleichzeitig offenen Bitten. Er begrenzt nicht die Zahl der
 *     Versuche, sondern den Schaden — mehr als MAX_OFFEN Issues kann niemand
 *     erzeugen, egal wie oft er drückt. Solange der Besitzer die Bitten
 *     abarbeitet (schliessen genügt), bleibt der Weg offen.
 *  2. Dieselbe Bitte zweimal ergibt kein zweites Issue. Bremst den offensicht-
 *     lichsten Missbrauch und erspart dem Besitzer Dubletten, wenn jemand
 *     ungeduldig nochmal drückt.
 *  3. Nur ein Name, nichts sonst. Kein Freitext heisst keine Bühne für Texte,
 *     die woanders gelesen werden sollen.
 *
 * Ein eigenes Label, NICHT `zugang`: Unter `zugang` sammelt
 * .github/workflows/expiry-check.yml die Warnungen über ablaufende Zugangsdaten
 * und öffnet dort kein zweites Issue, solange eines offen ist. Eine Bitte um ein
 * Konto unter demselben Label würde diese Warnungen stillschweigend
 * unterdrücken — und die kommen einmal pro Jahr und dürfen nicht ausfallen.
 */

const LABEL = 'zugangswunsch';
const MAX_OFFEN = 10;
const MAX_NAME = 40;
const MIN_NAME = 2;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Ohne JavaScript kommt ein normales Formular an, mit JavaScript JSON —
  // dieselbe Unterscheidung wie in api/login.ts.
  const contentType = request.headers.get('Content-Type') ?? '';
  const isForm = contentType.includes('form');

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return respond(isForm, 503, 'Das geht gerade nicht. Bitte wende dich direkt an die Runde.');
  }

  let roh = '';
  if (isForm) {
    const form = await request.formData();
    roh = String(form.get('name') ?? '');
  } else {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    roh = typeof body.name === 'string' ? body.name : '';
  }

  const name = saeubere(roh);
  if (name.length < MIN_NAME || name.length > MAX_NAME) {
    return respond(isForm, 400, `Bitte einen Namen mit ${MIN_NAME} bis ${MAX_NAME} Zeichen.`);
  }
  // Dieselbe Hürde wie beim Anlegen eines Kontos: Was keinen Anmeldenamen
  // ergibt, hilft dem Besitzer auch als Bitte nicht weiter.
  if (!searchKey(name)) {
    return respond(isForm, 400, `«${name}» ergibt keinen brauchbaren Namen.`);
  }

  const titel = `Zugang gewünscht: ${name}`;
  const gh = githubClient(env.GITHUB_TOKEN, env.GITHUB_REPO);

  try {
    const offen = await gh.request<{ number: number; title: string }[]>(
      `/repos/${env.GITHUB_REPO}/issues?state=open&labels=${LABEL}&per_page=100`,
    );

    // «Tim» und «tim» sind dieselbe Bitte — searchKey ist im Projekt genau die
    // Normalisierung für Vergleiche, die in beide Richtungen treffen müssen.
    const schonDa = offen.some((issue) => searchKey(issue.title) === searchKey(titel));
    if (schonDa) return respond(isForm, 200, DANKE);

    if (offen.length >= MAX_OFFEN) {
      return respond(
        isForm,
        429,
        'Es liegen gerade viele Anfragen. Bitte später nochmal — oder frag direkt in der Runde.',
      );
    }

    await gh.request(`/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: titel,
        // Der Name steht im Codeblock: So wird nichts als Markdown gedeutet,
        // was ein Fremder in das Feld geschrieben hat.
        body: [
          'Jemand hat auf dem Anmeldebildschirm um Zugang gebeten und diesen Namen angegeben:',
          '',
          '```',
          name,
          '```',
          '',
          'Wenn das jemand aus der Runde ist: Konto anlegen unter «Konten verwalten»',
          'und das Startpasswort persönlich weitergeben — nicht hier hineinschreiben.',
          'Wenn nicht: Issue schliessen, damit der Platz wieder frei wird.',
          '',
          'Diese Bitte kommt von einem nicht angemeldeten Besucher. Der angegebene',
          'Name ist ungeprüft — er sagt nur, wie sich jemand nennt.',
        ].join('\n'),
        labels: [LABEL],
      }),
    });

    return respond(isForm, 200, DANKE);
  } catch (error) {
    if (error instanceof GitHubError) {
      console.error('GitHub-Fehler bei einer Zugangsbitte:', error.status, error.detail);
      // Nach draussen immer dieselbe, harmlose Auskunft: Ein Fremder soll aus
      // der Antwort nichts über das Repo oder den Zustand des Tokens lernen.
      return respond(isForm, 502, 'Das hat gerade nicht geklappt. Bitte später nochmal.');
    }
    console.error('Unerwarteter Fehler bei einer Zugangsbitte:', error);
    return respond(isForm, 500, 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.');
  }
};

const DANKE = 'Danke — die Bitte ist angekommen. Jemand aus der Runde meldet sich.';

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
