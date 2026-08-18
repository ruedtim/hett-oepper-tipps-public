-- Der Gäste-Zugang («nur schauen»): ein Konto ohne Person dahinter.
--
-- Bewusst eine Zeile in `users` und keine neue Einstellungstabelle. Damit gilt
-- für den Gast alles, was für Konten schon gebaut ist: derselbe Passwort-Hash,
-- dasselbe Sitzungs-Cookie samt Fingerabdruck (ein neues Gäste-Passwort beendet
-- also automatisch alle Gäste-Sitzungen), dasselbe Deaktivieren, derselbe
-- D1-Read im Gate. Eine eigene Tabelle wäre zudem die dritte stillschweigende
-- Lücke im Backup-Spiegel neben `users` und `verlauf` — so ist es dieselbe.
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;

-- Es darf genau einen Gast geben: Der Login sucht ihn ohne Namen, also über
-- diese Spalte — bei zwei Zeilen wäre nicht bestimmt, welche gewinnt.
CREATE UNIQUE INDEX users_ein_gast ON users(is_guest) WHERE is_guest = 1;

-- Angelegt, aber gesperrt: Ein Passwort in einer Migration stünde für immer im
-- Repo. Der Zugang beginnt fail-closed und geht erst auf, wenn ein Admin unter
-- «Konten verwalten» ein Passwort setzt (PATCH /api/admin/gast). 'gesperrt' ist
-- kein gültiger pbkdf2-Hash — verifyPassword() lehnt es unabhängig von
-- `disabled` ab, es gibt also kein Passwort, mit dem diese Zeile aufgeht.
--
-- name_key = 'gast' ist zugleich reserviert: Ein echtes Konto «Gast» kann es
-- damit nicht mehr geben (UNIQUE), und niemand kann sich als der Gäste-Zugang
-- ausgeben. must_change_password bleibt 0 — der Gast wechselt nichts, und das
-- Startpasswort-Banner darf ihn nicht anspringen.
INSERT INTO users (name, name_key, password_hash, is_admin, disabled, must_change_password, is_guest)
VALUES ('Gast', 'gast', 'gesperrt', 0, 1, 0, 1);
