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
| **[live-ansicht.md](live-ansicht.md)** | Die Live-Ansicht (POV): die beiden Wege zu einem Bild, die Minecraft-Ressourcen, Steuern im Bild, Sichtweite, was sie kostet. |
| **[schutz.md](schutz.md)** | Inhaltsschutz: was gegen Kopieren und Herunterladen getan wird – und was ehrlicherweise nicht geht. |

## Häufige Wege

**Ein neuer Standort soll her.**
→ [standorte.md, Fall 1](standorte.md#fall-1)

**Kunden sollen mit Karte bezahlen können.**
→ [stripe.md](stripe.md), danach unbedingt [den Webhook einrichten](stripe.md#webhook)

**Ein Kunde will die Live-Ansicht.**
→ Serverplatz → Zusätze → Live-Ansicht. Einzelheiten in [live-ansicht.md](live-ansicht.md)

**Die Live-Ansicht soll echte Texturen zeigen statt Voxel.**
→ [live-ansicht.md, Minecraft-Ressourcen](live-ansicht.md#minecraft-ressourcen-einrichten) – einmal
je Minecraft-Version eine Client-JAR hinterlegen, Standorte holen sie sich selbst

**Der Chat kommt farblos an.**
→ [aufbau.md, Abschnitt 4](aufbau.md#chat) – der Client darf nicht mit `--no-color` laufen

**Ein Bot startet nicht.**
→ [aufbau.md, Abschnitt 2](aufbau.md#botleben) für die Reihenfolge der Prüfungen,
[standorte.md, Abschnitt 9](standorte.md#fehlersuche), wenn er auf einem Standort liegt

**Die Entwicklerwerkzeuge zeigen nur einen Hinweis.**
→ [schutz.md](schutz.md) – abschalten unter *Administration → Einstellungen → Betrieb*
