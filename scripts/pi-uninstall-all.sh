#!/usr/bin/env bash
set -euo pipefail

echo "[DigiPath] Removing scanner bridge/services/hooks..."

# Stop/disable legacy services if present.
sudo systemctl stop digipath-scanner 2>/dev/null || true
sudo systemctl disable digipath-scanner 2>/dev/null || true
sudo rm -f /etc/systemd/system/digipath-scanner.service
sudo rm -f /lib/systemd/system/digipath-scanner.service
sudo systemctl daemon-reload
sudo systemctl reset-failed

# Kill running scanner processes.
pkill -f pi_scanner_bridge.py 2>/dev/null || true
pkill -f pi_ws_scanner.py 2>/dev/null || true

# Remove installed directories and copied packages (full uninstall only).
if [[ "${DIGIPATH_FULL_UNINSTALL:-1}" == "1" ]]; then
  sudo rm -rf /opt/digipath-scanner
  rm -rf "$HOME/VinzonsDIGIPATH-Pi"
  rm -rf "$HOME/Desktop/VinzonsDIGIPATH-Pi"
fi

# Stop WiFi provision service if present.
sudo systemctl stop digipath-wifi-provision 2>/dev/null || true
sudo systemctl disable digipath-wifi-provision 2>/dev/null || true
sudo rm -f /etc/systemd/system/digipath-wifi-provision.service
sudo rm -f /etc/NetworkManager/dispatcher.d/98-digipath-wifi-provision
sudo rm -f /run/digipath-wifi-provisioning.lock

# Stop WS scanner service if present.
sudo systemctl stop digipath-ws-scanner 2>/dev/null || true
sudo systemctl disable digipath-ws-scanner 2>/dev/null || true
sudo rm -f /etc/systemd/system/digipath-ws-scanner.service
sudo systemctl daemon-reload

# Remove env/config leftovers.
sudo rm -f /etc/digipath-scanner.env
rm -f "$HOME/.config/digipath-scanner.env"

# Remove optional USB/network hooks.
sudo rm -f /usr/local/bin/digipath-usb-update
sudo rm -f /usr/local/bin/digipath-ws-restart
sudo rm -f /etc/udev/rules.d/99-digipath-usb-update.rules
sudo rm -f /etc/NetworkManager/dispatcher.d/99-digipath-restart
sudo udevadm control --reload-rules || true
sudo udevadm trigger || true

echo "[DigiPath] Uninstall complete."
echo "[DigiPath] Verify:"
echo "  systemctl status digipath-scanner"
echo "  ls /opt/digipath-scanner"
