# Wie AFKSystems funktioniert

Das lange Dokument. Es erklärt den Aufbau, die Datenflüsse und die Entscheidungen dahinter – für
alle, die etwas ändern oder eine Störung suchen. Wer nur etwas einrichten will, ist in den
jeweiligen Anleitungen schneller (siehe [docs/README.md](README.md)).

---

## Inhalt

1. [Das Ganze in einem Bild](#ueberblick)
2. [Ein Bot von Anfang bis Ende](#botleben)
3. [Der Client und seine sieben Bauformen](#client)
4. [Chat: von der Serverfarbe bis in den Browser](#chat)
5. [Ansichten: Scoreboard, Menüs, Live-Ansicht](#ansichten)
6. [Standorte: wo ein Bot wirklich läuft](#standorte)
7. [Geld: Credits, Tarife, Zusätze](#geld)
8. [Was ein Serverplatz kann – die eine Rechnung](#faehigkeiten)
9. [Konten, Anmeldung, Sitzungen](#konten)
10. [Discord](#discord)
11. [Die Datenbank](#datenbank)
12. [Die Weboberfläche](#oberflaeche)
13. [Zwei Sprachen](#sprachen)
14. [Betrieb, Sicherung, Aktualisierung](#betrieb)

---

<a id="ueberblick"></a>

## 1. Das Ganze in einem Bild

```
                      ┌──────────────────────────────────────────────┐
  Browser ───────────►│  server/index.js                             │
   Website + Panel    │   ├─ Seiten (pages.js, landing.js)           │
   WebSocket /api/ws  │   ├─ API  (routes/*.js)                      │
                      │   ├─ Supervisor (ein Prozess je Bot)         │
                      │   └─ WebSocket-Verteiler                     │
                      └───┬──────────┬──────────┬───────────┬────────┘
                          │          │          │           │
                   SQLite │   Standorte    Discord-Bot    Stripe
                  (db.js) │   (agents.js)  (bridge.js)    (stripe.js)
                          │        │            │            │
                    data/afksystems.db          │            │
                                   │            │            └─ Webhook /api/stripe/webhook
                                   │            └─ WebSocket /api/bot/stream
                                   └─ WebSocket /api/node/stream  ──► agent/index.js
                                                                       └─ ein Prozess je Bot
```

Ein Prozess trägt fast alles: HTTP, WebSocket, die Bot-Verwaltung und die Zeitgeber für
Verlängerungen. Daneben laufen der Discord-Bot (eigener Dienst) und beliebig viele
Standort-Agenten (eigene Maschinen).

**Warum ein Prozess und nicht mehrere Dienste:** Der Zustand eines Bots – Chatpuffer, Zustandsautomat,
offene Abfragen – lebt im Arbeitsspeicher. Ihn über einen Message-Broker zu verteilen wäre bei
dieser Größe mehr Betriebsaufwand als Gewinn. Was wirklich getrennt gehört, ist getrennt: der
Discord-Bot (fremde Verfügbarkeit) und die Standorte (fremde Maschinen).

---

<a id="botleben"></a>

## 2. Ein Bot von Anfang bis Ende

Ein **Bot** ist die Kombination aus einem Serverplatz und einem Minecraft-Konto: `profil:konto`.
Der Code dazu steht in `server/supervisor.js`, Klasse `Bot`.

### Start

```
POST /api/profiles/:id/start
  │
  ├─ Darf das? (routes/profiles.js)
  │    Serverplatz gehört mir · nicht gesperrt · nicht stillgelegt
  │
  ├─ supervisor.start()
  │    ├─ Grenzen: Bots je Nutzer, Bots gesamt, Bots je Serverplatz (aus dem Tarif)
  │    ├─ Laufzeit: bezahlt? Gratis-Platz → Discord-Mitgliedschaft frisch bestätigt?
  │    ├─ Konto: nicht stillgelegt, angemeldet, Offline-Konto nur mit Tarif
  │    ├─ Bauform wählen (binaries.buildFor) und Argumente bauen (Bot#args)
  │    └─ Prozess starten – örtlich (spawn) oder auf einem Standort (agents.spawn)
  │
  └─ `wanted = 1` in profile_accounts
```

`wanted` ist der Wunsch, nicht der Zustand. Nach einem Neustart des Dienstes fährt
`supervisor.restoreAll()` alles wieder hoch, was laufen *sollte*.

### Während des Laufs

```
Standardausgabe  ──► Chat (mit Farben)  ──► Puffer, Protokoll, WebSocket "line"
Standardfehler   ──► Zustandsmeldungen  ──► Zustandsautomat, WebSocket "state"
                 ──► "@event …"-Zeilen  ──► dasselbe, aber maschinenlesbar
                 ──► POV-Bilder         ──► WebSocket "view"
Standardeingabe  ◄── Chat, Befehle, ":go vor 5"
```

**Warum `@event` und nicht der Meldungstext:** Ereignisse sind stabil, Meldungstexte nicht. Wo der
Client `--events` beherrscht, hängt der Zustand daran; die Textmuster in `PATTERNS` bleiben nur für
das, was es als Ereignis nicht gibt (die Microsoft-Anmeldung mitten im Lauf).

### Ende

Der Rust-Client beendet sich nach einem Kick oder Verbindungsabbruch **absichtlich** mit
Fehlerstatus. Einen eigenen Reconnect hat er seit 2.6.0 zwar – das Panel schaltet ihn aber ab
(`--no-reconnect`, siehe Abschnitt 3), weil es selbst die Aufsicht ist. Was danach passiert,
entscheidet eine einzige Frage – **war der Bot vorher im Spiel?**

* **Ja.** Dann ist das Aus eine Störung. Der Startwunsch (`wanted`) bleibt stehen, und der
  Wiederanlauf holt den Bot zurück: erster Versuch nach `reconnect_delay`, danach verdoppelt sich
  die Wartezeit bis `max_backoff`, höchstens acht Versuche hintereinander. Wer fünf Minuten
  gestanden hat, fängt beim nächsten Ausfall wieder bei Versuch eins an; wer achtmal in Folge
  scheitert, bleibt aus und der Kunde bekommt eine Nachricht.
* **Nein.** Dann ist es eine Absage – falsche Adresse, falsche Version, Bann, Whitelist –, und die
  wiederholt sich nicht von selbst: `wanted = 0` und ein sichtbarer Zustand, wie bisher.

Damit deckt derselbe Mechanismus auch den **Neustart der ganzen Maschine** ab: `wanted` steht in
der Datenbank, die systemd-Einheit fährt das Panel wieder hoch, und `restoreAll()` löst beim
Hochfahren jeden offenen Wunsch ein. Abschalten lässt sich das je Serverplatz (`auto_reconnect`).

Ein vom Server angeordneter Transfer auf einen Unterserver bleibt Teil derselben Sitzung – den
befolgt der Client selbst, ohne dass hier etwas passiert.

### Und wenn es am Zielserver liegt?

„Absage“ heißt oft: Der Minecraft-Server ist aus. Das lässt sich fragen, ohne einen Bot dafür zu
starten – `server/mcping.js` macht dieselbe Abfrage wie der Minecraft-Launcher für seine
Serverliste (Server List Ping, `next state = 1`). Kein Beitritt, kein Konto, keine Anmeldung bei
Mojang; für den Zielserver sieht es aus wie jemand mit offener Serverliste.

Das Protokoll besteht dabei aus drei Dingen – VarInt, String, Paket mit Längenpräfix –, also
dreißig Zeilen und keiner Bibliothek. Zurück kommt ein JSON-Block mit MOTD, Spielerzahl, Version
und Serversymbol.

Zwei Dinge daran sind wichtiger als das Protokoll:

* **Ohne ausdrücklichen Port wird der SRV-Eintrag `_minecraft._tcp.<host>` aufgelöst.** Genau das
  tut der Spielclient auch, und unter derselben Bedingung: `example.net:25566` meint diesen Port.
  Ohne diese Auflösung fragte das Panel Port 25565 auf einer Adresse, an der niemand lauscht, und
  meldete „offline“ für einen Server, der bestens läuft.
* **Was von dort kommt, gehört einem Fremden.** Es ist die einzige Stelle im Panel, an der Daten von
  einem beliebigen Server hereinkommen, den sich der Kunde selbst ausgesucht hat. Jedes Feld wird
  einzeln herausgenommen und beschnitten, das Serversymbol muss ein `data:image/png` sein, die
  Namensliste endet nach zwölf Einträgen, und der MOTD wird in dieselbe §-Schreibweise übersetzt,
  die auch der Chat benutzt (`mcText`, siehe Abschnitt 4) – die Antwort einfach durchzureichen
  hieße, jedem Serverbetreiber der Welt ein Feld in unserer Oberfläche zu geben.

Der Zwischenspeicher hält fünfzehn Sekunden: Wer zehn Serverplätze auf demselben Minecraft-Server
hat, fragte ihn sonst zehnmal in derselben Sekunde.

---

<a id="client"></a>

## 3. Der Client und seine sieben Bauformen

Die Bots sind Prozesse des [AFKSystems-Clients](https://github.com/gravijet/HugoAFKClient). Er ist
bewusst pipe-fähig gebaut, deshalb braucht es zwischen Panel und Client kein eigenes Protokoll.

| Bauform | Datei | Kann |
| --- | --- | --- |
| Basis | `afk-linux` | Verbindung, Chat, Befehle, Macros |
| Bewegung | `afk-linux-move` | dazu `:go`, `:look`, `:home`, `:route` |
| Items | `items-afk-linux` | dazu Menüs und Gegenstandsdaten |
| Premium | `premium-afk-linux` | Bewegung, Scoreboard, Menü-Klicks, Schleichen, Anti-AFK |
| Premium + Items | `premium-items-afk-linux` | Premium plus Gegenstände mit Namen, Farben, Lore |
| POV | `pov-afk-linux` | Live-Ansicht (das Panel startet sie erst, wenn jemand zusieht) |
| Ultra | `ultra-afk-linux` | alles; Live-Ansicht mit `:pov live` zuschaltbar |

Ab Client 2.5.0 bringen die beiden POV-Bauformen zusätzlich einen **texturierten Browser-Viewer**
mit (`--pov-web`), der aus der Original-Client-JAR von Minecraft zeichnet (`--pov-resources`). Ab
2.6.0 findet der Client diese JAR selbst, wenn keine hinterlegt ist.

### Zwei Optionen aus 2.6.0, die das Panel angehen

**`--no-reconnect`.** Ab 2.6.0 verbindet sich der Client nach einem Kick von selbst neu. Das Panel
ist aber selbst die Aufsicht, und zwei Antworten auf dieselbe Frage sind eine zu viel. Es schickt
die Option deshalb immer mit, sobald die Bauform sie kennt. Der Grund steht ausführlich in
`supervisor.js` bei `args()`; kurz: Ein abgeschaltetes `auto_reconnect` wäre sonst wirkungslos, ein
Serverplatz liefe über das Ende seiner Laufzeit hinaus weiter, und das Aufgeben nach acht
Fehlversuchen (samt Nachricht an den Kunden) fände nie statt.

**`--pov-resources <jar|auto|aus>`.** Bis 2.5.0 war der Pfad Pflicht – ohne hinterlegte JAR keine
Texturen. Ab 2.6.0 ist `auto` die Vorgabe: eigene Ablage, vorhandene Minecraft-Installation, zuletzt
Mojang. Das Panel schickt seinen eigenen Pfad weiter mit, wenn es einen hat: Eine Datei unter
`data/mc` gilt für alle Kunden dieser Maschine, die Selbsthilfe des Clients dagegen legt sie unter
`XDG_CONFIG_HOME` ab – und das ist hier das Verzeichnis *eines* Kunden.

Beide werden an der Schreibweise in `--help` erkannt und nicht an der Versionsnummer. `--pov-resources`
allein reicht dafür nicht: Die Option gab es vorher auch, sie konnte nur weniger – erkannt wird
deshalb die Werteliste `<jar|auto|aus>`.

`server/binaries.js` lädt sie aus dem GitHub-Release `latest`, ruft für jede `--help` auf und merkt
sich, **was sie wirklich kann**. Es steht nirgends im Code eine Liste von Fähigkeiten, die
veralten könnte: fehlt etwas, ist der Knopf dafür aus. Umgekehrt gilt dasselbe – eine Option, die
in der Hilfe steht, wird benutzt (`--pov-size`, `--pov-fps`, `--pov-web`, `--view-distance`), und eine, die
dort fehlt, wird nicht mitgeschickt: Eine ältere Datei bräche bei einer unbekannten Option beim
Start ab, und dann liefe gar kein Bot mehr.

Jede Datei wird für sich geladen. Ein Download, der scheitert, überspringt nicht mehr alles, was in
der alphabetischen Reihenfolge dahinter liegt – das war ausgerechnet `ultra-afk-linux`.

Alle Rust-Bauformen sprechen Minecraft 1.21.1, 1.21.11, 26.1 und 26.2, gewählt mit `--mc`.

`buildFor()` sucht die passende Datei zum Tarif und fällt auf die nächstbeste zurück, wenn sie
fehlt – ein vergessener Download legt damit keine Bots still.

### Der Abdruck: wer läuft noch mit der alten Datei?

Der Abgleich läuft im Stundentakt. Er tauscht die Dateien in `data/bin` aus – **unter laufenden
Prozessen hindurch**, denn ein Prozess hält seine Datei offen und merkt davon nichts. Ohne eine
eigene Buchführung stünde im Panel „Client 2.6.0“, während zwanzig Bots seit zwei Wochen 2.5.0 sind,
samt der Fehler, wegen derer 2.6.0 gebaut wurde.

`detect()` liest deshalb je Bauform einen **Abdruck**: `"<Größe>:<Änderungszeit>"`, dazu die
Fassungsnummer aus `--help`. Ein Bot merkt sich beim Start beides (`Bot#clientStamp`,
`Bot#clientVersion`) und fasst es nie wieder an. `Bot#outdated` vergleicht später den gemerkten mit
dem aktuellen Abdruck.

Warum nicht einfach die Fassungsnummer? Weil ein neuer Bau derselben Nummer daran nicht zu erkennen
wäre – und genau der ist bei einem Release, das bei jedem Push neu gebaut wird, der Normalfall.
Größe und Änderungszeit erkennen jede ausgetauschte Datei; die Nummer daneben macht den Abdruck für
Menschen lesbar.

Drei Antworten sind bewusst „nein“:

* **Nicht laufende Bots.** Sie starten ohnehin mit dem, was jetzt daliegt.
* **Kein gemerkter Abdruck.** „Weiß ich nicht“ heißt hier „nein“ – ein Neustart aus einer
  Unsicherheit heraus wirft einen Bot ohne Gegenwert aus dem Spiel.
* **Kein Automatismus.** `Supervisor#rolloutClient()` läuft nur, wenn ein Mensch darauf drückt: im
  Serverplatz (`POST /api/profiles/:id/client-update`, nur dessen Bots) oder in der Verwaltung
  (`POST /api/admin/client/rollout`, alle Konten). Beide staffeln die Neustarts – zwanzig Bots, die
  gleichzeitig beim selben Minecraft-Server anklopfen, lösen dort dieselben Schutzmaßnahmen aus wie
  ein Angriff.

Kommt beim Abgleich eine neue Fassung an, meldet das der Systembericht von sich aus, mit der Zahl
der Bots, die noch mit der alten laufen.

---

<a id="chat"></a>

## 4. Chat: von der Serverfarbe bis in den Browser

Der lange Weg einer eingefärbten Chatzeile:

```
Minecraft-Server   §e[Rang] §fSteve§r: hallo
        │           (Chat-Komponenten mit color/bold/italic)
        ▼
Client             ESC[93m[Rang] ESC[97mSteveESC[0m: hallo
        │           (ANSI – für ein Terminal genau richtig)
        ▼
supervisor.js      §e[Rang] §fSteve§r: hallo          ← ansiToMinecraft()
        │
        ├─ Chatverlauf und WebSocket: **mit** Farbcodes
        ├─ Macros: **ohne** – sonst fände "hallo" nichts mehr, sobald der Server färbt
        └─ Protokolldatei: **ohne** – wer mit grep sucht, will nicht gegen "§a" antreten
        ▼
chatlog.js         [{text:'[Rang] ', color:'#ffff55'}, {text:'Steve', color:'#ffffff'}, …]
        ▼
ui.js  mcText()    <span style="color:#ffff55">[Rang] </span><span …>Steve</span>
```

Der Client wird deshalb **ohne** `--no-color` gestartet. Vorher lief er damit, und die Farbe war
weg, bevor das Panel die Zeile überhaupt gesehen hatte.

Die Umrechnung deckt die sechzehn Minecraft-Farben, fett/kursiv/unterstrichen/durchgestrichen und
Echtfarben (`ESC[38;2;r;g;b` → `§x§r§r§g§g§b§b`) ab. Alles andere an Steuerzeichen fällt weg.

**Zusammenlegen:** Sitzen drei Konten auf demselben Server, hört jedes denselben Chat.
`chatlog.mergeLines()` legt gleiche Zeilen innerhalb von 2,5 Sekunden zusammen und merkt sich, wer
sie gehört hat – eine Zeile, die nicht alle gehört haben, ist damit als solche zu erkennen.
Dieselbe Datei benutzen Server und Browser.

---

<a id="ansichten"></a>

## 5. Ansichten: Scoreboard, Menüs, Live-Ansicht

Drei Dinge, die keine Chatzeilen sind und deshalb einen eigenen Weg nehmen (`bot.views`, WebSocket
`view`):

| Ansicht | Kommt vom Client als | Braucht |
| --- | --- | --- |
| **Scoreboard** | `@event board titel …` / `@event board zeile …` | Tarifmerkmal `board` |
| **Menü** | `@event menu open …`, `@event slot …`, `@event lore …` | Tarifmerkmal `menus` |
| **Inventar** | dieselben `@event slot`-Zeilen, aber nach `:inv` | Tarifmerkmal `menus` |
| **Live-Ansicht** | ein Raster aus Halbblöcken hinter `ESC[H` | Zusatz `pov` |
| **Live-Ansicht, texturiert** | fertige PNG vom HTTP-Viewer des Clients | Zusatz `pov` + Client-JAR |

Scoreboard und Menü behalten ihre `§`-Farbcodes bis in den Browser – dort sehen sie aus wie im
Spiel. Zahlenformate, Team-Präfixe und ausgeblendete Punktzahlen bleiben erhalten.

Für Abfragen ohne Abschlussereignis (`:board`, `:menu`, `:inv`, `:pos`) gibt es `beginCapture()`:
Die nächsten Ausgabezeilen gehören zur Abfrage und nicht in den Chat; nach zwei Sekunden Ruhe ist
der Schnappschuss fertig. **Welche Abfrage gerade läuft, entscheidet dabei mit, wohin ein Feld
gehört:** `:menu` und `:inv` schreiben beide `@event slot`-Zeilen und meinen etwas anderes – einmal
das offene Fenster des Servers, einmal das eigene Inventar.

Die texturierte Live-Ansicht ist die einzige Ansicht, die **nicht** über die Ausgabe des Clients
kommt: Seit 2.5.0 führt jeder POV-Bot einen kleinen HTTP-Viewer auf seinem Localhost, und das Panel
holt dort Bilder, Zustand und Menüs ab und reicht sie an den Browser durch. Die Datei, aus der die
Texturen stammen, liegt unter `data/mc/<version>.jar` und wird im Admin-Bereich eingerichtet
(`server/resources.js`).

Zur Live-Ansicht im Einzelnen: **[docs/live-ansicht.md](live-ansicht.md)**.

---

<a id="standorte"></a>

## 6. Standorte: wo ein Bot wirklich läuft

Ein Standort ist eine **Maschine**. Der Bot-Prozess läuft dort, verbraucht dort CPU,
Arbeitsspeicher und Platte, und der Standort meldet seine Auslastung alle 15 Sekunden ans Panel.

Der Trick am Aufbau: **der Standort ruft an**, nicht das Panel. Damit braucht ein neuer Standort
weder eine öffentliche Adresse noch ein Zertifikat noch eine Portfreigabe.

`agents.js` hält die Leitungen und stellt einen `RemoteProcess` bereit, der sich nach außen
verhält wie ein Kindprozess von `child_process`: `stdout`, `stderr`, `stdin.write`, `kill`, `exit`.
Der Supervisor merkt deshalb nicht, wo sein Bot läuft – der ganze Rest von `Bot` ist frei von der
Frage.

Ein **Proxy** ist etwas anderes: nur eine Ausgangsadresse, ohne eigene Rechenleistung. An einem
Proxy steht nie eine Auslastung, weil es dort nichts zu messen gäbe.

Alles Weitere: **[docs/standorte.md](standorte.md)**.

---

<a id="geld"></a>

## 7. Geld: Credits, Tarife, Zusätze

**1 Credit = 1 Cent**, ganzzahlig. 100 Credits sind ein Euro. Ein Monat sind hier immer **30 Tage**.

* Der **erste Serverplatz je Konto ist gratis**, solange das verknüpfte Discord-Konto Mitglied im
  konfigurierten AFKSystems-Server ist. Austritt, fehlende Verknüpfung oder ein veralteter
  Mitgliedschaftsnachweis stoppen ihn – spätestens nach der eingestellten Prüfzeit.
* Jeder weitere Platz bucht beim Anlegen den Monatspreis seines Tarifs ab und verlängert sich
  stündlich geprüft von selbst, solange das Guthaben reicht.
* Reicht es nicht, wird der Platz **stillgelegt**: Bots gehen aus, gelöscht wird nichts, ins Minus
  geht es nie. Nach dem Aufladen genügt "Fortsetzen".
* Tarifwechsel und Löschen schreiben den ungenutzten Rest des Monats anteilig gut.

**Zusätze** (`addons`) hängen an einem Serverplatz und mischen sich in den Tarif:

| Zusatz | Wirkung |
| --- | --- |
| `slot` | ein Bot mehr auf diesem Platz (mehrfach buchbar) |
| `menus` | Menüs bedienen – in Ultra enthalten, auf Premium dazubuchbar |
| `pov` | Live-Ansicht – je Serverplatz, in keinem Tarif enthalten |

Gerechnet wird anteilig: beim Buchen der Rest der laufenden Periode, beim Abbestellen kommt er
zurück. Ab der nächsten Verlängerung steckt der Zusatz im Monatspreis. Auf dem Gratis-Platz gibt
es keine.

**Aufladen** geht auf vier Wegen: Stripe (Karte, PayPal und alles Weitere), Gutschein, Überweisung
oder PayPal von Hand (der Admin bestätigt), oder der Admin bucht direkt auf. Guthaben entsteht an
genau einer Stelle im Code: `billing.settleTopup()`.

Anders als beim vorherigen Anbieter ist Stripe **kein Verkäufer im eigenen Namen**: Verkäufer ist
der Betreiber selbst. Preis, Beleg und Umsatzsteuer kommen deshalb aus diesem Panel – `vat.js`
sagt für alle Zahlarten denselben Satz, `mail.js` schickt den Beleg.

Zu Stripe im Einzelnen: **[docs/stripe.md](stripe.md)**.

---

<a id="faehigkeiten"></a>

## 8. Was ein Serverplatz kann – die eine Rechnung

> **Tarif ∩ Zusätze ∩ Client**

Diese Rechnung steht an genau einer Stelle:

* `billing.featuresOf(profile)` – mischt Tarif und gebuchte Zusätze zu einem Merkmalssatz.
* `billing.gateCaps(clientCaps, features)` – schneidet das auf das zu, was die Client-Datei
  hergibt.

Alles andere fragt dort nach: welche Reiter das Panel zeigt (`tabsFor`), welche örtlichen Befehle
erlaubt sind (`LOCAL_VERBS` + `bot.caps`), welche Startargumente gesetzt werden (`Bot#args`),
welche Einträge auf `/features` stehen (`features.js`).

Die Zuordnung "Fähigkeit → Tarifmerkmal" steht in `CAP_GATES` (`server/billing.js`):

```
local → movement      board → board       proxy    → proxy
movement → movement   menu  → menus       fakehost → fakehost
sneak → premium       items → menus       offline  → offline_accounts
antiafk → premium     pov   → pov
premium → premium
```

Ohne diese Tabelle hätte jeder mit dem Premium-Client automatisch auch Scoreboard und Menüs, und
zwischen Premium und Ultra bliebe kein Unterschied.

---

<a id="konten"></a>

## 9. Konten, Anmeldung, Sitzungen

**Panel-Konten:** E-Mail und Passwort (scrypt, `server/util.js`), oder Anmeldung über Discord bzw.
Google (`server/oauth.js` – ein Modul für beide). Wer sich über einen Anbieter anmeldet und noch
kein Konto hat, bekommt eines; die Adresse kommt vom Anbieter.

Sitzungen liegen in der Tabelle `sessions` und im HttpOnly-Cookie `afk_session`. Der Nutzer sieht
seine offenen Sitzungen in den Einstellungen mit Gerät, Adresse und Zeitpunkt und kann sie einzeln
beenden. **Das Token reist dabei nicht in den Browser** – die Liste nennt statt seiner einen
Kurzabdruck (`sha256`, 16 Zeichen). Ein Token *ist* die Anmeldung; eine Seite, die alle Token eines
Kontos im Speicher hält, verschenkt bei der ersten Lücke gleich jedes Gerät mit. Daneben stehen die
letzten Anmeldeversuche an diesem Konto, die geglückten wie die gescheiterten.

**Was über den Anmeldenamen hinausgeht** – Anzeigename/bürgerlicher Name, Firmierung, USt-IdNr., Anschrift,
Telefon, Zeitzone – steht in denselben Spalten von `users` und wird an genau einer Stelle geprüft
(`server/profile.js`). Dieselbe Prüfung gilt für den Kunden, für die Verwaltung, für den Beleg und
für die Bezahlseite; läge sie in der Route, hätten die anderen drei Stellen keine.

Zwei Änderungen am Konto sind Abläufe und keine Formularfelder:

* **Der Benutzername** hat eine Sperrfrist von 30 Tagen und bleibt die eindeutige Anmeldekennung.
  Im Panel, in Tickets und E-Mails steht dagegen der selbst eingetragene Anzeigename, danach der
  Name aus Discord/Google und nur als Rückfall der Benutzername.
* **Die E-Mail-Adresse** wird beantragt und nicht gesetzt: Passwort bestätigen, dann geht ein Link
  an die **neue** Adresse und eine Warnung an die alte. Bis zur Bestätigung gilt die alte weiter
  (`users.pending_email`), sonst sperrte ein Tippfehler das Konto aus.

**Minecraft-Köpfe** kommen über diesen Server (`server/heads.js`, `/api/heads/<name>.png`) und
nicht aus dem Browser des Kunden. Vorher stand die Adresse des Skin-Dienstes direkt im `src`, und
damit schickte jeder Kunde bei jedem Seitenaufruf den Namen seines Minecraft-Kontos und seine
IP-Adresse zu einem Fremden – während ein paar Zeilen weiter Gravatar ausdrücklich nur einen
Abdruck bekommt. Der Server holt das Bild einmal, legt es unter `data/heads/` ab und liefert es
fortan von dort; ist der Skin-Dienst aus, kommt der alte Kopf aus dem Zwischenspeicher und im
Zweifel eine ruhige graue Fläche statt eines zerbrochenen Bildsymbols. `img-src` in der
Content-Security-Policy nennt den fremden Host seither nicht mehr.

Profilbilder folgen derselben eindeutigen Rangfolge: automatisch Discord, Google, Gravatar; in den
Einstellungen lässt sich eine Quelle fest anheften oder mit „Initialen“ ganz abschalten. Google-
Name und -Bild werden beim OAuth-Abgleich mit aktualisiert. Gravatar bekommt nur den üblichen
MD5-Abdruck der normalisierten E-Mail-Adresse, nie die Adresse als Klartext.

### Die Zwei-Faktor-Anmeldung

`server/totp.js` ist der zweite Faktor, der der Anmeldecode weiter unten ausdrücklich nicht ist.
Sechs Ziffern nach RFC 6238: HMAC-SHA1 über die Nummer des laufenden Dreißig-Sekunden-Fensters,
Geheimnis als zwanzig zufällige Byte in Base32, Toleranz ein Fenster nach jeder Seite.

Drei Entscheidungen tragen die ganze Funktion:

* **Das Geheimnis liegt verschlüsselt in der Datenbank** (AES-256-GCM, Schlüssel per HKDF aus
  `config.secret`). Nicht wegen des laufenden Betriebs – wer die Datei lesen kann, kommt meist
  auch an den Schlüssel –, sondern wegen der Sicherungen: Die lassen sich im Panel herunterladen
  und liegen danach irgendwo. Gehasht werden kann es nicht, denn der Wert wird im Klartext
  gebraucht, um zu rechnen.
* **Ein Zeitfenster gilt einmal.** `users.totp_last_counter` merkt sich das zuletzt eingelöste;
  ein Code aus demselben oder einem älteren Fenster wird abgelehnt. Ohne das wäre ein
  abgefangener Code dreißig Sekunden lang ein zweiter Zugang, und dreißig Sekunden reichen.
* **Sie gilt an allen drei Türen** – Passwort, Anbieter-Anmeldung, Zurücksetzen des Passworts.
  Die dritte ist die eigentliche: Ohne sie bliebe der Postfachzugang ein Generalschlüssel, und
  die Zwei-Faktor-Anmeldung wäre genau die Behauptung, die der Anmeldecode zu Recht vermeidet.

Der zweite Schritt benutzt dieselbe Wartemarke wie der Anmeldecode (`login_challenges`,
unterschieden durch die Spalte `kind`). Beim Anmelden mit Passwort reist sie im Rumpf der
Antwort; vom Rückweg aus Discord oder Google gibt es keinen Rumpf, dort liegt sie fünfzehn
Minuten lang in einem eigenen HttpOnly-Cookie `afk_login` – **nicht** in der Adresse, denn die
steht im Verlauf, im Referrer und in jedem Protokoll dazwischen.

**Wiederherstellungscodes** sind zehn Zeichenketten, als scrypt-Hash gespeichert wie ein
Passwort, jede genau einmal einlösbar. Ohne sie wäre ein verlorenes Telefon ein verlorenes Konto
und die einzige Rettung ein Administrator, der die Zwei-Faktor-Anmeldung auf Zuruf abschaltet –
womit ein Anruf der zweite Faktor wäre.

Den QR-Code zeichnet `server/qr.js`: Byte-Modus, Fehlerkorrektur M, Fassungen 1 bis 10, ohne
Abhängigkeit, als SVG im selben Antwortkörper wie das Geheimnis. Er wurde Modul für Modul gegen
eine fremde Erzeugung geprüft; vier Bilder stehen als feste Vorlage im Test.

### Der Anmeldecode und die bekannten Browser

`server/logincode.js` macht aus einer Anmeldung zwei Schritte, sobald der Browser neu ist. Der
erste Schritt bleibt, was er war: `POST /api/auth/login` prüft das Passwort. Nur legt er dann keine
Sitzung an, sondern gibt eine **Wartemarke** zurück – sechs Ziffern gehen per E-Mail hinaus, und
erst `POST /api/auth/login/code` meldet an. Der Code liegt als scrypt-Hash in `login_challenges`,
gilt fünfzehn Minuten und verträgt fünf Versuche.

Was das leistet und was nicht, steht auch so im Panel: Ein gestohlenes Passwort allein reicht nicht
mehr. Ein zweiter Faktor ist es trotzdem nicht – der Code geht an dieselbe Adresse, über die auch
„Passwort vergessen“ läuft, und wer das Postfach hat, kam schon immer ins Konto. Ein Häkchen, das
„Zwei-Faktor“ verspricht und dann eine E-Mail schickt, wäre eine Behauptung, die nicht stimmt.

**Woran „neuer Browser“ hängt.** Nicht an der Browserkennung. Die war aus zwei Richtungen falsch:
„Chrome auf Windows“ schicken Millionen zeichengleich (ein Fremder mit dem Passwort galt damit als
bekannt), und sie ändert sich bei jeder Aktualisierung des Browsers (dasselbe Gerät wäre nach jedem
Chrome-Update wieder fremd). Stattdessen steht ein Zufallswert in einem eigenen, 400 Tage
langlebigen Cookie `afk_device`, und `known_devices` sagt, für welche Konten dieser Wert schon
einmal durchgekommen ist. Das Cookie ist **kein Zugang**: Wer es stiehlt, hat die Auskunft, dass
dieser Browser bekannt ist, und sonst nichts.

`auth.noticeNewDevice()` hängt seither an derselben Auskunft – sonst hieße „neues Gerät“ im Panel
zweierlei.

Vier Bedingungen, und jede einzelne ist ein Nein: Der Kontoinhaber muss den Code wollen
(`users.login_code`, Vorgabe **an**), es muss einen Postausgang geben, die Adresse des Kontos muss
bestätigt sein, und der Browser darf nicht bekannt sein. **Und selbst dann sperrt er niemanden
aus:** Geht die Nachricht nicht hinaus (ein fremder Mailserver antwortet nicht), gibt
`logincode.start()` ein `null` zurück und die Anmeldung läuft ganz normal durch – das Passwort war
ja richtig. Der Fehlschlag steht im Protokoll und in `audit`.

Vier Wege melden ohne Code an und merken sich den Browser trotzdem: Registrierung, Discord, Google
und der Bestätigungslink aus der Registrierungsmail. Bei allen vieren wurde mehr vorgewiesen als ein
Passwort. Alle fünf Anmeldewege laufen deshalb durch **eine** Funktion (`signIn` in
`routes/core.js`) – eine vergessene Zeile in einem von fünf wäre nicht aufgefallen: Der Weg
funktioniert ja, er merkt sich nur das Gerät nicht, und der Kunde bekäme fortan bei jeder Anmeldung
einen Code.

Ein **Passwortwechsel und ein Zurücksetzen vergessen alle bekannten Browser**. Der Grund ist
derselbe wie beim Wechsel selbst: Wer ihn vornimmt, glaubt oft, jemand anderes kenne das alte
Passwort – und der sitzt vielleicht an einem Browser, der bis eben als bekannt geführt wurde. Der
eigene ist mit dabei und wird gleich wieder gemerkt, weil er sich in derselben Anfrage belegt hat.

**Ein Konto lässt sich mitnehmen und loswerden** (`server/account.js`): `GET /api/me/export` gibt
alles als JSON-Datei heraus – ohne Passwort-Hash, Token und Bestätigungsmarken, denn das sind
Schlüssel und keine Auskunft. `POST /api/me/delete` merkt das Konto zur Löschung vor: 14 Tage
Frist, die Bots gehen sofort aus (der Supervisor lehnt jeden Start ab, solange `delete_due_at`
steht), und ein Klick holt alles zurück. Nach Ablauf löscht die stündliche Aufgabe das Konto samt
allem, was per `ON DELETE CASCADE` daran hängt, dazu die Dateien unter `data/users/<id>` und die
Bot-Protokolle.

**Minecraft-Konten:** Die Anmeldung läuft über den Microsoft-Gerätecode (`server/mslogin.js`). Das
Passwort gibt der Kunde bei Microsoft ein, nicht bei uns. Was gespeichert wird, ist eine
Token-Datei je Konto unter `data/users/<nutzer>/afksystems/accounts/<name>.json` – dieselbe Datei,
die der Client liest.

Läuft der Bot auf einem Standort, reist diese Datei mit und kommt zurück, wenn der Client den
Token aufgefrischt hat. Ohne das müsste dasselbe Konto auf jedem Standort einzeln verbunden werden.

**Offline-Konten** (ohne Microsoft) gibt es ab einem bezahlten Serverplatz und nur auf Servern
ohne Kontoprüfung.

---

<a id="discord"></a>

## 10. Discord

Zwei Dinge, die unabhängig voneinander laufen:

* **Anmelden und Verknüpfen** (`server/oauth.js`) – braucht nur Client-ID und Secret.
* **Der Bot** (`bot/`) – ein eigener Dienst. Tickets laufen in beide Richtungen, Rollen folgen dem
  Tarif. Er hat keine eigene Konfiguration: Server-ID, Kanäle, Rollen und sein Token holt er sich
  beim Start aus dem Panel.

Die Leitung dazwischen ist `server/bridge.js` ↔ `bot/panel.js`, ein WebSocket unter
`/api/bot/stream` mit gemeinsamem Geheimnis.

**Erwähnungen.** Discord verschickt sie als Zahlen (`<@1538…>`, `<#1538…>`, `<@&1538…>`). Welcher
Name dazugehört, weiß nur, wer den Server sieht – der Bot löst es beim Übernehmen einer Nachricht
auf und schickt die Zuordnung mit; sie liegt danach an der Nachricht (`ticket_messages.mentions`)
und nicht in einem Verzeichnis, das jemand aktuell halten müsste. Ein Kanal, der später umbenannt
wird, ändert damit den Verlauf nicht. Fehlt die ID im Ereignis-Cache, lädt der Bot Person, Rolle
oder Kanal gezielt über Discord nach; nur wirklich gelöschte/unsichtbare Ziele bleiben unbekannt.
Gerendert wird in `public/assets/js/discord.js`: Erwähnungen,
eigene Emoji, Zeitstempel und die üblichen Auszeichnungen. Text kommt dort durch genau eine Tür ins
HTML (`escapeHtml`); alles andere wird vorher herausgenommen und als selbst gebautes Stück wieder
eingesetzt.

**Der Webhook des Betreibers** (`discord_system_webhook`) meldet **keine Tickets** mehr, sondern den
Zustand der Anlage: einen Lagebericht im Takt und Warnungen sofort (`server/systemreport.js`). Ein
Ticket steht ohnehin schon im Panel und in seinem eigenen Kanal; die dritte Kopie hat den Kanal nur
unlesbar gemacht.

Anleitung: **[docs/discord-bot.md](discord-bot.md)**.

---

<a id="datenbank"></a>

## 11. Die Datenbank

SQLite (`better-sqlite3`), eine Datei: `data/afksystems.db`. Synchron, ohne Verbindungspool, ohne
ORM. Bei dieser Größe ist das schneller als alles mit Netzwerk dazwischen und deutlich einfacher zu
sichern.

Die wichtigsten Tabellen:

| Tabelle | Inhalt |
| --- | --- |
| `users` | Konten, Guthaben, Rolle, Discord-/Google-Verknüpfung, E-Mail-Wünsche, Name und Rechnungsadresse, Zeitzone, Anmeldecode (`login_code`), Zwei-Faktor-Geheimnis (`totp_secret`, verschlüsselt), angemeldete Löschung |
| `sessions` | offene Anmeldungen |
| `known_devices` | Browser, die den Anmeldecode schon beantwortet haben. Schlüssel ist der Zufallswert aus dem Cookie `afk_device`, nicht die Browserkennung |
| `login_challenges` | offene Wartemarken der Anmeldung: der Anmeldecode als scrypt-Hash oder der zweite Schritt der Zwei-Faktor-Anmeldung (Spalte `kind`), mit Frist und Versuchszähler |
| `recovery_codes` | die zehn Wiederherstellungscodes je Konto, als scrypt-Hash, jeder einmal einlösbar |
| `profiles` | Serverplätze: Adresse, Version, Tarif, Standort, Laufzeit, freie Notiz des Kunden |
| `mc_accounts` | Minecraft-Konten je Nutzer |
| `profile_accounts` | welches Konto auf welchem Platz sitzt (und ob es laufen soll) |
| `bots` | Laufzeit-Statistik je Kombination |
| `plans` / `addons` / `profile_addons` | Tarife und Zusätze |
| `ledger` / `topups` / `vouchers` | jede Guthabenbewegung, Aufladungen, Gutscheine; an der Aufladung hängt der Beleg (Nummer, Anschrift von damals, Steuerhinweis von damals) |
| `nodes` / `node_users` | Standorte samt Token, Grenzen und letztem Zustand |
| `proxies` | Ausgangsadressen |
| `macros` / `spam` | Automatik je Serverplatz; an einem Macro hängen Sperrzeit (`cooldown_sec`) und Wahrscheinlichkeit (`chance`) |
| `tickets` / `ticket_messages` / `ticket_users` | Support; `ticket_messages.mentions` löst die Discord-Zahlen zu Namen auf |
| `profile_schedules` | Zeitpläne je Serverplatz: Uhrzeit, Wochentage, Aktion |
| `mails` | jede verschickte Nachricht, mit Wortlaut |
| `settings` | alles, was der Admin im Panel einstellt |
| `audit` | wer was wann getan hat |

**Migrationen** stehen in `server/db.js` als nummerierte Einträge mit `sql` und/oder `run()`. Sie
laufen beim Start, jede genau einmal, in einer Transaktion. Es gibt kein Zurück – ein Rückbau wäre
eine neue Migration.

### Zwei Dinge, die man beim Schreiben von Abfragen wissen sollte

**`db.prepare(sql)` gibt dasselbe Statement zurück, wenn der Text derselbe ist.** SQL zu übersetzen
kostet, und `db.prepare(...)` steht im Panel überall dort, wo die Abfrage gebraucht wird – im Profil
des laufenden Dienstes war das Übersetzen der größte Einzelposten der Serverzeit. Ein geteiltes
Statement ist unbedenklich, solange nur `.get()`, `.all()` und `.run()` benutzt werden; die tragen
keinen Zustand von einem Aufruf zum nächsten. `.iterate()` täte es (ein halb gelesener Cursor),
und `.pluck()`, `.raw()` und `.expand()` schalten das Statement dauerhaft um und träfen damit auch
den nächsten Aufrufer. Wer eines davon braucht, baut sein Statement mit `prepareOnce(sql)`.

**`cached(fn)` merkt sich ein Ergebnis, bis irgendwo geschrieben wird.** Damit stehen die Tarife,
die Zusätze und die Einstellungen im Speicher statt in dutzenden Abfragen je Seitenaufruf. Wann der
gemerkte Wert wegfällt, entscheidet SQLite und keine Liste von Stellen, die sich melden müssen:
`total_changes()` zählt, was diese Verbindung geschrieben hat, `PRAGMA data_version` ändert sich,
wenn eine **andere** Verbindung etwas festgeschrieben hat – und die gibt es wirklich, `npm run
admin:credits` ist eine. Beide zusammen decken jeden Schreibvorgang ab, also kann der
Zwischenspeicher nicht veralten; er wird nur öfter neu gebaut als nötig, und das kostet eine
Abfrage über drei Zeilen. Der zurückgegebene Wert wird geteilt: lesen, nicht verändern.

---

<a id="oberflaeche"></a>

## 12. Die Weboberfläche

Kein Bauschritt, kein Framework. ES-Module, die der Browser direkt lädt.

```
public/
  pages/            die festen Seiten als Vorlagen ({{> partial}} und {{schluessel}})
  assets/js/
    app.js          Dashboard: Rahmen, Seitenleiste, Router, WebSocket
    ui.js           Symbole, API-Aufrufe, Meldungen, Aussehen
    i18n.js         alle Texte, beide Sprachen – die Quelle für Server und Browser
    chatlog.js      Chatzeilen zusammenlegen, §-Farben zerlegen – ebenfalls von beiden
    countries.js    die Länder der Rechnungsadresse – ebenfalls von beiden
    discord.js      Discord-Nachrichten als HTML: Erwähnungen mit Namen statt Zahlen
    shield.js       Inhaltsschutz (docs/schutz.md)
    views/          Übersicht, Konten, Server, Guthaben, Tickets, Proxys, Admin
  assets/css/app.css
```

**Adressen mit Fingerabdruck:** `/assets/v/<hash>/css/app.css`. Der Hash steht über allem unter
`public/assets`; ändert sich eine Datei, ändert sich die Adresse. Erst damit darf man lange cachen,
ohne dass nach einem Deployment neues HTML auf altes CSS trifft.

**Vorgepackt statt bei jeder Anfrage gepackt.** `deploy/install.sh` minimiert die Frontend-Dateien
und legt zu jeder eine Brotli- und eine gzip-Fassung daneben (`app.css.br`, `app.css.gz` – siehe
`scripts/protect-assets.mjs` und `server/assets.js`). Der Server liefert die passende aus, statt zu
komprimieren. Weil das Packen damit einmal beim Ausrollen passiert und nicht bei jedem Besucher,
darf es gründlich sein: Das Stylesheet geht mit 16 kB über die Leitung statt mit 20, und der Server
verbraucht dafür keine Rechenzeit mehr. Gibt es die gepackten Dateien nicht (Entwicklung), läuft
alles wie zuvor über `compression`.

**Der Modulbaum steht im `<head>`.** Ein Browser findet ein Modul erst, wenn er das gelesen hat,
das es importiert – app.js, daraus ui.js, daraus die Texte: drei Runden hintereinander, die größte
Datei zuletzt. `pages.preload()` nennt den Baum deshalb vollständig als `modulepreload`, und alles
lädt nebeneinander. Genannt wird nur, was für das erste Bild nötig ist; die Ansichten unter
`views/` holt app.js weiterhin erst, wenn jemand hinsieht.

**Die Seitenleiste** (`app.js`, Abschnitt *Seitenleiste*) ist ein Raster aus drei Zeilen: Kopf mit
Marke und Suchfeld, scrollende Mitte, stehender Fuß mit Guthaben und Konto. Das Suchfeld filtert
alles, was einen Namen hat – Navigationspunkte, Serverplätze, deren Reiter, jeden Punkt der
Administration. Bei dreißig Einträgen ist Tippen schneller als Aufklappen.

**Live** kommt über einen WebSocket (`/api/ws`): Chatzeilen, Zustandswechsel, Ansichten,
Ticketnachrichten, Guthabenänderungen. Jede Ansicht darf sich über `state.onLive` dafür anmelden;
beim Wechsel wird die Anmeldung zurückgesetzt.

---

<a id="sprachen"></a>

## 13. Zwei Sprachen

Englisch ist die Hauptsprache, Deutsch die zweite. Beide sind echte Adressen: `/en/…` und `/de/…`.

Alle sichtbaren Texte stehen in **einer** Datei: `public/assets/js/i18n.js`, jeder Text in beiden
Sprachen nebeneinander. Node rendert daraus die festen Seiten, und Fehlermeldungen der API kommen
in derselben Sprache zurück (`HttpError` trägt beide Fassungen).

**Der Browser bekommt nur eine Sprache.** Beide zu laden hieße rund tausendvierhundert Schlüssel
doppelt – hundertdreißig Kilobyte JavaScript, das größte Stück auf dem Weg zum ersten Bild, und die
Hälfte davon ungelesen. `server/strings.js` rechnet beim Hochfahren aus derselben Tabelle je Sprache
ein eigenes Modul und liefert es unter `/assets/v/<hash>/js/i18n.<sprache>.js` aus; welches gilt,
steht als `data-strings` am `<html>`, und `ui.js` lädt genau das.

Wer einen Text ändert, ändert also weiterhin nur `i18n.js` – es gibt keine erzeugte Datei im
Projekt und keinen Bauschritt, der vergessen werden könnte. Das `t()` im Browser nimmt deshalb
**keine** Sprache mehr entgegen: Dort gibt es nur eine, und ein Wechsel lädt die Seite neu.

Gemerkt wird die Sprache im Browser (`localStorage['afk-lang']`) und im Cookie `lang`, das der
Server liest. Beim allerersten Besuch entscheidet `Accept-Language`. Angemeldete Konten speichern
sie zusätzlich am Konto – das entscheidet, in welcher Sprache E-Mails kommen.

---

<a id="betrieb"></a>

## 14. Betrieb, Sicherung, Aktualisierung

### Ausrollen

```bash
sudo ./deploy/install.sh
```

Kopiert nach `/opt/afksystems` (ohne `data/`), installiert Abhängigkeiten, minimiert die
Frontend-Dateien und legt zu jeder eine gepackte Fassung daneben, schreibt die systemd-Units,
richtet nginx ein und startet neu.

### Sichern

Die Datenbank ist eine Datei – aber eine, in die gerade geschrieben wird. Kopieren mit `cp` erwischt
deshalb im besten Fall eine Datei ohne die letzten Buchungen. Das Panel sichert sie selbst: einmal
am Tag nach `data/backups/`, dazu ein Knopf unter *Administration → System*
([verwaltung.md, Abschnitt 5](verwaltung.md#sicherungen)). Von Hand geht es genauso:

```bash
sqlite3 /opt/afksystems/data/afksystems.db ".backup '/pfad/sicherung.db'"
```

Dazu gehört `data/users/` (die Microsoft-Anmeldungen). Ohne die müssten alle Konten neu verbunden
werden – und weil sie in keine Sicherung aus dem Browser gehören, bleiben sie dort auch draußen.

### Nachsehen

```bash
systemctl status afksystems
journalctl -u afksystems -f
curl -s localhost:3010/api/health
```

`/api/health` sagt Laufzeit, Zahl der laufenden Bots und die Client-Version – aber nur, wenn die
Frage von dieser Maschine kommt oder eine Administratorsitzung dahintersteht. Von außen antwortet
die Adresse mit `{"ok":true}` und sonst nichts: Ob der Dienst läuft, darf jeder wissen; wie viele
Bots gerade laufen und seit wann der Prozess steht, geht niemanden außerhalb etwas an.

### Zeitgeber

Sie stehen als Verzeichnis in `server/jobs.js` und nicht als anonyme Intervalle: Name, Takt,
letzter Lauf, Dauer und letzter Fehler sind unter *Administration → Betrieb* nachzulesen, und die
meisten lassen sich von dort auch sofort anstoßen.

| Takt | Aufgabe | Was |
| --- | --- | --- |
| stündlich | `abrechnung` | Verlängerungen, Warnungen, Suspendierungen |
| stündlich | `aufraeumen` | abgelaufene Sitzungen, alte Anmeldeversuche, Anhänge, tägliche Sicherung, Client-Release |
| jede Minute | `gratis-plaetze` | Gratis-Plätze gegen die Discord-Mitgliedschaft prüfen |
| jede Minute | `wiederanlauf` | hochfahren, was laufen soll und gerade nicht läuft |
| jede Minute | `zeitplaene` | Zeitpläne der Serverplätze ausführen, in der Zeitzone des Kontos |
| alle 5 Minuten | `systembericht` | Warnungen prüfen, den Lagebericht im eingestellten Takt schicken |
| stündlich | `kontoloeschungen` | Konten löschen, deren Frist abgelaufen ist |
| alle 30 Sekunden | `verbindungen` | tote WebSockets aussortieren, Standorte anpingen |
| alle 15 Sekunden | `standort-eigen` | eigenen Maschinenzustand messen |

Ein Fehler in einer dieser Aufgaben kostet höchstens einen Durchlauf. Sie laufen ohne Aufrufer, und
eine unbehandelte Ausnahme beendete in Node den Prozess – mit ihm jeden laufenden Bot.

### Was wo liegt

```
/opt/afksystems/            die laufende Fassung
  data/afksystems.db        die Datenbank
  data/backups/             die täglichen Sicherungen davon
  data/bin/                 die Client-Dateien
  data/mc/                  die Minecraft-Ressourcen (eine JAR je Version)
  data/heads/               die Minecraft-Köpfe, einmal geholt (server/heads.js)
  data/users/<id>/          die Microsoft-Anmeldungen
  data/logs/                ein Protokoll je Bot (wird bei 5 MB umgelegt)
  .env                      Umgebung (Port, GitHub-Token, Bankdaten)
```

Alles Einstellbare steht **nicht** in der `.env`, sondern in der Tabelle `settings` und damit im
Admin-Bereich: SMTP, Discord, Google, Stripe, Umsatzsteuer, Grenzen, Rechtstexte, Inhaltsschutz.

Bei den Rechtstexten gibt es eine Ausnahme von der Regel „leer heißt Systemvorgabe“: Das Impressum
hat keine Vorgabe, weil ein Impressum aus Namen und Anschrift eines Bestimmten besteht. Leer heißt
dort: `landing.js` setzt es aus den Verkäuferangaben zusammen (siehe README), und fehlen auch die,
sagt die Seite das statt einen Rest zu zeigen.
