/**
 * Die Seite hinter einem Einladungslink (#64): Hier registriert sich jemand
 * selbst — Vorname, Nachname, E-Mail, eigenes Passwort — und ist danach sofort
 * angemeldet. Kein Admin legt ein Konto an, niemand übergibt ein Startpasswort.
 *
 * Kein `/api/`-Pfad, weil sie für Menschen ist: eine eigenständige HTML-Seite
 * mit einem echten `<form method="post">` und ganz OHNE JavaScript — wer noch
 * kein Konto hat, hat erst recht keinen eingerichteten Browser. Aussehen und
 * Hülle kommen aus lib/htmlSeite.ts, wie bei /passwort-neu.
 *
 * Sie liegt VOR dem Gate (Ausnahme in functions/_middleware.ts, exakter Pfad
 * und exakt GET|POST) — hätte sie eine Sitzung nötig, wäre sie nutzlos. Damit
 * ist POST /einladung der dritte öffentliche Schreibweg neben der Zugangsbitte
 * und «Passwort vergessen», und wie dort ist der Deckel strukturell statt
 * einer Ratenbegrenzung: Ohne 100-Bit-Token schreibt nichts (das Muster wird
 * vor jedem D1-Read geprüft), pro Konto existieren höchstens drei Links, jeder
 * stirbt mit der ersten Einlösung und nach 90 Tagen von selbst — die Menge
 * möglicher Konten ist also genau die Menge offener Einladungen, und die hat
 * die Runde selbst in der Hand (Widerruf auf der Konto-Seite). Ein
 * gescheiterter POST mit gültigem Token verbraucht ihn absichtlich NICHT: Ein
 * Tippfehler im Formular darf die Einladung nicht töten.
 *
 * Der Kontoname entsteht automatisch als «Vorname N.» (Stil der Runde). Ist
 * er vergeben, wächst der Nachnamensteil («Vorname Na.», «Vorname Nac.», …)
 * bis zum vollen Nachnamen — geprüft mit `pruefeNeuenNamen`, das auch früher
 * getragene Namen sperrt. Erst wenn alles belegt ist, hilft nur ein anderer
 * Vorname, und das sagt der Fehler dann auch.
 */

import { heuteIso } from '../shared/datum.mjs';
import { searchKey } from '../shared/normalize.mjs';
import { einloesungsStmts, getOffeneEinladung, ID_MUSTER } from './lib/einladungen';
import { configurationError, missingSecrets } from './lib/env';
import type { Env } from './lib/env';
import { escapeHtml, htmlSeite } from './lib/htmlSeite';
import { mailKonfiguriert, normalisiereEmail, sendeMail } from './lib/mail';
import { createSessionValue, SESSION_COOKIE, sessionCookieHeader } from './lib/session';
import { erzeugeToken, VERIFIKATION_GUELTIG_SEK } from './lib/token';
import { MAX_NAME_LENGTH, pruefeNeuenNamen } from './lib/umbenennen';
import { raeumeErledigteBitten } from './lib/zugangsbitten';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './lib/users';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const token = new URL(request.url).searchParams.get('token') ?? '';
  // Schon beim Öffnen VOLL prüfen, Datenbankzeile inklusive — dieselbe
  // Begründung wie bei /passwort-neu: Ein eingelöster oder widerrufener Link
  // zeigte sonst brav ein Formular und sagte erst nach dem Ausfüllen, dass er
  // tot ist.
  const einladung = await ladeEinladung(env, token);
  if (!einladung.ok) return einladung.antwort;

  // Kommt die Einladung aus einer Zugangsbitte (#71), hat die Person Vorname,
  // Nachname und Adresse schon auf dem Anmeldebildschirm eingetippt. Sie hier
  // nochmal zu verlangen wäre eine Prüfung, ob sie sich noch erinnert.
  return formular(token, einladung.vonName, einladung.ausBitte);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const missing = missingSecrets(env);
  if (missing.length > 0) return configurationError(missing);

  const db = env.DB as D1Database;
  const secret = env.SESSION_SECRET as string;

  // Nur Formulardaten: Diese Seite hat kein JavaScript, das JSON schicken würde.
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('token') ?? '');

  // Derselbe Lader wie beim GET, damit die beiden Wege nicht unterschiedlich
  // streng werden können.
  const einladung = await ladeEinladung(env, token);
  if (!einladung.ok) return einladung.antwort;

  const vorname = saeubere(String(form?.get('vorname') ?? ''));
  const nachname = saeubere(String(form?.get('nachname') ?? ''));
  const emailEingabe = String(form?.get('email') ?? '');
  const neu = String(form?.get('neu') ?? '');
  const wiederholung = String(form?.get('wiederholung') ?? '');
  // Kreuzchen: nicht im Formular heisst nicht angehakt — kein Server-Default.
  const wuensche = form?.get('wuensche') != null;

  const eingaben = { vorname, nachname, email: emailEingabe, wuensche };
  const nochmal = (fehler: string) => formular(token, einladung.vonName, { ...eingaben, fehler });

  if (!vorname || !nachname) return nochmal('Bitte Vor- und Nachname angeben.');

  const email = normalisiereEmail(emailEingabe);
  if (!email) return nochmal('Das sieht nicht nach einer E-Mail-Adresse aus.');

  if (neu !== wiederholung) return nochmal('Die beiden Passwörter stimmen nicht überein.');
  if (neu.length < MIN_PASSWORD_LENGTH) {
    return nochmal(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  }
  if (neu.length > MAX_PASSWORD_LENGTH) return nochmal('Das Passwort ist zu lang.');

  const gefunden = await findeFreienNamen(db, vorname, nachname);
  if ('fehler' in gefunden) return nochmal(gefunden.fehler);
  const name = gefunden.name;

  const hash = await hashPassword(neu);
  const mailGehtRaus = mailKonfiguriert(env);
  const heute = heuteIso();

  let ergebnis: D1Result[];
  try {
    ergebnis = await db.batch(
      einloesungsStmts(db, {
        einladungId: einladung.id,
        heute,
        name,
        nameKey: searchKey(name),
        passwortHash: hash,
        email,
        mailGehtRaus,
        benachrichtigungWuensche: wuensche,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Der Batch ist eine Transaktion: Nach einem UNIQUE-Fehler ist nichts
    // passiert, die Einladung lebt noch — das Formular darf es nochmal sagen.
    if (message.includes('UNIQUE constraint failed')) {
      if (message.includes('users.email')) {
        // Konkret statt generisch, anders als beim öffentlichen «Passwort
        // vergessen»: Wer hier steht, wurde von jemandem aus der Runde
        // eingeladen — und eine Ausrede würde genau die Person stranden
        // lassen, deren Adresse wirklich schon ein Konto hat.
        return nochmal(
          'Diese Adresse ist schon bei einem Konto eingetragen. Vielleicht hast du schon eines? ' +
            'Dann melde dich einfach an — der Einladungslink bleibt gültig.',
        );
      }
      return nochmal('Der Name wurde gerade eben vergeben — bitte nochmal abschicken.');
    }
    throw error;
  }

  // Der Batch «gelingt» auch, wenn er nichts getan hat — hat eine
  // gleichzeitige Einlösung gewonnen, blieb das INSERT leer. `meta.changes`
  // des INSERT ist die einzige Wahrheit.
  if (ergebnis[0]?.meta.changes !== 1) return linkTot();
  const userId = ergebnis[0].meta.last_row_id as number;

  // Kam die Einladung aus einer Zugangsbitte (#71), ist die Bitte mit diesem
  // Konto beantwortet und ihre Zeile schal. Hier ist die Stelle, an der das
  // passiert — also wird hier weggeräumt, wie bei den Wünschen und den
  // geteilten Listen: nach dem Schreiben und in try/catch.
  await raeumeErledigteBitten(db, heute);

  // Bestätigungsmail nach der Antwort und nie im Weg — Mail darf nichts
  // aufhalten. Ohne Mail-Konfiguration entfällt sie still; die Adresse steht
  // dann unbestätigt am Konto, und die Konto-Seite bietet «nochmal senden» an.
  if (mailGehtRaus) {
    const herkunft = new URL(request.url).origin;
    context.waitUntil(
      (async () => {
        try {
          const evToken = await erzeugeToken(secret, 'ev', userId, email, VERIFIKATION_GUELTIG_SEK);
          await sendeMail(env, {
            an: email,
            betreff: 'Bitte bestätigen: E-Mail für «Hett öpper Tipps?»',
            text:
              `Hallo ${name}\n\n` +
              'Schön, bist du dabei! Diese Adresse wurde bei deinem neuen Konto hinterlegt. ' +
              'Ein Klick, und sie gilt:\n\n' +
              `${herkunft}/email-bestaetigen?token=${encodeURIComponent(evToken)}\n\n` +
              'Der Link gilt einen Tag. Danach kannst du dich auch mit der Adresse anmelden, ' +
              'ein vergessenes Passwort selbst zurücksetzen und dich über neue Wünsche ' +
              'benachrichtigen lassen.\n\n' +
              'Hast du damit nichts zu tun, ignorier diese Nachricht einfach — ohne Klick ' +
              'passiert nichts.\n',
          });
        } catch (error) {
          console.error('Bestätigungsmail nach Einladung kam nicht raus:', error);
        }
      })(),
    );
  }

  // Wie bei /passwort-neu: Die Antwort setzt das Sitzungs-Cookie, der 303
  // führt in die App — man ist angemeldet.
  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: '/' });
  headers.append(
    'Set-Cookie',
    sessionCookieHeader(SESSION_COOKIE, await createSessionValue(secret, userId, hash), secure),
  );
  return new Response(null, { status: 303, headers });
};

/**
 * Einladung prüfen und den Namen des Einladenden holen — für GET und POST
 * dasselbe. Unbekannt, eingelöst, widerrufen, abgelaufen, Einlader
 * deaktiviert: alles derselbe Ausgang. Was aus dem Link geworden ist, geht
 * den Aufrufer nichts an.
 */
async function ladeEinladung(
  env: Env,
  token: string,
): Promise<
  | {
      ok: true;
      id: string;
      vonName: string;
      /** Angaben aus der Zugangsbitte, leer bei einer persönlichen Einladung. */
      ausBitte: { vorname?: string; nachname?: string; email?: string };
    }
  | { ok: false; antwort: Response }
> {
  // Das Muster zuerst: Müll kostet keinen D1-Read.
  if (!ID_MUSTER.test(token)) return { ok: false, antwort: linkTot() };

  try {
    const zeile = await getOffeneEinladung(env.DB as D1Database, token, heuteIso());
    if (!zeile) return { ok: false, antwort: linkTot() };
    return {
      ok: true,
      id: zeile.id,
      vonName: zeile.von_name,
      ausBitte: {
        ...(zeile.bitte_vorname ? { vorname: zeile.bitte_vorname } : {}),
        ...(zeile.bitte_nachname ? { nachname: zeile.bitte_nachname } : {}),
        ...(zeile.bitte_email ? { email: zeile.bitte_email } : {}),
      },
    };
  } catch (error) {
    console.error('D1 beim Einlösen einer Einladung nicht erreichbar:', error);
    return {
      ok: false,
      antwort: htmlSeite({
        titel: 'Einladung',
        status: 503,
        inhalt: `    <h1>Gleich nochmal</h1>
    <p class="lead">Die Datenbank ist gerade nicht erreichbar. Der Link bleibt gültig — probier es in einer Minute wieder.</p>`,
      }),
    };
  }
}

/**
 * Den ersten freien Namen nach dem Schema der Runde finden. Kandidaten, die
 * die Längengrenze sprengen, treten gar nicht erst an — sonst hiesse der
 * Fehler «zu lang», obwohl das Problem «vergeben» war.
 */
async function findeFreienNamen(
  db: D1Database,
  vorname: string,
  nachname: string,
): Promise<{ name: string } | { fehler: string }> {
  const kandidaten: string[] = [];
  for (let laenge = 1; laenge < nachname.length; laenge += 1) {
    kandidaten.push(`${vorname} ${nachname.slice(0, laenge)}.`);
  }
  kandidaten.push(`${vorname} ${nachname}`);

  const passend = kandidaten.filter((kandidat) => kandidat.length <= MAX_NAME_LENGTH);
  if (passend.length === 0) {
    return { fehler: `Der Name ist zu lang — zusammen höchstens ${MAX_NAME_LENGTH} Zeichen.` };
  }

  for (const kandidat of passend) {
    const fehler = await pruefeNeuenNamen(db, kandidat, 0);
    if (!fehler) return { name: kandidat };
    // 400er (etwa: ergibt keinen brauchbaren Anmeldenamen) werden durch mehr
    // Buchstaben desselben Nachnamens nicht besser — sofort zeigen.
    if (fehler.status !== 409) return { fehler: fehler.text };
  }

  return {
    fehler:
      'Alle Namensvarianten aus Vor- und Nachname sind schon vergeben. ' +
      'Ergänze den Vornamen (zum Beispiel um einen zweiten) und probier es nochmal.',
  };
}

/**
 * Auf eine Zeile eindampfen — dieselbe Hygiene wie bei der Zugangsbitte:
 * Steuer- und Formatzeichen raus, Weissraum zusammenfassen.
 */
function saeubere(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formular(
  token: string,
  vonName: string,
  werte: { fehler?: string; vorname?: string; nachname?: string; email?: string; wuensche?: boolean },
): Response {
  // Beim ersten Öffnen ist das Kreuzchen an — wie im Erstanmelde-Formular, und
  // aus demselben Grund: Ohne dieses Formular gäbe es nichts, das
  // `benachrichtigung_wuensche` je einschaltete.
  const wuenscheAn = werte.wuensche ?? true;

  return htmlSeite({
    titel: 'Einladung',
    status: werte.fehler ? 400 : 200,
    inhalt: `    <h1>Du bist eingeladen</h1>
    <p class="lead">
      <strong>${escapeHtml(vonName)}</strong> lädt dich zu «Hett öpper Tipps?» ein —
      der Reisetipp-Sammlung der Runde. Leg dir hier dein Konto an.
    </p>
    <form method="post" action="/einladung">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <input
        type="text" name="vorname" required maxlength="${MAX_NAME_LENGTH}" autofocus
        autocomplete="given-name" placeholder="Vorname"
        aria-label="Vorname" value="${escapeHtml(werte.vorname ?? '')}">
      <input
        type="text" name="nachname" required maxlength="${MAX_NAME_LENGTH}"
        autocomplete="family-name" placeholder="Nachname"
        aria-label="Nachname" value="${escapeHtml(werte.nachname ?? '')}">
      <input
        type="email" name="email" required
        autocomplete="email" placeholder="E-Mail-Adresse"
        aria-label="E-Mail-Adresse" value="${escapeHtml(werte.email ?? '')}">
      <input
        type="password" name="neu" required minlength="${MIN_PASSWORD_LENGTH}"
        autocomplete="new-password" placeholder="Passwort (mindestens ${MIN_PASSWORD_LENGTH} Zeichen)"
        aria-label="Passwort">
      <input
        type="password" name="wiederholung" required minlength="${MIN_PASSWORD_LENGTH}"
        autocomplete="new-password" placeholder="Passwort, nochmal"
        aria-label="Passwort wiederholen">
      <label class="check">
        <input type="checkbox" name="wuensche"${wuenscheAn ? ' checked' : ''}>
        Mail an mich, wenn jemand Tipps sucht
      </label>
      <button type="submit">Konto anlegen</button>
      ${werte.fehler ? `<p class="error" role="alert">${escapeHtml(werte.fehler)}</p>` : ''}
      <p class="hint">
        Dein Kontoname wird «Vorname N.» — ändern kannst du ihn später unter «Konto».
        Die Adresse bekommt eine Bestätigungsmail; erst bestätigt kannst du dich damit
        anmelden und ein vergessenes Passwort selbst zurücksetzen.
      </p>
    </form>`,
  });
}

/** Ein Ausgang für alles, was nicht (mehr) gilt — unbekannt, benutzt, widerrufen, abgelaufen. */
function linkTot(): Response {
  return htmlSeite({
    titel: 'Einladung',
    status: 400,
    inhalt: `    <h1>Dieser Einladungslink gilt nicht mehr</h1>
    <p class="lead">
      Einladungslinks gelten 90 Tage und nur ein einziges Mal. Wenn du dich damit schon
      registriert hast, ist alles gut — melde dich einfach an. Sonst bitte die Person,
      die dich eingeladen hat, um einen neuen Link.
    </p>
    <form method="get" action="/">
      <button type="submit">Zur Anmeldung</button>
    </form>`,
  });
}
