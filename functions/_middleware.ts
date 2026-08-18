import { configurationError, missingSecrets } from './lib/env';
import type { Env } from './lib/env';
import { abweisungUnbekannterHost, umleitungAufKanonischenHost } from './lib/hosts';
import { loginPage } from './lib/loginPage';
import { fingerprint, parseSession, readCookie, SESSION_COOKIE } from './lib/session';
import { getUserById, toSessionUser } from './lib/users';
import type { RequestData } from './lib/users';

/**
 * Das Konten-Gate.
 *
 * Eine Middleware unter functions/_middleware.ts läuft laut Cloudflare-Doku
 * «on your entire application, including in front of static files» und darf eine
 * eigene Antwort zurückgeben. Damit ist der Schutz serverseitig und nicht bloss
 * ein JavaScript-Vorhang, hinter dem die Daten trotzdem abrufbar wären.
 *
 * Was ohne Anmeldung erreichbar bleibt, steht in public/_routes.json: nur das
 * JS/CSS-Bundle, Icons und robots.txt. Alles Inhaltliche — die Seite selbst,
 * /api/data, /photos/* und /api/* — läuft hier durch.
 *
 * Die Prüfung ist zweistufig: Erst die HMAC-Signatur des Cookies (kostenlos),
 * dann EIN D1-Read auf die Benutzerzeile — deaktivierte Konten und alte
 * Passwörter fliegen damit beim nächsten Request raus, nicht erst nach einem
 * Jahr. Bei ein paar tausend Requests am Tag gegen 5 Mio. erlaubte D1-Reads
 * ist das kein Budget-Thema.
 *
 * Derselbe D1-Read trägt den Gäste-Zugang: Ist die Zeile der Gast, endet hier
 * jede Methode ausser GET und HEAD. «Nur lesen» steht damit an einer Stelle und
 * nicht in vierzehn Endpunkten.
 */
/**
 * Die zwei Formen, die functions/geteilt/[[pfad]].ts beantwortet: die Seite und
 * ein Foto daraus. Bewusst ein Muster und kein Präfix — die Begründung steht
 * unten bei der Ausnahme.
 */
const GETEILTER_PFAD =
  /^\/geteilt\/[0-9a-z]{20}(?:\/foto\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|jpg))?$/;

export const onRequest: PagesFunction<Env, string, RequestData> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  // Erst nach der Secret-Prüfung, nicht davor: Das Gate bleibt der erste
  // Handgriff dieser Datei. Eine fehlkonfigurierte Bereitstellung antwortet
  // damit unter jedem Namen mit 503, statt Besucher auf eine Adresse zu
  // schicken, die auch nichts ausliefern kann.
  const umleitung = umleitungAufKanonischenHost(request, url);
  if (umleitung) return umleitung;

  // Nach der Weiterleitung, nicht davor: Die alten Namen stehen nicht in der
  // Liste der erlaubten Hosts — zuerst geprüft, liefen die Tipp-Links aus den
  // Chats ins 404 statt auf die Seite. Und vor allen Ausnahmen unten: Eine
  // gesperrte Adresse darf auch nicht anmelden oder exportieren können.
  const abweisung = abweisungUnbekannterHost(env.UMGEBUNG, url);
  if (abweisung) return abweisung;

  // Ohne diese Ausnahme könnte sich niemand anmelden: Der Endpunkt, der das
  // Cookie ausstellt, liegt sonst selbst hinter dem Cookie. Bewusst auf die
  // beiden definierten Methoden begrenzt — ein GET fiele sonst mangels Handler
  // auf die statischen Assets durch, am Gate vorbei.
  if (url.pathname === '/api/login' && (request.method === 'POST' || request.method === 'DELETE')) {
    return next();
  }

  // «Gib mir bitte Zugang!» vom Anmeldebildschirm — wer noch kein Konto hat,
  // kann per Definition keines vorweisen. Exakter Pfad und exakt POST, aus
  // demselben Grund wie oben: Jede andere Methode fiele mangels Handler auf die
  // statischen Assets durch, am Gate vorbei. Der Endpunkt schützt sich selbst
  // (Deckel auf offene Issues), denn hier hilft keine Sitzung.
  if (url.pathname === '/api/zugang' && request.method === 'POST') {
    return next();
  }

  // Die drei Wege rund um die E-Mail-Adresse. Alle drei können per Definition
  // keine Sitzung voraussetzen: Wer sein Passwort vergessen hat, kommt nicht
  // hinein, und der Link aus dem Postfach wird oft in einem anderen Browser
  // geöffnet als dem, in dem jemand angemeldet ist.
  //
  // Wieder exakter Pfad und exakt die Methoden, für die es einen Handler gibt —
  // jede andere fiele auf die statischen Assets durch, am Gate vorbei. Den
  // Missbrauch begrenzen die Endpunkte selbst: «Passwort vergessen» antwortet
  // immer gleich und verschickt höchstens alle 15 Minuten pro Konto, die beiden
  // Seiten verlangen einen signierten, kurzlebigen Token.
  if (url.pathname === '/api/passwort-vergessen' && request.method === 'POST') {
    return next();
  }
  if (
    url.pathname === '/passwort-neu' &&
    (request.method === 'GET' || request.method === 'POST')
  ) {
    return next();
  }
  if (url.pathname === '/email-bestaetigen' && request.method === 'GET') {
    return next();
  }

  // Eine geteilte Tipp-Liste — der einzige Weg, auf dem jemand OHNE Konto etwas
  // aus der Sammlung sieht. Wer den Link hat, hat die Berechtigung; etwas
  // anderes kann es hier nicht geben, denn genau für Leute ohne Passwort ist er
  // da. Dafür ist er 100 Bit lang, gilt 90 Tage, ist einzeln widerrufbar, und
  // die Function prüft alles Weitere selbst (fail-closed).
  //
  // Ein Muster statt eines Präfixes, aus demselben Grund wie bei den exakten
  // Pfaden oben: Ein Präfix «/geteilt/» liesse JEDEN Unterpfad durch, auch die,
  // für die es keinen Handler gibt — und die fielen mangels Treffer auf die
  // statischen Assets durch, am Gate vorbei. Das Muster lässt nur die zwei
  // Formen durch, die die Function auch wirklich beantwortet; alles andere
  // unter /geteilt/ landet wie bisher beim Anmeldeformular.
  //
  // Und die Methoden ausdrücklich, wie überall hier. Aus demselben Grund
  // exportiert functions/geteilt/[[pfad]].ts `onRequest` statt `onRequestGet`:
  // Der Pages-Router matcht Pfad UND Methode, ein fehlender Handler ist für ihn
  // kein Treffer, und das Loch wäre dasselbe.
  if (
    GETEILTER_PFAD.test(url.pathname) &&
    (request.method === 'GET' || request.method === 'HEAD')
  ) {
    return next();
  }

  // Der Backup-Job hat kein Konto und kein Cookie — er weist sich mit einem
  // Bearer-Token aus, und das prüft der Export-Endpunkt selbst (fail-closed).
  // Nur die zwei exakten Pfade: Ein breiteres Präfix fiele bei unbekannten
  // Unterpfaden ebenfalls auf die Assets durch.
  if (
    (url.pathname === '/api/export' || url.pathname === '/api/export/photo') &&
    request.headers.get('Authorization')
  ) {
    return next();
  }

  const secret = env.SESSION_SECRET as string;
  const db = env.DB as D1Database;

  const session = await parseSession(secret, readCookie(request, SESSION_COOKIE));
  if (session) {
    let user;
    try {
      user = await getUserById(db, session.userId);
    } catch (error) {
      // Fail-closed: Ist die Datenbank nicht erreichbar, wird gesperrt statt
      // durchgelassen — dieselbe Regel wie bei fehlenden Secrets.
      console.error('D1 im Gate nicht erreichbar:', error);
      return new Response('Die Datenbank ist gerade nicht erreichbar. Bitte später nochmal.\n', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (user && user.disabled === 0 && session.fp === (await fingerprint(user.password_hash))) {
      // «Nur schauen» wird hier erzwungen, an genau einer Stelle, und über die
      // METHODE statt über eine Liste von Pfaden: Ein künftiger Schreib-Endpunkt
      // ist damit automatisch dicht, ohne dass jemand daran denken muss. Das ist
      // dieselbe Fail-closed-Regel wie bei den Secrets oben — Vergessen sperrt,
      // es öffnet nicht.
      //
      // Abmelden bleibt möglich: DELETE /api/login ist oben schon abgebogen.
      if (user.is_guest === 1 && request.method !== 'GET' && request.method !== 'HEAD') {
        return Response.json(
          { error: 'Der Gäste-Zugang darf nur schauen. Für Beiträge braucht es ein eigenes Konto.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      // Fotos sieht ein Gast nicht. Das ist die zweite Hälfte der Kürzung in
      // functions/lib/appdata.ts: Dort fallen die Dateinamen aus der Antwort,
      // hier die Bytes. Ohne diese Zeile bliebe alles, was jemand einmal
      // gesehen oder geraten hat, weiter abrufbar — und die Backup-Kopien unter
      // public/photos/ liegen ebenfalls in diesem Pfad.
      //
      // Anders als beim Schreiben MUSS das hier ein Pfad sein: Ein Lesezugriff,
      // den man verbergen will, lässt sich nicht an der Methode erkennen. Wer
      // eine weitere Stelle baut, die Fotos ausliefert, muss sie hier nennen.
      //
      // Hiermit genannt: Seit den geteilten Listen gibt es eine ZWEITE Stelle,
      // /geteilt/<id>/foto/<tipId>/<datei>. Sie steht bewusst NICHT in dieser
      // Bedingung, und das ist kein Versehen — sie liegt vor dem Gate, ein Gast
      // kommt hier also gar nicht erst vorbei. Das ist richtig so: Wer einen
      // Freigabelink hat, ist gegenüber dieser Liste ein Fremder mit einem Link,
      // und ob er daneben noch das Gäste-Passwort kennt, ändert daran nichts.
      // Die Zeile unten schützt die Sammlung, nicht das, was jemand aus ihr
      // ausdrücklich herausgegeben hat.
      //
      // Was ein Freigabelink zeigt, entscheidet deshalb allein
      // functions/geteilt/[[pfad]].ts — mit einer eigenen Prüfung pro Foto (Link
      // gültig, Tipp in der Liste, Notiz gehört der teilenden Person) statt mit
      // einem Durchreichen an R2. Wer eine DRITTE Stelle baut, muss sich hier
      // entscheiden: hinter dem Gate → diese Zeile ergänzen; davor → eine eigene
      // Prüfung mitbringen.
      if (user.is_guest === 1 && url.pathname.startsWith('/photos/')) {
        return new Response('Nicht gefunden.\n', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      context.data.user = toSessionUser(user);
      return next();
    }
  }

  // Für Programme eine Fehlermeldung, für Menschen ein Anmeldeformular.
  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'Nicht angemeldet.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return loginPage();
};
