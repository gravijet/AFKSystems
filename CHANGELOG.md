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
