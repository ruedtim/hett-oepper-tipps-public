-- Der Ort eines Wunsches wird optional (Issue #22).
--
-- Ein Wunsch darf auch nur einem Land gelten: «Ich fahre nach Portugal, hat
-- jemand irgendwas?» Bisher war `ort` NOT NULL, weil das Feature mit der
-- Annahme «immer eine Stadt» gebaut wurde.
--
-- Warum ADD/UPDATE/DROP/RENAME statt des üblichen Tabellenumbaus: SQLite kann
-- NOT NULL nicht per ALTER lösen, und der 12-Schritte-Umbau hiesse hier
-- DROP TABLE wuensche — auf das aber wunsch_tipps per Fremdschlüssel zeigt.
-- Das bräuchte PRAGMA defer_foreign_keys und damit die Annahme, dass wrangler
-- die Migrationsdatei als EINE Transaktion fährt. Der Weg unten kommt ohne
-- diese Annahme aus: Er lässt die Tabelle stehen und rührt die Fremdschlüssel
-- nicht an. Die Spalte wandert dabei ans Ende der Tabelle — unkritisch, weil
-- jede Abfrage im Code die Spalten beim Namen nennt.

ALTER TABLE wuensche ADD COLUMN ort_neu TEXT;

UPDATE wuensche SET ort_neu = ort;

ALTER TABLE wuensche DROP COLUMN ort;

ALTER TABLE wuensche RENAME COLUMN ort_neu TO ort;
