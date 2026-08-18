-- Der Gäste-Zugang geht zu (#70).
--
-- «Braucht es gerade nicht, solange wir so wenige sind» — Entscheid des
-- Besitzers. Rückgängig gemacht wird damit genau der eine Handgriff, den
-- 0005_gast.sql offen gelassen hat: Ein Admin hatte unter «Nur schauen» ein
-- Passwort gesetzt, und seither stand die Zeile offen. Sie geht hier in exakt
-- den Zustand zurück, in dem 0005 sie geboren hat.
--
-- DIE ZEILE BLEIBT, und das ist der Punkt. Sie reserviert weiterhin
-- name_key = 'gast' (ein echtes Konto dieses Namens kann es also nicht geben,
-- und `pruefeNeuenNamen` verlässt sich darauf), und sie ist der Anker für den
-- Leseschutz, der im Code ausdrücklich stehen bleibt: die Methoden- und die
-- Foto-Sperre in functions/_middleware.ts, die Kürzung in
-- functions/lib/appdata.ts, `Me.gast`/`GAST_GESPERRT`/`nurLesen` im Frontend.
-- Ausgebaut wird nur der WEG HINEIN — Formular, `gast`-Zweig in api/login.ts,
-- `getGuestUser()`, api/admin/gast.ts und der Abschnitt in der
-- Kontenverwaltung. Wer den Zugang wieder aufmachen will, holt diesen einen
-- Commit zurück und setzt ein Passwort; die Netze darunter hat er dann noch.
--
-- Beides zusammen beendet laufende Gäste-Sitzungen SOFORT, auf zwei Wegen, und
-- das ist Absicht: `disabled = 1` fällt im Gate durch (die Kontozeile wird bei
-- jedem Request gelesen), und der frische `password_hash` verändert zusätzlich
-- den Fingerabdruck im Sitzungs-Cookie. 'gesperrt' ist kein gültiger
-- pbkdf2-Hash — `verifyPassword()` lehnt es unabhängig von `disabled` ab.
-- `password_changed_at` zurück auf NULL heisst wieder «nie eines gesetzt».
UPDATE users
   SET disabled = 1,
       password_hash = 'gesperrt',
       password_changed_at = NULL
 WHERE is_guest = 1;
