# Dokumentation

Alles zu AFKSystems an einer Stelle. Die kurze Fassung des Ganzen steht in der
[README im Wurzelverzeichnis](../README.md).

## Einrichten

| Anleitung | Worum es geht |
| --- | --- |
| **[standorte.md](standorte.md)** | Standorte anlegen: ein VPS als Maschine für Bots, eine zweite Ausgangsadresse, oder beides. Mit allen Befehlen zum Kopieren. |
| **[tebex.md](tebex.md)** | Bezahlen mit Tebex: Zugangsdaten, Aufladepakete, Webhook, Testen, Rückerstattungen. |
| **[discord-bot.md](discord-bot.md)** | Den Discord-Bot aufsetzen: Anwendung, Rechte, Kanäle, Rollen, Tickets. |
| **[google-anmeldung.md](google-anmeldung.md)** | Anmelden mit Google einrichten. |

## Verstehen

| Dokument | Worum es geht |
| --- | --- |
| **[aufbau.md](aufbau.md)** | Wie alles funktioniert: Aufbau, Datenflüsse, das Leben eines Bots, Chat und Farben, Geld, Datenbank, Betrieb. |
| **[live-ansicht.md](live-ansicht.md)** | Die Live-Ansicht (POV): was sie ist, wer sie bekommt, wie sie bedient wird, was sie kostet. |
| **[schutz.md](schutz.md)** | Inhaltsschutz: was gegen Kopieren und Herunterladen getan wird – und was ehrlicherweise nicht geht. |

## Häufige Wege

**Ein neuer Standort soll her.**
→ [standorte.md, Fall 1](standorte.md#fall-1)

**Kunden sollen mit Karte bezahlen können.**
→ [tebex.md](tebex.md), danach unbedingt [den Webhook einrichten](tebex.md#webhook)

**Ein Kunde will die Live-Ansicht.**
→ Serverplatz → Zusätze → Live-Ansicht. Einzelheiten in [live-ansicht.md](live-ansicht.md)

**Der Chat kommt farblos an.**
→ [aufbau.md, Abschnitt 4](aufbau.md#chat) – der Client darf nicht mit `--no-color` laufen

**Ein Bot startet nicht.**
→ [aufbau.md, Abschnitt 2](aufbau.md#botleben) für die Reihenfolge der Prüfungen,
[standorte.md, Abschnitt 9](standorte.md#fehlersuche), wenn er auf einem Standort liegt

**Die Entwicklerwerkzeuge zeigen nur einen Hinweis.**
→ [schutz.md](schutz.md) – abschalten unter *Administration → Einstellungen → Betrieb*
