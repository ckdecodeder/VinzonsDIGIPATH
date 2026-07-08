#!/usr/bin/env bash
# Stop duplicate bridge instances and restart ONE clean systemd service.
# Usage: sudo bash scripts/pi-restart-clean.sh

set -eu

PORT="${DIGIPATH_STREAM_PORT:-8080}"

echo "[DigiPath] Stopping duplicate scanner processes..."

systemctl stop digipath-scanner 2>/dev/null || true
pkill -f pi_scanner_bridge.py 2>/dev/null || true
sleep 1

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "[DigiPath] WARNING: port ${PORT} still in use. Try: sudo lsof -i :${PORT}"
else
  echo "[DigiPath] Port ${PORT} is free."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$REPO_ROOT/pi_scanner_bridge.py" ]; then
  cp "$REPO_ROOT/pi_scanner_bridge.py" /opt/digipath-scanner/pi_scanner_bridge.py 2>/dev/null || true
  cp "$REPO_ROOT/motor_controller.py" /opt/digipath-scanner/motor_controller.py 2>/dev/null || true
  cp "$REPO_ROOT/relay_controller.py" /opt/digipath-scanner/relay_controller.py 2>/dev/null || true
fi

echo "[DigiPath] Starting digipath-scanner service..."
systemctl enable digipath-scanner 2>/dev/null || true
systemctl restart digipath-scanner
sleep 2

echo ""
systemctl status digipath-scanner --no-pager || true
echo ""
echo "[DigiPath] Bridge status:"
curl -s "http://127.0.0.1:${PORT}/status" | python3 -m json.tool 2>/dev/null || curl -s "http://127.0.0.1:${PORT}/status" || echo "(no response yet)"
echo ""
echo "Do NOT run 'python3 pi_scanner_bridge.py' manually while systemd is active."
