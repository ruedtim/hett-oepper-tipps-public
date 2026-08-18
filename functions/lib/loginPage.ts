/**
 * Der Anmeldebildschirm, den die Middleware ausliefert.
 *
 * Bewusst eine einzige, in sich geschlossene HTML-Antwort ohne externe CSS- oder
 * JS-Datei: Alles, was die Seite nachladen müsste, läge selbst hinter dem Gate —
 * und was davor läge, wäre öffentlich. Das Stylesheet teilt sie sich mit den
 * anderen Seiten vor dem Gate (lib/htmlSeite.ts), damit die drei nicht
 * auseinanderlaufen.
 *
 * Drei Wege hinein, und alle drei funktionieren OHNE JavaScript: Die beiden
 * Nebenwege stecken in <details>-Elementen, die der Browser von sich aus auf-
 * und zuklappt, und jeder ist ein echtes <form method="post">. Deshalb
 * <details> und nicht Knöpfe mit einem Umschalt-Handler — die wären ohne
 * JavaScript tot, und «ich habe noch kein Konto» ist genau der Weg, den jemand
 * mit einem sparsam eingerichteten Browser zuerst braucht. Für «Passwort
 * vergessen» gilt dasselbe doppelt: Wer nicht hineinkommt, sitzt womöglich
 * gerade an einem fremden Gerät. Das JavaScript unten erspart bloss den
 * Seitenwechsel.
 *
 * Meldet der Login «mustChangePassword», blendet das Inline-JS direkt den
 * Passwortwechsel ein (das Startpasswort liegt noch im Speicher). Das ist ein
 * weicher Zwang: Wer ohne JavaScript oder über «Später» vorbeikommt, sieht den
 * Hinweis stattdessen als Banner in der App — Aussperren wäre im Freundeskreis
 * teurer als Nachgiebigkeit.
 */

import { escapeHtml, ICON_LINKS, SEITEN_CSS } from './htmlSeite';

type Bereich = 'anmelden' | 'zugang' | 'vergessen';

export function loginPage(
  options: {
    error?: string;
    notice?: string;
    /**
     * Welcher Abschnitt offen ist und die Meldung trägt. Ohne das stünde die
     * Antwort auf eine Zugangsbitte unter dem Namensformular — beim Weg ohne
     * JavaScript die einzige Rückmeldung, die es gibt.
     */
    bereich?: Bereich;
    status?: number;
  } = {},
): Response {
  const bereich = options.bereich ?? 'anmelden';

  /** Meldung nur im betroffenen Abschnitt — sonst nichts. */
  const meldung = (fuer: Bereich): string => {
    if (fuer !== bereich) return '';
    if (options.error) return `<p class="error" role="alert">${escapeHtml(options.error)}</p>`;
    if (options.notice) return `<p class="notice" role="status">${escapeHtml(options.notice)}</p>`;
    return '';
  };

  const offen = (fuer: Exclude<Bereich, 'anmelden'>): string => (fuer === bereich ? ' open' : '');

  const html = `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
${ICON_LINKS}
<title>Hett öpper Tipps?</title>
<style>${SEITEN_CSS}</style>
</head>
<body>
  <main class="box">
    <h1>Hett öpper Tipps?</h1>
    <p class="lead" id="lead">Bitte mit deinem Konto anmelden.</p>

    <div id="normal">
      <form method="post" action="/api/login" id="login">
        <!-- Name ODER E-Mail: Der Server unterscheidet am «@». Seit die
             Anzeigenamen änderbar sind, ist die Adresse der Weg, der bleibt. -->
        <input
          type="text" name="name" required${bereich === 'anmelden' ? ' autofocus' : ''}
          autocomplete="username" autocapitalize="off" placeholder="Name oder E-Mail"
          aria-label="Name oder E-Mail">
        <input
          type="password" name="password" required
          autocomplete="current-password" placeholder="Passwort"
          aria-label="Passwort">
        <button type="submit">Rein da</button>
        ${meldung('anmelden')}
      </form>

      <details class="alt"${offen('vergessen')}>
        <summary>Passwort vergessen?</summary>
        <form method="post" action="/api/passwort-vergessen" id="vergessen">
          <p class="hint">
            Geht nur mit hinterlegter E-Mail-Adresse. Ohne eine: in der Runde fragen — ein Admin
            setzt ein neues Startpasswort.
          </p>
          <input
            type="text" name="eingabe" required${bereich === 'vergessen' ? ' autofocus' : ''}
            autocomplete="username" autocapitalize="off" placeholder="Name oder E-Mail"
            aria-label="Name oder E-Mail">
          <button type="submit">Link schicken</button>
          ${meldung('vergessen')}
        </form>
      </details>

      <details class="alt"${offen('zugang')}>
        <summary>Gib mir bitte Zugang!</summary>
        <form method="post" action="/api/zugang" id="zugang">
          <p class="hint">
            Kennst du jemanden aus der Runde? Am schnellsten geht ein Einladungslink — jedes
            Konto hat drei davon zu vergeben, und damit legst du dir selbst eines an. Sonst:
            Sag hier, wer du bist. Meldet dich die Runde frei, kommt ein Einladungslink an
            deine Adresse, und damit legst du dein Konto selbst an.
          </p>
          <input
            type="text" name="vorname" required maxlength="40"${bereich === 'zugang' ? ' autofocus' : ''}
            autocomplete="given-name" placeholder="Vorname"
            aria-label="Vorname">
          <input
            type="text" name="nachname" required maxlength="40"
            autocomplete="family-name" placeholder="Nachname"
            aria-label="Nachname">
          <input
            type="email" name="email" required maxlength="200"
            autocomplete="email" placeholder="E-Mail"
            aria-label="E-Mail-Adresse">
          <button type="submit">Bitte abschicken</button>
          ${meldung('zugang')}
        </form>
      </details>
    </div>

    <!-- Nur mit JavaScript sichtbar, und das ist in Ordnung: Ohne JS landet man
         nach dem Anmelden in der App und findet dort das Banner und die
         Konto-Seite, wo dasselbe steht. Deshalb darf hier auch die E-Mail
         stehen, ohne den Vertrag «alles geht ohne JavaScript» zu brechen. -->
    <form id="change" hidden>
      <input
        type="password" name="new" required minlength="8"
        autocomplete="new-password" placeholder="Neues Passwort"
        aria-label="Neues Passwort">
      <input
        type="password" name="repeat" required minlength="8"
        autocomplete="new-password" placeholder="Neues Passwort, nochmal"
        aria-label="Neues Passwort wiederholen">
      <p class="hint">
        Magst du eine E-Mail-Adresse hinterlegen? Damit kannst du dich auch damit anmelden, ein
        vergessenes Passwort selbst zurücksetzen und erfahren, wenn jemand Tipps sucht. Geht auch
        später unter «Konto» — oder gar nicht.
      </p>
      <input
        type="email" name="email" maxlength="200"
        autocomplete="email" placeholder="E-Mail (empfohlen)"
        aria-label="E-Mail-Adresse, empfohlen">
      <label class="check">
        <input type="checkbox" name="wuensche" checked>
        Ich möchte über Wünsche anderer informiert werden
      </label>
      <button type="submit">Passwort setzen</button>
      <button type="button" class="ghost" id="later">Später ändern</button>
    </form>
  </main>
<script>
(function () {
  var normal = document.getElementById('normal');
  var login = document.getElementById('login');
  var zugang = document.getElementById('zugang');
  var vergessen = document.getElementById('vergessen');
  var change = document.getElementById('change');
  var lead = document.getElementById('lead');
  var startPassword = '';

  // Bis #70 bedienten sich hier zwei Formulare: Anmelden und «nur schauen»
  // gingen beide an /api/login und unterschieden sich nur im Rumpf. Der zweite
  // ist weg; die eigene Funktion bleibt, weil sie den Fall «erst noch das
  // Startpasswort wechseln» mitträgt und dafür Zustand über den Aufruf hinaus
  // braucht (startPassword).
  function anmelden(form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = form.querySelector('button');
      button.disabled = true;
      show(form, '');

      try {
        var response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.elements.name.value,
            password: form.elements.password.value
          })
        });
        var data = await response.json().catch(function () { return {}; });
        if (response.ok) {
          if (data.mustChangePassword) {
            // Das Startpasswort hat ein Admin vergeben — jetzt ein eigenes wählen.
            startPassword = form.elements.password.value;
            normal.hidden = true;
            change.hidden = false;
            lead.textContent = 'Fast geschafft — bitte ein eigenes Passwort wählen (mind. 8 Zeichen).';
            change.elements.new.focus();
            return;
          }
          // Neu laden statt weiterleiten: So bleibt der Hash erhalten, und wer
          // einen geteilten Filter-Link geöffnet hat, landet danach genau dort.
          window.location.reload();
          return;
        }
        show(form, data.error || 'Das hat nicht geklappt.');
      } catch (cause) {
        show(form, 'Keine Verbindung. Nochmal versuchen?');
      }
      button.disabled = false;
      form.elements.password.select();
    });
  }

  anmelden(login);

  // Zugangsbitte und «Passwort vergessen» verhalten sich gleich: einmal
  // abschicken, dann steht da eine Antwort und kein Formular mehr. Ein Handler
  // für beide — zwei Kopien liefen mit der Zeit auseinander.
  function bitte(form, pfad, koerper, dank) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = form.querySelector('button');
      button.disabled = true;
      show(form, '');

      try {
        var response = await fetch(pfad, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(koerper(form))
        });
        var data = await response.json().catch(function () { return {}; });
        if (response.ok) {
          // Formular weg, Antwort stehen lassen: Ein zweites Mal drücken
          // bewirkt ohnehin nichts, aber es soll auch nicht danach aussehen.
          form.innerHTML = '';
          show(form, data.hinweis || dank, 'notice');
          return;
        }
        show(form, data.error || 'Das hat nicht geklappt.');
      } catch (cause) {
        show(form, 'Keine Verbindung. Nochmal versuchen?');
      }
      button.disabled = false;
    });
  }

  bitte(zugang, '/api/zugang', function (form) {
    return {
      vorname: form.elements.vorname.value,
      nachname: form.elements.nachname.value,
      email: form.elements.email.value
    };
  }, 'Danke — die Bitte ist angekommen.');

  bitte(vergessen, '/api/passwort-vergessen', function (form) {
    return { eingabe: form.elements.eingabe.value };
  }, 'Wenn es dazu ein Konto mit bestätigter E-Mail gibt, ist eine Nachricht unterwegs.');

  change.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (change.elements.new.value !== change.elements.repeat.value) {
      show(change, 'Die beiden Eingaben stimmen nicht überein.');
      return;
    }
    var button = change.querySelector('button');
    button.disabled = true;
    show(change, '');

    try {
      var response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: startPassword,
          newPassword: change.elements.new.value
        })
      });
      if (response.ok) {
        await hinterlegeEmail();
        return;
      }
      var data = await response.json().catch(function () { return {}; });
      show(change, data.error || 'Das hat nicht geklappt.');
    } catch (cause) {
      show(change, 'Keine Verbindung. Nochmal versuchen?');
    }
    button.disabled = false;
  });

  // BEWUSST ein zweiter Aufruf und nicht ein Feld im Passwort-Rumpf: Das
  // Passwort ist gesetzt, sobald der erste durch ist, und daran darf ein
  // Adressproblem (schon vergeben, Mail-Dienst weg) nichts mehr ändern. Das
  // frische Sitzungs-Cookie aus der Antwort trägt diesen Aufruf durchs Gate.
  async function hinterlegeEmail() {
    var email = change.elements.email.value.trim();
    if (!email) {
      window.location.reload();
      return;
    }

    try {
      var response = await fetch('/api/account/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          benachrichtigungWuensche: change.elements.wuensche.checked
        })
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      var data = await response.json().catch(function () { return {}; });
      show(change, (data.error || 'Die Adresse liess sich nicht speichern.') +
        ' Das Passwort ist gesetzt — die Adresse kannst du unter «Konto» nachtragen.');
    } catch (cause) {
      show(change, 'Das Passwort ist gesetzt, die Adresse kam nicht durch. ' +
        'Du kannst sie unter «Konto» nachtragen.');
    }
    // Ab hier führt nur noch «Weiter» aus dem Formular heraus: Nochmal
    // «Passwort setzen» drücken scheiterte am inzwischen geänderten Passwort.
    change.querySelector('button[type="submit"]').hidden = true;
    document.getElementById('later').textContent = 'Weiter';
  }

  document.getElementById('later').addEventListener('click', function () {
    window.location.reload();
  });

  function show(form, message, art) {
    var existing = form.querySelector('.error, .notice');
    if (existing) existing.remove();
    if (!message) return;
    var p = document.createElement('p');
    p.className = art === 'notice' ? 'notice' : 'error';
    p.setAttribute('role', art === 'notice' ? 'status' : 'alert');
    p.textContent = message;
    form.appendChild(p);
  }
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: options.status ?? 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
