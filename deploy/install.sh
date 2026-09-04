#!/usr/bin/env bash
# Richtet das Panel auf diesem Server ein: Dienstbenutzer, /opt/afksystems, systemd, nginx.
# Mehrfach aufrufbar – bestehende Dateien werden ersetzt, die Daten unter data/ bleiben liegen.
#
#   sudo ./deploy/install.sh
#
# Danach fehlt nur noch das Zertifikat:
#   sudo certbot --nginx -d example.invalid -d example.invalid

set -euo pipefail

DOMAIN="${DOMAIN:-example.invalid}"
ZIEL="${ZIEL:-/opt/afksystems}"
DIENST="${DIENST:-afksystems}"
QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }

echo "== Dienstbenutzer =="
if ! id "$DIENST" >/dev/null 2>&1; then
  useradd --system --home-dir "$ZIEL" --shell /usr/sbin/nologin "$DIENST"
  echo "Benutzer $DIENST angelegt."
else
  echo "Benutzer $DIENST gibt es schon."
fi

echo "== Dateien nach $ZIEL =="
mkdir -p "$ZIEL"
# data/ und node_modules/ nicht mitkopieren: Daten bleiben, und die installierten Module gehören
# allein zum Zielsystem. Ein Stempel weiter unten entscheidet anhand von Lockfile und Node-Fassung,
# ob sie wirklich neu gebaut werden müssen.
rsync -a --delete \
  --exclude 'data/' --exclude 'node_modules/' --exclude '.git/' --exclude '.env' \
  "$QUELLE/" "$ZIEL/"

if [ ! -f "$ZIEL/.env" ]; then
  if [ -f "$QUELLE/.env" ]; then
    cp "$QUELLE/.env" "$ZIEL/.env"
  else
    cp "$QUELLE/.env.example" "$ZIEL/.env"
    echo "ACHTUNG: $ZIEL/.env aus der Vorlage angelegt – bitte durchsehen (GITHUB_TOKEN!)."
  fi
fi
chmod 600 "$ZIEL/.env"

dependency_key() {
  # Die Laufzeit gehört in den Schlüssel: Native Module aus einer anderen Node-Hauptversion können
  # vorhanden aussehen, aber beim nächsten require() scheitern. Paket- und Lockfile decken sowohl
  # direkte als auch transitive Abhängigkeiten ab; jede Abweichung führt garantiert zu npm ci.
  {
    node --version
    sha256sum "$1/package.json" "$1/package-lock.json"
  } | sha256sum | awk '{print $1}'
}

install_dependencies() {
  local root="$1"
  local label="$2"
  local expected stamp
  expected="$(dependency_key "$root")"
  stamp="$root/node_modules/.afksystems-deps-stamp"

  if [ -d "$root/node_modules" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$expected" ]; then
    echo "$label unverändert – Abhängigkeiten bleiben."
    return
  fi

  echo "$label geändert oder unvollständig – Abhängigkeiten installieren."
  (
    cd "$root"
    sudo -u "$DIENST" -H npm ci --omit=dev 2>/dev/null || npm ci --omit=dev
  )
  # Erst nach erfolgreichem npm ci schreiben: Ein Netz- oder Buildfehler darf nie einen
  # unveränderten Bestand vortäuschen und beim nächsten Lauf zum Überspringen führen.
  printf '%s\n' "$expected" > "$stamp"
}

echo "== Abhängigkeiten =="
install_dependencies "$ZIEL" "Panel"

mkdir -p "$ZIEL/data"
chown -R "$DIENST:$DIENST" "$ZIEL"

# Browser müssen Frontend-Dateien zwangsläufig erhalten. In der Produktionskopie werden sie aber
# minimiert ausgeliefert: weniger Traffic und deutlich weniger bequem 1:1 zu kopieren, ohne die
# wartbaren Quellen im Repository zu beschädigen.
( cd "$ZIEL" && sudo -u "$DIENST" -H npm run assets:protect )

echo "== systemd =="
install -m 0644 "$QUELLE/deploy/afksystems.service" /etc/systemd/system/$DIENST.service
install -m 0644 "$QUELLE/deploy/afksystems-bot.service" /etc/systemd/system/$DIENST-bot.service
systemctl daemon-reload
systemctl enable "$DIENST"
systemctl restart "$DIENST"
sleep 3
if ! systemctl is-active --quiet "$DIENST"; then
  # `systemctl status` wäre hier zwar bequem, enthält aber die vollständige Befehlszeile eines
  # Bots. Darin können Zugangsdaten stehen; die Diagnose gehört deshalb ins geschützte Journal
  # des Betreibers und nicht in die Standardausgabe eines Deployments.
  echo "$DIENST ist nach dem Neustart nicht aktiv." >&2
  exit 1
fi
echo "$DIENST aktiv."

echo "== Discord-Bot =="
# Der Bot ist ein eigener Dienst. Er wird nur angefasst, wenn seine .env schon ausgefüllt ist –
# sonst liefe er in eine Schleife aus Neustarts, und die Einrichtung steht in docs/discord-bot.md.
# Auch ohne eingerichteten Bot werden dessen Abhängigkeiten beim ersten Lauf oder nach einer
# Lockfile-Änderung vorbereitet. Der Hinweis darunter führt dann nicht in einen Dienst, dem noch
# `discord.js` fehlt; bei unverändertem Bestand kostet ein normales Panel-Deployment dagegen
# keinen vollständigen zweiten Paketaufbau.
[ -f "$ZIEL/bot/.env" ] || cp "$QUELLE/bot/.env.example" "$ZIEL/bot/.env"
install_dependencies "$ZIEL/bot" "Discord-Bot"
chown -R "$DIENST:$DIENST" "$ZIEL/bot"
chmod 600 "$ZIEL/bot/.env"

if grep -q '^PANEL_SECRET=.\+' "$ZIEL/bot/.env"; then
  systemctl enable "$DIENST-bot"
  systemctl restart "$DIENST-bot"
  echo "Bot neu gestartet."
else
  echo "Bot noch nicht eingerichtet – $ZIEL/bot/.env ausfüllen, dann:"
  echo "  systemctl enable --now $DIENST-bot"
  echo "  (Anleitung: docs/discord-bot.md)"
fi

echo "== nginx =="
if [ -d /etc/nginx/sites-available ]; then
  # Gibt es schon ein Zertifikat, wird die Fassung mit TLS installiert. Ohne diese Unterscheidung
  # würde jedes Deployment den TLS-Block wieder wegnehmen – und hinter Cloudflare landete Port 443
  # dann im nächstbesten fremden vHost.
  VHOST="$QUELLE/deploy/nginx-example.invalid.conf"
  if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    VHOST="$QUELLE/deploy/nginx-example.invalid-ssl.conf"
    echo "Zertifikat gefunden – vHost mit TLS."
  else
    echo "Kein Zertifikat für $DOMAIN – vHost vorerst nur über Port 80."
    echo "Danach einmal:  certbot --nginx -d $DOMAIN  und install.sh erneut aufrufen."
  fi
  install -m 0644 "$VHOST" "/etc/nginx/sites-available/$DOMAIN"
  ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  if nginx -t; then
    systemctl reload nginx
    echo "nginx neu geladen."
  else
    echo "nginx-Konfiguration fehlerhaft – nicht neu geladen." >&2
  fi
else
  echo "Kein nginx mit sites-available gefunden, Schritt übersprungen."
fi

echo "== Externe Sicherung =="
if [ -f /etc/afksystems/backup.conf ]; then
  "$QUELLE/deploy/install-backup.sh"
  echo "Vorhandene externe Sicherung aktualisiert."
else
  echo "Nicht eingerichtet – optional mit deploy/install-backup.sh einrichten."
fi

echo
echo "Fertig. Prüfen:"
echo "  curl -s localhost:3010/api/health"
echo "  journalctl -u $DIENST -f"
echo
echo "Zertifikat (einmalig):"
echo "  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
