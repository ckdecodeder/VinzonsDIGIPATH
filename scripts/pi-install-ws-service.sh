#!/usr/bin/env bash
# Install systemd service for pi_ws_scanner.py (Desktop package).
# Usage: sudo bash scripts/pi-install-ws-service.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

RUN_USER="${SUDO_USER:-${DIGIPATH_USER:-digipathberry}}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"
SERVICE_FILE="/etc/systemd/system/digipath-ws-scanner.service"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  echo "ERROR: $DEST/pi_ws_scanner.py not found."
  echo "Copy VinzonsDIGIPATH-Pi to Desktop first."
  exit 1
fi

echo "[PiWS] Installing service for user=$RUN_USER dest=$DEST"

bash "$ROOT_DIR/scripts/pi-bootstrap-ws.sh"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=DigiPath WebSocket Scanner Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${DEST}
EnvironmentFile=-${DEST}/.env
ExecStartPre=/bin/bash ${DEST}/scripts/pi-bootstrap-ws.sh
ExecStart=${DEST}/.venv/bin/python ${DEST}/pi_ws_scanner.py
Restart=always
RestartSec=5
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable digipath-ws-scanner.service
systemctl restart digipath-ws-scanner.service

if [[ -f "$ROOT_DIR/scripts/pi-install-usb-hook.sh" ]]; then
  bash "$ROOT_DIR/scripts/pi-install-usb-hook.sh"
fi

echo "[PiWS] Service installed and started."
echo "[PiWS] Watch live logs:  journalctl -u digipath-ws-scanner -f"
echo "[PiWS] Or manual terminal: cd $DEST && bash pi-fix-and-run-ws.sh"
systemctl --no-pager status digipath-ws-scanner.service || true
