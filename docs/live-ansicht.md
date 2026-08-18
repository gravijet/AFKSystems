# Die Live-Ansicht (POV)

Sehen, was der Bot sieht – im Browser, ohne Minecraft zu starten.

---

## Was das ist

Minecraft überträgt an einen Client **keine fertigen Bilder** und keine Blocktexturen. Was über
das Netz kommt, sind Chunk-Daten: Paletten von Blocktypen, Höhenkarten, Blockänderungen, Entities
mit Position und Blickrichtung. Ein Bild daraus entsteht erst im Client.

Genau das tun die POV-Bauformen des Rust-Clients: Sie decodieren die geladenen Chunk-Paletten,
halten Blockänderungen und Entities live nach und **raycasten** aus der Kameraposition und
Blickrichtung ein Bild. Ausgegeben wird es als Raster aus Zeichen – jedes Zeichen eine Helligkeit
aus der Rampe ` .:-=+*#%@`, jedes in der Echtfarbe des getroffenen Blocks.

Das Panel liest dieses Raster, zerlegt es in Farbabschnitte und zeichnet es im Browser auf ein
Canvas: ein Pixel je Zeichen, Farbe mal Helligkeit, ohne Glättung hochskaliert. Heraus kommt eine
Voxelansicht der Welt, wie sie der Bot an seiner Stelle sieht.

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
| **Auflösung** | Klein 48×24, Mittel 80×40, Groß 120×60 |

Wer den Reiter verlässt, stoppt die Ansicht automatisch. Das ist kein Komfort, sondern nötig: eine
laufende Ansicht kostet auf der Maschine deutlich mehr als ein stiller Bot.

Sitzen mehrere Konten auf dem Serverplatz, hat jedes seine eigene Ansicht; welche laufen, entscheidet
die Auswahl über den Knöpfen.

---

## Was es kostet – technisch

| | |
| --- | --- |
| Rechenzeit | der Client raycastet je Bild; bei 80×40 sind das 3200 Strahlen |
| Speicher | der Client hält die geladenen Chunks vor (deutlich mehr als ein AFK-Bot ohne POV) |
| Leitung | das Panel schickt höchstens **fünf Bilder je Sekunde** an den Browser |
| Browser | ein Canvas je Bot, gezeichnet aus einem ImageData – kein DOM je Zelle |

Die fünf Bilder je Sekunde sind eine feste Bremse im Panel (`POV_MIN_GAP_MS` in
`server/supervisor.js`). Der Client zeichnet schneller, aber schneller nützt an dieser Stelle
niemandem und kostet Bandbreite bei jedem, der zusieht.

Ein Bild geht **nicht** in jede Zustandsmeldung mit: Zustandswechsel und Bilder laufen getrennt,
sonst würde jeder Bot-Zustand zu einem Datenpaket von zig Kilobyte.

---

## Wie es im Panel ankommt

```
Client                             Panel                          Browser
  │  ESC[H                           │                              │
  │  ..##  (Farbe je Abschnitt)      │                              │
  │  ====                            │                              │
  │  POV  x=12 y=64 z=-8             │                              │
  └───── Standardausgabe ──────────► │                              │
                                     │ erkennt das Bild an ESC[H,   │
                                     │ sammelt die Zeilen, zerlegt  │
                                     │ die Farben in Abschnitte     │
                                     └──── WebSocket "view" ──────► │ Canvas
```

Zwei Dinge daran sind wichtig:

* **Ein Bild ist kein Chat.** Ohne die Erkennung stünden vierzig Zeilen aus `#` und `%` zwischen
  den Nachrichten der Mitspieler. Die Erkennung läuft nur, wenn jemand die Ansicht angefordert hat –
  sonst kostet sie eine Abfrage je Zeile und sonst nichts.
* **Eine Meldung, die genauso beginnt, bleibt eine Meldung.** `Live-POV beendet.` steht ebenfalls
  hinter `ESC[H`; entscheidend ist, ob danach Zeichen der Helligkeitsrampe kommen oder Text.

Die örtlichen Befehle des Clients dahinter:

| Befehl | Wirkung |
| --- | --- |
| `:pov live` | laufende Ansicht starten |
| `:pov stop` | laufende Ansicht stoppen |
| `:pov frame` | genau ein Bild zeichnen |
| `:pov size 80 40` | Bildgröße setzen (24–160 × 12–80) |
| `:pov info` | Dimension, Welthöhe, Chunk- und Entity-Zahl |

Sie lassen sich nicht als Chatzeile absetzen. Alles, was mit `:` beginnt, geht durch dieselbe
Prüfung wie der Befehlsendpunkt – wer den Zusatz nicht gebucht hat, bekommt eine klare Absage
statt einer Ansicht.

---

## Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Der Reiter fehlt | Zusatz nicht gebucht, oder der Client kann es nicht | **Zusätze** ansehen; **Administration → Client** zeigt, welche Bauformen da sind |
| *"Die Live-Ansicht ist für diesen Serverplatz nicht gebucht."* | genau das | Zusatz buchen |
| *"Warte auf das erste Bild …"* bleibt stehen | der Bot ist noch nicht im Spiel | erst verbinden, dann zusehen |
| … obwohl der Bot online ist | der Server hat noch keine Chunks geschickt | ein paar Sekunden warten; bei `:pov info` steht die Chunk-Zahl |
| Das Bild ist fast schwarz | der Bot steht im Dunkeln | stimmt so – die Helligkeit kommt aus dem Bild, nicht aus einer Beleuchtung |
| Das Bild ruckelt | fünf Bilder je Sekunde sind die Obergrenze | kleinere Auflösung wählen |
| Die Ansicht läuft weiter, obwohl der Reiter zu ist | der Browser wurde hart geschlossen | der nächste Aufruf des Reiters stoppt sie; sonst Bot neu starten |
