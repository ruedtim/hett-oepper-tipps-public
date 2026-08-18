/**
 * Die Seite, die ein Freigabelink zeigt.
 *
 * Server-gerendert und ohne das React-Bundle, aus demselben Grund wie bei
 * `passwort-neu.ts` und `email-bestaetigen.ts`: Was die Seite nachladen müsste,
 * läge selbst hinter dem Gate — und was davor läge, wäre öffentlich. Nebenbei
 * ist das die Fassung, die auf einem sparsam eingerichteten Browser und in jeder
 * Chat-Vorschau funktioniert, denn sie braucht kein JavaScript.
 *
 * Das Aussehen kommt aus `SEITEN_CSS` (Farbtokens, Dunkelmodus, Schrift) plus
 * den Regeln hier unten. Die gehören NICHT ins geteilte Stylesheet: Tipp-Kacheln
 * kämen sonst bei jedem Anmeldebildschirm mit über die Leitung.
 *
 * Was diese Datei NICHT tut, ist Daten wegzulassen. Die Kürzung — fremde
 * Beiträge ohne Namen und Foto — passiert in `buildGeteilteAnsicht`, also schon
 * beim Lesen aus D1. Eine Vorlage, die die Auslassung selbst besorgt, ist genau
 * einen Tippfehler von einer Seite entfernt, die alles ausplaudert.
 */

import { formatDay, formatMonth } from '../../shared/datum.mjs';
import { countryFlag, countryName } from '../../shared/laender.mjs';
import { mapsUrl } from '../../shared/maps.mjs';
import type { AppTip } from './appdata';
import type { Category } from './db';
import { escapeHtml, htmlSeite } from './htmlSeite';

const LISTE_CSS = `
  .kopf { margin-bottom: 1.5rem; }
  .tipp {
    margin: 0 0 1rem; padding: 1rem 1.1rem;
    border: 1px solid var(--line); border-radius: 16px; background: var(--surface);
  }
  .tipp--zu { opacity: .7; }
  .tipp h2 { margin: 0 0 .15rem; font-size: 1.15rem; letter-spacing: -.01em; }
  .tipp__ort { margin: 0 0 .6rem; color: var(--soft); font-size: .9rem; }
  .tipp__zu {
    display: inline-block; margin-left: .4rem; padding: .05rem .45rem;
    border-radius: 999px; background: var(--line); color: var(--soft);
    font-size: .72rem; font-weight: 600; letter-spacing: .02em; vertical-align: .1em;
  }
  .tipp__kategorien { margin: 0 0 .6rem; font-size: .85rem; color: var(--soft); }
  .tipp__adresse { margin: 0 0 .6rem; font-size: .88rem; color: var(--soft); }
  .tipp__wege { margin: 0 0 .8rem; font-size: .88rem; }
  .tipp__wege a { margin-right: .9rem; white-space: nowrap; }
  .notiz { margin: .8rem 0 0; padding-top: .8rem; border-top: 1px solid var(--line); }
  .notiz:first-of-type { border-top: 0; padding-top: 0; }
  .notiz__wer { margin: 0 0 .2rem; color: var(--soft); font-size: .8rem; }
  .notiz__text { margin: 0; white-space: pre-wrap; }
  /* Unter dem Text und nicht darüber — wie in der App: Erst was jemand sagt,
     dann was er gesehen hat. */
  .notiz__foto {
    display: block; width: 100%; height: auto; margin-top: .6rem;
    border-radius: 12px; background: var(--line);
  }
  .fuss { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  .fuss p { margin: 0 0 .4rem; color: var(--soft); font-size: .85rem; }
`;

function kategorienZeile(tip: AppTip, categories: Category[]): string {
  const nachId = new Map(categories.map((kategorie) => [kategorie.id, kategorie]));
  const teile = tip.categories
    .map((id) => nachId.get(id))
    .filter((kategorie): kategorie is Category => Boolean(kategorie))
    .map((kategorie) => `${kategorie.emoji} ${escapeHtml(kategorie.label)}`);
  return teile.length > 0 ? `<p class="tipp__kategorien">${teile.join(' · ')}</p>` : '';
}

function wegeZeile(tip: AppTip): string {
  const wege = [
    `<a href="${escapeHtml(mapsUrl(tip))}" target="_blank" rel="noreferrer noopener">${
      tip.coords ? 'Auf Google Maps' : 'In Google Maps suchen'
    }</a>`,
  ];
  // Nur http(s): Ein Link aus den Daten ist zwar beim Anlegen geprüft, aber
  // diese Seite ist die eine, die Fremden ausgeliefert wird — hier wird nichts
  // geglaubt, was ein `javascript:` sein könnte.
  if (tip.link && /^https?:\/\//i.test(tip.link)) {
    wege.push(
      `<a href="${escapeHtml(tip.link)}" target="_blank" rel="noreferrer noopener">Website</a>`,
    );
  }
  return `<p class="tipp__wege">${wege.join('')}</p>`;
}

function notizZeile(note: AppTip['notes'][number], fotoBasis: string): string {
  // `by` ist bei fremden Beiträgen leer — so kommt es aus buildGeteilteAnsicht.
  // Dann nennt die Zeile nur den Monat: Das sagt, wann jemand dort war, nicht wer.
  const wer = note.by
    ? `${escapeHtml(note.by)} · ${escapeHtml(formatMonth(note.added))}`
    : escapeHtml(formatMonth(note.added));
  const foto = note.photo
    ? `<img class="notiz__foto" src="${escapeHtml(`${fotoBasis}/${note.photo}`)}" alt="" loading="lazy" decoding="async">`
    : '';
  return `      <div class="notiz">
        <p class="notiz__wer">${wer}</p>
        <p class="notiz__text">${escapeHtml(note.text)}</p>
${foto ? `        ${foto}\n` : ''}      </div>`;
}

function tippKachel(tip: AppTip, categories: Category[], basis: string): string {
  const flagge = countryFlag(tip.country);
  const ort = `${flagge ? `${flagge} ` : ''}${escapeHtml(tip.place)} · ${escapeHtml(
    countryName(tip.country),
  )}`;
  const zu = tip.closed ? '<span class="tipp__zu">gibt&rsquo;s nicht mehr</span>' : '';
  const adresse = tip.address
    ? `<p class="tipp__adresse">${escapeHtml(tip.address)}</p>`
    : '';
  const notizen = tip.notes
    .map((note) => notizZeile(note, `${basis}/foto/${tip.id}`))
    .join('\n');

  return `    <article class="tipp${tip.closed ? ' tipp--zu' : ''}">
      <h2>${escapeHtml(tip.name)}${zu}</h2>
      <p class="tipp__ort">${ort}</p>
${kategorienZeile(tip, categories)}
${adresse}
${wegeZeile(tip)}
${notizen}
    </article>`;
}

const anzahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

/**
 * Die fertige Seite.
 *
 * @param basis Der Pfad des Links selbst («/geteilt/<id>»). Die Fotos hängen
 *   darunter, weil die Berechtigung am Link hängt — ein Foto-Pfad ohne Link-ID
 *   wäre wieder eine offene Tür.
 */
export function geteiltSeite(options: {
  von: string;
  tips: AppTip[];
  categories: Category[];
  verschwunden: number;
  bis: string;
  basis: string;
}): Response {
  const { von, tips, categories, verschwunden, bis, basis } = options;

  const kacheln = tips.map((tip) => tippKachel(tip, categories, basis)).join('\n');

  // Nicht schweigen, wenn etwas fehlt: Sonst sieht der Empfänger eine kürzere
  // Liste, als verschickt wurde, und niemand könnte sagen, woran das liegt.
  const fehlt =
    verschwunden > 0
      ? `<p>${
          verschwunden === 1
            ? 'Ein Tipp aus dieser Liste gibt es inzwischen nicht mehr.'
            : `${verschwunden} Tipps aus dieser Liste gibt es inzwischen nicht mehr.`
        }</p>`
      : '';

  const inhalt = `    <div class="kopf">
      <h1>Tipps von ${escapeHtml(von)}</h1>
      <p class="lead">${
        tips.length === 0
          ? 'Von dieser Liste ist nichts mehr übrig.'
          : `${anzahl(tips.length, 'Tipp', 'Tipps')} aus einer privaten Sammlung.`
      }</p>
    </div>
${kacheln}
    <div class="fuss">
${fehlt}
      <p>Dieser Link zeigt einen festen Ausschnitt und gilt bis zum ${escapeHtml(
        formatDay(bis),
      )}.</p>
      <p>Namen und Fotos stehen nur bei den Beiträgen der Person, die geteilt hat.</p>
    </div>`;

  return htmlSeite({
    titel: `Tipps von ${von}`,
    inhalt,
    breit: true,
    zusatzCss: LISTE_CSS,
  });
}

/**
 * Abgelaufen, widerrufen oder erfunden — dieselbe Antwort für alle drei.
 *
 * Kein Orakel darüber, ob es diesen Link je gab: Eine Seite, die «abgelaufen»
 * von «kenne ich nicht» unterscheidet, sagt einem Fremden, dass er richtig
 * geraten hat. Der Status ist 404 und nicht 410, aus demselben Grund, aus dem
 * `abweisungUnbekannterHost` 404 statt 403 nimmt.
 */
export function linkWegSeite(): Response {
  return htmlSeite({
    titel: 'Link gibt es nicht',
    status: 404,
    inhalt: `    <h1>Der Link gilt nicht mehr</h1>
    <p class="lead">
      Geteilte Listen laufen nach einer Weile ab, und wer sie geteilt hat, kann
      sie jederzeit zurücknehmen. Frag am besten nochmal nach einem frischen Link.
    </p>`,
  });
}
