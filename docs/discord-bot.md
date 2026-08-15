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
| Kanal für den Ticket-Knopf | der Kanal, in dem die Nachricht mit dem Auswahlfeld stehen soll |
| Kategorie für Ticket-Kanäle | die Kategorie, unter der die Ticket-Kanäle entstehen |
| Einladungslink | `https://discord.gg/…` – steht danach auf der Website |
| Geheimnis Panel ↔ Bot | ein selbst ausgedachtes langes Passwort (siehe unten) |
| Konto verknüpft | Rolle für jeden mit verknüpftem Konto |
| Premium / Ultra | Rollen für die Tarife |
| Admin / Discord-Mod | die Rollen, aus denen die Team-Rolle folgt |
| Team | bekommt automatisch, wer Admin oder Discord-Mod ist |

Für das Geheimnis:

```bash
openssl rand -base64 36
```

Dieselbe Zeichenkette kommt gleich in die `.env` des Bots. Ohne sie redet das Panel nicht mit ihm.

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
[discord] angemeldet als AFKSystems#1234
[discord] Befehle angemeldet
[linked roles] 4 Felder angemeldet
[panel] verbunden
[rollen] erster Abgleich: N Mitglieder angepasst
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

* Im Ticket-Kanal steht eine Nachricht mit einem Auswahlfeld. Wer eine Kategorie wählt, bekommt ein
  kurzes Formular und danach einen eigenen Kanal.
* **Nur verknüpfte Konten** dürfen eines aufmachen. Wer nicht verknüpft ist, bekommt den Link dazu
  – und keinen Kanal, der ins Leere läuft.
* Jede Nachricht im Kanal landet im Panel, jede Antwort im Panel landet im Kanal. Interne Notizen
  des Teams bleiben im Panel.
* Wer im Panel ein Ticket aufmacht, bekommt trotzdem einen Kanal in Discord.
* Der Knopf **Schließen** schließt es an beiden Stellen. Eine Antwort macht es wieder auf.
* Geschlossene Kanäle werden umbenannt, nicht gelöscht: der Verlauf bleibt lesbar.

### Rollen

Stündlich und bei jeder Änderung:

* verknüpftes Konto → **Konto verknüpft**
* laufender bezahlter Tarif → **Premium** bzw. **Ultra** (oder die Rolle am Tarif)
* **Admin** oder **Discord-Mod** → zusätzlich **Team**

Angefasst wird **ausschließlich**, was oben eingetragen ist. Alles andere – Farbrollen,
Selbstbedienungsrollen – bleibt unberührt.

### Linked Roles

Der Bot meldet beim Start das Schema an, mit dem Discord Rollen an Bedingungen knüpfen kann:

| Feld | Bedeutung |
| --- | --- |
| `linked` | hat ein AFKSystems-Konto verknüpft |
| `plan` | 0 = Gratis, 1 = Premium, 2 = Ultra |
| `servers` | wie viele Serverplätze laufen |
| `staff` | gehört zum Team |

Einrichten: *Servereinstellungen → Rollen → Rolle → Links → AFKSystems → Bedingung*. Die Werte
schreibt das Panel, sobald ein Kunde in seinen Einstellungen auf **Discord-Rollen auffrischen**
klickt.

### Befehle

| Befehl | Was er tut |
| --- | --- |
| `/konto` | zeigt, ob verknüpft, welcher Tarif, ob Team |
| `/ticket` | macht ein Ticket auf, ohne den Umweg über den Kanal |
| `/rollen` | gleicht alle Mitglieder ab (nur mit „Rollen verwalten“) |

---

## Wenn etwas nicht geht

| Meldung | Ursache | Abhilfe |
| --- | --- | --- |
| `PANEL_SECRET fehlt` | `.env` nicht ausgefüllt | Geheimnis aus dem Panel eintragen |
| `Der Bot ist nicht angemeldet` | Geheimnis stimmt nicht überein | beide Seiten vergleichen |
| `Das Panel antwortet nicht` | `PANEL_URL` falsch oder Panel aus | `curl $PANEL_URL/api/health` |
| `Kein Bot-Token` | Token weder im Panel noch in der `.env` | im Panel eintragen |
| `Missing Permissions` beim Rollenvergeben | Bot-Rolle steht zu weit unten | in Discord nach oben ziehen |
| Ticket-Kanäle entstehen nicht | Kategorie-ID falsch oder Rechte fehlen | ID prüfen, „Kanäle verwalten“ prüfen |
| Nachrichten kommen leer an | Message Content Intent aus | im Developer Portal einschalten |

---

## Umzug nach Featherpanel

Der Bot ist ein gewöhnlicher Node-Prozess ohne eigene Ablage. Für den Umzug reicht:

1. Ordner `bot/` hochladen (ohne `node_modules`).
2. Startbefehl `npm install --omit=dev && node index.js`, Node 20 oder neuer.
3. Zwei Umgebungsvariablen setzen: `PANEL_URL` und `PANEL_SECRET`.

Sonst nichts – keine Datenbank, keine Datei, die mitmuss. Läuft er woanders, muss das Panel von
dort aus erreichbar sein; steht es hinter Cloudflare, geht das ohne Zutun.
