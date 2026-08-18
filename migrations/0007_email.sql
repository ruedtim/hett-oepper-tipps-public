-- E-Mail am Konto: anmelden, Passwort zurücksetzen, benachrichtigt werden.
--
-- Freiwillig — die App funktioniert ohne Adresse genau wie bisher. Wer eine
-- hinterlegt, kann sich damit statt mit dem Namen anmelden (praktisch, seit der
-- Name änderbar ist), ein vergessenes Passwort selbst zurücksetzen und sich über
-- neue Wünsche und Ergänzungen zu den eigenen Tipps informieren lassen.
--
-- Wieder Spalten auf `users` statt eigener Tabellen, aus dem bekannten Grund:
-- `users` steht ohnehin nicht im Backup-Spiegel. Der Preis steht damit auch
-- fest und sei hier ausdrücklich genannt: Adressen und Einstellungen sind NICHT
-- im Repo gesichert — geht D1 verloren, sind sie weg. Das ist der Tausch gegen
-- eine dritte stillschweigende Lücke im Spiegel. Auch die Reset-Tokens brauchen
-- keine Tabelle: Sie sind signiert und kurzlebig (functions/lib/token.ts).
ALTER TABLE users ADD COLUMN email TEXT;                    -- normalisiert: getrimmt, klein
ALTER TABLE users ADD COLUMN email_verifiziert_am TEXT;     -- NULL = noch nicht bestätigt

-- Eine unbestätigte Adresse zählt nirgends: nicht beim Anmelden, nicht beim
-- Zurücksetzen, nicht beim Benachrichtigen. Ein Tippfehler schickt sonst
-- Reset-Links an Fremde, und ein Fremder könnte sich eine fremde Adresse
-- eintragen und damit Post über die Runde bekommen.

-- Standardmässig AUS: Das Kreuzchen im Erstanmelde-Formular ist vorangehakt und
-- schreibt beim Absenden ausdrücklich — Konten, die dieses Formular nie sehen,
-- sollen deswegen nicht ungefragt Post bekommen.
ALTER TABLE users ADD COLUMN benachrichtigung_wuensche INTEGER NOT NULL DEFAULT 0;

-- Standardmässig AN, als Opt-out: Es geht nur um die eigenen Tipps, greift
-- ohnehin erst mit bestätigter Adresse, und «jemand hat deinen Tipp ergänzt»
-- ist genau die Nachricht, die man erwartet. Mit DEFAULT 0 gäbe es kein
-- Formular, das es je einschaltete, und das Feature fände nie statt.
ALTER TABLE users ADD COLUMN benachrichtigung_eigene_tipps INTEGER NOT NULL DEFAULT 1;

-- Zwei Deckel gegen Massenversand über fremde Adressen. Kein eigener Speicher
-- nötig — es geht um genau ein Konto pro Zeile, und Pages hat keinen Cron, der
-- eine Zähltabelle wieder aufräumen könnte.
ALTER TABLE users ADD COLUMN verifikation_gesendet_am TEXT;
ALTER TABLE users ADD COLUMN reset_angefordert_am TEXT;

-- Eine Adresse gehört einem Konto. Partiell, weil NULL der Normalfall bleibt
-- und SQLite sonst nur eine einzige Zeile ohne Adresse zuliesse.
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
