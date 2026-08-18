-- Zugangsbitten: wer um Zugang bittet, hinterlässt Name und Adresse, und ein
-- Admin schickt mit EINEM Klick den Einladungslink dorthin (#71).
--
-- Bisher war die Bitte ausschliesslich ein GitHub-Issue, und danach musste ein
-- Admin von Hand ein Konto anlegen und ein Startpasswort persönlich übergeben.
-- Das Issue bleibt als Benachrichtigung — aber handeln lässt sich nur an etwas,
-- das die App kennt. Also eine Zeile hier, und der Klick erzeugt eine Einladung
-- nach dem Muster von #64: Die Person legt sich das Konto selbst an, samt
-- eigenem Passwort. Von allein kommt trotzdem niemand herein — ohne den Klick
-- eines Admins entsteht kein Link. Das ist die Bedingung aus dem Issue.
--
-- WARUM EINE TABELLE: dieselbe Antwort wie bei 0010 und 0011 — die Buchhaltung
-- IST der Zweck. Der Deckel («höchstens zehn gleichzeitig offene») lässt sich
-- ohne Zählen nicht durchsetzen, und die Ein-Klick-Liste braucht etwas, worauf
-- sie klicken kann. Der Deckel zählt seit #71 offene ZEILEN statt offener
-- Issues und geht damit von selbst wieder auf, sobald ein Admin die Bitte in
-- der App erledigt; vorher musste der Besitzer dafür Issues schliessen.
--
-- WARUM SIE NICHT IM SPIEGEL STEHT, und warum das keine stillschweigende Lücke
-- ist: weil sie hier ausgesprochen ist. Eine Bitte ist kein Beitrag, den jemand
-- verfasst hat — sie ist eine Frage von draussen, vergänglich, und was aus ihr
-- wird, landet in `users` und `einladungen` (zwei schon dokumentierte Lücken).
-- Geht D1 verloren, muss jemand nochmal fragen. `scripts/restore-to-d1.mjs`,
-- `functions/api/export.ts` und `scripts/fetch-backup.mjs` bleiben unangetastet.

-- Eine im Amt verschickte Einladung ist KEIN persönlicher Link: Sie zählt nicht
-- gegen `users.einladungs_budget` und steht nicht in der Liste unter «Konto».
-- Ohne diese Spalte wäre «drei insgesamt» eine Strafe für die Admins, die die
-- Bitten abarbeiten — nach drei erledigten Bitten wäre Schluss. Widerrufen und
-- angezeigt wird so eine Einladung dort, wo sie hingehört: bei der Bitte.
ALTER TABLE einladungen ADD COLUMN aus_bitte INTEGER NOT NULL DEFAULT 0;

CREATE TABLE zugangsbitten (
  id            INTEGER PRIMARY KEY,   -- Bewusst KEIN 100-Bit-Token wie bei den
                                       -- Einladungen und den geteilten Listen:
                                       -- Die id ist hier keine Berechtigung. Sie
                                       -- wird nur hinter dem Gate und nur von
                                       -- Admins benutzt; unerratbar sein muss
                                       -- der Einladungslink, der daraus entsteht.
  vorname       TEXT NOT NULL,
  nachname      TEXT NOT NULL,         -- Beide getrennt, weil `findeFreienNamen`
                                       -- in functions/einladung.ts daraus den
                                       -- Kontonamen im Stil der Runde baut
                                       -- («Vorname N.») — ein Freitextfeld
                                       -- liesse sich dafür nicht zerlegen.
  email         TEXT NOT NULL,         -- schon durch normalisiereEmail() gegangen
                                       -- (getrimmt und kleingeschrieben), damit
                                       -- der Index unten in beide Richtungen trifft
  erstellt      TEXT NOT NULL,         -- ISO-Datum in Zürcher Ortszeit
  issue_nummer  INTEGER,               -- das GitHub-Issue, das die Runde
                                       -- benachrichtigt hat. NULL, wenn keines
                                       -- entstand (kein Token, GitHub gerade
                                       -- weg) — die Bitte gilt trotzdem.
  erledigt_am   TEXT,                  -- NULL = offen. Der Deckel zählt genau das.
  erledigt_von  INTEGER                -- welcher Admin eingeladen hat
                  REFERENCES users(id),
  einladung_id  TEXT                   -- die daraus verschickte Einladung
                  REFERENCES einladungen(id)
);

-- Dieselbe Bitte zweimal ergibt keine zweite Zeile — die Antwort nach draussen
-- bleibt dabei dasselbe freundliche «Danke», wie bisher beim doppelten Issue.
-- Partiell: Wer schon einmal gefragt hat und abgewiesen wurde, darf später
-- wieder fragen, ohne dass eine alte Zeile das für immer sperrt.
CREATE UNIQUE INDEX zugangsbitten_offen_email
  ON zugangsbitten(email) WHERE erledigt_am IS NULL;

-- Kein weiterer Index: Die Tabelle hält höchstens zehn offene Zeilen plus die
-- paar, deren Einladung noch unterwegs ist. Ein Full Scan darüber ist billiger
-- als der Index, den man dafür pflegen müsste.
