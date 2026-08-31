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
Fehlerstatus. Das Panel respektiert das: kein versteckter Neustart, sondern `wanted = 0` und ein
sichtbarer Zustand. Nur ein vom Server angeordneter Transfer auf einen Unterserver bleibt Teil
derselben Sitzung – den befolgt der Client selbst.

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
mit (`--pov-web`), der aus der Original-Client-JAR von Minecraft zeichnet (`--pov-resources`).

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
seine offenen Sitzungen in den Einstellungen und kann sie einzeln beenden.

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
| `users` | Konten, Guthaben, Rolle, Discord-/Google-Verknüpfung, E-Mail-Wünsche |
| `sessions` | offene Anmeldungen |
| `profiles` | Serverplätze: Adresse, Version, Tarif, Standort, Laufzeit |
| `mc_accounts` | Minecraft-Konten je Nutzer |
| `profile_accounts` | welches Konto auf welchem Platz sitzt (und ob es laufen soll) |
| `bots` | Laufzeit-Statistik je Kombination |
| `plans` / `addons` / `profile_addons` | Tarife und Zusätze |
| `ledger` / `topups` / `vouchers` | jede Guthabenbewegung, Aufladungen, Gutscheine |
| `nodes` / `node_users` | Standorte samt Token, Grenzen und letztem Zustand |
| `proxies` | Ausgangsadressen |
| `macros` / `spam` | Automatik je Serverplatz |
| `tickets` / `ticket_messages` / `ticket_users` | Support |
| `mails` | jede verschickte Nachricht, mit Wortlaut |
| `settings` | alles, was der Admin im Panel einstellt |
| `audit` | wer was wann getan hat |

**Migrationen** stehen in `server/db.js` als nummerierte Einträge mit `sql` und/oder `run()`. Sie
laufen beim Start, jede genau einmal, in einer Transaktion. Es gibt kein Zurück – ein Rückbau wäre
eine neue Migration.

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
    i18n.js         alle Texte, beide Sprachen – von Server und Browser genutzt
    chatlog.js      Chatzeilen zusammenlegen, §-Farben zerlegen – ebenfalls von beiden
    shield.js       Inhaltsschutz (docs/schutz.md)
    views/          Übersicht, Konten, Server, Guthaben, Tickets, Proxys, Admin
  assets/css/app.css
```

**Adressen mit Fingerabdruck:** `/assets/v/<hash>/css/app.css`. Der Hash steht über allem unter
`public/assets`; ändert sich eine Datei, ändert sich die Adresse. Erst damit darf man lange cachen,
ohne dass nach einem Deployment neues HTML auf altes CSS trifft.

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

Alle sichtbaren Texte stehen in **einer** Datei: `public/assets/js/i18n.js`. Node rendert daraus
die festen Seiten, der Browser das Dashboard, und Fehlermeldungen der API kommen in derselben
Sprache zurück (`HttpError` trägt beide Fassungen).

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
Frontend-Dateien, schreibt die systemd-Units, richtet nginx ein und startet neu.

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

`/api/health` sagt Laufzeit, Zahl der laufenden Bots und die Client-Version.

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
  data/users/<id>/          die Microsoft-Anmeldungen
  data/logs/                ein Protokoll je Bot (wird bei 5 MB umgelegt)
  .env                      Umgebung (Port, GitHub-Token, Bankdaten)
```

Alles Einstellbare steht **nicht** in der `.env`, sondern in der Tabelle `settings` und damit im
Admin-Bereich: SMTP, Discord, Google, Stripe, Umsatzsteuer, Grenzen, Rechtstexte, Inhaltsschutz.
