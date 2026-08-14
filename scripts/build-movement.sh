#!/usr/bin/env bash
# Baut die Bewegungs-Bauform des Clients und legt sie nach data/bin/afk-linux-move.
#
# Warum von Hand: Der Build-Workflow im Client-Repo baut nur den schlanken Client, und genau der
# liegt im Release. Die Bewegung ist ein Cargo-Feature ("movement") – sie muss also einmal selbst
# gebaut werden. Danach kann jedes Serverprofil im Panel auf Bewegung umgestellt werden.
#
# Aufruf:  ./scripts/build-movement.sh            (baut aus dem aktuellen main)
#          ./scripts/build-movement.sh <zweig>

set -euo pipefail

ZWEIG="${1:-main}"
WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIEL="$WURZEL/data/bin/afk-linux-move"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

REPO="${CLIENT_REPO:-gravijet/HugoAFKClient}"

echo "== Quelltext holen ($REPO, Zweig $ZWEIG) =="
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh repo clone "$REPO" "$ARBEIT/src" -- --depth 1 --branch "$ZWEIG"
else
  # Ohne gh: Token aus der .env verwenden (das Repo ist privat).
  TOKEN="${GITHUB_TOKEN:-$(grep -s '^GITHUB_TOKEN=' "$WURZEL/.env" | cut -d= -f2-)}"
  [ -n "$TOKEN" ] || { echo "Kein GitHub-Zugang: gh anmelden oder GITHUB_TOKEN setzen." >&2; exit 1; }
  git clone --depth 1 --branch "$ZWEIG" "https://x-access-token:$user@example.invalid/$REPO.git" "$ARBEIT/src"
fi

echo "== Rust bereitstellen =="
if ! command -v cargo >/dev/null; then
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
  else
    echo "Rust wird installiert (rustup, minimal) ..."
    curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
fi
cargo --version

echo "== Bauen (Feature: movement) =="
cd "$ARBEIT/src/rust"
cargo build --release --features movement --target-dir "$ARBEIT/target"

mkdir -p "$(dirname "$ZIEL")"
install -m 0755 "$ARBEIT/target/release/afk" "$ZIEL"

echo
echo "Fertig: $ZIEL"
"$ZIEL" --help | head -3
echo
echo "Das Panel erkennt die Datei beim nächsten Abgleich (oder Neustart) von selbst."
