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

## Die öffentlichen Seiten

Nicht alles auf einer Startseite: die Startseite sagt in wenigen Sätzen, was der Dienst tut und was
er kostet, alles Weitere steht auf eigenen Seiten. Was dort steht, ist bewusst frei von Technik –
Protokolle, Bauformen und Begründungen für Dinge, die es nicht gibt, gehören ins Panel und in
dieses README, nicht in den Verkaufstext.

```
/en            /de              Startseite: Hero, vier Sätze, Preisrahmen, drei Schritte
/en/features   /de/features     Funktionsliste nach Gruppen
/en/pricing    /de/pricing      Tarife, Zusätze, Aufladepakete, Abrechnungsfragen
/en/faq        /de/faq          Fragen und Antworten
/en/login      /de/login        …und so weiter für alle festen Seiten
/en/app        /de/app          Dashboard
```

Preise stehen dort in **Euro**. Credits sind die Einheit, mit der das Panel rechnet, und stehen als
Nebenzeile darunter – niemand entscheidet sich für einen Tarif, weil er „249“ kostet.

Die Funktionsliste steht in `server/features.js`. Ein Eintrag mit `need` fällt weg, wenn die
Client-Datei auf **diesem** Server das nicht kann – so wird nie etwas versprochen, das gerade
niemand einlösen kann, ohne dass die Seite darüber redet.

## Zwei Sprachen

Englisch ist die Hauptsprache, Deutsch die zweite. Beide sind echte Adressen (siehe oben).

Alle sichtbaren Texte stehen in **einer** Datei: `public/assets/js/i18n.js`. Sie wird von beiden
Seiten importiert – Node rendert daraus die festen Seiten, der Browser das Dashboard.
Fehlermeldungen der API kommen in derselben Sprache zurück.

Gemerkt wird die Sprache **im Browser**: `localStorage['afk-lang']` und das Cookie `lang`, das der
Server liest. Beim allerersten Besuch steht nichts davon fest – dann entscheidet `Accept-Language`,
und was dabei herauskam, wird gemerkt. Ab dann gilt die gemerkte Sprache überall: Website wie
Dashboard, auch wenn jemand über einen Link in der anderen Sprache hereinkommt (`ui.js` leitet
einmal um). Beim Umschalten geht beides neu, und angemeldete Konten speichern es zusätzlich am
Konto – das entscheidet, in welcher Sprache E-Mails kommen.

Zwei weitere Dateien teilen sich beide Seiten: `chatlog.js` (Chatzeilen zusammenlegen,
Minecraft-Farben zerlegen) und `settings-schema.js` (Beschreibung aller Einstellungen).

## Betrieb (example.invalid)

```bash
sudo ./deploy/install.sh                     # Dienstbenutzer, /opt/afksystems, systemd, nginx
sudo certbot --nginx -d example.invalid -d example.invalid
journalctl -u afksystems -f
```

* `deploy/afksystems.service` – systemd-Unit fürs Panel; startet beim Hochfahren alle Bots wieder,
  die zuletzt laufen sollten, und stoppt sie beim Beenden sauber.
* `deploy/afksystems-bot.service` – systemd-Unit für den Discord-Bot (eigener Dienst).
* `deploy/nginx-example.invalid.conf` – vHost samt WebSocket-Durchreichung für Live-Chat und
  Discord-Bot; insbesondere `/api/bot/stream` darf nicht als normales HTTP-GET am Panel landen.

## Geld

**1 Credit = 1 Cent**, ganzzahlig. 100 Credits sind ein Euro. Ein Monat sind hier immer **30 Tage**.

* Der **erste Serverplatz je Konto ist gratis**, solange das verknüpfte Discord-Konto Mitglied im
  konfigurierten AFKSystems-Server (`000000000000000000`) ist. Austritt, fehlende Verknüpfung oder
  ein veralteter Mitgliedschaftsnachweis stoppen ihn sofort beziehungsweise spätestens nach der
  eingestellten Prüfzeit.
* Jeder weitere Platz bucht beim Anlegen den Monatspreis seines Tarifs ab und verlängert sich
  stündlich geprüft von selbst, solange das Guthaben reicht.
* Reicht es nicht, wird der Platz **stillgelegt**: Bots gehen aus, gelöscht wird nichts, ins Minus
  geht es nie. Nach dem Aufladen genügt „Fortsetzen“.
* Tarifwechsel und Löschen schreiben den ungenutzten Rest des Monats anteilig gut.
* Aufladen: Gutschein, Überweisung/PayPal (Admin bestätigt), Stripe (mit Schlüssel), oder der Admin
  bucht direkt auf.

Die Tarife stehen in der Tabelle `plans` und sind im Admin-Bereich vollständig änderbar – Name,
Beschreibungstext, Preis, Anzahl Bots, Chatverlauf, Macros, Premium-Client, Proxys,
Offline-Konten, Scoreboard, Menüs, Support-Vorrang und die Discord-Rolle.

Auch **der Wortlaut auf der Preisseite** gehört dazu: `features_de` und `features_en` sind die
Merkmalsliste eines Tarifs, eine Zeile je Punkt. Steht dort etwas, wird genau das angezeigt; sind
die Felder leer, baut `landing.planLines()` die Liste aus den Zahlen des Tarifs zusammen.

### Zusätze

Ein Serverplatz muss nicht auf den nächstgrößeren Tarif springen, nur weil ein Bot mehr gebraucht
wird. In der Tabelle `addons` steht, was sich dazubuchen lässt; `profile_addons` sagt, wer was hat.

| Zusatz | Wirkung |
| --- | --- |
| `slot` | ein Bot mehr auf diesem Platz (mehrfach buchbar) |
| `menus` | Menüs bedienen – in Ultra enthalten, auf Premium dazubuchbar |
| `pov` | Live-Ansicht – angekündigt, `available = 0`, noch nicht buchbar; je Konto **und** Platz, in keinem Tarif enthalten |

Das Scoreboard war einmal ein Zusatz (`board`) und gehört seit Migration 006 zu jedem bezahlten
Tarif. Der Eintrag steht als `active = 0` noch in der Tabelle, damit alte Buchungen nachvollziehbar
bleiben; angeboten wird er nicht mehr.

Gerechnet wird anteilig: beim Buchen der Rest der laufenden Periode, beim Abbestellen kommt er
zurück. Ab der nächsten Verlängerung steckt der Zusatz im Monatspreis. Auf dem Gratis-Platz gibt es
keine – dort wäre nichts, woran sie hängen könnten.

**Was ein Serverplatz kann, ist Tarif ∩ Zusätze ∩ Client.** Diese Rechnung steht an genau einer
Stelle: `billing.featuresOf()` mischt Tarif und Zusätze, `billing.gateCaps()` schneidet es auf das
zu, was die Client-Datei hergibt. Alles andere – Reiter im Panel, erlaubte Befehle, Startargumente –
fragt dort nach.

## Sieben Rust-Bauformen, ein Tarif entscheidet

| Bauform | Datei | Wer sie bekommt |
| --- | --- | --- |
| Basis | `afk-linux` | Verbindung, Chat, Befehle und Macros |
| Bewegung | `afk-linux-move` | Basis plus Bewegung, Blickrichtung, Routen und Sprung |
| Items | `items-afk-linux` | Basis plus Menüs und formatierte Gegenstandsdaten |
| Premium | `premium-afk-linux` | Bewegung, formatiertes Scoreboard, Menü-Klicks, Tastenzustand und Anti-AFK |
| Premium + Items | `premium-items-afk-linux` | Premium plus sichtbare Gegenstände mit Namen, Farbe und Lore |
| POV | `pov-afk-linux` | automatisch gestartete Terminal-POV |
| Ultra | `ultra-afk-linux` | Premium, Items und zuschaltbare POV |

`server/binaries.js` sucht die passende Datei zum Tarif und fällt auf die nächstbeste zurück, wenn
sie fehlt – ein vergessener Download legt damit keine Bots still.

Alle Bauformen sprechen über `--mc` Minecraft 1.21.1, 1.21.11, 26.1 und 26.2. Nach einem Kick oder
gewöhnlichen Verbindungsabbruch endet der Prozess absichtlich mit Fehlerstatus; das Panel startet
ihn nicht heimlich neu. Nur ein vom Server angeordneter Transfer auf einen Unterserver bleibt Teil
derselben Sitzung. Tablist und Playerlist gibt es in den Rust-Clients nicht mehr.

## Standorte

Ein Standort ist die **Ausgangsadresse**, über die ein Serverplatz ins Netz geht, plus die Regeln,
wer sie benutzen darf und wie viel dort laufen darf. Aus Sicht eines Minecraft-Servers ist ein Bot
seine IP-Adresse; wo der Prozess läuft, sieht dort niemand.

Es gibt immer genau einen Standort vom Typ `local` – diese Maschine. Jeder weitere zeigt auf einen
Proxy (ein zweiter VPS, eine zweite IP). Zugang: `all`, `listed` (namentlich) oder `admin`.

Wie man einen anlegt, steht Schritt für Schritt in **[docs/standorte.md](docs/standorte.md)** – mit
den Befehlen zum Kopieren.

## Discord

Zwei Dinge, die unabhängig voneinander laufen:

* **Anmelden und Verknüpfen** (`server/oauth.js`) – braucht nur Client-ID und Secret. Dasselbe
  Modul bedient Google. Wer sich mit Discord oder Google anmeldet und noch kein Konto hat, bekommt
  eines; die Adresse kommt vom Anbieter.
* **Der Bot** (`bot/`) – ein eigener Dienst. Tickets laufen in beide Richtungen, Rollen folgen dem
  Tarif. Er hat keine eigene Konfiguration: Server-ID, Kanäle, Rollen und sein Token holt er sich
  beim Start aus dem Panel, damit er sich ohne Änderung woanders hinstellen lässt.

Anleitungen: **[docs/discord-bot.md](docs/discord-bot.md)** und
**[docs/google-anmeldung.md](docs/google-anmeldung.md)**.

## Post

`server/mail.js` kennt Vorlagen für alles, was ein Kunde erfahren soll: Adresse bestätigen,
Passwort zurücksetzen, Anmeldung von einem neuen Gerät, Aufladung gutgeschrieben, Platz verlängert,
Platz läuft ab, Platz stillgelegt, Guthaben knapp, Ticket angelegt/beantwortet/geschlossen,
Ankündigung, Nachricht von Hand.

Jede Nachricht gehört zu einer **Kategorie**, und der Kunde stellt in seinen Einstellungen ein,
welche er will. Zwei lassen sich nicht abbestellen: was das Konto absichert und was ohne Nachricht
gar nicht ginge.

Was verschickt wurde, steht in `mails` – **mit Empfänger und Wortlaut**. Der Kunde sieht seine
eigenen Nachrichten unter *Einstellungen → Nachrichten an dich*. Wer eine E-Mail mit unserem Namen
bekommt und sich fragt, ob sie echt war, prüft das dort ohne Rückfrage.

## Noch nicht im Webpanel

Der Rust-Client enthält inzwischen eine echte **Terminal-POV**: `pov-afk-linux` startet sie direkt,
bei `ultra-afk-linux` schaltet `:pov live` sie zu. Das Webpanel hat dafür noch keinen
Browser-Renderer; der Zusatz steht deshalb weiterhin mit `available = 0` in der Datenbank und wird
nicht verkauft. **Bedrock** bleibt ebenfalls außen vor: Dafür wäre ein eigener Protokollstapel und
damit ein zweiter Client nötig.

## Support und Proxys

Proxys gehören dem Betreiber und werden **von Hand zugeteilt**: Ein zahlender Kunde macht ein Ticket
der Kategorie „Proxy anfragen“ auf, der Admin legt den Proxy an und weist ihn zu. Auf dem Gratis-Platz
gibt es keine. Danach lässt sich je Konto im Reiter „Proxys“ des Serverplatzes einer auswählen.

Ein Ticket ist ein Gespräch: Nachrichten laufen live ein, man sieht, wenn das Gegenüber schreibt,
und eine Antwort auf ein geschlossenes Ticket macht es wieder auf. Mehrere Kunden dürfen an einem
Ticket hängen; das Team kann jemanden dazuholen. Läuft der Bot, gibt es dasselbe Ticket in Discord.

## Aufbau

```
server/
  index.js        HTTP, Seiten in zwei Sprachen, WebSocket, Verlängerungen
  config.js       Umgebung und Pfade          db.js         SQLite-Schema, Migrationen, Tarife
  auth.js         Sitzungen, Passwörter       billing.js    Credits, Tarife, Zusätze, Ledger
  binaries.js     Client + Fähigkeiten        supervisor.js ein Prozess je Bot, Zustandsautomat
  mslogin.js      Microsoft-Gerätecode        macros.js     Macros, Spam, Anti-AFK
  nodes.js        Standorte                   metrics.js    CPU, Speicher, Platte aus /proc
  features.js     die Funktionsliste der öffentlichen Seiten, gefiltert nach dem echten Client
  settings-schema.js  Beschreibung jeder Einstellung: Gruppe, Beschriftung, Erklärung, Art
  pages.js        Vorlagen                    landing.js    das Bewegliche der öffentlichen Seiten
  mail.js         SMTP, Vorlagen, Kategorien  oauth.js      Discord und Google
  tickets.js      Support                     notify.js     Discord-Webhooks
  roles.js        welche Discord-Rolle wem    bridge.js     die Leitung zum Bot
  routes/         core, profiles, billing, admin, bot
bot/
  index.js        der Discord-Bot             panel.js      seine Leitung zum Panel
  handlers/       tickets, roles, linkedRoles, commands
public/
  pages/          die festen Seiten als Vorlagen ({{> partial}} und {{schlüssel}})
  assets/js/i18n.js     alle Texte, beide Sprachen, von Server und Browser genutzt
  assets/js/chatlog.js  Chatzeilen zusammenlegen, §-Farben zerlegen – ebenfalls von beiden
  assets/js/views/      Übersicht, Konten, Server, Guthaben, Tickets, Proxys, Admin …
docs/             Standorte, Discord-Bot, Google-Anmeldung
scripts/
  build-movement.sh   baut die Bewegungs-Bauform (liegt nicht im Release)
data/                 Datenbank, Client-Dateien, Konten je Nutzer, Logs  (nicht im Repo)
```

## API

Alles unter `/api`, Sitzung im HttpOnly-Cookie.

| Bereich | Endpunkte |
| --- | --- |
| Anmeldung | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify`, `/auth/forgot`, `/auth/reset` |
| Discord/Google | `GET /auth/:provider/start` (`mode=link\|login\|verify`), `/auth/:provider/callback`, `DELETE /auth/:provider` |
| Eigenes | `GET/PATCH /me`, `GET/DELETE /me/sessions`, `POST /me/password`, `GET /me/mails`, `/me/discord-test` |
| Konten | `GET /accounts`, `POST /accounts/login` (Gerätecode), `POST /accounts/offline`, `DELETE /accounts/:id` |
| Serverplätze | `GET/POST /profiles`, `GET/PATCH/DELETE /profiles/:id`, `POST /profiles/:id/plan`, `/resume`, `/node` |
| Zusätze | `GET/POST /profiles/:id/addons`, `DELETE /profiles/:id/addons/:addonId` |
| Bots | `POST /profiles/:id/start`, `/stop`, `/restart` |
| Chat | `GET/POST /profiles/:id/chat`, `GET /profiles/:id/views`, `…/spam` |
| Im Spiel | `POST /profiles/:id/command` (`go`, `look`, `home`, `board`, `menu`, `click`, `sneak`, …) |
| Automatik | `…/macros` (GET/POST/PATCH/DELETE, dazu `/test`) |
| Guthaben | `GET /billing`, `POST /billing/voucher`, `POST /billing/topup` |
| Support | `GET/POST /tickets`, `GET /tickets/:id`, `/messages`, `POST /tickets/:id/reply`, `/status`, `/typing` |
| Sonstiges | `GET /announcements`, `GET /nodes` |
| Admin | `/admin/overview`, `/metrics`, `/users`, `/servers/:id` (samt Konsole), `/nodes`, `/plans`, `/addons`, `/topups`, `/vouchers`, `/proxies`, `/tickets`, `/announcements`, `/settings`, `/client/sync`, `/mails`, `/audit`, `/ledger` |
| Bot | `/bot/config`, `/bot/tickets`, `/bot/users/:discordId`, `/bot/roles`, `/bot/events`, `WS /bot/stream` |
| Live | `GET /api/ws` – WebSocket mit Chatzeilen, Zustandswechseln, Ansichten, Tickets, Guthaben |
