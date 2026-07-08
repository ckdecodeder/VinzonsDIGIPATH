#!/usr/bin/env bash
# Install all Python + system packages for pi_scanner_bridge.py on Raspberry Pi.
# Usage: sudo bash install-pi-deps.sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash install-pi-deps.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${DIGIPATH_INSTALL_DIR:-/opt/digipath-scanner}"
RUN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"

APT_CORE=(
  python3
  python3-pip
  python3-venv
  python3-dev
  python3-requests
  python3-pil
  python3-opencv
  python3-numpy
  python3-gpiozero
  tesseract-ocr
  libgl1
  libglib2.0-0
  libgomp1
  libatlas-base-dev
)

APT_CAMERA=(
  python3-picamera2
  rpicam-apps
  libcamera-apps
)

APT_CODEC=(
  libavformat-dev
  libavcodec-dev
  libavdevice-dev
  libavutil-dev
  libavfilter-dev
  libswscale-dev
  libswresample-dev
  pkg-config
)

PIP_PACKAGES=(
  requests
  Pillow
  pytesseract
  websocket-client
)

echo "[DigiPath] Updating apt..."
apt-get update

echo "[DigiPath] Installing core packages..."
apt-get install -y "${APT_CORE[@]}"

echo "[DigiPath] Installing camera packages (optional on some Pi images)..."
apt-get install -y "${APT_CAMERA[@]}" || true

echo "[DigiPath] Installing codec/build helpers (optional)..."
apt-get install -y "${APT_CODEC[@]}" || true

if [ -f "$SCRIPT_DIR/pi_scanner_bridge.py" ]; then
  echo "[DigiPath] Syncing bridge files to $TARGET_DIR..."
  mkdir -p "$TARGET_DIR"
  cp "$SCRIPT_DIR/pi_scanner_bridge.py" "$TARGET_DIR/pi_scanner_bridge.py"
  cp "$SCRIPT_DIR/motor_controller.py" "$TARGET_DIR/motor_controller.py" 2>/dev/null || true
  cp "$SCRIPT_DIR/relay_controller.py" "$TARGET_DIR/relay_controller.py" 2>/dev/null || true
  cp "$SCRIPT_DIR/install-pi-deps.sh" "$TARGET_DIR/install-pi-deps.sh"
  if [ -f "$SCRIPT_DIR/requirements-pi.txt" ]; then
    cp "$SCRIPT_DIR/requirements-pi.txt" "$TARGET_DIR/requirements-pi.txt"
  fi
  if [ -f "$SCRIPT_DIR/verify-pi-deps.py" ]; then
    cp "$SCRIPT_DIR/verify-pi-deps.py" "$TARGET_DIR/verify-pi-deps.py"
  fi
  chown -R "$RUN_USER:$RUN_USER" "$TARGET_DIR"
fi

install_pip_packages() {
  local python_bin="$1"
  echo "[DigiPath] Installing pip packages with $python_bin ..."
  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install --upgrade "${PIP_PACKAGES[@]}"
}

echo "[DigiPath] Installing system-wide pip packages..."
if ! install_pip_packages python3 2>/dev/null; then
  python3 -m pip install --upgrade pip --break-system-packages
  python3 -m pip install --upgrade "${PIP_PACKAGES[@]}" --break-system-packages
fi

if [ -d "$TARGET_DIR" ]; then
  echo "[DigiPath] Creating/updating venv at $TARGET_DIR/.venv ..."
  python3 -m venv --system-site-packages "$TARGET_DIR/.venv"
  install_pip_packages "$TARGET_DIR/.venv/bin/python" || true
  chown -R "$RUN_USER:$RUN_USER" "$TARGET_DIR"
fi

echo "[DigiPath] Verifying modules..."
VERIFY_PY="$SCRIPT_DIR/verify-pi-deps.py"
if [ ! -f "$VERIFY_PY" ] && [ -f "$TARGET_DIR/verify-pi-deps.py" ]; then
  VERIFY_PY="$TARGET_DIR/verify-pi-deps.py"
fi

if [ -f "$VERIFY_PY" ]; then
  python3 "$VERIFY_PY" || true
  if [ -x "$TARGET_DIR/.venv/bin/python" ]; then
    "$TARGET_DIR/.venv/bin/python" "$VERIFY_PY" || true
  fi
else
  python3 - <<'PY'
mods = ["requests", "PIL", "pytesseract", "websocket", "numpy", "cv2"]
for name in mods:
    try:
        __import__(name)
        print(f"OK  {name}")
    except Exception as err:
        print(f"MISS {name}: {err}")
try:
    from picamera2 import Picamera2
    print("OK  picamera2")
except Exception as err:
    print(f"WARN picamera2: {err}")
PY
fi

echo
echo "[DigiPath] Done."
echo "Manual run:  cd $SCRIPT_DIR && python3 pi_scanner_bridge.py"
echo "Verify only: python3 $SCRIPT_DIR/verify-pi-deps.py"
echo "Full install: sudo bash raspberry_pi/install_digipath_scanner.sh --backend-url <URL>/api --device-key <KEY>"
