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
10. [Systemmeldungen: der Webhook, der die Anlage meldet](#system)
11. [Verkäufer und Belege](#belege)
12. [Konten, die gelöscht werden sollen](#loeschungen)

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
| `max@example.com` | das Konto mit dieser Adresse |
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

Ein siebter Knopf steht neben den Aufladungen und nur dann, wenn es etwas zu holen gibt: **Belege
gelöschter Konten**. Wenn jemand sein Konto löscht, verschwindet alles mit ihm – nur die schon
ausgestellten Rechnungen nicht, die müssen bleiben (§ 147 AO). Sie liegen danach in einer eigenen
Tabelle, zu der kein Konto mehr gehört, also auch in keiner Liste des Panels. Diese Datei ist der
einzige Weg dorthin: Belegnummer, Betrag, Datum und der Name, auf den die Rechnung lief.

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

`::ffff:1.2.3.4` gilt dabei als dieselbe Adresse wie `1.2.3.4` – Node liefert IPv4 über einen
IPv6-Socket so, und eine Sperre, die das nicht erkennt, sperrt ins Leere.

> **Eine Sperre ist nie eine Falle für den Betreiber.** Die eigene Adresse lässt sich nicht
> eintragen, und eine bestehende Administrator-Sitzung kommt durch jede Sperre hindurch. Ohne diese
> zwei Regeln hinge der Weg zurück an SSH – und die Sperre stünde ausgerechnet in der Datenbank, an
> die man dann nicht mehr herankommt.

### Sitzungen

Alle offenen Sitzungen quer über alle Konten, mit Adresse, Gerät und Alter; einzeln abzumelden.
**Der Sitzungsschlüssel steht nirgends** – er ist ein Passwortersatz, und eine Ansicht, die ihn
zeigt, macht aus jedem Blick über die Schulter eine Übernahme.

### Der Anmeldecode in dieser Liste

Neben „falsches Passwort“ steht seit dem Anmeldecode auch **„falscher Code“**. Der Unterschied ist
der wichtigste in dieser ganzen Ansicht: Bei „falsches Passwort“ hat jemand geraten. Bei „falscher
Code“ hat jemand das Passwort **gekonnt** und ist an der zweiten Frage gescheitert – das heißt, das
Passwort dieses Kontos ist in fremden Händen. Dieselbe Zeile sieht der Kunde in seinen eigenen
Einstellungen, und dort steht sie im Klartext dabei.

Einstellen lässt sich der Code nicht von hier: Er gehört dem Kontoinhaber (*Einstellungen →
Sicherheit*), Vorgabe ist an. Ohne eingerichteten Postausgang bleibt er wirkungslos – dann kann
kein Code hinausgehen, und die Anmeldung läuft wie eh und je. Dasselbe gilt, wenn eine einzelne
Nachricht gerade nicht zugestellt werden kann; im Protokoll steht dann `login-code-failed`.

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

### Eine neue Client-Fassung ausrollen

*Administration → Client.* Der stündliche Abgleich holt jedes neue Release und legt die Dateien hin;
die Standorte holen sich dieselben. **Laufende Bots wechseln dabei nicht mit** – ein Prozess hält
seine Datei offen und merkt von der Ablösung nichts.

Steht oben im Kasten „*n* von *m* laufenden Bots halten noch die alte Client-Datei“, dann ist das
genau so gemeint, mit der Aufschlüsselung darunter: welche Fassungen noch unterwegs sind und welche
bereitliegt. **Alle neu starten** hebt sie alle auf die neue, mit fünf Sekunden Abstand zwischen den
Neustarts – hundert Bots, die im selben Augenblick beim selben Minecraft-Server anklopfen, lösen
dort dieselben Schutzmaßnahmen aus wie ein Angriff.

Das ist bewusst ein Knopf und kein Takt. Ein Neustart wirft einen Bot aus dem Spiel; auf Servern mit
Warteschlange kostet das den Platz darin, und der Kunde hat nicht darum gebeten. Er kann es auch
selbst tun – im Reiter *Verbinden* seines Serverplatzes steht derselbe Hinweis mit einem Knopf, der
nur seine eigenen Bots betrifft. Kommt eine neue Fassung an, meldet der Systembericht sie von sich
aus in den Webhook (siehe Abschnitt 10).

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

---

<a id="system"></a>

## 10. Systemmeldungen: der Webhook, der die Anlage meldet

*Administration → System*, unter den Messwerten. Und – wenn ein Webhook hinterlegt ist – in dem
Discord-Kanal, der darin steht.

**Was sich geändert hat.** Der Webhook hieß einmal „Webhook fürs Team“ und meldete neue Tickets und
jede Antwort darauf. Das war die vierte Kopie derselben Nachricht: Ein Ticket steht im Panel, in
der Seitenleiste mit einer Zahl daneben und – sobald der Bot läuft – als eigener Kanal, in dem das
Gespräch tatsächlich stattfindet. Ein Kanal, der ständig dasselbe wiederholt, wird nicht mehr
gelesen; und dann steht dort irgendwann etwas Wichtiges, das niemand sieht.

Hier kommt jetzt an, was **sonst nirgends** steht:

| Art | Wann | Was drinsteht |
| --- | --- | --- |
| **Lagebericht** | im eingestellten Takt (Vorgabe: alle 12 Stunden) | CPU, Speicher, Platte, Standorte, laufende Bots, Konten, offene Tickets und Aufladungen, Client-Stand, letzte Sicherung, gescheiterte Aufgaben |
| **Warnung** | sofort, höchstens einmal am Tag je Sache | Platte über 85 %, Speicher über 90 %, ein Standort meldet sich nicht, keine Client-Datei, eine wiederkehrende Aufgabe scheitert |
| **Geld** | sofort | Betrag oder Konto einer Stripe-Zahlung passen nicht, Erstattung, Streitfall |
| **Start** | beim Hochfahren | Version, Host, Adresse – wer nachts einen Neustart sieht, den niemand ausgelöst hat, weiß damit mehr als jeder Bericht am Morgen |

Eingerichtet wird er unter *Einstellungen → Discord*:

* **Webhook für Systemmeldungen** – die Adresse aus Discord (Kanal → Bearbeiten → Integrationen →
  Webhooks). Verdeckt eingegeben, denn ein Webhook ist so gut wie ein Passwort.
* **Lagebericht alle … Stunden** – `0` heißt: nur Warnungen, kein Bericht. Die Warnungen kommen
  davon unabhängig.

**Die Liste steht auch ohne Webhook da.** Sie ist die eigentliche Auskunft; der Webhook ist nur der
Weg, auf dem sie jemanden erreicht, der gerade nicht hinsieht. Der Knopf **Bericht jetzt schicken**
beantwortet die häufigste Frage an einen Webhook: Kommt da überhaupt etwas an?

---

<a id="belege"></a>

## 11. Verkäufer und Belege

*Administration → Einstellungen → Verkäufer und Belege.*

Jede verbuchte Aufladung bekommt eine fortlaufende Belegnummer je Jahr (`AFK-2026-0001`) und ein
Dokument, das der Kunde unter *Guthaben → Belege* öffnen und drucken kann. Der **Absender** darauf
kommt aus diesen drei Feldern:

| Feld | Was hineingehört |
| --- | --- |
| **Name des Verkäufers** | die Firmierung oder der Name, unter dem verkauft wird. Leer heißt: es steht die Marke da |
| **Anschrift** | mehrzeilig, eine Zeile je Zeile – genau so steht sie auf dem Beleg |
| **Eigene USt-IdNr.** | bei der Kleinunternehmerregelung meistens leer |

**Bitte vor der ersten Zahlung ausfüllen.** Verkäufer ist der Betreiber und nicht Stripe; ein Beleg
ohne Absender ist keiner. Der Umsatzsteuersatz darauf kommt aus *Einstellungen → Umsatzsteuer* und
ist derselbe Satz wie auf der Preisseite und an der Kasse.

**Was auf einem Beleg steht, ändert sich nie wieder.** Anschrift, Firmierung, USt-IdNr., der
Steuerhinweis und die Sprache werden im Moment der Buchung festgehalten. Zieht der Kunde später um,
ändert das den Beleg des Vorjahres nicht – sonst wäre eine Rechnung kein Dokument, sondern eine
Ansicht auf den heutigen Stand.

Belege aus der Zeit vor dieser Änderung haben keine Nummer und tauchen deshalb nicht in der Liste
auf. Das ist ehrlicher, als ihnen nachträglich eine zu geben: Eine Belegnummer, die Monate nach der
Zahlung vergeben wurde, ist keine fortlaufende Nummer mehr.

---

<a id="loeschungen"></a>

## 12. Konten, die gelöscht werden sollen

Ein Kunde kann sein Konto selbst löschen (*Einstellungen → Deine Daten*). Sofort passiert dabei
nichts außer zweierlei: Die Bots gehen aus und lassen sich nicht wieder starten, und der Termin
steht fest – **14 Tage** später.

In der Nutzerliste steht an so einem Konto ein Papierkorb-Zeichen, auf seiner Seite ein roter
Streifen mit dem Datum. Bis dahin genügt ein Klick des Kunden, um alles zurückzuholen; danach geht
das Konto mit allem, was daran hängt: Serverplätze, Minecraft-Konten samt ihren Anmeldedateien,
Tickets samt Anhängen, Protokolle, Guthaben.

Ausgeführt wird das von der Aufgabe **Fällige Kontolöschungen ausführen** (*Betrieb → wiederkehrende
Aufgaben*), stündlich. Wer nicht warten will, drückt dort auf „jetzt laufen“.

**Ein Administrator kann sich hier nicht selbst löschen.** Sonst löscht sich der letzte, und danach
kommt niemand mehr in die Verwaltung. Wer es wirklich will, gibt die Rolle vorher ab.
