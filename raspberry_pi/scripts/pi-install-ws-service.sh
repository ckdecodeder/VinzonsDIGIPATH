#!/usr/bin/env bash
# Install systemd service for pi_ws_scanner.py (Desktop package).
# Usage: sudo bash scripts/pi-install-ws-service.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# shellcheck source=pi-install-lib.sh
source "$SCRIPT_DIR/pi-install-lib.sh"

RUN_USER="$(pi_detect_run_user "")"
DEST="$(pi_detect_dest "$RUN_USER" || true)"
if [[ -z "$DEST" ]]; then
  USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"
fi
RUN_USER="$(pi_detect_run_user "$DEST")"
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

# WiFi + USB first so digipath-wifi-provision.service exists before scanner starts.
if [[ -f "$DEST/scripts/pi-install-wifi-provision.sh" ]]; then
  DIGIPATH_WS_DIR="$DEST" DIGIPATH_USER="$RUN_USER" \
    bash "$DEST/scripts/pi-install-wifi-provision.sh"
elif [[ -f "$ROOT_DIR/scripts/pi-install-wifi-provision.sh" ]]; then
  DIGIPATH_WS_DIR="$DEST" DIGIPATH_USER="$RUN_USER" \
    bash "$ROOT_DIR/scripts/pi-install-wifi-provision.sh"
fi

if [[ -f "$DEST/scripts/pi-install-usb-hook.sh" ]]; then
  DIGIPATH_USER="$RUN_USER" bash "$DEST/scripts/pi-install-usb-hook.sh"
elif [[ -f "$ROOT_DIR/scripts/pi-install-usb-hook.sh" ]]; then
  DIGIPATH_USER="$RUN_USER" bash "$ROOT_DIR/scripts/pi-install-usb-hook.sh"
fi

bash "$DEST/scripts/pi-bootstrap-ws.sh"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=DigiPath WebSocket Scanner Bridge
After=network-online.target digipath-wifi-provision.service
Wants=network-online.target digipath-wifi-provision.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${DEST}
# Do NOT rely on EnvironmentFile alone (.env JSON / UTF-8 BOM can make systemd skip it).
# pi-run-ws-scanner.sh loads .env the same way as test-motors.sh.
ExecStartPre=/bin/bash ${DEST}/scripts/pi-bootstrap-ws.sh
ExecStart=/bin/bash ${DEST}/scripts/pi-run-ws-scanner.sh
Restart=always
RestartSec=5
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable digipath-ws-scanner.service
systemctl restart digipath-ws-scanner.service

echo "[PiWS] Service installed and started."
echo "[PiWS] Watch live logs:  journalctl -u digipath-ws-scanner -f"
systemctl --no-pager status digipath-wifi-provision.service || true
systemctl --no-pager status digipath-ws-scanner.service || true
