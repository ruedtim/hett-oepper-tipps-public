/**
 * Ein Name für die App, alle anderen leiten dorthin.
 *
 * Die App lief zuerst unter `hett-oepper-tipps.beispiel.example`. Diese Adresse
 * steht in den Chats der Freunde und muss darum für immer funktionieren — genau
 * wie die Tipp-IDs, die daran hängen. Sie bleibt deshalb als Domain am
 * Pages-Projekt eingetragen und wird hier umgeleitet. Wer sie in Cloudflare
 * entfernt, macht die alten Links kaputt; das ist der eine Handgriff, den man
 * bei dieser Umstellung nicht tun darf.
 *
 * Warum `www` nicht einfach mitausgeliefert wird: Das Sitzungs-Cookie trägt
 * bewusst kein `Domain`-Attribut und gilt damit für exakt einen Hostnamen. Zwei
 * gleichberechtigte Adressen wären zwei getrennte Anmeldungen — und niemand
 * versteht, warum ein «www» ihn wieder aussperrt.
 *
 * Warum in der Function und nicht in `public/_redirects`: Diese Datei kann laut
 * Cloudflare-Doku ausdrücklich KEINE Weiterleitungen zwischen Hostnamen
 * («Domain-level redirects: nicht unterstützt»), und sie greift ohnehin nicht
 * bei Anfragen, die durch eine Function laufen — hier läuft jede durch das Gate.
 *
 * `*.pages.dev` steht mit Absicht NICHT in der Liste: Darüber laufen die
 * Preview-Deployments und der Backup-Job, und beide sollen ihre eigene Adresse
 * behalten. Welche dieser Adressen überhaupt antworten dürfen, entscheidet
 * `abweisungUnbekannterHost()` weiter unten.
 */
export const KANONISCHER_HOST = 'tipps.beispiel.example';

const ALTE_HOSTS = new Set(['hett-oepper-tipps.beispiel.example', 'www.tipps.beispiel.example']);

/**
 * Die wandernde Adresse des Pages-Projekts: Sie zeigt immer auf das JÜNGSTE
 * Produktions-Deployment. Der Backup-Job spricht genau diese an (`APP_URL` in
 * den GitHub-Actions-Variablen) und darf darum nie mitgesperrt werden — `fetch`
 * verliert den `Authorization`-Header bei einer Weiterleitung auf einen anderen
 * Host, weshalb er nicht einfach den kanonischen Namen nehmen kann.
 */
const PAGES_ALIAS = 'hett-oepper-tipps.pages.dev';

const PRODUKTIONS_HOSTS = new Set([KANONISCHER_HOST, PAGES_ALIAS]);

/** `wrangler pages dev` liest die Produktions-Variablen und antwortet hier. */
const LOKALE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Antwortet mit einer Weiterleitung, wenn die Anfrage unter einem alten Namen
 * hereinkam — sonst mit `undefined`, und der Aufrufer macht normal weiter.
 *
 * Der `#`-Teil der Adresse (`#/tipp/wien-café-central`) wird vom Browser nie
 * mitgeschickt und deshalb auch nicht weitergereicht: Er hängt nach der
 * Weiterleitung von selbst wieder dran. Die Hash-Route der App überlebt den
 * Umzug also unangetastet.
 */
export function umleitungAufKanonischenHost(request: Request, url: URL): Response | undefined {
  if (!ALTE_HOSTS.has(url.hostname)) return undefined;

  const ziel = new URL(url);
  ziel.hostname = KANONISCHER_HOST;

  // 301 macht aus einem POST in älteren Clients ein GET — für die Seite selbst
  // egal, für /api/* aber falsch. 308 heisst dasselbe («dauerhaft»), verbietet
  // den Methodenwechsel aber ausdrücklich.
  const status = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
  return Response.redirect(ziel.toString(), status);
}

/**
 * Schliesst die Adressen alter Deployments.
 *
 * Cloudflare Pages baut bei jedem Push ein neues Deployment und räumt die alten
 * NIE auf: Jedes behält für immer seine eigene Adresse
 * `<hash>.hett-oepper-tipps.pages.dev`. Das ist der Rollback-Weg und soll so
 * bleiben — aber ein Produktions-Deployment behält auch seine
 * Produktions-Bindings. Die Adresse von vor drei Wochen ist damit alter Code auf
 * der ECHTEN, heutigen Datenbank.
 *
 * Das ist keine Theorie: Das Deployment vor «Gäste sehen keine Wünsche, Namen
 * und Fotos» liefert einer Gast-Sitzung genau das weiter aus, mit dem
 * Gäste-Passwort, das heute gilt. Jede serverseitige Verschärfung gilt sonst nur
 * vorwärts, während die offene Tür daneben stehen bleibt. Von Hand aufräumen
 * müsste man nach jedem Push; diese Prüfung wirkt auch für künftige.
 *
 * Erlaubt sind darum nur der kanonische Name und der Projekt-Alias — die beiden
 * Adressen, die MITWANDERN. Alles andere unter `pages.dev` ist per Definition ein
 * einzelnes, festgenageltes Deployment.
 *
 * Zwei Dinge, die diese Prüfung ausdrücklich nicht tut:
 *
 * Sie unterscheidet Hash-Adressen nicht am Muster. Ein Branch-Alias
 * (`<branch>.hett-oepper-tipps.pages.dev`) und ein Deployment-Hash sehen gleich
 * aus — ein Branch namens «a1b2c3d4» wäre von einem Hash nicht zu trennen.
 * Stattdessen entscheidet die UMGEBUNG: In der Preview-Welt darf jede Adresse
 * antworten, denn dort hängen laut wrangler.toml die Preview-Datenbank und der
 * Preview-Bucket dran, und Branch-Previews sollen weiter funktionieren. Wer die
 * Preview-Datenbank mit einer echten Kopie füllt, hebt diese Begründung auf.
 *
 * Sie schützt nicht die statischen Dateien. `public/_routes.json` nimmt Bundle
 * und Icons von den Functions aus, die bleiben unter jeder Adresse abrufbar —
 * darin stehen keine Daten, und ohne `/api/data` zeigt das alte Bundle nichts.
 *
 * Fehlt `UMGEBUNG`, gilt die strenge Regel: Vergessen sperrt, es öffnet nicht —
 * dieselbe Richtung wie bei den Secrets im Gate.
 */
export function abweisungUnbekannterHost(
  umgebung: string | undefined,
  url: URL,
): Response | undefined {
  if (LOKALE_HOSTS.has(url.hostname)) return undefined;
  if (umgebung === 'preview') return undefined;
  if (PRODUKTIONS_HOSTS.has(url.hostname)) return undefined;

  // 404 und nicht 403: Eine Adresse, die es nicht geben soll, verrät auch nicht,
  // dass hinter ihr etwas liegt — dieselbe Antwort wie bei den Gäste-Fotos.
  return new Response('Nicht gefunden.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
