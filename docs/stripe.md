# Bezahlen mit Stripe

Karte, PayPal, Apple Pay, Google Pay, Klarna, EPS und was sonst noch dazukommt: alles läuft über
**Stripe**. AFKSystems sieht keine Kartendaten – aber, und das ist der Unterschied zu einem
Marktplatz: **Verkäufer bist du.**

---

## Inhalt

1. [Was Stripe ist – und was es nicht ist](#was)
2. [Bevor du anfängst: Konto, Gewerbe, Steuer](#vorher)
3. [Umsatzsteuer im Panel einstellen](#umsatzsteuer)
4. [Wie das Geld fließt](#ablauf)
5. [Einrichten](#einrichten)
6. [Den Webhook einrichten – der wichtigste Schritt](#webhook)
7. [Testen](#testen)
8. [Erstattungen und Streitfälle](#erstattung)
9. [Wenn etwas nicht geht](#fehlersuche)
10. [Was ohne Stripe geht](#ohne)

---

<a id="was"></a>

## 1. Was Stripe ist – und was es nicht ist

Stripe ist ein **Zahlungsdienstleister**. Es nimmt Geld entgegen und leitet es weiter. Das war es.

Der bisherige Anbieter (Tebex) war ein *Verkäufer im eigenen Namen* („merchant of record“): Der
Kunde kaufte dort, und Tebex kümmerte sich um Rechnung und Umsatzsteuer. **Bei Stripe ist das
anders.** Der Vertrag über die Credits kommt zwischen dir und deinem Kunden zustande.

Daraus folgen drei Dinge, die vorher woanders lagen:

| | vorher (Marktplatz) | jetzt (Stripe) |
| --- | --- | --- |
| Wer verkauft | der Marktplatz | **du** |
| Wer stellt den Beleg | der Marktplatz | **das Panel** (Beleg per E-Mail) |
| Wer entscheidet über die Umsatzsteuer | der Marktplatz | **du**, siehe [Abschnitt 3](#umsatzsteuer) |
| Wer trägt Rücklastschriften | der Marktplatz | **du** |

Was Stripe dafür bietet: eine gehostete Bezahlseite (Stripe Checkout), viele Zahlarten in einem
Vertrag, und eine saubere API. Was es **nicht** bietet: dass jemand anders deine Steuerfragen
beantwortet.

> Dieses Dokument beschreibt, was die Software tut. Es ist **keine Steuer- oder Rechtsberatung.**
> Bei Zweifeln: Steuerberatung oder die zuständige Kammer fragen. Eine halbe Stunde dort ist
> billiger als eine falsche Rechnung.

---

<a id="vorher"></a>

## 2. Bevor du anfängst: Konto, Gewerbe, Steuer

Diese vier Fragen gehören **vor** die erste Zeile in den Einstellungen. Sie hängen zusammen, aber
sie sind nicht dasselbe – und genau das wird oft vermischt.

### a) Nimmt Stripe dich als Kontoinhaber an?

Die Stripe-Bedingungen richten sich an **Unternehmen, Einzelunternehmer, bestimmte öffentliche
Einrichtungen und Non-Profits**, und jedes Konto wird von Stripe geprüft und freigegeben. „Reines
Privathobby ohne jede unternehmerische Tätigkeit“ ist dort kein vorgesehener Kontotyp.

Wenn dein Projekt tatsächlich ein Hobby ohne Gewinnerzielungsabsicht ist, **klär das vorher mit
Stripe**, statt beim Onboarding eine Unternehmensform anzugeben, die du nicht hast. Falsche Angaben
beim Onboarding sind der schlechteste aller Wege: Sie fliegen genau dann auf, wenn Geld auf dem
Konto liegt.

### b) Brauchst du ein Gewerbe?

Für das Gewerberecht ist die **Absicht** entscheidend, einen Ertrag oder wirtschaftlichen Vorteil
zu erzielen – nicht die bloße Tatsache, dass Geld hereinkommt. Rechtsprechung dazu gibt es; ein
Entgelt, das nur einen Teil der Unkosten decken soll, beweist für sich noch keine Ertragsabsicht.
Das ist aber eine Frage des Einzelfalls und keine, die eine Datei im Repository beantwortet.

### c) Einkommensteuer

Wer dauerhaft mehr ausgibt als einnimmt und das auch nicht ändern will, landet schnell bei dem,
was das Steuerrecht **Liebhaberei** nennt: kein steuerpflichtiger Gewinn – aber eben auch kein
Verlust, den man gegen andere Einkünfte (Ferialjob, Lohn) gegenrechnen kann. Beides gilt zusammen
oder gar nicht.

### d) Umsatzsteuer

Hier steckt der häufigste Denkfehler: **Umsatzsteuerlich kann man auch ohne Gewinnabsicht
Unternehmer sein.** „Ich will keinen Gewinn machen“ ist umsatzsteuerlich keine Aussage.

Der praktische Ausweg bei kleinen Beträgen ist die **Kleinunternehmerregelung**: Bis zur
gesetzlichen Umsatzgrenze (Österreich: 55.000 € Umsatz) bleiben die Umsätze von der Umsatzsteuer
befreit, sofern die Voraussetzungen erfüllt sind. Dann gilt:

* Du weist auf Rechnungen **keine** Umsatzsteuer aus.
* Du nennst stattdessen den Grund der Befreiung.
* Du kannst umgekehrt aus deinen eigenen Rechnungen (Server, Domain) **keine Vorsteuer** ziehen.

Wer als Kleinunternehmer trotzdem 20 % ausweist, **schuldet diese Steuer allein aufgrund der
Rechnung.** Deshalb ist die Vorgabe dieses Panels: keine Steuerzeile, dafür ein Hinweis.

### e) Kunden aus Deutschland und dem übrigen EU-Ausland

Credits sind eine elektronisch erbrachte Dienstleistung. Für EU-B2C-Digitalleistungen gibt es
grundsätzlich besondere Regeln zum Land des Kunden – **aber** für kleine Anbieter existiert eine
EU-weite Geringfügigkeitsschwelle von **10.000 €** an grenzüberschreitenden Umsätzen. Darunter
bleibt die Besteuerung grundsätzlich am Unternehmerort, und dort kann wiederum die
Kleinunternehmerbefreiung greifen. Bei zweistelligen Jahresumsätzen ist von dieser Schwelle nichts
zu sehen.

Praktische Folge: **Du brauchst OSS und Stripe Tax dann vermutlich nicht** – siehe der nächste
Abschnitt.

---

<a id="umsatzsteuer"></a>

## 3. Umsatzsteuer im Panel einstellen

**Administration → Einstellungen → Umsatzsteuer.**

| Feld | Bedeutung |
| --- | --- |
| Wie mit der Umsatzsteuer verfahren wird | **Kleinunternehmerregelung** (Vorgabe) oder **Stripe Tax** |
| Hinweis unter dem Preis (deutsch) | Vorgabe: *Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 6 Abs. 1 Z 27 UStG.* |
| Hinweis unter dem Preis (englisch) | dasselbe für `/en/…` |

Die Einstellung gilt für **alle** Zahlarten, nicht nur für Stripe: Eine Überweisung von Hand muss
denselben Beleg ergeben wie eine Kartenzahlung.

### Kleinunternehmerregelung (Vorgabe)

Der Preis ist der Endpreis. Aus 1,00 € wird:

```
AFKSystems · 100 Credits
Gesamtbetrag                       1,00 €
Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 6 Abs. 1 Z 27 UStG.
```

und ausdrücklich **nicht**:

```
Netto            0,83 €
20 % USt.        0,17 €
Brutto           1,00 €
```

Der Satz erscheint an vier Stellen, und überall im selben Wortlaut: auf der Preisseite, im
Guthaben-Bereich, an der Stripe-Kasse (unter dem Bezahlknopf) und auf dem Beleg per E-Mail.

Betreibst du das Panel nicht in Österreich, trag deinen eigenen Satz ein – in Deutschland wäre es
beispielsweise § 19 UStG.

### Stripe Tax

Nur sinnvoll, wenn du wirklich Umsatzsteuer schuldest. Dann rechnet Stripe sie aus und weist sie
an der Kasse aus; der Preis im Panel gilt dabei als **Bruttopreis** (`tax_behavior = inclusive`),
damit „10 €“ auf der Preisseite auch 10 € auf der Abrechnung sind.

Zwei Dinge dazu, bevor du den Schalter umlegst:

* **Stripe Tax ist ein kostenpflichtiges Zusatzprodukt** und muss im Stripe-Dashboard aktiviert
  sein. Ist es das nicht, lehnt Stripe den Bezahlvorgang ab – das Panel zeigt dann die Meldung von
  Stripe im Klartext an.
* Bei einem Projekt mit 10–20 € Jahresumsatz ist es mit einiger Sicherheit **unnötig**.

In dieser Betriebsart ist der eigene Hinweistext wirkungslos; es steht dann der Satz da, der
beschreibt, was wirklich passiert („Alle Preise sind Endpreise inklusive Umsatzsteuer …“).

### Und der Beleg?

Jede verbuchte Aufladung schickt eine E-Mail mit Leistung, Betrag und Umsatzsteuerhinweis. Das
ist der Beleg des Kunden. Deiner sind die Auszahlungen im Stripe-Dashboard plus deine Server- und
Domainrechnungen – **aufheben**, unabhängig davon, wie die Steuerfrage ausgeht.

---

<a id="ablauf"></a>

## 4. Wie das Geld fließt

```
Kunde klickt "Aufladen"
   │
   ├─► AFKSystems legt eine OFFENE Aufladung an (topups: status = open)
   │
   ├─► AFKSystems legt bei Stripe eine Checkout Session an, mit der Nummer der Aufladung darin
   │
   ├─► Kunde wird auf checkout.stripe.com geschickt und bezahlt dort
   │
   ├─► Kunde landet zurück auf /app#/credits?paid=<nummer>
   │      ▲ Das ist KEIN Zahlungsnachweis. Es wird davon nichts gebucht.
   │
   └─► Stripe ruft den Webhook auf:  POST /api/stripe/webhook
          │
          ├─ Unterschrift und Alter geprüft?   nein → 401, nichts passiert
          ├─ Test/Echtbetrieb passt zusammen?  nein → verworfen, Log
          ├─ Konto, Betrag und Währung passen? nein → Meldung ans Team, nichts gebucht
          └─ ja → Credits gutgeschrieben, Beleg per E-Mail, Ledger-Eintrag
```

**Guthaben entsteht ausschließlich im Webhook.** Weder die Rückkehr des Browsers noch ein Klick im
Panel bucht etwas. Wer die „Danke“-Seite hundertmal aufruft, bekommt nichts.

Bei Zahlarten mit Verzögerung (Lastschrift, manche Überweisungsverfahren) ist die Kasse abgeschlossen,
bevor das Geld da ist. Dann bleibt die Aufladung offen, bis `checkout.session.async_payment_succeeded`
eintrifft – und wird bei `…_failed` geschlossen.

---

<a id="einrichten"></a>

## 5. Einrichten

### Schritt 1 – Stripe-Konto

1. Konto bei <https://dashboard.stripe.com> anlegen und die Kontoprüfung abschließen
   (Identität, Geschäftstätigkeit, Bankverbindung). Vorher steht `charges_enabled` auf falsch,
   und es lässt sich nichts kassieren.
2. **Einstellungen → Zahlungsmethoden**: aussuchen, was der Kunde sehen soll (Karte, PayPal,
   Apple/Google Pay, EPS, Klarna …). Diese Auswahl trifft *Stripe*, nicht dieses Panel.

### Schritt 2 – Geheimen Schlüssel holen

**Entwickler → API-Schlüssel.** Es gibt zwei Sätze:

| | Schlüssel | wofür |
| --- | --- | --- |
| Testmodus | `sk_test_…` | üben, mit Stripes Testkarten, ohne Geld |
| Echtbetrieb | `sk_live_…` | echte Zahlungen |

Der geheime Schlüssel wird nur einmal vollständig angezeigt – gleich kopieren. Wer ihn hat, kann
in deinem Namen kassieren.

### Schritt 3 – Im Panel eintragen

**Administration → Einstellungen → Bezahlen mit Stripe**

| Feld | Wert |
| --- | --- |
| Bezahlen mit Stripe | **an** |
| Geheimer Schlüssel | `sk_test_…` zum Üben, später `sk_live_…` |
| Signaturgeheimnis des Webhooks | kommt in [Abschnitt 6](#webhook) |

Speichern.

> Solange *Bezahlen mit Stripe* ausgeschaltet ist, steht die Zahlart im Panel nicht zur Auswahl –
> auch dann nicht, wenn der Schlüssel eingetragen ist. Das ist der häufigste Grund für „alles
> ausgefüllt, aber ich kann nichts kaufen“.

### Schritt 4 – Aufladepakete prüfen

**Administration → Einstellungen → Guthaben und Tarife → Aufladepakete.** Betrag in Cent, dafür so
viele Credits. Alles über dem Betrag ist Bonus und wird auf der Preisseite als solcher ausgewiesen.

Name und Preis in der Stripe-Kasse kommen von hier – im Stripe-Dashboard muss dafür **nichts**
angelegt werden. In der Kasse steht dann `AFKSystems · 1050 Credits` zum Preis von 10,00 €.

Eine Grenze von Stripe, die man kennen sollte: Kartenzahlungen unter etwa **0,50 €** nimmt Stripe
nicht an. Ein Aufladepaket über 10 Cent wäre also eines, das nie funktioniert.

---

<a id="webhook"></a>

## 6. Den Webhook einrichten

**Ohne diesen Schritt wird nie ein Cent gutgeschrieben.** Der Webhook ist die einzige Stelle, an
der eine Zahlung zu Guthaben wird.

### Schritt 1 – Endpunkt anlegen

1. Im Stripe-Dashboard: **Entwickler → Webhooks → Endpunkt hinzufügen**
2. URL: `https://example.invalid/api/stripe/webhook`
   (Die genaue Adresse steht auch im Panel über der Einstellungsgruppe.)
3. Diese Ereignisse abonnieren:
   * `checkout.session.completed` – **Pflicht**
   * `checkout.session.async_payment_succeeded`
   * `checkout.session.async_payment_failed`
   * `checkout.session.expired`
   * `charge.refunded`
   * `charge.dispute.created`
   * `charge.dispute.closed`
4. Hinzufügen.

### Schritt 2 – Geheimnis eintragen

Neben dem Endpunkt steht jetzt ein **Signing secret** (`whsec_…`). Es gehört in
**Administration → Einstellungen → Bezahlen mit Stripe → Signaturgeheimnis des Webhooks**. Speichern.

Solange dort nichts steht, weist AFKSystems **jede** Zahlungsmeldung mit `401` ab – auch echte.
Das ist so gewollt: Ein Endpunkt ohne Unterschriftsprüfung wäre ein Formular zum Geldverschenken.

> **Testmodus und Echtbetrieb haben getrennte Endpunkte und getrennte Geheimnisse.** Beim
> Umschalten also **beides** wechseln: Schlüssel *und* Signaturgeheimnis. Passen sie nicht
> zusammen, verwirft das Panel die Meldung ausdrücklich (`ignored: livemode`) und schreibt es ins
> Log – sonst würden kostenlose Testzahlungen echtes Guthaben erzeugen.

### Wie die Unterschrift geprüft wird

Stripe schickt den Kopf `Stripe-Signature: t=…,v1=…`. Unterschrieben wird `"<t>.<roher Rumpf>"` mit
HMAC-SHA-256 und dem Endpunkt-Geheimnis. Geprüft wird beides: die Unterschrift **und** das Alter
(fünf Minuten) – ohne das zweite bliebe eine einmal mitgeschnittene Meldung für immer
wiederverwendbar. Genau das steht in `server/stripe.js`; der rohe Rumpf ist der Grund, warum die
Route in `server/index.js` **vor** dem JSON-Parser steht.

---

<a id="testen"></a>

## 7. Testen

Anders als bei manch anderem Anbieter gibt es hier einen echten Sandkasten: den **Testmodus** von
Stripe. Damit lässt sich der ganze Weg durchspielen, ohne dass ein Cent bewegt wird.

### Schritt 1 – Nimmt Stripe meinen Schlüssel an?

**Administration → Einstellungen → Bezahlen mit Stripe → Verbindung prüfen.**

Der Knopf fragt das Konto ab und legt eine Kasse über einen Euro an, die er liegen lässt (sie
läuft nach einer halben Stunde ab). Zurück kommt:

| Antwort | Bedeutung |
| --- | --- |
| *Stripe hat den Schlüssel angenommen … (Testmodus/Echtbetrieb)* | alles richtig eingetragen |
| *… aber dieses Konto darf noch nicht kassieren* | Kontoprüfung bei Stripe noch nicht durch |
| `Stripe: Invalid API Key provided` | Schlüssel falsch oder widerrufen |
| *In den Einstellungen fehlt: Geheimer Schlüssel* | das Feld ist leer |

Daneben steht, ob gerade **Echtbetrieb** oder **Testmodus** gilt. Diese Anzeige ist die schnellste
Antwort auf „warum passiert nichts“.

### Schritt 2 – Kommt der Weg zurück an?

**Entwickler → Webhooks → Endpunkt → „Send test webhook“.** Kommt nichts an oder gibt es einen
401, stimmt die Adresse oder das Geheimnis nicht:

```bash
journalctl -u afksystems -n 100 | grep stripe
```

### Schritt 3 – Ein echter Kauf im Testmodus

Der einzige Weg, der wirklich alles prüft: Zahlung, Webhook, Betragsvergleich, Buchung, Beleg.

1. Testschlüssel (`sk_test_…`) und Test-Signaturgeheimnis eintragen.
2. Im Panel aufladen, an der Kasse die Stripe-Testkarte `4242 4242 4242 4242` benutzen
   (beliebiges künftiges Ablaufdatum, beliebige Prüfziffer).
3. Danach nachsehen:
   * **Administration → Aufladungen** – die Aufladung steht auf *bezahlt*.
   * **Administration → Buchungen** – der Ledger-Eintrag mit `Stripe pi_…`.
   * **Administration → Post** – der Beleg, der an den Kunden ging, mit dem Umsatzsteuerhinweis.
   * Beim Kunden: das Guthaben ist da, live und ohne Neuladen.
4. Im Stripe-Dashboard die Testzahlung erstatten – die Credits müssen wieder verschwinden.

Erst danach auf `sk_live_…` **und** das Live-Signaturgeheimnis umstellen.

---

<a id="erstattung"></a>

## 8. Erstattungen und Streitfälle

| Meldung von Stripe | Was AFKSystems tut |
| --- | --- |
| `charge.refunded` (voll) | Aufladung auf *erstattet*, Credits werden abgezogen, Meldung ans Team |
| `charge.refunded` (teilweise) | **nichts** wird zurückgebucht, nur eine Meldung ans Team |
| `charge.dispute.created` | nur eine Meldung ans Team – noch ist nichts entschieden |
| `charge.dispute.closed` mit *lost* | wie die volle Erstattung |
| `charge.dispute.closed` sonst | nur eine Meldung ans Team |

Eine **Teilerstattung** bleibt bewusst Handarbeit: Wie viele Credits das sein sollen, ist keine
Rechenaufgabe, sondern eine Entscheidung.

Abgezogen wird **höchstens, was noch da ist**: ins Minus geht ein Konto hier nie. War das Guthaben
schon ausgegeben, steht in der Meldung ans Team, wie viele Credits fehlen. Was dann passiert, ist
eine Entscheidung des Betreibers und keine der Software.

---

<a id="fehlersuche"></a>

## 9. Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Zahlart steht nicht zur Auswahl | **Bezahlen mit Stripe** ist aus, oder der Schlüssel fehlt | Schalter an; **Verbindung prüfen** sagt, was fehlt |
| *"Stripe: Invalid API Key provided"* | Schlüssel falsch, widerrufen oder aus dem falschen Modus | im Dashboard neu erzeugen |
| *"… may not take payments yet"* | Kontoprüfung bei Stripe nicht abgeschlossen | im Dashboard fertig machen |
| *"Stripe: … automatic_tax …"* | Stripe Tax ist im Panel an, im Dashboard aber nicht | entweder dort einschalten oder im Panel auf Kleinunternehmerregelung zurück |
| Bezahlt, aber kein Guthaben | Webhook fehlt, falsches Geheimnis, oder Test/Echt verwechselt | `journalctl -u afksystems | grep stripe` |
| Log sagt *"verworfen: Meldung ist aus dem Testmodus"* | Schlüssel und Endpunkt gehören zu verschiedenen Modi | beides auf denselben Modus bringen |
| Log sagt *"Betrag passt nicht"* | Aufladepaket wurde nach dem Anlegen der Kasse geändert | Aufladung von Hand bestätigen; die Zahlung ist nicht verloren |
| Log sagt *"ohne zugehörige Aufladung"* | Zahlung ohne unsere Nummer – etwa direkt im Dashboard erzeugt | von Hand gutschreiben (**Administration → Nutzer → Guthaben buchen**) |
| Log sagt *"stripe_webhook_secret fehlt"* | Geheimnis nicht eingetragen | siehe [Abschnitt 6](#webhook) |

Eine Zahlung, die nicht automatisch gebucht wurde, ist nie verloren: Sie steht bei Stripe, und im
Panel lässt sich die offene Aufladung unter **Administration → Aufladungen** von Hand bestätigen.

---

<a id="ohne"></a>

## 10. Was ohne Stripe geht

Auch ohne eingerichtetes Stripe bleibt das Panel benutzbar:

* **Gutscheine** – **Administration → Gutscheine**. Immer verfügbar.
* **Überweisung und PayPal von Hand** – Bankdaten in der `.env` (`BANK_IBAN`, `PAYPAL_ME`). Der
  Kunde bekommt einen Verwendungszweck, der Admin bestätigt den Eingang unter
  **Administration → Aufladungen**. Der Umsatzsteuerhinweis auf dem Beleg gilt hier genauso.
* **Direkt aufbuchen** – **Administration → Nutzer → *Nutzer* → Guthaben buchen**, oder auf der
  Kommandozeile `npm run admin:credits`.
