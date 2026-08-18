-- Welcher Tipp gehört zu welchem Wunsch.
--
-- Der Ortsfilter reicht dafür nicht: Er vergleicht placeKey exakt, und ein
-- Wunsch heisst oft «Thurgau» oder «Dolomiten», während die Tipps in
-- «Frauenfeld» und «Cortina» stehen. Eine Region lässt sich nicht aus dem
-- Ortsnamen ableiten — also wird die Zuordnung von Hand gesetzt, entweder beim
-- Anlegen eines Tipps oder nachträglich von der Wunschseite aus.
--
-- Verknüpfen darf jeder mit Konto, auch Lösen. Es ist eine Zuordnung, kein
-- Inhalt; sie verschwindet ohnehin mit dem Wunsch, und wer eine falsche sieht,
-- soll sie wegräumen können, ohne auf jemanden zu warten (dieselbe Haltung wie
-- beim fehlenden Freigabeschritt).
--
-- Absichtlich ohne «von»/«am»: Eine Zuordnung ist kein Beitrag, den man jemandem
-- zuschreiben müsste — und im Backup wären es zwei Spalten Ballast pro Zeile.

CREATE TABLE wunsch_tipps (
  wunsch_id TEXT NOT NULL REFERENCES wuensche(id) ON DELETE CASCADE,
  tip_id    TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
  -- Beide Richtungen sind n:m: Ein Tipp kann zu «Thurgau» UND «Ostschweiz»
  -- passen, ein Wunsch bekommt beliebig viele Tipps. Der zusammengesetzte
  -- Schlüssel macht dieselbe Zuordnung zweimal unmöglich.
  PRIMARY KEY (wunsch_id, tip_id)
);

-- Für die Gegenrichtung «zu welchen Wünschen gehört dieser Tipp?» — die
-- Detailseite fragt das bei jedem Aufruf.
CREATE INDEX wunsch_tipps_tip ON wunsch_tipps(tip_id);
