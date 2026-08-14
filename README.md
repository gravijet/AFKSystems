# AFKSystems – Webpanel

Minecraft-AFK-Bots im Browser: Konten verbinden, Serverprofile anlegen, Bots starten, Chat mitlesen
und schreiben, Befehle automatisieren – bezahlt wird mit **Guthaben**, nicht mit einem Abo.

Die Bots sind Prozesse des [AFKSystems-Clients](https://github.com/gravijet/HugoAFKClient). Der ist
bewusst pipe-fähig gebaut, deshalb braucht es zwischen Panel und Client kein eigenes Protokoll:

```
Standardausgabe   ->  Chat, eine Zeile je Nachricht      ->  Live-Chat im Panel
Standardfehler    ->  "Verbunden und im Spiel als …"     ->  Zustandsanzeige im Panel
Standardeingabe   <-  Chat, Befehle, Bewegung (:go …)    <-  Eingabefeld im Panel
```

## Schnellstart (Entwicklung)

```bash
npm install
cp .env.example .env          # GITHUB_TOKEN eintragen – das Client-Repo ist privat
npm start                     # http://127.0.0.1:3010
```

Beim Start holt sich das Panel das Release `latest` des Clients nach `data/bin/` und liest die
unterstützten Minecraft-Versionen direkt aus `afk-linux --help`. Es steht also nirgends im Code eine
Versionsliste, die veralten könnte.

Der **erste registrierte Benutzer wird Administrator** (oder wer in `ADMIN_EMAIL` steht).

## Betrieb (example.invalid)

```bash
sudo ./deploy/install.sh                     # Dienstbenutzer, /opt/afksystems, systemd, nginx
sudo certbot --nginx -d example.invalid -d example.invalid
journalctl -u afksystems -f
```

* `deploy/afksystems.service` – systemd-Unit; startet beim Hochfahren alle Bots wieder, die zuletzt
  laufen sollten, und stoppt sie beim Beenden sauber.
* `deploy/nginx-example.invalid.conf` – vHost samt WebSocket-Durchreichung für den Live-Chat.

## Guthaben

Gerechnet wird in **Milli-Credits** (`mcr`), ganzzahlig: `1000 mcr = 1 Credit`. Was ein Credit in
Euro kostet, steht in den Einstellungen (`credit_cent`), damit der Betreiber es ohne Codeänderung
ändern kann.

* Jede Minute wird für jeden laufenden Bot der anteilige Stundensatz abgebucht.
* Ein gestoppter Bot kostet nichts; ohne Guthaben werden Bots gestoppt, nie ins Minus.
* Wartet ein Bot auf eine neue Microsoft-Anmeldung, zählt er nicht mit.
* Aufladen: Gutschein, Überweisung/PayPal (Admin bestätigt), Stripe (mit Schlüssel), oder der Admin
  bucht direkt auf.

Standardtarif: 7 mcr je Bot und Stunde ≈ 5,11 Credits im Monat bei Dauerbetrieb.

## Aufbau

```
server/
  index.js        HTTP, WebSocket, Abrechnungstakt, Aufräumen
  config.js       Umgebung und Pfade         db.js        SQLite-Schema und Einstellungen
  auth.js         Sitzungen und Passwörter   credits.js   Guthaben, Ledger, Gutscheine
  binaries.js     Client aus dem Release     supervisor.js ein Prozess je Bot, Zustandsautomat
  mslogin.js      Microsoft-Gerätecode       macros.js    Macros, Spam, Anti-AFK
  features.js     was der Client kann – einzige Wahrheitsquelle für Panel und Startseite
  notify.js       Discord-Webhooks           routes/      REST-API
public/
  index.html      Startseite                 app.html     Dashboard (eine Seite, eigener Router)
  assets/js/views/  Übersicht, Konten, Server (alle Registerkarten), Guthaben, Admin …
scripts/
  build-movement.sh  baut die Bewegungs-Bauform des Clients (liegt nicht im Release)
data/               Datenbank, Client-Dateien, Konten je Nutzer, Logs  (nicht im Repo)
```

## Bewegung

Der schlanke Client bewegt sich **nie** – kein Byte davon ist enthalten. Wer Laufen, Blickrichtung,
Springen, Heimatposition und Routen will, baut die zweite Bauform einmal:

```bash
./scripts/build-movement.sh        # -> data/bin/afk-linux-move
```

Danach lässt sich jedes Serverprofil in den Einstellungen auf Bewegung umstellen; das Panel erkennt
die Datei von selbst.

## Was der Client (noch) nicht kann

Das Panel zeigt solche Stellen offen an, statt Knöpfe anzubieten, die nichts tun. Gepflegt wird das
an genau einer Stelle: `server/features.js`. Aktuell fehlen im Client Inventar, Live-Ansicht,
Scoreboard, Schleichen, Proxys, Fake-Host, Offline- und Bedrock-Konten sowie ein Signal beim
Weltwechsel.

## API

Alles unter `/api`, Sitzung im HttpOnly-Cookie.

| Bereich | Endpunkte |
| --- | --- |
| Anmeldung | `POST /auth/register`, `/auth/login`, `/auth/logout` |
| Eigenes | `GET/PATCH /me`, `POST /me/password`, `POST /me/discord-test` |
| Konten | `GET /accounts`, `POST /accounts/login` (Gerätecode), `GET /accounts/login/:id`, `DELETE /accounts/:id` |
| Profile | `GET/POST /profiles`, `GET/PATCH/DELETE /profiles/:id`, `…/accounts` |
| Bots | `POST /profiles/:id/start`, `/stop`, `/restart` |
| Chat | `GET/POST /profiles/:id/chat` |
| Bewegung | `POST /profiles/:id/move` |
| Automatik | `…/macros`, `…/spam` (je GET/POST/PATCH/DELETE, dazu `/test`) |
| Guthaben | `GET /billing`, `POST /billing/voucher`, `POST /billing/topup` |
| Admin | `/admin/overview`, `/users`, `/topups`, `/vouchers`, `/bots`, `/settings`, `/client/sync`, `/audit` |
| Live | `GET /api/ws` – WebSocket mit Chatzeilen, Zustandswechseln, Guthabenstand |
