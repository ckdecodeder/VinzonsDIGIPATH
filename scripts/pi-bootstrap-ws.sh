#!/usr/bin/env bash
# Minimal deps for pi_ws_scanner.py (USB webcam + JPEG over WebSocket).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

VENV_PY="$ROOT_DIR/.venv/bin/python"

# shellcheck source=pi-venv-lib.sh
source "$SCRIPT_DIR/pi-venv-lib.sh"
# shellcheck source=pi-apt-lib.sh
source "$SCRIPT_DIR/pi-apt-lib.sh"

echo "[PiWS] Bootstrap: $ROOT_DIR"

pi_apt_install_missing PiWS \
  python3 python3-venv python3-pip \
  python3-numpy python3-opencv \
  libgl1 libglib2.0-0 rsync v4l-utils \
  || pi_apt_install_missing PiWS --skip-update \
  python3 python3-venv python3-pip python3-numpy python3-opencv libgl1 rsync v4l-utils

pi_ensure_venv "$ROOT_DIR" "PiWS"

if [[ -d "$ROOT_DIR/.venv/lib" ]]; then
  find "$ROOT_DIR/.venv/lib" -maxdepth 3 -type d \( -name 'numpy*' -o -name 'opencv*' -o -name 'cv2*' \) -exec rm -rf {} + 2>/dev/null || true
fi

"$VENV_PY" -m pip install --upgrade pip
"$VENV_PY" -m pip install --upgrade websocket-client requests

"$VENV_PY" -c "import cv2, websocket; print('[PiWS] OK opencv', cv2.__version__)"

if [[ -f "$ROOT_DIR/scripts/pi-install-usb-hook.sh" ]] && [[ ! -f /etc/udev/rules.d/99-digipath-usb-update.rules ]]; then
  echo "[PiWS] USB auto-update hook (optional, one-time)..."
  sudo bash "$ROOT_DIR/scripts/pi-install-usb-hook.sh" || true
fi

echo "[PiWS] Bootstrap done."
