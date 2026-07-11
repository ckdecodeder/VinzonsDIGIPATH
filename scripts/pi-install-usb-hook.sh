#!/usr/bin/env bash
# Install udev hook: when USB storage is plugged in, auto-copy package to Desktop and eject.
# Usage: sudo bash scripts/pi-install-usb-hook.sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-digipathberry}"
UPDATE_BIN="/usr/local/bin/digipath-usb-update"
UDEV_RULE="/etc/udev/rules.d/99-digipath-usb-update.rules"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi

install -m 755 "$SCRIPT_DIR/pi-usb-auto-update.sh" "$UPDATE_BIN"
if [[ -f "$SCRIPT_DIR/pi-restart-ws-scanner.sh" ]]; then
  install -m 755 "$SCRIPT_DIR/pi-restart-ws-scanner.sh" /usr/local/bin/digipath-ws-restart
fi

cat > "$UDEV_RULE" <<EOF
# DigiPath: USB plug → copy to Desktop → eject → restart scanner.
ACTION=="add", SUBSYSTEM=="block", ENV{ID_BUS}=="usb", ENV{DEVTYPE}=="partition", \\
  RUN+="/bin/systemd-run --collect --setenv=DIGIPATH_USER=${RUN_USER} ${UPDATE_BIN}"
EOF

udevadm control --reload-rules
udevadm trigger

echo "Installed USB auto-update:"
echo "  Script: $UPDATE_BIN"
echo "  udev:   $UDEV_RULE"
echo "Plug in USB with VinzonsDIGIPATH-Pi — auto: copy → overwrite Desktop → eject → restart scanner."
