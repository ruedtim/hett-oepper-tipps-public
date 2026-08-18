import type { Env } from '../lib/env';
import {
  istErlaubterHost,
  istKurzlink,
  istShareGoogleSeite,
  parsePlaceInput,
} from '../../shared/placeLinks.mjs';

/**
 * Löst Kurzlinks auf — und sonst nichts.
 *
 * Alles andere parst der Browser selbst. Hierher kommt nur, was eine
 * Weiterleitung braucht, weil CORS dem Browser das Folgen verbietet.
 *
 * WARUM POST UND NICHT GET: Das Sitzungs-Cookie ist `SameSite=Lax`. Lax schützt
 * Unterressourcen, aber NICHT eine Navigation per Link — ein GET-Endpunkt liesse
 * sich also durch einen untergeschobenen Link auslösen. POST kann das nicht.
 *
 * WARUM HEAD UND NICHT GET AUF DIE ZIELADRESSE: Gemessen — ein User-Agent, der
 * «Macintosh» enthält, verwandelt bei maps.app.goo.gl die 302 in eine 34-KB-Seite
 * ohne Location-Header. Mit HEAD antworten alle geprüften User-Agents mit 302 und
 * null Bytes. Aus Cloudflares Netz eigens nachgemessen, weil Google
 * Rechenzentrums-IPs anders behandeln könnte: verhält sich gleich.
 *
 * DIE EINE AUSNAHME davon ist google.com/share.google (der zweite Sprung hinter
 * einem share.google-Link aus der Google-Suche): Dort ist es genau umgekehrt —
 * HEAD antwortet 200 ohne Location, erst GET gibt die 301 auf die Such-URL
 * preis, in deren `q` der Ortsname steht. Auch gemessen. Der GET-Rumpf ist eine
 * 252-Byte-«Moved»-Seite, kein 34-KB-Ungetüm.
 */

const MAX_SPRUENGE = 3;
const ZEITLIMIT_MS = 5000;
// Siehe geo.ts: erreichbare Kontaktadresse, folgt dem kanonischen Host.
const USER_AGENT = 'hett-oepper-tipps/1.0 (+https://tipps.beispiel.example)';

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const eingabe = typeof body.url === 'string' ? body.url.trim() : '';
  if (!eingabe) return json({ error: 'Kein Link übergeben.' }, 400);

  let ziel: URL;
  try {
    ziel = new URL(eingabe);
  } catch {
    return json({ error: 'Das ist keine gültige Adresse.' }, 400);
  }

  const abgelehnt = pruefe(ziel);
  if (abgelehnt) return json({ error: abgelehnt }, 400);

  if (!istKurzlink(ziel.hostname) && !istShareGoogleSeite(ziel)) {
    return json({ error: 'Dieser Link braucht keine Auflösung.' }, 400);
  }

  let aktuell = ziel;

  for (let sprung = 0; sprung < MAX_SPRUENGE; sprung += 1) {
    let antwort: Response;
    try {
      antwort = await fetch(aktuell.toString(), {
        method: istShareGoogleSeite(aktuell) ? 'GET' : 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      });
    } catch (fehler) {
      console.error('Kurzlink nicht erreichbar:', fehler);
      return json({ error: 'Der Link liess sich nicht öffnen. Bitte später nochmal.' }, 502);
    }

    // Der Rumpf interessiert nie — nicht liegen lassen, sonst hält er in
    // Workers die Verbindung offen.
    await antwort.body?.cancel();

    const weiter = antwort.headers.get('location');
    if (!weiter) {
      // Keine Weiterleitung mehr — das hier ist die Endadresse.
      return json({ ergebnis: parsePlaceInput(aktuell.toString()), aufgeloest: aktuell.toString() });
    }

    let naechste: URL;
    try {
      naechste = new URL(weiter, aktuell);
    } catch {
      return json({ error: 'Der Link zeigt auf etwas Unlesbares.' }, 502);
    }

    // Der Kern des Ganzen: JEDER Sprung wird erneut geprüft. Eine Allowlist,
    // die nur die erste Adresse ansieht, ist wertlos — der ganze Zweck des
    // Endpunkts ist ja, einer fremden Weiterleitung zu folgen.
    const problem = pruefe(naechste);
    if (problem) {
      console.error('Weiterleitung auf unerlaubtes Ziel:', naechste.hostname);
      return json({ error: 'Der Link führt woandershin als erwartet.' }, 400);
    }

    aktuell = naechste;

    if (!istKurzlink(aktuell.hostname) && !istShareGoogleSeite(aktuell)) {
      return json({ ergebnis: parsePlaceInput(aktuell.toString()), aufgeloest: aktuell.toString() });
    }
  }

  return json({ error: 'Der Link leitet zu oft weiter.' }, 400);
};

/** @returns Grund der Ablehnung, oder null wenn in Ordnung. */
function pruefe(url: URL): string | null {
  if (url.protocol !== 'https:') return 'Nur https-Adressen.';
  // Zugangsdaten in der Adresse sind der klassische Weg, eine Hostprüfung zu
  // täuschen: https://maps.app.goo.gl@boeser-host.example/
  if (url.username || url.password) return 'Diese Adresse sieht manipuliert aus.';
  // Rohe IP-Adressen umgehen jede Namensliste.
  if (/^\[|^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return 'Diese Adresse sieht manipuliert aus.';
  if (!istErlaubterHost(url.hostname)) return 'Aus diesem Link kann die App nichts lesen.';
  return null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
