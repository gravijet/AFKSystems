#!/usr/bin/env bash
# Den Umzug abschließen: **dieser** Rechner hört auf, der neue fängt an.
#
#   sudo -E ./deploy/cutover.sh
#
# Warum es dafür ein eigenes Skript gibt und nicht nur install.sh: Beim Umzug ist die Reihenfolge
# die ganze Arbeit. Zwei Panels mit demselben Datenbestand wären nicht doppelt so gut, sondern
# kaputt – derselbe Discord-Token an zwei Verbindungen legt jedes Ticket doppelt an, und derselbe
# Minecraft-Account, der sich zweimal anmeldet, wirft sich gegenseitig hinaus. Deshalb: erst hier
# anhalten, dann den Datenbestand nehmen, dann drüben starten. In dieser Reihenfolge und in keiner
# anderen.
#
# Voraussetzungen:
#   * Die Zielmaschine ist bereits eingerichtet (Dienstbenutzer, /opt/afksystems, systemd, nginx).
#     Das macht deploy/install.sh dort oder ein erster Lauf dieses Skripts.
#   * SSH geht ohne Rückfrage – am besten mit Schlüssel. Sonst:
#       export SSHPASS='…'   und   sshpass muss installiert sein.
#     Das Passwort steht bewusst **nirgends** in diesem Repository.
#
# Was **nicht** hierhin gehört, weil es nur einmal und von Hand passiert:
#   * Der DNS-Eintrag (bei Cloudflare: A-Record auf die neue Adresse).
#   * Das Zertifikat auf der neuen Maschine – das geht erst, wenn der DNS-Eintrag steht:
#       certbot --nginx -d example.invalid -d example.invalid
#     Danach dort einmal deploy/install.sh, damit die vHost-Fassung mit TLS greift.

set -euo pipefail

ZIEL_HOST="${ZIEL_HOST:-192.0.2.1}"
ZIEL_USER="${ZIEL_USER:-root}"
QUELLE="${QUELLE:-/opt/afksystems}"
ZIEL="${ZIEL:-/opt/afksystems}"
DIENST="${DIENST:-afksystems}"

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }
[ -d "$QUELLE" ] || { echo "$QUELLE gibt es hier nicht." >&2; exit 1; }

# Mit Schlüssel, wenn es geht; sonst mit sshpass und dem Passwort aus der Umgebung.
if [ -n "${SSHPASS:-}" ]; then
  command -v sshpass >/dev/null || { echo "SSHPASS ist gesetzt, aber sshpass fehlt." >&2; exit 1; }
  SSH_CMD="sshpass -e ssh -o StrictHostKeyChecking=accept-new"
else
  SSH_CMD="ssh -o StrictHostKeyChecking=accept-new"
fi
FERN() { $SSH_CMD "$ZIEL_USER@$ZIEL_HOST" "$@"; }

echo "== Erreichbarkeit =="
FERN 'echo "verbunden mit $(hostname)"; node -v'

# ---------------------------------------------------------------- Anhalten

echo
echo "== Hier anhalten =="
# Der Bot zuerst: er soll seine Discord-Verbindung sauber schließen, solange das Panel noch steht.
systemctl stop "$DIENST-bot" 2>/dev/null || true
systemctl stop "$DIENST"
# Die Client-Prozesse bekommen ihre Zeit; erst wenn sie weg sind, ist die Datenbank in Ruhe.
for _ in $(seq 1 20); do
  pgrep -u "$DIENST" >/dev/null 2>&1 || break
  sleep 1
done
systemctl disable "$DIENST" "$DIENST-bot" 2>/dev/null || true
echo "Panel und Bot sind hier gestoppt und abgeschaltet."

# ---------------------------------------------------------------- Daten

echo
echo "== Datenbank sichern =="
ABZUG="$(mktemp -d)/afksystems.db"
# `.backup` statt `cp`: es nimmt die WAL-Datei mit auf. Ein blosses Kopieren der .db-Datei liesse
# alles zurück, was seit dem letzten Checkpoint geschrieben wurde – im Zweifel Stunden.
sqlite3 "$QUELLE/data/afksystems.db" ".backup '$ABZUG'"
sqlite3 "$ABZUG" 'PRAGMA integrity_check;' | head -1
echo "Abzug: $(du -h "$ABZUG" | cut -f1)"

echo
echo "== Übertragen =="
FERN "mkdir -p $ZIEL/data"
# Der Programmstand aus dem Repository, nicht aus /opt: dort liegen die minimierten Fassungen der
# Frontend-Dateien, und die sollen drüben frisch aus den Quellen entstehen.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rsync -a --delete -e "$SSH_CMD" \
  --exclude 'data/' --exclude 'node_modules/' --exclude '.git/' --exclude '.env' --exclude '.npm/' \
  "$REPO/" "$ZIEL_USER@$ZIEL_HOST:$ZIEL/"

rsync -a -e "$SSH_CMD" "$ABZUG" "$ZIEL_USER@$ZIEL_HOST:$ZIEL/data/afksystems.db"
# Der Sitzungsschlüssel muss mit, sonst ist jeder ausgeloggt. Alles Übrige sind Dateien, auf die
# Datenbankzeilen zeigen: Anhänge, Kontodateien, Client-Binärdateien, Protokolle.
#
# **Nur, was es wirklich gibt.** rsync bricht mit Fehlerstatus ab, sobald eine Quelle fehlt – und
# unter `set -e` nahm das den ganzen Umzug mit, nachdem das Panel hier schon gestoppt und
# abgeschaltet war. `data/tickets` entsteht erst mit dem ersten Anhang, und `data/backups` legt
# nirgends jemand an: dieser Umzug konnte also gar nicht durchlaufen.
MIT=()
for teil in secret.key tickets users bin logs backups; do
  [ -e "$QUELLE/data/$teil" ] && MIT+=("$QUELLE/data/$teil")
done
if [ ${#MIT[@]} -gt 0 ]; then
  rsync -a -e "$SSH_CMD" "${MIT[@]}" "$ZIEL_USER@$ZIEL_HOST:$ZIEL/data/"
fi

# Die .env geht nur mit, wenn drüben noch keine liegt – dort kann eine angepasste stehen.
if ! FERN "test -s $ZIEL/.env"; then
  rsync -a -e "$SSH_CMD" "$QUELLE/.env" "$ZIEL_USER@$ZIEL_HOST:$ZIEL/.env"
fi
if [ -f "$QUELLE/bot/.env" ] && ! FERN "test -s $ZIEL/bot/.env"; then
  rsync -a -e "$SSH_CMD" "$QUELLE/bot/.env" "$ZIEL_USER@$ZIEL_HOST:$ZIEL/bot/.env"
fi
rm -rf "$(dirname "$ABZUG")"
echo "Übertragen."

# ---------------------------------------------------------------- Drüben starten

echo
echo "== Drüben einrichten und starten =="
FERN "set -e
  id $DIENST >/dev/null 2>&1 || useradd --system --home-dir $ZIEL --shell /usr/sbin/nologin $DIENST
  chmod 600 $ZIEL/.env $ZIEL/bot/.env 2>/dev/null || true
  chown -R $DIENST:$DIENST $ZIEL
  cd $ZIEL && sudo -u $DIENST -H npm ci --omit=dev >/dev/null
  cd $ZIEL/bot && sudo -u $DIENST -H npm ci --omit=dev >/dev/null
  cd $ZIEL && sudo -u $DIENST -H npm run assets:protect
  install -m 0644 $ZIEL/deploy/afksystems.service /etc/systemd/system/$DIENST.service
  install -m 0644 $ZIEL/deploy/afksystems-bot.service /etc/systemd/system/$DIENST-bot.service
  systemctl daemon-reload
  systemctl enable --now $DIENST
  sleep 6
  systemctl enable --now $DIENST-bot
"

echo
echo "== Prüfen =="
FERN "curl -s --max-time 8 http://127.0.0.1:3010/api/health; echo; systemctl is-active $DIENST $DIENST-bot"

cat <<HINWEIS

Fertig – das Panel läuft jetzt auf $ZIEL_HOST.

Was noch von Hand kommt:
  1. DNS umstellen (Cloudflare: A-Record example.invalid → $ZIEL_HOST).
  2. Sobald er greift, auf $ZIEL_HOST:
       certbot --nginx -d example.invalid -d example.invalid
       $ZIEL/deploy/install.sh      # nimmt danach die vHost-Fassung mit TLS
  3. Cloudflare: SSL-Modus auf "Full (strict)".

Zurück geht es zur Not so: hier
       systemctl enable --now afksystems afksystems-bot
   und drüben
       systemctl disable --now afksystems afksystems-bot
   sowie den DNS-Eintrag zurückdrehen. Der Datenbestand von hier ist unangetastet.
HINWEIS
