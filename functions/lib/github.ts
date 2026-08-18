/**
 * Der schmale Ausschnitt der GitHub-REST-API, den diese App noch braucht: zwei
 * Endpunkte schreiben Issues — Rückmeldungen (api/feedback.ts) und Bitten um
 * Zugang (api/zugang.ts). Alles andere — Commits, Verlauf, Rückgängigmachen —
 * lebt seit der D1-Umstellung in der Datenbank; das tägliche Backup ins Repo
 * schreibt der GitHub-Actions-Workflow mit seinem eigenen Token, nicht diese App.
 *
 * Die beiden Endpunkte stehen unter GEGENSÄTZLICHEN Voraussetzungen: Rückmeldung
 * setzt eine Sitzung voraus, die Zugangsbitte kann es per Definition nicht. Wer
 * hier etwas ändert, lese beide Kopfkommentare — der Spam-Schutz sitzt deshalb
 * nicht hier, sondern in api/zugang.ts.
 *
 * Authentifiziert wird mit einem Fine-grained PAT, der nur auf dieses eine
 * Repo zeigt und Issues schreiben darf.
 */

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`GitHub ${status}: ${detail}`);
    this.name = 'GitHubError';
  }

  /** Token abgelaufen, zurückgezogen oder mit zu wenig Rechten. */
  get isAuthProblem(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface GitHubClient {
  repo: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}

export function githubClient(token: string, repo: string): GitHubClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'hett-oepper-tipps',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      // Der Text von GitHub bleibt im Log, geht aber nie an den Browser zurück —
      // eine durchgereichte Fehlerantwort kann Header oder Tokenfragmente enthalten.
      const detail = await response.text().catch(() => '');
      throw new GitHubError(response.status, detail.slice(0, 500));
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  return { repo, request };
}
