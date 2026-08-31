# Der Admin-Bereich

Was der Betreiber im Alltag braucht, ohne je an die Datenbank zu müssen. Diese Seite beschreibt
die Werkzeuge, die nicht selbsterklärend sind – Tarife anlegen und Tickets beantworten erklärt
sich beim Hinsehen, eine Adresssperre nicht.

Alles hier liegt hinter `#/admin` und setzt die Rolle **Administrator** voraus. Der erste
registrierte Benutzer bekommt sie (oder wer in `ADMIN_EMAIL` steht).

---

## Inhalt

1. [Suche über alles](#suche)
2. [Nutzer: viele auf einmal](#massen)
3. [Listen als Datei](#csv)
4. [Sicherheit: wer klopft, wer drin ist, wer draußen bleibt](#sicherheit)
5. [Sicherungen der Datenbank](#sicherungen)
6. [Betrieb: was gerade läuft, was regelmäßig läuft](#betrieb)
7. [Textbausteine für Tickets](#bausteine)
8. [Rundmail](#rundmail)
9. [Geld zurückgeben](#erstatten)

---

<a id="suche"></a>

## 1. Suche über alles

**Strg+K** (auf dem Mac ⌘K), oder der Knopf **Suche** in jeder Admin-Kopfzeile.

Ein Feld, das alle Tabellen auf einmal fragt: Nutzer, Serverplätze, Accounts, Tickets, Gutscheine,
Standorte, Aufladungen. Der Anhaltspunkt ist das, was man gerade hat – eine Mailadresse aus einer
Beschwerde, ein Bot-Name aus einem Screenshot, eine Ticketnummer aus Discord, ein Gutscheincode
von einem Zettel.

| Eingabe | Was gefunden wird |
| --- | --- |
| `user@example.invalid` | das Konto mit dieser Adresse |
| `SkyBlockBot` | der Account, und darüber sein Besitzer |
| `412` | Ticket 412, Nutzer 412, Aufladung 412 – die Nummer schlägt jeden Namen |
| `mc.hypixel.net` | alle Serverplätze auf diese Adresse |
| `cs_test_a1b2` | die Aufladung zu dieser Stripe-Kasse |

Ein Account hat keine eigene Seite; sein Treffer führt dorthin, wo er wirklich steht – zu seinem
Nutzer. **Ein einzelner Buchstabe** ist keine Suche und wird nicht ausgeführt: `LIKE '%a%'` über
jede Tabelle ist keine Antwort, sondern ein Ausdruck der Datenbank. Eine einzelne **Ziffer** ist
dagegen eine gültige Frage, denn Ticket 7 heißt wirklich 7.

Ohne Eingabe zeigt die Palette die Seiten des Panels – sie ist damit auch der schnellste Weg zu
*Tarife* oder *Standorte*, ohne die Seitenleiste aufzuklappen.

---

<a id="massen"></a>

## 2. Nutzer: viele auf einmal

In der Nutzerliste hat jede Zeile ein Kästchen, und das Kästchen in der Kopfzeile wählt alles aus,
was gerade gefiltert ist. Darüber steht die Leiste mit den Aktionen:

| Aktion | Was passiert |
| --- | --- |
| Guthaben buchen | derselbe Betrag für jeden Ausgewählten, mit einer Notiz im Buchungsprotokoll |
| E-Mail als bestätigt markieren | für Konten, deren Bestätigungsmail nie ankam |
| Überall abmelden | alle Sitzungen weg; wer gerade im Panel sitzt, landet auf der Anmeldung |
| Alle Bots stoppen | die laufenden Prozesse, nicht der Startwunsch |
| Sperren / Entsperren | Sperren stoppt zusätzlich die Bots und wirft alle Sitzungen weg |

Drei Regeln machen das ungefährlich:

* **Wer nicht darf, wird übersprungen** und am Ende aufgezählt – nicht abgebrochen. Eine
  Massenaktion, die beim zwölften Konto stehenbleibt, hinterlässt elf geänderte und neunzehn
  offene, und niemand weiß hinterher, welche Hälfte welche ist.
* **Sich selbst sperrt niemand aus.** Der letzte Administrator, der sich selbst aussperrt, ist
  kein hypothetischer Fall.
* **Ins Minus geht kein Konto.** Ein Abzug, der ein Konto unter null brächte, wird übersprungen.

---

<a id="csv"></a>

## 3. Listen als Datei

Nutzer, Buchungen, Aufladungen, Serverplätze, Tickets und das Protokoll haben einen **CSV**-Knopf.
Der Anlass ist immer derselbe: Jemand will mit den Zahlen etwas tun, was ein Panel nicht kann – die
Aufladungen eines Quartals an den Steuerberater schicken, Buchungen gegen den Kontoauszug halten,
eine Nutzerliste nach eigenen Regeln sortieren.

Zwei Dinge nimmt die Datei ernst:

* **Zeitangaben sind ISO-Zeitpunkte** (`2026-08-31 19:04:11`) und keine Millisekundenzahlen. Die
  wären für ein Programm die Wahrheit und für eine Tabellenkalkulation eine große Zahl.
* **Ein Feld, das mit `=`, `+`, `-` oder `@` anfängt, bekommt ein Hochkomma davor.** Excel hielte
  es sonst für eine Formel und führte sie aus – eine Notiz im Buchungsprotokoll wäre damit ein
  Angriff auf den, der die Datei öffnet.

Jede Ausfuhr steht im Protokoll: Wer alle Mailadressen mitnimmt, hinterlässt eine Spur.

---

<a id="sicherheit"></a>

## 4. Sicherheit

*Administration → Protokolle und Zustand → Sicherheit.* Drei Listen auf einem Bildschirm, weil erst
der Vergleich die Arbeit macht: Die Adresse, die achtzigmal danebengetippt hat, ist die, die
gesperrt gehört.

### Anmeldeversuche

Jeder Versuch wird aufgeschrieben – der geglückte wie der gescheiterte, mit Adresse, Zeitpunkt und
dem, was eingetippt wurde. Ohne das ist ein Angriff auf ein Konto unsichtbar: Der Betreiber erfährt
davon erst, wenn er stattgefunden hat. Aufgehoben werden sie 30 Tage.

### Die Bremse

| Grenze | Wirkung |
| --- | --- |
| 10 Fehlversuche **einer Adresse** in 15 Minuten | von dieser Adresse geht 15 Minuten nichts mehr |
| 20 Fehlversuche **an einem Konto** in 15 Minuten | an diesem Konto geht 15 Minuten nichts mehr |

Die zweite Grenze ist bewusst großzügiger. Eine scharfe Grenze je Konto wäre eine Waffe gegen den
Kontoinhaber: Wer ein fremdes Konto ärgern will, tippt zwanzigmal falsch, und der Richtige kommt
nicht mehr hinein. Eine **geglückte** Anmeldung setzt keinen Zähler zurück – sonst räumte ein
Angreifer beim ersten erratenen Passwort seinen eigenen Zähler ab.

Die Bremse greift **vor** der Passwortprüfung. Die ist absichtlich teuer, und wer gebremst wird,
soll diese Rechenzeit gar nicht erst bekommen.

### Adresssperren

Einzelne Adressen oder ganze Netze in CIDR-Schreibweise, mit Grund und Frist:

```
203.0.113.42          eine Adresse
203.0.113.0/24        ein Netz
2001:db8::/32         auch IPv6
```

`::ffff:192.0.2.1` gilt dabei als dieselbe Adresse wie `192.0.2.1` – Node liefert IPv4 über einen
IPv6-Socket so, und eine Sperre, die das nicht erkennt, sperrt ins Leere.

> **Eine Sperre ist nie eine Falle für den Betreiber.** Die eigene Adresse lässt sich nicht
> eintragen, und eine bestehende Administrator-Sitzung kommt durch jede Sperre hindurch. Ohne diese
> zwei Regeln hinge der Weg zurück an SSH – und die Sperre stünde ausgerechnet in der Datenbank, an
> die man dann nicht mehr herankommt.

### Sitzungen

Alle offenen Sitzungen quer über alle Konten, mit Adresse, Gerät und Alter; einzeln abzumelden.
**Der Sitzungsschlüssel steht nirgends** – er ist ein Passwortersatz, und eine Ansicht, die ihn
zeigt, macht aus jedem Blick über die Schulter eine Übernahme.

---

<a id="sicherungen"></a>

## 5. Sicherungen der Datenbank

*Administration → System*, unten. Eine Sicherung am Tag läuft von selbst (abschaltbar unter
*Einstellungen → Betrieb*), die letzten vierzehn bleiben liegen, ein Knopf macht dazwischen eine.
Sie liegen in `data/backups/` und lassen sich herunterladen.

Gesichert wird mit `VACUUM INTO` und nicht mit `cp`: SQLite schreibt hier im WAL-Modus, die
eigentliche Datei ist zwischen zwei Checkpoints nicht auf dem neuesten Stand. Eine Kopie mit `cp`
erwischt im besten Fall eine Datei ohne die letzten Buchungen und im schlechtesten eine kaputte.

**Zurückgespielt wird von Hand**, und dafür gibt es bewusst keinen Knopf – eine Datenbank
auszutauschen, während das Panel auf ihr arbeitet, geht nicht gut aus:

```bash
systemctl stop afksystems
cp /opt/afksystems/data/backups/<datei> /opt/afksystems/data/afksystems.db
systemctl start afksystems
```

Eine Sicherung ist ein **Generalschlüssel**: Passwort-Hashes, Sitzungen, jedes Token dieses
Betriebs stehen darin. Jedes Herunterladen steht deshalb im Protokoll.

Nicht mitgesichert wird `data/users/` – die Microsoft-Anmeldungen. Die gehören zu einem vollen
Umzug (siehe [umzug.md](umzug.md)) und nicht in eine Datei, die im Browser landet.

---

<a id="betrieb"></a>

## 6. Betrieb

*Administration → Tagesgeschäft → Betrieb.* Zwei Dinge, die vorher nirgends an einer Stelle standen.

**Laufende Bots über alle Standorte hinweg**, mit Zustand, Laufzeit und der letzten Meldung des
Clients, dazu Stoppen und Neustarten. Vorher war das über die Serverplätze verteilt: Wer wissen
wollte, ob auf dem zweiten Standort noch etwas läuft, klickte sich durch fremde Kundenkonten.

**Wiederkehrende Aufgaben** mit letztem Lauf, Dauer und letztem Fehler:

| Aufgabe | Takt | Was sie tut |
| --- | --- | --- |
| `abrechnung` | stündlich | verlängern, mahnen, suspendieren |
| `gratis-plaetze` | 1 Minute | Discord-Mitgliedschaft der Gratis-Plätze prüfen |
| `wiederanlauf` | 1 Minute | hochfahren, was laufen soll und gerade nicht läuft |
| `aufraeumen` | stündlich | Sitzungen, Anhänge, Sicherung, Client-Abgleich |
| `standort-eigen` | 15 Sekunden | eigene Auslastung melden |
| `verbindungen` | 30 Sekunden | tote WebSockets aussortieren |

Neben den meisten steht **Jetzt laufen**. Die häufigste Frage an eine stündliche Aufgabe ist
schließlich: muss ich wirklich eine Stunde warten, um zu sehen, ob es jetzt geht? Nicht neben
allen – wo der Takt die halbe Bedeutung ist (tote Verbindungen), wäre es ein Knopf ohne Wirkung.

Zwei Läufe derselben Aufgabe überlappen nie. Bei der Abrechnung hieße das zweimal abbuchen.

---

<a id="bausteine"></a>

## 7. Textbausteine für Tickets

*Administration → Tagesgeschäft → Textbausteine*, benutzt im Ticket über den Knopf **Textbaustein**
neben dem Antwortfeld.

Support besteht zu einem guten Teil aus denselben vier Sätzen. Wer sie jedes Mal neu tippt, tippt
sie jedes Mal ein bisschen anders – mal freundlich, mal knapp, je nach Tageszeit. Ein Baustein ist
deshalb nicht nur schneller, er ist der Grund, warum zwei Kunden dieselbe Antwort bekommen.

Drei Platzhalter werden beim Einfügen ersetzt:

| Platzhalter | Wird zu |
| --- | --- |
| `{name}` | Benutzername des Kunden |
| `{ticket}` | `#412` |
| `{subject}` | Betreff des Tickets |

Eingefügt wird **an der Stelle, an der der Zeiger steht** – wer schon zwei Sätze getippt hat, will
beides. Der Zähler in der Liste ist die einzige ehrliche Auskunft darüber, welcher Baustein seinen
Platz verdient: Einer, den in einem halben Jahr niemand benutzt hat, steht beim Suchen im Weg.

---

<a id="rundmail"></a>

## 8. Rundmail

*Administration → Plattform → Ankündigung*, unterer Bereich.

Eine Nachricht an alle ist selten die gemeinte: „Wir stellen den Standort in Falkenstein ab“ geht
die Gratis-Kunden nichts an, „dein Guthaben verfällt nicht“ nur die mit welchem. Deshalb sechs
Kreise, jeder mit der Zahl seiner Empfänger daneben, **bevor** irgendetwas hinausgeht:

| Kreis | Wer |
| --- | --- |
| Alle bestätigten Konten | nicht gesperrt, Adresse bestätigt |
| Zahlende Kunden | mindestens ein bezahlter, laufender Serverplatz |
| Nur Gratis-Plätze | kein bezahlter Platz |
| Mit Guthaben | Guthaben größer null |
| Seit 90 Tagen nicht da | oder noch nie |
| Adresse nie bestätigt | der einzige Kreis, in dem unbestätigte Adressen vorkommen |

Die Rundmail geht denselben Weg wie jede andere Nachricht: dieselbe Vorlage, dieselbe Kategorie
(*Ankündigungen*), dasselbe Protokoll – und damit dieselbe **Abbestellung**. Wer Ankündigungen
abbestellt hat, bekommt keine. Das ist der Sinn und keine Einschränkung.

Jeder bekommt sie in seiner Sprache. Bleiben die englischen Felder leer, gilt der deutsche Text für
beide – ein fremder Satz ist besser als keiner. **Nur an mich** schickt eine Probe an den Absender
und ignoriert dessen Abbestellung: Wer prüfen will, wie es aussieht, will es sehen.

---

<a id="erstatten"></a>

## 9. Geld zurückgeben

*Administration → Tarife und Geld → Aufladungen.* Neben jeder bezahlten Stripe-Aufladung steht
**Erstatten**; ohne Betrag geht alles zurück, mit Betrag ist es eine Teilerstattung.

**Die Credits nimmt dieser Knopf nicht zurück.** Das tut der Webhook, sobald Stripe die Erstattung
meldet – und dieselbe Meldung kommt auch, wenn jemand doch im Stripe-Dashboard erstattet hat. Zwei
Stellen, die Guthaben abziehen, wären zwei Chancen, es doppelt zu tun. Die Rückbuchung erscheint
deshalb ein paar Sekunden später und nicht sofort.

Eine **Teilerstattung** nimmt gar keine Credits zurück: Wie viele das sein sollen, ist keine
Rechenaufgabe, sondern eine Entscheidung. Alles Weitere zu Erstattungen und Streitfällen steht in
[stripe.md, Abschnitt 8](stripe.md#erstattung).
