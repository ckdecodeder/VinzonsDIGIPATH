#!/usr/bin/env bash
# Install WiFi/IP change hook: restart digipath-scanner when wlan gets a new address.
# Usage: sudo bash scripts/pi-install-network-hook.sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-digipathberry}"
DISPATCHER_DIR="/etc/NetworkManager/dispatcher.d"
DISPATCHER_FILE="$DISPATCHER_DIR/99-digipath-wifi-restart"
SUDOERS_FILE="/etc/sudoers.d/digipath-scanner-restart"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

mkdir -p "$DISPATCHER_DIR"

cat > "$DISPATCHER_FILE" <<'DISPATCHER'
#!/bin/bash
# Restart scanner bridge after WiFi reconnect or DHCP IP change.
IFACE="${1:-}"
ACTION="${2:-}"

case "$ACTION" in
  up|dhcp4-change|connectivity-change) ;;
  *) exit 0 ;;
esac

case "$IFACE" in
  wlan*|wl*) ;;
  *) exit 0 ;;
esac

LOCK="/run/digipath-network-restart.lock"
if [[ -f "$LOCK" ]]; then
  exit 0
fi

touch "$LOCK"
logger -t digipath "Network ${ACTION} on ${IFACE}; restarting digipath-scanner in 8s"
(
  sleep 8
  systemctl restart digipath-scanner.service
  rm -f "$LOCK"
) &
DISPATCHER

chmod 755 "$DISPATCHER_FILE"

cat > "$SUDOERS_FILE" <<SUDOERS
# Allow bridge process to restart itself after LAN IP change (WiFi roam / DHCP).
${RUN_USER} ALL=(root) NOPASSWD: /bin/systemctl restart digipath-scanner.service
SUDOERS
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"

echo "Installed NetworkManager hook: $DISPATCHER_FILE"
echo "Installed sudoers rule for: $RUN_USER"
echo "digipath-scanner will auto-restart after WiFi up / new DHCP IP."
