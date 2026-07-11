#!/usr/bin/env bash
# Python 3.13 removed stdlib audioop; aiortc needs it. One-command fix.
# Usage: bash scripts/pi-audioop-fix.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

PY="${ROOT_DIR}/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "[AudioopFix] ERROR: .venv missing — run: bash scripts/pi-bootstrap-ws.sh"
  exit 1
fi

PY_VER="$("$PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
py_minor="${PY_VER##*.}"

if [[ "${PY_VER%%.*}" -ne 3 || "$py_minor" -lt 13 ]]; then
  echo "[AudioopFix] Python $PY_VER — audioop still in stdlib, nothing to do"
  exit 0
fi

if "$PY" -c "import audioop" 2>/dev/null; then
  echo "[AudioopFix] audioop already OK on Python $PY_VER"
else
  echo "[AudioopFix] Installing audioop-lts for Python $PY_VER..."
  "$PY" -m pip install --no-cache-dir --upgrade audioop-lts
  "$PY" -c "import audioop; print('[AudioopFix] audioop OK from', getattr(audioop, '__file__', 'stdlib'))"
fi

if "$PY" -c "import aiortc; print('[AudioopFix] aiortc OK', aiortc.__version__)" 2>/dev/null; then
  echo "[AudioopFix] Done — start: bash scripts/pi-fix-and-run-ws.sh"
else
  echo "[AudioopFix] audioop fixed but aiortc still missing — run: bash scripts/pi-install-webrtc.sh"
  exit 1
fi
