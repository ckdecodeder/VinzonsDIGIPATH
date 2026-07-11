#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

echo "[PiWS] Root: $ROOT_DIR"

if [[ "${DIGIPATH_FRESH_INSTALL:-0}" == "1" && -f "$ROOT_DIR/scripts/pi-uninstall-all.sh" ]]; then
  echo "[PiWS] Fresh install requested — removing old setup..."
  sudo bash "$ROOT_DIR/scripts/pi-uninstall-all.sh"
fi

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/pi_ws_scanner.env.example" ]]; then
  cp "$ROOT_DIR/pi_ws_scanner.env.example" "$ROOT_DIR/.env"
  echo "[PiWS] Created .env from example. Edit values then rerun."
  exit 1
fi

bash "$ROOT_DIR/scripts/pi-bootstrap-ws.sh"

VENV_PY="$ROOT_DIR/.venv/bin/python"
if ! "$VENV_PY" -c "import cv2, websocket" 2>/dev/null; then
  echo "[PiWS] FATAL: missing cv2 or websocket-client — rerun pi-bootstrap-ws.sh"
  exit 1
fi

echo "[PiWS] Start WebSocket scanner bridge (JPEG preview over WS)"
# shellcheck source=pi-load-env.sh
source "$SCRIPT_DIR/pi-load-env.sh"
pi_load_env "$ROOT_DIR/.env"
exec "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/pi_ws_scanner.py"
