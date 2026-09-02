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
/en/privacy    /de/privacy      Datenschutzerklärung (Systemvorgabe, überschreibbar)
/en/terms      /de/terms        Nutzungsbedingungen (Systemvorgabe, überschreibbar)
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

Alle sichtbaren Texte stehen in **einer** Datei: `public/assets/js/i18n.js`, jeder Text in beiden
Sprachen nebeneinander. Node rendert daraus die festen Seiten; Fehlermeldungen der API kommen in
derselben Sprache zurück.

Der **Browser** bekommt daraus nur seine eine Sprache: `server/strings.js` rechnet beim Hochfahren
je Sprache ein eigenes Modul aus derselben Tabelle und liefert es unter
`/assets/v/<hash>/js/i18n.<sprache>.js` aus. Beide zu laden wären hundertdreißig Kilobyte, das
größte Stück auf dem Weg zum ersten Bild, und die Hälfte davon ungelesen. Wer einen Text ändert,
ändert trotzdem nur `i18n.js` – es gibt keine erzeugte Datei im Projekt und keinen Bauschritt, der
vergessen werden könnte.

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
* `deploy/afksystems-agent.service` + `deploy/install-agent.sh` – für einen **Standort**; beides
  gehört auf den anderen Rechner, nicht hierher (siehe [docs/standorte.md](docs/standorte.md)).
* `deploy/nginx-example.invalid.conf` – vHost samt WebSocket-Durchreichung für Live-Chat,
  Discord-Bot und Standorte; insbesondere `/api/bot/stream` und `/api/node/stream` dürfen nicht
  als normales HTTP-GET am Panel landen.

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
* Aufladen: **Stripe** (Karte, PayPal, Apple/Google Pay und alles Weitere), Gutschein,
  Überweisung/PayPal von Hand (Admin bestätigt), oder der Admin bucht direkt auf. Guthaben
  entsteht an genau einer Stelle im Code – dem geprüften Webhook. Einrichtung:
  **[docs/stripe.md](docs/stripe.md)**.
* Jede verbuchte Zahlung bekommt einen **Beleg** mit fortlaufender Nummer (`AFK-2026-0001`). Was
  darauf steht, wird im Moment der Buchung festgehalten und ändert sich danach nie wieder – siehe
  „Belege“ weiter unten.
* Stripe ist **kein Verkäufer im eigenen Namen**: Verkäufer bleibt der Betreiber. Preis, Beleg und
  Umsatzsteuer kommen deshalb aus dem Panel. Vorgabe ist die **Kleinunternehmerregelung** – keine
  Umsatzsteuer aufgeschlagen, keine ausgewiesen, dafür der Grund als Satz unter jedem Preis, an der
  Kasse und auf dem Beleg. Umstellbar unter Administration → Einstellungen → Umsatzsteuer.

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
| `pov` | Live-Ansicht – je Serverplatz buchbar, in keinem Tarif enthalten, auch nicht in Ultra |

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
sie fehlt – ein vergessener Download legt damit keine Bots still. Was **POV** und **Ultra** von den
übrigen unterscheidet, ist der Weltspeicher, aus dem die Live-Ansicht ihre Bilder rechnet; deshalb
bekommt sie nur, wer die Ansicht gebucht hat. Ein Ultra-Platz ohne Live-Ansicht läuft auf
`premium-items-afk-linux` – dieselben sichtbaren Fähigkeiten, ohne die Arbeit für ein Bild, das
niemand ansieht.

Alle Bauformen sprechen über `--mc` Minecraft 1.21.1, 1.21.11, 26.1 und 26.2. Nur ein vom Server
angeordneter Transfer auf einen Unterserver bleibt Teil derselben Sitzung. Tablist und Playerlist
gibt es in den Rust-Clients nicht mehr.

### Der Wiederanlauf gehört dem Panel (Client 2.6.0)

Ab Client 2.6.0 verbindet sich der Client nach einem Kick **von selbst** neu. Für ein Panel, das
selbst eine Aufsicht ist, wäre das eine zweite Antwort auf dieselbe Frage – deshalb schickt es
`--no-reconnect` mit, sobald die Bauform die Option kennt, und der Prozess endet nach einem Abbruch
wie eh und je mit Fehlerstatus.

Drei Gründe, jeder für sich ausreichend:

1. **Der Kunde hat das Sagen.** Wer `auto_reconnect` abschaltet, will einen Bot, der aus bleibt.
2. **Zwischen zwei Versuchen wird gerechnet.** Jeder Start prüft Laufzeit, Guthaben, Sperren,
   Kontogrenzen und die Discord-Mitgliedschaft des Gratis-Tarifs. Ein Platz, dessen Laufzeit nachts
   endet, liefe sonst bis zum Morgen weiter – bezahlt hat ihn niemand mehr.
3. **Aufgeben muss sichtbar sein.** Nach acht erfolglosen Versuchen bekommt der Kunde eine
   Nachricht. Ein Client, der still weiterprobiert, hat niemanden, der das meldet.

Einer älteren Bauform wird die Option **nicht** mitgegeben – eine unbekannte Option bricht den Start
ab, und dann liefe gar kein Bot mehr. Das ist dieselbe Regel wie bei jeder anderen Option: Was in
`--help` steht, wird benutzt; was dort fehlt, nicht.

### Texturen ohne Handarbeit (Client 2.6.0)

`--pov-resources` ist keine Pflicht mehr: Der Client sucht die Original-Client-JAR selbst – eigene
Ablage, vorhandene Minecraft-Installation, zuletzt Mojang über dasselbe Versionsmanifest wie der
Launcher, mit Prüfung der SHA-1. Damit gibt es die texturierte Live-Ansicht auch dort, wo der
Betreiber nie eine Datei hinterlegt hat.

Das Panel hinterlegt sie trotzdem lieber selbst und schickt den Pfad mit: Eine Datei unter `data/mc`
gilt für **alle** Kunden dieser Maschine, während die Selbsthilfe des Clients unter
`XDG_CONFIG_HOME` landet – und das ist hier das Verzeichnis *eines* Kunden. Bei dreißig Kunden mit
Live-Ansicht wären das dreißigmal dieselben dreißig Megabyte.

### Eine neue Fassung erreicht laufende Bots nicht von selbst

Der Stundentakt holt jedes neue Release aus `gravijet/HugoAFKClient` und legt die Dateien nach
`data/bin`; die Standorte holen sich dieselben über ihre Leitung. Ein **laufender** Bot wechselt
dabei nicht mit: Ein Prozess hält seine Datei offen und merkt von der Ablösung nichts. Wer seit drei
Wochen im Spiel sitzt, sitzt dort mit dem Client von vor drei Wochen.

Das ist Absicht und keine Nachlässigkeit – ein Neustart wirft einen Bot aus dem Spiel, auf Servern
mit Warteschlange kostet das den Platz darin, und den Zeitpunkt dafür soll ein Mensch wählen.
Sichtbar muss es trotzdem sein, und dafür merkt sich jeder Bot beim Start einen **Abdruck** seiner
Datei (Größe und Änderungszeit, dazu die Fassungsnummer). Weicht er später von dem ab, was auf der
Platte liegt, steht das an drei Stellen:

* am Bot selbst in der Kontenliste (`Client 2.5.0`),
* als Hinweis über dem Reiter *Verbinden* mit einem Knopf, der genau die betroffenen Bots dieses
  Platzes neu startet,
* unter *Administration → Client* für alle Konten auf einmal, nach Fassung aufgeschlüsselt.

Beide Knöpfe starten gestaffelt (drei bzw. fünf Sekunden Abstand): Zwanzig Bots, die im selben
Augenblick beim selben Minecraft-Server anklopfen, sehen von dort aus wie ein Angriff, und die
üblichen Schutzmaßnahmen träfen genau die, die gerade wiederkommen wollten.

Kommt eine neue Fassung an, sagt der Systembericht das auch von sich aus (Discord-Webhook des
Betreibers) – samt der Zahl, wie viele Bots noch mit der alten laufen. Die Fassungsnummer allein
wäre als Merkmal zu grob: Ein neuer Bau derselben Nummer wäre daran nicht zu erkennen.

## Standorte

Ein Standort ist eine **Maschine, auf der Bots laufen**. Dort werden CPU, Arbeitsspeicher und
Platte verbraucht, und genau die begrenzt ein Standort auch: Neben "höchstens so viele Bots" gibt
es "höchstens so viel CPU" und "höchstens so viel Speicher", gemessen und nicht geschätzt.

Ein **Proxy** ist etwas anderes: nur eine Ausgangsadresse, ohne eigene Rechenleistung. An einem
Proxy steht deshalb nie eine Auslastung.

| Art | Bedeutung |
| --- | --- |
| `local` | diese Maschine. Gibt es genau einmal, nicht löschbar, nicht abschaltbar |
| `agent` | ein anderer Rechner mit `agent/index.js` darauf – der Normalfall |
| `egress` | kein eigener Rechner: die Bots bleiben hier und gehen über einen Proxy hinaus |

Der Standort **ruft beim Panel an**, nicht umgekehrt (`WS /api/node/stream`, Token am Standort).
Damit braucht ein neuer Rechner weder eine öffentliche Adresse noch ein Zertifikat noch eine
Portfreigabe – nur ausgehendes HTTPS. Über dieselbe Leitung holt er sich die Client-Dateien, bekommt
Bots zugewiesen, reicht deren Ein- und Ausgabe durch und meldet alle 15 Sekunden seine Auslastung.

Die Microsoft-Anmeldungen reisen beim Start eines Bots mit und kommen aufgefrischt zurück – ohne
das müsste dasselbe Konto auf jedem Standort einzeln verbunden werden.

`agents.js` verpackt das in einen `RemoteProcess`, der sich verhält wie ein Kindprozess von
`child_process`. Der Supervisor merkt deshalb nicht, wo sein Bot läuft.

Einrichten Schritt für Schritt: **[docs/standorte.md](docs/standorte.md)**.

## Discord

Zwei Dinge, die unabhängig voneinander laufen:

* **Anmelden und Verknüpfen** (`server/oauth.js`) – braucht nur Client-ID und Secret. Dasselbe
  Modul bedient Google. Wer sich mit Discord oder Google anmeldet und noch kein Konto hat, bekommt
  eines; die Adresse kommt vom Anbieter.
* **Der Bot** (`bot/`) – ein eigener Dienst. Tickets laufen in beide Richtungen (samt Anhängen),
  Rollen folgen dem Tarif. Er hat keine eigene Konfiguration: Server-ID, Kanäle, Rollen und sein
  Token holt er sich beim Start aus dem Panel, damit er sich ohne Änderung woanders hinstellen
  lässt. Ein Ticket macht man am **Knopf im Support-Kanal** auf – Slash-Befehle dafür gibt es
  bewusst nicht.

### Erwähnungen sehen aus wie Erwähnungen

Discord verschickt Erwähnungen als Zahlen: `<@1538…>` ist eine Person, `<#1538…>` ein Kanal,
`<@&1538…>` eine Rolle. Im Discord-Client steht daran ein Name, im Panel stand eine zwanzigstellige
Zahl mitten im Satz.

Auflösen kann das nur, wer den Server sieht – der Bot. Er schickt zu jeder übernommenen Nachricht
mit, **welche Zahl welchen Namen hatte**, und zwar zum Zeitpunkt der Nachricht: Ein Kanal, der
später umbenannt oder gelöscht wird, ändert den Verlauf damit nicht, genauso wenig wie in Discord.
Die Zuordnung steht an der Nachricht (`ticket_messages.mentions`), gerendert wird sie in
`public/assets/js/discord.js` – zusammen mit allem anderen, was ein Discord-Nutzer benutzt, ohne
darüber nachzudenken: `**fett**`, `||Spoiler||`, Zitate, Listen, Codeblöcke, eigene Emoji und
Zeitstempel (`<t:…>`, in der Zeitzone dessen, der sie liest). Der Text selbst kommt dabei durch
genau eine Tür ins HTML, nämlich durch `escapeHtml`.

### Der Webhook meldet das System, nicht die Tickets

Der Webhook des Betreibers meldete früher neue Tickets und jede Antwort darauf. Das war die vierte
Kopie einer Nachricht, die schon im Panel stand, mit einer Zahl in der Seitenleiste, und – sobald
der Bot läuft – als eigener Kanal, in dem das Gespräch tatsächlich stattfindet. Ein Kanal, der
ständig rauscht, wird nicht mehr gelesen, auch dann nicht, wenn dort einmal etwas steht.

Er heißt deshalb **Webhook für Systemmeldungen** und meldet, was sonst nirgends steht:

* Ein **Lagebericht** im eingestellten Takt (Vorgabe: alle zwölf Stunden) – CPU, Speicher, Platte,
  Standorte, laufende Bots, Konten, offene Tickets und Aufladungen, Client-Stand, letzte Sicherung
  und jede wiederkehrende Aufgabe, die zuletzt gescheitert ist.
* **Warnungen sofort**, höchstens einmal am Tag je Sache: Platte fast voll, Speicher fast voll, ein
  Standort meldet sich nicht, keine Client-Datei, eine Aufgabe scheitert.
* Was beim **Bezahlen nicht zusammenpasst**: Betrag oder Konto stimmen nicht, eine Erstattung, ein
  Streitfall. Das sind die einzigen Meldungen über Geld, und sie stehen dort, weil sie einen
  Menschen brauchen.

Dieselbe Liste steht ohne Webhook unter *Administration → System*, mit einem Knopf „Bericht jetzt
schicken“ daneben – die häufigste Frage an einen Webhook ist, ob überhaupt etwas ankommt.

Anleitungen: **[docs/discord-bot.md](docs/discord-bot.md)** und
**[docs/google-anmeldung.md](docs/google-anmeldung.md)**.

## Post

`server/mail.js` kennt Vorlagen für alles, was ein Kunde erfahren soll: Adresse bestätigen, **neue
Adresse bestätigen**, Passwort zurücksetzen, Anmeldung von einem neuen Gerät, Aufladung
gutgeschrieben, Platz verlängert, Platz läuft ab, Platz stillgelegt, Guthaben knapp, Ticket
angelegt/beantwortet/geschlossen, **Konto zur Löschung vorgemerkt**, Ankündigung, Nachricht von Hand.

Jede Nachricht gehört zu einer **Kategorie**, und der Kunde stellt in seinen Einstellungen ein,
welche er will. Zwei lassen sich nicht abbestellen: was das Konto absichert und was ohne Nachricht
gar nicht ginge.

Was verschickt wurde, steht in `mails` – **mit Empfänger und Wortlaut**. Der Kunde sieht seine
eigenen Nachrichten unter *Einstellungen → Nachrichten an dich*. Wer eine E-Mail mit unserem Namen
bekommt und sich fragt, ob sie echt war, prüft das dort ohne Rückfrage.

## Das eigene Konto

Ein Konto war lange eine E-Mail-Adresse und ein Benutzername. Für einen Dienst, der Geld einnimmt,
ist das zu wenig – auf einen Beleg gehört, an wen geleistet wurde. Unter **Einstellungen** steht
deshalb alles, was zu einem Konto gehört, in sechs Reitern statt in vier Kästen untereinander:

| Reiter | Was dort steht |
| --- | --- |
| **Konto** | Bild, Benutzername, E-Mail-Adresse, Sprache, verknüpfte Konten (Discord, Google) |
| **Persönliche Daten** | Name, Telefon, Zeitzone – und die Rechnungsadresse samt Firmierung und USt-IdNr. |
| **Nachrichten** | welche E-Mails kommen, was der eigene Discord-Webhook meldet, und was schon verschickt wurde |
| **Sicherheit** | Passwort, Zwei-Faktor-Anmeldung, Anmeldecode, bekannte Browser, angemeldete Geräte, die letzten Anmeldeversuche |
| **Darstellung** | Farbschema, Abstände, Bewegung, Startseite – alles nur auf **diesem** Gerät |
| **Deine Daten** | alles herunterladen oder das Konto löschen |

Drei Dinge daran sind keine Formularfelder, sondern Abläufe:

* **Der Benutzername** steht unter jeder Ticketantwort, in Discord und in den Protokollen. Er lässt
  sich ändern, aber nur **alle 30 Tage** – ein Name, der stündlich wechselt, macht jeden Verlauf
  unlesbar. Nur die Groß-/Kleinschreibung zu ändern gilt nicht als „vergeben“.
* **Die E-Mail-Adresse** braucht das Passwort und eine **Bestätigung an der neuen Adresse**. Bis
  dahin bleibt die alte in Kraft; ein Tippfehler sperrt also niemanden aus. Die alte Adresse bekommt
  dabei eine Nachricht – sie ist die einzige Warnung, wenn jemand anderes gerade ein Konto übernimmt.
* **Die Zwei-Faktor-Anmeldung** (Einstellungen → Sicherheit) ist der zweite Faktor, der der
  Anmeldecode ausdrücklich nicht ist: sechs Ziffern aus einer Authenticator-App, gerechnet nach
  RFC 6238 aus einem Geheimnis, das nur auf dem Gerät des Kunden und – verschlüsselt – in der
  Datenbank liegt. Eingerichtet wird sie mit dem Passwort, einem QR-Code und einer Probe: Erst
  wenn die App einen richtigen Code liefert, geht sie scharf. Wer sie einschaltet, bekommt einmal
  zehn **Wiederherstellungscodes** – der Weg zurück, wenn das Telefon weg ist. Sie gilt an allen
  drei Türen, und die dritte ist die wichtige:

  | Wo | Was |
  | --- | --- |
  | Anmeldung mit Passwort | jedes Mal, nicht nur bei neuen Browsern |
  | Anmeldung über Discord oder Google | ebenso – sonst wäre ein übernommenes Discord-Konto der Weg vorbei |
  | Passwort zurücksetzen | ebenso – sonst bliebe das Postfach ein Generalschlüssel |

  Ist sie an, fragt der Anmeldecode nicht mehr: Der stärkere Schritt enthält den schwächeren, und
  zwei Formulare hintereinander bringen keine Sicherheit dazu. Das Panel schreibt das auch so
  hin, statt einen Schalter stehen zu lassen, der nichts mehr tut.
* **Der Anmeldecode** (Einstellungen → Sicherheit) macht aus einer Anmeldung zwei Fragen. Stimmt das
  Passwort und ist der Browser einer, den dieses Konto noch nie benutzt hat, kommt keine Sitzung,
  sondern eine Wartemarke: sechs Ziffern per E-Mail, fünfzehn Minuten gültig, fünf Versuche.
  Vorgabe ist **an**; wer ihn nicht will, schaltet ihn ab. Was er leistet, steht auch so im Panel:
  Ein gestohlenes Passwort allein reicht nicht mehr. Was er **nicht** ist, ebenso – ein zweiter
  Faktor wäre etwas anderes, denn der Code geht an dieselbe Adresse, über die auch „Passwort
  vergessen“ läuft. Er ist nie eine Falle: Ohne eingerichteten Postausgang bleibt er wirkungslos,
  und wenn eine Nachricht gerade nicht hinausgeht, meldet die Anmeldung ganz normal an. Ein
  klemmender Mailserver darf niemanden aus seinem eigenen Konto aussperren.
* **Bekannte Browser** sind die, die den Code schon einmal beantwortet haben. Erkannt werden sie an
  einem Zufallswert in einem eigenen, langlebigen Cookie – **nicht** an der Browserkennung: „Chrome
  auf Windows“ schicken Millionen zeichengleich, und sie ändert sich bei jeder Aktualisierung.
  Abmelden entfernt keinen davon, *vergessen* schon; jeder Passwortwechsel und jedes Zurücksetzen
  vergisst alle auf einmal. Der Grund dafür ist derselbe wie beim Wechsel selbst: Wer ihn vornimmt,
  glaubt oft, jemand anderes kenne das alte Passwort – und der sitzt vielleicht an einem Browser,
  der bis eben als bekannt galt.
* **Konto löschen** hat eine Frist von 14 Tagen. Der Wunsch steht an, die Bots gehen sofort aus
  (und lassen sich bis zum Stichtag auch nicht wieder starten), gelöscht wird nichts. Ein Klick holt
  alles zurück. Danach geht das Konto mit allem: Serverplätze, Minecraft-Konten, Tickets, Guthaben,
  Dateien. Ein Administrator kann sich hier nicht selbst löschen – sonst bliebe niemand, der andere
  hereinlässt.

**Der Datenexport** (`GET /api/me/export`) ist eine Datei und keine Ansicht: Konto, Serverplätze,
Minecraft-Konten, Buchungen, Aufladungen, Tickets samt Verlauf, verschickte Nachrichten,
Benachrichtigungen, Sitzungen und Protokoll. Nicht darin: Passwort-Hash, Sitzungs-Token,
Bestätigungsmarken und die Microsoft-Anmeldungen. Das sind Schlüssel und keine Auskunft – wer die
Datei weitergibt, gäbe sonst den Zugang weiter statt der Auskunft.

**Profilbilder** kommen von Discord, wenn es verknüpft ist – dasselbe Gesicht wie im Support-Kanal.
Sonst zeichnet das Panel selbst: Anfangsbuchstabe auf einer Farbe, die aus dem Namen gerechnet ist
und deshalb überall dieselbe bleibt. Ein Gravatar kommt nicht in Frage; das wäre die E-Mail-Adresse
des Kunden, bei jedem Seitenaufruf an einen Dritten geschickt.

## Belege

Bis dahin war der einzige Nachweis über eine Zahlung eine E-Mail. Wer sie gelöscht hat, wer keine
bekommen konnte (kein SMTP) oder wer sie seiner Buchhaltung geben muss, stand ohne da – und die
Bestätigung von Stripe ist kein Beleg des Verkäufers, denn Verkäufer ist der Betreiber.

Jede verbuchte Aufladung bekommt deshalb im selben Moment eine **fortlaufende Nummer** je Jahr und
einen **Abzug** dessen, was darauf steht: Anschrift, Firmierung, USt-IdNr. und der Umsatzsteuersatz,
der damals galt – dazu die Sprache, in der er galt. Wer im Januar unter seiner alten Anschrift
gekauft hat und im März umzieht, hat trotzdem im Januar unter der alten gekauft; ein Beleg, der auf
das Konto verweist, änderte rückwirkend jede Rechnung des Vorjahres.

Das Dokument selbst (`GET /api/billing/receipts/:id`) ist eine **eigenständige HTML-Seite**: alle
Marken darin, kein Stylesheet von außen, kein JavaScript. Am Bildschirm sieht sie aus wie das
Panel, auf Papier ist sie schwarz auf weiß, und der Browser macht daraus ein PDF. Wer verkauft,
steht unter *Administration → Einstellungen → Verkäufer und Belege*; ohne diese Angaben trägt der
Beleg nur die Marke, und das ist auf einer Rechnung zu wenig.

## Der Serverplatz

Ein Serverplatz ist ein Zielserver, ein Tarif und ein paar Konten, die dort sitzen. Drei Dinge daran
sind neu und beantworten Fragen, die vorher offen blieben.

### Läuft der Minecraft-Server überhaupt?

„Mein Bot kommt nicht rein“ hat zwei mögliche Ursachen, und die eine liegt nicht bei uns. Im Panel
stand dazu bisher nur „Verbindung abgelehnt“ – damit fing die Suche beim Minecraft-Konto an, ging
über den Client und endete oft bei der Erkenntnis, dass der Zielserver seit einer Stunde aus ist.

Unter der Kontenliste im Reiter *Verbinden* steht deshalb, wie es dem **Zielserver** geht: MOTD in
seinen Farben, Spielerzahl, Version, Serversymbol und die Antwortzeit. Gefragt wird mit derselben
Abfrage, die auch der Minecraft-Launcher für seine Serverliste benutzt (Server List Ping) – kein
Beitritt, kein Konto, keine Anmeldung bei Mojang. Ohne ausdrücklichen Port wird vorher der
SRV-Eintrag `_minecraft._tcp.<host>` aufgelöst, genau wie es der Spielclient tut; ohne das fragte
das Panel Port 25565 auf einer Adresse, an der niemand lauscht, und meldete „offline“ für einen
Server, der bestens läuft.

Antwortet er nicht, steht der Grund im Klartext dabei: keine Adresse (DNS), nichts auf diesem Port,
keine Antwort (aus oder Firewall), Verbindung abgebrochen. Die Abfrage läuft einmal beim Öffnen des
Reiters und sonst auf Knopfdruck, mit fünfzehn Sekunden Zwischenspeicher – der Server gehört jemand
anderem, und ein Panel, das ihn im Sekundentakt anpingt, weil ein Fenster offen steht, ist aus
seiner Sicht kein Besucher mehr. Was von dort zurückkommt, ist Text und ein Bild von einem Fremden:
Jedes Feld wird einzeln herausgenommen und beschnitten, das Serversymbol muss ein PNG sein, und die
Namensliste endet nach zwölf Einträgen.

### Warum ist dieser Platz so eingestellt?

Serverplätze hatten Felder für alles, was ein Programm braucht, und keines für das, was ein Mensch
braucht. Wer sechs davon hat, hat sechs Namen und keine Erinnerung daran, warum auf diesem hier die
Sichtweite auf 12 steht. Unter *Einstellungen* steht deshalb ein freies **Notizfeld**. Es wird nicht
ausgewertet, nicht durchsucht, und der Bot bekommt es nie zu sehen.

### Denselben Aufbau noch einmal

Wer einen Platz eingerichtet hat, hat oft eine halbe Stunde investiert: fünfzehn Macros, ein
Zeitplan, vier wiederkehrende Nachrichten, Wartezeiten, die auf genau diesen Server passen.
**Kopieren** (Einstellungen → Diesen Platz kopieren) legt einen neuen Platz mit alldem an – Name und
Adresse frei wählbar, Tarif vorausgewählt wie beim Original.

Zwei Dinge kommen bewusst nicht mit. Die **Minecraft-Konten**: Ein Konto kann nur in einem Spiel
gleichzeitig sein, kopiert stünde es auf zwei Plätzen, und der zweite Start würde abgewiesen. Und
die **Zusätze**: Sie sind bezahlt, je Platz, und eine Kopie, die ungefragt Zusätze mitbucht, bucht
ungefragt Geld ab. Die Kopie selbst ist ein Serverplatz wie jeder andere und kostet, was ihr Tarif
kostet.

## Zeitpläne

Ein AFK-Bot soll oft nicht rund um die Uhr sitzen, sondern zu bestimmten Zeiten. Das ging bisher nur
von Hand, also gar nicht: Wer um sechs Uhr starten will, steht nicht um sechs Uhr auf, um auf einen
Knopf zu drücken.

Im Reiter **Zeitplan** eines Serverplatzes steht deshalb eine Uhrzeit, eine Auswahl von Wochentagen
und was passieren soll (starten, stoppen, neu starten) – wahlweise für ein Konto oder für alle.
Bewusst keine cron-Zeile: „0 6 * * 1-5“ ist eine Sprache, die man lernen muss und die genau eine
falsche Stelle braucht, um etwas anderes zu tun.

Gerechnet wird in der **Zeitzone des Kontos** (Einstellungen → Persönliche Daten). Sechs Uhr heißt
sechs Uhr dort, wo der Kunde wohnt, und nicht dort, wo zufällig der Server steht. Ein verpasster
Zeitpunkt wird bis zu einer Viertelstunde nachgeholt – das fängt einen Neustart ab, ohne dass ein
Server, der einen halben Tag aus war, beim Hochfahren zwölf Stunden alte Pläne abarbeitet. Was ein
Zeitplan zuletzt bewirkt hat, steht an ihm; auch die Absage, wenn das Guthaben nicht reichte.

## Wiederanlauf

Ein AFK-Bot, der nachts um drei rausfliegt und am Morgen aus ist, hat seinen Zweck verfehlt. Der
Client kennt keinen eigenen Reconnect: Nach einem Kick oder einem Netzabbruch beendet er sich, und
bis hierher löschte das Panel damit auch gleich den Startwunsch.

Ab jetzt entscheidet eine einzige Frage, und sie steht auch so im Panel: **war der Bot vorher im
Spiel?**

* **Ja** – dann ist das Aus eine Störung, und die Verbindung kommt zurück. Erster Versuch nach fünf
  Sekunden, danach verdoppelt sich die Wartezeit bis zu einer Minute, höchstens acht Versuche
  hintereinander. Beides ist je Serverplatz einstellbar.
* **Nein** – dann ist es eine Absage. Falsche Adresse, falsche Version, Bann, Whitelist: Ein
  zweiter Versuch scheitert genauso, und ein Panel, das trotzdem weiterstartet, ist für den
  Minecraft-Server nicht von einem Angriff zu unterscheiden. Der Bot bleibt aus.

Wer fünf Minuten am Stück gestanden hat, hat die Versuchskette hinter sich: Der nächste Ausfall
fängt wieder bei Versuch eins an. Wer achtmal in Folge scheitert, bleibt aus – und bekommt eine
Nachricht, denn ein Wiederanlauf, der still aufgibt, sieht aus wie ein Bot, der einfach weg war.

Derselbe Mechanismus deckt den **Neustart der ganzen Maschine** ab. Der Startwunsch steht in der
Datenbank, die systemd-Einheit fährt das Panel wieder hoch, und beim Hochfahren wird jeder offene
Wunsch eingelöst. Es gibt dafür keinen zweiten Weg und keine zweite Einstellung.

## Macros

Ein Macro ist ein Auslöser und eine Kette von Schritten. Auslöser sind Beitritt, **Wiederkehr**,
Zeittakt, Chatzeile, Weltwechsel, Tod, ein aufgehendes **Menü** und der Verbindungsabbruch. Die
Wiederkehr ist dabei der Auslöser, den man erst vermisst, wenn man ihn braucht: Nach einem Kick ist
oft etwas anderes zu tun als beim ersten Beitritt.

Die Schritte reichen von „Chatzeile senden“ bis „neu verbinden“: laufen, blicken (nach Winkel oder
nach Himmelsrichtung), springen, fallen lassen, Heimatposition und Wegpunkte, schleichen, sprinten,
Menüfelder anklicken, Anzeigetafel/Inventar/Menü abfragen, Anti-AFK schalten, die Live-Ansicht
starten, ein anderes Macro aufrufen, alle laufenden abbrechen – und **mir Bescheid geben**, damit
ein Macro auf „du wurdest gebannt“ nicht nur eine Zeile im Verlauf hinterlässt.

Drei Zahlen machen daraus etwas, das nicht wie ein Automat aussieht, und alle drei haben denselben
Hintergrund: Ein Server, der etwas für Spam hält, wirft den Bot dafür raus.

| | Vorgabe | Wofür |
| --- | --- | --- |
| **Sperrzeit** | 0 (jedes Mal) | Der Server wiederholt die auslösende Zeile im Sekundentakt |
| **Wahrscheinlichkeit** | 100 % | Eine Antwort, die immer auf die Millisekunde gleich kommt |
| **Streuung** | 0 (exakt) | „alle 300 s“ ist ein Muster, „alle 300 s ± 30 s“ ist keines |

In jedem Text stehen Platzhalter zur Verfügung: `{line}` ist die auslösende Zeile, `{player}` das
Konto, `{server}` der Serverplatz, `{1}` bis `{9}` sind die Gruppen des regulären Ausdrucks. Damit
wird aus „wer hat geschrieben“ eine Antwort an genau den.

Wer taktet, entscheidet sich an einer Stelle: Eine reine Chatkette ohne Sperrzeit, Zufall, Streuung
und Ausschluss gibt der Client selbst ab (`--cmd`, `--on`) – er sieht Beitritt, Tod und Weltwechsel
im Protokoll und nicht im Meldungstext. Alles andere taktet das Panel. Diese Frage wird **einmal**
beantwortet; zwei Antworten hießen, dass ein Macro doppelt läuft.

## Was zu tun ist

Die **Übersicht** beginnt mit dem, was gerade offen ist: eine Antwort im Support, die auf eine
Reaktion wartet, eine Überweisung mit noch nicht eingegangenem Betrag, ein stillgelegter
Serverplatz, ein Minecraft-Konto, dessen Anmeldung nicht mehr taugt, ein Gratis-Platz ohne
Discord-Mitgliedschaft. Keine eigene Seite – wer das Dashboard öffnet, sieht es sofort, und in der
Seitenleiste steht die Zahl daneben.

Berechnet wird die Liste an einer Stelle: `server/todos.js`. Sie kommt mit `GET /api/me`, damit
die Übersicht sie ohne zweite Anfrage hat. Was nicht offen ist, steht nicht da – ist gar nichts
offen, fehlt der ganze Abschnitt. Ein Kasten, der jeden Tag „alles in Ordnung“ sagt, wird nach
einer Woche nicht mehr gelesen.

## Live-Ansicht

Sehen, was der Bot sieht. Minecraft überträgt keine fertigen Bilder – der Client rechnet sie aus
den geladenen Chunk-Paletten, Blockänderungen und Entities selbst aus. Seit Client 2.5.0 auf zwei
Wegen, und beide stehen nebeneinander:

* **Texturiert.** Der Client führt je Bot einen kleinen HTTP-Viewer auf seinem Localhost
  (`--pov-web`) und zeichnet daraus fertige PNG-Bilder mit den **echten Blockmodellen und Texturen
  des Spiels**, dazu Hotbar, Inventar und das offene Menü als Daten. Das Panel reicht die Anfragen
  seiner Kunden durch – der Viewer ist aus dem Netz nicht erreichbar, und sein Zugriffstoken
  verlässt das Panel nie.
* **Voxel.** Dasselbe Bild als Raster aus Halbblöcken (`▀`) mit je einer Vorder- und einer
  Hintergrundfarbe: **ein Zeichen sind zwei Bildpunkte**. Das Panel zerlegt jede Zeichenzeile in
  ihre zwei Bildzeilen aus Farbläufen und zeichnet sie auf ein Canvas. Fest 160 × 80, höchstens
  fünf Bilder je Sekunde.

Der texturierte Weg braucht die **Original-Client-JAR von Minecraft** je Protokollversion. Die
liefern wir nicht mit und dürfen es nicht; sie liegt unter `data/mc/<version>.jar` und wird im
Panel eingerichtet (**Administration → Client → Minecraft-Ressourcen**, hochladen oder von Mojang
holen). Fehlt sie, bleibt es bei der Voxelansicht – kaputt ist dabei nichts.

Gesteuert wird in beiden Fällen **im Bild**: WASD zum Laufen, Maus zum Drehen, `1`–`9` für die
Schnellleiste, Klick auf ein Menüfeld. Dahinter stecken dieselben örtlichen Befehle wie im Reiter
„Bewegung“.

Gebucht wird sie als Zusatz je Serverplatz (`pov`), in keinem Tarif enthalten – auch nicht in
Ultra. Im Voxelbetrieb hört sie beim Verlassen des Reiters und spätestens zwanzig Sekunden nach der
letzten geschlossenen Verbindung von selbst auf; texturiert erledigt sich das von selbst, weil dort
nur gerechnet wird, was ein Browser auch abholt.

Wie weit die Welt reicht, entscheidet die **Sichtweite** (`--view-distance`, je Serverplatz
einstellbar): Was der Server nie geschickt hat, kann der Client nicht zeichnen.

Einzelheiten: **[docs/live-ansicht.md](docs/live-ansicht.md)**.

**Bedrock** bleibt außen vor: Dafür wäre ein eigener Protokollstapel und damit ein zweiter Client
nötig.

## Support und Proxys

Proxys gehören dem Betreiber und werden **von Hand zugeteilt**: Ein zahlender Kunde macht ein Ticket
auf und schreibt dazu, für welchen Serverplatz, der Admin legt den Proxy an und weist ihn zu. Auf dem
Gratis-Platz gibt es keine. Danach lässt sich je Konto im Reiter „Proxys“ des Serverplatzes einer
auswählen.

Ein Ticket ist ein Gespräch: Nachrichten laufen live ein, man sieht, wenn das Gegenüber schreibt,
und eine Antwort auf ein geschlossenes Ticket macht es wieder auf. Gefragt wird nach **Betreff und
Text**, sonst nichts – die Kategorie davor („Allgemeine Frage“, „Missbrauch melden“) war ein
Pflichtfeld, das nichts entschieden hat. **Screenshots und Dateien bis 20 MB** hängen an der
Nachricht, im Panel wie im Discord-Kanal und in beide Richtungen abgeglichen. Mehrere Kunden dürfen
an einem Ticket hängen; das Team kann jemanden dazuholen. Läuft der Bot, gibt es dasselbe Ticket in
Discord – und zwar immer: Was die Meldung an den Bot verpasst, legt sein stündlicher Abgleich nach.

Ein Ticket hat **drei Zustände, und jeder sagt, wer am Zug ist**: *offen* liegt bei uns,
*beantwortet* beim Kunden, *geschlossen* bei niemandem. Die Warteschlange des Teams sind genau die
offenen – nicht die ungelesenen: Ein Ticket ist nicht erledigt, weil es jemand aufgemacht hat.
Davon getrennt steht der Punkt „Neu“ an der Zeile; er sagt, dass etwas Ungelesenes dasteht, und
verschwindet beim Lesen. (Einen vierten Zustand *wartet* gab es einmal. Er hieß im Panel „Wartet
auf dich“ und war damit *beantwortet* unter anderem Namen – zwei Wörter für eine Sache, von denen
irgendwann eines falsch dasteht.) Die **Dringlichkeit** setzt allein das Team; was gesetzt wurde,
steht als Zeile im Verlauf und damit auch im Discord-Kanal.

Neben dem Ticket gibt es eine **Kontakt-Adresse** (Administration → Einstellungen → Betrieb). Sie
steht im Fuß jeder öffentlichen Seite, über den eigenen Tickets und als Antwortadresse in jeder
Nachricht, die das Panel verschickt. Ein Ticket bleibt der bessere Weg – es hat einen Verlauf und
weiß, um welchen Serverplatz es geht –, aber wer kein Konto hat oder nicht mehr hineinkommt, kann
keines aufmachen.

## Für den Betreiber

Der Admin-Bereich ist nach vier Bündeln sortiert – Tagesgeschäft, Tarife und Geld, Plattform,
Protokolle und Zustand – und nicht nach siebzehn Reitern in einer Zeile. Was nicht selbsterklärend
ist, steht ausführlich in **[docs/verwaltung.md](docs/verwaltung.md)**; die Kurzfassung:

| Werkzeug | Wofür |
| --- | --- |
| **Strg+K** | Suche über alles: Nutzer, Serverplätze, Accounts, Tickets, Gutscheine, Standorte, Aufladungen – ein Anhaltspunkt genügt |
| **Betrieb** | alle laufenden Bots über alle Standorte hinweg, dazu die wiederkehrenden Aufgaben mit letztem Lauf, Dauer, Fehler und einem Knopf „jetzt laufen“ |
| **Sicherheit** | Anmeldeversuche, die Bremse gegen Passwort-Raten, Adresssperren (auch als Netz, auch IPv6), offene Sitzungen |
| **Sicherungen** | eine am Tag von selbst, dazu auf Knopfdruck; als Datei zum Mitnehmen |
| **Massenaktionen** | Guthaben, Sperren, Abmelden, Bots stoppen – für die ganze gefilterte Auswahl |
| **CSV** | jede große Liste als Tabellendatei, mit ISO-Zeiten und ohne Excel-Formeln |
| **Textbausteine** | die vier Sätze, die ein Support jeden Tag schreibt – mit `{name}` und `{ticket}` |
| **Rundmail** | eine Nachricht an einen von sechs Empfängerkreisen, jeder mit seiner Zahl daneben |
| **Erstatten** | Stripe-Zahlung zurückgeben, ohne das Panel zu verlassen |
| **Systemmeldungen** | was gerade auffällt – und ein Knopf, der den Lagebericht sofort in den Discord-Kanal schickt |

Zwei Regeln ziehen sich durch: **Was nicht geht, wird übersprungen und aufgezählt**, nicht mitten
in einer Massenaktion abgebrochen. Und **niemand sperrt sich selbst aus** – weder aus dem eigenen
Konto noch über die eigene Adresse.

## Was von außen abprallt

Nichts davon ist eine Funktion, die jemand anklickt – es sind die Annahmen, unter denen der Rest
überhaupt gilt. Deshalb stehen sie hier zusammen und nicht verstreut in den Bereichen, zu denen sie
gehören.

| Wogegen | Was dagegen steht |
| --- | --- |
| **Passwort raten** | Zehn Fehlversuche je Adresse und zwanzig je Konto in einer Viertelstunde, danach eine Absage statt einer Prüfung. Der Zähler steht **vor** dem Hashen: Wer gebremst wird, bekommt die teure Rechnung gar nicht erst. |
| **Anfragen fluten** | Eine Bremse über die ganze API (900 Anfragen je Minute und Adresse) und eine engere über die Anmeldung – je Endpunkt *und* je Adresse insgesamt, sonst wechselt man einfach den Pfad. Die Dienst-Bereiche (Bot, Standorte, Stripe) bleiben außen vor; sie sprechen im Takt ihrer eigenen Ereignisse. |
| **Token raten** | Das gemeinsame Geheimnis des Bots und das Token eines Standorts sind nach zwanzig Fehlversuchen je Adresse und Viertelstunde zu – über HTTP wie über den WebSocket-Aufbau, denn eine verriegelte Tür neben einer offenen ist keine. |
| **Zu leichte Passwörter** | Zwölf Zeichen sind die Untergrenze, nicht der Maßstab: Eine Handvoll bekannter Muster und alles, was den eigenen Benutzernamen oder Postfachnamen enthält, wird abgelehnt – auch dann, wenn ein Administrator es setzt. |
| **Fremde Websites** | Schreibende Aufrufe brauchen `Origin` oder `Sec-Fetch-Site` von dieser Website. Fehlt beides, ist es ein Nein. Dazu `SameSite=Lax`, `HttpOnly` und `Secure` auf jedem Cookie. |
| **Ein liegengebliebener Generalschlüssel** | „Als Nutzer ansehen“ gilt **eine Stunde**, nicht dreißig Tage. Wer länger braucht, drückt noch einmal – und das steht dann auch noch einmal im Protokoll. |
| **Eine kopierte Datenbank** | Sitzungen, Rücksetzlinks und Gerätemerkmale liegen nur als HMAC darin. Die Datei selbst, ihr Schreibprotokoll und jede Sicherung werden bei jedem Start auf `0600` gezogen, die Verzeichnisse darunter auf `0700`. |
| **Ein bösartiger Minecraft-Server** | Die Antwort eines Zielservers wird der Größe nach gedeckelt und der Tiefe nach begrenzt: Eine tausendfach geschachtelte Abschiedsmeldung darf nicht den Prozess umwerfen, der jeden laufenden Bot hält. |
| **Eine Leitung, die niemand schließt** | Höchstens zwölf WebSocket-Verbindungen je Konto; eine dreizehnte verdrängt die älteste. Ohne Grenze konnte ein einziges Konto den Speicher belegen und jede Live-Meldung vervielfachen. |
| **Neugier von außen** | `/api/health` sagt Fremden nur, dass der Dienst läuft. Laufzeit, Zahl der Bots und Client-Fassung gibt es für eine Administratorsitzung und für Aufrufe von dieser Maschine. |

## Aufbau

```
server/
  index.js        HTTP, Seiten in zwei Sprachen, WebSocket, Verlängerungen
  config.js       Umgebung und Pfade          db.js         SQLite-Schema, Migrationen, Tarife
  auth.js         Sitzungen, Passwörter       billing.js    Credits, Tarife, Zusätze, Ledger
  binaries.js     Client + Fähigkeiten        supervisor.js ein Prozess je Bot, Zustandsautomat
  mslogin.js      Microsoft-Gerätecode        macros.js     Macros, Spam, Anti-AFK
  nodes.js        Standorte                   agents.js     die Leitung zu den Standorten
  metrics.js      CPU, Speicher, Platte aus /proc
  resources.js    die Original-Client-JARs von Minecraft – Texturen für die Live-Ansicht
  stripe.js       Bezahlen, Webhook           vat.js        Umsatzsteuer auf Preis und Beleg
  protect.js      Inhaltsschutz serverseitig  legal.js      Datenschutz, AGB, Steuerhinweis
  assets.js       vorgepackte Dateien ausliefern statt bei jeder Anfrage zu komprimieren
  strings.js      die Texte des Panels, je Sprache einzeln – aus i18n.js beim Hochfahren gerechnet
  features.js     die Funktionsliste der öffentlichen Seiten, gefiltert nach dem echten Client
  settings-schema.js  Beschreibung jeder Einstellung: Gruppe, Beschriftung, Erklärung, Art
  pages.js        Vorlagen                    landing.js    das Bewegliche der öffentlichen Seiten
  mail.js         SMTP, Vorlagen, Kategorien  oauth.js      Discord und Google
  tickets.js      Support                     notify.js     Discord-Webhooks
  profile.js      Name, Anschrift, Firmierung, USt-IdNr., Zeitzone – geprüft an einer Stelle
  account.js      das eigene Konto mitnehmen (Export) oder loswerden (Löschung mit Frist)
  receipt.js      der Beleg über eine Aufladung – eine Seite, die ohne diesen Server aussieht wie sie selbst
  schedules.js    Bots zu festen Zeiten starten und stoppen, in der Zeitzone des Kontos
  systemreport.js der Zustand der Anlage als Discord-Nachricht: Lagebericht und Warnungen
  todos.js        was ein Kunde zu tun hat – die Liste in der Übersicht
  security.js     Anmeldeversuche, Bremse, Adresssperren, offene Sitzungen
  logincode.js    der Anmeldecode bei einem neuen Browser – und welche Browser bekannt sind
  mcping.js       den Zielserver fragen, wie es ihm geht (Server List Ping, SRV, MOTD)
  backup.js       tägliche Sicherung der Datenbank (VACUUM INTO), Aufbewahrung
  jobs.js         die wiederkehrenden Aufgaben als Verzeichnis statt als anonyme Intervalle
  export.js       Nutzer, Buchungen, Aufladungen … als CSV, formelsicher
  attachments.js  Anhänge an Tickets (20 MB), im Panel wie in Discord
  roles.js        welche Discord-Rolle wem    bridge.js     die Leitung zum Bot
  routes/         core, profiles, billing, admin, bot, node
bot/
  index.js        der Discord-Bot             panel.js      seine Leitung zum Panel
  handlers/       tickets, roles, linkedRoles, commands
agent/
  index.js        der Standort-Agent – läuft auf einer anderen Maschine und führt dort Bots aus
public/
  pages/          die festen Seiten als Vorlagen ({{> partial}} und {{schlüssel}})
  assets/js/i18n.js     alle Texte, beide Sprachen – die Quelle für Server und Browser
  assets/js/chatlog.js  Chatzeilen zusammenlegen, §-Farben zerlegen – ebenfalls von beiden
  assets/js/countries.js  die Länder der Rechnungsadresse – geprüft am Server, gewählt im Browser
  assets/js/discord.js  Discord-Nachrichten als HTML: Erwähnungen mit Namen statt Zahlen
  assets/js/shield.js   Inhaltsschutz im Browser
  assets/js/palette.js  die Sprungmarke auf Strg+K – findet alles und führt überall hin
  assets/js/views/      Übersicht, Konten, Server, Guthaben, Tickets, Proxys, Admin …
docs/             Aufbau, Standorte, Stripe, Live-Ansicht, Schutz, Discord-Bot, Google
scripts/
  build-movement.sh   baut die Bewegungs-Bauform (liegt nicht im Release)
data/                 Datenbank, Client-Dateien, Minecraft-JARs (mc/), Konten je Nutzer, Logs
                      (nicht im Repo)
```

## Inhaltsschutz

**Zwei Schalter, zwei verschiedene Dinge** (Administration → Einstellungen → Betrieb):

* **Dateien schützen** (an): CSS und JavaScript lassen sich nicht einzeln aufrufen
  (`Sec-Fetch-Dest`), liegen in keinem fremden Zwischenspeicher (`Cache-Control: private`), und
  Website-Kopierer bekommen am Dashboard eine Absage.
* **Bedienung sperren** (aus): Rechtsklick, Markieren, Ziehen, Drucken und die Entwicklerwerkzeuge.

Ab Werk ist die Seite deshalb eine ganz normale Seite. Das war einmal ein einziger Schalter, und
das war falsch: Wer seine Dateien nicht als Sammlung verschenken will, will deswegen noch lange
nicht, dass seine Kunden eine Serveradresse nicht markieren können. Ist die Sperre an, bleibt
trotzdem kopierbar, was zum Abschreiben da ist: Eingabefelder, Gutscheincodes, Verwendungszwecke,
Standort-Token, Serveradressen.

Was daran wirklich geht und was nicht, steht ehrlich in **[docs/schutz.md](docs/schutz.md)**.

## Dokumentation

Alles Weitere in **[docs/](docs/README.md)**: [wie alles funktioniert](docs/aufbau.md),
[der Admin-Bereich](docs/verwaltung.md),
[Standorte](docs/standorte.md), [Stripe](docs/stripe.md), [Live-Ansicht](docs/live-ansicht.md),
[Inhaltsschutz](docs/schutz.md), [Discord-Bot](docs/discord-bot.md),
[Google-Anmeldung](docs/google-anmeldung.md), [Umzug auf einen anderen Server](docs/umzug.md).

## API

Alles unter `/api`, Sitzung im HttpOnly-Cookie.

| Bereich | Endpunkte |
| --- | --- |
| Anmeldung | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify`, `/auth/forgot`, `/auth/reset` |
| Anmeldung: Code | `POST /auth/login/code` (Marke + sechs Ziffern), `POST /auth/login/code/resend`. `/auth/login` antwortet mit `{challenge, email_hint}` statt einer Sitzung, wenn der Browser neu ist |
| Anmeldung: Zwei-Faktor | `POST /auth/login/totp` (Marke + sechs Ziffern **oder** ein Wiederherstellungscode). `/auth/login` antwortet mit `{challenge, kind:'totp'}`; nach Discord/Google steht die Marke stattdessen im Cookie `afk_login` |
| Eigenes: Zwei-Faktor | `GET /me/totp` (Zustand), `POST /me/totp/start` (Passwort → Geheimnis, otpauth-Adresse, QR als SVG), `POST /me/totp/enable` (Code → zehn Wiederherstellungscodes), `POST /me/totp/recovery` (neue Codes), `DELETE /me/totp` (Passwort **und** Code) |
| Discord/Google | `GET /auth/:provider/start` (`mode=link\|login\|verify`), `/auth/:provider/callback`, `DELETE /auth/:provider` |
| Eigenes | `GET/PATCH /me` (samt Name, Anschrift, Firmierung, USt-IdNr., Zeitzone), `POST /me/password`, `GET /me/mails`, `/me/discord-test` |
| Eigenes: Name und Adresse | `POST /me/username`, `POST/DELETE /me/email`, `POST /auth/email/confirm` (ohne Anmeldung – der Link geht an die neue Adresse) |
| Eigenes: Geräte | `GET/DELETE /me/sessions`, `DELETE /me/sessions/:abdruck`, `GET /me/signins`, `GET/DELETE /me/devices`, `DELETE /me/devices/:abdruck` (bekannte Browser vergessen) |
| Eigenes: Daten | `GET /me/export` (alles als Datei), `POST/DELETE /me/delete` (Löschung mit Frist) |
| Belege | `GET /billing/receipts`, `GET /billing/receipts/:id` – das Dokument selbst, druckfertig |
| Zeitpläne | `GET/POST /profiles/:id/schedules`, `PATCH/DELETE /profiles/:id/schedules/:planId` |
| Konten | `GET /accounts`, `POST /accounts/login` (Gerätecode), `POST /accounts/offline`, `DELETE /accounts/:id` |
| Serverplätze | `GET/POST /profiles`, `GET/PATCH/DELETE /profiles/:id`, `POST /profiles/:id/plan`, `/resume`, `/node`, `/copy` (Kopie samt Macros, Zeitplänen und Spam) |
| Zielserver | `GET /profiles/:id/status` – MOTD, Spielerzahl, Version, Antwortzeit des Minecraft-Servers (Server List Ping, 15 s Zwischenspeicher) |
| Client-Fassung | `POST /profiles/:id/client-update` – die Bots dieses Platzes auf die Datei heben, die jetzt daliegt |
| Zusätze | `GET/POST /profiles/:id/addons`, `DELETE /profiles/:id/addons/:addonId` |
| Bots | `POST /profiles/:id/start`, `/stop`, `/restart` |
| Chat | `GET/POST /profiles/:id/chat`, `GET /profiles/:id/chat.txt` (Verlauf als Datei), `GET /profiles/:id/views`, `…/spam` |
| Im Spiel | `POST /profiles/:id/command` (`go`, `look`, `home`, `board`, `menu`, `inv`, `click`, `sneak`, …) |
| Live-Ansicht | `GET /profiles/:id/pov/:accountId/frame.png`, `/state.json`, `/item.png`, `POST …/click`, `/close`, `/hotbar` – die Brücke zum Viewer des Clients |
| Automatik | `…/macros` (GET/POST/PATCH/DELETE, dazu `/test`) – Auslöser samt Einstellungen, Schritte, `cooldown_sec`, `chance` |
| Guthaben | `GET /billing`, `POST /billing/voucher`, `POST /billing/topup` |
| Support | `GET/POST /tickets`, `GET /tickets/:id`, `/messages`, `POST /tickets/:id/reply`, `/status`, `/typing` |
| Anhänge | `POST /tickets/files` (Rumpf = die Datei), `GET /tickets/files/:id` |
| Bilder | `GET /heads/:name.png` – der Minecraft-Kopf, über diesen Server geholt und zwischengespeichert. Vorher stand die Adresse des Skin-Dienstes direkt im `src`, und jeder Kunde schickte damit Kontonamen und IP-Adresse zu einem Fremden |
| Sonstiges | `GET /announcements`, `GET /nodes` |
| Admin | `/admin/overview`, `/metrics`, `/users`, `/servers/:id` (samt Konsole), `/nodes`, `/plans`, `/addons`, `/topups`, `/vouchers`, `/proxies`, `/tickets`, `/announcements`, `/settings`, `/client/sync`, `/client/rollout` (alle veralteten Bots neu starten), `/resources/:version` (POST = Rumpf ist die JAR, `/fetch`, DELETE), `/mails`, `/audit`, `/ledger` |
| Admin: suchen | `GET /admin/search?q=` – Nutzer, Serverplätze, Accounts, Tickets, Gutscheine, Standorte, Aufladungen auf einmal; jeder Treffer bringt seinen Weg mit |
| Admin: viele auf einmal | `POST /admin/users/bulk` (`credits`, `block`, `unblock`, `logout`, `verify-mail`, `stop-bots`) |
| Admin: Ausfuhr | `GET /admin/export/:liste` – `users`, `ledger`, `topups`, `profiles`, `tickets`, `audit`, `receipts` als CSV |
| Admin: Sicherheit | `GET /admin/security`, `POST/DELETE /admin/security/blocks`, `DELETE /admin/security/sessions/:id` |
| Admin: Sicherungen | `GET/POST /admin/backups`, `GET/DELETE /admin/backups/:datei` |
| Admin: Betrieb | `GET /admin/bots`, `GET /admin/jobs`, `POST /admin/jobs/:key/run` |
| Admin: System | `GET /admin/system/report` (was gerade auffällt), `POST /admin/system/report` (Bericht jetzt schicken) |
| Admin: Support | `GET/POST/PATCH/DELETE /admin/ticket-templates`, `POST /admin/ticket-templates/:id/used` |
| Admin: Rundmail | `GET /admin/broadcast` (Kreise mit Zahlen), `POST /admin/broadcast` |
| Admin: Geld zurück | `POST /admin/topups/:id/refund` – löst die Erstattung bei Stripe aus; Credits nimmt der Webhook zurück |
| Bot | `/bot/config`, `/bot/tickets`, `/bot/users/:discordId`, `/bot/roles`, `/bot/events`, `WS /bot/stream` |
| Standorte | `GET /node/manifest`, `GET /node/binaries/:name`, `GET /node/resources/:version`, `WS /node/stream` – alle mit dem Token des Standorts |
| Stripe | `POST /stripe/webhook` – mit `Stripe-Signature` geprüft, die einzige Stelle, an der Guthaben entsteht |
| Live | `GET /api/ws` – WebSocket mit Chatzeilen, Zustandswechseln, Ansichten, Tickets, Guthaben |
