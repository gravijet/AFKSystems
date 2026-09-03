# Panel-Roadmap

Diese Datei ist der fortschreibbare Arbeitsplan für den Ausbau des AFKSystems-Panels. Sie ist
kein Versprechen für eine bestimmte Kalenderwoche: Ein Punkt wird erst abgehakt, wenn er in den
bestehenden Ablauf passt, getestet und ausgerollt wurde. Reihenfolge bedeutet Nutzen und Risiko,
nicht bloß eine lange Wunschliste.

## Produktmaßstab

Das Panel ist eine Arbeitsoberfläche für den Betrieb von Minecraft-Konten, keine
Marketing-Demo. Jede neue Fläche beantwortet eine konkrete Frage mit echten Daten, bietet eine
sichere nächste Aktion und bleibt auf Desktop wie Mobilgerät verständlich. Keine erfundenen
„Insights“, keine Attrappen und keine Einstellungen ohne Wirkung.

## Bereits umgesetzt

- [x] Einheitliche zweisprachige Oberfläche, echte Routen und zugängliche Bedienung
- [x] Live-Status, Chat, POV, Makros, Zeitpläne und Bot-Verlauf
- [x] Konten-, Server-, Guthaben-, Support- und Aktivitätsverwaltung
- [x] Rollen, Admin-Bereiche, Audit-Log, Sicherheits- und Geräteverwaltung
- [x] Suche/Sprungmarke, Tastaturkürzel, Favoriten und gerätebezogene Darstellung
- [x] Übersichts-Diagramme aus realen Guthaben-, Kosten- und Laufzeitdaten

## Nächster Schwerpunkt: täglicher Betrieb

### 1. Betriebszentrale auf der Übersicht

- [x] Eine kompakte Aufmerksamkeitsliste aus echten Zuständen: angehaltene Plätze,
      fehlgeschlagene Bots, erneut anzumeldende Konten und zu geringe Laufzeitreserve.
- [x] Jede Zeile erklärt Ursache, Auswirkung und führt direkt zur passenden Stelle; keine
      Sammelwarnung ohne Handlung.
- [x] Neueste Kontomeldungen als knappe, lesbare Vorschau inklusive ungelesenem Zustand.
- [x] Betriebszustand nach Live-Ereignissen aktualisieren, ohne Bild-, Speicher- oder
      Mehrfach-Request-Schleifen zu erzeugen.
- [x] Optionale, persönliche Reihenfolge der Übersichtsblöcke: nur bekannte Bereiche, lokal
      je Gerät gespeichert, bei neuen Bereichen automatisch ergänzt und jederzeit auf die
      Standardreihenfolge zurücksetzbar.

### 2. Schnelle und sichere Aktionen

- [x] Sprungmarke um kontextbezogene Bot-Aktionen ergänzen: nur mögliche Start-/Stopp-Aktionen,
      mit sichtbarem Zielkonto und Zielserver.
- [x] Mehrfachaktionen mit Ergebniszusammenfassung statt stiller Teilfehler.
- [x] Vor risikoreichen Massenaktionen Umfang, Auswirkung und eine Abbruchmöglichkeit zeigen.
- [x] Tastaturbedienung der wichtigsten Arbeitswege prüfen: Fokus, Escape und Sprungfolgen sind
      in offenen Dialogen gesperrt; Übersicht, Server, Konten, Guthaben, Aktivität und Support
      sind über dokumentierte Kürzel erreichbar, auf Mobilgeräten bleibt die Navigation der
      gleichwertige Weg.

### 3. Serverplatz als verlässlicher Arbeitsplatz

- [ ] Verbindungsansicht um eine klare Diagnoseleiste erweitern: letzter bekannter Zustand,
      Server-Ping, Wiederanlauf und Clientstand in einer Reihenfolge.
- [ ] Chat-Suche, markierte Zeilen und ein kontrolliertes Exportformat ergänzen, sofern der
      jeweilige Tarifverlauf dies zulässt.
- [x] Makros und Zeitpläne mit Vorabprüfung auf widersprüchliche Zeiten, fehlende Konten und
      nicht verfügbare Client-Fähigkeiten versehen; kollidierende aktive Zeitpläne werden im
      Dialog transparent gemacht, ohne absichtliche Abläufe zu verbieten.
- [x] Sichere Vorlagen für wiederkehrende Makros anbieten, aber nie ungeprüfte Befehle automatisch
      ausführen: Jede Vorlage und Kopie öffnet ausschließlich den Editor; Testläufe werden
      bewusst auf genau ein ausgewähltes Konto im Spiel begrenzt.
- [x] Konfigurationsvergleich und Kopierablauf ausbauen: Der Kopierdialog zeigt die realen Mengen
      je Bereich, übernimmt nur ausdrücklich ausgewählte Einstellungen, Makros, Zeitpläne oder
      wiederkehrende Nachrichten und weist vor dem kostenpflichtigen Anlegen darauf hin, dass
      Konten und gebuchte Zusätze nie mitkommen.

## Konten, Abrechnung und Support

### 4. Konten zuverlässig halten

- [ ] Sammelansicht für ablaufende/fehlerhafte Microsoft-Anmeldungen mit sicherem
      Wiederanmeldeweg.
  - [x] Fehlerhafte Anmeldungen stehen zusätzlich als handlungsorientierte Warteliste mit ihren
        tatsächlichen Platz- und Online-Auswirkungen bereit; jede Wiederanmeldung bleibt einzeln
        und ordnet weder Bots noch Konten automatisch um.
- [ ] Eindeutige Zuordnungsübersicht: welches Minecraft-Konto läuft auf welchen Plätzen und wo
      steht ein Konflikt an.
- [ ] Vorgänge, die ein Konto entfernen oder neu verbinden, mit klarer Auswirkungsanzeige auf
      laufende Bots versehen.

### 5. Abrechnung transparent machen

- [x] Laufzeitprognose pro kostenpflichtigem Platz statt nur einer globalen Monatszahl: Die
      Abrechnung zeigt für jede kommende automatische Verlängerung in echter Fälligkeitsreihenfolge,
      ob das aktuelle Guthaben reicht oder welcher Betrag fehlt.
- [ ] Änderungen an Tarif/Zusatz als nachvollziehbare Vorher-Nachher-Rechnung mit
      anteiligem Betrag darstellen.
- [x] Belegarchiv um Filter, sichere Downloads und verständliche Zahlungsstatus erweitern:
      Belegnummer und Status lassen sich lokal filtern, Erstattungen sind markiert und ein
      eigens angeforderter Download kommt als privater Anhang statt als zwischenspeicherbare Seite.
- [ ] Niedriges Guthaben als einstellbare, nachvollziehbare Warnung behandeln; keine
      unaufgeforderten Zahlungsaktionen.

### 6. Support ohne Informationsverlust

- [ ] Ticketformular kann auf Wunsch sicheren Diagnosekontext anhängen, der vor dem Absenden
      vollständig sichtbar ist.
- [ ] Status, Verantwortlichkeit und nächste erwartete Antwort im Ticketverlauf klar machen.
- [ ] Wiederkehrende Lösungen als gepflegte Hilfsartikel verlinken, nicht als generierte Antworten.

## Betreiber und Plattform

### 7. Operative Verwaltung

- [ ] Admin-Operationsseite um klar getrennte Warnungen für Knoten, Warteschlangen, Clientstände,
      Proxy-Kapazität und fehlgeschlagene Hintergrundjobs erweitern.
- [ ] Wartungsmodus mit Zeitfenster, Zielgruppe, Vorschau und automatischem Ende ausstatten.
- [ ] Gestaffelte Aktionen (Client-Neustarts, Knotenverschiebungen) mit Fortschritt,
      Teilfehlern und Audit-Eintrag sichtbar machen.
- [ ] Suche um datensparsame, rollenabhängige Treffer und eine nachvollziehbare Trefferquelle
      weiterentwickeln.

### 8. Standorte, Schutz und Nachvollziehbarkeit

- [ ] Knoten-Kapazitäten als Zeitreihe und mit Frühwarnschwellen zeigen, nicht nur als Momentwert.
- [ ] Agenten-/Client-Synchronisierung prüfbar und bei Fehlern gezielt wiederholbar machen.
- [ ] Sicherheitsereignisse mit Schweregrad, betroffenen Ressourcen und konkreter Gegenmaßnahme
      bündeln.
- [ ] Audit-Log mit Korrelation über mehrstufige Betreiberaktionen verbessern.

## Qualitätsleiste für jeden Ausbau

Vor dem Abhaken eines Punkts gilt immer:

1. Datenquelle, Berechtigung und Fehlerfall sind definiert.
2. Alle sichtbaren Texte stehen in `public/assets/js/i18n.js` auf Deutsch und Englisch.
3. Desktop, schmale Ansicht, Tastatur und reduzierte Bewegung sind berücksichtigt.
4. Netzwerkzugriffe sind begrenzt, abbrechbar bzw. gegen veraltete Antworten geschützt.
5. Relevante Tests laufen erfolgreich; neue Serverlogik erhält Integrationstests.
6. Nach erfolgreicher Prüfung folgt der vorgesehene Deployment-, Health- und Git-Push-Ablauf.

## Arbeitsweise für weitere Durchgänge

Bei jedem weiteren Ausbau wird zuerst der nächste unabgehakte, abhängigkeitfreie Punkt gewählt.
Größere Punkte werden hier vorab in prüfbare Teilaufgaben zerlegt und erst nach vollständiger
Auslieferung abgehakt. So bleibt der Plan ein belastbares Arbeitsprotokoll statt einer Sammlung
vager Ideen.
