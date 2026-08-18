import type { Env } from '../lib/env';
import { githubClient, GitHubError } from '../lib/github';
import type { RequestData } from '../lib/users';

/**
 * Rückmeldungen aus der App landen als GitHub-Issue.
 *
 * Bewusst getrennt von /api/submit: Ein Vorschlag ändert Daten und wird
 * zusammengeführt, eine Rückmeldung ist eine Nachricht und wird gelesen.
 * Deshalb ein Issue und kein Pull Request.
 *
 * Der Endpunkt liegt hinter dem Passwort-Gate — ohne gültige Sitzung kommt
 * niemand hierher. Einen zusätzlichen Spam-Schutz braucht es darum nicht.
 */

const MAX_TEXT = 4000;
const MAX_OPEN_FEEDBACK = 100;

export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ request, env, data }) => {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return problem(503, 'Rückmeldungen sind noch nicht eingerichtet.');
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Wer schreibt, steht seit den Konten fest — kein Namensfeld mehr im Formular.
  const by = data.user.name;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  // Wo war die Person, als ihr etwas auffiel? Erspart die Rückfrage «auf welcher Seite?».
  const from = typeof body.from === 'string' ? body.from.trim().slice(0, 200) : '';

  if (!text) return problem(400, 'Bitte schreib kurz, worum es geht.');
  if (text.length > MAX_TEXT) return problem(400, `Bitte auf ${MAX_TEXT} Zeichen kürzen.`);

  const gh = githubClient(env.GITHUB_TOKEN, env.GITHUB_REPO);

  try {
    const open = await gh.request<{ number: number }[]>(
      `/repos/${env.GITHUB_REPO}/issues?state=open&labels=feedback&per_page=100`,
    );
    if (open.length >= MAX_OPEN_FEEDBACK) {
      return problem(429, 'Es liegen gerade sehr viele Rückmeldungen. Bitte später nochmal.');
    }

    const lines = [
      text,
      '',
      '---',
      `Von: ${by}`,
      ...(from ? [`Aus der App: \`${from}\``] : []),
    ];

    const issue = await gh.request<{ number: number; html_url: string }>(
      `/repos/${env.GITHUB_REPO}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: summarise(text, by),
          body: lines.join('\n'),
          labels: ['feedback'],
        }),
      },
    );

    return Response.json(
      { ok: true, issue: issue.number, url: issue.html_url },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof GitHubError) {
      console.error('GitHub-Fehler bei einer Rückmeldung:', error.status, error.detail);
      if (error.status === 401 || error.status === 403) {
        return problem(
          502,
          'Rückmeldung geht gerade nicht — dem GitHub-Zugang fehlt das Recht, Issues zu schreiben.',
        );
      }
      if (error.status === 410) {
        return problem(
          502,
          'Issues sind im Repo deaktiviert. Ein Admin muss sie in den Repo-Einstellungen einschalten.',
        );
      }
      return problem(502, `GitHub hat nicht mitgespielt (${error.status}). Bitte später nochmal.`);
    }
    console.error('Unerwarteter Fehler bei einer Rückmeldung:', error);
    return problem(500, 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.');
  }
};

/** Erste Zeile als Titel, damit die Issue-Liste lesbar bleibt. */
function summarise(text: string, by: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const short = firstLine.length > 70 ? `${firstLine.slice(0, 67).trimEnd()}…` : firstLine;
  return short ? `${short} (${by})` : `Rückmeldung von ${by}`;
}

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
