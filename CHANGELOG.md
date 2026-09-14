# Änderungen vom 14. September 2026

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
