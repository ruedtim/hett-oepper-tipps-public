-- Die früheren Namen bekommen ihre Schreibweise zurück.
--
-- `0006` speicherte nur den `searchKey` («saera»), weil er für die eine Frage
-- reichte, um die es damals ging: «gehört mir dieser Beitrag?» und «ist dieser
-- Name noch frei?». Beides vergleicht normalisiert. Für die Kontenverwaltung
-- braucht es aber die Frage «wie hiess dieses Konto vorher?», und darauf ist der
-- Schlüssel keine gute Antwort — «Sära» steht dort als «saera», und
-- zurückrechnen lässt sich das nicht.
--
-- Deshalb trägt jeder Eintrag jetzt beides: {"key":"saera","name":"Sära"}.
-- Bewusst EINE Liste mit zwei Feldern statt zweier paralleler Listen — zwei
-- Listen, die immer gleich lang und gleich sortiert sein müssen, sind genau die
-- Sorte Doppelführung, die irgendwann auseinanderläuft.
--
-- Der Spaltenname zieht mit: `alte_name_keys` wäre nach dieser Änderung eine
-- Lüge. Alter Code auf dem neuen Schema liest die Spalte nicht mehr und fällt in
-- `nameKeysOf` auf «nur der aktuelle Schlüssel» zurück — was, solange niemand
-- umbenannt ist, exakt dasselbe Verhalten ist. Trotzdem gilt wie immer:
-- Migration zuerst, dann deployen.
ALTER TABLE users RENAME COLUMN alte_name_keys TO alte_namen;

-- Umwandlung für alles, was zwischen dem Ausrollen von 0006 und dieser
-- Migration schon umbenannt wurde. Für diese Einträge ist die ursprüngliche
-- Schreibweise nicht mehr zu haben — der Schlüssel muss als Name herhalten.
--
-- Der `json_type`-Wächter macht das idempotent: Er greift nur, solange der erste
-- Eintrag noch eine blosse Zeichenkette ist, nie bei bereits umgewandelten
-- Objekten.
UPDATE users
   SET alte_namen = (
     SELECT json_group_array(json_object('key', value, 'name', value))
       FROM json_each(users.alte_namen)
   )
 WHERE json_array_length(alte_namen) > 0
   AND json_type(alte_namen, '$[0]') = 'text';
