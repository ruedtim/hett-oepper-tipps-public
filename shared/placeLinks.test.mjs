/**
 * Tests für den Link-Parser. Mit `node --test` laufen zu lassen, ohne Bibliothek.
 *
 * Warum ausgerechnet hier Tests, wo der Rest des Projekts keine hat: Die Fehler
 * dieses Parsers krachen nicht, sie zeigen still auf den falschen Ort. Ein
 * verwechseltes `!1d`/`!2d` setzt den Pin in den Indischen Ozean, ein gelesenes
 * `@` statt `!3d` ein bis zwei Häuserblocks daneben — und das merkt monatelang
 * niemand.
 *
 * Alle URLs unten sind echte, aufgelöste Teilen-Links oder daraus abgeleitet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  istErlaubterHost,
  istKurzlink,
  parseKoordinaten,
  parsePlaceInput,
  suchtextStufen,
} from './placeLinks.mjs';

const nah = (ist, soll, toleranz = 0.0001) =>
  assert.ok(Math.abs(ist - soll) < toleranz, `${ist} ist nicht nahe genug an ${soll}`);

// ------------------------------------------------------------ Koordinaten ---

test('rohe Koordinaten aus der Zwischenablage', () => {
  assert.deepEqual(parseKoordinaten('48.8731, 2.3779'), { lat: 48.8731, lng: 2.3779 });
  assert.deepEqual(parseKoordinaten('48.8731,2.3779'), { lat: 48.8731, lng: 2.3779 });
  assert.deepEqual(parseKoordinaten('-33.8688; 151.2093'), { lat: -33.8688, lng: 151.2093 });
  assert.equal(parseKoordinaten('91.0, 2.0'), null, 'Breite über 90 ist ungültig');
  assert.equal(parseKoordinaten('48.8731'), null);
  assert.equal(parseKoordinaten('Paris'), null);
});

test('eingefügte Koordinaten werden direkt erkannt', () => {
  const r = parsePlaceInput('48.873156, 2.377902');
  assert.equal(r.art, 'ort');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lat, 48.873156);
});

// ----------------------------------------------------------------- Google ---

test('!3d/!4d wird dem @ vorgezogen — das @ ist die Kartenmitte', () => {
  // Echter aufgelöster Link. Hier stimmen beide zufällig überein, deshalb ein
  // zweiter Fall unten, wo sie das nicht tun.
  const r = parsePlaceInput(
    'https://www.google.com/maps/place/Brandenburg+Gate/@52.5162746,13.3777041,17z/data=!3m1!4b1!4m6!3m5!1s0x47a851c655f20989:0x26bbfb4e84674c63!8m2!3d52.5162746!4d13.3777041!16zL20vMDE0a2Y4?entry=tts',
  );
  assert.equal(r.art, 'ort');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lat, 52.5162746);
  nah(r.coords.lng, 13.3777041);
  assert.equal(r.name, 'Brandenburg Gate');
});

test('weichen @ und !3d voneinander ab, gewinnt !3d', () => {
  // Nachbildung des gemessenen Extremfalls: Kartenmitte in Island, Lokal in
  // Norwegen — 1341 km Unterschied.
  const r = parsePlaceInput(
    'https://www.google.com/maps/place/Kokko+kaffebar/@64.55875,-19.2041125,4z/data=!4m6!3m5!1s0x0:0x0!8m2!3d58.9729!4d5.7339',
  );
  nah(r.coords.lat, 58.9729);
  nah(r.coords.lng, 5.7339);
  assert.equal(r.genauigkeit, 'exakt');
});

test('!1d/!2d ist umgekehrt: erst Länge, dann Breite', () => {
  // 13.42 ist die Länge, 52.48 die Breite — das ist Berlin, nicht der Indische Ozean.
  const r = parsePlaceInput(
    'https://www.google.com/maps/x/data=!1m1!1s0x47a84fb831937021:0x28d6914e5ca0f9f5!2m2!1d13.4236883!2d52.4858222',
  );
  nah(r.coords.lat, 52.4858222);
  nah(r.coords.lng, 13.4236883);
});

test('nur @ vorhanden: Punkt gilt als ungefähr', () => {
  const r = parsePlaceInput('https://www.google.com/maps/@48.8584,2.2945,17z');
  assert.equal(r.genauigkeit, 'ungefaehr', 'die Kartenmitte ist nie der Ort');
  nah(r.coords.lat, 48.8584);
});

test('?q= mit Koordinaten', () => {
  const r = parsePlaceInput('https://maps.google.com/maps?q=41.8886,12.4776');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lng, 12.4776);
});

test('?q= mit «loc:» ist Googles Schreibweise für einen reinen Punkt', () => {
  const r = parsePlaceInput('https://maps.google.com/?q=loc:47.3769,8.5417');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lat, 47.3769);
});

test('?q= mit Koordinaten UND Beschriftung: Punkt aus den Zahlen, Name aus der Klammer', () => {
  // Ohne die Zerlegung stünde «47.3769» im Namensfeld — und damit über den Slug
  // in der Tipp-ID, die sich nie mehr ändern lässt.
  const r = parsePlaceInput('https://maps.google.com/?q=47.3769,8.5417+(Grossm%C3%BCnster)');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lng, 8.5417);
  assert.equal(r.name, 'Grossmünster');
});

test('eine Klammer im Ortsnamen bleibt Teil des Namens', () => {
  const r = parsePlaceInput('https://maps.google.com/?q=Caf%C3%A9+(Altstadt)');
  assert.equal(r.coords, null);
  assert.equal(r.name, 'Café (Altstadt)');
});

test('mobiler Teilen-Link ohne Koordinaten liefert einen Suchtext', () => {
  // Echter aufgelöster Link — die Familie, die rund 43 % ausmacht.
  const r = parsePlaceInput(
    'https://www.google.com/maps/place/Brandenburg+Gate,+Pariser+Platz,+10117+Berlin,+Germany/data=!4m2!3m1!1s0x47a851c655f20989:0x26bbfb4e84674c63?utm_source=mstt_1&entry=gps',
  );
  assert.equal(r.art, 'ort');
  assert.equal(r.coords, null, 'hier stehen wirklich keine Koordinaten drin');
  assert.match(r.suchtext, /Brandenburg Gate/);
  assert.match(r.suchtext, /Berlin/);
  assert.equal(r.name, 'Brandenburg Gate', 'ins Namensfeld gehört keine Adresse');
});

test('Teilen aus der Handy-App: alles steckt im q, es gibt gar keinen Pfad', () => {
  // Echter aufgelöster Kurzlink (Issue #17). Vorher endete er mit «In diesem
  // Link steckt kein Ort» — obwohl Name und Adresse ausgeschrieben dastehen.
  const r = parsePlaceInput(
    'https://maps.google.com?q=Transrapid+Besucherzentrum,+Hermann-Kemper-Stra%C3%9Fe+23,+49762+Lathen,+Germany&ftid=0x47b7bdee824e3681:0x743671764f47c745&entry=gps&shh=CAE&g_st=ic',
  );
  assert.equal(r.art, 'ort');
  assert.equal(r.coords, null);
  assert.equal(r.name, 'Transrapid Besucherzentrum');
  assert.match(r.suchtext, /Hermann-Kemper/);
  assert.match(r.suchtext, /Lathen/);
});

test('die Suchseite der App liefert ihren Suchbegriff', () => {
  const r = parsePlaceInput('https://www.google.com/maps/search/?api=1&query=Grossmuenster+Zurich');
  assert.equal(r.art, 'ort');
  assert.equal(r.suchtext, 'Grossmuenster Zurich');
});

test('hat der Ort keinen Namen, wird die Strasse zum Namen', () => {
  // Adressen ohne Lokalnamen kommen als «, Strasse, Ort» — der leere erste Teil
  // darf nicht die ganze Zeile ins Namensfeld schwemmen.
  const r = parsePlaceInput('https://maps.google.com/?q=,+Bahnhofstrasse+1,+Z%C3%BCrich');
  assert.equal(r.name, 'Bahnhofstrasse 1');
  assert.match(r.suchtext, /Zürich/);
});

test('Satzzeichen allein sind kein Ort', () => {
  assert.equal(parsePlaceInput('https://maps.google.com/?q=,').art, 'unbrauchbar');
  assert.equal(parsePlaceInput('https://maps.google.com/?q=%20').art, 'unbrauchbar');
});

test('Route ohne Wegpunkte im Pfad: das Ziel steht im Parameter', () => {
  const r = parsePlaceInput('https://www.google.com/maps/dir/?api=1&destination=Grossmuenster+Zurich');
  assert.equal(r.art, 'ort');
  assert.equal(r.coords, null, 'eine Route hat mehrere Punkte — keinen davon raten');
  assert.equal(r.suchtext, 'Grossmuenster Zurich');
});

test('Googles interne Kennungen sind kein Suchtext', () => {
  // «place_id:ChIJ…» im q-Feld findet keine Ortssuche der Welt. Lieber ehrlich
  // abweisen als die Suche mit einer Zeichenkette füttern, die nie trifft.
  for (const link of [
    'https://maps.google.com/?q=place_id:ChIJ0X31pIK3j4ARlbfGRuFViTQ',
    'https://maps.google.com/?cid=743671764547c745',
  ]) {
    assert.equal(parsePlaceInput(link).art, 'unbrauchbar', link);
  }
});

test('geteilte Rezension wird als solche erkannt, nicht als Ort', () => {
  const r = parsePlaceInput('https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sCi9DQUlR');
  assert.equal(r.art, 'unbrauchbar');
  assert.match(r.grund, /Rezension/);
});

test('geteiltes Foto wird erkannt', () => {
  const r = parsePlaceInput('https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sabc!3e3');
  assert.equal(r.art, 'unbrauchbar');
  assert.match(r.grund, /Foto/);
});

test('eigene Karte («My Maps») wird erkannt', () => {
  const r = parsePlaceInput('https://www.google.com/maps/d/viewer?mid=1abcDEF');
  assert.equal(r.art, 'unbrauchbar');
  assert.match(r.grund, /eigene Karte/);
});

test('Route liefert nur den Zielnamen, nie einen geratenen Wegpunkt', () => {
  const r = parsePlaceInput(
    'https://www.google.com/maps/dir/Bern/Z%C3%BCrich/data=!4m2!1d7.4474!2d46.948!4m2!1d8.5417!2d47.3769',
  );
  assert.equal(r.coords, null, 'eine Route hat mehrere Punkte — keinen davon raten');
  assert.match(r.suchtext, /Zürich/);
});

test('Länderdomänen von Google werden akzeptiert', () => {
  const r = parsePlaceInput('https://www.google.es/maps/place/Sagrada/@0,0,17z/data=!8m2!3d41.4036!4d2.1744');
  assert.equal(r.art, 'ort');
  nah(r.coords.lat, 41.4036);
});

test('die share.google-Zwischenseite geht zum Auflösen weiter', () => {
  // Früher stand hier eine ehrliche Absage; inzwischen folgt api/link.ts auch
  // diesem zweiten Sprung (per GET — HEAD verschweigt dort die Weiterleitung).
  const r = parsePlaceInput('https://www.google.com/share.google?q=ExRooyJcNOYFPpso9');
  assert.equal(r.art, 'kurzlink');
  assert.equal(r.url, 'https://www.google.com/share.google?q=ExRooyJcNOYFPpso9');
});

test('die Such-URL hinter share.google trägt den Namen im q', () => {
  // Das Endziel der share.google-Kette: «Teilen» aus der Google-Suche.
  // Keine Koordinaten — der Name geht als Suchtext an die Ortswahl.
  const r = parsePlaceInput(
    'https://www.google.com/search?client=firefox-b-d&kgmid=/g/1hc1023ps&q=Il+Focacciaio&shndl=30&kgs=04d1a0194a683df7',
  );
  assert.equal(r.art, 'ort');
  assert.equal(r.coords, null);
  assert.equal(r.name, 'Il Focacciaio');
  assert.equal(r.suchtext, 'Il Focacciaio');
});

// ------------------------------------------------------------------ Apple ---

test('Apple-Link trägt Name, Adresse und Koordinaten direkt', () => {
  const r = parsePlaceInput(
    'https://maps.apple.com/place?address=Rokin%2049,%201012%20KK%20Amsterdam,%20Netherlands&coordinate=52.371375,4.893167&name=Adyen%20Rokin%20Office&map=explore',
  );
  assert.equal(r.art, 'ort');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lat, 52.371375);
  assert.equal(r.name, 'Adyen Rokin Office');
  assert.match(r.suchtext, /Rokin 49/);
});

test('älterer Apple-Link mit ll', () => {
  const r = parsePlaceInput('https://maps.apple.com/?ll=47.3769,8.5417&q=Grossmuenster');
  nah(r.coords.lat, 47.3769);
  assert.equal(r.genauigkeit, 'exakt');
});

// -------------------------------------------------------------------- OSM ---

test('OSM mlat/mlon ist die gesetzte Nadel', () => {
  const r = parsePlaceInput('https://www.openstreetmap.org/?mlat=47.3769&mlon=8.5417#map=19/47.3769/8.5417');
  assert.equal(r.genauigkeit, 'exakt');
  nah(r.coords.lat, 47.3769);
});

test('OSM nur mit Fragment gilt als ungefähr', () => {
  const r = parsePlaceInput('https://www.openstreetmap.org/#map=19/47.3769/8.5417');
  assert.equal(r.genauigkeit, 'ungefaehr', 'das Fragment ist der Ausschnitt, nicht ein Ort');
  nah(r.coords.lng, 8.5417);
});

// --------------------------------------------------------------- Kurzlinks ---

test('Kurzlinks werden zum Auflösen weitergereicht', () => {
  for (const kurz of [
    'https://maps.app.goo.gl/PJdcARfqULFnpENj7',
    'https://goo.gl/maps/jnrT3N5z4yaPHh7y7',
    'https://share.google/ExRooyJcNOYFPpso9',
  ]) {
    const r = parsePlaceInput(kurz);
    assert.equal(r.art, 'kurzlink', kurz);
    assert.equal(r.url, kurz);
  }
});

// ------------------------------------------------------------- Allowlist ---

test('Allowlist lässt genau die richtigen Hosts durch', () => {
  for (const gut of [
    'maps.app.goo.gl',
    'goo.gl',
    'g.co',
    'share.google',
    'www.google.com',
    'maps.google.com',
    'www.google.es',
    'maps.google.co.uk',
    'maps.apple.com',
    'www.openstreetmap.org',
    'osm.org',
  ]) {
    assert.ok(istErlaubterHost(gut), `${gut} sollte erlaubt sein`);
  }

  for (const böse of [
    'example.com',
    'google.com.angreifer.example',
    'notgoogle.com',
    'maps.apple.com.evil.net',
    '127.0.0.1',
    'localhost',
    'evil.goo.gl.attacker.example',
  ]) {
    assert.ok(!istErlaubterHost(böse), `${böse} darf NICHT erlaubt sein`);
  }
});

test('nur die echten Kurzlink-Hosts gelten als Kurzlink', () => {
  assert.ok(istKurzlink('maps.app.goo.gl'));
  assert.ok(!istKurzlink('www.google.com'), 'lange Google-Links parst der Browser selbst');
});

// ------------------------------------------------------------- Suchstufen ---

test('Suchstufen: nach dem vollen Text kommt die Adresse ohne den Namen', () => {
  // Echter Fall: Das Lokal steht nicht in OpenStreetMap — der volle Text fand
  // null Treffer, die reine Adresse den Punkt hausnummerngenau.
  assert.deepEqual(
    suchtextStufen('Georgisches Restaurant Khareba, Hohe Str. 16, 44139 Dortmund, Germany'),
    [
      'Georgisches Restaurant Khareba, Hohe Str. 16, 44139 Dortmund, Germany',
      'Hohe Str. 16, 44139 Dortmund, Germany',
    ],
  );
});

test('Suchstufen: ohne Ziffer im Rest gibt es keine zweite Stufe', () => {
  // «Khareba, Dortmund»: der Rest wäre nur die Stadt — ihr Treffer die
  // Stadtmitte, ein Pin an der falschen Stelle.
  assert.deepEqual(suchtextStufen('Khareba, Dortmund'), ['Khareba, Dortmund']);
});

test('Suchstufen: ohne Komma bleibt es beim vollen Text', () => {
  assert.deepEqual(suchtextStufen('Grossmünster Zürich'), ['Grossmünster Zürich']);
  assert.deepEqual(suchtextStufen('  '), []);
  assert.deepEqual(suchtextStufen(null), []);
});

test('Suchstufen: fehlt der Lokalname, ist die Adresse selbst die zweite Stufe', () => {
  // «, Bahnhofstrasse 1, Zürich» — Adressen ohne Lokalnamen beginnen mit Komma.
  assert.deepEqual(suchtextStufen(', Bahnhofstrasse 1, Zürich'), [
    ', Bahnhofstrasse 1, Zürich',
    'Bahnhofstrasse 1, Zürich',
  ]);
});

// --------------------------------------------------------------- Sonstiges ---

test('fremde Hosts und Unsinn werden abgewiesen', () => {
  assert.equal(parsePlaceInput('https://example.com/irgendwas').art, 'unbrauchbar');
  assert.equal(parsePlaceInput('kein link').art, 'unbekannt');
  assert.equal(parsePlaceInput('').art, 'unbekannt');
});

test('gefährliche Schemata ergeben nie einen Ort', () => {
  // `new URL()` schluckt diese klaglos — die Prüfung auf das Protokoll ist
  // deshalb nicht optional, auch wenn die Zeichenkette wie Unsinn aussieht.
  for (const böse of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
    const r = parsePlaceInput(böse);
    assert.notEqual(r.art, 'ort', `${böse} darf nie als Ort durchgehen`);
    assert.equal(r.coords, null);
  }
});
