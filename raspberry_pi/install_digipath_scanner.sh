#!/usr/bin/env bash
set -eu

TARGET_DIR="/opt/digipath-scanner"
ENV_FILE="/etc/digipath-scanner.env"
SERVICE_FILE="/etc/systemd/system/digipath-scanner.service"
DEVICE_ID="DEV-001"
OFFICE_ID="OFF-001"
STREAM_PORT="8080"
BACKEND_BASE_URL="${DIGIPATH_BACKEND_BASE_URL:-}"
DEVICE_API_KEY="${DIGIPATH_DEVICE_API_KEY:-}"
WIFI_SSID=""
WIFI_PASSWORD=""

usage() {
  cat <<'USAGE'
Usage:
  sudo bash install_digipath_scanner.sh --backend-url http://COMPUTER_IP:5000/api --device-key DEVICE_API_KEY [options]

Options:
  --backend-url URL       Backend API URL reachable from the Pi over WiFi.
  --device-key KEY        Must match DEVICE_API_KEY in backend/.env.
  --device-id ID          Default: DEV-001.
  --office-id ID          Default: OFF-001.
  --stream-port PORT      Local Pi bridge port. Default: 8080.
  --wifi-ssid SSID        Optional WiFi network name to connect through NetworkManager.
  --wifi-password PASS    Optional WiFi password.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-url)
      BACKEND_BASE_URL="${2:-}"
      shift 2
      ;;
    --device-key)
      DEVICE_API_KEY="${2:-}"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --office-id)
      OFFICE_ID="${2:-}"
      shift 2
      ;;
    --stream-port)
      STREAM_PORT="${2:-}"
      shift 2
      ;;
    --wifi-ssid)
      WIFI_SSID="${2:-}"
      shift 2
      ;;
    --wifi-password)
      WIFI_PASSWORD="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$BACKEND_BASE_URL" || -z "$DEVICE_API_KEY" ]]; then
  echo "Missing --backend-url or --device-key." >&2
  usage
  exit 1
fi

if [[ "$BACKEND_BASE_URL" != */api ]]; then
  echo "Backend URL should end with /api, for example http://192.168.100.10:5000/api" >&2
  exit 1
fi

RUN_USER="${SUDO_USER:-$(id -un)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_SOURCE="$REPO_ROOT/pi_scanner_bridge.py"

if [[ ! -f "$BRIDGE_SOURCE" ]]; then
  echo "Cannot find pi_scanner_bridge.py at $BRIDGE_SOURCE" >&2
  exit 1
fi

if [[ -n "$WIFI_SSID" ]]; then
  if command -v nmcli >/dev/null 2>&1; then
    echo "Connecting wlan0 to WiFi network: $WIFI_SSID"
    nmcli dev wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD" ifname wlan0 || true
  else
    echo "nmcli is not installed. Skipping WiFi configuration; make sure the Pi is already on the same WiFi." >&2
  fi
fi

echo "Installing system packages..."
apt-get update
apt-get install -y \
  python3-pip \
  python3-venv \
  python3-requests \
  python3-pil \
  python3-opencv \
  python3-numpy \
  tesseract-ocr \
  libgl1 \
  libglib2.0-0 \
  libavformat-dev \
  libavcodec-dev \
  libavdevice-dev \
  libavutil-dev \
  libavfilter-dev \
  libswscale-dev \
  libswresample-dev \
  pkg-config
apt-get install -y python3-gpiozero || true
apt-get install -y rpicam-apps || apt-get install -y libcamera-apps || true

echo "Installing bridge files..."
mkdir -p "$TARGET_DIR"
cp "$BRIDGE_SOURCE" "$TARGET_DIR/pi_scanner_bridge.py"
if [[ -f "$REPO_ROOT/motor_controller.py" ]]; then
  cp "$REPO_ROOT/motor_controller.py" "$TARGET_DIR/motor_controller.py"
fi
if [[ -f "$REPO_ROOT/relay_controller.py" ]]; then
  cp "$REPO_ROOT/relay_controller.py" "$TARGET_DIR/relay_controller.py"
fi
if [[ -f "$REPO_ROOT/install-pi-deps.sh" ]]; then
  cp "$REPO_ROOT/install-pi-deps.sh" "$TARGET_DIR/install-pi-deps.sh"
  chmod +x "$TARGET_DIR/install-pi-deps.sh"
fi
if [[ -f "$REPO_ROOT/verify-pi-deps.py" ]]; then
  cp "$REPO_ROOT/verify-pi-deps.py" "$TARGET_DIR/verify-pi-deps.py"
fi
if [[ -f "$REPO_ROOT/requirements-pi.txt" ]]; then
  cp "$REPO_ROOT/requirements-pi.txt" "$TARGET_DIR/requirements-pi.txt"
fi
chown -R "$RUN_USER:$RUN_USER" "$TARGET_DIR"

echo "Creating Python environment..."
python3 -m venv --system-site-packages "$TARGET_DIR/.venv"
"$TARGET_DIR/.venv/bin/python" -m pip install --upgrade pip
"$TARGET_DIR/.venv/bin/python" -m pip install requests Pillow pytesseract websocket-client gpiozero
"$TARGET_DIR/.venv/bin/python" - <<'PY'
import importlib.util

optional_modules = {
    "cv2": "OpenCV document auto-cropping",
    "numpy": "OpenCV document auto-cropping",
    "picamera2": "Raspberry Pi camera capture",
}

for module, feature in optional_modules.items():
    if importlib.util.find_spec(module):
        print(f"{module}: available")
    else:
        print(f"{module}: not available; {feature} may be disabled")
PY
chown -R "$RUN_USER:$RUN_USER" "$TARGET_DIR"

echo "Writing $ENV_FILE..."
cat > "$ENV_FILE" <<ENV
DIGIPATH_BACKEND_BASE_URL="$BACKEND_BASE_URL"
DIGIPATH_DEVICE_API_KEY="$DEVICE_API_KEY"
DIGIPATH_DEVICE_ID="$DEVICE_ID"
DIGIPATH_OFFICE_ID="$OFFICE_ID"
DIGIPATH_STREAM_PORT="$STREAM_PORT"
DIGIPATH_STREAM_FPS=30
DIGIPATH_STREAM_WIDTH=640
DIGIPATH_STREAM_HEIGHT=360
DIGIPATH_STREAM_JPEG_QUALITY=82
DIGIPATH_STREAM_FAST=0
DIGIPATH_STREAM_COLOR_MODE=jpeg
DIGIPATH_HEARTBEAT_INTERVAL_SECS=10
DIGIPATH_RESTART_ON_IP_CHANGE=1
DIGIPATH_IP_RESTART_DEBOUNCE_SECS=30
DIGIPATH_AUTO_INSTALL=1
DIGIPATH_USE_WEBSOCKET=1
DIGIPATH_ENABLE_MJPEG_HTTP=0
DIGIPATH_CAMERA_CLI=""
DIGIPATH_ENABLE_OPENCV_CAMERA="auto"
DIGIPATH_OPENCV_CAMERA_INDEX="0"
DIGIPATH_DEVICE_NAME="Physical Document Scanner"
DIGIPATH_DEVICE_LOCATION="Reception Area"
ENV
chmod 600 "$ENV_FILE"

echo "Writing $SERVICE_FILE..."
cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=VinzonsDIGIPATH Raspberry Pi Scanner Bridge
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$TARGET_DIR
EnvironmentFile=$ENV_FILE
Environment=PYTHONNOUSERSITE=1
Environment=PYTHONUNBUFFERED=1
ExecStart=$TARGET_DIR/.venv/bin/python $TARGET_DIR/pi_scanner_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable digipath-scanner.service

HOOK_SCRIPT="$REPO_ROOT/scripts/pi-install-network-hook.sh"
if [[ -f "$HOOK_SCRIPT" ]]; then
  echo "Installing WiFi/IP auto-restart hook..."
  bash "$HOOK_SCRIPT"
fi

systemctl restart digipath-scanner.service

echo
echo "VinzonsDIGIPATH scanner bridge is installed and running."
echo "Backend: $BACKEND_BASE_URL"
echo "Bridge URL for the dashboard: http://$(hostname -I | awk '{print $1}'):$STREAM_PORT"
echo
echo "Check status with:"
echo "  systemctl status digipath-scanner --no-pager"
echo "  journalctl -u digipath-scanner -f"
