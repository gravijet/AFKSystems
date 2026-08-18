# Die Live-Ansicht (POV)

Sehen, was der Bot sieht – im Browser, ohne Minecraft zu starten.

---

## Was das ist

Minecraft überträgt an einen Client **keine fertigen Bilder** und keine Blocktexturen. Was über
das Netz kommt, sind Chunk-Daten: Paletten von Blocktypen, Höhenkarten, Blockänderungen, Entities
mit Position und Blickrichtung. Ein Bild daraus entsteht erst im Client.

Genau das tun die POV-Bauformen des Rust-Clients: Sie decodieren die geladenen Chunk-Paletten,
halten Blockänderungen und Entities live nach und **raycasten** aus der Kameraposition und
Blickrichtung ein Bild. Ausgegeben wird es als Raster aus Halbblöcken (`▀`), jeder mit einer
Vorder- **und** einer Hintergrundfarbe: Das ist der übliche Weg, in einem Terminal zwei Bildpunkte
in ein Zeichen zu bekommen – oben die Vordergrundfarbe, unten die Hintergrundfarbe.

Das Panel liest dieses Raster, zerlegt jede Zeichenzeile in ihre zwei Bildzeilen aus Farbläufen und
zeichnet sie im Browser auf ein Canvas: ein Bildpunkt je Farbe, ohne Glättung hochskaliert. Heraus
kommt eine Voxelansicht der Welt, wie sie der Bot an seiner Stelle sieht.

Es ist **kein Bildschirmabgriff** und keine Aufzeichnung. Es ist das, was aus den Daten folgt, die
der Server dem Bot ohnehin schickt.

---

## Wer sie bekommt

Die Live-Ansicht ist ein **Zusatz**, kein Tarifmerkmal. Sie steckt in keinem Tarif – auch nicht in
Ultra – und wird je Serverplatz gebucht:

**Serverplatz → Zusätze → Live-Ansicht (POV)**

Abgerechnet wird wie jeder Zusatz: beim Buchen anteilig für den Rest der laufenden Periode, ab der
nächsten Verlängerung im Monatspreis. Auf dem Gratis-Platz gibt es keine Zusätze.

Voraussetzung ist außerdem eine Client-Datei, die es kann. Das sind `ultra-afk-linux` (Ansicht
zuschaltbar) und `pov-afk-linux` (Ansicht läuft von selbst). Liegt keine davon auf dem Server,
verschwindet der Zusatz aus dem Angebot und der Reiter aus dem Panel, statt etwas zu versprechen,
das gerade niemand einlösen kann.

---

## Bedienen

Der Reiter **Live-Ansicht** steht bei jedem Serverplatz, der den Zusatz gebucht hat und dessen
Client sie mitbringt.

| Knopf | Wirkung |
| --- | --- |
| **Live-Ansicht starten** | setzt die Auflösung und startet den laufenden Bildstrom |
| **Einzelbild** | zeichnet genau ein Bild und hört danach wieder auf |
| **Stoppen** | beendet den Bildstrom |

**Die Auflösung steht fest auf 160 × 80** – dem Größten, was der Client rechnen kann. Eine Auswahl
gibt es bewusst nicht: Die Rechenzeit fällt an, sobald die Ansicht läuft, und ein kleineres Bild
macht sie nicht billiger genug, um dafür schlechter zu sehen. Das Panel setzt die Größe vor jedem
Start selbst (`POV_SIZE` in `server/supervisor.js`) und nimmt von außen keine andere entgegen –
auch nicht über den Befehlsendpunkt.

Wer den Reiter verlässt, stoppt die Ansicht automatisch. Das ist kein Komfort, sondern nötig: eine
laufende Ansicht kostet auf der Maschine deutlich mehr als ein stiller Bot. Dasselbe gilt für ein
hart geschlossenes Fenster: Ist die letzte Verbindung eines Kontos zwanzig Sekunden lang weg,
schaltet das Panel dessen Ansichten von sich aus ab.

Sitzen mehrere Konten auf dem Serverplatz, hat jedes seine eigene Ansicht; welche laufen, entscheidet
die Auswahl über den Knöpfen.

---

## Was es kostet – technisch

| | |
| --- | --- |
| Rechenzeit | der Client raycastet je Bild; bei 160×80 sind das 12 800 Strahlen |
| Speicher | der Client hält die geladenen Chunks vor (deutlich mehr als ein AFK-Bot ohne POV) |
| Leitung | der Client schreibt ~15 Bilder je Sekunde (bei 160×80 gut 3 MB/s in die Pipe) |
| Leitung | das Panel schickt höchstens **fünf Bilder je Sekunde** an den Browser |
| Browser | ein Canvas je Bot, gezeichnet aus einem ImageData – kein DOM je Zelle |

Die fünf Bilder je Sekunde sind eine feste Bremse im Panel (`POV_MIN_GAP_MS` in
`server/supervisor.js`). Der Client zeichnet schneller, aber schneller nützt an dieser Stelle
niemandem und kostet Bandbreite bei jedem, der zusieht. **Verworfen wird früh:** Ob ein Bild
überhaupt eingesammelt wird, entscheidet sich an seiner Kopfzeile – die Zeilen eines Bildes, das
ohnehin niemand bekommt, werden nur überlesen und nicht zerlegt. Ohne das kostete die Bremse mehr,
als sie spart.

Am Browser kommt ein Bild als Farbläufe an (`[["4182d2", 160], …]`, eine Liste je Bildzeile). In
einer Welt mit großen gleichfarbigen Flächen sind das ein paar hundert Läufe und damit wenige
Kilobyte; in einer sehr kleinteiligen Szene können es bis zu 12 800 werden. Das ist die Obergrenze
und der Grund, warum die Ansicht ein eigener Zusatz ist.

Ein Bild geht **nicht** in jede Zustandsmeldung mit: Zustandswechsel und Bilder laufen getrennt,
sonst würde jeder Bot-Zustand zu einem Datenpaket von zig Kilobyte.

---

## Wie es im Panel ankommt

```
Client                                   Panel                          Browser
  │  ESC[H POV x=12 y=64 z=-8 …            │                              │
  │  ESC[38;2;r;g;bm ESC[48;2;r;g;bm ▀ …   │                              │
  │  … 40 solcher Zeilen                   │                              │
  └───── Standardfehlerausgabe ──────────► │                              │
                                           │ erkennt das Bild an seiner   │
                                           │ Kopfzeile, zerlegt jede      │
                                           │ Zeichenzeile in zwei         │
                                           │ Bildzeilen aus Farbläufen    │
                                           └──── WebSocket "view" ──────► │ Canvas
```

Drei Dinge daran sind wichtig:

* **Die Kopfzeile steht vorn.** `POV  x=…` beginnt ein Bild; es endet an der ersten Zeile, die
  keine Bildzeile mehr ist. Wer sie als Schlusszeile liest, sammelt nie eine einzige Zeile ein –
  genau das war der Fehler, an dem die Ansicht bis zuletzt hängen blieb.
* **Ein Zeichen sind zwei Bildpunkte.** Der Halbblock trägt oben die Vorder-, unten die
  Hintergrundfarbe. Wer die Hintergrundfarbe wegwirft, wirft das halbe Bild weg.
* **Ein Bild ist kein Chat.** Ohne die Erkennung stünden vierzig Zeilen aus `▀` zwischen den
  Nachrichten der Mitspieler – bei fünfzehn Bildern je Sekunde sechshundert Zeilen in der Sekunde,
  an jeden offenen Browser. Die Erkennung läuft nur, wenn jemand die Ansicht angefordert hat, und
  sie ist streng: Eine Zeile, die nicht genau so aufgebaut ist, ist keine Bildzeile und geht ihren
  gewohnten Weg.

Die örtlichen Befehle des Clients dahinter:

| Befehl | Wirkung |
| --- | --- |
| `:pov live` | laufende Ansicht starten |
| `:pov stop` | laufende Ansicht stoppen |
| `:pov frame` | genau ein Bild zeichnen |
| `:pov info` | Dimension, Welthöhe, Chunk- und Entity-Zahl |
| `:pov size 160 80` | setzt das Panel selbst, vor jedem Start |

Sie lassen sich nicht als Chatzeile absetzen. Alles, was mit `:` beginnt, geht durch dieselbe
Prüfung wie der Befehlsendpunkt – wer den Zusatz nicht gebucht hat, bekommt eine klare Absage
statt einer Ansicht. `size` nimmt das Panel dabei **nicht** entgegen: Die Größe steht fest, und
eine Ansicht, die sich von außen kleiner stellen lässt, wäre eine schlechtere für dasselbe Geld.

---

## Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Der Reiter fehlt | Zusatz nicht gebucht, oder der Client kann es nicht | **Zusätze** ansehen; **Administration → Client** zeigt, welche Bauformen da sind |
| *"Die Live-Ansicht ist für diesen Serverplatz nicht gebucht."* | genau das | Zusatz buchen |
| *"Warte auf das erste Bild …"* bleibt stehen | der Bot ist noch nicht im Spiel | erst verbinden, dann zusehen |
| … obwohl der Bot online ist | der Server hat noch keine Chunks geschickt | ein paar Sekunden warten; bei `:pov info` steht die Chunk-Zahl |
| … und der Bot fällt gleich nach dem Beitritt aus | bekannter Fehler im Client (`src/pov.rs`) auf normal erzeugten Welten | siehe unten |
| Das Bild ist fast schwarz | der Bot steht im Dunkeln | stimmt so – die Farbe kommt aus dem Bild, nicht aus einer Beleuchtung |
| Das Bild ruckelt | fünf Bilder je Sekunde sind die Obergrenze | so gewollt |
| Die Ansicht läuft weiter, obwohl der Reiter zu ist | der Browser wurde hart geschlossen | der nächste Aufruf des Reiters stoppt sie; sonst Bot neu starten |

---

## Ein offener Fehler im Client

Auf einer **normal erzeugten** Welt (kein Superflach) brechen beide POV-Bauformen wenige Sekunden
nach dem Beitritt ab, noch bevor jemand `:pov live` geschickt hat – sie halten die Welt ja von
Anfang an nach:

```
thread 'afk-net' panicked at src/pov.rs:638:55:
index out of bounds: the len is 91 but the index is 394
```

Nachgestellt gegen Paper 1.21.11 (`--mc 1.21.11`) und Paper 26.2 (`--mc 26.2`), mit
`pov-afk-linux` wie mit `ultra-afk-linux`; `premium-items-afk-linux`, `premium-afk-linux` und
`afk-linux` laufen daneben störungsfrei weiter. Der Index liegt weit über der Palettenlänge – das
sieht nach einer Palette aus, die mit der falschen Bitbreite gelesen wird. Auf Superflach fällt es
nicht auf, weil die Paletten dort winzig sind.

**Das lässt sich hier nicht beheben** – es steckt im Client, nicht im Panel. Bis es dort behoben
ist, betrifft es jeden Serverplatz mit gebuchter Live-Ansicht. Alle übrigen sind seit der Änderung
an `binaries.buildFor()` nicht mehr betroffen: Die POV-Bauform bekommt nur noch, wer die Ansicht
auch gebucht hat (vorher bekam sie jeder Ultra-Tarif, ob er sie brauchte oder nicht).
