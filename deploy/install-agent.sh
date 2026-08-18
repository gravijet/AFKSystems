#!/usr/bin/env bash
# Richtet einen **Standort** ein: Node.js, Dienstbenutzer, /opt/afksystems-agent, systemd.
#
# Diese Datei läuft auf dem neuen Rechner, nicht auf dem Panel-Server. Sie kann als Einzeiler
# ausgeführt werden – Panel-Adresse und Token stehen im Panel unter
# Administration -> Standorte -> Anlegen.
#
#   sudo PANEL_URL=https://afksystems.de NODE_TOKEN=<token> ./install-agent.sh
#
# Mehrfach aufrufbar: bestehende Dateien werden ersetzt, data/ bleibt liegen.

set -euo pipefail

ZIEL="${ZIEL:-/opt/afksystems-agent}"
DIENST="${DIENST:-afksystems-agent}"
BENUTZER="${BENUTZER:-afkagent}"
PANEL_URL="${PANEL_URL:-}"
NODE_TOKEN="${NODE_TOKEN:-}"
QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }

if [ -z "$PANEL_URL" ] || [ -z "$NODE_TOKEN" ]; then
  echo "PANEL_URL und NODE_TOKEN müssen gesetzt sein." >&2
  echo "  sudo PANEL_URL=https://afksystems.de NODE_TOKEN=<token> $0" >&2
  exit 1
fi

echo "== Node.js =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20+ wird installiert ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== Dienstbenutzer =="
if ! id "$BENUTZER" >/dev/null 2>&1; then
  useradd --system --home-dir "$ZIEL" --shell /usr/sbin/nologin "$BENUTZER"
  echo "Benutzer $BENUTZER angelegt."
fi

echo "== Dateien nach $ZIEL =="
mkdir -p "$ZIEL"
# Nur der Agent gehört auf einen Standort. Panel, Datenbank und Discord-Bot bleiben, wo sie sind.
install -m 0644 "$QUELLE/agent/index.js" "$ZIEL/index.js"
install -m 0644 "$QUELLE/agent/package.json" "$ZIEL/package.json"
mkdir -p "$ZIEL/data"

cat > "$ZIEL/.env" <<EOF
PANEL_URL=$PANEL_URL
NODE_TOKEN=$NODE_TOKEN
AGENT_MAX_JOBS=${AGENT_MAX_JOBS:-0}
EOF
chmod 600 "$ZIEL/.env"

echo "== Abhängigkeiten =="
cd "$ZIEL"
npm install --omit=dev --no-audit --no-fund
chown -R "$BENUTZER:$BENUTZER" "$ZIEL"

echo "== systemd =="
install -m 0644 "$QUELLE/deploy/afksystems-agent.service" "/etc/systemd/system/$DIENST.service"
systemctl daemon-reload
systemctl enable "$DIENST"
systemctl restart "$DIENST"
sleep 3
systemctl --no-pager --lines=15 status "$DIENST" || true

echo
echo "Fertig. Im Panel muss der Standort jetzt als 'verbunden' dastehen."
echo "  journalctl -u $DIENST -f"
