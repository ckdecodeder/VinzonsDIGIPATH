#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

# shellcheck source=pi-apt-lib.sh
source "$SCRIPT_DIR/pi-apt-lib.sh"

echo "[PiFix] Root: $ROOT_DIR"

pi_apt_stop_background_apt PiFix

sudo pkill -f pi_ws_scanner.py 2>/dev/null || true
sudo chown -R "$USER:$USER" "$ROOT_DIR"

if [[ -d "$ROOT_DIR/.venv" || -d "$ROOT_DIR/venv" ]]; then
  sudo rm -rf "$ROOT_DIR/.venv" "$ROOT_DIR/venv" 2>/dev/null || true
  sudo find "$ROOT_DIR/.venv" -depth -delete 2>/dev/null || true
  sudo find "$ROOT_DIR/venv" -depth -delete 2>/dev/null || true
  sudo rm -rf "$ROOT_DIR/.venv" "$ROOT_DIR/venv"
fi

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/pi_ws_scanner.env.example" ]]; then
  cp "$ROOT_DIR/pi_ws_scanner.env.example" "$ROOT_DIR/.env"
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
  grep -q '^DIGIPATH_CAMERA_INDEX=' "$ROOT_DIR/.env" || echo 'DIGIPATH_CAMERA_INDEX=0' >>"$ROOT_DIR/.env"
  grep -q '^DIGIPATH_USE_PICAMERA2=' "$ROOT_DIR/.env" || echo 'DIGIPATH_USE_PICAMERA2=off' >>"$ROOT_DIR/.env"
  grep -q '^DIGIPATH_STREAM_WIDTH=' "$ROOT_DIR/.env" || echo 'DIGIPATH_STREAM_WIDTH=1280' >>"$ROOT_DIR/.env"
  grep -q '^DIGIPATH_STREAM_HEIGHT=' "$ROOT_DIR/.env" || echo 'DIGIPATH_STREAM_HEIGHT=720' >>"$ROOT_DIR/.env"
  for kv in \
    'DIGIPATH_PREVIEW_WIDTH=640' \
    'DIGIPATH_PREVIEW_HEIGHT=360' \
    'DIGIPATH_WEBRTC_WIDTH=640' \
    'DIGIPATH_WEBRTC_HEIGHT=360'; do
    key="${kv%%=*}"
    if grep -q "^${key}=" "$ROOT_DIR/.env"; then
      sed -i "s/^${key}=.*/${kv}/" "$ROOT_DIR/.env"
    else
      echo "$kv" >>"$ROOT_DIR/.env"
    fi
  done
fi

bash "$ROOT_DIR/scripts/pi-bootstrap-ws.sh"

PY="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "[PiFix] ERROR: .venv/bin/python missing after bootstrap"
  exit 1
fi

PY_VER="$("$PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "${PY_VER%%.*}" -eq 3 && "${PY_VER##*.}" -ge 13 ]]; then
  if ! "$PY" -c "import audioop" 2>/dev/null; then
    echo "[PiFix] Python $PY_VER — installing audioop-lts before aiortc..."
    "$PY" -m pip install --no-cache-dir --upgrade audioop-lts || true
  fi
fi

if ! "$PY" -c "import aiortc" 2>/dev/null; then
  echo "[PiFix] aiortc missing — running pi-install-webrtc.sh..."
  bash "$ROOT_DIR/scripts/pi-install-webrtc.sh"
fi

if ! grep -q 'include-system-site-packages = true' "$ROOT_DIR/.venv/pyvenv.cfg"; then
  echo "[PiFix] ERROR: .venv missing system-site-packages"
  exit 1
fi

"$PY" -c "import av; print('[PiFix] av', av.__version__, av.__file__)"
"$PY" -c "import aiortc; print('[PiFix] aiortc', aiortc.__version__)"
"$PY" -c "import OpenSSL; print('[PiFix] pyOpenSSL', OpenSSL.__version__)"
"$PY" -c "import av, aiortc, OpenSSL; print('[PiFix] ALL OK')"

echo "[PiFix] Done. Start: bash scripts/pi-fix-and-run-ws.sh"
