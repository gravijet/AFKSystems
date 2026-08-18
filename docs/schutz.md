# Inhaltsschutz

Was AFKSystems dagegen tut, dass Website und Panel einfach mitgenommen werden – und was daran
ehrlicherweise geht und was nicht.

---

## Erst die Wahrheit

**Es gibt keinen Schalter, der eine Website unkopierbar macht.** Ein Browser muss HTML, CSS,
JavaScript und Bilder bekommen, sonst gibt es keine Seite. Wer entschlossen genug ist, bekommt
jede Datei – zur Not über einen selbstgebauten Client oder ein Bildschirmfoto.

Was es gibt, ist eine Reihe von Hürden, die den **bequemen** Weg verschließen. Aus "Rechtsklick,
Speichern unter, fertig" wird Arbeit. Genau das tun große Anbieter auch, und mehr behaupten sie
auch nicht.

## Zwei Schalter, zwei verschiedene Dinge

In **Administration → Einstellungen → Betrieb** stehen zwei Schalter, und sie haben miteinander
wenig zu tun:

| Schalter | Wirkt auf | Vorgabe |
| --- | --- | --- |
| **Dateien schützen** (`content_protection`) | CSS und JavaScript lassen sich nicht einzeln abrufen, liegen in keinem fremden Zwischenspeicher, Website-Kopierer kommen nicht ans Dashboard | **an** |
| **Bedienung sperren** (`content_lock_ui`) | Rechtsklick, Markieren, Ziehen, Drucken, Entwicklerwerkzeuge | **aus** |

Das war einmal **ein** Schalter, und das war falsch. Wer seine Dateien nicht als Sammlung
verschenken will, will deswegen noch lange nicht, dass seine Kunden eine Serveradresse nicht
markieren können. Der zweite Schalter trifft ausschließlich die eigenen Besucher – ein Kopierer
mit einem Skript merkt von ihm nichts. Deshalb ist die Seite ab Werk eine ganz normale Seite, und
wer das andere will, schaltet es dazu.

---

## Was auf dem Server passiert

Datei: `server/protect.js`

### 1. CSS und JavaScript gibt es nicht einzeln

`https://example.invalid/assets/v/…/css/app.css` im Browser öffnen und speichern – das war der
kürzeste Weg an das gesamte Design. Solche Aufrufe tragen `Sec-Fetch-Dest: document`; dieselbe
Datei als Stylesheet einer Seite geladen trägt `style`, als Modul geladen `script`. Die
Unterscheidung ist eindeutig, kostet nichts und trifft genau den richtigen Fall.

```
$ curl https://example.invalid/assets/v/abc/css/app.css
Diese Datei gehört zu einer Seite und wird nicht einzeln ausgeliefert.     (403)
```

Ältere Browser (Safari vor 16.4) schicken kein `Sec-Fetch-Dest`. Für die gilt ersatzweise ein
Referer von der eigenen Website. Werkzeuge außerhalb eines Browsers haben weder das eine noch das
andere.

**Bilder und Schriften bleiben frei.** Das Logo steht in jeder E-Mail, das Vorschaubild in jeder
Verlinkung bei Discord und in sozialen Netzen. Eine Schrift, die nur mit Referer lädt, ist eine
Schrift, die irgendwann nicht lädt – und schützenswert ist an beidem nichts.

### 2. CSS und JavaScript liegen in keinem fremden Zwischenspeicher

CSS- und JS-Antworten tragen `Cache-Control: private`. Der Browser des Besuchers darf sie behalten,
ein CDN davor nicht. Ohne das wäre Punkt 1 eine Attrappe: Cloudflare würde die Datei einmal vom
Server holen und sie danach jedem ausliefern, der die Adresse kennt – ganz ohne die Prüfung.

Die Abweisung selbst trägt `Cache-Control: no-store`. Läge **sie** im CDN, wäre die Seite für alle
kaputt, weil ein Einziger sie einzeln geholt hat.

Bilder und Schriften bleiben `public` und damit im CDN.

### 3. Kein Archiv, keine Website-Kopierer

* `X-Robots-Tag: noarchive, noimageindex` an allen Assets – sie landen nicht in den
  Zwischenspeichern der Suchmaschinen.
* Bekannte Kopierwerkzeuge (HTTrack, WebCopier, Teleport Pro, wget, curl, Scrapy …) bekommen
  **am Dashboard** eine Absage. Nur dort: die öffentlichen Seiten sollen gefunden werden, und
  einen Suchmaschinen-Crawler von einem Kopierer zu unterscheiden ist ein Spiel, das man nicht
  gewinnt. Hinter der Anmeldung gibt es dagegen nichts, was ein Werkzeug ohne Browser zu suchen
  hätte.

### 4. Der ausgelieferte Code ist nicht der geschriebene

`npm run assets:protect` (läuft in `deploy/install.sh` automatisch) minimiert CSS und JavaScript
in der Produktionskopie unter `/opt/afksystems`: Namen verkürzt, Kommentare weg, alles in einer
Zeile. Im Repository bleiben die lesbaren Quellen unangetastet.

Das ist keine Verschlüsselung. Es sorgt dafür, dass abgegriffener Code nicht kommentiert und
strukturiert vorliegt, und spart nebenbei Bandbreite.

---

## Was im Browser passiert

**Nur mit „Bedienung sperren“.** Ist der Schalter aus – und das ist die Vorgabe –, passiert hier
gar nichts: Markieren, Rechtsklick, Kopieren und die Entwicklerwerkzeuge verhalten sich wie auf
jeder anderen Website.

Datei: `public/assets/js/shield.js` (läuft im `<head>`, damit der Schutz steht, bevor der erste
Inhalt sichtbar ist)

| Gesperrt | Bemerkung |
| --- | --- |
| Rechtsklick (Kontextmenü) | außer in Eingabefeldern |
| Markieren von Text | außer in Eingabefeldern und an Stellen zum Abschreiben |
| Kopieren und Ausschneiden | dito |
| Bilder und Links wegziehen | der schnellste Weg, ein Bild zu speichern |
| Strg/⌘ + S, U, P | speichern, Quelltext, drucken |
| F12, Strg + Shift + I/J/C/K | Entwicklerwerkzeuge, Konsole, Inspektor |
| Drucken und "als PDF speichern" | per `@media print`; es erscheint nur ein Hinweis |

**Kopierbar bleibt, was zum Abschreiben da ist:** Eingabefelder, Gutscheincodes,
Verwendungszwecke, Standort-Token, Serveradressen, Chatzeilen – alles mit `.mono`, `code`, `pre`
oder `[data-copyable]`. Ein Schutz, der einen Verwendungszweck zum Abtippen macht, ist kein Schutz,
sondern eine Zumutung.

Längere kopierte Stücke (ab 120 Zeichen) bekommen die Quelle angehängt.

### Offene Entwicklerwerkzeuge

Erkannt an zwei Anzeichen, beide ohne Dauerbetrieb:

* Angedockte Werkzeuge machen das Fenster innen deutlich kleiner als außen.
* Ein Objekt, dessen Eigenschaft beim Ausgeben abgefragt wird – das passiert nur, wenn eine
  Konsole es wirklich darstellt.

Solange der Verdacht besteht, wird der Inhalt **unscharf und verdeckt**, mit einem Hinweis darüber.
Es wird nichts blockiert und nichts abgemeldet: Werkzeuge zu, Inhalt wieder da.

**Kein `debugger`-Käfig.** Die Endlosschleife aus `debugger`-Anweisungen, die manche Seiten
einsetzen, friert den Browser ein, kostet Rechenzeit und trifft den Betreiber genauso wie den
Neugierigen. Der Effekt – "so kommt man nicht weiter" – ist derselbe, der Schaden nicht.

---

## Was das für den Betrieb kostet

| | |
| --- | --- |
| Serverseitig | ein Vergleich zweier Kopfzeilen je Asset-Aufruf |
| Browser | nichts, solange „Bedienung sperren“ aus ist; sonst sechs Ereignis-Anmeldungen und alle fünf Sekunden ein Vergleich zweier Zahlen |
| CDN | CSS und JS werden nicht mehr von Cloudflare ausgeliefert, sondern vom Server |

Der letzte Punkt ist der einzige, den man merkt: Beim allerersten Besuch kommen CSS und JS vom
Server statt aus dem nächstgelegenen Rechenzentrum. Bei ein paar hundert Kilobyte hinter HTTP/2
ist das eine Größenordnung, die niemand sieht – bei sehr viel Verkehr sollte man es im Blick
behalten. Wird es zum Problem, ist der Schalter der richtige Ort dafür.

---

## Was der Schutz **nicht** anfasst

* **Suchmaschinen.** Die öffentlichen Seiten bleiben vollständig lesbar und indexierbar; `robots.txt`
  und `sitemap.xml` stehen unverändert.
* **Barrierefreiheit.** Vorlesewerkzeuge lesen den DOM, nicht die Zwischenablage. Tastaturbedienung,
  Fokusreihenfolge und `aria`-Angaben sind unangetastet.
* **Die API.** `/api/…` ist durch Anmeldung und Rechte geschützt, nicht durch diese Schicht. Ein
  Kunde, der seine eigenen Daten abruft, soll das können.
* **E-Mails.** Das Logo darin liegt der Nachricht als Anhang bei (`logo-mail.png`, eingebunden
  über `cid:`) und wird gar nicht mehr vom Server nachgeladen – es ist also auch dann da, wenn ein
  E-Mail-Programm Bilder aus dem Netz blockiert.

---

## Abschalten

**Administration → Einstellungen → Betrieb**, der jeweilige Schalter. Wirkt sofort für neue
Seitenaufrufe; bereits geladene Seiten behalten ihren Zustand bis zum Neuladen.

Gründe, *Dateien schützen* abzuschalten: eine Umgebung, in der `Sec-Fetch-*` verloren geht (manche
Firmen-Proxys), oder sehr viel Verkehr, bei dem CSS und JS wieder aus dem CDN kommen sollen.

Gründe, *Bedienung sperren* einzuschalten: der Wunsch, das Abgreifen von Gestaltung und Texten
unbequem zu machen. Der Preis dafür ist, dass auch die eigenen Kunden nichts mehr markieren können
– außer an den Stellen, die ausdrücklich dafür da sind (siehe oben).
