# Standorte und Proxys anlegen

Schritt für Schritt, mit den Befehlen zum Kopieren. Zwei Fälle: ein **neuer VPS** und eine
**zusätzliche IP** auf dem Server, der schon läuft.

---

## Erst verstehen, was ein Standort ist

Aus Sicht eines Minecraft-Servers ist ein Bot eine **IP-Adresse**. Daran hängt, wie viele Konten
gleichzeitig hineindürfen, und daran hängt auch, wen ein Server sperrt, wenn ihm etwas nicht passt.
Wo der Bot-Prozess läuft, sieht dort niemand.

Deshalb ist ein Standort in AFKSystems genau das: **eine Ausgangsadresse plus die Regeln, wer sie
benutzen darf und wie viel dort laufen darf.** Die Bot-Prozesse laufen weiterhin auf der Maschine,
auf der das Panel läuft; der zweite VPS steuert seine IP-Adresse bei.

Das hat zwei Folgen, die man kennen sollte:

* Ein zweiter Standort verteilt **Adressen**, nicht Rechenlast. Wenn die Maschine an ihre Grenze
  kommt, hilft ein Standort nicht – dann braucht es einen größeren Server.
* Dafür ist er in fünf Minuten eingerichtet und es gibt nichts, was auseinanderlaufen kann: keine
  zweite Datenbank, kein zweiter Client-Download, kein Abgleich.

Im Admin-Bereich sieht man die Auslastung je Standort (**Administration → Standorte**) und den
Verbrauch je Serverplatz (**Administration → System**).

---

## Fall 1: Ein neuer VPS

Beispiel: ein kleiner Server bei Hetzner, Netcup, Contabo – 1 vCPU und 1 GB RAM genügen völlig,
denn er tut nichts anderes, als Verbindungen weiterzureichen.

### 1. VPS bestellen und einloggen

```bash
ssh root@<neue-ip>
apt update && apt upgrade -y
```

### 2. SOCKS5-Dienst installieren

`dante` ist dafür das schlichteste Werkzeug und liegt in jedem Debian/Ubuntu bereit.

```bash
apt install -y dante-server
```

Den Namen der Netzwerkkarte merken – meist `eth0` oder `ens3`:

```bash
ip -o -4 addr show | awk '{print $2, $4}'
```

### 3. Konfiguration schreiben

`/etc/danted.conf` – **`external`** auf den Namen der Karte von oben setzen, und
`<panel-ip>` auf die IP-Adresse des Servers, auf dem AFKSystems läuft:

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

### 4. Benutzer für den Proxy anlegen

Dante prüft gegen die Systembenutzer. Ein Benutzer ohne Login-Shell genügt:

```bash
useradd -r -s /usr/sbin/nologin afkproxy
passwd afkproxy          # ein langes Passwort vergeben und notieren
systemctl enable --now danted
systemctl status danted --no-pager
```

### 5. Firewall: nur das Panel darf hinein

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow from <panel-ip> to any port 1080 proto tcp
ufw --force enable
```

### 6. Vom Panel-Server aus prüfen

```bash
curl -s --socks5 afkproxy:<passwort>@<neue-ip>:1080 https://api.ipify.org
```

Kommt die **neue** IP-Adresse zurück, steht der Standort. Kommt nichts, stimmt etwas an Firewall
oder Zugangsdaten nicht – erst das klären, dann weiter.

### 7. Im Panel eintragen

1. **Administration → Proxys → Anlegen**
   * Name: `VPS Falkenstein` (oder wie er heißen soll)
   * `host:port`: `<neue-ip>:1080`
   * Typ: `socks5`
   * Benutzername: `afkproxy`, Passwort: das von oben
   * Nutzer: leer lassen – der Proxy gehört dem Standort, nicht einer Person

2. **Administration → Standorte → Anlegen**
   * Name: `VPS Falkenstein`
   * Region: z. B. `Falkenstein`
   * Proxy: den eben angelegten wählen
   * Server höchstens / Bots höchstens: Obergrenzen, `0` heißt unbegrenzt
   * **Zugang**:
     * `Alle` – jeder Kunde darf hier Serverplätze anlegen
     * `Nur ausgewählte Nutzer` – darunter die Nutzer-IDs eintragen, mit Komma getrennt
       (die ID steht in **Administration → Nutzer** in der ersten Spalte)
     * `Nur Administratoren` – für Standorte, die noch getestet werden

Fertig. Der Standort steht ab sofort beim Anlegen eines Serverplatzes zur Auswahl, und alle Bots
darauf gehen über die neue Adresse hinaus.

---

## Fall 2: Eine zusätzliche IP für den bestehenden Server

Beim Anbieter eine zweite IPv4 bestellen und aufs Interface legen. Bei Hetzner und Netcup steht die
fertige Konfiguration im Kundenbereich; allgemein mit netplan:

```bash
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

Dann denselben Dienst wie oben installieren, aber **an die zweite Adresse gebunden** – so geht der
Verkehr auch wirklich über sie hinaus:

```bash
apt install -y dante-server
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
```

Prüfen:

```bash
curl -s --socks5 afkproxy2:<passwort>@127.0.0.1:1081 https://api.ipify.org
```

Im Panel eintragen wie oben, mit `127.0.0.1:1081` als Adresse.

> **Läuft schon ein `danted` auf dieser Maschine?** Dann braucht die zweite Instanz eine eigene
> Unit. Konfiguration nach `/etc/danted2.conf` legen und
> `systemctl edit --force --full danted2.service` mit
> `ExecStart=/usr/sbin/danted -f /etc/danted2.conf` anlegen.

---

## Einen Proxy einzeln an einen Kunden geben

Nicht jeder Proxy gehört zu einem Standort. Wer einen für sich allein braucht (Ticket der Kategorie
„Proxy anfragen“), bekommt ihn so:

1. **Administration → Proxys → Anlegen**, wie oben.
2. Unter **Nutzer** den Kunden auswählen. Damit taucht er nur bei ihm auf.
3. Der Kunde wählt ihn im Serverplatz unter **Proxys** je Konto aus.

Ein Proxy, der einem Standort zugeordnet ist, gilt für alle Bots dieses Standorts. Ein Proxy, der
einem Nutzer zugeordnet ist, gilt nur für die Konten, an denen er ausgewählt wurde. Ist beides
gesetzt, gewinnt die Auswahl am Konto – das Genauere schlägt das Allgemeine.

---

## Wenn etwas nicht geht

| Beobachtung | Ursache | Abhilfe |
| --- | --- | --- |
| Bot bleibt auf „verbinde“ stehen | Proxy antwortet nicht | `curl --socks5 …` vom Panel-Server aus |
| „SOCKS5: Verbindung abgelehnt“ | Firewall oder falsche `client pass`-Regel | `ufw status`, `journalctl -u danted -n 50` |
| „SOCKS5: allgemeiner Fehler des Proxys“ | Benutzername oder Passwort falsch | `passwd afkproxy` neu setzen, im Panel nachtragen |
| Es kommt die **alte** IP zurück | `external:` zeigt auf die falsche Adresse | `/etc/danted.conf` prüfen, `systemctl restart danted` |
| Standort steht nicht zur Auswahl | Zugang auf `Nur ausgewählte Nutzer` oder Standort voll | **Administration → Standorte** ansehen |

Was auf einem Standort läuft, steht in **Administration → Standorte**; wer wie viel verbraucht, in
**Administration → System**.
