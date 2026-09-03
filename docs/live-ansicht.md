# Die Live-Ansicht (POV)

Sehen, was der Bot sieht – im Browser, ohne Minecraft zu starten.

---

## Was das ist

Minecraft überträgt an einen Client **keine fertigen Bilder**. Was über das Netz kommt, sind
Chunk-Daten: Paletten von Blocktypen, Höhenkarten, Blockänderungen, Entities mit Position und
Blickrichtung. Ein Bild daraus entsteht erst im Client.

Genau das tun die POV-Bauformen des Rust-Clients: Sie decodieren die geladenen Chunk-Paletten,
halten Blockänderungen und Entities live nach und **raycasten** aus der Kameraposition und
Blickrichtung ein Bild.

Es ist **kein Bildschirmabgriff** und keine Aufzeichnung. Es ist das, was aus den Daten folgt, die
der Server dem Bot ohnehin schickt.

---

## Zwei Wege zu einem Bild

Seit Client 2.5.0 gibt es dafür zwei Wege. Sie stehen nebeneinander, und keiner ist ein Notbehelf
des anderen:

| | **texturiert** | **Voxel** |
| --- | --- | --- |
| Woher | HTTP-Viewer im Client (`--pov-web`) | Halbblöcke auf der Fehlerausgabe |
| Aussehen | echte Blockmodelle und Texturen des Spiels | farbige Voxel, ein Zeichen = zwei Bildpunkte |
| Braucht | Client ≥ 2.6.0; bei 2.5.0 zusätzlich eine Original-Client-JAR auf dem Server | nichts weiter |
| Bildgröße | 320×180, 426×240 oder 640×360, im Panel wählbar | fest 160 × 80 |
| Gerechnet wird | wenn der Browser ein Bild abholt | dauernd, solange die Ansicht läuft |
| Menüs und Inventar | als Daten, mit echten Gegenstandsbildern | nur über `:menu` / `:inv` als Text |

Der texturierte Weg ist der bessere, wo er geht – und seit Client 2.6.0 geht er fast überall, weil
der Client sich die fehlende JAR selbst besorgt. Der Voxelweg bleibt trotzdem: Er braucht gar
nichts, sein Format ist vom Client als Schnittstelle zugesagt, und er ist der Weg für jede Bauform,
die älter ist als 2.6.0 und keine hinterlegte Datei findet.

Seit 2.6.0 zeigt der texturierte Weg außerdem **echtes Licht** (Höhlen sind dunkel, Fackeln
leuchten) und **Biomfarben** statt eines Ebenen-Grüns für alles. Beides steckt im Client; im Panel
ist dafür nichts einzustellen.

Welcher gerade gilt, steht an der Ansicht selbst – nicht in einer Fehlermeldung.

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

## Minecraft-Ressourcen einrichten

Der texturierte Viewer liest beim Zeichnen aus der **Original-Client-JAR von Minecraft** –
Blockstates, vererbte Blockmodelle, Block-PNGs mit Alphakanal und `tintindex`, die GUI-Texturen
für Fadenkreuz und Container, und die Symbole der Gegenstände. Er legt dabei keine Kopie an: Er
greift in die Datei, die auf dem Server liegt.

Diese Datei liefern wir nicht mit und dürfen es nicht. Sie gehört Mojang, und sie ist dieselbe,
die der offizielle Launcher unter `~/.minecraft/versions/<version>/<version>.jar` ablegt. Gebraucht
wird sie **je Protokollversion** – ein Serverplatz auf `26.2` braucht die JAR von `26.2`.

> **Seit Client 2.6.0 ist sie keine Voraussetzung mehr.** Liegt hier keine, sucht sich der Client
> selbst eine: eigene Ablage, eine vorhandene Minecraft-Installation, zuletzt der Download von
> Mojang – über dasselbe öffentliche Versionsmanifest wie der Launcher und mit Prüfung der dort
> genannten SHA-1. Die texturierte Ansicht läuft damit auch ohne einen Handgriff des Betreibers.
>
> Trotzdem lohnt sich das Hinterlegen, und zwar aus einem Grund: Der Client legt seine Kopie unter
> `XDG_CONFIG_HOME` ab, und das ist hier das Verzeichnis **eines Kunden**. Ohne hinterlegte Datei
> lädt sich also jeder Kunde mit Live-Ansicht seine eigenen rund 30 MB. Eine Datei unter `data/mc`
> gilt dagegen für alle Kunden dieser Maschine – das Panel schickt ihren Pfad dann ausdrücklich mit
> und lässt den Client gar nicht erst suchen.

**Administration → Client → Minecraft-Ressourcen.** Dort steht je Version, ob eine Datei da ist,
wie groß sie ist und wie ihr Fingerabdruck lautet. Zwei Wege, sie hinzubekommen:

* **Von Mojang** holt sie über dasselbe Verzeichnis, das der Launcher benutzt
  (`version_manifest_v2.json` → Versions-JSON → `downloads.client`), und prüft den SHA-1, den
  Mojang dazu nennt. Das geht für alles, was dort öffentlich steht.
* **Hochladen** ist der Weg für alles andere – Snapshots, Vorabversionen, oder wenn dieser Server
  nicht ins Netz darf. Angenommen wird nur, was auch wirklich eine Client-JAR ist: ZIP-Kennung am
  Anfang, und im Inhalt die beiden Verzeichnisse, aus denen der Viewer liest. Die Server-JAR fällt
  damit durch, und das ist der Fehler, den man sonst zweimal macht.

Fehlt die Datei, ist **nichts kaputt**. Ab Client 2.6.0 holt sich der Client selbst eine, und die
Ansicht ist texturiert wie sonst auch – nur eben je Kunde einmal geladen. Bei einer älteren Bauform
startet der Bot ohne `--pov-web`, und die Live-Ansicht bleibt die Voxelansicht; dann steht ein
Voxelbild da, wo jemand für Texturen bezahlt hat.

Wer die rund 30 MB gar nicht erst laden will – ein Standort mit schmaler Leitung, ein Konto, das
die Ansicht nur ein paarmal im Monat kurz öffnet –, schaltet unter **Serverplatz → Einstellungen →
Live-Ansicht ohne Texturen laden** ab. Der Viewer läuft dann trotzdem, nur ohne echte Blockbilder;
er sucht und lädt gar nicht erst. Die Einstellung braucht eine Bauform ab 2.6.0 (`--pov-resources
aus`) und wirkt erst nach einem Neustart des Bots.

**Standorte holen sich ihre Kopie selbst.** Ein Bot zeichnet dort, wo er läuft; die JAR muss also
auf derselben Maschine liegen. Sie steht deshalb im Manifest, das ein Standort ohnehin abruft
(`GET /api/node/manifest`), und wird wie eine Client-Datei abgeglichen – nur was fehlt oder
abweicht, und was das Panel nicht mehr führt, räumt der Standort wieder weg. Von Hand ist dort
nichts zu tun (siehe [standorte.md](standorte.md)).

---

## Sichtweite

Der Client meldet dem Server von jeher eine Sichtweite von **2 Chunks**. Für einen Bot, der nur
dastehen soll, ist das genau richtig: Er spart sich und dem Server die Arbeit für eine Welt, die
niemand ansieht. Die POV-Bauformen nehmen von Haus aus 6.

Für ein Bild ist das die eine Zahl, die zählt: **Was der Server nie geschickt hat, kann der Client
nicht zeichnen.** In 2 Chunks endet die Welt drei Schritte vor dem Bot, und mehr Rechenzeit ändert
daran nichts.

**Serverplatz → Einstellungen → Sichtweite (Chunks)**, 0 bis 32. `0` lässt die Vorgabe des Clients
stehen. Mehr Chunks kosten Arbeitsspeicher auf der Maschine und Datenverkehr vom Minecraft-Server,
deshalb gibt es die Einstellung ab einem bezahlten Platz – und deshalb ist die Vorgabe nicht die
höchste Zahl, sondern gar keine.

---

## Bedienen

Der Reiter **Live-Ansicht** steht bei jedem Serverplatz, der den Zusatz gebucht hat und dessen
Client sie mitbringt. Er startet von selbst, sobald wenigstens ein Bot im Spiel ist.

Über den Bildern steht eine Leiste:

| | |
| --- | --- |
| **Bild** | 320×180, 426×240 oder 640×360 (nur texturiert) |
| **Takt** | 2, 5 oder 10 Bilder je Sekunde |
| **Blöcke** | wie weit ein Schritt mit WASD führt |
| **Steuerung** | Tastatur und Maus an oder aus |

Die Wahl gehört dem Zuseher und nicht dem Serverplatz: Wer am Telefon zusieht, will ein kleines
Bild, und wer am Schreibtisch sitzt, ein großes. Sie steht deshalb im Browser (`localStorage`) und
nicht in der Datenbank.

Im Voxelbetrieb kommen die drei bekannten Knöpfe dazu – **Live-Ansicht starten**, **Einzelbild**,
**Stoppen**. Der texturierte Weg braucht sie nicht: Dort rechnet der Client genau dann ein Bild,
wenn der Browser eines abholt. Ein Browser, der nicht fragt, kostet nichts.

### Steuern

Eine Ansicht anklicken – sie bekommt einen Rahmen, und ab da hört sie auf die Tastatur. Bei
mehreren Bots ist damit immer klar, welcher gerade läuft.

| Taste | Wirkung |
| --- | --- |
| `W` `A` `S` `D` (oder die Pfeiltasten) | laufen |
| `Q` `E` | um 30° nach links/rechts drehen |
| `R` `F` | um 15° nach oben/unten sehen |
| `Leertaste` | springen |
| `Shift` | Schleichen an/aus |
| `Strg` | Sprinten an/aus |
| `1` – `9` | Schnellleistenfeld wechseln |
| `X` | Bewegung anhalten |
| `Esc` | offenes Menü schließen |
| Linksklick ins Bild | mit der Haupthand schlagen |
| Rechtsklick ins Bild | Gegenstand in der Hand benutzen |
| Ziehen | Blick drehen |

Dahinter stecken dieselben örtlichen Befehle wie im Reiter **Bewegung** (`:go`, `:look`, `:jump`,
`:sneak`, `:sprint`, `:swing`, `:use`, `:hand`). Neu ist nur, dass man dabei zusieht. Gedreht wird
**relativ zum Winkel, den der Bot wirklich hat** – der steht im Zustand, den der Viewer meldet.

Eine gehaltene Taste löst genau einmal aus: `:go` ist eine Strecke und keine Taste, und zwanzig
Wiederholungen je Sekunde wären zwanzig Strecken hintereinander.

### Hotbar, Menüs und Inventar

Im texturierten Betrieb liegt unter dem Bild die **Schnellleiste** mit den echten Bildern der
Gegenstände; ein Klick nimmt ein Feld in die Hand. Öffnet der Server ein **Menü**, legt es sich
über das Bild – anklickbar mit links, rechts und Shift, `Esc` oder ein Klick daneben schließt es.

Der Reiter **Inventar** zeigt dasselbe vollständig und in der Anordnung des Spiels: Rüstung,
Werkbank, Tasche, Schnellleiste, Nebenhand. An jedem leeren Feld steht seine Nummer – wer ein Macro
mit `:click` schreibt, braucht genau die.

Ohne Texturen bleibt beides trotzdem da: Dann kommen die Felder über `:menu` und `:inv` als Text,
und statt des Bildes steht ein Zeichen im Feld. Der Name und der Beschreibungstext stehen in beiden
Fällen im Aufklapper, mit den Farben, die der Server geschickt hat.

### Vollbild und Bildschirmfoto

Oben rechts im Bild, sobald die Maus in der Nähe ist. **Vollbild** gibt dem Bild den ganzen Schirm;
**Bild speichern** legt ein PNG ab, benannt nach Serverplatz, Konto und Zeitpunkt – ein
Bildschirmfoto ist meistens der Anhang eines Tickets.

### Aufhören

Wer den Reiter verlässt, stoppt die Ansicht. Im Voxelbetrieb ist das nötig: eine laufende Ansicht
kostet auf der Maschine deutlich mehr als ein stiller Bot. Dasselbe gilt für ein hart geschlossenes
Fenster – ist die letzte Verbindung eines Kontos zwanzig Sekunden lang weg, schaltet das Panel
dessen Ansichten von sich aus ab. Im texturierten Betrieb erledigt sich das von selbst: Wer nicht
mehr fragt, bekommt nichts mehr gerechnet.

---

## Was es kostet – technisch

| | texturiert | Voxel |
| --- | --- | --- |
| Rechenzeit | ein Raycast je Bildpunkt, aber nur auf Abruf | 12 800 Strahlen je Bild, dauernd |
| Speicher | die geladenen Chunks plus die aufgeschlagenen Modelle und Texturen | die geladenen Chunks |
| Leitung Client → Panel | ein PNG je Abruf (einige hundert Kilobyte) | fünf Bilder je Sekunde durch die Pipe |
| Leitung Panel → Browser | dasselbe PNG, unverändert | Farbläufe je Bildzeile |

Die geladenen Chunks sind in beiden Fällen der größte Posten, und die **Sichtweite** ist der
Regler dafür (siehe oben). Der Client hält Chunks weiter als sechs Chunks von der Kamera gar nicht
erst vor.

Im Voxelbetrieb stehen die fünf Bilder je Sekunde an **zwei** Stellen, und das ist Absicht:
`--pov-fps 5` sagt dem Client, gar nicht erst schneller zu zeichnen, und `POV_MIN_GAP_MS` in
`server/supervisor.js` hält die Regel auch dann ein, wenn eine ältere Client-Datei die Option nicht
kennt. **Verworfen wird früh:** Ob ein Bild überhaupt eingesammelt wird, entscheidet sich an seiner
Kopfzeile – die Zeilen eines Bildes, das ohnehin niemand bekommt, werden nur überlesen und nicht
zerlegt.

Ein Bild geht **nicht** in jede Zustandsmeldung mit: Zustandswechsel und Bilder laufen getrennt,
sonst würde jeder Bot-Zustand zu einem Datenpaket von zig Kilobyte.

---

## Wie es im Panel ankommt

### Texturiert

```
Client                                   Panel                          Browser
  │  Browser-POV: http://127.0.0.1:42100/?token=…                         │
  └───── Fehlerausgabe, genau einmal ───►  │ merkt sich Port und Token,   │
                                           │ erzählt den Token nie weiter │
                                           │                              │
  ◄──── GET /api/frame.png?w=426&h=240 ─── │ ◄── GET /api/profiles/7/pov/3/frame.png
  ├───── image/png ──────────────────────► │ ────────────────────────────►│ <img>
  ◄──── GET /api/state.json ────────────── │ ◄── … /state.json
  ├───── Position, Chunks, Menü, Inventar ►│ ────────────────────────────►│ Hotbar, Menü
  ◄──── POST /api/click?slot=13 ────────── │ ◄── … /click
```

Drei Dinge daran sind wichtig:

* **Der Viewer lauscht auf 127.0.0.1**, nie im Netz. Aus dem Internet ist er nicht erreichbar, auch
  nicht auf einem Standort. Was der Kunde sieht, geht durch das Panel.
* **Der Zugriffstoken bleibt im Panel.** Der Client würfelt ihn beim Start und schreibt die fertige
  Adresse einmal auf die Fehlerausgabe – für einen Menschen am Terminal. Hier sitzt keiner: Die
  Zeile ginge über die Live-Leitung in jeden offenen Browser dieses Kontos, und mit dem Token kann
  man die Weltdaten eines fremden Minecraft-Servers abholen und im Spiel klicken. Das Panel liest
  ihn, ersetzt die Zeile durch „Live-Ansicht mit Texturen bereit.“ und behält ihn für sich.
* **Das Panel reicht nur einen festen Satz Pfade durch**, nie eine Adresse aus der Anfrage: Bild,
  Zustand, Gegenstandsbild, Klick, Schließen, Schnellleiste. Sonst wäre der Endpunkt ein offener
  Proxy auf den Localhost des Servers – für jeden angemeldeten Kunden. Der Inhaltstyp der Antwort
  wird ebenfalls nicht übernommen, sondern gesetzt: Was aus einer fremden Weltdatei kommt, soll im
  Browser ein Bild sein und nichts anderes. Die GUI-Texturen des Spiels bietet der Viewer zwar an,
  das Panel holt sie aber nicht: Menü und Schnellleiste werden mit den Feldern des Panels
  gezeichnet, und ein Durchreicher, den nichts benutzt, ist nur eine Fläche mehr.

Läuft der Bot auf einem **Standort**, geht dieselbe Anfrage durch die bestehende WebSocket-Leitung
dorthin (`http`/`httpres` in `server/agents.js`). Der Standort führt sie gegen seinen eigenen
Localhost aus und schickt Status, Inhaltstyp und Bytes zurück. Ein zweiter Kanal wäre eine zweite
Portfreigabe – und die zu vermeiden ist der ganze Sinn dieser Bauart.

### Voxel

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

* **Die Kopfzeile steht vorn.** `POV  x=…` beginnt ein Bild; es endet an der ersten Zeile, die
  keine Bildzeile mehr ist. Wer sie als Schlusszeile liest, sammelt nie eine einzige Zeile ein.
* **Ein Zeichen sind zwei Bildpunkte.** Der Halbblock trägt oben die Vorder-, unten die
  Hintergrundfarbe. Wer die Hintergrundfarbe wegwirft, wirft das halbe Bild weg.
* **Ein Bild ist kein Chat.** Ohne die Erkennung stünden vierzig Zeilen aus `▀` zwischen den
  Nachrichten der Mitspieler. Die Erkennung läuft nur, wenn jemand die Ansicht angefordert hat, und
  sie ist streng: Eine Zeile, die nicht genau so aufgebaut ist, ist keine Bildzeile.

### Die Befehle dahinter

| Befehl | Wirkung |
| --- | --- |
| `:pov live` | laufende Voxelansicht starten |
| `:pov stop` | laufende Voxelansicht stoppen |
| `:pov frame` | genau ein Bild zeichnen |
| `:pov info` | Dimension, Welthöhe, Chunk- und Entity-Zahl |
| `:pov size 160 80` | braucht das Panel nur noch für Client-Dateien vor 2.1.0 – seitdem steht die Größe als `--pov-size` im Start |

Sie lassen sich nicht als Chatzeile absetzen. Alles, was mit `:` beginnt, geht durch dieselbe
Prüfung wie der Befehlsendpunkt – wer den Zusatz nicht gebucht hat, bekommt eine klare Absage
statt einer Ansicht. `size` nimmt das Panel dabei **nicht** entgegen: Im Voxelbetrieb steht die
Größe fest auf dem Größten, was der Client kann, und eine Ansicht, die sich von außen kleiner
stellen lässt, wäre eine schlechtere für dasselbe Geld.

Welche Startargumente benutzt werden, entscheidet nicht eine Liste im Code, sondern die Hilfe der
Datei selbst: `binaries.js` sucht in `--help` nach `--pov an|aus`, `--pov-size`, `--pov-fps`,
`--pov-web`, `--pov-resources` und `--view-distance` und schickt nur, was dort steht. Eine ältere
Bauform bräche bei einer unbekannten Option beim Start ab – und dann liefe gar kein Bot mehr, nicht
nur die Ansicht nicht.

---

## Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Der Reiter fehlt | Zusatz nicht gebucht, oder der Client kann es nicht | **Zusätze** ansehen; **Administration → Client** zeigt, welche Bauformen da sind |
| *"Die Live-Ansicht ist für diesen Serverplatz nicht gebucht."* | genau das | Zusatz buchen |
| *"Erst den Bot starten …"* | der Bot ist nicht im Spiel | erst verbinden, dann zusehen |
| Voxelbild statt Texturen | keine JAR für diese Version **und** eine Bauform vor 2.6.0 (ältere Clients können sich keine besorgen) | **Administration → Client → Minecraft-Ressourcen**, oder den Client abgleichen |
| *"Position noch unbekannt"* | der Bot ist verbunden, hat aber noch keine Position | ein paar Sekunden warten – der Satz kommt vom Client und heißt genau das |
| Die Welt endet drei Schritte vor dem Bot | Sichtweite 2 | **Einstellungen → Sichtweite**, danach Bot neu starten |
| *"Warte auf das erste Bild …"* bleibt stehen | der Server hat noch keine Chunks geschickt | ein paar Sekunden warten; bei `:pov info` steht die Chunk-Zahl |
| Das Bild ist fast schwarz | der Bot steht im Dunkeln | stimmt so – die Farbe kommt aus dem Bild, nicht aus einer Beleuchtung |
| Das Bild ruckelt | der eingestellte Takt | **Takt** in der Leiste hochstellen (kostet Rechenzeit) |
| Die Ansicht läuft weiter, obwohl der Reiter zu ist | Voxelbetrieb, Browser hart geschlossen | der nächste Aufruf des Reiters stoppt sie; sonst Bot neu starten |
| Änderung an Sichtweite oder Ressourcen wirkt nicht | beides steht im Startbefehl | Bot neu starten |

---

## Der Fehler im Client – erledigt

Hier stand lange ein offener Fehler: Auf einer **normal erzeugten** Welt (kein Superflach) brachen
beide POV-Bauformen wenige Sekunden nach dem Beitritt ab, noch bevor jemand `:pov live` geschickt
hatte – sie halten die Welt ja von Anfang an nach.

```
thread 'afk-net' panicked at src/pov.rs:638:55:
index out of bounds: the len is 91 but the index is 394
```

Der Client hat das in **2.1.0** behoben („Absturz an gemischten Block-Paletten"), und seit 2.4.0
liegt diese Fassung hier. Nachgeprüft, nicht angenommen: ein Lauf gegen den Testserver des Clients
mit gemischten Paletten und acht gefüllten Abschnitten je Chunk – also genau der Fall, an dem er
abbrach – liefert sechs vollständige Bilder in 160 × 80 und keinen einzigen Abbruch.

Wer noch eine ältere Client-Datei liegen hat, holt sie mit **Administration → Client → Abgleichen**
nach; unter **Version** muss dort mindestens `2.1.0` stehen, für die texturierte Ansicht `2.5.0`.
