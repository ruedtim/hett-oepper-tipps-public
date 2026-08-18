/**
 * Tests für die Umkreis-Rechnung. Mit `node --test` laufen zu lassen.
 *
 * Aus demselben Grund wie bei `placeLinks.test.mjs`: Ein Fehler hier wirft
 * keine Ausnahme, er liefert eine falsche Liste. Vertauschte lat/lng ergeben
 * eine Zahl, die aussieht wie eine Entfernung — nur eben die falsche, und dann
 * fehlt Konstanz im Umkreis von Kreuzlingen, ohne dass jemand sagen könnte warum.
 *
 * Die Sollwerte sind Luftlinien nach öffentlichen Angaben, mit Toleranz.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanzKm, mittelpunkt } from './geo.mjs';

const ZUERICH = { lat: 47.3769, lng: 8.5417 };
const BERN = { lat: 46.948, lng: 7.4474 };
const HAMBURG = { lat: 53.5511, lng: 9.9937 };
const MUENCHEN = { lat: 48.1351, lng: 11.582 };
// Über die Grenze — der Fall, für den es den Umkreis überhaupt gibt.
const KREUZLINGEN = { lat: 47.6503, lng: 9.1744 };
const KONSTANZ = { lat: 47.6603, lng: 9.1758 };

const nah = (ist, soll, toleranz) =>
  assert.ok(Math.abs(ist - soll) < toleranz, `${ist} ist nicht nahe genug an ${soll}`);

// --------------------------------------------------------------- Distanz ---

test('bekannte Luftlinien', () => {
  nah(distanzKm(ZUERICH, BERN), 95, 3);
  nah(distanzKm(HAMBURG, MUENCHEN), 612, 10);
  nah(distanzKm(KREUZLINGEN, KONSTANZ), 1.1, 0.5);
});

test('derselbe Punkt ist null Kilometer entfernt', () => {
  assert.equal(distanzKm(ZUERICH, ZUERICH), 0);
  assert.equal(distanzKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
});

test('die Richtung spielt keine Rolle', () => {
  assert.equal(distanzKm(ZUERICH, BERN), distanzKm(BERN, ZUERICH));
});

/**
 * Der eigentliche Grund für diese Datei: Werden lat und lng verwechselt, kommt
 * weiterhin eine plausible Zahl heraus. Zürich und Bern lägen dann rund 60 statt
 * 95 Kilometer auseinander — nichts, was beim Lesen des Codes auffiele.
 */
test('vertauschte Achsen ergeben ein anderes Ergebnis', () => {
  const gedreht = (p) => ({ lat: p.lng, lng: p.lat });
  const richtig = distanzKm(ZUERICH, BERN);
  const falsch = distanzKm(gedreht(ZUERICH), gedreht(BERN));
  assert.ok(Math.abs(richtig - falsch) > 10, `${richtig} und ${falsch} liegen zu nah beieinander`);
});

test('ein Grad Breite ist überall gleich lang, ein Grad Länge nicht', () => {
  // Breitengrade laufen parallel: ein Grad sind immer rund 111 km.
  nah(distanzKm({ lat: 0, lng: 8 }, { lat: 1, lng: 8 }), 111, 1);
  nah(distanzKm({ lat: 60, lng: 8 }, { lat: 61, lng: 8 }), 111, 1);
  // Längengrade laufen an den Polen zusammen: am Äquator 111 km, bei 60° die Hälfte.
  nah(distanzKm({ lat: 0, lng: 8 }, { lat: 0, lng: 9 }), 111, 1);
  nah(distanzKm({ lat: 60, lng: 8 }, { lat: 60, lng: 9 }), 55.6, 1);
});

test('auch über den Äquator und den Nullmeridian hinweg', () => {
  nah(distanzKm({ lat: -1, lng: -1 }, { lat: 1, lng: 1 }), 314, 3);
});

// ----------------------------------------------------------- Mittelpunkt ---

test('Mittelpunkt einer Stadt liegt in der Stadt', () => {
  // Drei Wiener Punkte: Prater, Schönbrunn, Leopoldsberg.
  const wien = [
    { lat: 48.2167, lng: 16.3958 },
    { lat: 48.1848, lng: 16.3122 },
    { lat: 48.2761, lng: 16.3444 },
  ];
  const punkt = mittelpunkt(wien);
  assert.ok(punkt);
  // Jeder Ausgangspunkt liegt weniger als zehn Kilometer vom Schwerpunkt weg —
  // ein Umkreis von 10 km um diesen Anker erwischt die ganze Stadt.
  for (const einzeln of wien) nah(distanzKm(punkt, einzeln), 0, 10);
});

test('ein einzelner Punkt ist sein eigener Mittelpunkt', () => {
  assert.deepEqual(mittelpunkt([ZUERICH]), ZUERICH);
});

test('ohne Punkte kein Mittelpunkt', () => {
  assert.equal(mittelpunkt([]), null);
});
