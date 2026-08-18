/**
 * Eine geteilte Tipp-Liste — der einzige Weg, auf dem jemand OHNE Konto etwas
 * aus der Sammlung sieht.
 *
 * Diese Datei liegt VOR dem Gate (Ausnahme in `functions/_middleware.ts`) und
 * prüft deshalb alles selbst, fail-closed. Wer den Link hat, hat die
 * Berechtigung — etwas anderes kann es hier nicht geben, denn genau für Leute
 * ohne Passwort ist er da. Dafür ist der Link 100 Bit lang, gilt 90 Tage und
 * ist einzeln widerrufbar.
 *
 * Sie exportiert `onRequest` und nicht `onRequestGet`, und das ist keine
 * Geschmacksfrage: Der Pages-Router matcht Pfad UND Methode. Gäbe es hier nur
 * einen GET-Handler, wäre ein POST für ihn kein Treffer und fiele auf die
 * statischen Assets durch — am Gate vorbei. Mit `onRequest` gibt es unter
 * `/geteilt/` keine Methode und keinen Unterpfad, den der Router weiterreicht.
 *
 * Zwei Formen werden beantwortet:
 *
 *   /geteilt/<id>                          die Seite
 *   /geteilt/<id>/foto/<tipId>/<datei>     ein Foto daraus
 *
 * Die Fotos hängen unter der Link-ID, weil die Berechtigung am Link hängt: Ein
 * Foto-Pfad ohne sie wäre wieder eine offene Tür.
 */

import { heuteIso } from '../../shared/datum.mjs';
import { searchKey } from '../../shared/normalize.mjs';
import { buildGeteilteAnsicht } from '../lib/appdata';
import { configurationError, missingSecrets } from '../lib/env';
import type { Env } from '../lib/env';
import { photoContentType } from '../lib/fotos';
import { getGueltigeListe, ID_MUSTER, tippIdsOf } from '../lib/geteilt';
import { geteiltSeite, linkWegSeite } from '../lib/geteiltSeite';
import { getUserById, nameKeysOf } from '../lib/users';

/**
 * Dieselbe Schlüsselform wie in functions/photos/[[path]].ts, plus ein
 * ausdrückliches Nein zu `trash/`.
 *
 * Das Muster im Gate ist eine reine FORMprüfung — die Berechtigung entscheidet
 * diese Datei. Dass der Papierkorb unerreichbar bleibt, folgte bisher nur
 * mittelbar daraus, dass der Tipp in der eingefrorenen Liste stehen muss; das
 * `(?!trash/)` macht die Zusage an der Stelle wahr, an der sie steht, statt sie
 * aus zwei anderen Prüfungen herleiten zu müssen.
 */
const FOTO_TEIL =
  /^foto\/(?!trash\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|jpg))$/;

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  // Auch das Gate prüft das schon, ganz oben. Hier trotzdem nochmal, wie
  // `passwort-neu.ts` es hält: Diese Datei geht an der Sitzungsprüfung vorbei
  // und soll sich nicht darauf verlassen, dass jemand anders vorher aufgepasst hat.
  const fehlend = missingSecrets(env);
  if (fehlend.length > 0) return configurationError(fehlend);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Nicht erlaubt.\n', {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const roh = params.pfad;
  const teile = Array.isArray(roh) ? roh : [String(roh ?? '')];
  const [id, ...rest] = teile;
  if (!id || !ID_MUSTER.test(id)) return linkWegSeite();

  const db = env.DB as D1Database;
  const heute = heuteIso();

  // Zwei D1-Reads für jede der beiden Formen: der Link und die Kontozeile
  // dahinter. Ein deaktiviertes Konto veröffentlicht nichts mehr — dieselbe
  // Sofortwirkung wie im Gate, und deshalb hier beim LESEN geprüft und nicht
  // per DELETE beim Deaktivieren.
  const liste = await getGueltigeListe(db, id, heute);
  if (!liste) return linkWegSeite();

  const besitzer = await getUserById(db, liste.von_id);
  if (!besitzer || besitzer.disabled === 1) return linkWegSeite();

  const tippIds = tippIdsOf(liste);

  if (rest.length === 0) {
    const ansicht = await buildGeteilteAnsicht(db, tippIds, nameKeysOf(besitzer));
    return geteiltSeite({
      von: besitzer.name,
      tips: ansicht.tips,
      categories: ansicht.categories,
      verschwunden: ansicht.verschwunden,
      bis: liste.bis,
      basis: `/geteilt/${id}`,
    });
  }

  const treffer = FOTO_TEIL.exec(rest.join('/'));
  if (!treffer) return linkWegSeite();
  const [, tipId, datei] = treffer as unknown as [string, string, string];

  return fotoAusliefern(db, env, { tipId, datei, tippIds, besitzerKeys: nameKeysOf(besitzer) });
};

/**
 * Ein Foto aus einer geteilten Liste.
 *
 * Hier wird «nur die eigenen Fotos» tatsächlich durchgesetzt und nicht bloss in
 * der Ausgabe weggelassen — dieselbe Haltung wie in `appdata.ts`: Was jemand
 * einmal geraten hat, bliebe sonst abrufbar.
 */
async function fotoAusliefern(
  db: D1Database,
  env: Env,
  { tipId, datei, tippIds, besitzerKeys }: {
    tipId: string;
    datei: string;
    tippIds: string[];
    besitzerKeys: string[];
  },
): Promise<Response> {
  if (!tippIds.includes(tipId)) return nichtGefunden();

  // Verglichen wird gegen den AKTUELLEN Dateinamen der Notiz. Damit fällt ein
  // inzwischen ersetztes Foto von selbst heraus: Der alte Schlüssel liegt in
  // trash/ und steht in keiner Zeile mehr.
  const notiz = await db
    .prepare('SELECT "by" FROM notes WHERE tip_id = ?1 AND photo = ?2')
    .bind(tipId, datei)
    .first<{ by: string }>();
  if (!notiz) return nichtGefunden();

  // Der Vergleich muss in JS laufen: `searchKey` gibt es in SQL nicht.
  if (!new Set(besitzerKeys).has(searchKey(notiz.by))) return nichtGefunden();

  const schluessel = `${tipId}/${datei}`;
  const objekt = await (env.FOTOS as R2Bucket).get(schluessel);
  if (!objekt) return nichtGefunden();

  return new Response(objekt.body, {
    headers: {
      'Content-Type': photoContentType(schluessel),
      // Anders als unter /photos/ NICHT ein Jahr lang unveränderlich: Dort ist
      // die Berechtigung dauerhaft, hier ist sie widerrufbar — und «einzeln
      // widerrufbar» ist der halbe Zweck dieses Features. Ein Zwischenspeicher,
      // der einen zurückgenommenen Link weiter bedient, machte die Rücknahme
      // zur blossen Behauptung.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function nichtGefunden(): Response {
  return new Response('Nicht gefunden.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
