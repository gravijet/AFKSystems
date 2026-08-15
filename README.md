# AFKSystems – Webpanel

Minecraft-AFK-Bots im Browser: Konten verbinden, Serverplätze anlegen, Bots starten, Chat mitlesen
und schreiben, Befehle automatisieren. Ein Serverplatz ist **dauerhaft gratis**, jeder weitere läuft
auf einem **Monatstarif**, bezahlt aus dem Guthaben.

Die Bots sind Prozesse des [AFKSystems-Clients](https://github.com/gravijet/HugoAFKClient). Der ist
bewusst pipe-fähig gebaut, deshalb braucht es zwischen Panel und Client kein eigenes Protokoll:

```
Standardausgabe   ->  Chat + "@event join name=…"        ->  Live-Chat und Zustand im Panel
Standardfehler    ->  Verbindungsmeldungen               ->  Zustandsanzeige im Panel
Standardeingabe   <-  Chat, Befehle, ":go vor 5"         <-  Eingabefeld im Panel
```

## Schnellstart (Entwicklung)

```bash
npm install
cp .env.example .env          # GITHUB_TOKEN eintragen – das Client-Repo ist privat
npm start                     # http://127.0.0.1:3010
```

Beim Start holt sich das Panel das Release `latest` des Clients nach `data/bin/`, ruft für jede
Bauform `--help` auf und merkt sich, **was sie wirklich kann**. Es steht also nirgends im Code eine
Liste von Fähigkeiten oder Versionen, die veralten könnte – fehlt etwas, ist der Knopf dafür aus.

Der **erste registrierte Benutzer wird Administrator** (oder wer in `ADMIN_EMAIL` steht).

## Zwei Sprachen

Englisch ist die Hauptsprache, Deutsch die zweite. Beide sind echte Adressen:

```
/en            /de              Startseite
/en/login      /de/login        …und so weiter für alle festen Seiten
/en/app        /de/app          Dashboard
```

Alle sichtbaren Texte stehen in **einer** Datei: `public/assets/js/i18n.js`. Sie wird von beiden
Seiten importiert – Node rendert daraus die festen Seiten, der Browser das Dashboard. Die gewählte
Sprache liegt im Cookie `lang` und am Konto; ohne beides entscheidet `Accept-Language`.
Fehlermeldungen der API kommen in derselben Sprache zurück.

## Betrieb (afksystems.de)

```bash
sudo ./deploy/install.sh                     # Dienstbenutzer, /opt/afksystems, systemd, nginx
sudo certbot --nginx -d afksystems.de -d www.afksystems.de
journalctl -u afksystems -f
```

* `deploy/afksystems.service` – systemd-Unit; startet beim Hochfahren alle Bots wieder, die zuletzt
  laufen sollten, und stoppt sie beim Beenden sauber.
* `deploy/nginx-afksystems.de.conf` – vHost samt WebSocket-Durchreichung für den Live-Chat.

## Geld

**1 Credit = 1 Cent**, ganzzahlig. 100 Credits sind ein Euro. Ein Monat sind hier immer **30 Tage**.

* Der **erste Serverplatz je Konto ist gratis** und bleibt es (Einstellung `free_slots`).
* Jeder weitere Platz bucht beim Anlegen den Monatspreis seines Tarifs ab und verlängert sich
  stündlich geprüft von selbst, solange das Guthaben reicht.
* Reicht es nicht, wird der Platz **stillgelegt**: Bots gehen aus, gelöscht wird nichts, ins Minus
  geht es nie. Nach dem Aufladen genügt „Fortsetzen“.
* Tarifwechsel und Löschen schreiben den ungenutzten Rest des Monats anteilig gut.
* Aufladen: Gutschein, Überweisung/PayPal (Admin bestätigt), Stripe (mit Schlüssel), oder der Admin
  bucht direkt auf.

Die Tarife selbst stehen in der Tabelle `plans` und sind im Admin-Bereich änderbar – Preis, Anzahl
Bots, Chatverlauf, Premium-Client, Proxys, Fake-Host, Offline-Konten, Support-Vorrang.

## Drei Bauformen, ein Tarif entscheidet

| Bauform | Datei | Wer sie bekommt |
| --- | --- | --- |
| schlank | `afk-linux` | der Gratis-Platz: verbinden, drinbleiben, Chat, Befehle, Macros |
| Bewegung | `afk-linux-move` | optional, selbst gebaut (`scripts/build-movement.sh`) |
| Premium | `premium-afk-linux` | bezahlte Plätze: dazu Anti-AFK, Schleichen, Anzeigetafel, Menüs |

`server/binaries.js` sucht die passende Datei zum Tarif und fällt auf die nächstbeste zurück, wenn
sie fehlt – ein vergessener Download legt damit keine Bots still.

## Aufbau

```
server/
  index.js        HTTP, Seiten in zwei Sprachen, WebSocket, Verlängerungen
  config.js       Umgebung und Pfade          db.js         SQLite-Schema, Migrationen, Tarife
  auth.js         Sitzungen, Passwörter       billing.js    Credits, Tarife, Gutscheine, Ledger
  binaries.js     Client + Fähigkeiten        supervisor.js ein Prozess je Bot, Zustandsautomat
  mslogin.js      Microsoft-Gerätecode        macros.js     Macros, Spam, Anti-AFK
  features.js     was der Client kann – einzige Wahrheitsquelle für Panel und Startseite
  pages.js        Vorlagen                    landing.js    die beweglichen Teile der Startseite
  mail.js         SMTP                        discord.js    Konto verknüpfen / Anmelden
  tickets.js      Support                     notify.js     Discord-Webhooks
  routes/         core, profiles, billing, admin
public/
  pages/          die festen Seiten als Vorlagen ({{> partial}} und {{schlüssel}})
  assets/js/i18n.js   alle Texte, beide Sprachen, von Server und Browser genutzt
  assets/js/views/    Übersicht, Konten, Server, Guthaben, Tickets, Proxys, Admin …
scripts/
  build-movement.sh   baut die Bewegungs-Bauform (liegt nicht im Release)
data/                 Datenbank, Client-Dateien, Konten je Nutzer, Logs  (nicht im Repo)
```

## Was das Panel bewusst nicht anbietet

Steht an genau einer Stelle: `server/features.js`. Der Zustand wird nicht von Hand gepflegt, sondern
aus den Fähigkeiten der vorhandenen Client-Dateien berechnet:

* `ready` – für alle da
* `premium` – mit einem bezahlten Serverplatz
* `soon` – geplant (aktuell: Bedrock-Konten)
* `no` – bewusst nicht gebaut, mit Begründung (aktuell: Live-Ansicht/POV)
* `missing` – die Bauform, die es könnte, liegt gerade nicht auf diesem Server

## Support und Proxys

Proxys gehören dem Betreiber und werden **von Hand zugeteilt**: Ein zahlender Kunde macht ein Ticket
der Kategorie „Proxy anfragen“ auf, der Admin legt den Proxy an und weist ihn zu. Auf dem Gratis-Platz
gibt es keine. Danach lässt sich je Konto im Reiter „Proxys“ des Serverplatzes einer auswählen.

## API

Alles unter `/api`, Sitzung im HttpOnly-Cookie.

| Bereich | Endpunkte |
| --- | --- |
| Anmeldung | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify`, `/auth/forgot`, `/auth/reset` |
| Discord | `GET /auth/discord/start`, `/auth/discord/callback`, `DELETE /auth/discord` |
| Eigenes | `GET/PATCH /me`, `GET/DELETE /me/sessions`, `POST /me/password`, `/me/discord-test` |
| Konten | `GET /accounts`, `POST /accounts/login` (Gerätecode), `POST /accounts/offline`, `DELETE /accounts/:id` |
| Serverplätze | `GET/POST /profiles`, `GET/PATCH/DELETE /profiles/:id`, `POST /profiles/:id/plan`, `/resume` |
| Bots | `POST /profiles/:id/start`, `/stop`, `/restart` |
| Chat | `GET/POST /profiles/:id/chat`, `…/spam` |
| Im Spiel | `POST /profiles/:id/command` (`go`, `look`, `home`, `board`, `menu`, `click`, `sneak`, …) |
| Automatik | `…/macros` (GET/POST/PATCH/DELETE, dazu `/test`) |
| Guthaben | `GET /billing`, `POST /billing/voucher`, `POST /billing/topup` |
| Support | `GET/POST /tickets`, `GET /tickets/:id`, `POST /tickets/:id/reply`, `/close` |
| Admin | `/admin/overview`, `/users`, `/plans`, `/topups`, `/vouchers`, `/proxies`, `/tickets`, `/profiles`, `/bots`, `/announcements`, `/settings`, `/client/sync`, `/mails`, `/audit`, `/ledger` |
| Live | `GET /api/ws` – WebSocket mit Chatzeilen, Zustandswechseln, Guthaben, Stilllegungen |
