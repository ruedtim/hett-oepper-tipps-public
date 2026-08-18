/**
 * Der Service Worker der PWA (#76). Manifest und Icons gibt es seit Phase 9 —
 * dieses Skript ist das fehlende Stück, damit die installierte App auch ohne
 * Netz ÖFFNET statt auf dem System-Fehlerbild zu landen.
 *
 * Überall gilt dieselbe Regel: Netz zuerst, der Cache ist nur das Netz
 * DARUNTER, nie eine Abkürzung (einzige Ausnahme: /assets/, wo die Prüfsumme
 * im Namen den Inhalt garantiert). Vorgehalten werden vier Dinge: die Hülle
 * (index.html), das Bundle, der Datenbestand (/api/data und /api/me) und die
 * bereits betrachteten Fotos — damit die Tipps auch ohne Netz LESBAR sind,
 * etwa im Ausland.
 *
 * Das Offline-Lesen ist ein ausdrücklicher Entscheid des Besitzers (#76,
 * 2026-08-19) samt seinem Preis: Ein Gerät, das einmal angemeldet war, behält
 * den zuletzt gesehenen Stand auch dann, wenn das Konto inzwischen deaktiviert
 * oder das Passwort gewechselt ist — aber nur offline. Online entscheidet
 * weiter bei jedem Request das Gate, und mit der Abmeldung löscht lib/api.ts
 * den Daten- und Foto-Vorrat (Hülle und Bundle bleiben: Code, keine Daten).
 * Alles Weitere steht in CLAUDE.md («Die App ist eine PWA …»).
 *
 * Von Hand geschrieben, ohne Workbox oder Build-Plugin: Der ganze Bedarf sind
 * vier Caches und vier Regeln, und eine Abhängigkeit, die zur Buildzeit Code
 * erzeugt, wäre mehr Oberfläche als das Problem.
 */

const VERSION = 'v1';
const HUELLE = `huelle-${VERSION}`;
const BUNDLE = `bundle-${VERSION}`;
// Wer die beiden nächsten Namen ändert, ändert sie auch im Abmelde-Pfad
// (logout() in src/lib/api.ts löscht sie über ihr Präfix).
const DATEN = `daten-${VERSION}`;
const FOTOS = `fotos-${VERSION}`;

/**
 * Das Bundle wächst mit jedem Deployment (neue Prüfsummen-Namen, die alten
 * bleiben liegen). Der Deckel ist grosszügig — ein Build sind eine Handvoll
 * Dateien — und wirft das Älteste zuerst weg.
 */
const BUNDLE_DECKEL = 80;

/** Fotos sind das einzig Schwere hier; gecacht wird nur, was jemand ansieht. */
const FOTOS_DECKEL = 150;

/**
 * Nur eine Antwort, die nicht `no-store` trägt, darf in den Hüllen-Cache.
 * Das ist die Grenze zwischen Hülle und Gate an einem Header: Die statische
 * index.html kommt ohne, aber ALLE Seiten, die functions/ serverseitig baut
 * (Anmeldebildschirm, /passwort-neu, …), tragen `no-store` — der Cache kann
 * also höchstens die datenlose Hülle enthalten, nie eine Gate-Seite.
 */
async function hinterlegeHuelle(response) {
  if (!response.ok) return;
  const cacheControl = response.headers.get('Cache-Control') ?? '';
  if (cacheControl.includes('no-store')) return;
  const cache = await caches.open(HUELLE);
  await cache.put('/', response.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Die Hülle gleich beim Installieren holen: Wer die App auf den
      // Startbildschirm legt und erst im Flugzeug wieder öffnet, hatte sonst
      // nie eine zweite Navigation, die sie hätte hinterlegen können. Der
      // Request trägt das Sitzungs-Cookie mit — angemeldet kommt die Hülle,
      // abgemeldet kommt der Anmeldebildschirm, und den weist
      // hinterlegeHuelle() am `no-store` ab.
      try {
        await hinterlegeHuelle(await fetch('/'));
      } catch {
        // Ohne Netz beim Installieren gibt es eben noch keine Hülle.
      }
      // Sofort übernehmen statt auf den letzten Tab zu warten: Gefahrlos, weil
      // main.tsx einen 404 auf ein nachgeladenes Stück ohnehin mit einem
      // Neuladen beantwortet (vite:preloadError).
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Caches früherer VERSIONen wegräumen — neben der Abmeldung die einzige
      // Stelle, an der sie je verschwinden.
      const behalten = new Set([HUELLE, BUNDLE, DATEN, FOTOS]);
      for (const name of await caches.keys()) {
        if (!behalten.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Netz zuerst; der Cache ist nur das Netz DARUNTER, nie eine Abkürzung. */
async function navigation(request) {
  try {
    const response = await fetch(request);
    await hinterlegeHuelle(response);
    return response;
  } catch {
    const cached = await caches.match('/', { cacheName: HUELLE });
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="de-CH"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Kein Netz</title>' +
        '<body style="font-family: system-ui; padding: 2rem; text-align: center">' +
        '<p>Gerade kein Netz — bitte später nochmal.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/**
 * Netz zuerst; scheitert es, kommt die letzte gute Antwort aus dem Cache —
 * mit dem Header `SW-Stand` (Zeitpunkt der gecachten Antwort), damit die App
 * den alten Stand ehrlich beschriften kann, statt Frisches vorzutäuschen.
 *
 * `/api/data` trägt weiterhin `no-store`, und das ist kein Widerspruch: Der
 * Header gilt allen ANDEREN Caches (Browser-HTTP-Cache, Proxies) unverändert.
 * Dieser Worker ist die eine ausgesprochene Ausnahme — der Entscheid dazu
 * steht oben im Kopfkommentar.
 */
async function netzZuerst(request, cacheName, deckel) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Der Zeitpunkt wird beim HINTERLEGEN gestempelt, nicht erst beim
      // Ausliefern aus einem Date-Header gelesen: Nicht jede Umgebung schickt
      // einen mit (das lokale wrangler etwa nicht), und gemeint ist ohnehin
      // «wann geholt». Die Antwort ans Netz bleibt unangetastet — der Header
      // steht nur auf der Kopie im Cache, und genau daran erkennt die App,
      // dass sie einen alten Stand zeigt.
      const kopie = response.clone();
      const headers = new Headers(kopie.headers);
      headers.set('SW-Stand', new Date().toISOString());
      await cache.put(
        request,
        new Response(await kopie.blob(), {
          status: kopie.status,
          statusText: kopie.statusText,
          headers,
        }),
      );
      if (deckel) {
        const keys = await cache.keys();
        for (const key of keys.slice(0, Math.max(0, keys.length - deckel))) {
          await cache.delete(key);
        }
      }
    }
    return response;
  } catch (fehler) {
    const cached = await cache.match(request);
    if (!cached) throw fehler;
    return cached;
  }
}

/**
 * Cache zuerst, und das ist hier ausnahmsweise richtig: Die Namen unter
 * /assets/ tragen eine Prüfsumme, derselbe Name heisst derselbe Inhalt.
 */
async function bundle(request) {
  const cache = await caches.open(BUNDLE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - BUNDLE_DECKEL))) {
      await cache.delete(key);
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Nur die App selbst bekommt die Offline-Hülle. Die übrigen Seiten
    // (/geteilt/…, /einladung, /passwort-neu, …) sind serverseitig gebaut —
    // ihnen offline die App-Hülle unterzuschieben, wäre die falsche Antwort
    // auf die richtige Adresse. Sie laufen ungebremst ins Netz.
    if (url.pathname === '/') event.respondWith(navigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(bundle(request));
    return;
  }

  // Der Lesepfad der App — exakt die zwei Endpunkte, nicht /api/ als Präfix:
  // Verlauf, Kontenverwaltung und alles Weitere sollen offline ehrlich
  // scheitern statt einen alten Stand zu behaupten.
  if (url.pathname === '/api/data' || url.pathname === '/api/me') {
    event.respondWith(netzZuerst(request, DATEN));
    return;
  }

  // Fotos: nur, was jemand schon betrachtet hat, mit Deckel. Für Gäste
  // antwortet das Gate 404, und ein 404 wird nie gecacht (`response.ok`).
  if (url.pathname.startsWith('/photos/')) {
    event.respondWith(netzZuerst(request, FOTOS, FOTOS_DECKEL));
    return;
  }

  // Alles andere — alle übrigen /api/-Endpunkte — fasst der Worker nicht an.
});
