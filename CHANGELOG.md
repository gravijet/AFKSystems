# Änderungen vom 13. September 2026

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
