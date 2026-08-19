#!/usr/bin/env bash
# Run on the Raspberry Pi — syncs any-network backend URL from laptop (npm run network:sync).
# Usage: sudo bash scripts/pi-update-network.sh

set -eu

BACKEND_URL="http://100.84.77.51:5000/api"
DEVICE_KEY="dev-device-key-change-me"
DEVTUNNEL_TOKEN=""

update_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  touch "$file"
  if grep -q '^DIGIPATH_BACKEND_BASE_URL=' "$file"; then
    sed -i "s|^DIGIPATH_BACKEND_BASE_URL=.*|DIGIPATH_BACKEND_BASE_URL=${BACKEND_URL}|" "$file"
  else
    echo "DIGIPATH_BACKEND_BASE_URL=${BACKEND_URL}" >> "$file"
  fi

  if grep -q '^DIGIPATH_DEVICE_API_KEY=' "$file"; then
    sed -i "s|^DIGIPATH_DEVICE_API_KEY=.*|DIGIPATH_DEVICE_API_KEY=${DEVICE_KEY}|" "$file"
  else
    echo "DIGIPATH_DEVICE_API_KEY=${DEVICE_KEY}" >> "$file"
  fi

  if [ -n "${DEVTUNNEL_TOKEN}" ]; then
    if grep -q '^DIGIPATH_DEVTUNNEL_TOKEN=' "$file"; then
      sed -i "s|^DIGIPATH_DEVTUNNEL_TOKEN=.*|DIGIPATH_DEVTUNNEL_TOKEN=${DEVTUNNEL_TOKEN}|" "$file"
    else
      echo "DIGIPATH_DEVTUNNEL_TOKEN=${DEVTUNNEL_TOKEN}" >> "$file"
    fi
  fi

  if grep -q '^DIGIPATH_USE_WEBSOCKET=' "$file"; then
    sed -i 's|^DIGIPATH_USE_WEBSOCKET=.*|DIGIPATH_USE_WEBSOCKET=1|' "$file"
  else
    echo "DIGIPATH_USE_WEBSOCKET=1" >> "$file"
  fi

  if grep -q '^DIGIPATH_ENABLE_MJPEG_HTTP=' "$file"; then
    sed -i 's|^DIGIPATH_ENABLE_MJPEG_HTTP=.*|DIGIPATH_ENABLE_MJPEG_HTTP=1|' "$file"
  else
    echo "DIGIPATH_ENABLE_MJPEG_HTTP=1" >> "$file"
  fi

  echo "Updated $file"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for candidate in \
  "/etc/digipath-scanner.env" \
  "$HOME/Desktop/VinzonsDIGIPATH-Pi/.env" \
  "$HOME/Desktop/VinzonsDIGIPATH-Pi/bridge.env" \
  "$HOME/VinzonsDIGIPATH-Pi/.env" \
  "$HOME/VinzonsDIGIPATH-Pi/bridge.env" \
  "$REPO_ROOT/.env" \
  "$REPO_ROOT/bridge.env"; do
  update_env_file "$candidate"
done

if [ -f "$REPO_ROOT/pi_scanner_bridge.py" ]; then
  sudo cp "$REPO_ROOT/pi_scanner_bridge.py" /opt/digipath-scanner/pi_scanner_bridge.py 2>/dev/null || true
  sudo cp "$REPO_ROOT/motor_controller.py" /opt/digipath-scanner/motor_controller.py 2>/dev/null || true
  sudo cp "$REPO_ROOT/relay_controller.py" /opt/digipath-scanner/relay_controller.py 2>/dev/null || true
  sudo cp "$REPO_ROOT/install-pi-deps.sh" /opt/digipath-scanner/install-pi-deps.sh 2>/dev/null || true
  if [ -f "$REPO_ROOT/bridge.env" ]; then
    sudo cp "$REPO_ROOT/bridge.env" /etc/digipath-scanner.env 2>/dev/null || true
  fi
fi

chmod +x "$REPO_ROOT/scripts/pi-test-backend.sh" 2>/dev/null || true

if systemctl is-enabled digipath-scanner >/dev/null 2>&1; then
  sudo systemctl restart digipath-scanner
  echo "Restarted digipath-scanner service."
else
  echo "No systemd service. Restart pi_scanner_bridge.py manually."
fi

echo ""
echo "Backend:       ${BACKEND_URL}"
echo "WebSocket:     wss://5s7bbf2l-5000.asse.devtunnels.ms/ws/device"
echo "MJPEG HTTP:    disabled"
echo "Check status:  curl http://127.0.0.1:8080/status"
