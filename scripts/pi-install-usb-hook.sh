#!/usr/bin/env bash
# Install udev hook: when USB storage is plugged in, auto-copy package to Desktop and restart.
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

cat > "$UDEV_RULE" <<EOF
# DigiPath: auto-update from USB when a removable partition is plugged in.
# Runs as root so the drive can be unmounted/ejected after copy.
ACTION=="add", SUBSYSTEM=="block", ENV{ID_BUS}=="usb", ENV{DEVTYPE}=="partition", \\
  RUN+="/bin/systemd-run --collect ${UPDATE_BIN}"
EOF

udevadm control --reload-rules
udevadm trigger

echo "Installed USB auto-update:"
echo "  Script: $UPDATE_BIN"
echo "  udev:   $UDEV_RULE"
echo "Plug in USB with VinzonsDIGIPATH-Pi — it copies to ~/Desktop, restarts the scanner, then ejects the USB."
