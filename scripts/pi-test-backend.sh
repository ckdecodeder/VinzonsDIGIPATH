#!/usr/bin/env bash
# Test if THIS Pi can reach the backend (not just the laptop locally).
# Usage: bash scripts/pi-test-backend.sh

set -eu

ENV_FILE="/etc/digipath-scanner.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$(dirname "$0")/../bridge.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$HOME/Desktop/VinzonsDIGIPATH-Pi/bridge.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

BACKEND_URL="${DIGIPATH_BACKEND_BASE_URL:-}"
DEVICE_KEY="${DIGIPATH_DEVICE_API_KEY:-dev-device-key-change-me}"
DEVICE_ID="${DIGIPATH_DEVICE_ID:-DEV-001}"

if [ -z "$BACKEND_URL" ]; then
  echo "ERROR: DIGIPATH_BACKEND_BASE_URL not set in $ENV_FILE"
  exit 1
fi

ROOT="${BACKEND_URL%/api}"

echo "=== Pi backend reachability test ==="
echo "Backend API: $BACKEND_URL"
echo "Device ID:   $DEVICE_ID"
echo ""

echo "[1/3] GET $ROOT/api/status"
if curl -fsS --max-time 15 "$ROOT/api/status"; then
  echo ""
  echo "OK: backend status reachable from Pi"
else
  echo ""
  echo "FAIL: Pi cannot reach backend status endpoint"
  echo "Tip: if laptop+Pi are on same WiFi, try LAN URL instead of dev tunnel:"
  echo "  DIGIPATH_BACKEND_BASE_URL=http://192.168.254.126:5000/api"
  exit 1
fi

echo ""
echo "[2/3] POST $BACKEND_URL/devices/heartbeat"
RESPONSE="$(curl -fsS --max-time 15 -X POST "$BACKEND_URL/devices/heartbeat" \
  -H "Content-Type: application/json" \
  -H "x-device-key: $DEVICE_KEY" \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"ip\":\"$(hostname -I | awk '{print $1}')\",\"bridgeUrl\":\"http://$(hostname -I | awk '{print $1}'):8080\"}")"
echo "$RESPONSE"
echo "OK: heartbeat accepted by backend from Pi"

echo ""
echo "[3/3] Local bridge status"
curl -fsS --max-time 5 "http://127.0.0.1:8080/status" | head -c 400 || echo "WARN: local bridge /status not reachable"
echo ""
echo ""
echo "If all OK, Device Management should show Connected within ~30s (refresh dashboard)."
