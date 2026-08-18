/**
 * Ortsangaben aus eingefügten Links lesen.
 *
 * Wird vom Browser UND von der Function benutzt — dasselbe Muster wie
 * shared/normalize.mjs. Der Browser parst alles, was er ohne Netz kann; nur
 * Kurzlinks gehen über den Server, weil ihm CORS das Folgen der Weiterleitung
 * verbietet.
 *
 * Die Regeln unten stammen aus Messungen an echten Teilen-Links. Sie sehen
 * kleinlich aus, aber jede einzelne verhindert einen Pin, der still an der
 * falschen Stelle landet statt zu krachen:
 *
 *   • `@lat,lng` ist die KARTENMITTE, nicht der Ort. In 17 von 17 gemessenen
 *     Links wich sie ab — meist 100–500 m, im Extremfall 1341 km.
 *   • `!3d` ist Breite, `!4d` Länge. `!1d` ist LÄNGE, `!2d` BREITE — im selben
 *     Datenblock umgekehrt.
 *   • Etwa 43 % der echten Kurzlinks zeigen auf gar keinen Ort, sondern auf
 *     Rezensionen, Fotos oder Listen.
 */

/** Kurzlink-Hosts, die aufgelöst werden müssen. */
const KURZLINK_HOSTS = [
  'maps.app.goo.gl',
  'app.goo.gl',
  'goo.gl',
  'g.co',
  'share.google',
];

/** Alle erlaubten Ziele, inklusive Länderdomänen von Google. */
const GOOGLE_HOST = /^(?:(?:www|maps)\.)?google(?:\.[a-z]{2,3})?\.[a-z]{2,3}$/;
const APPLE_HOST = /^maps\.apple\.com$/;
const OSM_HOST = /^(?:www\.)?(?:openstreetmap\.org|osm\.org)$/;

export function istErlaubterHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return (
    KURZLINK_HOSTS.includes(h) || GOOGLE_HOST.test(h) || APPLE_HOST.test(h) || OSM_HOST.test(h)
  );
}

export function istKurzlink(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return KURZLINK_HOSTS.includes(h);
}

/**
 * Die Zwischenseite hinter «Teilen» aus der Google-SUCHE (nicht Maps):
 * share.google leitet erst auf google.com/share.google?q=<Token>, und erst
 * DIESE Seite leitet auf die Such-URL weiter, in deren `q` der Ortsname steht.
 * Sie ist also kein Endziel, sondern der zweite Sprung eines Kurzlinks.
 * Achtung beim Auflösen: Diese Seite verrät ihr Ziel nur bei GET —
 * HEAD antwortet 200 ohne Location (gemessen; api/link.ts weiss das).
 */
export function istShareGoogleSeite(url) {
  const host = String(url.hostname ?? '').toLowerCase().replace(/\.$/, '');
  return GOOGLE_HOST.test(host) && /^\/share\.google/.test(url.pathname);
}

/**
 * @typedef {Object} Ortsangabe
 * @property {'ort'|'kurzlink'|'unbrauchbar'|'unbekannt'} art
 * @property {{lat:number,lng:number}|null} coords
 * @property {'exakt'|'ungefaehr'|null} genauigkeit  «ungefaehr» heisst: unbedingt auf der Karte prüfen
 * @property {string|null} name
 * @property {string|null} suchtext   Für die Ortssuche, wenn keine Koordinaten drinstehen
 * @property {string|null} url        Nur bei art==='kurzlink': die aufzulösende Adresse
 * @property {string|null} grund      Nur bei art==='unbrauchbar': was der Person zu sagen ist
 */

/** @returns {Ortsangabe} */
function leer(art, grund = null) {
  return { art, coords: null, genauigkeit: null, name: null, suchtext: null, url: null, grund };
}

/**
 * Liest eine eingefügte Zeichenkette. Erkennt auch rohe Koordinaten.
 * @returns {Ortsangabe}
 */
export function parsePlaceInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return leer('unbekannt');

  const rohe = parseKoordinaten(text);
  if (rohe) {
    return { ...leer('ort'), coords: rohe, genauigkeit: 'exakt' };
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return leer('unbekannt');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return leer('unbrauchbar', 'Das ist keine Web-Adresse.');
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (istKurzlink(host) || istShareGoogleSeite(url)) {
    return { ...leer('kurzlink'), url: url.toString() };
  }
  if (GOOGLE_HOST.test(host)) return parseGoogle(url);
  if (APPLE_HOST.test(host)) return parseApple(url);
  if (OSM_HOST.test(host)) return parseOsm(url);

  return leer('unbrauchbar', 'Aus diesem Link kann die App nichts lesen.');
}

/** «48.8731, 2.3779» oder «48.8731,2.3779» — was man aus anderen Apps kopiert. */
export function parseKoordinaten(text) {
  const treffer = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!treffer) return null;
  const lat = Number(treffer[1]);
  const lng = Number(treffer[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Rückfallstufen für die Ortssuche, vom genauesten zum gröbsten.
 *
 * Google und Apple geben beim Teilen «Name, Strasse Nr, PLZ Ort, Land» heraus.
 * Steht das Lokal im OpenStreetMap-Verzeichnis, trifft der volle Text — steht
 * es dort nicht, findet er GAR nichts, obwohl die reine Adresse
 * hausnummerngenau verzeichnet ist (gemessen an einem Restaurant in Dortmund:
 * voller Text null Treffer, Adresse ohne Namen exakt). Dann ist der Teil nach
 * dem ersten Komma der bessere zweite Versuch.
 *
 * Der Rest muss eine Ziffer tragen (Hausnummer oder Postleitzahl), sonst ist
 * er keine Adresse, sondern nur ein Ortsname — «Khareba, Dortmund» ohne diese
 * Regel ergäbe die Stadtmitte von Dortmund, einen Pin an der falschen Stelle.
 *
 * @returns {string[]} Suchtexte in der Reihenfolge, in der sie zu probieren sind.
 */
export function suchtextStufen(text) {
  const voll = String(text ?? '').trim();
  if (!voll) return [];

  const stufen = [voll];
  const komma = voll.indexOf(',');
  if (komma > -1) {
    const adresse = voll.slice(komma + 1).trim();
    if (adresse && /\d/.test(adresse)) stufen.push(adresse);
  }
  return stufen;
}

// ---------------------------------------------------------------- Google ---

function parseGoogle(url) {
  const pfad = decodeURIComponent(url.pathname);

  // Was gar kein Ort ist. Ohne diese Prüfung entstünde entweder ein Absturz
  // oder — schlimmer — ein Pin an einer beliebigen Stelle.
  if (/^\/maps\/reviews/.test(pfad) || /^\/maps\/contrib/.test(pfad)) {
    return leer('unbrauchbar', 'Das ist eine geteilte Rezension, kein Ort.');
  }
  if (/^\/maps\/placelists/.test(pfad)) {
    return leer('unbrauchbar', 'Das ist eine geteilte Liste, kein einzelner Ort.');
  }
  if (/^\/maps\/d\//.test(pfad)) {
    return leer('unbrauchbar', 'Das ist eine eigene Karte («My Maps»), kein einzelner Ort.');
  }
  if (/!3e3/.test(url.href) && /^\/maps\/@/.test(pfad)) {
    return leer('unbrauchbar', 'Das ist ein geteiltes Foto, kein Ort.');
  }
  const { name, suchtext } = leseBezeichnung(url, pfad);

  // Eine Route ist kein Ort. Sie enthält mehrere Koordinatenpaare, eines pro
  // Wegpunkt — welches gemeint ist, lässt sich nicht sicher sagen. Also nur der
  // Zielname als Suchtext, und den Punkt bestätigt man auf der Karte.
  if (/^\/maps\/dir\//.test(pfad)) {
    const ziele = pfad
      .replace(/^\/maps\/dir\//, '')
      .split('/')
      // `@…` ist der Kartenausschnitt und `data=…` der Datenblock — beides
      // steht am Ende des Pfads und ist kein Zielname.
      .filter((teil) => teil && !teil.startsWith('@') && !teil.startsWith('data='));
    const ziel = ziele[ziele.length - 1] ?? null;
    // `/maps/dir/?api=1&destination=…` hat gar keine Wegpunkte im Pfad — dort
    // steht das Ziel im Parameter.
    const ausPfad = brauchbarerText(ziel ? ziel.replace(/\+/g, ' ') : null);
    return { ...leer('ort'), suchtext: ausPfad ?? brauchbarerText(url.searchParams.get('destination')) };
  }

  const genau = leseGenauePunkte(url.href);
  if (genau.length > 0) {
    return { ...leer('ort'), coords: genau[0], genauigkeit: 'exakt', name, suchtext };
  }

  const ausParametern = leseParameterKoordinaten(url);
  if (ausParametern) {
    return { ...leer('ort'), coords: ausParametern, genauigkeit: 'exakt', name, suchtext };
  }

  const imPfad = /\/maps\/place\/(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(pfad);
  if (imPfad) {
    return {
      ...leer('ort'),
      coords: { lat: Number(imPfad[1]), lng: Number(imPfad[2]) },
      genauigkeit: 'exakt',
      name,
      suchtext,
    };
  }

  // Letzte Möglichkeit: die Kartenmitte. Sie liegt fast nie genau auf dem Ort,
  // deshalb ausdrücklich als ungefähr gekennzeichnet.
  const mitte = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(url.href);
  if (mitte) {
    return {
      ...leer('ort'),
      coords: { lat: Number(mitte[1]), lng: Number(mitte[2]) },
      genauigkeit: 'ungefaehr',
      name,
      suchtext,
    };
  }

  // Die häufigste Familie mobiler Teilen-Links: Name und Adresse, aber keine
  // Koordinaten. Der Suchtext geht dann an die Ortssuche.
  if (suchtext) return { ...leer('ort'), name, suchtext };

  return leer('unbrauchbar', 'In diesem Link steckt kein Ort.');
}

/** `!3d<lat>!4d<lng>` und `!1d<lng>!2d<lat>` — die Reihenfolge ist umgekehrt. */
function leseGenauePunkte(href) {
  const punkte = [];

  for (const treffer of href.matchAll(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g)) {
    punkte.push({ lat: Number(treffer[1]), lng: Number(treffer[2]) });
  }
  for (const treffer of href.matchAll(/!1d(-?\d{1,3}\.\d+)!2d(-?\d{1,2}\.\d+)/g)) {
    // Achtung: hier ist die erste Zahl die LÄNGE.
    punkte.push({ lat: Number(treffer[2]), lng: Number(treffer[1]) });
  }

  return punkte.filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
}

function leseParameterKoordinaten(url) {
  for (const schlüssel of ['q', 'query', 'll', 'daddr', 'coordinate']) {
    const wert = url.searchParams.get(schlüssel);
    if (!wert) continue;
    const punkt = parseKoordinaten(ohneZutaten(wert));
    if (punkt) return punkt;
  }
  return null;
}

/**
 * Googles zwei Verzierungen an einem Koordinatenfeld abstreifen:
 * `loc:47.37,8.54` und `47.37,8.54 (Grossmünster)`.
 */
function ohneZutaten(wert) {
  return String(wert).replace(/^\s*loc:\s*/i, '').replace(/\s*\([^()]*\)\s*$/, '');
}

/**
 * Name und Suchtext eines Google-Links.
 *
 * Normalerweise steht der Name im Pfad (`/maps/place/<Name>/…`). Teilt man aber
 * aus der Handy-App heraus, kommt oft eine Adresse ganz OHNE Pfad zurück:
 *
 *   https://maps.google.com?q=<Name>,+<Strasse>,+<PLZ Ort>,+<Land>&ftid=…&entry=gps
 *
 * Dann steckt alles im `q`, und ohne diese Lesung endete so ein Link mit «In
 * diesem Link steckt kein Ort» — obwohl Name und Adresse ausgeschrieben
 * dastehen.
 *
 * Beide Quellen tragen dieselbe Form «Name, Strasse, PLZ Ort, Land». Deshalb
 * dieselbe Aufteilung für beide: der Teil vor dem ersten Komma wird der Name,
 * das Ganze der Suchtext — die Ortssuche trifft mit der vollen Adresse
 * deutlich sicherer, und ins Namensfeld gehört keine Adresse.
 */
function leseBezeichnung(url, pfad) {
  const text = brauchbarerText(leseName(pfad)) ?? brauchbarerText(leseParameterText(url));
  if (!text) return { name: null, suchtext: null };

  // Der ERSTE NICHT LEERE Teil: Hat der Ort keinen Namen, beginnt das Feld mit
  // einem Komma («, Bahnhofstrasse 1, Zürich») — dann ist die Strasse der Name.
  const erster = text.split(',').map((teil) => teil.trim()).find(Boolean);
  return { name: erster ?? text, suchtext: text };
}

/** Null, wenn nichts als Satzzeichen übrig bleibt — «,» ist kein Ortsname. */
function brauchbarerText(wert) {
  const text = String(wert ?? '').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : null;
}

/** Freitext aus den Parametern — was die Handy-App statt eines Pfads schickt. */
function leseParameterText(url) {
  for (const schlüssel of ['q', 'query', 'destination', 'daddr']) {
    const wert = url.searchParams.get(schlüssel)?.trim();
    if (!wert) continue;
    // Googles interne Kennungen sagen der Ortssuche nichts.
    if (/^(?:loc|place_id|cid|ftid):/i.test(wert)) continue;

    // `q=47.37,8.54 (Grossmünster)`: Der Punkt kommt aus den Koordinaten, der
    // Name aus der Klammer. Ohne diese Zerlegung stünde «47.37» im Namensfeld —
    // und von dort käme es über den Slug in die unveränderliche Tipp-ID.
    const beschriftet = /^(.+?)\s*\(([^()]+)\)$/.exec(wert);
    if (beschriftet && parseKoordinaten(beschriftet[1])) return beschriftet[2].trim();

    // Reine Koordinaten holt leseParameterKoordinaten.
    if (parseKoordinaten(wert)) continue;
    return wert;
  }
  return null;
}

function leseName(pfad) {
  const treffer = /\/maps\/place\/([^/@]+)/.exec(pfad);
  if (!treffer) return null;
  const roh = treffer[1].replace(/\+/g, ' ').trim();
  // Reine Koordinaten im Namensfeld sind kein Name.
  if (parseKoordinaten(roh)) return null;
  return roh || null;
}

// ----------------------------------------------------------------- Apple ---

/**
 * Der beste Fall: moderne Apple-Links tragen Name, Adresse und Koordinaten
 * direkt in der Adresse. Kein Netzaufruf, kein Risiko.
 */
function parseApple(url) {
  const p = url.searchParams;
  const name = p.get('name')?.trim() || null;
  const adresse = p.get('address')?.trim() || null;

  const punkt =
    parseKoordinaten(p.get('coordinate') ?? '') ??
    parseKoordinaten(p.get('ll') ?? '') ??
    parseKoordinaten(p.get('sll') ?? '') ??
    parseKoordinaten(p.get('q') ?? '');

  if (punkt) {
    return {
      ...leer('ort'),
      coords: punkt,
      genauigkeit: 'exakt',
      name,
      suchtext: [name, adresse].filter(Boolean).join(', ') || null,
    };
  }

  const suchtext = [name, adresse, p.get('q')?.trim()].filter(Boolean).join(', ');
  if (suchtext) return { ...leer('ort'), name, suchtext };

  return leer('unbrauchbar', 'In diesem Apple-Karten-Link steckt kein Ort.');
}

// ------------------------------------------------------------------- OSM ---

/**
 * Bei OpenStreetMap steht die Position oft im Fragment (`#map=19/47.37/8.54`).
 * Fragmente werden NIE an einen Server gesendet — das hier muss im Browser
 * laufen, ein Endpunkt sähe sie gar nicht.
 */
function parseOsm(url) {
  const mlat = url.searchParams.get('mlat');
  const mlon = url.searchParams.get('mlon');
  if (mlat && mlon) {
    const punkt = parseKoordinaten(`${mlat},${mlon}`);
    // mlat/mlon ist die gesetzte Nadel, nicht die Kartenmitte.
    if (punkt) return { ...leer('ort'), coords: punkt, genauigkeit: 'exakt' };
  }

  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  if (lat && lon) {
    const punkt = parseKoordinaten(`${lat},${lon}`);
    if (punkt) return { ...leer('ort'), coords: punkt, genauigkeit: 'exakt' };
  }

  const ausFragment = /#map=[\d.]+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/.exec(url.hash);
  if (ausFragment) {
    return {
      ...leer('ort'),
      coords: { lat: Number(ausFragment[1]), lng: Number(ausFragment[2]) },
      // Das Fragment beschreibt den Ausschnitt, nicht einen Ort.
      genauigkeit: 'ungefaehr',
    };
  }

  return leer('unbrauchbar', 'In diesem OpenStreetMap-Link steckt kein Punkt.');
}
