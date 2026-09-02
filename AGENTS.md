# AFKSystems – Arbeitsregeln

## Auslieferung

- Sämtliche Git-Befehle immer als Debian-Benutzer `benj` ausführen, niemals als `root`.
- Nach jeder vom Nutzer beauftragten und erfolgreich geprüften Code- oder Konfigurationsänderung die Änderung live ausrollen und anschließend als Commit zum konfigurierten GitHub-Remote pushen.
- Nach dem Deployment den Live-Status und nach dem Push den Remote-Stand prüfen.
- Die im Repository vorgesehenen Abläufe für Tests, Deployment und Veröffentlichung verwenden.
- Diese Regel gilt nicht für reine Fragen, Analysen, Reviews oder Diagnosen ohne Änderungen und nicht, wenn der Nutzer ausdrücklich anweist, nicht zu deployen oder nicht zu pushen.
- Bei fehlgeschlagenen Prüfungen, fehlendem Zugriff oder fremden Änderungen im Arbeitsbaum, die nicht sicher getrennt ausgeliefert werden können, nichts ungeprüft veröffentlichen. Stattdessen den konkreten Blocker melden.
