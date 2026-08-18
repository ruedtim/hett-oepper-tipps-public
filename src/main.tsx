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

const container = document.getElementById('root');
if (!container) throw new Error('#root fehlt in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
