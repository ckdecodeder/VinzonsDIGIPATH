#!/usr/bin/env bash
# Run on the Raspberry Pi — syncs any-network backend URL from laptop (npm run network:sync).
# Usage: sudo bash scripts/pi-update-network.sh

set -eu

BACKEND_URL="https://zt0pntkq-5000.asse.devtunnels.ms/api"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/pi-load-env.sh"
PRIVATE_CONFIG=""
for candidate in "$REPO_ROOT/.env" "$REPO_ROOT/pi_ws_scanner.env" "$REPO_ROOT/bridge.env" /etc/digipath-scanner.env; do
  if [ -f "$candidate" ]; then PRIVATE_CONFIG="$candidate"; break; fi
done
[ -n "$PRIVATE_CONFIG" ] || { echo "Missing private scanner configuration." >&2; exit 1; }
pi_load_env "$PRIVATE_CONFIG"
DIGIPATH_DEVICE_API_KEY="${DIGIPATH_DEVICE_API_KEY:-}"
case "${DIGIPATH_DEVICE_API_KEY:-}" in
  dev-*|change_this*|replace_with*) echo "Configure a strong private scanner key first." >&2; exit 1 ;;
esac
[ "${#DIGIPATH_DEVICE_API_KEY}" -ge 32 ] || { echo "Configure a strong private scanner key first." >&2; exit 1; }

update_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  touch "$file"
  if grep -q '^DIGIPATH_BACKEND_BASE_URL=' "$file"; then
    sed -i "s|^DIGIPATH_BACKEND_BASE_URL=.*|DIGIPATH_BACKEND_BASE_URL=${BACKEND_URL}|" "$file"
  else
    echo "DIGIPATH_BACKEND_BASE_URL=${BACKEND_URL}" >> "$file"
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

chmod +x "$REPO_ROOT/scripts/pi-test-backend.sh" 2>/dev/null || true

if systemctl is-enabled digipath-scanner >/dev/null 2>&1; then
  sudo systemctl restart digipath-scanner
  echo "Restarted digipath-scanner service."
else
  echo "No systemd service. Restart pi_scanner_bridge.py manually."
fi

echo ""
echo "Backend:       ${BACKEND_URL}"
echo "WebSocket:     wss://46hdfmgm-5000.asse.devtunnels.ms/ws/device"
echo "MJPEG HTTP:    disabled"
echo "Check status:  curl http://127.0.0.1:8080/status"
