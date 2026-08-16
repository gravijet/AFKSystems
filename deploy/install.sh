#!/usr/bin/env bash
# Richtet das Panel auf diesem Server ein: Dienstbenutzer, /opt/afksystems, systemd, nginx.
# Mehrfach aufrufbar – bestehende Dateien werden ersetzt, die Daten unter data/ bleiben liegen.
#
#   sudo ./deploy/install.sh
#
# Danach fehlt nur noch das Zertifikat:
#   sudo certbot --nginx -d afksystems.de -d www.afksystems.de

set -euo pipefail

DOMAIN="${DOMAIN:-afksystems.de}"
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
# data/ und node_modules/ nicht mitkopieren: Daten bleiben, Module werden frisch installiert.
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

echo "== Abhängigkeiten =="
cd "$ZIEL"
sudo -u "$DIENST" -H npm ci --omit=dev 2>/dev/null || npm ci --omit=dev

mkdir -p "$ZIEL/data"
chown -R "$DIENST:$DIENST" "$ZIEL"

# Browser müssen Frontend-Dateien zwangsläufig erhalten. In der Produktionskopie werden sie aber
# minimiert ausgeliefert: weniger Traffic und deutlich weniger bequem 1:1 zu kopieren, ohne die
# wartbaren Quellen im Repository zu beschädigen.
sudo -u "$DIENST" -H npm run assets:protect

echo "== systemd =="
install -m 0644 "$QUELLE/deploy/afksystems.service" /etc/systemd/system/$DIENST.service
install -m 0644 "$QUELLE/deploy/afksystems-bot.service" /etc/systemd/system/$DIENST-bot.service
systemctl daemon-reload
systemctl enable "$DIENST"
systemctl restart "$DIENST"
sleep 3
systemctl --no-pager --lines=10 status "$DIENST" || true

echo "== Discord-Bot =="
# Der Bot ist ein eigener Dienst. Er wird nur angefasst, wenn seine .env schon ausgefüllt ist –
# sonst liefe er in eine Schleife aus Neustarts, und die Einrichtung steht in docs/discord-bot.md.
if [ -f "$ZIEL/bot/.env" ] && grep -q '^PANEL_SECRET=.\+' "$ZIEL/bot/.env"; then
  ( cd "$ZIEL/bot" && sudo -u "$DIENST" -H npm ci --omit=dev 2>/dev/null || npm ci --omit=dev )
  chown -R "$DIENST:$DIENST" "$ZIEL/bot"
  chmod 600 "$ZIEL/bot/.env"
  systemctl enable "$DIENST-bot"
  systemctl restart "$DIENST-bot"
  echo "Bot neu gestartet."
else
  [ -f "$ZIEL/bot/.env" ] || cp "$QUELLE/bot/.env.example" "$ZIEL/bot/.env"
  chown "$DIENST:$DIENST" "$ZIEL/bot/.env"
  chmod 600 "$ZIEL/bot/.env"
  echo "Bot noch nicht eingerichtet – $ZIEL/bot/.env ausfüllen, dann:"
  echo "  systemctl enable --now $DIENST-bot"
  echo "  (Anleitung: docs/discord-bot.md)"
fi

echo "== nginx =="
if [ -d /etc/nginx/sites-available ]; then
  # Gibt es schon ein Zertifikat, wird die Fassung mit TLS installiert. Ohne diese Unterscheidung
  # würde jedes Deployment den TLS-Block wieder wegnehmen – und hinter Cloudflare landete Port 443
  # dann im nächstbesten fremden vHost.
  VHOST="$QUELLE/deploy/nginx-afksystems.de.conf"
  if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    VHOST="$QUELLE/deploy/nginx-afksystems.de-ssl.conf"
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

echo
echo "Fertig. Prüfen:"
echo "  curl -s localhost:3010/api/health"
echo "  journalctl -u $DIENST -f"
echo
echo "Zertifikat (einmalig):"
echo "  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
