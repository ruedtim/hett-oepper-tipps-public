import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * Nachgeladene Teile wie die Karte liegen unter Dateinamen mit Prüfsumme. Sobald
 * jemand einen Tipp speichert, baut Cloudflare neu und die alten Namen sind weg —
 * wer die Seite währenddessen offen hatte, bekäme beim Öffnen der Karte einen 404.
 * Ein Neuladen holt die aktuelle Fassung.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

/**
 * Der Service Worker der PWA (public/sw.js, #76) — nur im Produktionsbuild:
 * Im Dev-Server käme sein Cache dem HMR in die Quere. Fehlschläge werden
 * verschluckt, weil er eine Beigabe ist: Die App läuft ohne ihn genauso, nur
 * öffnet sie dann offline nicht.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('#root fehlt in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
