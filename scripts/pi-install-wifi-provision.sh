#!/usr/bin/env bash
# Install auto WiFi hotspot + captive portal for first-time Pi setup.
# Usage: sudo bash scripts/pi-install-wifi-provision.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=pi-install-lib.sh
source "$SCRIPT_DIR/pi-install-lib.sh"

RUN_USER="$(pi_detect_run_user "")"
DEST="$(pi_detect_dest "$RUN_USER" || true)"
if [[ -z "$DEST" ]]; then
  USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"
fi
RUN_USER="$(pi_detect_run_user "$DEST")"

SERVICE_FILE="/etc/systemd/system/digipath-wifi-provision.service"
DISPATCHER_FILE="/etc/NetworkManager/dispatcher.d/98-digipath-wifi-provision"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

echo "[wifi-provision] Installing for user=$RUN_USER dest=$DEST"

PROVISION_PY=""
for candidate in "$ROOT_DIR/pi_wifi_provision.py" "$DEST/pi_wifi_provision.py"; do
  if [[ -f "$candidate" ]]; then
    PROVISION_PY="$candidate"
    break
  fi
done

if [[ -z "$PROVISION_PY" ]]; then
  echo "ERROR: pi_wifi_provision.py not found."
  echo "Copy the latest VinzonsDIGIPATH-Pi from USB to Desktop first."
  echo "Expected: $DEST/pi_wifi_provision.py"
  exit 1
fi

if command -v nmcli >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  echo "[wifi-provision] nmcli and python3 OK — skipping apt (works offline)."
else
  echo "[wifi-provision] Installing network-manager / python3 (needs internet if missing)..."
  apt-get update || echo "[wifi-provision] WARN: apt-get update failed — continuing anyway."
  apt-get install -y network-manager python3 || {
    echo "[wifi-provision] WARN: apt install failed. Ensure nmcli and python3 exist, then rerun."
  }
fi

if ! command -v nmcli >/dev/null 2>&1; then
  echo "ERROR: nmcli not found. Run: sudo apt install network-manager"
  exit 1
fi

mkdir -p "$DEST/scripts"

install_file() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing $src"
    exit 1
  fi
  if [[ "$(readlink -f "$src")" == "$(readlink -f "$dst")" ]]; then
    chmod 755 "$dst"
  else
    install -m 755 "$src" "$dst"
  fi
}

install_file "$PROVISION_PY" "$DEST/pi_wifi_provision.py"
if [[ -f "$ROOT_DIR/scripts/pi-wifi-provision.sh" ]]; then
  install_file "$ROOT_DIR/scripts/pi-wifi-provision.sh" "$DEST/scripts/pi-wifi-provision.sh"
elif [[ -f "$DEST/scripts/pi-wifi-provision.sh" ]]; then
  chmod 755 "$DEST/scripts/pi-wifi-provision.sh"
else
  echo "ERROR: pi-wifi-provision.sh not found."
  exit 1
fi
if [[ -f "$ROOT_DIR/scripts/pi-load-env.sh" ]]; then
  install_file "$ROOT_DIR/scripts/pi-load-env.sh" "$DEST/scripts/pi-load-env.sh"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=DigiPath WiFi hotspot setup portal
After=NetworkManager.service
Before=network-online.target digipath-ws-scanner.service digipath-scanner.service
Wants=NetworkManager.service

[Service]
Type=simple
Restart=on-failure
RestartSec=15
EnvironmentFile=-$DEST/.env
EnvironmentFile=-/etc/digipath-scanner.env
ExecStart=/bin/bash $DEST/scripts/pi-wifi-provision.sh
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$(dirname "$DISPATCHER_FILE")"
cat > "$DISPATCHER_FILE" <<'DISPATCHER'
#!/bin/bash
IFACE="${1:-}"
ACTION="${2:-}"

case "$ACTION" in
  down) ;;
  *) exit 0 ;;
esac

case "$IFACE" in
  wlan*|wl*) ;;
  *) exit 0 ;;
esac

if [[ -f /run/digipath-wifi-provisioning.lock ]]; then
  exit 0
fi

if nmcli -t -f NAME,TYPE connection show --active 2>/dev/null | grep -q "802-11-wireless"; then
  active_name="$(nmcli -t -f NAME,TYPE connection show --active 2>/dev/null | awk -F: '$2=="802-11-wireless"{print $1; exit}')"
  if [[ -n "$active_name" && "$active_name" != "digipath-setup" ]]; then
    exit 0
  fi
fi

if systemctl is-enabled digipath-wifi-provision.service >/dev/null 2>&1; then
  systemctl restart digipath-wifi-provision.service >/dev/null 2>&1 || true
fi
DISPATCHER
chmod 755 "$DISPATCHER_FILE"

systemctl daemon-reload
systemctl enable digipath-wifi-provision.service
systemctl start digipath-wifi-provision.service || true

echo "[wifi-provision] Installed: $SERVICE_FILE"
systemctl --no-pager status digipath-wifi-provision.service || true
echo "[wifi-provision] Phone: join DigiPath-Setup → http://10.42.0.1"
