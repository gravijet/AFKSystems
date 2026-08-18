# Standorte einrichten

Ein Standort ist eine **Maschine, auf der Bots laufen**. Diese Anleitung führt Schritt für Schritt
durch das Aufsetzen – vom leeren VPS bis zum ersten Bot, der dort läuft. Alle Befehle sind zum
Kopieren gedacht.

---

## Inhalt

1. [Was ein Standort ist – und was ein Proxy ist](#was-ein-standort-ist)
2. [Wie es technisch funktioniert](#wie-es-funktioniert)
3. [Fall 1: Ein neuer VPS als Standort (der Normalfall)](#fall-1)
4. [Fall 2: Nur eine zweite Ausgangsadresse (Proxy-Standort)](#fall-2)
5. [Fall 3: Beides – eigene Maschine hinter eigener Adresse](#fall-3)
6. [Serverplätze auf einen Standort legen](#serverplaetze)
7. [Grenzen, Auslastung und was "voll" heißt](#grenzen)
8. [Betrieb: aktualisieren, umziehen, abschalten](#betrieb)
9. [Wenn etwas nicht geht](#fehlersuche)
10. [Sicherheit: was wo liegt](#sicherheit)

---

<a id="was-ein-standort-ist"></a>

## 1. Was ein Standort ist – und was ein Proxy ist

Zwei Dinge, die oft verwechselt werden:

| | **Standort** | **Proxy** |
| --- | --- | --- |
| Was es ist | eine Maschine | eine Adresse |
| Verbraucht CPU, RAM, Platte | **ja** | nein |
| Läuft ein Bot-Prozess darauf | **ja** | nein |
| Hat eine Auslastungsanzeige | **ja** | nein |
| Wozu man es nimmt | Rechenleistung verteilen | eine andere IP zeigen |

Ein **Standort** trägt Bots. Läuft dort ein Bot, verbraucht er dort Arbeitsspeicher (ungefähr
40–80 MB je Bot) und Rechenzeit. Deshalb hat jeder Standort im Panel drei Balken – CPU,
Arbeitsspeicher, Platte – und Obergrenzen, ab denen er keine neuen Serverplätze mehr annimmt.

Ein **Proxy** ist nur eine Ausgangsadresse. Er trägt nichts, er leitet weiter. An einem Proxy steht
im Panel deshalb nie eine Auslastung – es gäbe dort nichts zu messen.

Beides lässt sich verbinden: ein Standort *darf* zusätzlich einen Proxy haben. Dann laufen die
Bots auf seiner Maschine und gehen über die Adresse des Proxys hinaus.

### Die drei Arten von Standorten

| Art | Bedeutung |
| --- | --- |
| **Diese Maschine** (`local`) | Der Server, auf dem das Panel läuft. Gibt es genau einmal, lässt sich nicht löschen und nicht abschalten. |
| **Eigene Maschine** (`agent`) | Ein anderer Rechner mit dem Standort-Agenten darauf. Der Normalfall für alles Neue. |
| **Nur Adresse** (`egress`) | Kein eigener Rechner: die Bots bleiben auf der Panel-Maschine und gehen über einen Proxy hinaus. |

---

<a id="wie-es-funktioniert"></a>

## 2. Wie es technisch funktioniert

```
   Panel (example.invalid)                       Standort (irgendein VPS)
   ┌──────────────────────┐                    ┌─────────────────────────┐
   │  Datenbank           │                    │  agent/index.js         │
   │  Weboberfläche       │  ◀── WebSocket ──▶ │  data/bin/  (Clients)   │
   │  Supervisor          │      (ausgehend    │  data/users/ (Konten)   │
   │                      │       vom Standort)│  ein Prozess je Bot     │
   └──────────────────────┘                    └─────────────────────────┘
```

**Der Standort ruft an, nicht umgekehrt.** Das ist die wichtigste Eigenschaft dieses Aufbaus, und
sie erspart drei Dinge, die sonst jedes Mal Arbeit machen: eine öffentliche Adresse, ein
TLS-Zertifikat und eine Portfreigabe für eingehenden Verkehr. Der Standort braucht ausgehendes
HTTPS, mehr nicht – das kann jeder VPS ab der ersten Minute.

Über diese eine Verbindung läuft alles:

| Richtung | Nachricht | Bedeutung |
| --- | --- | --- |
| Panel → Standort | `spawn` | starte diesen Client mit diesen Argumenten |
| Panel → Standort | `stdin` | schick diese Zeile an den Bot (Chat, Befehl) |
| Panel → Standort | `kill` | beende den Bot |
| Panel → Standort | `sync` | hol dir die Client-Dateien neu |
| Standort → Panel | `hello` | wer ich bin, welche Version, was ich da habe |
| Standort → Panel | `metrics` | CPU, Speicher, Platte, laufende Bots (alle 15 s) |
| Standort → Panel | `out` / `err` | was der Bot ausgibt – Chat und Zustand |
| Standort → Panel | `exit` | der Bot ist beendet, mit Grund |
| Standort → Panel | `files` | geänderte Kontodateien (aufgefrischte Microsoft-Token) |

**Die Client-Dateien holt sich der Standort vom Panel**, nicht von GitHub. Damit liegt dort nie eine
andere Fassung als im Panel, und auf dem neuen Rechner braucht es keinen GitHub-Zugang.

**Die Microsoft-Anmeldungen reisen mit.** Beim Start eines Bots schickt das Panel die Kontodatei
mit; wenn der Client den Token auffrischt, kommt sie zurück und wird im Panel gespeichert. Ohne
das müsste dasselbe Konto auf jedem Standort einzeln verbunden werden.

**Reißt die Verbindung ab**, stoppt der Agent seine Bots und meldet sich alle paar Sekunden neu.
Der Wunsch ("dieser Bot soll laufen") bleibt im Panel stehen, und sobald der Standort zurück ist,
fährt es alles wieder hoch. Warum das so herum richtig ist, steht in
[Abschnitt 8](#betrieb).

---

<a id="fall-1"></a>

## 3. Fall 1: Ein neuer VPS als Standort

Der Normalfall. Rechenzeit **und** eine eigene IP-Adresse kommen dazu.

**Was der Rechner braucht:** Debian 12 oder Ubuntu 22.04/24.04, 1 vCPU und 1 GB RAM reichen für
etwa 10–15 Bots. Für mehr entsprechend mehr Arbeitsspeicher: rechne mit ~80 MB je Bot plus
300 MB für das System.

### Schritt 1 – Im Panel den Standort anlegen

**Administration → Standorte → Anlegen**

| Feld | Wert |
| --- | --- |
| Name | `VPS Falkenstein` (frei wählbar, der Kunde sieht ihn) |
| Art | **Eigene Maschine** |
| Region | `Falkenstein` (frei, steht beim Kunden als Ortsangabe) |
| Proxy | leer lassen |
| Serverplätze höchstens | `0` = unbegrenzt |
| Bots höchstens | z. B. `15` |
| CPU-Grenze (%) | z. B. `85` |
| Speichergrenze (%) | z. B. `85` |
| Zugang | zunächst **Nur Administratoren** – zum Testen |
| Aktiv | an |

Speichern. Auf der Karte des neuen Standorts steht jetzt **Diesen Standort einrichten** mit einem
fertigen Befehl darin. Der enthält das Token – **Kopieren** anklicken.

### Schritt 2 – Auf dem neuen VPS anmelden

```bash
ssh root@<neue-ip>
apt update && apt upgrade -y
apt install -y curl rsync
```

### Schritt 3 – Den Agenten holen

Der Agent liegt im AFKSystems-Repository unter `agent/`. Zwei Wege, je nachdem, wie du an das
Repository kommst:

**Vom Panel-Server aus kopieren** (der einfachste Weg):

```bash
# auf dem Panel-Server ausführen
rsync -a /opt/afksystems/agent /opt/afksystems/deploy root@<neue-ip>:/root/afk/
```

**Oder direkt aus dem Repository klonen:**

```bash
# auf dem neuen VPS
git clone https://github.com/gravijet/AFKSystems.git /root/afk
```

### Schritt 4 – Einrichten

Jetzt der Befehl aus dem Panel. Er installiert Node.js, legt einen Dienstbenutzer an, kopiert den
Agenten nach `/opt/afksystems-agent`, schreibt die `.env` und startet den Dienst:

```bash
cd /root/afk/deploy
chmod +x install-agent.sh
sudo PANEL_URL=https://example.invalid NODE_TOKEN=<token-aus-dem-panel> ./install-agent.sh
```

Das war es. Am Ende steht der Zustand des Dienstes im Terminal, und im Panel ist der Standort als
**verbunden** gekennzeichnet – meist innerhalb von zwei Sekunden.

### Schritt 5 – Nachsehen, ob es läuft

Auf dem Standort:

```bash
systemctl status afksystems-agent --no-pager
journalctl -u afksystems-agent -f
```

Erwartete Ausgabe:

```
AFKSystems-Standort-Agent 1.0.0 – Panel https://example.invalid
Verbunden mit https://example.invalid
7 Client-Datei(en) geholt.
```

Im Panel unter **Administration → Standorte**:

* Die Plakette **verbunden** steht neben dem Namen.
* Unter **Maschine** steht der Rechnername und die Agent-Version.
* Die drei Balken zeigen CPU, Arbeitsspeicher und Platte des neuen Rechners.

### Schritt 6 – Freigeben

Erst wenn ein Testbot dort sauber läuft: **Administration → Standorte → Bearbeiten → Zugang**
auf `Alle` (oder `Nur ausgewählte Nutzer`, dann die Nutzer-IDs eintragen; die ID steht in
**Administration → Nutzer** in der ersten Spalte).

### Schritt 7 – Firewall (empfohlen)

Der Agent braucht **keinen** eingehenden Port. Nur SSH:

```bash
apt install -y ufw
ufw allow OpenSSH
ufw --force enable
ufw status
```

Genau das ist der Vorteil dieses Aufbaus: Ein Standort ist von außen nicht erreichbar und hat
trotzdem eine vollständige Leitung zum Panel.

---

<a id="fall-2"></a>

## 4. Fall 2: Nur eine zweite Ausgangsadresse

Wenn es **nicht** um Rechenleistung geht, sondern nur darum, dass Bots von einer anderen IP kommen.
Die Bots laufen dann weiter auf der Panel-Maschine.

### 4.1 Auf dem Rechner mit der zweiten Adresse

`dante` ist dafür das schlichteste Werkzeug und liegt in jedem Debian/Ubuntu bereit.

```bash
apt install -y dante-server
ip -o -4 addr show | awk '{print $2, $4}'      # Name der Netzwerkkarte merken (eth0, ens3, …)
```

`/etc/danted.conf` – `external` auf den Namen der Karte setzen und `<panel-ip>` auf die Adresse
des Servers, auf dem AFKSystems läuft:

```bash
cat > /etc/danted.conf <<'EOF'
logoutput: syslog
internal: 0.0.0.0 port = 1080
external: eth0

# Nur mit Benutzername und Passwort. Ein offener Proxy im Netz ist binnen Stunden gefunden
# und wird dann von Fremden benutzt – auf deine Rechnung und mit deiner IP.
socksmethod: username
user.privileged: root
user.unprivileged: nobody

client pass {
    from: <panel-ip>/32 to: 0.0.0.0/0
    log: connect disconnect error
}
socks pass {
    from: <panel-ip>/32 to: 0.0.0.0/0
    command: connect
    log: connect disconnect error
}
EOF
```

Dante prüft gegen die Systembenutzer. Ein Benutzer ohne Login-Shell genügt:

```bash
useradd -r -s /usr/sbin/nologin afkproxy
passwd afkproxy          # ein langes Passwort vergeben und notieren
systemctl enable --now danted
systemctl status danted --no-pager
```

Firewall: nur das Panel darf hinein.

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow from <panel-ip> to any port 1080 proto tcp
ufw --force enable
```

### 4.2 Vom Panel-Server aus prüfen

```bash
curl -s --socks5 afkproxy:<passwort>@<neue-ip>:1080 https://api.ipify.org
```

Kommt die **neue** IP-Adresse zurück, steht die Adresse. Kommt nichts, stimmt etwas an Firewall
oder Zugangsdaten nicht – erst das klären, dann weiter.

### 4.3 Im Panel eintragen

1. **Administration → Proxys → Anlegen**
   * Name: `VPS Falkenstein`
   * `host:port`: `<neue-ip>:1080`
   * Typ: `socks5`
   * Benutzername: `afkproxy`, Passwort: das von oben
   * Nutzer: leer lassen – der Proxy gehört dem Standort, nicht einer Person

2. **Administration → Standorte → Anlegen**
   * Name: `Falkenstein (Adresse)`
   * Art: **Nur Adresse**
   * Proxy: den eben angelegten wählen
   * Zugang, Grenzen: wie oben

### 4.4 Sonderfall: eine zweite IP auf derselben Maschine

Beim Anbieter eine zweite IPv4 bestellen und aufs Interface legen. Bei Hetzner und Netcup steht
die fertige Konfiguration im Kundenbereich; allgemein mit netplan:

```yaml
# /etc/netplan/60-zweite-ip.yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - <zweite-ip>/32
```

```bash
netplan apply
ip -4 addr show eth0        # beide Adressen müssen dastehen
```

Dann denselben Dienst wie oben, aber **an die zweite Adresse gebunden** – so geht der Verkehr auch
wirklich über sie hinaus:

```bash
cat > /etc/danted.conf <<'EOF'
logoutput: syslog
internal: 127.0.0.1 port = 1081
external: <zweite-ip>

socksmethod: username
user.privileged: root
user.unprivileged: nobody

# Nur von diesem Rechner – der Dienst hört ohnehin nur auf 127.0.0.1.
client pass { from: 127.0.0.1/32 to: 0.0.0.0/0 }
socks pass  { from: 127.0.0.1/32 to: 0.0.0.0/0 command: connect }
EOF
useradd -r -s /usr/sbin/nologin afkproxy2
passwd afkproxy2
systemctl enable --now danted
curl -s --socks5 afkproxy2:<passwort>@127.0.0.1:1081 https://api.ipify.org
```

Im Panel eintragen wie oben, mit `127.0.0.1:1081` als Adresse.

> **Läuft schon ein `danted` auf dieser Maschine?** Dann braucht die zweite Instanz eine eigene
> Unit: Konfiguration nach `/etc/danted2.conf` legen und
> `systemctl edit --force --full danted2.service` mit
> `ExecStart=/usr/sbin/danted -f /etc/danted2.conf` anlegen.

---

<a id="fall-3"></a>

## 5. Fall 3: Beides

Eigene Maschine **und** eine Adresse, die nicht ihre eigene ist – etwa, weil der Anbieter der
Rechenleistung ein bekanntes Rechenzentrum ist und Minecraft-Server dessen Adressbereiche sperren.

1. Standort wie in [Fall 1](#fall-1) anlegen (Art: **Eigene Maschine**).
2. Proxy wie in [Fall 2](#fall-2) anlegen.
3. Am Standort unter **Bearbeiten → Proxy** den Proxy auswählen.

Damit laufen die Prozesse auf dem Standort und gehen über den Proxy hinaus. Die
Auslastungsbalken zeigen weiterhin die Maschine des Standorts – der Proxy hat keine.

**Reihenfolge, wenn mehreres gesetzt ist:** Ein Proxy, der am *Minecraft-Konto* ausgewählt wurde,
gewinnt gegen den des Standorts. Das Genauere schlägt das Allgemeine.

---

<a id="serverplaetze"></a>

## 6. Serverplätze auf einen Standort legen

**Beim Anlegen:** Der Kunde wählt den Standort im Formular. Zur Auswahl stehen nur Standorte, die
für ihn freigegeben, nicht voll und erreichbar sind.

**Nachträglich:** **Administration → Serverplätze → *Platz* → Standort wechseln**, oder der Kunde
selbst im Reiter *Einstellungen* seines Serverplatzes. Laufende Bots gehen dabei kurz aus und nach
zwei Sekunden wieder an – die Ausgangsadresse und die Maschine stehen beim Start fest und lassen
sich einem laufenden Prozess nicht unterschieben.

**Ohne Wunsch** nimmt das Panel den ersten freigegebenen Standort, der frei und erreichbar ist,
in der Reihenfolge des Feldes *Reihenfolge*.

---

<a id="grenzen"></a>

## 7. Grenzen, Auslastung und was "voll" heißt

Ein Standort gilt als **voll**, sobald eine dieser Grenzen erreicht ist:

| Grenze | Zählt | `0` bedeutet |
| --- | --- | --- |
| Serverplätze höchstens | angelegte Serverplätze | unbegrenzt |
| Bots höchstens | **laufende** Bots | unbegrenzt |
| CPU-Grenze (%) | gemessene Auslastung der Maschine | keine Grenze |
| Speichergrenze (%) | gemessener Arbeitsspeicher der Maschine | keine Grenze |

Die beiden gemessenen Grenzen sind der Unterschied zwischen einer Zahl im Formular und der
Wirklichkeit: Ein Standort mit 95 % CPU ist voll, auch wenn rechnerisch noch Bots hineinpassten.

Ein voller Standort nimmt **keine neuen Serverplätze** an. Was schon dort liegt, läuft weiter –
niemandem wird etwas abgeschaltet, weil eine Grenze erreicht ist.

**Empfohlene Werte** für einen VPS mit 1 GB RAM: Bots höchstens `12`, CPU-Grenze `85`,
Speichergrenze `85`.

Die Auslastung steht auf der Karte jedes Standorts und wird alle 15 Sekunden neu gemeldet. Wer
wie viel verbraucht, steht in **Administration → System**.

---

<a id="betrieb"></a>

## 8. Betrieb

### Client aktualisieren

Nichts zu tun. Das Panel prüft stündlich auf einen neuen Client-Release; danach sagt es allen
Standorten Bescheid, und die holen sich, was sich geändert hat. Von Hand geht es über
**Administration → Client → Abgleichen**.

### Agent aktualisieren

```bash
# auf dem Panel-Server
rsync -a /opt/afksystems/agent root@<standort-ip>:/root/afk/

# auf dem Standort
sudo cp /root/afk/agent/index.js /opt/afksystems-agent/index.js
sudo chown afkagent:afkagent /opt/afksystems-agent/index.js
sudo systemctl restart afksystems-agent
```

Laufende Bots gehen dabei aus – der Agent stoppt sie beim Beenden ordentlich.

### Token wechseln

**Administration → Standorte → *Standort* → Neues Token.** Der Standort fliegt sofort heraus. Auf
der Maschine dann:

```bash
sudo sed -i "s|^NODE_TOKEN=.*|NODE_TOKEN=<neues-token>|" /opt/afksystems-agent/.env
sudo systemctl restart afksystems-agent
```

### Einen Standort stilllegen

1. **Bearbeiten → Aktiv** aus. Ab jetzt kommen keine neuen Serverplätze mehr dazu.
2. Die vorhandenen Serverplätze einzeln auf einen anderen Standort schieben.
3. Erst wenn keiner mehr darauf liegt, lässt er sich löschen.

Auf der Maschine:

```bash
sudo systemctl disable --now afksystems-agent
```

### Was passiert, wenn die Leitung abreißt

Reißt die Verbindung zwischen Panel und Standort ab, stoppt der Agent **seine Bots**. Das klingt
hart, ist aber die einzige ehrliche Antwort: Ein Bot, den niemand mehr lesen oder steuern kann,
säße unsichtbar auf einem Minecraft-Server – und beim Wiederaufbau der Leitung wäre er ein
Doppelgänger, weil das Panel ihn längst für beendet hält.

Der **Wunsch** bleibt dabei stehen. Sobald der Standort wieder da ist, fährt das Panel alles
wieder hoch, was dort laufen sollte – vier Sekunden nach dem `hello`, damit der Abgleich der
Client-Dateien vorher durch ist. Im Log steht dann:

```
[standort 2] 3 Bot(s) wieder gestartet.
```

Für den Kunden heißt das: kurzer Aussetzer, keine Handarbeit.

### Wie viel läuft gerade wo?

* **Administration → Standorte** – je Standort: Serverplätze, laufende Bots, CPU, RAM, Platte.
* **Administration → System** – die Panel-Maschine im Einzelnen, Verbrauch je Serverplatz.

---

<a id="fehlersuche"></a>

## 9. Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Standort bleibt **nicht verbunden** | falsches Token | `journalctl -u afksystems-agent -n 50` – bei `401` das Token im Panel neu setzen und in `/opt/afksystems-agent/.env` eintragen |
| … oder falsche Panel-Adresse | `PANEL_URL` zeigt woandershin | `cat /opt/afksystems-agent/.env`, Adresse ohne Schrägstrich am Ende |
| … oder kein Netz nach draußen | ausgehendes HTTPS gesperrt | `curl -sI https://example.invalid/api/health` auf dem Standort |
| Bot startet nicht: *"Die Client-Datei … liegt auf diesem Standort nicht"* | Abgleich ist nicht durchgelaufen | im Panel **Administration → Client → Abgleichen**, dann im Log des Agenten nachsehen |
| Bot startet nicht: *"Der Standort … ist gerade nicht erreichbar"* | Leitung ab | siehe erste Zeile |
| Bots gehen alle gleichzeitig aus und kommen wieder | die Leitung war kurz weg | normal – siehe unten |
| Konto muss ständig neu verbunden werden | die Kontodatei kommt nicht zurück | Rechte auf `/opt/afksystems/data/users` prüfen (muss dem Panel-Benutzer gehören) |
| Standort steht nicht zur Auswahl | Zugang auf *Nur Administratoren*, Standort voll oder nicht verbunden | **Administration → Standorte** ansehen |
| Auslastungsbalken bleiben leer | noch keine Meldung eingetroffen | 15 Sekunden warten; sonst Leitung prüfen |
| Bot bleibt auf *verbinde* stehen (Proxy) | Proxy antwortet nicht | `curl --socks5 …` vom Panel-Server aus |
| *"SOCKS5: Verbindung abgelehnt"* | Firewall oder falsche `client pass`-Regel | `ufw status`, `journalctl -u danted -n 50` |
| Es kommt die **alte** IP zurück | `external:` zeigt auf die falsche Adresse | `/etc/danted.conf` prüfen, `systemctl restart danted` |

### Von Hand nachsehen

```bash
# Auf dem Standort: läuft der Dienst, was sagt er?
systemctl status afksystems-agent --no-pager
journalctl -u afksystems-agent -n 100 --no-pager

# Welche Client-Dateien liegen dort?
ls -la /opt/afksystems-agent/data/bin

# Laufen dort wirklich Bots?
pgrep -a -u afkagent -f afk-linux
```

---

<a id="sicherheit"></a>

## 10. Sicherheit: was wo liegt

| Auf dem Standort liegt | Auf dem Standort liegt **nicht** |
| --- | --- |
| die Client-Dateien | die Datenbank |
| die Kontodateien der Nutzer, deren Bots gerade dort laufen (Microsoft-Token) | Passwörter, Sitzungen, E-Mail-Adressen |
| das eigene Token | die Token anderer Standorte |
| die Protokolle des Agenten | Zahlungsdaten |

Daraus folgt zweierlei:

* **Ein Standort ist so vertrauenswürdig wie die Konten, die darauf laufen.** Wer Wurzelrechte auf
  einem Standort hat, kommt an die Microsoft-Token der Bots, die dort gerade laufen. Standorte
  gehören deshalb dir – nicht einem Kunden, nicht einem Bekannten.
* **Ein verlorenes Token kostet nichts weiter als ein neues Token.** Damit lässt sich weder auf die
  Datenbank noch auf andere Standorte zugreifen; es taugt nur dazu, sich als dieser eine Standort
  auszugeben und Client-Dateien herunterzuladen.

Härtung, die sich lohnt:

```bash
# SSH nur mit Schlüssel
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Automatische Sicherheitsupdates
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Die systemd-Unit des Agenten läuft bereits ohne Wurzelrechte (`User=afkagent`), mit
`ProtectSystem=strict` und schreibt nur in ihr eigenes `data/`-Verzeichnis.
