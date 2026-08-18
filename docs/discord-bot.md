# Der Discord-Bot einrichten

Der Bot verbindet Discord mit dem Panel: Tickets laufen an beiden Stellen als **ein** Vorgang, und
Rollen folgen dem Tarif von selbst.

Er hat **keine eigene Konfiguration**. Server-ID, Kanäle, Rollen und sogar sein Token holt er sich
beim Start aus dem Panel. In seiner `.env` steht nur, wo das Panel steht und wie er sich dort
ausweist – deshalb lässt er sich später ohne Änderung nach Featherpanel umziehen.

---

## 1. Anwendung bei Discord anlegen

1. <https://discord.com/developers/applications> → **New Application** → Name `AFKSystems`.
2. **General Information**
   * **Application ID** kopieren → im Panel unter *Administration → Einstellungen → Discord* als
     **Anwendungs-ID** eintragen.
   * Als **App Icon** das Logo hochladen (`public/assets/img/logo-256.png`).
3. **OAuth2**
   * **Client Secret → Reset Secret**, kopieren → im Panel als **Client Secret** eintragen.
   * Unter **Redirects** eintragen:
     ```
     https://example.invalid/api/auth/discord/callback
     ```
   * Unter **Linked Roles Verification URL** eintragen:
     ```
     https://example.invalid/api/auth/discord/start?mode=verify
     ```
4. **Bot**
   * **Reset Token**, kopieren → im Panel als **Bot-Token** eintragen.
   * **Privileged Gateway Intents**: **Server Members Intent** und **Message Content Intent**
     einschalten. Ohne das erste vergibt der Bot keine Rollen, ohne das zweite kommen Nachrichten
     aus Ticket-Kanälen leer im Panel an.

## 2. Bot auf den Server einladen

Adresse zusammensetzen (`<APP-ID>` ersetzen) und im Browser öffnen:

```
https://discord.com/oauth2/authorize?client_id=<APP-ID>&scope=bot%20applications.commands&permissions=286261776
```

Die Zahl enthält: Kanäle verwalten, Kanäle sehen, Nachrichten senden, Verlauf lesen, Nachrichten
anheften, Reaktionen setzen, Rollen verwalten.

**Wichtig:** In Discord unter *Servereinstellungen → Rollen* die Bot-Rolle **über** alle Rollen
ziehen, die er vergeben soll. Discord lässt niemanden eine Rolle vergeben, die über der eigenen
steht – der Bot meldet das dann als „Missing Permissions“.

## 3. IDs im Panel eintragen

Entwicklermodus in Discord einschalten: *Einstellungen → Erweitert → Entwicklermodus*. Danach
Rechtsklick auf Server, Kanal oder Rolle → **ID kopieren**.

Unter *Administration → Einstellungen → Discord* und *→ Discord-Rollen*:

| Feld | Was hinein gehört |
| --- | --- |
| Server-ID | Rechtsklick auf das Server-Symbol |
| Kanal für den Ticket-Knopf | der Kanal, in dem die Nachricht mit dem Knopf stehen soll |
| Kategorie für Ticket-Kanäle | die Kategorie, unter der die Ticket-Kanäle entstehen |
| Einladungslink | `https://discord.gg/…` – steht danach auf der Website |
| Geheimnis Panel ↔ Bot | mindestens 24 zufällige Zeichen (siehe unten) |
| Pflichtserver für den Gratis-Tarif | `000000000000000000` – nur Mitglieder dürfen den Gratis-Platz starten |
| Customer | normale Rolle für jedes verknüpfte Konto |
| Premium / Ultra | Rollen für die Tarife |
| Partner / VIP | normale Rollen, die im Benutzerprofil vergeben werden |
| Administrator / Discord Moderator | Discord Linked Roles; Discord vergibt sie nach der Verknüpfung anhand des Benutzerprofils |
| Team | normale Rolle; der Bot vergibt sie automatisch an Admins und Discord-Mods |

Für das Geheimnis:

```bash
openssl rand -base64 36
```

Dieselbe Zeichenkette kommt gleich in die `.env` des Bots. Ohne sie redet das Panel nicht mit ihm.

**Kurz ist hier gefährlich.** Hinter diesem einen Wort liegt der gesamte Bot-Bereich: der
Discord-Token, jedes Ticket samt Verlauf und die Discord-IDs aller verknüpften Konten. Das Panel
nimmt deshalb nichts unter 24 Zeichen an und lässt einen zu kurz eingetragenen Wert gar nicht
gelten – lieber ein Bot, der meldet, dass er nicht hereinkommt, als eine Tür, die jeder aufbekommt.
Falsche Versuche werden zusätzlich gebremst (20 je Adresse und Viertelstunde).

> Ein Tarif kann eine **eigene** Rolle bekommen: *Administration → Tarife → Bearbeiten →
> Discord-Rolle*. Steht dort etwas, gilt sie statt Premium/Ultra. So braucht ein neuer Tarif keine
> Codeänderung.

## 4. Bot starten

```bash
cd /opt/afksystems/bot
cp .env.example .env
nano .env          # PANEL_URL und PANEL_SECRET eintragen
npm install --omit=dev
npm start
```

Beim ersten Start sollte im Protokoll stehen:

```
[discord] signed in as AFKSystems#1234
[discord] commands registered
[linked roles] registered 2 metadata field(s)
[panel] connected
[roles] initial sync: updated N member(s)
```

Als Dienst dauerhaft laufen lassen:

```bash
sudo cp /opt/afksystems/deploy/afksystems-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now afksystems-bot
journalctl -u afksystems-bot -f
```

Ob er läuft, steht auch im Panel: *Administration → Einstellungen → Discord* zeigt „verbunden“
samt Zeitpunkt des letzten Lebenszeichens.

---

## Was der Bot dann tut

### Tickets, in beide Richtungen

* Im Ticket-Kanal steht eine Nachricht mit **einem Knopf**. Ein Klick, ein kurzes Formular
  (Betreff und Text), danach ein eigener Kanal. Kategorien gibt es nicht mehr – sie waren ein
  Pflichtfeld, das nichts entschieden hat.
* **Nur verknüpfte Konten** dürfen eines aufmachen. Wer nicht verknüpft ist, bekommt den Link dazu
  – und keinen Kanal, der ins Leere läuft.
* Wer das Ticket **hier** aufmacht, wird im neuen Kanal erwähnt und findet ihn dadurch wieder. Ein
  Ticket aus dem Panel bekommt diese Erwähnung nicht: dort wartet niemand in Discord darauf.
* Jede Nachricht im Kanal landet im Panel, jede Antwort im Panel landet im Kanal. Interne Notizen
  des Teams bleiben im Panel.
* **Anhänge laufen in beide Richtungen**, bis 20 MB. Was im Panel angehängt wird, hängt hier als
  echte Datei im Kanal; was hier geschickt wird, holt sich das Panel und behält es – Discords
  Anhang-Adressen laufen ab, ein Ticket soll seinen Screenshot aber behalten. Nimmt Discord eine
  Datei nicht an (ohne Boosts sind dort 10 MB Schluss), steht im Kanal ein Link ins Panel statt
  der Datei.
* Wer im Panel ein Ticket aufmacht, bekommt trotzdem einen Kanal in Discord.
* Der Knopf **Schließen** schließt es an beiden Stellen. Eine Antwort macht es wieder auf.
* Nur Administratoren können Tickets in Discord bearbeiten; Team und Discord-Moderatoren erhalten keinen Zugang zu Ticket-Kanälen.
* Geschlossene Kanäle wandern in die Kategorie `archived Tickets` und werden nach sieben Tagen gelöscht.

### Rollen

Stündlich und bei jeder Änderung:

* verknüpftes Konto → **Customer**
* laufender bezahlter Tarif → **Premium** bzw. **Ultra** (Ultra erhält zusätzlich immer Premium; eine Tarifrolle kommt bei Bedarf dazu)
* im Panel gesetztes Kennzeichen → **Partner** beziehungsweise **VIP**
* **Admin** → Linked Role Administrator, **Discord-Mod** → Linked Role Discord Moderator; beide erhalten zusätzlich automatisch **Team**
* **Discord Moderator** darf öffentliche und rollenbasierte Kanäle sehen. Rein für Admins oder einzelne Nutzer geschützte Kanäle bleiben ausgeschlossen. Team bleibt die automatisch vergebene gemeinsame Rolle.

**Ganze Kategorien lassen sich ausnehmen.** In *Administration → Einstellungen → Discord →
Kategorien ohne Kanalrechte* stehen die IDs der Kategorien, in denen der Bot **nichts** anfasst:
weder setzt er dort ein Recht noch nimmt er eines weg. Voreingestellt sind die Ticket-Kategorie,
das Ticket-Archiv und die internen Bereiche – dort ist „wer darf hinein“ eine Entscheidung, die
jemand getroffen hat, und kein Zustand, den ein Dienst stündlich neu herstellen soll.

Bei jedem Beitritt oder Austritt und beim stündlichen Vollabgleich meldet der Bot außerdem die
Mitgliedschaft an das Panel. Ohne Mitgliedschaft im Pflichtserver wird jeder Gratis-Platz sofort
gestoppt und sein automatischer Startwunsch gelöscht.

Angefasst wird **ausschließlich**, was oben eingetragen ist. Alles andere – Farbrollen,
Selbstbedienungsrollen – bleibt unberührt.

### Linked Roles

Der Bot meldet beim Start zwei Merkmale an, mit denen Discord die beiden Statusrollen an
Bedingungen geknüpft werden:

| Feld | Bedeutung |
| --- | --- |
| `administrator` | ist Administrator im AFKSystems-Panel |
| `discord_moderator` | ist im Panel als Discord Moderator markiert |

Einrichten: *Servereinstellungen → Rollen → Rolle → Links → AFKSystems → Bedingung*.

Im Bedingungsfeld steht `AFKSystems` und dahinter `Discord Moderator`. Der zweite Teil ist der
Name des Merkmals und kommt von hier (`ROLE_METADATA` in `server/oauth.js`); den ersten setzt
Discord selbst davor – es ist der **Name der Anwendung** aus dem Developer Portal. Ändern lässt er
sich nur dort, und damit heißt auch der Bot anders. Die Werte
schreibt das Panel nach der Zustimmung über **Discord-Rollen auffrischen**. Diese Schaltfläche wird
nur Administratoren und Discord-Moderatoren gezeigt. Customer, Premium, Ultra, Partner, VIP und
**Team** sind normale Rollen und werden vom Bot direkt synchronisiert; Administrator und Discord
Moderator sind die beiden Linked Roles.

### Befehle

| Befehl | Was er tut |
| --- | --- |
| `/roles` | gleicht alle Mitglieder ab (nur mit „Rollen verwalten“) |

Mehr gibt es bewusst nicht. `/ticket` und `/account` waren zweite Wege zu Dingen, für die es schon
einen ersten gibt: Ein Ticket macht man am Knopf im Support-Kanal auf, wo die Erklärung daneben
steht, und was am Konto steht, steht vollständig im Panel – eine Kurzfassung davon in Discord ist
veraltet, sobald sie geschrieben ist.

### Status

Unter dem Namen des Bots steht die Adresse des Panels, sonst nichts. Sie kommt aus der
Konfiguration; steht das Panel woanders, steht dort auch dessen Adresse.

---

## Wenn etwas nicht geht

| Meldung | Ursache | Abhilfe |
| --- | --- | --- |
| `PANEL_SECRET is missing` | `.env` nicht ausgefüllt | Geheimnis aus dem Panel eintragen |
| `The bot is not signed in` | Geheimnis stimmt nicht überein oder ist kürzer als 24 Zeichen | beide Seiten vergleichen; im Log des Panels steht, wenn es zu kurz ist |
| `The panel is unavailable` | `PANEL_URL` falsch oder Panel aus | `curl $PANEL_URL/api/health` |
| `No bot token` | Token weder im Panel noch in der `.env` | im Panel eintragen |
| `Unexpected server response: 404` | Reverse Proxy reicht `/api/bot/stream` als normales GET durch | mitgelieferte nginx-Konfiguration installieren; Upgrade- und Authorization-Header müssen durchgereicht werden |
| `Missing Permissions` beim Rollenvergeben | Bot-Rolle steht zu weit unten | in Discord nach oben ziehen |
| Ticket-Kanäle entstehen nicht | Kategorie-ID falsch oder Rechte fehlen | ID prüfen, „Kanäle verwalten“ prüfen |
| Nachrichten kommen leer an | Message Content Intent aus | im Developer Portal einschalten |
| Anhänge kommen nicht in Discord an | Datei größer als Discords Grenze (ohne Boosts 10 MB) | im Kanal steht dann ein Link ins Panel – das ist so gewollt |
| Anhänge kommen nicht im Panel an | Datei größer als 20 MB oder Adresse abgelaufen | der Bot antwortet im Kanal, welche Datei es war |

---

## Umzug nach Featherpanel

Der Bot ist ein gewöhnlicher Node-Prozess ohne eigene Ablage. Für den Umzug reicht:

1. Ordner `bot/` hochladen (ohne `node_modules`).
2. Startbefehl `npm install --omit=dev && node index.js`, Node 20 oder neuer.
3. Zwei Umgebungsvariablen setzen: `PANEL_URL` und `PANEL_SECRET`.

Sonst nichts – keine Datenbank, keine Datei, die mitmuss. Läuft er woanders, muss das Panel von
dort aus erreichbar sein; steht es hinter Cloudflare, geht das ohne Zutun.
