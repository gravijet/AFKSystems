# Anmelden mit Google einrichten

Kostenlos. Es fällt nichts an, solange nur Name und E-Mail-Adresse gelesen werden – und mehr liest
AFKSystems nicht. Dauer: etwa zehn Minuten.

Am Ende können Kunden sich mit einem Klick anmelden und ihr Google-Konto in den Einstellungen
verknüpfen.

---

## 1. Projekt anlegen

1. <https://console.cloud.google.com/> öffnen und mit dem Google-Konto anmelden, dem das später
   gehören soll.
2. Oben in der Leiste auf die **Projektauswahl** klicken → **Neues Projekt**.
3. Name: `AFKSystems`. Organisation und Speicherort so lassen, wie sie sind.
4. **Erstellen**, dann warten, bis das Projekt oben ausgewählt ist.

> Ein privates Google-Konto reicht. „Organisation“ bleibt leer, das ist normal.

## 2. Zustimmungsbildschirm einrichten

Das ist die Seite, die dem Kunden gezeigt wird: „AFKSystems möchte auf dein Konto zugreifen“.

1. Links im Menü **APIs und Dienste → OAuth-Zustimmungsbildschirm**.
2. Nutzertyp **Extern** wählen → **Erstellen**.
   *Intern* gibt es nur mit Google Workspace und würde alle außer der eigenen Firma aussperren.
3. **App-Informationen**
   * App-Name: `AFKSystems`
   * Nutzersupport-E-Mail: deine Adresse
   * App-Logo: `public/assets/img/logo-256.png` hochladen (freiwillig, sieht aber besser aus)
4. **App-Domain**
   * Startseite: `https://afksystems.de`
   * Datenschutzerklärung: `https://afksystems.de/de/privacy`
   * Nutzungsbedingungen: `https://afksystems.de/de/terms`
5. **Autorisierte Domains**: `afksystems.de` eintragen.
6. Kontakt-E-Mail des Entwicklers: deine Adresse. → **Speichern und fortfahren**
7. **Bereiche (Scopes)**: **Bereiche hinzufügen oder entfernen** und genau diese drei anhaken:
   * `.../auth/userinfo.email`
   * `.../auth/userinfo.profile`
   * `openid`

   Mehr nicht. Diese drei gelten bei Google als *nicht sensibel* – deshalb ist **keine
   Überprüfung** nötig und es kostet nichts.
8. **Testnutzer**: fürs Erste die eigene Adresse eintragen. → **Speichern und fortfahren**

## 3. Anmeldedaten erzeugen

1. Links **APIs und Dienste → Anmeldedaten**.
2. **Anmeldedaten erstellen → OAuth-Client-ID**.
3. Anwendungstyp: **Webanwendung**.
4. Name: `AFKSystems Panel`.
5. **Autorisierte Weiterleitungs-URIs → URI hinzufügen**, und zwar genau so:

   ```
   https://afksystems.de/api/auth/google/callback
   ```

   Genau so heißt, wirklich genau so: `https` statt `http`, kein Schrägstrich am Ende, keine
   `www.`-Fassung. Google vergleicht Zeichen für Zeichen, und der häufigste Fehler in diesem
   ganzen Ablauf ist ein Schrägstrich zu viel.

   *Zum Ausprobieren auf dem eigenen Rechner zusätzlich:*
   ```
   http://127.0.0.1:3010/api/auth/google/callback
   ```
6. **Erstellen**. Es erscheint ein Fenster mit **Client-ID** und **Clientschlüssel** – beides
   kopieren. Der Schlüssel lässt sich später nicht mehr anzeigen, nur ersetzen.

## 4. Im Panel eintragen

*Administration → Einstellungen → Google*:

| Feld | Wert |
| --- | --- |
| Client-ID | endet auf `.apps.googleusercontent.com` |
| Client Secret | beginnt meist mit `GOCSPX-` |
| Anmelden mit Google | einschalten |

Speichern. Ab sofort steht auf der Anmeldeseite ein Knopf, und in den Einstellungen lässt sich das
Google-Konto verknüpfen.

## 5. Ausprobieren

1. In einem privaten Fenster `https://afksystems.de/de/login` öffnen.
2. **Mit Google anmelden** klicken.
3. Anmelden. Es sollte zurück ins Panel gehen.

Beim ersten Mal steht dort „Google hat diese App nicht überprüft“. Das ist erwartbar, solange die
App auf **Test** steht: mit **Erweitert → Weiter zu AFKSystems** kommt man durch. Nur eingetragene
Testnutzer kommen so weit.

## 6. Für alle freigeben

Solange die App auf **Test** steht, dürfen sich nur die eingetragenen Testnutzer anmelden (höchstens
100). Für alle anderen:

1. **APIs und Dienste → OAuth-Zustimmungsbildschirm**
2. **App veröffentlichen** → bestätigen.

Weil nur die drei nicht sensiblen Bereiche verwendet werden, ist damit alles erledigt: **keine
Überprüfung, keine Wartezeit, keine Kosten.** Der Hinweis „nicht überprüft“ verschwindet.

---

## Was AFKSystems dabei sieht

Nur, was Google in diesen drei Bereichen herausgibt: **Name, E-Mail-Adresse, Profilbild und eine
unveränderliche Konto-ID.** Kein Passwort, keine Kontakte, kein Drive, keine Mails. Gespeichert
werden die ID und die Adresse – mehr braucht es nicht, um beim nächsten Mal dasselbe Konto
wiederzuerkennen.

Ein Kunde kann die Verknüpfung jederzeit in seinen Einstellungen wieder lösen.

---

## Wenn etwas nicht geht

| Meldung | Ursache | Abhilfe |
| --- | --- | --- |
| `redirect_uri_mismatch` | Weiterleitungsadresse stimmt nicht | Zeichen für Zeichen vergleichen, auch auf Schrägstrich am Ende achten |
| `access_blocked` / „nicht überprüft“ | App steht auf Test, Konto ist kein Testnutzer | Testnutzer eintragen oder App veröffentlichen |
| `invalid_client` | Client-ID oder Secret falsch abgetippt | im Panel neu eintragen; Secret notfalls neu erzeugen |
| Knopf taucht nicht auf | Schalter aus oder Felder leer | *Einstellungen → Google* prüfen |
| „Google hat keine bestätigte E-Mail-Adresse mitgeschickt“ | Adresse bei Google unbestätigt | dort bestätigen, oder Konto normal anlegen und danach verknüpfen |

---

## Dasselbe für Discord

Der Ablauf ist derselbe, nur bei Discord: die Anleitung dazu steht in
[discord-bot.md](discord-bot.md) unter *Anwendung bei Discord anlegen*. Die Weiterleitungsadresse
dort ist `https://afksystems.de/api/auth/discord/callback`.
