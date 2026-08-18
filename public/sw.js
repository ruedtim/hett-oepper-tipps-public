/**
 * Der Service Worker der PWA (#76). Manifest und Icons gibt es seit Phase 9 —
 * dieses Skript ist das fehlende Stück, damit die installierte App auch ohne
 * Netz ÖFFNET statt auf dem System-Fehlerbild zu landen.
 *
 * Er fasst ausschliesslich Statisches an: die Hülle (index.html) und das
 * Bundle unter /assets/. NIE /api/ oder /photos/ — die Begründung steht in
 * CLAUDE.md («Die App ist eine PWA …»): Das Gate liest bei jedem Request die
 * Kontozeile, damit Deaktivieren und Passwortwechsel sofort wirken, und ein
 * Cache mit Daten wäre ein zweiter Bestand, der eine zurückgezogene
 * Berechtigung überlebt. Offline heisst deshalb ehrlich «kein Netz», nicht
 * «alter Stand».
 *
 * Von Hand geschrieben, ohne Workbox oder Build-Plugin: Der ganze Bedarf sind
 * zwei Caches und drei Regeln, und eine Abhängigkeit, die zur Buildzeit Code
 * erzeugt, wäre mehr Oberfläche als das Problem.
 */

const VERSION = 'v1';
const HUELLE = `huelle-${VERSION}`;
const BUNDLE = `bundle-${VERSION}`;

/**
 * Das Bundle wächst mit jedem Deployment (neue Prüfsummen-Namen, die alten
 * bleiben liegen). Der Deckel ist grosszügig — ein Build sind eine Handvoll
 * Dateien — und wirft das Älteste zuerst weg.
 */
const BUNDLE_DECKEL = 80;

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
      // Caches früherer VERSIONen wegräumen — die einzige Stelle, an der sie
      // je verschwinden.
      const behalten = new Set([HUELLE, BUNDLE]);
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
  }

  // Alles andere — allen voran /api/ und /photos/ — fasst der Worker nicht an.
});
