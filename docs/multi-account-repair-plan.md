# Mehrere Accounts pro Server: Untersuchungs- und Reparaturplan

## Ziel und Erfolgskriterien

Jede Kombination aus Serverplatz und Account ist eine unabhängige Sitzung. Ein Fehler, Neustart oder Serverwechsel eines Accounts darf die anderen nicht beeinflussen. Befehle müssen an die ausgewählten Accounts gehen, in der vorgesehenen Reihenfolge verarbeitet werden und ihren Status ehrlich anzeigen. Eine erfolgreiche Pipe-Schreiboperation ist noch keine Bestätigung des Minecraft-Servers. AFK-Punkte sind ein zusätzliches, serverabhängiges Erfolgskriterium.

Die Reparatur gilt erst dann als geprüft, wenn vier echte Clientprozesse die relevanten Abläufe gemeinsam durchlaufen haben und die Live-Beobachtung für jeden Account getrennt ausgewertet wurde.

## 1. Istzustand sichern und erfassen

- Arbeitsbaum und bisherige Änderungen prüfen, produktive Sonderkonfiguration erhalten.
- Profile, Accountzuordnung, gewünschte Laufzustände, Clientversion und Makros erfassen.
- Datenbank und betroffene Laufzeitdateien vor dem Deployment sichern.
- Aktuelle Chatantworten, Positionen und Scoreboards mit Zeitstempel je Account erfassen.
- Ressourcenfehler und Neustartketten auf Betriebssystem- und Prozessebene berücksichtigen.

## 2. Identitäten und gemeinsam genutzten Zustand verfolgen

Für jeden Weg den Schlüssel aus Profil und Account überprüfen: Bot-Registry, Prozess, stdin/stdout, Agentjob, Timer, Makrosperren, Ansichten und Persistenz. Besonders prüfen:

- Gleicher Account auf unterschiedlichen Minecraft-Servern.
- Unterschiedliche Accounts auf demselben Serverplatz.
- Mehrere Serverplätze mit derselben Zieladresse.
- Geteilte Microsoft-Anmeldedaten gegenüber getrennten Home-/Routendaten.
- Veraltete Nachrichten oder asynchrone Aktionen eines vorherigen Prozesslaufs.

Bisherige Home-Isolierung erneut prüfen; sie erklärt allein keine fehlende Teleportbestätigung.

## 3. Verbindungszustände und Teleportationen untersuchen

Die gesamte Folge betrachten: Prozessstart → Authentifizierung → Login → Konfiguration → Spielbeitritt → autoritative Startposition → Welt geladen → Beitrittsbefehle. Danach getrennt prüfen:

- Teleport innerhalb derselben Welt.
- Respawn oder Unterserverwechsel ohne neue TCP-Verbindung.
- Erneute Konfigurationsphase derselben Verbindung.
- Minecraft-Transfer mit neuer TCP-Verbindung.
- Kick mit anschließendem Neustart durch das Panel.

Hypothesen: zu frühe Befehle, doppelte Beitrittsaktionen, abgebrochene Makros nach Transfer, verlorene Warteschlangeneinträge oder wiederholte Teleportbefehle während einer laufenden Teleportation.

## 4. Makroausführung und Versand prüfen

- Feste Client-Beitrittsbefehle und Panel-Makros dürfen weder doppelt laufen noch zwischen beiden Zuständigkeiten verloren gehen.
- Änderungen an Text, Aktivierung und Accountauswahl müssen laufende Bots erreichen.
- Wartezeiten und lokale Aktionen dürfen einen neuen Prozesslauf nicht versehentlich weitersteuern.
- Timer und Ausführungssperren müssen pro Bot gelten; ein langsamer Account darf andere nicht blockieren.
- Transportbestätigung, Protokollversand und Serverantwort dürfen nicht gleichgesetzt werden.
- Keine automatische Wiederholung beliebiger Befehle: Zahlungen, Umschaltbefehle und Teleports können dadurch doppelt wirken.

## 5. WindSMP gezielt nachstellen

Zunächst lesende Abfragen für alle vier Accounts. Danach kontrollierte, zeitlich getrennte AFK-/Teleportversuche mit dokumentierten Serverantworten und anschließendem Punktezuwachs. Ein allgemeines IP-Limit bleibt eine Hypothese, solange es nicht gegenüber falschem Zielzustand, Teleportfehlern und konkurrierenden Befehlen abgegrenzt ist. Keine weiteren IPs beschaffen und keine fremden Zugangsdaten ändern.

## 6. Reparatur aus den nachgewiesenen Fehlern ableiten

Gefundene Fehler jeweils mit einem fehlschlagenden Regressionstest belegen. Die Zuständigkeiten vereinheitlichen, wenn die Aufteilung zwischen Client und Panel die Ursache ist. Prozessgenerationen und Abbruchbedingungen ausdrücklich behandeln. Bestehende Accountauswahl und Konfiguration erhalten. Nur nachgewiesene Ursachen beheben; serverabhängige AFK-Regeln nicht durch erfundene Erfolgsmeldungen überdecken.

## 7. Testmatrix

- Vier Clients: Beitritt, manuelle Befehle, accountabhängige Platzhalter und Reihenfolge.
- Makros nach Erstellung, Änderung, Deaktivierung und Änderung der Accountauswahl.
- Verzögerter Beitritt und unterschiedliche Ladezeiten.
- Teleport/Transfer während einer mehrstufigen Befehlsfolge.
- Neustart eines Accounts während andere weiterlaufen.
- Abbruch wartender Aktionen bei Stop und Neustart.
- Getrennte Bewegungspersistenz und korrekte Agent-Zuordnung.
- Vollständige vorhandene Testsuite und reale Clienttests gegen einen lokalen Minecraft-Testserver.

## 8. Auslieferung und Nachkontrolle

Nach erfolgreichen Tests gezielt auf Produktion übertragen, Dienst neu starten und alle zuvor gewünschten Bots wieder prüfen. Auf WindSMP jeden Account einzeln anhand seiner Serverantworten und frischen Scoreboards prüfen. Commit und Push als Benutzer benj; anschließend Remotehash, Dienststatus und öffentliche Healthprüfung verifizieren.

## Ergebnisprotokoll

Wird im Verlauf mit nachgewiesenen Ursachen, Änderungen, Testergebnissen und verbleibenden Grenzen ergänzt.

### Nachgewiesene Ursachen

1. Der Minecraft-Client löschte bei jedem Play-Login seine ausgehende Warteschlange. Ein Unterserverwechsel kann auf derselben TCP-Verbindung ein weiteres Play-Login senden. Damit verschwanden Befehle hinter einem `/server`-/Teleportbefehl, obwohl stdin sie bereits angenommen hatte. Der neue Vier-Client-Test reproduzierte dies für alle vier Accounts: Die Wechselbefehle kamen an, alle acht Folgebefehle fehlten.
2. Der Sender entnahm eine Zeile vor der Mindestabstandspause. Wurde während dieser Pause die Welt ungültig, verwarf ein `continue` diese einzelne Zeile. Der Fehler trat unabhängig vom Löschen der restlichen Queue auf.
3. Einfache Beitrittsmakros wurden als unveränderliche Clientargumente übergeben. Spätere Änderungen von Text, Aktivierung oder Accountauswahl galten erst nach einem Prozessneustart. Komplexere Beitrittsmakros liefen dagegen im Panel, ohne dieselbe Startpause. Diese beiden Zuständigkeiten sind jetzt vereinheitlicht.
4. Unterschiedliche Makros desselben Bots liefen parallel. Damit konnte ein zweites Beitrittsmakro einen wartenden Login-/Serverwechselablauf überholen. Andere Accounts benötigen ihre eigenen, unabhängigen Warteschlangen.
5. Lokale Aktionen in Makros warteten nicht auf asynchrone Schreibfehler. Ein nachfolgender Serverbefehl konnte deshalb trotz fehlgeschlagener Bewegung weiterlaufen.
6. Bei einem echten TCP-Transfer wurde am Ziel erneut das Beitrittsmakro gestartet. Im Panel konnte das die laufende Makrogeneration löschen und den Serverwahlbefehl erneut schicken. Der Client meldet jetzt ein eigenes Transfer-Ereignis; das Panel setzt den bestehenden Ablauf fort und startet die Initialisierung am Transferziel nicht erneut. Ein echter Disconnect bricht dagegen die alte Queue ab, bevor seine eigenen Auslöser ausgeführt werden.

### Umsetzung

- Client 2.8.2 behält offene Zeilen bei Weltwechseln und beabsichtigten Transfers. Der Sender wartet mit seiner bereits entnommenen Zeile auf die neue Spielbereitschaft.
- Echte Verbindungsabbrüche wechseln die Epoche der Queue und löschen sie. So wird auch eine bereits entnommene alte Zeile ungültig und nach einem Kick nicht blind wiederholt.
- Alle Panel-Makros laufen über eine Queue je Profil/Account. Beitrittsmakros verwenden die konfigurierte Startpause und eine feste Reihenfolge; Timer, Wiederholungen und Anti-AFK-Befehle können diese Initialisierung nicht überholen.
- Bearbeitungen während der Startpause ersetzen noch offene Beitrittsmakros durch den aktuellen Datenbankstand. Abgeschlossene Beitrittsmakros werden dabei nicht erneut gestartet.
- Steuer-Macros zum Stoppen, Trennen oder Neuverbinden können wartende Abläufe sofort unterbrechen.
- Stop, Neustart und Makroabbruch lösen wartende Pausen sofort auf und verwerfen ausstehende Aktionen. Ein alter Ablauf kann die Sperre eines neuen Laufs nicht aufheben.
- Lokale Makroschritte warten auf den bestätigten Client-Schreibvorgang und beenden ihren Ablauf bei Fehlern.

### Grenzen der Aussage zu WindSMP

Die vier `/bal`-Antworten beweisen vier funktionierende Verbindungen und getrennten Befehlsversand. Die fehlenden AFK-Punkte eines Accounts werden dadurch noch nicht erklärt. Ein kontrolliertes `/spawn` und danach `/afk` für BlockDojo lieferte jeweils eine Transferbestätigung, jedoch zunächst keinen Punktezuwachs. Währenddessen stieg gravijets Punktestand weiter. Die zuvor behauptete Notwendigkeit dreier zusätzlicher IPs war zu bestimmt formuliert; die serverseitige Punktevergabe muss anhand längerer Beobachtung getrennt beurteilt werden.

### Geprüfter Stand vor Auslieferung

- Panel: 271 erfolgreiche Tests, ein separat gestarteter Real-Client-Test; Quellkopie und produktionsnahe Kopie geprüft.
- Rust: 171 Unit-Tests und 50 Prozesstests erfolgreich; 12 vorhandene optionale Tests ignoriert.
- `cargo clippy --all-targets --all-features -- -D warnings` und Rustformatierung erfolgreich.
- Der Regressionstest mit dem alten Client verlor nach dem Wechsel alle acht Folgebefehle; mit dem korrigierten Client kamen sie für alle vier Accounts in Reihenfolge an.
- Alle acht Linux-Bauformen werden über das vorhandene Buildskript gebaut. Die Ausgabe wird atomar ersetzt, damit laufende Tests die Distribution nicht mit ETXTBSY blockieren.

### Kontrollierte Punkteprüfung auf WindSMP

Am 28.10.2026 blieb BlockDojo bei gleichzeitig anwesenden Accounts trotz funktionierender `/bal`-Antworten und AFK-Transfers bei 19 Punkten. Für die Kontrollprüfung wurden certbot, gravijet und BlockDojoEU vorübergehend zum Spawn geschickt. Das AFK-Wiederholungsmakro wurde kurz pausiert, nachdem es einen Account während des Tests automatisch zurückgeholt hatte. Danach stieg BlockDojo allein in der AFK-Zone von 19 auf 20 und anschließend auf 21 Punkte. Alle drei Accounts wurden zurückgeschickt und das Makro mit seiner ursprünglichen Accountauswahl wieder aktiviert.

Damit ist belegt, dass BlockDojo Befehle ausführt und grundsätzlich Punkte sammeln kann. Im Versuch fehlte sein Punktezuwachs bei gleichzeitiger Anwesenheit der anderen Accounts und setzte nach deren Verlassen ein. Eine serverseitige IP-Begrenzung ist plausibel, aber weder durch eine offizielle Regel noch durch einen Vergleich mit einer zweiten Ausgangs-IP bestätigt. Die reparierten Queue-/Transferfehler sind davon unabhängig nachgestellt und behoben.

Die Client-Veröffentlichung 2.8.2 unter Commit `4706022` bestand den Linux- und Windows-Build einschließlich der jeweiligen Tests.

### Live-Nachkontrolle

- Panel und Discord-Bot aktiv, öffentliche Healthprüfung erfolgreich.
- Alle neun ursprünglich gewünschten Sitzungen wieder online; alle neun Prozesse verwenden die aktuellen Release-Dateien.
- Alle vier WindSMP-Accounts melden Client 2.8.2. Für jeden Account wurde das Panel-Beitrittsmakro `/afk` nach dem Neustart protokolliert.
- Anschließend kamen vier eigenständige `/bal`-Antworten vom Minecraft-Server zurück. Alle vier Scoreboards waren frisch.
- Die ursprünglichen WindSMP-Makros einschließlich Accountauswahl und Aktivierung wurden nach dem Isolationstest unverändert wiederhergestellt.
- Der veröffentlichte Premium/Items-Client bestand den Vier-Client-Test einschließlich kompletter Makrofolgen über TCP-Transfers.
- Abschließende Tests: Quellkopie und produktionsnahe Kopie jeweils 271 erfolgreich, ein opt-in Test separat erfolgreich.
