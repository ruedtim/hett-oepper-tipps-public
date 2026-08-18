/**
 * Tests für die Tagesdaten. Mit `node --test` laufen zu lassen, ohne Bibliothek.
 *
 * Warum hier Tests: Dieselbe Sorte stiller Fehler wie beim Link-Parser. Zeigt
 * heuteIso() einen Tag zu früh, verschwinden alle Wünsche einen Tag zu früh —
 * es kracht nichts, es fehlt bloss etwas, und das fällt niemandem auf.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuteIso, istEchterTag, tageSpaeter } from './datum.mjs';

// ------------------------------------------------------------- heuteIso ---

test('spätabends UTC ist in Zürich schon der nächste Tag', () => {
  // 23:30 Uhr UTC = 01:30 Uhr MESZ des Folgetags.
  assert.equal(heuteIso(new Date('2026-07-27T23:30:00Z')), '2026-07-28');
});

test('winters gilt dasselbe, nur eine Stunde später', () => {
  // MEZ = UTC+1: 23:30 Uhr UTC ist 00:30 Uhr des Folgetags.
  assert.equal(heuteIso(new Date('2026-01-27T23:30:00Z')), '2026-01-28');
  // 22:30 Uhr UTC ist im Winter noch derselbe Tag — im Sommer wäre es der nächste.
  assert.equal(heuteIso(new Date('2026-01-27T22:30:00Z')), '2026-01-27');
});

test('frühmorgens UTC ist in Zürich derselbe Tag', () => {
  assert.equal(heuteIso(new Date('2026-07-28T02:00:00Z')), '2026-07-28');
});

test('liefert immer JJJJ-MM-TT mit führenden Nullen', () => {
  assert.equal(heuteIso(new Date('2026-03-05T12:00:00Z')), '2026-03-05');
  assert.match(heuteIso(), /^\d{4}-\d{2}-\d{2}$/);
});

// --------------------------------------------------------- istEchterTag ---

test('echte Tage werden angenommen', () => {
  assert.equal(istEchterTag('2026-07-28'), true);
  assert.equal(istEchterTag('2024-02-29'), true); // Schaltjahr
});

test('formgültige, aber erfundene Tage werden abgelehnt', () => {
  // Der Grund, warum es diese Funktion gibt: Beides besteht jede Regex.
  assert.equal(istEchterTag('2026-02-31'), false);
  assert.equal(istEchterTag('2026-02-30'), false);
  assert.equal(istEchterTag('2025-02-29'), false); // kein Schaltjahr
  assert.equal(istEchterTag('2026-13-01'), false);
  assert.equal(istEchterTag('2026-00-10'), false);
});

test('falsche Formen werden abgelehnt', () => {
  assert.equal(istEchterTag('28.07.2026'), false);
  assert.equal(istEchterTag('2026-7-28'), false);
  assert.equal(istEchterTag('2026-07-28T00:00:00Z'), false);
  assert.equal(istEchterTag(''), false);
  assert.equal(istEchterTag(null), false);
  assert.equal(istEchterTag(undefined), false);
  assert.equal(istEchterTag(20260728), false);
});

// ---------------------------------------------------------- tageSpaeter ---

test('rechnet über Monats- und Jahresgrenzen', () => {
  assert.equal(tageSpaeter('2026-07-28', 7), '2026-08-04');
  assert.equal(tageSpaeter('2026-12-28', 7), '2027-01-04');
  assert.equal(tageSpaeter('2024-02-28', 1), '2024-02-29');
  assert.equal(tageSpaeter('2025-02-28', 1), '2025-03-01');
});

test('rechnet auch rückwärts und mit null', () => {
  assert.equal(tageSpaeter('2026-01-01', -1), '2025-12-31');
  assert.equal(tageSpaeter('2026-07-28', 0), '2026-07-28');
});

test('überspringt die Sommerzeit-Umstellung ohne Sprung', () => {
  // Die Umstellung liegt am 29. März 2026 — in UTC gerechnet zählt sie nicht mit.
  assert.equal(tageSpaeter('2026-03-28', 2), '2026-03-30');
  assert.equal(tageSpaeter('2026-10-24', 2), '2026-10-26');
});

test('zwei Jahre voraus — die Obergrenze im Formular', () => {
  assert.equal(tageSpaeter('2026-07-28', 730), '2028-07-27');
});

test('gibt Unbrauchbares unverändert zurück', () => {
  assert.equal(tageSpaeter('irgendwann', 7), 'irgendwann');
  assert.equal(tageSpaeter('2026-02-31', 1), '2026-02-31');
});
