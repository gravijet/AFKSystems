# Bezahlen mit Tebex

Karte, PayPal, Apple Pay, Google Pay, Sofort, Giropay und was sonst noch dazukommt: alles läuft
über **Tebex**. AFKSystems fasst nie Geld an und sieht keine Kartendaten.

---

## Inhalt

1. [Warum Tebex und nicht ein Zahlungsanbieter direkt](#warum)
2. [Wie das Geld fließt](#ablauf)
3. [Welchen der beiden Wege du brauchst](#wege)
4. [Einrichten: Checkout-API](#checkout)
5. [Einrichten: Headless-API](#headless)
6. [Den Webhook einrichten – der wichtigste Schritt](#webhook)
7. [Testen](#testen)
8. [Rückerstattungen und Rücklastschriften](#rueckerstattung)
9. [Wenn etwas nicht geht](#fehlersuche)
10. [Was ohne Tebex geht](#ohne)

---

<a id="warum"></a>

## 1. Warum Tebex

Tebex ist **Verkäufer im eigenen Namen** (merchant of record). Das heißt: Tebex verkauft an deinen
Kunden, nicht du. Daran hängen drei Dinge, die man sonst selbst erledigen müsste:

* **Umsatzsteuer.** Tebex ermittelt, meldet und führt sie ab – in jedem Land, in dem gekauft wird.
* **Zahlungsarten.** Karte, PayPal, Apple/Google Pay, lokale Verfahren. Ein Vertrag statt fünf.
* **Betrug und Rücklastschriften.** Tebex prüft, sperrt und trägt die Auseinandersetzung.

Der Preis dafür ist eine Gebühr je Zahlung und dass die Bezahlseite von Tebex kommt und nicht von
AFKSystems.

Wichtig für die Rechtstexte: In der Datenschutzerklärung steht Tebex bereits als Empfänger von
Abrechnungsdaten. Wer den Text selbst überschreibt, muss das dort behalten.

---

<a id="ablauf"></a>

## 2. Wie das Geld fließt

```
Kunde klickt "Aufladen"
   │
   ├─► AFKSystems legt eine OFFENE Aufladung an (topups: status = open)
   │
   ├─► AFKSystems fragt bei Tebex einen Warenkorb an, mit der Nummer der Aufladung darin
   │
   ├─► Kunde wird auf checkout.tebex.io geschickt und bezahlt dort
   │
   ├─► Kunde landet zurück auf /app#/credits?paid=<nummer>
   │      ▲ Das ist KEIN Zahlungsnachweis. Es wird davon nichts gebucht.
   │
   └─► Tebex ruft den Webhook auf:  POST /api/tebex/webhook
          │
          ├─ Unterschrift geprüft?     nein → 401, nichts passiert
          ├─ Betrag stimmt überein?    nein → Meldung ans Team, nichts gebucht
          └─ ja → Credits gutgeschrieben, Beleg per E-Mail, Ledger-Eintrag
```

**Guthaben entsteht ausschließlich im Webhook.** Weder die Rückkehr des Browsers noch ein Klick im
Panel bucht etwas. Wer die "Danke"-Seite hundertmal aufruft, bekommt nichts.

---

<a id="wege"></a>

## 3. Welchen der beiden Wege du brauchst

Tebex bietet zwei APIs. Beide funktionieren hier, und in **Administration → Einstellungen →
Bezahlen mit Tebex** steht unter *Weg*, welcher gilt.

| | **Checkout-API** | **Headless-API** |
| --- | --- | --- |
| Wo stehen Preis und Name | in AFKSystems (Aufladepakete) | im Tebex-Webstore |
| Neues Paket anlegen | ein Klick im Panel | im Tebex-Panel **und** im Panel |
| Zugangsdaten | Projekt-ID + privater Schlüssel | öffentlicher Store-Token |
| Freischaltung durch Tebex nötig | **ja** | nein |
| Empfehlung | wenn Tebex es freischaltet | sonst |

Die Checkout-API ist die angenehmere: Ein neues Aufladepaket ist dort ein Klick im Admin-Bereich
und sonst nichts. Tebex schaltet sie aber nicht für jedes Konto frei – frag deinen
Ansprechpartner oder den Support. Bis dahin nimm die Headless-API; für den Kunden sieht beides
gleich aus.

---

<a id="checkout"></a>

## 4. Einrichten: Checkout-API

### Schritt 1 – Zugangsdaten holen

1. Bei <https://creator.tebex.io> anmelden.
2. **Developers → API Keys**.
3. Dort stehen **Project ID** und **Private Key**. Der private Schlüssel wird nur einmal
   angezeigt – gleich kopieren.

Steht dort nichts oder ist die Checkout-API nicht freigeschaltet, geht es mit
[Abschnitt 5](#headless) weiter.

### Schritt 2 – Im Panel eintragen

**Administration → Einstellungen → Bezahlen mit Tebex**

| Feld | Wert |
| --- | --- |
| Bezahlen mit Tebex | **an** |
| Weg | **Checkout-API (Preise kommen von hier)** |
| Projekt-ID (Checkout) | die Project ID |
| Privater Schlüssel (Checkout) | der Private Key |
| Webhook-Geheimnis | kommt in [Abschnitt 6](#webhook) |
| Adresse des Stores | optional, z. B. `https://afksystems.tebex.io` |

Speichern.

### Schritt 3 – Aufladepakete prüfen

**Administration → Einstellungen → Guthaben und Tarife → Aufladepakete.** Betrag in Cent, dafür so
viele Credits. Alles über dem Betrag ist Bonus und wird auf der Preisseite als solcher ausgewiesen.
Die Spalte **Tebex-Paket** bleibt beim Checkout-Weg leer.

Beim Bezahlen steht im Warenkorb dann `AFKSystems · 1050 Credits` zum Preis von 10,00 €.

Weiter mit [Abschnitt 6](#webhook).

---

<a id="headless"></a>

## 5. Einrichten: Headless-API

### Schritt 1 – Pakete im Tebex-Webstore anlegen

Für **jedes** Aufladepaket eines im Webstore:

1. **Packages → Create Package**
2. Name: `1050 Credits` (das sieht der Kunde im Warenkorb)
3. Preis: `10.00 EUR` – **muss** dem Betrag im Panel entsprechen, sonst wird nicht gebucht
4. Type: `Single Purchase`
5. Speichern und die **Package ID** notieren (die Zahl in der Adresse oder in der Liste)

### Schritt 2 – Store-Token holen

**Developers → API Keys → Webstore Identifier / Public Token.** Der Token ist öffentlich, er darf
im Browser stehen – trotzdem gehört er nur ins Panel.

### Schritt 3 – Im Panel eintragen

**Administration → Einstellungen → Bezahlen mit Tebex**

| Feld | Wert |
| --- | --- |
| Bezahlen mit Tebex | **an** |
| Weg | **Headless-API (Pakete liegen im Tebex-Store)** |
| Store-Token (Headless) | der öffentliche Token |
| Webhook-Geheimnis | kommt in [Abschnitt 6](#webhook) |

### Schritt 4 – Pakete verbinden

**Administration → Einstellungen → Guthaben und Tarife → Aufladepakete.** In die Spalte
**Tebex-Paket** je Zeile die Package ID aus Schritt 1 eintragen.

Fehlt sie, sagt das Panel beim Bezahlen: *"Für das Paket … steht keine Tebex-Paket-ID in den
Einstellungen."* Das ist Absicht – lieber eine klare Meldung als ein Warenkorb, in dem etwas
anderes liegt, als der Kunde bestellt hat.

---

<a id="webhook"></a>

## 6. Den Webhook einrichten

**Ohne diesen Schritt wird nie ein Cent gutgeschrieben.** Der Webhook ist die einzige Stelle, an
der eine Zahlung zu Guthaben wird.

### Schritt 1 – Endpunkt anlegen

1. Im Tebex-Panel: **Developers → Webhooks → Endpoints → Add Endpoint**
2. URL: `https://example.invalid/api/tebex/webhook`
   (Die genaue Adresse steht auch im Panel über der Einstellungsgruppe.)
3. Diese Arten abonnieren:
   * `payment.completed` – **Pflicht**
   * `payment.refunded`
   * `payment.dispute.opened`
   * `payment.dispute.lost`
4. Hinzufügen.

### Schritt 2 – Geheimnis eintragen

Neben dem Endpunkt steht jetzt ein **Webhook Secret**. Es gehört in
**Administration → Einstellungen → Bezahlen mit Tebex → Webhook-Geheimnis**. Speichern.

Solange dort nichts steht, weist AFKSystems **jede** Zahlungsmeldung mit `401` ab – auch echte.
Das ist so gewollt: Ein Endpunkt ohne Unterschriftsprüfung wäre ein Formular zum Geldverschenken.

### Schritt 3 – Bestätigen

Zurück im Tebex-Panel: neben dem Endpunkt auf **Validate** klicken. Tebex schickt eine Prüfnachricht,
AFKSystems antwortet mit deren Nummer, und der Endpunkt gilt als bestätigt.

Im Log des Panels steht dann:

```
[tebex] Webhook bestätigt.
```

Falls nicht: `journalctl -u afksystems -n 100 | grep tebex`

### Wie die Unterschrift geprüft wird

Tebex bildet sie so: erst den **rohen** Rumpf der Anfrage mit SHA-256 hashen, dann diesen Hash als
Text mit dem Webhook-Geheimnis per HMAC-SHA-256 signieren. Genau das steht in `server/tebex.js`.
Der rohe Rumpf ist wichtig – deshalb steht die Route in `server/index.js` **vor** dem JSON-Parser.

---

<a id="testen"></a>

## 7. Testen

### Erst die Wahrheit

**Es gibt bei Tebex keinen zweiten Server zum Üben.** `checkout.tebex.io` ist die einzige Adresse;
einen Sandkasten mit eigener Adresse und Testkarten, wie ihn Stripe oder PayPal haben, gibt es
nicht. Ob ein Kauf echt abgerechnet wird, entscheidet allein der **Testmodus deines Stores** im
Tebex-Panel – nicht die API und nicht dieses Panel.

Deshalb zerfällt "testen" hier in drei Schritte, die man einzeln beantworten kann.

### Schritt 1 – Nimmt Tebex meine Zugangsdaten an?

**Administration → Einstellungen → Bezahlen mit Tebex → Verbindung prüfen.**

Der Knopf legt einen echten Warenkorb über einen Cent an und lässt ihn liegen. Es fließt kein Geld,
und er läuft von selbst ab. Zurück kommt entweder eine Bezahladresse – dann stimmen Projekt-ID und
Schlüssel und die Checkout-API ist für dein Projekt freigeschaltet – oder die Meldung von Tebex im
Klartext:

| Antwort | Bedeutung |
| --- | --- |
| *Tebex hat die Zugangsdaten angenommen …* | alles richtig eingetragen |
| `Tebex: 401 Unauthorized` | Projekt-ID oder privater Schlüssel falsch |
| `Tebex: 403` / *not enabled* | Checkout-API für dieses Projekt nicht freigeschaltet → [Headless-Weg](#headless) |
| *In den Einstellungen fehlt: …* | das genannte Feld ist leer |

> **Wichtig:** Solange *Bezahlen mit Tebex* ausgeschaltet ist, steht die Zahlart im Panel nicht zur
> Auswahl – auch dann nicht, wenn alle Schlüssel eingetragen sind. Genau das ist der häufigste
> Grund für "es sind alle Informationen da, aber ich kann nichts kaufen". Der Prüfknopf funktioniert
> trotzdem, damit sich die Zugangsdaten vor dem Einschalten prüfen lassen.

### Schritt 2 – Kommt der Weg zurück an?

**Developers → Webhooks → Send Test** im Tebex-Panel: eine Art auswählen, abschicken. Im Log des
Panels steht dann `[tebex] Webhook bestätigt.` Kommt nichts an, stimmt die Adresse oder das
Geheimnis nicht:

```bash
journalctl -u afksystems -n 100 | grep tebex
```

### Schritt 3 – Der eine echte Kauf

Das ist der einzige Weg, der wirklich alles prüft: Zahlung, Webhook, Betragsvergleich, Buchung,
Beleg. Zwei Möglichkeiten:

* **Testmodus des Stores.** Steht dein Tebex-Store auf Test, laufen Käufe über Tebex' Testzahlarten
  und kosten nichts. Wo der Schalter steht und welche Zahlarten er freigibt, sagt dein Tebex-Panel
  – das ist eine Einstellung dort, nicht hier.
* **Kleinstes Paket wirklich kaufen und danach erstatten.** Die Erstattung meldet Tebex als
  `payment.refunded`, und das Panel zieht die Credits wieder ab – damit ist gleich der zweite Weg
  mitgeprüft.

### Danach nachsehen

* **Administration → Aufladungen** – die Aufladung steht auf *bezahlt*.
* **Administration → Buchungen** – der Ledger-Eintrag mit `Tebex tbx-…`.
* **Administration → Post** – der Beleg, der an den Kunden ging.
* Beim Kunden: das Guthaben ist da, live und ohne Neuladen.

---

<a id="rueckerstattung"></a>

## 8. Rückerstattungen und Rücklastschriften

| Meldung von Tebex | Was AFKSystems tut |
| --- | --- |
| `payment.refunded` | Aufladung auf *erstattet*, Credits werden abgezogen, Meldung ans Team |
| `payment.dispute.lost` | dasselbe |
| `payment.dispute.opened` | nur eine Meldung ans Team – noch ist nichts entschieden |

Abgezogen wird **höchstens, was noch da ist**: ins Minus geht ein Konto hier nie. War das Guthaben
schon ausgegeben, steht in der Meldung ans Team, wie viele Credits fehlen. Was dann passiert, ist
eine Entscheidung des Betreibers und keine der Software.

---

<a id="fehlersuche"></a>

## 9. Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Zahlart steht nicht zur Auswahl | **Bezahlen mit Tebex** ist aus, oder ein Schlüssel fehlt | Schalter an; beim Checkout-Weg braucht es Projekt-ID *und* privaten Schlüssel. Der Knopf **Verbindung prüfen** sagt, was davon fehlt |
| *"Tebex: 401 Unauthorized"* | Projekt-ID oder Schlüssel falsch | in creator.tebex.io neu erzeugen |
| *"Tebex: 403"* / *"not enabled"* | Checkout-API nicht freigeschaltet | auf den Headless-Weg umstellen |
| *"Tebex hat keine Bezahladresse zurückgegeben"* | Warenkorb leer | beim Headless-Weg: Paket-ID falsch oder Paket deaktiviert |
| Bezahlt, aber kein Guthaben | Webhook nicht bestätigt oder Geheimnis falsch | `journalctl -u afksystems | grep tebex` |
| Log sagt *"Betrag passt nicht"* | Preis im Tebex-Store weicht vom Paket im Panel ab | beide angleichen; die Zahlung ist nicht verloren, sie wird nur nicht automatisch gebucht |
| Log sagt *"ohne zugehörige Aufladung"* | Zahlung ohne unsere Nummer – etwa ein Kauf direkt im Tebex-Store | von Hand gutschreiben (**Administration → Nutzer → Guthaben buchen**) |
| Log sagt *"tebex_webhook_secret fehlt"* | Geheimnis nicht eingetragen | siehe [Abschnitt 6](#webhook) |

Eine Zahlung, die nicht automatisch gebucht wurde, ist nie verloren: Sie steht bei Tebex, und im
Panel lässt sich die offene Aufladung unter **Administration → Aufladungen** von Hand bestätigen.

---

<a id="ohne"></a>

## 10. Was ohne Tebex geht

Auch ohne eingerichtetes Tebex bleibt das Panel benutzbar:

* **Gutscheine** – **Administration → Gutscheine**. Immer verfügbar.
* **Überweisung und PayPal von Hand** – Bankdaten in der `.env` (`BANK_IBAN`, `PAYPAL_ME`). Der
  Kunde bekommt einen Verwendungszweck, der Admin bestätigt den Eingang unter
  **Administration → Aufladungen**.
* **Direkt aufbuchen** – **Administration → Nutzer → *Nutzer* → Guthaben buchen**, oder auf der
  Kommandozeile `npm run admin:credits`.
