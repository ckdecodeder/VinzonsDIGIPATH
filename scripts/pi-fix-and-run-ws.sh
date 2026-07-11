#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

echo "[PiWS] Root: $ROOT_DIR"

if [[ -d "$ROOT_DIR/.venv" && ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "[PiWS] Removing broken .venv (never copy .venv from Windows/USB)..."
  rm -rf "$ROOT_DIR/.venv"
fi

echo "[PiWS] Cleaning broken user-level numpy/opencv packages..."

python3 -m pip uninstall -y numpy opencv-python opencv-python-headless 2>/dev/null || true
for pyver in 3.11 3.12 3.13; do
  rm -rf "$HOME/.local/lib/python${pyver}/site-packages/numpy"* 2>/dev/null || true
  rm -rf "$HOME/.local/lib/python${pyver}/site-packages/opencv"* 2>/dev/null || true
done

if [[ -d "$ROOT_DIR/.venv" ]]; then
  find "$ROOT_DIR/.venv/lib" -maxdepth 3 -type d \( -name 'numpy*' -o -name 'opencv*' -o -name 'cv2*' \) -exec rm -rf {} + 2>/dev/null || true
fi

if [[ ! -f "$ROOT_DIR/scripts/pi-run-all-ws.sh" && ! -f "$ROOT_DIR/pi-run-all-ws.sh" ]]; then
  echo "[PiWS] ERROR: pi-run-all-ws.sh not found under $ROOT_DIR"
  exit 1
fi

echo "[PiWS] Running WS scanner bootstrap..."
if [[ -f "$ROOT_DIR/scripts/pi-run-all-ws.sh" ]]; then
  exec bash "$ROOT_DIR/scripts/pi-run-all-ws.sh"
else
  exec bash "$ROOT_DIR/pi-run-all-ws.sh"
fi
