/**
 * Das Aussehen der Seiten VOR dem Gate — Anmeldebildschirm, Passwort-Reset,
 * E-Mail-Bestätigung.
 *
 * Jede davon ist eine einzige, in sich geschlossene HTML-Antwort ohne externe
 * CSS- oder JS-Datei: Alles, was sie nachladen müsste, läge selbst hinter dem
 * Gate — und was davor läge, wäre öffentlich. Deshalb steht das Stylesheet als
 * Zeichenkette hier und nicht in einer Datei unter public/.
 *
 * Geteilt und nicht kopiert, weil drei Kopien desselben Stylesheets genau so
 * lange gleich aussehen, bis jemand eine davon anfasst.
 */

export const SEITEN_CSS = `
  :root {
    color-scheme: light dark;
    --bg: #faf7f2; --surface: #fff; --ink: #1f1c17; --soft: #6c6459;
    --line: #e2dacd; --accent: #9c3d2e; --accent-ink: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161513; --surface:#201e1b; --ink:#f0ebe3; --soft:#a49b8e; --line:#38342e; --accent:#e0765f; --accent-ink:#201e1b; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: 1.5rem; background: var(--bg); color: var(--ink);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.5;
  }
  .box { width: 100%; max-width: 22rem; text-align: center; }
  /* Eine Seite, die etwas AUFLISTET statt etwas zu fragen. Linksbündig und
     breiter, und der Body hört auf, sie in die Mitte zu drücken — sonst klebte
     eine lange Liste am unteren Rand fest. */
  .box--breit { max-width: 42rem; text-align: left; }
  body:has(.box--breit) { display: block; place-items: initial; margin-inline: auto; max-width: 45rem; }
  h1 { margin: 0 0 .25rem; font-size: clamp(1.6rem, 8vw, 2.1rem); letter-spacing: -.02em; }
  p.lead { margin: 0 0 1.5rem; color: var(--soft); font-size: .95rem; }
  form { display: grid; gap: .6rem; }
  input {
    width: 100%; min-height: 48px; padding: 0 .9rem; border: 1px solid var(--line);
    border-radius: 14px; background: var(--surface); color: inherit;
    font: inherit; font-size: 16px; text-align: center;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    min-height: 48px; border: 0; border-radius: 14px; background: var(--accent);
    color: var(--accent-ink); font: inherit; font-size: 1rem; font-weight: 600; cursor: pointer;
  }
  button[disabled] { opacity: .6; cursor: progress; }
  button.ghost { background: transparent; color: var(--soft); font-weight: 400; min-height: 36px; }
  .error { margin: 0; color: var(--accent); font-size: .9rem; }
  .notice { margin: 0; color: var(--ink); font-size: .9rem; }
  [hidden] { display: none !important; }

  /* Die Nebenwege des Anmeldebildschirms. Der erste bekommt die Trennlinie,
     damit klar ist: Hier hört das Anmelden auf und fängt etwas anderes an. */
  .alt { margin-top: .5rem; }
  .alt:first-of-type { margin-top: 1.25rem; border-top: 1px solid var(--line); padding-top: .75rem; }
  /* Zugeklappt ein Knopf, aufgeklappt eine Überschrift: Ein blosser Textlink
     sagt auf dem Handy niemandem, dass er antippbar ist — und genau diese
     Wege braucht jemand, der noch kein Konto hat oder nicht mehr hineinkommt.
     Deutlich leichter als «Rein da», weil das Anmelden der Normalfall bleibt. */
  .alt > summary {
    display: flex; align-items: center; justify-content: center;
    list-style: none; cursor: pointer; min-height: 48px; padding: .5rem .9rem;
    border: 1px solid var(--line); border-radius: 14px;
    background: var(--surface); color: var(--soft); font-size: 1rem;
  }
  .alt > summary::-webkit-details-marker { display: none; }
  .alt > summary:hover { color: var(--ink); }
  .alt > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .alt[open] > summary {
    min-height: 0; border-color: transparent; background: transparent;
    color: var(--ink); font-weight: 600;
  }
  .alt > form { padding: .25rem 0 .5rem; }
  .hint { margin: 0; color: var(--soft); font-size: .85rem; }
  /* Das einzige Kreuzchen auf diesen Seiten: linksbündig, weil eine zentrierte
     Checkbox mit Text daneben immer schief aussieht. */
  .check {
    display: flex; align-items: center; gap: .5rem; text-align: left;
    color: var(--soft); font-size: .9rem; cursor: pointer;
  }
  .check > input { width: auto; min-height: 0; flex: none; }
  a { color: var(--accent); }
`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Eine schlichte Seite mit demselben Aussehen wie der Anmeldebildschirm.
 * `inhalt` ist fertiges HTML — wer dort Benutzereingaben einsetzt, führt sie
 * durch `escapeHtml`.
 */
export function htmlSeite({
  titel,
  inhalt,
  status = 200,
  breit = false,
  zusatzCss = '',
}: {
  titel: string;
  inhalt: string;
  status?: number;
  /**
   * Für Seiten, die keine Formularbox sind. Die Vorgabe bleibt schmal und
   * zentriert — das ist, was die drei Seiten rund um die Anmeldung brauchen.
   */
  breit?: boolean;
  /**
   * Regeln nur für DIESE Seite, hinter `SEITEN_CSS` gehängt.
   *
   * Die Tipp-Kacheln der geteilten Liste gehören nicht ins geteilte Stylesheet:
   * Sie kämen sonst bei jedem Anmeldebildschirm mit über die Leitung, obwohl
   * dort nichts davon vorkommt. Die Farbtokens, der Dunkelmodus und die Schrift
   * bleiben trotzdem geteilt — genau darum geht es in `SEITEN_CSS`.
   */
  zusatzCss?: string;
}): Response {
  const html = `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(titel)}</title>
<style>${SEITEN_CSS}${zusatzCss}</style>
</head>
<body>
  <main class="box${breit ? ' box--breit' : ''}">
${inhalt}
  </main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Ein Reset-Formular darf nie im Verlauf oder in einem Zwischenspeicher
      // liegen bleiben — es trägt den Token im Rumpf.
      'Cache-Control': 'no-store',
    },
  });
}
