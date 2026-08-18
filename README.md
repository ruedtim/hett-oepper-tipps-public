<!-- Von scripts/spiegel.mjs erzeugt. Änderungen hier überschreibt der nächste Lauf. -->

> ## Öffentlicher Code-Spiegel
>
> Dieses Repo ist eine **automatisch erzeugte, datenfreie Kopie** eines privaten
> Repos. Es wird bei jeder Änderung dort neu geschrieben; hier vorgenommene
> Commits und Pull Requests gehen beim nächsten Lauf verloren. Wer etwas
> beitragen oder fragen möchte: bitte ein Issue aufmachen.
>
> **Was fehlt:** der gesamte Datenbestand (`data/`), die Fotos
> (`public/photos/`), die Betriebsanleitungen (`ops/`) und die interne
> Arbeitsanleitung (`CLAUDE.md`). Die Tipps sind private Empfehlungen eines
> Freundeskreises und gehören nicht ins Netz — hier steht nur, wie die App sie
> verwaltet.
>
> **Was ersetzt ist:** die Hostnamen der Seite und die Absenderadresse der Mails
> (überall `beispiel.example` statt der echten Domain) sowie die beiden
> `database_id`-Werte in `wrangler.toml` (Platzhalter, die mit `00000000-`
> beginnen). Der Code selbst ist unangetastet — nur die Adressen, auf die er
> zeigt, führen nirgendwohin.
>
> **Was daraus folgt:** `npm run build` läuft hier ganz normal durch — Tests,
> Typprüfung für `src/` und `functions/`, Vite-Build. Die App braucht
> `data/` zum Bauen nicht; ihre Daten kommen zur Laufzeit aus Cloudflare D1.
> `npm run validate` dagegen prüft genau den fehlenden Datenbestand und bricht
> deshalb sofort ab. Das ist kein Fehler im Spiegel, sondern seine Definition.
> Die mitgelieferten GitHub-Workflows laufen hier aus demselben Grund nicht:
> Jeder Job prüft zuerst, in welchem Repo er steckt.
>
> Alles Weitere ist die README des privaten Repos, bis auf die genannten
> Ersetzungen unverändert.

# Hett öpper Tipps?

Reisetipps-Sammlung für den Freundeskreis. Läuft auf Cloudflare Pages; die Daten
liegen in **Cloudflare D1** (Fotos in **R2**), jede Person hat ihr eigenes Konto.
Einmal pro Nacht schreibt ein Workflow den kompletten Bestand als JSON-Dateien
zurück in dieses Repo — als Backup, lesbar und diffbar.

**Wer ein Konto hat, darf alles** — anlegen, ergänzen, korrigieren, löschen, und
zwar **sofort sichtbar** für alle. Es gibt keinen Freigabeschritt. Zwei Dinge
bleiben Konten mit Admin-Flag vorbehalten: Kategorien und Konten zu verwalten und
den **Verlauf** zu sehen, in dem sich jede Änderung zurücknehmen lässt. Das ist
das Sicherheitsnetz statt einer Kontrolle vorab: Wer aus Versehen etwas löscht,
wird nicht aufgehalten, sondern korrigiert.

Den eigenen Beitrag — Text und Foto — korrigiert, wer ihn geschrieben hat.
**Admins dürfen das an jedem Beitrag**, damit sie fremde Tippfehler nicht nur
über «Rückgängig» loswerden. Wem ein Beitrag gehört, ändert sich dadurch nie:
Der Name bleibt stehen, und wer ihn angefasst hat, steht im Verlauf.

Gefiltert wird nach Kategorie (mehrere gleichzeitig), Land, Ort und Person. Das
Suchfeld darüber schlägt vor, statt zu raten: «Hamburg» ergibt «Hamburg — Ort»,
«Hamburgerstraße 20 — Adresse» und «Fresh Hamburgers — Tipp» nebeneinander, und
das Etikett sagt, was der Klick tut — filtern oder zum Eintrag springen. Die
Volltextsuche steht als letzte Zeile darunter und sagt, wie viel sie fände.
Der Filterstand steht im URL-Hash und lässt sich damit
verschicken; ein Klick auf den Titel setzt alles zurück. Der Personenfilter greift
auf **alle** Notizen, nicht nur auf die erste — wer zu einem fremden Tipp etwas
beigesteuert hat, findet ihn unter seinem Namen wieder, und die Karte schreibt dann
«von Tim · ergänzt von Sara» statt eines Treffers, der wie ein Fehler aussieht.

Die Seite ist eine **PWA**: «Zum Home-Bildschirm hinzufügen» macht sie zur App
mit eigenem Icon. Ein Service Worker (`public/sw.js`) hält Hülle und Bundle
vor, damit sie auch ohne Netz öffnet — die Tipps selbst brauchen Netz, bewusst
(warum, steht in `CLAUDE.md`).

## Loslegen

```bash
npm install
cp .dev.vars.example .dev.vars       # Werte eintragen
npm run db:migrate                   # lokale D1 anlegen
node scripts/hash-password.mjs "Tim" --admin --fertig   # Konto seeden (Befehl folgt der Ausgabe)
node scripts/restore-to-d1.mjs       # Tipps aus data/ in die lokale DB
npm run preview:cf
```

| Befehl | Zweck |
|---|---|
| `npm run test` | Tests des Link-Parsers |
| `npm run preview:cf` | Die ganze App lokal, mit Login, D1 und R2 (Miniflare) |
| `npm run dev` | Nur das Frontend mit Vite-HMR — braucht parallel `wrangler pages dev dist` auf Port 8788, an das `/api` und `/photos` durchgereicht werden |
| `npm run db:migrate` | Migrationen auf die lokale D1 anwenden |
| `npm run build` | Typprüfung (src + functions) + Produktionsbuild nach `dist/` |
| `npm run validate` | Den Datenbestand unter `data/` prüfen (das Backup-Netz) |

## Wie eine Änderung hereinkommt

```
Formular in der App
   └─ POST /api/submit
        └─ EIN D1-Batch: Datenänderung + Verlaufseintrag, ganz oder gar nicht
             └─ die App lädt /api/data neu  →  sofort für alle sichtbar
```

Niemand braucht einen **GitHub-Account**, und auf eine Änderung wartet niemand
mehr — der frühere Umweg über einen Commit samt Neubau (~1 Minute) ist weg. Wer
etwas getan hat, steht am Verlaufseintrag: Der Name kommt aus dem angemeldeten
Konto, ein Namensfeld gibt es in den Formularen nicht mehr.

| | Auslöser | Was entsteht |
|---|---|---|
| **Neuer Tipp** | «Tipp hinzufügen» | Tipp mit erster Notiz |
| **Ergänzung** | «Ich war auch da» auf einem Tipp | eine weitere Notiz |
| **Korrektur** | «Korrigieren» auf einem Tipp | geänderte Stammdaten, dazu Text und Foto der eigenen Beiträge (als Admin: aller) |
| **Löschung** | «Gibt's nicht mehr / löschen» | Tipp, Notizen und Fotos entfernt |

**Wünsche** laufen daneben her, über eigene Endpunkte (`/api/wuensche`) und ohne
Verlaufseintrag — siehe unten.

**Eine Handlung, eine Transaktion.** Das ist keine Kosmetik, sondern die
Voraussetzung fürs Rückgängigmachen: Jeder Verlaufseintrag hält den kompletten
Zustand des betroffenen Tipps vor und nach der Handlung fest — «Rückgängig»
stellt einfach den Vorher-Stand wieder her. Fotos gehen nach R2; gelöscht wird
dort nie sofort, sondern in einen `trash/`-Bereich verschoben, damit ein
Rückgängig auch die Bytes zurückholen kann.

Schreiben zwei Leute gleichzeitig am selben Ort, fängt das ein UNIQUE-Constraint;
der Versuch wird bis zu dreimal mit frischer ID wiederholt. Ein doppelt
abgeschicktes Formular (Funkloch in der Bar) erkennt der Vorgangsschlüssel —
dauerhaft, nicht nur in einem Zeitfenster.

## Wünsche

Die Gegenrichtung zu den Tipps: «Ich fahre im August nach Lissabon — hat jemand
was?» Direkt unter dem Titel steht, wonach gerade gesucht wird; ein Klick auf
einen Ort führt zur Wunschliste, von dort geht es weiter in die gefilterte
Tippliste oder ins Tipp-Formular.

Ein Wunsch trägt ein Land, ein **Pflicht-Ablaufdatum** (typisch das Reisedatum)
und wahlweise einen Ort, Kategorien und einen Text zum Reiseplan. **Der Ort ist
optional**: «Ich fahre nach Portugal, hat jemand irgendwas?» ist eine
vollwertige Frage. Ohne Ort steht der Ländername im Chip, und «Alles in …»
filtert die Tippliste aufs Land statt auf einen Ort. Das
Ablaufdatum ist der **letzte gültige Tag** — am Tag danach ist der Wunsch weg,
für alle, ohne dass jemand aufräumen muss. Autor*in und Admins können ihn früher
als erfüllt markieren (verschwindet aus der Kopfzeile, bleibt bis zum Ablauf in
der Liste stehen und lässt sich wieder öffnen) oder löschen.

**Tipps lassen sich einem Wunsch zuordnen** — und das ist kein Beiwerk, sondern
der Grund, warum das Feature überhaupt trägt: Der Ortsfilter vergleicht den
Ortsschlüssel exakt, ein Wunsch heisst aber oft «Thurgau» oder «Dolomiten»,
während die Tipps in «Frauenfeld» und «Cortina» stehen. Eine Region lässt sich
aus einem Ortsnamen nicht ableiten. Drei Wege:

- «Tipp hinzufügen» beim Wunsch → der neue Tipp ist schon zugeordnet
- im normalen Tipp-Formular unter «Antwort auf einen Wunsch?»
- «Tipp verknüpfen» beim Wunsch, für Tipps, die es schon gibt

Verknüpfen und lösen darf **jeder** mit Konto, nicht nur die Autorin des
Wunsches: Ein Wunsch ist eine Frage an alle. Mit dem Ablauf des Wunsches
verschwindet die Zuordnung von selbst; der Tipp bleibt selbstverständlich.
«Was wir schon haben» steht nur noch da, wenn der Ortsfilter auch wirklich
etwas fände — sonst führte der Knopf verlässlich auf «Nichts gefunden».

**Wünsche stehen nicht im Verlauf, und das mit Absicht** — siehe `CLAUDE.md`.
Ein gelöschter Wunsch ist also endgültig weg; die Oberfläche sagt das vor dem
zweiten Klick. Ins tägliche Backup kommen sie dagegen schon
(`data/wuensche.json`, die Zuordnungen als `tipps`-Feld darin).

## Karte und Ortsangaben

Die Liste hat einen Umschalter auf eine Karte; die Filter gelten für beide, und die
gewählte Ansicht steht im Link. Leaflet und die Kacheln werden erst geladen, wenn
jemand die Karte öffnet — die Listenansicht bleibt dadurch unverändert leicht.

**Kacheln von OpenStreetMap.** Deren [Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/tiles/)
erlaubt genau diese Nutzung, stellt aber Bedingungen. Drei davon kann man im Code
kaputtmachen, deshalb hier festgehalten:

- Die Attribution bleibt sichtbar. Nicht überdecken, nicht wegklappen.
- Keine restriktive `Referrer-Policy` setzen — die Origin muss mitgehen.
- **Kein Offline-Modus, kein Vorabladen von Kacheln.** Ausdrücklich verboten, und
  genau die Versuchung, die eine Reise-App erzeugt.
- Die Kacheln **nicht** über eine eigene Function proxen.

**Beim Geocoding gilt das Umgekehrte**: Die Ortssuche *muss* über `/api/geo` laufen,
weil ein Browser den verlangten `User-Agent` nicht setzen kann und die
Anbieteradresse ohne neuen Build wechselbar bleiben soll. Benutzt wird Photon, nicht
Nominatim — dessen Richtlinie verbietet Suche-während-des-Tippens wörtlich.
Diese Asymmetrie ist Absicht und steht in beiden Dateien als Kommentar.

**Ortsangaben aus Links** liest `shared/placeLinks.mjs`, geteilt von Browser und
Function. Der Browser liest alles selbst; nur Kurzlinks gehen an `/api/link`, weil
CORS ihm das Folgen der Weiterleitung verbietet.

Exakte Koordinaten werden direkt ins Formular übernommen und Ort, Land und Adresse
per Rückwärtssuche ergänzt (nur leere Felder). Ungefähres — die Kartenmitte aus dem
`@` — und Links ohne Koordinaten landen in der Ortswahl zum Setzen von Hand. Der
übernommene Punkt bleibt im Formular sichtbar und änderbar; ändert Google sein
Format, wird daraus eine Handbewegung statt eines Ausfalls.

Warum dieser Parser als Einziges im Projekt Tests hat: Seine Fehler krachen nicht,
sie zeigen still auf den falschen Ort. `!3d` ist Breite und `!4d` Länge — bei
`!1d`/`!2d` ist es umgekehrt, und wer das verwechselt, landet im Indischen Ozean.
Das `@` in der URL ist die Kartenmitte, nicht der Ort; in Messungen wich sie
durchweg ab, im Extremfall um 1341 km. Rund 43 % der echten Teilen-Links enthalten
überhaupt keinen Ort, sondern eine Rezension, ein Foto oder eine Liste. Die Tests
laufen bei jedem `npm run build` mit.

`share.google`-Links lassen sich nicht auflösen — sie führen auf eine Google-Seite
ohne Ortsangabe. Die App sagt das, statt zu raten.

## Verlauf und Rückgängigmachen

Unter `#/admin` (Admin-Flag am Konto) steht jede Änderung mit Datum, Urheber,
Begründung und den betroffenen Dateien. **Rückgängig machen** löscht nichts aus
der Geschichte, sondern schreibt eine Gegenbuchung — die sich ihrerseits
zurücknehmen lässt.

Jeder Eintrag trägt seine Art als Etikett; **«Gelöscht» ist als einziges voll
durchgefärbt**, und der Umschalter **«Nur Löschungen»** zeigt ausschliesslich
Handlungen, nach denen etwas weg war. Beides zusammen ist die Antwort darauf,
dass eine Löschung zwischen Dutzenden Ergänzungen sonst schlicht übersehen wird.
Der Filter greift dabei nicht nach der Art, sondern nach dem leeren
Nachher-Snapshot — sonst fehlte ein «Rückgängig», das einen frischen Tipp
entfernt hat, ausgerechnet in der Liste, die es zeigen soll.

Jeder Verlaufseintrag trägt den Zustand des betroffenen Tipps vor und nach der
Handlung als Snapshot. Rückgängig heisst: den Vorher-Snapshot wiederherstellen.
Bewusst ohne Zusammenführen — wurde seither erneut geändert, gilt wieder der alte
Stand. Genau das erwartet man von «rückgängig», und verloren geht nichts, weil
der spätere Stand als Snapshot im Verlauf bleibt. Der Verlauf zeigt nur
App-Handlungen; wer Daten von Hand per `wrangler d1 execute` ändert, taucht dort
nicht auf.

Dahinter stecken zwei verschiedene Dinge, die die App bewusst nebeneinander stellt:

- **Gibt's nicht mehr** setzt `closed: true`. Der Tipp bleibt in der Liste, ausgegraut,
  alle Notizen bleiben lesbar. Für Lokale, die zugemacht haben — die Erinnerung ist
  ja trotzdem etwas wert.
- **Ganz löschen** entfernt Stammdaten, Notizen und Fotos. Für Fehleinträge und
  Dubletten. Weil dabei auch die Notizen anderer Leute verschwinden, wird zweimal
  gefragt — zurückholen kann es danach nur ein Admin über den Verlauf.

Beides darf jedes Konto.

## Eine Liste teilen

Über der Trefferliste steht **«Diese Liste teilen»**. Der Knopf macht aus dem, was
gerade zu sehen ist, einen Link, den auch jemand ohne Passwort öffnen kann.

Geteilt wird die **Resultatmenge dieses Moments**, nicht der Filter. Der Link
zeigt also für immer dieselben Tipps — was später dazukommt, taucht dort nicht
auf. Wer den Filter ändert, bekommt einen neuen Knopf: Der alte Link gehört zur
alten Auswahl und verschwindet aus der Anzeige.

Was ein Fremder dabei sieht:

- Von **deinen eigenen** Beiträgen den Namen und die Fotos.
- Von den Beiträgen der anderen nur Text und Monat — keinen Namen, kein Bild.
- Die Sachdaten jedes Tipps ganz: Name, Ort, Land, Kategorien, Adresse und einen
  Link auf Google Maps. Die gehören niemandem persönlich.

Ein Link gilt **90 Tage** und lässt sich jederzeit unter «Konto → Geteilte
Listen» zurücknehmen. Danach — und wenn dein Konto deaktiviert wird — führt er
ins Leere. Die Seite dahinter ist bewusst schlicht und kommt ohne JavaScript aus,
damit sie in jedem Browser und jeder Chat-Vorschau aufgeht.

## Deine Daten mitnehmen

Unter «Konto → Deine Daten» liegt ein Knopf, der alles Eigene als **ZIP**
herunterlädt: das Konto (ohne Passwort), deine Beschreibungen samt der Tipps, zu
denen sie gehören, deine Wünsche und deine Fotos in voller Auflösung. Die
Beiträge der anderen sind nicht dabei, und der Verlauf auch nicht — dessen
Einträge enthalten fremde Texte. Das Format sind dieselben JSON-Dateien, in denen
die Sammlung gesichert wird; ein `LIESMICH.txt` im Archiv sagt, was drinsteht.

## Rückmeldungen

Der Knopf oben rechts schreibt ein **GitHub-Issue** mit Label `feedback`, samt
Kontoname und der Stelle in der App, an der die Person war. Bewusst ein Issue und
kein Pull Request: Ein Vorschlag ändert Daten und wird zusammengeführt, eine
Rückmeldung ist eine Nachricht und wird gelesen. Dafür braucht der Token
`Issues: write` — zusammen mit den Zugangsbitten («Gib mir bitte Zugang!») der
einzige Grund, aus dem die App überhaupt noch einen GitHub-Token trägt.

Für den Gäste-Zugang ist der Knopf zu: Rückmelden ist Schreiben, und ein
geteiltes Passwort ohne Person dahinter ist der falsche Absender.

## Wo die Daten liegen — und wo das Backup

Die **Quelle** ist die D1-Datenbank `hett-oepper-tipps` (Tabellen `tips`, `notes`,
`categories`, `place_aliases`, `wuensche`, `wunsch_tipps`, `verlauf`, `users`) plus der R2-Bucket
`hett-oepper-fotos`. Das Repo hält davon einen täglichen **Spiegel** im alten
Dateiformat:

```
data/
├─ categories.json        Kategorien: id, label, emoji, color, active
├─ place-aliases.json     Schreibweisen zusammenführen («Rom» → «Roma»)
├─ wuensche.json          Offene Gesuche samt zugeordneten Tipps
│                         (fehlt, solange es keine gibt)
└─ tips/<tip-id>/
   ├─ tip.json            Stammdaten
   └─ notes/<note-id>.json  Eine Datei pro Empfehlung oder Ergänzung
```

`wuensche.json` ist **eine** Datei statt eines Ordners pro Eintrag: Wünsche sind
wenige und kurzlebig, und die Merge-Konflikte paralleler PRs, für die es die
Ordnerstruktur der Tipps gab, existieren seit der D1-Umstellung nicht mehr.

Fotos spiegelt das Backup nach `public/photos/<tip-id>/<note-id>.webp` — an den
alten Ort, mit Absicht: **Jeder Repo-Stand ist damit als komplette App
deploybar**, inklusive der Datenlage von diesem Tag. Das ist zugleich der
Rollback-Weg, falls die D1-Welt je klemmt.

Ein Tipp bleibt ein **Ordner**, jede Notiz eine **eigene Datei** — heute nicht
mehr wegen Merge-Konflikten, sondern weil das Format lesbare Diffs ergibt
(«welche Notiz kam gestern dazu?») und Restore wie Export dieselbe einfache
Struktur sprechen.

## Backup und Restore

**Die Einweg-Regel:** Daten fliessen automatisch nur in EINE Richtung —
Datenbank → Repo. Es gibt bewusst keinen Import-Endpunkt, und es soll nie einer
gebaut werden: Ein stehender Rückkanal wäre genau der Weg, auf dem alte Daten
neue überschreiben könnten.

- **Täglich, 03:17 UTC** holt `.github/workflows/backup.yml` den Bestand von
  `/api/export` (eigener `BACKUP_TOKEN`, kann nur lesen), validiert ihn mit
  `npm run validate` und committet **nur bei Änderungen** — mit dem Präfix
  `[CF-Pages-Skip]`, damit kein unnötiger Pages-Build läuft.
- Ein **Schrumpf-Wächter** verweigert das Backup, wenn der Export leer ist oder
  über 30 % unter dem Repo-Stand liegt — eine leergelaufene Datenbank darf das
  Backup nicht leeren. Absichtliche grosse Löschaktionen: Workflow von Hand mit
  `force=true` starten.
- Schlägt der Lauf fehl, öffnet er ein Issue mit Label `backup` (nur eines).

**Restore** (Repo → Datenbank) geht nur von Hand, vom Besitzer, lokal:

```bash
node scripts/restore-to-d1.mjs --remote
```

Das Skript validiert `data/` zuerst, zeigt «DB enthält X Tipps, data/ enthält Y»
und verlangt die wörtlich getippte Bestätigung, sichert den aktuellen DB-Stand
automatisch als SQL-Datei und ersetzt dann die Inhalte (Konten und Verlauf bleiben
unangetastet). Ohne `--remote` läuft alles gegen die lokale Miniflare-DB.

Zweites, unabhängiges Netz: **D1 Time Travel** kann die Datenbank bis 30 Tage
minutengenau zurückstellen (`wrangler d1 time-travel --help`) — für den Fall
«Datenbank kaputt und das letzte Backup ist zu alt».

## Öffentlicher Code-Spiegel

Der Code liegt zusätzlich öffentlich unter
[ruedtim/hett-oepper-tipps-public](https://github.com/ruedtim/hett-oepper-tipps-public)
— ohne einen einzigen Tipp. Verwechslungsgefahr: «Spiegel» heisst hier zweierlei.
Der Abschnitt oben meint den täglichen Datenabzug nach `data/`; dieser hier meint
das zweite GitHub-Repo, in dem umgekehrt genau dieses `data/` fehlt.

`.github/workflows/spiegel.yml` läuft bei jedem Push auf `main` (Änderungen an
`data/`, `public/photos/`, `ops/` und `CLAUDE.md` lösen nichts aus) und hängt
einen Schnappschuss-Commit an den Spiegel an. Gebaut und geprüft wird vorher von
`scripts/spiegel.mjs`; der Spiegel wird erst angefasst, wenn das fehlerfrei
durchgelaufen ist. Lokal ansehen, was hinausginge:

```bash
node scripts/spiegel.mjs /tmp/spiegel-probe
```

Draussen bleiben `data/`, `public/photos/`, `ops/` und `CLAUDE.md`; ersetzt
werden die Domain (überall `beispiel.example`) und die beiden `database_id`s.
Was genau ersetzt wird, steht in `ops/spiegel.json` — nicht im Skript, denn das
geht selbst mit hinaus und schlüge beim eigenen Suchmuster an.
Ein Wächter durchsucht danach den fertigen Baum nach den Originalwerten und
bricht ab, wenn etwas durchgerutscht ist — dann wird nichts gespiegelt.

Weil die Spiegel-Historie wächst und nie force-gepusht wird, ist ein Fehler dort
nur durch Löschen des Repos zu beheben. Deshalb: Nach einer Änderung an der
Positiv- oder Ersetzungsliste einmal von Hand bauen und hineinschauen.

Einzurichten war dafür ein Fine-grained PAT `SPIEGEL_TOKEN` (Actions-Secret in
diesem Repo), beschränkt auf das Spiegel-Repo, mit **Contents: Read and write**
UND **Workflows: Read and write** — ohne die zweite Berechtigung weist GitHub
jeden Push zurück, der `.github/workflows/` anfasst. Der Spiegel selbst hat
Actions deaktiviert und darf nie an ein Pages-Projekt gehängt werden.

## Regeln, die das Prüfskript durchsetzt

`scripts/build-data.mjs` prüft den Spiegel unter `data/` und bricht ab, wenn
etwas nicht stimmt — im Backup-Workflow **vor** dem Commit, in der CI bei jedem
Push. Es prüft unter anderem:

- Jede Datei entspricht ihrem JSON-Schema (`schema/`).
- Ordnername und `id` sind identisch, und beide sind kleingeschrieben.
  (macOS ist case-insensitiv, der Linux-Runner nicht — ohne diesen Test
  liefe `Café-Central` lokal und bräche erst in der Cloud.)
- Jede genannte Kategorie existiert.
- Jedes referenzierte Foto liegt tatsächlich da.
- Jeder Tipp hat mindestens eine Notiz.

Als Hinweis, nicht als Fehler, meldet es doppelte Ortsschreibweisen und
verwaiste Fotoordner. Serverseitig validiert `functions/lib/submission.ts`
dieselben Regeln von Hand — ajv liefe in Workers nicht (`new Function`).

## Kategorien ändern

Im Admin-Bereich unter «Kategorien bearbeiten» (gespeichert wird in D1). Die `id`
ist unveränderlich und rein ASCII, damit Filter-Links nie URL-kodiert werden
müssen — angezeigt wird `label`. Deshalb heisst die Kategorie intern
`interessant` und in der App «Intrisant».

**Kategorien werden nie gelöscht**, sondern auf `"active": false` gesetzt. Eine
gelöschte ID würde alle Tipps verwaisen lassen, die sie noch nennen — das prüft
der Server per SQL, auch beim Rückgängigmachen.

## Orte

Land ist ein ISO-3166-1-alpha-2-Code; die deutschen Namen und Flaggen rechnet das
Frontend zur Laufzeit aus (`Intl.DisplayNames`), damit keine Länderliste im Bundle
liegt.

Der Ort ist Freitext. `shared/normalize.mjs` führt «Zürich», «Zurich» und «ZÜRICH»
automatisch zusammen. Was es nicht automatisch kann — «Zuerich», oder Exonyme wie
«Rom»/«Roma» —, steht in der Tabelle `place_aliases` (im Backup:
`data/place-aliases.json`). Das Prüfskript schlägt fehlende Aliasse vor, wenn ihm
zwei ähnliche Ortsschlüssel auffallen.

Aufgelöst wird beim **Lesen** (`/api/data`), nicht beim Einreichen: Gespeichert
bleibt, was jemand getippt hat. Ein später ergänzter Alias korrigiert damit auch
alte Einträge rückwirkend.

**Umkreis.** Neben dem Ortsfeld steht, was der Filter darüber hinaus mitnimmt:
+0 km (Vorgabe, nur dieser Ort) oder +5/+10/+30/+50 km. Gedacht für Orte, die
nebeneinanderliegen und trotzdem verschieden heissen — Konstanz erscheint im
Umkreis von Kreuzlingen, obwohl es in einem anderen Land liegt. Genau deshalb
**gewinnt der Umkreis gegen den Landfilter**, und das Landfeld springt beim
Wählen auf «Alle Länder» zurück. Gemessen wird ab dem Schwerpunkt der Tipps des
gewählten Orts; ein Tipp ohne Koordinaten bleibt in seinem eigenen Ort sichtbar.
Der Umkreis steht als `u=` im Link und ist damit teilbar wie jeder andere Filter.

## Adressen

Die App wohnt unter **`https://tipps.beispiel.example`**. Zwei weitere Namen
zeigen dorthin und leiten weiter (`functions/lib/hosts.ts`):

| Adresse | was passiert |
|---|---|
| `tipps.beispiel.example` | die App |
| `www.tipps.beispiel.example` | Weiterleitung |
| `hett-oepper-tipps.beispiel.example` | Weiterleitung (die frühere Adresse) |
| `hett-oepper-tipps.pages.dev` | liefert direkt aus — Previews und Backup-Job |

Die alte Adresse **bleibt für immer eingetragen**: Sie steht in den Chats der
Freunde, genau wie die Tipp-IDs. Nimmt man sie in Cloudflare aus dem Projekt,
laufen alte Links ins Leere. Weitergeleitet wird, statt beide Namen
gleichberechtigt auszuliefern, weil das Sitzungs-Cookie an genau einen Hostnamen
gebunden ist — sonst wäre man unter dem zweiten Namen abgemeldet.

Der DNS liegt bei **Infomaniak** (nicht bei Cloudflare): je ein CNAME auf
`hett-oepper-tipps.pages.dev`. Die Reihenfolge ist heikel — erst die Domain im
Cloudflare-Dashboard eintragen, dann den CNAME setzen, sonst antwortet
Cloudflare mit 522. Der ganze Ablauf steht in
[`ops/domain-umstellung.md`](ops/domain-umstellung.md).

## Zugang und Betrieb

Die ganze Seite liegt hinter **persönlichen Konten** (Name + Passwort), geprüft
serverseitig in `functions/_middleware.ts` — kein JavaScript-Vorhang, sondern
eine Antwort, die ohne gültige Sitzung gar keine Daten ausliefert. Die Middleware
liest bei jedem Request die Kontozeile aus D1: Ein deaktiviertes Konto oder ein
zurückgesetztes Passwort wirkt sofort, nicht erst wenn das Cookie abläuft.

**Admin ist ein Flag am Konto**, kein eigenes Passwort. Mehrere Konten können es
tragen; die App spricht weiterhin von «den Admins». Admins verwalten unter
`#/admin` Verlauf, Kategorien und Konten. Der Letzte-Admin-Schutz verhindert,
dass sich die Runde selbst aussperrt.

Konten legt ein Admin in der App an (Startpasswort persönlich weitergeben; beim
ersten Anmelden wird ein eigenes verlangt). Passwörter werden mit PBKDF2 gehasht
(WebCrypto, Iterationszahl steht im Hash und ist damit später erhöhbar).
Passwortwechsel beendet alle Sitzungen des Kontos — das Cookie trägt einen
Fingerabdruck des Passwort-Hashes.

### Nur schauen (Gäste-Zugang)

Auf dem Anmeldebildschirm steht neben dem Konto-Login **«Nur schauen»**: ein
Passwort ohne Namen, das nur lesen darf. Erzwungen wird das serverseitig in
`functions/_middleware.ts`: Für eine Gast-Sitzung ist jede Methode ausser GET und
HEAD gesperrt. Die fehlenden Knöpfe in der Oberfläche sind nur die Höflichkeit
dazu.

Ein Gast sieht die **Tipps** — Name, Ort, Kategorien, Text, Datum, Karte und
Adresse. Nicht dabei:

| | warum |
|---|---|
| **Wünsche** | Ein Wunsch nennt seine Autorin und ist eine Frage an die Runde, nicht an Zuschauer. Die Wunschseite ist für Gäste zu (nicht bloss leer — das wäre eine falsche Aussage über die Runde). |
| **Namen** | Wer einen Tipp eingetragen oder ergänzt hat, bleibt unter Gästen ungenannt. Die *Zahl* der Ergänzungen steht weiter da; sie verrät niemanden. Personen-Filter und das Wort «Person» im Suchfeld verschwinden mit. |
| **Fotos** | Weder Dateinamen noch Bytes: `/photos/*` antwortet Gästen mit 404. |

Weggelassen wird das **im Server** (`functions/lib/appdata.ts`), nicht in der
Oberfläche — sonst stünde alles weiterhin in der Antwort von `/api/data`, und
«unsichtbar» wäre nur einen Netzwerk-Tab entfernt. Auch die Notiz-IDs werden
ersetzt: Sie enthalten den Namen (`2026-07-26-sara`).

Der Zugang ist **anfangs geschlossen**. Aufmachen: als Admin anmelden →
«Konten verwalten» → «Nur schauen» → Passwort setzen. Danach dort auch zu- und
wieder aufmachen. Ein neues Passwort beendet sofort alle laufenden
Gäste-Sitzungen (derselbe Fingerabdruck-Mechanismus wie bei den Konten), das
Schliessen ebenso — das Passwort geht herum, und genau darum muss es widerrufbar
sein.

### «Gib mir bitte Zugang!»

Der dritte Knopf auf dem Anmeldebildschirm nimmt einen Namen und legt daraus ein
**GitHub-Issue mit dem Label `zugangswunsch`** an (`functions/api/zugang.ts`).
Das ist der einzige Endpunkt, der ohne Anmeldung etwas nach draussen schickt;
sein Spam-Schutz ist ein Deckel auf gleichzeitig offenen Bitten. Abgearbeitete
Issues schliessen macht den Weg wieder frei — bleiben zehn offen, antwortet der
Knopf mit «bitte später». Ohne `GITHUB_TOKEN` antwortet er mit 503; alles andere
läuft weiter.

Das Label ist absichtlich **nicht** `zugang` — darunter warnt
`.github/workflows/expiry-check.yml` vor ablaufenden Zugangsdaten und öffnet
kein zweites Issue, solange eines offen ist.

> **Beim Ausrollen:** Der Gäste-Zugang braucht die Migration
> `migrations/0005_gast.sql` (Spalte `users.is_guest`). Pages deployt beim Push,
> Migrationen aber nicht — und ohne die Spalte scheitert auch die
> **Kontenverwaltung**, weil ihre Abfrage den Gast ausschliesst. Also direkt nach
> dem Deployment:
>
> ```bash
> npx wrangler d1 migrations apply hett-oepper-tipps --remote
> ```
>
> Danach einmalig unter «Konten verwalten → Nur schauen» ein Passwort setzen;
> vorher ist «Nur schauen» auf dem Anmeldebildschirm zwar sichtbar, lehnt aber
> jede Eingabe ab (fail-closed, absichtlich: ein Passwort in einer Migration
> stünde für immer im Repo).

**Der Notausgang**, falls kein Admin mehr an sein Passwort kommt (braucht nur
wrangler, keinen funktionierenden Login):

```bash
node scripts/hash-password.mjs "Tim" --admin --fertig
# → gibt den fertigen INSERT samt wrangler-Befehl aus; für ein bestehendes
#   Konto stattdessen ein UPDATE mit dem ausgegebenen Hash absetzen.
```

Fehlt ein Secret oder eine Bindung, antwortet die Seite mit 503 statt sich zu
öffnen. Auch wenn D1 nicht erreichbar ist: 503, nie offen.

**Secrets** (Cloudflare Pages → Settings → Environment variables, verschlüsselt;
die D1-/R2-Bindings stehen in `wrangler.toml`):

| Name | Zweck |
|---|---|
| `SESSION_SECRET` | signiert die Sitzungs-Cookies (`openssl rand -base64 32`) |
| `BACKUP_TOKEN` | Lese-Token des Backup-Jobs; identisch als GitHub-Actions-Secret |
| `GITHUB_TOKEN` | Fine-grained PAT, nur dieses Repo, nur noch Issues: write (Rückmeldungen und Zugangsbitten) |

Alle drei müssen **verschlüsselt** angelegt sein («Encrypt»), sonst verdrängt sie
die `wrangler.toml`: Seit es sie gibt, ist sie die Quelle für Bindings und
Klartext-Variablen. Aus demselben Grund steht `GITHUB_REPO` dort und nicht mehr
im Dashboard — ein Repo-Name ist kein Geheimnis.

Auf GitHub-Seite braucht der Backup-Workflow zusätzlich die **Actions-Variable**
`APP_URL` (ohne Schrägstrich am Ende). Sie steht bewusst auf
`https://hett-oepper-tipps.pages.dev` und nicht auf der schönen Adresse: Der Job
ist damit unabhängig davon, ob der DNS bei Infomaniak gerade sauber steht. Wer
sie doch auf einen Namen umstellt, der weiterleitet, bricht das Backup —
`fetch` wirft den `Authorization`-Header bei einer Weiterleitung auf einen
anderen Host weg, und der Export antwortet dann mit 401.

Ablaufdaten von Tokens gehören in `ops/expiries.json` — ein wöchentlicher
Workflow öffnet 30 Tage vorher ein Issue.
