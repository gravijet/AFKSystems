#!/usr/bin/env bash
# Installiert die externe Sicherung. Beim ersten Aufruf werden Ziel und SSH-Schluessel angelegt:
#
#   BACKUP_REMOTE=benutzer@server BACKUP_DEST=/sicherungen/afksystems ./deploy/install-backup.sh
#
# Danach den ausgegebenen oeffentlichen Schluessel einmal am Ziel hinterlegen und den Dienst
# starten. Weitere Aufrufe (auch aus install.sh) erhalten die vorhandene Konfiguration.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR=/etc/afksystems
CONFIG="$CONFIG_DIR/backup.conf"
IDENTITY="$CONFIG_DIR/backup_ed25519"
KNOWN_HOSTS="$CONFIG_DIR/backup_known_hosts"

[[ "$(id -u)" -eq 0 ]] || { echo "Bitte mit sudo starten." >&2; exit 1; }

install -d -m 0700 "$CONFIG_DIR"
if [[ ! -f "$CONFIG" ]]; then
  : "${BACKUP_REMOTE:?BACKUP_REMOTE fehlt, zum Beispiel benj@192.0.2.10}"
  : "${BACKUP_DEST:?BACKUP_DEST fehlt, zum Beispiel /home/benj/backups/afksystems}"
  [[ "$BACKUP_REMOTE" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]] || {
    echo "Ungueltiges SSH-Ziel." >&2
    exit 2
  }
  [[ "$BACKUP_DEST" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "Ungueltiger Zielpfad." >&2; exit 2; }
  {
    printf 'BACKUP_REMOTE=%s\n' "$BACKUP_REMOTE"
    printf 'BACKUP_DEST=%s\n' "$BACKUP_DEST"
    printf 'BACKUP_KEEP=%s\n' "${BACKUP_KEEP:-56}"
    printf 'BACKUP_IDENTITY=%s\n' "$IDENTITY"
    printf 'BACKUP_KNOWN_HOSTS=%s\n' "$KNOWN_HOSTS"
  } >"$CONFIG"
  chmod 0600 "$CONFIG"
fi

if [[ ! -f "$IDENTITY" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C "afksystems-backup@$(hostname)" -f "$IDENTITY"
fi
chmod 0600 "$IDENTITY"
chmod 0644 "$IDENTITY.pub"
touch "$KNOWN_HOSTS"
chmod 0600 "$KNOWN_HOSTS"

install -m 0755 "$ROOT/deploy/afksystems-backup" /usr/local/sbin/afksystems-backup
install -m 0644 "$ROOT/deploy/afksystems-backup.service" /etc/systemd/system/afksystems-backup.service
install -m 0644 "$ROOT/deploy/afksystems-backup.timer" /etc/systemd/system/afksystems-backup.timer
systemctl daemon-reload
systemctl enable --now afksystems-backup.timer

echo "Externe Sicherung installiert. Oeffentlicher Schluessel fuer das Ziel:"
cat "$IDENTITY.pub"
echo "Danach pruefen mit: systemctl start afksystems-backup.service"
