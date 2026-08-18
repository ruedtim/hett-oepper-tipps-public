-- Wünsche: «zu diesen Orten werden Tipps gesucht».
--
-- Die Gegenrichtung zu den Tipps. Vergängliche Gesuche mit Pflicht-Ablaufdatum,
-- typisch das geplante Reisedatum.
--
-- Bewusst OHNE Verlaufseintrag (siehe CLAUDE.md, «Wünsche stehen nicht im
-- Verlauf»): Ein Wunsch gehört genau einer Person, enthält keine Beiträge
-- Dritter und verschwindet ohnehin von selbst. Deshalb hängt die Idempotenz
-- hier an einer eigenen UNIQUE-Spalte statt an verlauf.idempotency_key.
--
-- Die Spaltennamen sind deutsch, anders als bei tips/notes: Dort kam die
-- englische Schreibweise aus dem alten JSON-Dateiformat, hier gibt es keine
-- Altlast.

CREATE TABLE wuensche (
  id           TEXT PRIMARY KEY,            -- UUID, serverseitig vergeben. Kein Slug:
                                            -- ein Wunsch wird nie verlinkt.
  schema       INTEGER NOT NULL DEFAULT 1,
  von          TEXT NOT NULL,               -- Anzeigename des Kontos, wie notes.by
  von_key      TEXT NOT NULL,               -- searchKey(von) — derselbe Schlüsselraum
                                            -- wie users.name_key. Entscheidet, wer
                                            -- erfüllen und löschen darf. Kein
                                            -- Fremdschlüssel auf users: die Tabelle
                                            -- steht nicht im Backup-Spiegel, eine
                                            -- user_id wäre dort eine tote Referenz.
  land         TEXT NOT NULL,               -- ISO 3166-1 alpha-2
  ort          TEXT NOT NULL,               -- wie eingetippt; Alias-Auflösung beim Lesen,
                                            -- genau wie bei tips.place
  kategorien   TEXT NOT NULL DEFAULT '[]',  -- JSON-Array von Kategorie-IDs, darf leer
                                            -- sein (anders als bei Tipps). Keine
                                            -- Join-Tabelle, wie bei tips.categories.
  text         TEXT,                        -- optional: Reiseplan, Vorlieben
  bis          TEXT NOT NULL,               -- ISO-Datum, LETZTER gültiger Tag (inklusiv).
                                            -- Der Lesefilter heisst bis >= heute,
                                            -- nie bis > heute.
  erstellt     TEXT NOT NULL,               -- ISO-Datum in Zürcher Ortszeit
  erfuellt_am  TEXT,                        -- NULL = noch offen
  erfuellt_von TEXT,                        -- Kontoname; NULL solange offen. Zwei
                                            -- Spalten statt eines Bools, weil auch
                                            -- Admins schliessen dürfen — «wer hat
                                            -- meinen Wunsch geschlossen?» soll
                                            -- beantwortbar bleiben.
  vorgang      TEXT UNIQUE                  -- Idempotenzschlüssel aus dem Formular-
                                            -- Entwurf. NULL nach einem Restore:
                                            -- Vorgangsschlüssel sind Transport-
                                            -- buchhaltung, kein Inhalt.
);

-- Der Lesefilter (bis >= heute) und das Aufräumen (bis < heute) laufen beide
-- über diese Spalte.
CREATE INDEX wuensche_bis ON wuensche(bis);
