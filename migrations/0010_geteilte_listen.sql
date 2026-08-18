-- Geteilte Tipp-Listen: ein Blick auf die Sammlung für Leute ohne Passwort.
--
-- Bisher gab es dafür nur zwei Antworten, und beide waren falsch: «gar nicht»
-- oder «gib ihm das Gäste-Passwort» — und das öffnet die GANZE Sammlung,
-- dauerhaft, für jeden, an den es weitergereicht wird. Ein Freigabelink zeigt
-- stattdessen genau das, was jemand ausdrücklich herausgegeben hat.
--
-- Geteilt wird die RESULTATMENGE eines Moments, nicht ein Filter. Den
-- Filter-Link gibt es schon (`filtersToQuery()`), und er wäre hier das Falsche:
-- Er ist ein Rezept, kein Ergebnis. Wer ihn in einem halben Jahr öffnet, sähe,
-- was dann gerade dazupasst — ein Abonnement also, während verschickt wurde
-- «das hier». Deshalb steht in `tipp_ids` eine eingefrorene Liste.
--
-- WARUM EINE TABELLE, wo `functions/lib/token.ts` eine ausdrücklich vermeidet:
-- Dort ersetzt der Fingerabdruck die Buchhaltung, weil ein Reset-Token bloss
-- einmalig sein soll. Hier IST die Buchhaltung der Zweck — einzeln widerrufbar,
-- Übersicht auf der Konto-Seite. Ein signierter Token müsste die Tipp-IDs selbst
-- tragen (schon heute rund 2000 Zeichen für die ganze Sammlung, wachsend) und
-- liesse sich nicht zurücknehmen, ohne genau die Tabelle zu bauen, die man
-- sparen wollte.
--
-- WARUM SIE NICHT IM SPIEGEL STEHT, und warum das keine dritte stillschweigende
-- Lücke neben `users` und `verlauf` ist: weil sie ausgesprochen ist. Wünsche
-- kamen in den Spiegel, weil ein Wunsch ein Beitrag ist, den jemand verfasst hat
-- — ein Freigabelink ist keiner. Jede Zeile hier ist aus `tips` und `notes`
-- ableitbar, vergänglich und beim Verlust wertlos: Geht D1 verloren, sind die
-- Links tot, und der Preis ist ein «geht nicht mehr» im Gruppenchat plus ein
-- zweiter Klick auf «Teilen». Nach einem Restore aus einem älteren Stand ist das
-- sogar die sauberere Antwort — ein überlebender Link zeigte sonst auf Tipps,
-- die es in diesem Stand gar nicht mehr gibt. `scripts/restore-to-d1.mjs`,
-- `functions/api/export.ts` und `scripts/fetch-backup.mjs` bleiben deshalb
-- unangetastet.

CREATE TABLE geteilte_listen (
  id       TEXT PRIMARY KEY,        -- 20 Zeichen aus einem 32er-Alphabet = 100 Bit.
                                    -- Kein Slug und keine fortlaufende Nummer: Der
                                    -- Link IST die Berechtigung. Er muss unerratbar
                                    -- sein und darf nichts über den Inhalt verraten.
  von_id   INTEGER NOT NULL         -- wer geteilt hat
             REFERENCES users(id),  -- Ohne ON DELETE: Konten werden nie gelöscht,
                                    -- nur deaktiviert — und ein deaktiviertes Konto
                                    -- macht den Link beim LESEN tot, nicht per
                                    -- Aufräumen beim Schreiben.
                                    --
                                    -- `users.id` und nicht `von_key` wie bei den
                                    -- Wünschen: Die Begründung von 0002 («eine
                                    -- user_id wäre im Spiegel eine tote Referenz»)
                                    -- greift nicht, weil diese Tabelle den Spiegel
                                    -- gar nicht sieht. Und die id ist das Einzige,
                                    -- was ein Umbenennen überlebt. WESSEN Beiträge
                                    -- in der Ansicht mit Namen und Foto stehen,
                                    -- wird beim Lesen aus der Kontozeile
                                    -- beantwortet (`nameKeysOf`) und hier bewusst
                                    -- NICHT eingefroren — sonst verlöre man nach
                                    -- einer Umbenennung die eigenen Beiträge im
                                    -- eigenen Link.
  tipp_ids TEXT NOT NULL,           -- JSON-Array der eingefrorenen Tipp-IDs, in
                                    -- Anzeigereihenfolge. Ein Array wie
                                    -- tips.categories und keine Join-Tabelle: Ein
                                    -- inzwischen gelöschter Tipp soll die Zeile
                                    -- nicht mitreissen, sondern schlicht aus der
                                    -- Ansicht fallen.
  erstellt TEXT NOT NULL,           -- ISO-Datum in Zürcher Ortszeit, wie tips.added
  bis      TEXT NOT NULL            -- ISO-Datum, LETZTER gültiger Tag (inklusiv).
                                    -- Dieselbe Semantik wie wuensche.bis: Der
                                    -- Lesefilter heisst `bis >= heute`, nie
                                    -- `bis > heute`.
);

-- Kein Titelfeld. Die Seite ist öffentlich, und die Begründung aus
-- `api/zugang.ts` gilt hier genauso: nur, was gebraucht wird, und kein Freitext.
-- Die Übersicht auf der Konto-Seite unterscheidet die Links über Datum, Anzahl
-- und die ersten Tipp-Namen — alles ableitbar. Ein `titel TEXT` liesse sich
-- später additiv nachrüsten, falls das doch nicht reicht.

-- Lesefilter (bis >= heute) und Wegräumen (bis < heute) laufen beide hierüber.
CREATE INDEX geteilte_listen_bis ON geteilte_listen(bis);

-- «Welche Links habe ICH offen?» fragt die Konto-Seite bei jedem Aufruf.
CREATE INDEX geteilte_listen_von ON geteilte_listen(von_id);
