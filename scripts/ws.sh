#!/usr/bin/env bash
# Install deps + start JPEG-over-WS scanner (one command).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

echo "[PiWS] Root: $ROOT_DIR"

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/pi_ws_scanner.env.example" ]]; then
  cp "$ROOT_DIR/pi_ws_scanner.env.example" "$ROOT_DIR/.env"
  echo "[PiWS] Created .env — edit DIGIPATH_BACKEND_BASE_URL and DIGIPATH_DEVICE_API_KEY"
  exit 1
fi

if [[ -d "$ROOT_DIR/.venv" && ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  rm -rf "$ROOT_DIR/.venv"
fi

bash "$ROOT_DIR/scripts/pi-bootstrap-ws.sh"

PY="$ROOT_DIR/.venv/bin/python"
if ! "$PY" -c "import cv2, websocket" 2>/dev/null; then
  echo "[PiWS] FATAL: missing cv2 or websocket-client"
  exit 1
fi

echo "[PiWS] Starting scanner (JPEG preview over WebSocket)..."
exec bash "$ROOT_DIR/scripts/pi-run-ws-scanner.sh"
