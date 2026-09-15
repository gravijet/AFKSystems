# Minecraft-Anmeldungen und Mehraccount-Betrieb – 15. September 2026

- Temporäre Fehler beim Microsoft-Refresh (unter anderem leere Antworten, Zeitüberschreitungen,
  HTTP 429 und 5xx) werden mit dem gespeicherten Konto erneut versucht. Der automatische
  Gerätecode-Fallback des Clients wird dabei beendet, ohne das Konto als abgelaufen zu sperren.
- Ein erfolgreicher Beitritt entfernt alte Anmeldefehler am Konto und im laufenden Bot.
- Standorte erhalten beim Start nur die Anmeldung des tatsächlich verwendeten Kontos.
  Andere Konten desselben Nutzers können dessen Token dadurch nicht zurücksetzen.
- Zurückkommende Dateien dürfen nur den ihnen bekannten Stand ersetzen. Eine neue
  Browser-Anmeldung oder die Erneuerung auf einem anderen Standort bleibt erhalten.
- Weitere Bots auf demselben Standort überschreiben keine dort bereits erneuerten Dateien;
  eine inzwischen im Panel bestätigte neue Anmeldung wird weiterhin übertragen.
- Unvollständige Kontodateien, fremde Minecraft-Identitäten, ältere Token und Rückmeldungen
  für gelöschte Konten werden nicht übernommen. Ersetzungen erfolgen atomar.
- Gerätecode-Anmeldungen schreiben zunächst in ein eigenes temporäres Verzeichnis.
  Abbruch, Zeitablauf oder fehlgeschlagene Bestätigung ändern keine bestehende Anmeldung.
- „Anmeldung erneuern“ prüft serverseitig das ausgewählte Konto. Eine Anmeldung mit dem
  falschen Microsoft-Konto wird nicht als erfolgreiche Erneuerung ausgegeben.
- Minecraft-Namensänderungen werden anhand der UUID dem bestehenden Konto zugeordnet;
  Konto-ID, Serverzuweisungen und Makroauswahl bleiben erhalten.
- Unvollständige Login-Ergebnisse und Namenskollisionen mit Offline-Konten werden abgewiesen,
  statt ein nicht nutzbares Konto als angemeldet anzuzeigen.
- Login-Ergebnisse werden erst nach dem Schließen der Prozessausgabe ausgewertet.
  Abgeschlossene Sitzungen blockieren keine freien Plätze für neue Anmeldungen.
- Kurze Netzfehler beim Abfragen des Logins beenden den Browser-Ablauf nicht sofort.
  Ein Fehler beim anschließenden Neuladen macht eine bestätigte Anmeldung nicht zum Fehler.
- Der Kontodatei-Abgleich überspringt beschädigte Dateien, erkennt wiederhergestellte
  fehlende Anmeldungen und setzt umbenannte Konten nicht erneut auf „Anmeldung fehlt“.

Eine von Microsoft tatsächlich widerrufene Anmeldung benötigt weiterhin eine Bestätigung.
Die Gültigkeitsdauer wird nicht künstlich verlängert; korrigiert werden verlorene oder
überschriebene Anmeldungen und unnötige Aufforderungen zum erneuten Login.

# Änderungen vom 15. September 2026

Diese Runde behebt 19 weitere Fehlerfälle in direkt bedienbaren Abläufen:

1. Neustarts aus Panel und Verwaltung warten auf das tatsächliche Ende des alten Clients.
   Ein anschließendes Stop bricht auch den bereits angeforderten Neustart ab.
2. Zeitgesteuerte Neustarts gehen nicht mehr durch einen Startversuch während des
   noch beendenden Clients verloren.
3. Ein manueller Start unmittelbar nach Stop wartet auf den alten Prozess.
4. „Alle stoppen“ erfasst auch offline befindliche Bots mit ausstehendem Wiederanlauf;
   ein Nutzerstopp entfernt auch noch nicht wiederhergestellte Startwünsche.
5. Startfehler in der Verwaltung werden je Konto angezeigt, statt als erfolgreich
   gespeichert bestätigt oder im Hintergrund verschluckt zu werden.
6. Chatnachrichten mit leerer Kontoauswahl werden nicht mehr an alle Bots geschickt.
7. Gespeicherte Chat-Auswahlen – einschließlich „keine“ – bleiben nach erneutem Öffnen
   erhalten; die sichtbaren Kästchen stimmen mit den tatsächlichen Empfängern überein.
8. Verspätete Chatfehler überschreiben keinen inzwischen neu geschriebenen Entwurf.
9. Bewegungs- und Clientbefehle zeigen auch einzelne Fehler bei mehreren Konten an.
10. Alle Webhook-Kategorien lassen sich wirklich abschalten, ohne dadurch wieder alle
    Meldungen einzuschalten.
11. Kurz nacheinander geänderte Mail-Präferenzen überschreiben einander nicht mehr.
12. Schnelle Mehrfachklicks auf Makro-, Laufzeit- und Einstellungsschalter erzeugen
    keine überlappenden Speichervorgänge mit widersprüchlicher Anzeige.
13. Zeitpläne starten keine Konten mehr, die inzwischen vom Serverplatz entfernt wurden.
14. Beim Bearbeiten eines solchen Zeitplans bleibt das bisherige Ziel sichtbar, statt
    die Auswahl still auf alle Konten zu erweitern.
15. Ungültige Wochentage oder fehlgeschlagene Speichervorgänge schließen den Zeitplan-
    Dialog nicht mehr und verwerfen keine Eingaben. Nach bestätigtem Speichern wird
    die Antwort direkt übernommen, ohne einen zusätzlichen fehleranfälligen Lesezugriff.
16. Nach Ein- oder Ausschalten eines Zeitplans entspricht der angezeigte nächste Lauf
    dem frisch berechneten Serverstand.
17. Fehlgeschlagene Ticket-Uploads oder Antworten überschreiben keine neuen Texte
    oder zwischenzeitlich ergänzten Dateianhänge.
18. Eine verspätet bestätigte Ticketantwort löscht keinen inzwischen gespeicherten
    neuen Entwurf; nur die tatsächlich gesendeten Anhänge werden entfernt.
19. Fehler beim Nachladen nach einer bereits gesendeten Ticketantwort legen die
    Antwort nicht erneut zum Versand ins Eingabefeld.

# Änderungen vom 14. September 2026

- Makros: Mehrere ausgewählte Konten bleiben beim Bearbeiten erhalten; Namen, Auslöserwerte,
  Sperrzeiten und Wahrscheinlichkeiten gehen beim Ergänzen oder Umsortieren von Schritten
  nicht verloren. Doppelte Speicherklicks erzeugen keine doppelten Makros.
- Wiederholte Nachrichten: Mehrere Konten können gemeinsam ausgewählt werden; bestehende
  Zuordnungen werden beim Speichern nicht auf alle Konten erweitert.
- Makro-Ausführung: Platzhalter werden je Konto ersetzt, eingesetzter Chattext bleibt wörtlich.
  Zeit- und Ereignismakros übernehmen Änderungen an Text und Konten sofort. Abgebrochene
  Schritte laufen nach Wartezeiten oder einem Clientneustart nicht weiter.
- Wiederverbinden: Ein Makro-Neustart überlebt das Ende des Clients und funktioniert auch
  für bereits offline befindliche Bots. Stop bricht ausstehende Neustarts ab. Vorübergehende
  Fehler und kurze Join-Sperren werden auch beim ersten Beitritt mit begrenztem Backoff
  erneut versucht; tatsächliche Microsoft-Anmeldefehler bleiben von diesen Versuchen ausgenommen.
- Benachrichtigungen: Kurze Bot-Aussetzer bleiben still, anhaltende Störungen werden pro
  Konto und Server zusammengefasst und mit dem konkreten Grund gemeldet. Nach stabiler
  Rückkehr folgt eine Entwarnung. Standort- und andere Betriebsstörungen erhalten ebenfalls
  eine Entwarnung; offene Störungen bleiben über Panel-Neustarts gespeichert.
- Inventar: Verspätete Antworten nach Seitenwechseln oder erneutem Zeichnen überschreiben
  keine andere Ansicht. Manuelles Aktualisieren erzeugt keine zusätzlichen Abfrageschleifen.
- Zwei-Faktor-Einrichtung: Während der Aktivierung verhindert der Dialog doppelte Anfragen
  und bleibt bis zur Antwort offen, damit die Wiederherstellungscodes nicht durch Abbrechen
  verloren gehen. Nach einem Fehler sind Eingabe und Abbrechen wieder verfügbar.
- Ankündigungen: Beschädigte oder falsch typisierte Einträge im Browser-Speicher blockieren
  die Seitennavigation nicht mehr; gültige ausgeblendete Ankündigungen bleiben ausgeblendet.
- Microsoft-Konten: Ein früh geschlossener Anmeldedialog bricht auch eine erst danach
  angelegte Sitzung ab. Statusabfragen überlappen nicht; verspätete Antworten verändern
  einen geschlossenen Dialog nicht mehr.
- Administration: Beim Wechsel zwischen Serverplätzen endet die Aktualisierung der alten
  Ansicht. Ihre Antworten können keine Kontenliste des neu geöffneten Servers überschreiben.
  Auch System- und Betriebsansichten verwerfen Antworten nach dem Verlassen.
- Serverplätze: Unbekannte Tarifnummern werden beim Anlegen und Kopieren abgewiesen,
  statt stillschweigend einen anderen Tarif zu buchen. Kopien prüfen die Grenzen für Makros,
  wiederholte Nachrichten und Zeitpläne vor dem Anlegen und Abbuchen.
- Guthaben: Nicht eingerichtete Zahlungsarten erzeugen keine offenen Aufladungen mehr.
- Minecraft-Konten: Der Statuspunkt je Serverzuordnung zeigt den Zustand dieses Kontos,
  statt den Online-Zustand eines anderen Bots auf demselben Server zu übernehmen.

# Änderungen vom 13. September 2026

- Support: Lesebestätigungen erfassen nur ausgelieferte Nachrichten. Beim Nachladen älterer
  Seiten bleiben neue Antworten ungelesen; der Live-Verlauf lädt größere Nachschläge vollständig
  und verarbeitet gleichzeitige Ereignisse ohne konkurrierende Anfragen. Verspätete Antworten
  nach einem Seitenwechsel verändern die neue Ansicht nicht.
- Anzeigeeinstellungen und Serverfavoriten funktionieren während der Sitzung auch bei
  gesperrtem oder vollem Browserspeicher. Die Auswahl bleibt je Nutzer getrennt.
- Die Übersicht aktualisiert Diagramme und Aktivitätsvorschau bei der Rückkehr von einer
  anderen Panel-Seite, statt den Stand des ersten Besuchs weiterzuzeigen.
- Zeitpläne lösen bei schwankenden Sekunden im Minutentakt nicht erneut aus. Vorschau und
  Nachholen berücksichtigen Sommerzeitwechsel, ausfallende und doppelte Uhrzeiten sowie
  Zeitzonen mit halben und viertel Stunden.
- Aktivitätszentrale: „Alle gelesen“ und „Gelesene löschen“ folgen dem aktuellen Zustand.
  Schnelle Filterwechsel zeigen zuverlässig die zuletzt gewählte Kategorie; verspätete
  Antworten nach einem Seitenwechsel verändern die neue Ansicht nicht.
- Guthabenprognose: Nicht gedeckte Verlängerungen lassen das Restguthaben für günstigere
  Plätze übrig. Die Abrechnung verarbeitet fällige Plätze in derselben zeitlichen Reihenfolge
  wie die Vorschau.
- Minecraft **1.8.8** in der Serverauswahl ergänzt. Die Verbindung nutzt den kompatiblen
  1.8.9-Modus (Protokoll 47) des aktuellen **AFKClient 2.7.0** aus dem GitHub-Release `latest`.
  Die Auswahl erscheint nur, wenn der installierte Client diesen Modus unterstützt.
- Dasselbe Minecraft-Konto kann mehrere Serverplätze gleichzeitig verbinden. Die Startsperre
  im Backend und am Startknopf entfällt; weitere aktive Sitzungen bleiben sichtbar. Start,
  Stopp und Wiederanlauf bleiben je Serverplatz getrennt, Tarif- und Kapazitätsgrenzen gelten weiter.
- Makroanzeige repariert: Schritte wie „Neu verbinden“ oder „Springen“ verursachten beim Laden
  einen Initialisierungsfehler (`Cannot access 'r' before initialization` in der komprimierten
  Oberfläche). Die Hilfsfunktion für Schrittnamen ist jetzt rechtzeitig verfügbar, sodass die
  Makroliste und ihre Bedienelemente wieder laden.
