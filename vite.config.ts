import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Die Seite liegt hinter einem Login und wird nie indexiert — Sourcemaps
    // wären nur zusätzliches Gewicht auf schlechtem Hotel-WLAN.
    sourcemap: false,
  },
  server: {
    port: 5173,
    // `npm run dev` kennt keine Functions und keine D1 — /api und /photos
    // beantwortet ein parallel laufendes `wrangler pages dev` (Port 8788).
    // Ohne den Proxy wäre die Dev-Ansicht seit dem Wegfall von public/data.json
    // datenlos. Siehe README, Abschnitt «Lokal arbeiten».
    proxy: {
      '/api': 'http://localhost:8788',
      '/photos': 'http://localhost:8788',
    },
  },
});
