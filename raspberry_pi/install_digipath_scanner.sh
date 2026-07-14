#!/usr/bin/env bash
# Self-contained installer for this raspberry_pi package.
# Prefer: copy folder to ~/Desktop/VinzonsDIGIPATH-Pi then run pi-install-all.sh
#
# Usage (from this folder on the Pi):
#   sudo bash install_digipath_scanner.sh
#   sudo bash install_digipath_scanner.sh --backend-url URL --device-key KEY
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_BASE_URL="${DIGIPATH_BACKEND_BASE_URL:-}"
DEVICE_API_KEY="${DIGIPATH_DEVICE_API_KEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-url) BACKEND_BASE_URL="${2:-}"; shift 2 ;;
    --device-key) DEVICE_API_KEY="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo bash install_digipath_scanner.sh [--backend-url URL] [--device-key KEY]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/pi_ws_scanner.py" ]]; then
  echo "pi_ws_scanner.py missing in $SCRIPT_DIR" >&2
  exit 1
fi

RUN_USER="${SUDO_USER:-digipath}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"

echo "[DigiPath] Installing package → $DEST (user=$RUN_USER)"
mkdir -p "$DEST/scripts"
rsync -a --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.env' \
  --exclude '*.pyc' \
  "$SCRIPT_DIR/" "$DEST/"

if [[ -n "$BACKEND_BASE_URL" || -n "$DEVICE_API_KEY" || ! -f "$DEST/.env" ]]; then
  if [[ ! -f "$DEST/.env" ]]; then
    cp "$DEST/pi_ws_scanner.env.example" "$DEST/.env"
  fi
  if [[ -n "$BACKEND_BASE_URL" ]]; then
    sed -i "s|^DIGIPATH_BACKEND_BASE_URL=.*|DIGIPATH_BACKEND_BASE_URL=${BACKEND_BASE_URL}|" "$DEST/.env"
  fi
  if [[ -n "$DEVICE_API_KEY" ]]; then
    sed -i "s|^DIGIPATH_DEVICE_API_KEY=.*|DIGIPATH_DEVICE_API_KEY=${DEVICE_API_KEY}|" "$DEST/.env"
  fi
  # Prefer office WiFi over always-on hotspot so heartbeats reach the tunnel.
  if ! grep -q '^DIGIPATH_WIFI_FORCE_HOTSPOT=' "$DEST/.env"; then
    echo 'DIGIPATH_WIFI_FORCE_HOTSPOT=0' >> "$DEST/.env"
  else
    sed -i 's|^DIGIPATH_WIFI_FORCE_HOTSPOT=.*|DIGIPATH_WIFI_FORCE_HOTSPOT=0|' "$DEST/.env"
  fi
fi

chown -R "$RUN_USER:$RUN_USER" "$DEST"
sudo -u "$RUN_USER" bash "$DEST/fix-pi-scripts.sh" || true

DIGIPATH_WS_DIR="$DEST" DIGIPATH_USER="$RUN_USER" \
  bash "$DEST/scripts/pi-install-all.sh"

echo "[DigiPath] Done."
echo "  Dest:    $DEST"
echo "  Env:     $DEST/.env"
echo "  Service: digipath-ws-scanner"
echo "  Logs:    journalctl -u digipath-ws-scanner -f"
