#!/usr/bin/env bash
# Install everything: boot auto-start, WiFi hotspot setup, USB auto-update.
# Usage: sudo bash scripts/pi-install-all.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_USER="${SUDO_USER:-${DIGIPATH_USER:-digipathberry}}"
DEST="${DIGIPATH_WS_DIR:-$ROOT_DIR}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  DEST="${USER_HOME}/Desktop/VinzonsDIGIPATH-Pi"
fi

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  echo "ERROR: pi_ws_scanner.py not found in $DEST"
  echo "Copy VinzonsDIGIPATH-Pi to Desktop first."
  exit 1
fi

echo "[DigiPath] Installing all services from $DEST"

if [[ -f "$DEST/fix-pi-scripts.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/fix-pi-scripts.sh"
fi

DIGIPATH_WS_DIR="$DEST" DIGIPATH_USER="$RUN_USER" \
  bash "$DEST/scripts/pi-install-ws-service.sh"

echo ""
echo "[DigiPath] Service summary:"
for unit in digipath-wifi-provision digipath-ws-scanner; do
  if systemctl list-unit-files "${unit}.service" >/dev/null 2>&1; then
    printf "  %-28s enabled=%s active=%s\n" \
      "${unit}.service" \
      "$(systemctl is-enabled "${unit}.service" 2>/dev/null || echo unknown)" \
      "$(systemctl is-active "${unit}.service" 2>/dev/null || echo unknown)"
  else
    printf "  %-28s NOT INSTALLED\n" "${unit}.service"
  fi
done

if [[ -x /usr/local/bin/digipath-usb-update ]]; then
  echo "  USB auto-update hook         installed"
else
  echo "  USB auto-update hook         NOT INSTALLED"
fi

if pgrep -af pi_ws_scanner.py >/dev/null 2>&1; then
  echo "  Scanner process              running"
else
  echo "  Scanner process              stopped"
fi

echo ""
echo "[DigiPath] Done. Reboot test: sudo reboot"
echo "[DigiPath] Phone status page: join DigiPath-Setup → http://10.42.0.1"
