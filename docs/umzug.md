# Auf einen anderen Server umziehen

AFKSystems liegt vollständig in **einem** Verzeichnis: `/opt/afksystems`. Der Programmstand kommt
aus dem Repository, alles Veränderliche steht unter `data/`. Ein Umzug ist deshalb kein Umbau,
sondern ein Kopiervorgang mit der richtigen Reihenfolge.

## Warum die Reihenfolge alles ist

Zwei laufende Panels auf demselben Datenbestand sind nicht doppelt so gut, sondern kaputt:

* **Der Discord-Bot.** Zwei Verbindungen mit demselben Token bekommen beide jedes Ereignis. Ein
  Ticket bekäme zwei Kanäle, jede Antwort stünde doppelt im Verlauf.
* **Die Minecraft-Bots.** Beide Panels starten beim Hochfahren alles, was zuletzt laufen sollte.
  Derselbe Account, der sich zweimal anmeldet, wirft sich selbst hinaus – auf den meisten Servern
  im Sekundentakt.
* **Die Datenbank.** SQLite steht in einer Datei. Zwei Rechner, die dieselbe Zeile ändern, wissen
  nichts voneinander; wer zuletzt kopiert, gewinnt, und die Änderungen des anderen sind weg.

Deshalb: **erst anhalten, dann kopieren, dann drüben starten.**

## Der Weg

### 1. Die neue Maschine vorbereiten

Node 20 oder neuer, ein Übersetzer für `better-sqlite3`, nginx:

```bash
apt-get install -y build-essential python3 rsync sqlite3 nginx certbot python3-certbot-nginx
node -v            # muss >= 20 sein
```

### 2. Alles hinüberbringen und starten

Vom **alten** Server aus, im Repository:

```bash
sudo -E ./deploy/cutover.sh
```

Ohne SSH-Schlüssel vorher `export SSHPASS='…'` setzen (`sshpass` muss installiert sein). Das
Skript

1. stoppt Panel und Bot hier und schaltet beide Dienste ab,
2. wartet, bis die Client-Prozesse weg sind,
3. zieht einen konsistenten Abzug der Datenbank (`.backup`, nimmt die WAL-Datei mit),
4. überträgt Programmstand und `data/`,
5. installiert drüben Abhängigkeiten, systemd-Units und startet.

Ziel und Benutzer lassen sich über `ZIEL_HOST` und `ZIEL_USER` setzen.

**Was mitmuss und leicht vergessen wird:**

| Datei | Warum |
| --- | --- |
| `data/secret.key` | ohne sie ist jede offene Sitzung ungültig – alle sind ausgeloggt |
| `data/tickets/` | die Anhänge; die Datenbank enthält nur die Verweise |
| `data/users/` | Kontodateien |
| `data/bin/` | die Client-Binärdateien (~60 MB); sonst startet kein Bot, bis sie neu geladen sind |
| `data/mc/` | die Minecraft-Client-JARs (~25 MB je Version); ohne sie zeigt die Live-Ansicht Voxel statt Texturen, bis sie wieder da sind |
| `.env`, `bot/.env` | stehen nicht im Repository |

Zugangsdaten für Discord, SMTP und Stripe stehen **in der Datenbank**, nicht in einer Datei – die
kommen also mit dem Abzug mit.

### 3. DNS umstellen

Bei Cloudflare den A-Record auf die neue Adresse. Bis er greift, ist die Seite auf der alten
Adresse erreichbar, aber dort läuft nichts mehr – dieses Fenster ist so kurz wie die TTL.

### 4. Zertifikat

Erst **nach** dem DNS-Wechsel, sonst geht die Prüfung an den alten Server:

```bash
certbot --nginx -d example.invalid -d example.invalid
/opt/afksystems/deploy/install.sh     # nimmt danach die vHost-Fassung mit TLS
```

Bei Cloudflare den SSL-Modus auf **Full (strict)** stellen.

### 5. Nachsehen

```bash
curl -s localhost:3010/api/health
systemctl status afksystems afksystems-bot
journalctl -u afksystems -f
```

Im Panel: *Administration → System*. Dort stehen der Zustand des Discord-Bots, die Standorte und
die laufenden Bots.

## Zurück

Der Datenbestand auf dem alten Server bleibt unangetastet liegen. Zurück geht es deshalb so:

```bash
# alt
systemctl enable --now afksystems afksystems-bot
# neu
systemctl disable --now afksystems afksystems-bot
```

und den DNS-Eintrag zurückdrehen. Was in der Zwischenzeit auf dem neuen Server passiert ist, geht
dabei verloren – deshalb ist die Rückfahrkarte nur für die ersten Minuten gedacht.

## Der Discord-Bot woanders

Er muss nicht neben dem Panel liegen. `bot/` hochladen, `PANEL_URL` und `PANEL_SECRET` setzen,
`npm ci --omit=dev && node index.js`. Alles Übrige holt er sich beim Start aus dem Panel – siehe
[discord-bot.md](discord-bot.md).
