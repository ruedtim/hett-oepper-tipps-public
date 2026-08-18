-- Grundschema: D1 ist der primäre Speicher, Git nur noch das tägliche Backup.
--
-- Die Spaltenformen spiegeln bewusst die bisherigen JSON-Dateien (tip.json,
-- notes/<id>.json, categories.json, place-aliases.json): Export und Restore
-- übersetzen 1:1, und der Verlauf speichert Snapshots im selben Format.

CREATE TABLE categories (
  id       TEXT PRIMARY KEY,            -- unveränderlich, ASCII (siehe CLAUDE.md)
  label    TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  color    TEXT NOT NULL,               -- #rrggbb
  active   INTEGER NOT NULL DEFAULT 1,  -- deaktivieren statt löschen
  position INTEGER NOT NULL             -- Reihenfolge aus dem Kategorien-Editor
);

CREATE TABLE tips (
  id         TEXT PRIMARY KEY,          -- unveränderlich, war der Ordnername
  schema     INTEGER NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  country    TEXT NOT NULL,             -- ISO 3166-1 alpha-2
  place      TEXT NOT NULL,             -- wie eingetippt; kanonisiert wird beim Lesen
  categories TEXT NOT NULL,             -- JSON-Array von Kategorie-IDs. Keine
                                        -- Join-Tabelle: die einzige serverseitige
                                        -- Abfrage darüber ist die Nutzungsprüfung,
                                        -- und die geht per json_each.
  address    TEXT,
  link       TEXT,
  lat        REAL,
  lng        REAL,
  closed     INTEGER NOT NULL DEFAULT 0,
  added      TEXT NOT NULL              -- ISO-Datum in Zürcher Ortszeit
);

CREATE TABLE notes (
  tip_id TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
  id     TEXT NOT NULL,                 -- «2026-07-26-sara», war der Dateiname
  by     TEXT NOT NULL,
  text   TEXT NOT NULL,
  photo  TEXT,                          -- nur der Dateiname, nie ein Pfad
  added  TEXT NOT NULL,
  PRIMARY KEY (tip_id, id)
);

CREATE TABLE place_aliases (
  key   TEXT PRIMARY KEY,               -- searchKey(Schreibweise)
  label TEXT NOT NULL                   -- kanonische Anzeige
);

-- Der Verlauf ersetzt das Commit-Log: eine Handlung = ein Eintrag, und die
-- Snapshots sind das, was «Rückgängig» wiederherstellt. snapshot_before/-after
-- enthalten {"tip": …, "notes": […]} im Dateiformat von data/ — bei
-- kind='kategorien' stattdessen das komplette Kategorien-Array.
CREATE TABLE verlauf (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  kind            TEXT NOT NULL CHECK (kind IN
                    ('tipp','ergaenzung','korrektur','loeschung','kategorien','rueckgaengig')),
  title           TEXT NOT NULL,        -- Überschrift, z. B. «Gelöscht: <id>»
  by              TEXT NOT NULL,        -- Kontoname; ersetzt die alte Von:-Zeile
  note            TEXT,                 -- Begründung (bei Löschungen Pflicht)
  tip_id          TEXT,                 -- NULL bei kind='kategorien'
  reverts         INTEGER REFERENCES verlauf(id),
  snapshot_before TEXT,                 -- NULL = gab es vorher nicht
  snapshot_after  TEXT,                 -- NULL = danach gelöscht
  idempotency_key TEXT UNIQUE           -- NULL bei Admin-Handlungen
);
CREATE INDEX verlauf_tip ON verlauf(tip_id);

-- Persönliche Konten. Kein DELETE vorgesehen: Namen stehen in Notizen und im
-- Verlauf — Konten werden deaktiviert, nie gelöscht.
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL,   -- Anzeigename, speist note.by und verlauf.by
  name_key             TEXT NOT NULL UNIQUE, -- searchKey(name), der Login-Schlüssel
  password_hash        TEXT NOT NULL,   -- 'pbkdf2$<iter>$<salt-b64url>$<hash-b64url>'
  is_admin             INTEGER NOT NULL DEFAULT 0,
  disabled             INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  password_changed_at  TEXT
);
