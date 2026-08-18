-- Einladungslinks: Wer ein Konto hat, kann Leute selbst hereinholen (#64).
--
-- Jedes Konto kann drei einmalige Einladungslinks erzeugen. Wer so einen Link
-- öffnet, registriert sich selbst — Vorname, Nachname, E-Mail, eigenes
-- Passwort — ohne dass ein Admin ein Konto anlegt oder ein Startpasswort
-- übergibt. Der Kontoname entsteht automatisch («Vorname N.»).
--
-- WARUM EINE TABELLE, wo `functions/lib/token.ts` eine ausdrücklich vermeidet:
-- dieselbe Antwort wie bei den geteilten Listen (0010). Die Buchhaltung IST
-- der Zweck — ein Deckel («drei insgesamt») lässt sich ohne Zählen nicht
-- durchsetzen, «einmalig» nicht ohne Zustand, und die Konto-Seite zeigt eine
-- Übersicht mit Widerruf. Dazu kommt hier: WER von WEM eingeladen wurde,
-- bleibt für Admins dauerhaft sichtbar (Entscheid des Besitzers, analog zu
-- den alten Namen) — auch das ist Buchhaltung, die ein signierter Token nie
-- tragen könnte. Deshalb werden eingelöste und widerrufene Zeilen NIE
-- weggeräumt: Sie sind zugleich der Zähler gegen das Budget und das
-- Gedächtnis der Herkunft.
--
-- WARUM SIE NICHT IM SPIEGEL STEHT, und warum das keine stillschweigende
-- Lücke ist: weil sie hier ausgesprochen ist. Eine Einladung ist kein Beitrag,
-- den jemand verfasst hat — und das Konto, das aus ihr entsteht, landet in
-- `users`, einer schon dokumentierten Spiegel-Lücke. Geht D1 verloren, sind
-- offene Links tot und die Herkunfts-Anzeige leer; beides ist verschmerzbar
-- und nichts davon liesse sich aus `tips`/`notes` je rekonstruieren.
-- `scripts/restore-to-d1.mjs`, `functions/api/export.ts` und
-- `scripts/fetch-backup.mjs` bleiben unangetastet.

-- Lebenssumme ausgestellter Einladungen, nicht «gleichzeitig offene»:
-- Widerrufen und Abgelaufene zählen weiter. Aufgebraucht heisst darum wirklich
-- aufgebraucht — Nachschub gibt es über «Mehr Einladungen bestellen» und den
-- +3-Knopf der Admins in der Kontenverwaltung, der diese Spalte erhöht.
ALTER TABLE users ADD COLUMN einladungs_budget INTEGER NOT NULL DEFAULT 3;

-- Zeitpunkt der offenen Bestellung («mehr Einladungen, bitte»), NULL = keine.
-- Der +3-Knopf der Admins leert sie wieder. Eine Spalte auf `users` statt
-- einer eigenen Tabelle — dieselbe Präzedenz wie `is_guest` und die
-- E-Mail-Spalten.
ALTER TABLE users ADD COLUMN einladungen_bestellt_am TEXT;

CREATE TABLE einladungen (
  id            TEXT PRIMARY KEY,        -- 20 Zeichen aus dem 32er-Alphabet von
                                         -- lib/geteilt.ts = 100 Bit. Der Link IST
                                         -- die Berechtigung, ein Konto anzulegen —
                                         -- er muss unerratbar sein.
  von_id        INTEGER NOT NULL         -- wer eingeladen hat
                  REFERENCES users(id),  -- Ohne ON DELETE: Konten werden nie
                                         -- gelöscht, nur deaktiviert — und ein
                                         -- deaktiviertes Konto macht den Link beim
                                         -- LESEN tot (Prüfung in
                                         -- lib/einladungen.ts), wie bei den
                                         -- geteilten Listen. `users.id` statt
                                         -- eines Schlüssels aus demselben Grund
                                         -- wie dort: kein Spiegel, und die id
                                         -- überlebt Umbenennungen.
  erstellt      TEXT NOT NULL,           -- ISO-Datum in Zürcher Ortszeit
  bis           TEXT NOT NULL,           -- LETZTER gültiger Tag (inklusiv), 90
                                         -- Tage wie bei den geteilten Listen und
                                         -- mit derselben Begründung: Ein Link, der
                                         -- ein KONTO erzeugt, darf erst recht
                                         -- nicht ewig in alten Chats weiterleben.
                                         -- Lesefilter `bis >= heute`, nie `>`.
  eingeloest_am TEXT,                    -- NULL = noch offen
  eingeloest_von INTEGER                 -- das Konto, das daraus entstand —
                  REFERENCES users(id),  -- die Herkunfts-Anzeige der Admins liest
                                         -- hierüber und löst den Namen beim LESEN
                                         -- auf, wie überall.
  widerrufen_am TEXT                     -- NULL = nicht widerrufen. Widerruf gibt
                                         -- kein Budget zurück (sonst wäre «drei
                                         -- insgesamt» in Wahrheit «drei offene»).
);

-- «Wen habe ICH eingeladen?» fragt die Konto-Seite, «wer lud X ein?» die
-- Kontenverwaltung — beide laufen über von_id bzw. eingeloest_von.
CREATE INDEX einladungen_von ON einladungen(von_id);
CREATE INDEX einladungen_eingeloest_von ON einladungen(eingeloest_von);
