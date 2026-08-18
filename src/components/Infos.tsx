interface Props {
  onClose: () => void;
  /** Beitritts-Link zum Signal-Chat — `null`, wenn er nicht konfiguriert ist. */
  signalChat: string | null;
}

/** Was die Seite kann, Guidelines und ein paar Worte zum Projekt. */
export default function Infos({ onClose, signalChat }: Props) {
  return (
    <div className="form">
      <div className="detail__bar">
        <button type="button" className="linkbutton" onClick={onClose}>
          ← Zurück
        </button>
      </div>

      <h1 className="form__title">Infos</h1>

      <section className="infos__part">
        <h2 className="infos__title">Was das hier ist</h2>
        <p>
          Eine zentrale Datenbank mit den heissen Tipps für deine Reise — Beizen, Bars, Bäder,
          Wanderungen, alles, wovon man mal irgendwann in einem Chat gelesen hat und es zwei Wochen
          später nicht mehr findet. Eine Liste, die fortlaufend ergänzt wird und hoffentlich den Weg
          zu ganz vielen lieben Menschen findet.
        </p>
      </section>

      <section className="infos__part">
        <h2 className="infos__title">Als App aufs Handy</h2>
        <p>
          Die Seite lässt sich auf den Home-Bildschirm legen — eigenes Icon, keine Adressleiste,
          und die Tipps sind auch ohne Netz lesbar (der Stand vom letzten Besuch, praktisch im
          Ausland). Ein App-Store ist nicht nötig:
        </p>
        <ul className="infos__list">
          <li>
            <strong>iPhone und iPad:</strong> Die Seite in Safari öffnen, unten auf das
            Teilen-Symbol tippen (das Viereck mit dem Pfeil nach oben), dann
            «Zum Home-Bildschirm».
          </li>
          <li>
            <strong>Android:</strong> Die Seite in Chrome öffnen, oben rechts auf das Menü (⋮)
            tippen, dann «Zum Startbildschirm hinzufügen» — je nach Handy heisst der Punkt auch
            «App installieren».
          </li>
        </ul>
      </section>

      <section className="infos__part">
        <h2 className="infos__title">Was du tun kannst</h2>
        <ul className="infos__list">
          <li>
            <strong>Tipp eintragen.</strong> Mit einem Account kannst du neue Tipps erfassen. Name,
            Ort, Kategorie, ein paar Sätze — Foto und Punkt auf der Karte sind freiwillig. Tipp: Ein
            Google-Maps-Link füllt das meiste von allein aus.
          </li>
          <li>
            <strong>Suchen.</strong> Tipp ins Suchfeld, was du im Kopf hast — es schlägt dir vor,
            ob du den Ort, eine Adresse oder ein bestimmtes Lokal meinst. Sonst filterst du von
            Hand nach Kategorie, Ort, Land, Person und Umkreis. Die Filter stehen im Link — den
            kannst du so weiterschicken.
          </li>
          <li>
            <strong>«Notiz zu einem Beitrag».</strong> Deine Notiz kommt an den bestehenden Tipp,
            statt dass derselbe Ort zweimal in der Liste steht. Etwa: „Ich war auch da und es war
            grandiosooo.“
          </li>
          <li>
            <strong>Korrigieren.</strong> Was du geschrieben hast, kannst du jederzeit ändern —
            Text und Foto. Bei fremden Beiträgen helfen die Admins.
          </li>
          <li>
            <strong>«Gibt&rsquo;s nicht mehr».</strong> Der Eintrag bleibt lesbar, nur ausgegraut.
            Ganz gelöscht wird selten — und nur, wenn niemand sonst daran mitgeschrieben hat.
          </li>
          <li>
            <strong>Wünsche.</strong> Sag, wohin du fährst und bis wann. Wer etwas weiss, hängt
            passende Tipps direkt an deinen Wunsch. Danach verschwindet er von selbst.
          </li>
          <li>
            <strong>Nichts geht verloren.</strong> Jede Änderung steht im Verlauf und lässt sich
            rückgängig machen. Dein Name kommt automatisch aus deinem Konto.
          </li>
          <li>
            <strong>Leute einladen.</strong> Unter «Konto» liegen drei Einladungslinks für dich.
            Wer einen davon öffnet, legt sich selbst ein Konto an — mit eigenem Namen, eigener
            Adresse, eigenem Passwort, und niemand muss etwas freischalten. Wem du zusätzlich aktiven Zugang zu unserer Sammlung
            gibst, entscheidest du damit selbst.
          </li>
          <li>
            <strong>Liste teilen.</strong> Stell dir per Filter eine Auswahl zusammen und drück
            «Diese Liste teilen» — der Link zeigt genau diese Tipps auch Leuten ohne Konto, mit
            deinen eigenen Notizen und Fotos. Anders als eine Einladung gibt er nur diesen
            Ausschnitt her, und hineinschreiben kann damit niemand. Der Link gilt 90 Tage und
            lässt sich unter «Konto» einzeln zurückziehen.
          </li>
          <li>
            <strong>Mitdenken.</strong> Du hast einen Vorschlag, was an diesem Projekt geändert
            werden sollte:{' '}
            {signalChat ? (
              <>
                Komm in den{' '}
                <a href={signalChat} target="_blank" rel="noopener">
                  Signal-Chat
                </a>{' '}
                und denk und entscheide mit.
              </>
            ) : (
              'Sag es in der Runde und denk und entscheide mit.'
            )}
          </li>
        </ul>
      </section>

      <section className="infos__part">
        <h2 className="infos__title">Guidelines</h2>
        <ul className="infos__list">
          <li>
            <strong>Nur, was du selbst kennst.</strong> Ein Tipp ist eine Empfehlung aus erster
            Hand, kein Ausschnitt aus einem Reiseführer.
          </li>
          <li>
            <strong>Ein Ort, ein Eintrag.</strong> Warst du auch da, häng deine Notiz an, statt
            einen zweiten anzulegen.
          </li>
          <li>
            <strong>Konkret und kreativ.</strong> … wenn du magst. Sag uns, was den Ort spezifisch
            auszeichnet, welchen Drink man unbedingt probieren sollte, wann man am besten da hin
            geht, usw.
          </li>
          <li>
            <strong>Fremdes stehen lassen.</strong> Macht ein Laden zu, hilft der Button
            «Gibt&rsquo;s nicht mehr». Löschen ist für Dubletten und Fehleinträge.
          </li>
          <li>
            <strong>Das bleibt unter uns.</strong> Keine Zugangsdaten oder Screenshots weitergeben —
            wer mitlesen soll, bekommt einen eigenen Zugang oder anonymisierte Tipps als Share-Link.
          </li>
          <li>
            <strong>Lieber eintragen als zögern.</strong> Es geht nichts kaputt, was sich nicht
            zurückholen liesse.
          </li>
        </ul>
      </section>

      <section className="infos__part">
        <h2 className="infos__title">Über das Projekt</h2>
        <p>Gebastelt von Tim.</p>
        <p>
          Der Code dieser Plattform liegt auf{' '}
          <a
            className="textlink"
            href="https://github.com/ruedtim/hett-oepper-tipps-public"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
          .
        </p>
      </section>
    </div>
  );
}
