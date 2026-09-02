# Dokumentation

Alles zu AFKSystems an einer Stelle. Die kurze Fassung des Ganzen steht in der
[README im Wurzelverzeichnis](../README.md).

## Einrichten

| Anleitung | Worum es geht |
| --- | --- |
| **[standorte.md](standorte.md)** | Standorte anlegen: ein VPS als Maschine für Bots, eine zweite Ausgangsadresse, oder beides. Mit allen Befehlen zum Kopieren. |
| **[stripe.md](stripe.md)** | Bezahlen mit Stripe: Konto und Steuerfragen vorab, Umsatzsteuer, Schlüssel, Webhook, Testen, Erstattungen. |
| **[discord-bot.md](discord-bot.md)** | Den Discord-Bot aufsetzen: Anwendung, Rechte, Kanäle, Rollen, Tickets. |
| **[google-anmeldung.md](google-anmeldung.md)** | Anmelden mit Google einrichten. |
| **[umzug.md](umzug.md)** | Auf einen anderen Server umziehen: was mitmuss, in welcher Reihenfolge, und warum zwei laufende Panels sich gegenseitig kaputt machen. |

## Verstehen

| Dokument | Worum es geht |
| --- | --- |
| **[aufbau.md](aufbau.md)** | Wie alles funktioniert: Aufbau, Datenflüsse, das Leben eines Bots, Chat und Farben, Geld, Datenbank, Betrieb. |
| **[verwaltung.md](verwaltung.md)** | Der Admin-Bereich: Suche über alles, Massenaktionen, Ausfuhr, Sicherheit, Sicherungen, Betrieb, Textbausteine, Rundmail, Erstattungen, Systemmeldungen, Belege, Kontolöschungen. |
| **[live-ansicht.md](live-ansicht.md)** | Die Live-Ansicht (POV): die beiden Wege zu einem Bild, die Minecraft-Ressourcen, Steuern im Bild, Sichtweite, was sie kostet. |
| **[schutz.md](schutz.md)** | Inhaltsschutz: was gegen Kopieren und Herunterladen getan wird – und was ehrlicherweise nicht geht. |

## Sicherheitsbetrieb

Die Produktionsvorlagen erzwingen HTTPS, prüfen Cloudflare-Herkünfte vor der Übernahme von
`CF-Connecting-IP` und starten Panel sowie Agent mit restriktiven systemd-Sandboxen. Bei Docker
oder einem getrennten Reverse Proxy muss `TRUST_PROXY` in `.env` auf dessen konkretes Netz gesetzt
werden; `true` würde beliebige weitergereichte Client-IP-Köpfe vertrauen.

## Häufige Wege

**Ein neuer Standort soll her.**
→ [standorte.md, Fall 1](standorte.md#fall-1)

**Kunden sollen mit Karte bezahlen können.**
→ [stripe.md](stripe.md), danach unbedingt [den Webhook einrichten](stripe.md#webhook)

**Ein Kunde will die Live-Ansicht.**
→ Serverplatz → Zusätze → Live-Ansicht. Einzelheiten in [live-ansicht.md](live-ansicht.md)

**Die Live-Ansicht soll echte Texturen zeigen statt Voxel.**
→ Ab Client 2.6.0 tut sie das von selbst. Eine hinterlegte Client-JAR je Minecraft-Version spart
trotzdem je Kunde einen eigenen 30-MB-Download:
[live-ansicht.md, Minecraft-Ressourcen](live-ansicht.md#minecraft-ressourcen-einrichten) –
Standorte holen sie sich selbst

**Der Chat kommt farblos an.**
→ [aufbau.md, Abschnitt 4](aufbau.md#chat) – der Client darf nicht mit `--no-color` laufen

**Ein Bot startet nicht.**
→ Zuerst nachsehen, ob der **Zielserver** überhaupt läuft: Serverplatz → *Verbinden*, unter der
Kontenliste. Danach [aufbau.md, Abschnitt 2](aufbau.md#botleben) für die Reihenfolge der Prüfungen,
[standorte.md, Abschnitt 9](standorte.md#fehlersuche), wenn er auf einem Standort liegt

**Es gibt eine neue Client-Fassung, und die Bots laufen noch mit der alten.**
→ *Administration → Client* für alle auf einmal, oder Serverplatz → *Verbinden* für die eigenen.
Warum das kein Automatismus ist: [aufbau.md, Abschnitt 3](aufbau.md#client)

**Ein Kunde sagt, er bekomme bei jeder Anmeldung einen Code.**
→ Dann ist sein Browser nach jeder Anmeldung wieder unbekannt – meist, weil er Cookies beim
Schließen löscht. Abschalten kann er den Code selbst unter *Einstellungen → Sicherheit*;
Hintergrund in [aufbau.md, Abschnitt 9](aufbau.md#konten)

**Ein Kunde will denselben Aufbau auf einem zweiten Server.**
→ Serverplatz → *Einstellungen → Diesen Platz kopieren*. Macros, Zeitpläne, wiederkehrende
Nachrichten und alle Einstellungen kommen mit; die Minecraft-Konten nicht (eines kann nur in einem
Spiel gleichzeitig sein)

**Die Entwicklerwerkzeuge zeigen nur einen Hinweis.**
→ [schutz.md](schutz.md) – abschalten unter *Administration → Einstellungen → Betrieb*

**Jemand probiert Passwörter durch.**
→ [verwaltung.md, Abschnitt 4](verwaltung.md#sicherheit) – die Bremse greift von selbst, die
Adresse steht unter *Administration → Sicherheit* und lässt sich von dort sperren

**Der Datenbestand soll gesichert werden.**
→ [verwaltung.md, Abschnitt 5](verwaltung.md#sicherungen) – eine am Tag läuft von selbst

**Ein Kunde will sein Geld zurück.**
→ [verwaltung.md, Abschnitt 9](verwaltung.md#erstatten)

**Ein Kunde braucht eine Rechnung für seine Buchhaltung.**
→ *Guthaben → Belege* im Konto des Kunden; was als Absender darauf steht, kommt aus
[verwaltung.md, Abschnitt 11](verwaltung.md#belege) und gehört **vor** der ersten Zahlung ausgefüllt

**Ich will wissen, wie es dem Server geht, ohne hinzusehen.**
→ [verwaltung.md, Abschnitt 10](verwaltung.md#system) – ein Discord-Webhook, ein Lagebericht im
Takt und Warnungen, sobald etwas kippt

**Ein Kunde will sein Konto loswerden.**
→ Das kann er selbst (*Einstellungen → Deine Daten*), mit 14 Tagen Frist:
[verwaltung.md, Abschnitt 12](verwaltung.md#loeschungen)

**Ein Kunde fragt, welche Daten ihr über ihn habt.**
→ *Einstellungen → Deine Daten → Meine Daten herunterladen*. Eine Datei, vollständig, sofort –
niemand muss dafür etwas heraussuchen.
