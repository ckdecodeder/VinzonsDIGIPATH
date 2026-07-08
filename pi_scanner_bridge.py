"""
VinzonsDIGIPATH - Raspberry Pi Scanner Bridge
=============================================
This script runs on the Raspberry Pi 3B and provides:
1. WebSocket camera stream relay to the backend (primary preview path)
2. Local bridge HTTP API on port 8080 (/status, /connect, /snapshot.jpg)
3. Command handling and background upload to the backend
4. Automatic device connection and heartbeat reporting

Install requirements:
  sudo bash install-pi-deps.sh

Configuration (pick one):
  1. Create bridge.env next to this script (easiest for Geany / double-click runs)
  2. Export environment variables in the terminal
  3. Use install_digipath_scanner.sh (writes /etc/digipath-scanner.env + systemd)

See bridge.env.example for the settings to copy.
Set DIGIPATH_AUTO_INSTALL=0 to skip automatic dependency install on startup.
Set DIGIPATH_ENABLE_MJPEG_HTTP=1 only if you still want /stream.mjpg locally.
"""

import importlib
import importlib.util
import os
import shutil
import sys
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

PIP_PACKAGES = (
    ("requests", "requests"),
    ("PIL", "Pillow"),
    ("pytesseract", "pytesseract"),
    ("websocket", "websocket-client"),
)

APT_PACKAGES = (
    "python3-pip",
    "python3-venv",
    "python3-requests",
    "python3-pil",
    "python3-opencv",
    "python3-numpy",
    "python3-picamera2",
    "python3-gpiozero",
    "tesseract-ocr",
    "rpicam-apps",
    "libgl1",
    "libglib2.0-0",
)


def _module_available(module_name):
    return importlib.util.find_spec(module_name) is not None


def _run_command(cmd, label):
    print(f"[Setup] {label}...")
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stdout.strip():
            print(result.stdout.strip())
        return True
    except subprocess.CalledProcessError as err:
        detail = (err.stderr or err.stdout or str(err)).strip()
        print(f"[Setup] Failed: {detail or err}")
        return False
    except FileNotFoundError as err:
        print(f"[Setup] Failed: {err}")
        return False


def _is_root():
    return hasattr(os, "geteuid") and os.geteuid() == 0


def _can_passwordless_sudo():
    if not shutil.which("sudo"):
        return False
    try:
        return subprocess.run(
            ["sudo", "-n", "true"],
            capture_output=True,
            text=True,
            timeout=5,
        ).returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def _pip_install(packages):
    if not packages:
        return True
    pip_cmd = [sys.executable, "-m", "pip", "install", "--upgrade", *packages]
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    if sys.platform.startswith("linux") and not in_venv:
        pip_cmd.append("--break-system-packages")
    return _run_command(pip_cmd, f"Installing pip packages: {', '.join(packages)}")


def ensure_dependencies():
    """Install missing Pi packages before camera/stream workers start."""
    if os.environ.get("DIGIPATH_AUTO_INSTALL", "1").strip().lower() in ("0", "false", "no", "off"):
        print("[Setup] Auto-install disabled (DIGIPATH_AUTO_INSTALL=0).")
        return

    missing_pip = [package for module, package in PIP_PACKAGES if not _module_available(module)]
    _pip_install(missing_pip)

    needs_apt = (
        not _module_available("numpy")
        or not _module_available("cv2")
        or not _module_available("picamera2")
        or not _module_available("PIL")
    )
    if not needs_apt:
        return

    local_installer = os.path.join(SCRIPT_DIR, "install-pi-deps.sh")
    can_install_system = _is_root() or _can_passwordless_sudo()

    if os.path.isfile(local_installer) and can_install_system:
        installer_cmd = ["bash", local_installer] if _is_root() else ["sudo", "-n", "bash", local_installer]
        if _run_command(installer_cmd, "Running install-pi-deps.sh"):
            return

    if shutil.which("apt-get") and can_install_system:
        apt_prefix = [] if _is_root() else ["sudo", "-n"]
        if _run_command([*apt_prefix, "apt-get", "update"], "Updating apt package index"):
            _run_command(
                [*apt_prefix, "apt-get", "install", "-y", *APT_PACKAGES],
                "Installing apt packages for camera, numpy, and OpenCV",
            )
        return

    missing_system = []
    if not _module_available("numpy"):
        missing_system.append("python3-numpy")
    if not _module_available("cv2"):
        missing_system.append("python3-opencv")
    if not _module_available("picamera2"):
        missing_system.append("python3-picamera2")
    if not _module_available("PIL"):
        missing_system.append("python3-pil")

    print("[Setup] Missing system packages:", ", ".join(missing_system) or "unknown")
    print("[Setup] Auto-install needs root/sudo. Run once on the Pi:")
    if os.path.isfile(local_installer):
        print(f"        sudo bash {local_installer}")
    else:
        print(f"        sudo apt-get install -y {' '.join(APT_PACKAGES)}")


def load_optional_modules():
    """Import optional modules after dependency install."""
    global OCR_AVAILABLE, CV_AVAILABLE, CAMERA_AVAILABLE, CAMERA_IMPORT_ERROR, WS_AVAILABLE

    try:
        import pytesseract
        from PIL import Image
        globals()["pytesseract"] = pytesseract
        globals()["Image"] = Image
        OCR_AVAILABLE = True
    except ImportError:
        OCR_AVAILABLE = False
        print("WARNING: pytesseract or Pillow not installed. OCR will use dummy text.")

    try:
        import cv2
        import numpy as np
        globals()["cv2"] = cv2
        globals()["np"] = np
        CV_AVAILABLE = True
    except ImportError:
        CV_AVAILABLE = False
        print("WARNING: opencv-python or numpy not installed. Cropping will be disabled.")

    try:
        from picamera2 import Picamera2
        globals()["Picamera2"] = Picamera2
        CAMERA_AVAILABLE = True
        CAMERA_IMPORT_ERROR = ""
    except ImportError as err:
        CAMERA_AVAILABLE = False
        CAMERA_IMPORT_ERROR = str(err)
        print("INFO: picamera2 not available. Camera features will use CLI fallback when possible.")

    try:
        import websocket
        globals()["websocket"] = websocket
        WS_AVAILABLE = True
    except ImportError:
        WS_AVAILABLE = False
        print("INFO: websocket-client not installed. Realtime WebSocket mode will use HTTP fallback.")


import base64
import json
import mimetypes
import sqlite3
import time
import threading
import re
import io
import atexit
import platform
import socket
import tempfile
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import subprocess


def load_local_env():
    """Load bridge.env from the script folder so Geany runs work without export."""
    local_env = os.path.join(SCRIPT_DIR, "bridge.env")
    alt_local_env = os.path.join(SCRIPT_DIR, "digipath-bridge.env")
    system_env = "/etc/digipath-scanner.env"

    def apply_env_file(path, override=False):
        loaded = 0
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if not key:
                    continue
                if override or key not in os.environ:
                    os.environ[key] = value
                    loaded += 1
        return loaded

    for path in (local_env, alt_local_env):
        if not os.path.isfile(path):
            continue
        try:
            count = apply_env_file(path, override=True)
            print(f"[Config] Loaded {count} setting(s) from {path}")
            print(f"[Config] Backend URL: {os.environ.get('DIGIPATH_BACKEND_BASE_URL', '(not set)')}")
            return path
        except OSError as err:
            print(f"[Config] Could not read {path}: {err}")

    if os.path.isfile(system_env):
        try:
            count = apply_env_file(system_env, override=False)
            print(f"[Config] Loaded {count} setting(s) from {system_env}")
            print(f"[Config] Backend URL: {os.environ.get('DIGIPATH_BACKEND_BASE_URL', '(not set)')}")
            return system_env
        except OSError as err:
            print(f"[Config] Could not read {system_env}: {err}")

    print("[Config] No bridge.env found next to this script.")
    return None


OCR_AVAILABLE = False
CV_AVAILABLE = False
CAMERA_AVAILABLE = False
CAMERA_IMPORT_ERROR = ""
WS_AVAILABLE = False

load_local_env()
ensure_dependencies()

from motor_controller import motor_controller

import requests

load_optional_modules()

# ================= CONFIGURATION =================
# Configure these with environment variables on the Raspberry Pi.
BACKEND_BASE_URL = os.environ.get("DIGIPATH_BACKEND_BASE_URL", "http://127.0.0.1:5000/api").rstrip("/")
DEVICE_ID = os.environ.get("DIGIPATH_DEVICE_ID", "DEV-001")
DEVICE_API_KEY = os.environ.get("DIGIPATH_DEVICE_API_KEY", "dev-device-key-change-me")
OFFICE_ID = os.environ.get("DIGIPATH_OFFICE_ID", "OFF-001")
BACKEND_SCAN_URL = f"{BACKEND_BASE_URL}/devices/scans"
COMMAND_API_URL = f"{BACKEND_BASE_URL}/devices/{DEVICE_ID}/commands"
DEVICE_HEADERS = {"x-device-key": DEVICE_API_KEY}
HEARTBEAT_INTERVAL_SECS = int(os.environ.get("DIGIPATH_HEARTBEAT_INTERVAL_SECS", "10"))
DEVICE_NAME = os.environ.get("DIGIPATH_DEVICE_NAME", "Physical Document Scanner")
DEVICE_MODEL = os.environ.get("DIGIPATH_DEVICE_MODEL", "Raspberry Pi Scanner Bridge")
DEVICE_LOCATION = os.environ.get("DIGIPATH_DEVICE_LOCATION", "Reception Area")
BRIDGE_VERSION = "bridge-1.8"
DEVICE_FIRMWARE = os.environ.get("DIGIPATH_DEVICE_FIRMWARE", BRIDGE_VERSION)
DEVICE_SERIAL = os.environ.get("DIGIPATH_DEVICE_SERIAL", socket.gethostname())
LOCAL_DB = "local_scans.db"
SCANS_DIR = "scanned_files"
DUMMY_IMAGE_PATH = "dummy_test.jpg"

# Camera settings
CAMERA_RESOLUTION = (3280, 2464)     # Max resolution for Pi Camera v2 (capture)
STREAM_RESOLUTION = (640, 360)       # Lower resolution = faster live stream
CAMERA_WARMUP_SECS = 1
STREAM_PORT = 8080                   # MJPEG stream port
STREAM_PORT = int(os.environ.get("DIGIPATH_STREAM_PORT", str(STREAM_PORT)))
STREAM_FPS = max(1, min(int(os.environ.get("DIGIPATH_STREAM_FPS", "60")), 120))
STREAM_JPEG_QUALITY = max(40, min(int(os.environ.get("DIGIPATH_STREAM_JPEG_QUALITY", "70")), 95))
_stream_width = int(os.environ.get("DIGIPATH_STREAM_WIDTH", str(STREAM_RESOLUTION[0])))
_stream_height = int(os.environ.get("DIGIPATH_STREAM_HEIGHT", str(STREAM_RESOLUTION[1])))
STREAM_RESOLUTION = (_stream_width, _stream_height)
STREAM_COLOR_MODE = os.environ.get("DIGIPATH_STREAM_COLOR_MODE", "jpeg").strip().lower()


def uses_isp_jpeg_stream():
    """libcamera JPEG encoder applies ISP AWB — avoids blue tint on live preview."""
    return STREAM_COLOR_MODE in ("jpeg", "isp", "native")


STREAM_FAST_PATH = (
    not uses_isp_jpeg_stream()
    and (
        STREAM_FPS >= 24
        or os.environ.get("DIGIPATH_STREAM_FAST", "auto").strip().lower() in ("1", "true", "yes", "on")
    )
)
CAMERA_AWB_MODE = os.environ.get("DIGIPATH_CAMERA_AWB", "auto").strip().lower()
CAMERA_SATURATION = os.environ.get("DIGIPATH_CAMERA_SATURATION", "").strip()
CAMERA_BRIGHTNESS = os.environ.get("DIGIPATH_CAMERA_BRIGHTNESS", "").strip()
CAMERA_COLOUR_GAIN_RED = os.environ.get("DIGIPATH_CAMERA_COLOUR_GAIN_RED", "").strip()
CAMERA_COLOUR_GAIN_BLUE = os.environ.get("DIGIPATH_CAMERA_COLOUR_GAIN_BLUE", "").strip()
OPENCV_CAMERA_INDEX = int(os.environ.get("DIGIPATH_OPENCV_CAMERA_INDEX", "0"))
ENABLE_OPENCV_CAMERA = os.environ.get("DIGIPATH_ENABLE_OPENCV_CAMERA", "auto").lower()
USE_WEBSOCKET = os.environ.get("DIGIPATH_USE_WEBSOCKET", "1").strip().lower() not in ("0", "false", "no", "off")
_mjpeg_default = "1"
ENABLE_MJPEG_HTTP = os.environ.get("DIGIPATH_ENABLE_MJPEG_HTTP", _mjpeg_default).strip().lower() not in ("0", "false", "no", "off")

if not os.path.exists(SCANS_DIR):
    os.makedirs(SCANS_DIR)

# Global camera instance (shared between stream and capture)
camera = None
camera_lock = threading.Lock()
is_capturing = False  # Flag to pause stream during high-res capture
connected_once = False
last_camera_error = CAMERA_IMPORT_ERROR
last_camera_success_at = ""
last_presence_ok = False
last_presence_error = ""
last_presence_at = ""
last_command_error = ""
latest_stream_frame = b""
latest_stream_lock = threading.Lock()
stream_producer_running = False
realtime_ws = None
realtime_ws_lock = threading.Lock()
ws_frame_send_lock = threading.Lock()
ws_connected = False
ws_connected_once = False
_active_command_ids = set()
_active_command_lock = threading.Lock()

# ================= LOCAL DATABASE SETUP =================
def init_db():
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            extracted_text TEXT,
            extracted_title TEXT,
            extracted_date TEXT,
            extracted_sender TEXT,
            status TEXT DEFAULT 'pending',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def upload_scan_to_backend(file_path, text, title, date, sender, command_id=None):
    mime_type = mimetypes.guess_type(file_path)[0] or "image/jpeg"
    with open(file_path, "rb") as scan_file:
        encoded = base64.b64encode(scan_file.read()).decode("ascii")

    payload = {
        "deviceId": DEVICE_ID,
        "officeId": OFFICE_ID,
        "commandId": command_id,
        "subject": title or "Scanned Document",
        "extractedText": text or "",
        "extractedTitle": title or "Scanned Document",
        "extractedDate": date or "",
        "extractedSender": sender or "Scanner Device",
        "attachment": {
            "name": os.path.basename(file_path),
            "type": mime_type,
            "size": os.path.getsize(file_path),
            "dataUrl": f"data:{mime_type};base64,{encoded}",
        },
    }
    response = requests.post(BACKEND_SCAN_URL, json=payload, headers=DEVICE_HEADERS, timeout=45)
    response.raise_for_status()
    return response.json()

# ================= DEVICE PRESENCE / AUTO-CONNECT =================
def get_local_ip():
    """Return the Pi's current LAN IPv4 (refreshed every heartbeat / network check)."""
    def is_lan_ipv4(value):
        if not value or value.startswith("127.") or value.startswith("169.254."):
            return False
        if ":" in value:
            return False
        parts = value.split(".")
        if len(parts) != 4:
            return False
        try:
            return all(0 <= int(part) <= 255 for part in parts)
        except ValueError:
            return False

    try:
        result = subprocess.run(
            ["hostname", "-I"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        for token in result.stdout.split():
            ip_address = token.strip()
            if is_lan_ipv4(ip_address):
                return ip_address
    except Exception:
        pass

    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.settimeout(1)
        probe.connect(("8.8.8.8", 80))
        ip_address = probe.getsockname()[0]
        probe.close()
        if is_lan_ipv4(ip_address):
            return ip_address
    except Exception:
        pass

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip_address = info[4][0]
            if is_lan_ipv4(ip_address):
                return ip_address
    except Exception:
        pass

    return "127.0.0.1"

def get_memory_usage_percent():
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as meminfo:
            values = {}
            for line in meminfo:
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0])
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        return round(((total - available) / total) * 100) if total else 0
    except Exception:
        return 0

def get_device_payload(event_type):
    disk = shutil.disk_usage("/")
    disk_usage = round((disk.used / disk.total) * 100) if disk.total else 0
    load_average = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0
    cpu_usage = min(round((load_average / max(os.cpu_count() or 1, 1)) * 100), 100)

    bridge_url = f"http://{get_local_ip()}:{STREAM_PORT}"
    local_ip = get_local_ip()

    return {
        "deviceId": DEVICE_ID,
        "name": DEVICE_NAME,
        "model": DEVICE_MODEL,
        "type": "Scanner",
        "ip": local_ip,
        "bridgeUrl": bridge_url,
        "location": DEVICE_LOCATION,
        "firmware": DEVICE_FIRMWARE,
        "serialNumber": DEVICE_SERIAL,
        "resolution": f"{CAMERA_RESOLUTION[0]}x{CAMERA_RESOLUTION[1]}",
        "assignedTo": OFFICE_ID,
        "details": f"Scanner bridge reported {event_type}",
        "payload": {
            "host": socket.gethostname(),
            "ip": local_ip,
            "platform": platform.platform(),
            "bridgeVersion": BRIDGE_VERSION,
            "backendBaseUrl": BACKEND_BASE_URL,
            "cameraConfigured": bool(get_camera_backends()),
            "cameraReady": is_camera_ready(),
            "cameraObjectReady": bool(camera),
            "cameraCli": get_camera_cli(),
            "cameraBackends": get_camera_backends(),
            "opencvAvailable": CV_AVAILABLE,
            "opencvCameraIndex": OPENCV_CAMERA_INDEX,
            "cameraError": last_camera_error,
            "lastCameraSuccessAt": last_camera_success_at,
            "bridgeUrl": bridge_url,
            "streamUrl": get_preview_stream_url(),
            "streamMode": get_preview_stream_mode(),
            "websocketConnected": ws_connected,
            "diskUsage": disk_usage,
            "cpuLoad": round(load_average, 2),
            "cpuUsage": cpu_usage,
            "memoryUsage": get_memory_usage_percent(),
            "networkLatency": 0,
        },
    }

def get_realtime_ws_url():
    override = os.environ.get("DIGIPATH_REALTIME_WS_URL", "").strip()
    if override:
        return override.rstrip("/")
    base = BACKEND_BASE_URL.rstrip("/")
    if base.endswith("/api"):
        base = base[:-4]
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):] + "/ws/device"
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):] + "/ws/device"
    return f"ws://{base}/ws/device"


def get_preview_stream_url():
    if USE_WEBSOCKET:
        return get_realtime_ws_url()
    return f"http://{get_local_ip()}:{STREAM_PORT}/stream.mjpg"


def get_preview_stream_mode():
    if USE_WEBSOCKET and WS_AVAILABLE:
        return "websocket"
    if ENABLE_MJPEG_HTTP:
        return "mjpeg"
    return "unavailable"


def send_ws_json(payload):
    global ws_connected, realtime_ws
    if not ws_connected or not realtime_ws:
        return False
    with realtime_ws_lock:
        try:
            realtime_ws.send(json.dumps(payload))
            return True
        except Exception as err:
            ws_connected = False
            print(f"[Realtime] Send failed: {err}")
            return False


def send_ws_frame(frame):
    global ws_connected, realtime_ws
    if not WS_AVAILABLE or not ws_connected or not realtime_ws or not frame:
        return
    if not ws_frame_send_lock.acquire(blocking=False):
        return
    try:
        with realtime_ws_lock:
            realtime_ws.send(frame, opcode=websocket.ABNF.OPCODE_BINARY)
    except Exception:
        ws_connected = False
    finally:
        ws_frame_send_lock.release()


def send_ws_presence(event_type):
    global ws_connected_once
    payload = get_device_payload(event_type)
    if event_type not in ("device_connected", "device_heartbeat", "device_disconnected"):
        payload["eventType"] = event_type
        message_type = "device_event"
    else:
        message_type = "heartbeat" if event_type == "device_heartbeat" else event_type
    ok = send_ws_json({"type": message_type, "payload": payload})
    if ok and event_type == "device_connected":
        ws_connected_once = True
    return ok


def post_device_presence(event_type):
    endpoint_map = {
        "device_connected": "connect",
        "device_heartbeat": "heartbeat",
        "device_disconnected": "disconnect",
    }
    endpoint = endpoint_map.get(event_type, "events")
    payload = get_device_payload(event_type)
    if endpoint == "events":
        payload["eventType"] = event_type

    response = requests.post(
        f"{BACKEND_BASE_URL}/devices/{endpoint}",
        json=payload,
        headers=DEVICE_HEADERS,
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def report_device_presence(event_type):
    """Send connect/heartbeat/disconnect. WebSocket for realtime + HTTP to persist in backend DB."""
    global connected_once, last_presence_ok, last_presence_error, last_presence_at

    ws_ok = False
    if USE_WEBSOCKET and WS_AVAILABLE and ws_connected:
        ws_ok = send_ws_presence(event_type)

    # Always persist via HTTP so dashboard Connected status stays fresh even if WS ack is delayed.
    post_device_presence(event_type)

    if event_type == "device_connected":
        connected_once = True
    elif event_type == "device_disconnected":
        connected_once = False

    last_presence_ok = True
    last_presence_error = ""
    last_presence_at = datetime.now().isoformat()
    transport = "websocket+http" if ws_ok else "http"
    print(f"[Device] {event_type} sent via {transport}.")
    return True


def request_service_restart(reason):
    """Full service restart so WS, HTTP server, and IP reporting all refresh."""
    if os.environ.get("DIGIPATH_RESTART_ON_IP_CHANGE", "1").strip().lower() in ("0", "false", "no", "off"):
        print(f"[Network] IP change restart disabled; reason={reason}")
        return False
    try:
        result = subprocess.run(
            ["sudo", "-n", "systemctl", "restart", "digipath-scanner.service"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode == 0:
            print(f"[Network] digipath-scanner restart triggered ({reason}).")
            return True
        detail = (result.stderr or result.stdout or "").strip()
        print(f"[Network] Service restart failed ({result.returncode}): {detail}")
    except Exception as err:
        print(f"[Network] Service restart error: {err}")
    return False


def force_presence_refresh():
    """Reconnect WS + send fresh device_connected with the latest IP."""
    global connected_once, ws_connected_once, ws_connected, realtime_ws

    connected_once = False
    ws_connected_once = False

    with realtime_ws_lock:
        ws = realtime_ws
        realtime_ws = None
        ws_connected = False
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    try:
        report_device_presence("device_connected")
        return True
    except Exception as err:
        print(f"[Network] Presence refresh failed: {err}")
        return False


def network_change_worker():
    """Restart the scanner service when DHCP gives a new LAN IP after WiFi change."""
    last_ip = None
    pending_ip = None
    pending_count = 0
    restart_debounce_secs = max(15, int(os.environ.get("DIGIPATH_IP_RESTART_DEBOUNCE_SECS", "30")))

    while True:
        try:
            current_ip = get_local_ip()
            if current_ip == "127.0.0.1":
                pending_ip = None
                pending_count = 0
            elif current_ip == pending_ip:
                pending_count += 1
            else:
                pending_ip = current_ip
                pending_count = 1

            if pending_count >= 2 and pending_ip:
                if last_ip and pending_ip != last_ip:
                    print(f"[Network] IP changed {last_ip} -> {pending_ip}")
                    force_presence_refresh()
                    if request_service_restart(f"{last_ip} -> {pending_ip}"):
                        return
                    print("[Network] Falling back to heartbeat-only refresh.")
                    try:
                        report_device_presence("device_heartbeat")
                    except Exception as err:
                        print(f"[Network] Heartbeat after IP change failed: {err}")
                    time.sleep(restart_debounce_secs)
                last_ip = pending_ip
        except Exception as err:
            print(f"[Network] Monitor error: {err}")
        time.sleep(3)


def device_presence_worker():
    global connected_once, last_presence_ok, last_presence_error, last_presence_at, ws_connected_once

    while True:
        try:
            if not connected_once and not ws_connected_once:
                report_device_presence("device_connected")
            else:
                report_device_presence("device_heartbeat")
        except Exception as e:
            connected_once = False
            ws_connected_once = False
            last_presence_ok = False
            last_presence_error = str(e)
            last_presence_at = datetime.now().isoformat()
            print(f"[Device] Presence update failed: {e}")

        time.sleep(HEARTBEAT_INTERVAL_SECS)


def send_disconnect():
    global connected_once, last_presence_ok, last_presence_error, last_presence_at

    if not connected_once:
        return

    try:
        report_device_presence("device_disconnected")
        print("[Device] Disconnect event sent.")
    except Exception as e:
        last_presence_ok = False
        last_presence_error = str(e)
        last_presence_at = datetime.now().isoformat()
        print(f"[Device] Disconnect event failed: {e}")

# ================= CAMERA INIT =================
def get_camera_cli():
    preferred = os.environ.get("DIGIPATH_CAMERA_CLI", "").strip()
    candidates = [preferred] if preferred else []
    candidates.extend(["rpicam-still", "libcamera-still"])

    for command in candidates:
        if command and shutil.which(command):
            return command
    return ""

def should_try_opencv_camera():
    if not CV_AVAILABLE:
        return False
    if ENABLE_OPENCV_CAMERA in ("0", "false", "no", "off"):
        return False
    if ENABLE_OPENCV_CAMERA in ("1", "true", "yes", "on"):
        return True
    return platform.system().lower() != "linux" or bool(os.environ.get("DIGIPATH_OPENCV_CAMERA_INDEX"))

def get_camera_backends():
    backends = []
    if camera:
        backends.append("picamera2")
    camera_cli = get_camera_cli()
    if camera_cli:
        backends.append(camera_cli)
    if should_try_opencv_camera():
        backends.append(f"opencv:{OPENCV_CAMERA_INDEX}")
    return backends

def mark_camera_success():
    global last_camera_error, last_camera_success_at
    last_camera_error = ""
    last_camera_success_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"

def is_camera_ready():
    return bool(camera) or (bool(last_camera_success_at) and not last_camera_error)

def capture_opencv_frame(file_path=None, width=None, height=None):
    global last_camera_error

    if not should_try_opencv_camera():
        return None, "OpenCV camera fallback is disabled or unavailable."

    backend = cv2.CAP_DSHOW if platform.system().lower() == "windows" and hasattr(cv2, "CAP_DSHOW") else cv2.CAP_ANY
    cap = cv2.VideoCapture(OPENCV_CAMERA_INDEX, backend)
    try:
        if not cap.isOpened():
            last_camera_error = f"OpenCV camera index {OPENCV_CAMERA_INDEX} did not open."
            return None, last_camera_error

        if width:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(width))
        if height:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(height))

        frame = None
        for _ in range(8):
            ok, candidate = cap.read()
            if ok and candidate is not None and candidate.size:
                frame = candidate
            time.sleep(0.05)

        if frame is None:
            last_camera_error = f"OpenCV camera index {OPENCV_CAMERA_INDEX} opened but returned no frame."
            return None, last_camera_error

        if file_path:
            cv2.imwrite(file_path, frame)
            mark_camera_success()
            return file_path, ""

        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            last_camera_error = "OpenCV captured a frame but JPEG encoding failed."
            return None, last_camera_error

        mark_camera_success()
        return encoded.tobytes(), ""
    except Exception as e:
        last_camera_error = f"OpenCV camera error: {e}"
        return None, last_camera_error
    finally:
        cap.release()

def init_camera(retries=3, retry_delay=2.0):
    global camera, last_camera_error, CAMERA_AVAILABLE, CAMERA_IMPORT_ERROR

    if not CAMERA_AVAILABLE:
        load_optional_modules()

    for attempt in range(1, retries + 1):
        if not CAMERA_AVAILABLE:
            last_camera_error = f"picamera2 not available: {CAMERA_IMPORT_ERROR or 'module import failed'}"
            if attempt == 1:
                print(f"[Camera] {last_camera_error}")
            if attempt < retries:
                ensure_dependencies()
                load_optional_modules()
                time.sleep(retry_delay)
            continue

        try:
            camera = Picamera2()
            config = build_stream_configuration()
            camera.configure(config)
            camera.start()
            time.sleep(CAMERA_WARMUP_SECS)
            apply_camera_controls()
            stream_mode = "preview/ISP jpeg" if uses_isp_jpeg_stream() else ("video/fast RGB" if STREAM_FAST_PATH else f"preview/{STREAM_COLOR_MODE}")
            print(f"[Camera] Initialized at {STREAM_RESOLUTION} @ {STREAM_FPS}fps ({stream_mode}, AWB={CAMERA_AWB_MODE}).")
            mark_camera_success()
            return True
        except Exception as e:
            last_camera_error = f"picamera2 init error: {e}"
            print(f"[Camera] Init attempt {attempt}/{retries} failed: {e}")
            camera = None
            if attempt < retries:
                time.sleep(retry_delay)

    print("[Camera] Camera auto-start failed. Check ribbon cable, camera enable, and that only one bridge instance is running.")
    return False

def build_isp_controls():
    """libcamera ISP controls for natural colour (fixes blue/yellow cast on stream)."""
    controls = {"FrameRate": float(STREAM_FPS)}
    try:
        from libcamera import controls as lc

        awb_map = {
            "auto": lc.AwbModeEnum.Auto,
            "daylight": lc.AwbModeEnum.Daylight,
            "cloudy": lc.AwbModeEnum.Cloudy,
            "shade": lc.AwbModeEnum.Shade,
            "tungsten": lc.AwbModeEnum.Tungsten,
            "fluorescent": lc.AwbModeEnum.Fluorescent,
            "indoor": lc.AwbModeEnum.Indoor,
        }
        if CAMERA_AWB_MODE in awb_map:
            controls["AwbMode"] = awb_map[CAMERA_AWB_MODE]
    except Exception:
        pass

    if CAMERA_SATURATION:
        try:
            controls["Saturation"] = float(CAMERA_SATURATION)
        except ValueError:
            pass
    if CAMERA_BRIGHTNESS:
        try:
            controls["Brightness"] = float(CAMERA_BRIGHTNESS)
        except ValueError:
            pass
    if CAMERA_COLOUR_GAIN_RED and CAMERA_COLOUR_GAIN_BLUE:
        try:
            controls["AwbEnable"] = False
            controls["ColourGains"] = (float(CAMERA_COLOUR_GAIN_RED), float(CAMERA_COLOUR_GAIN_BLUE))
        except ValueError:
            pass

    return controls


def apply_camera_controls():
    global camera
    if not camera:
        return
    controls = build_isp_controls()
    if not controls:
        return
    try:
        camera.set_controls(controls)
    except Exception as err:
        print(f"[Camera] Control apply warning: {err}")


def build_stream_configuration():
    controls = build_isp_controls()
    if uses_isp_jpeg_stream():
        factory = camera.create_preview_configuration
    else:
        factory = getattr(camera, "create_video_configuration", None) or camera.create_preview_configuration
    try:
        return factory(
            main={"size": STREAM_RESOLUTION, "format": "RGB888"},
            controls=controls,
        )
    except Exception:
        return factory(main={"size": STREAM_RESOLUTION, "format": "RGB888"})


def build_preview_configuration():
    return build_stream_configuration()


def restore_stream_configuration():
    global camera
    if not camera:
        return False
    preview_config = build_stream_configuration()
    camera.stop()
    camera.configure(preview_config)
    camera.start()
    time.sleep(CAMERA_WARMUP_SECS)
    apply_camera_controls()
    return True

def release_picamera2():
    global camera
    with camera_lock:
        if not camera:
            return
        try:
            camera.stop()
            camera.close()
        except Exception as err:
            print(f"[Camera] Release error: {err}")
        camera = None
    time.sleep(0.6)

def wait_for_stream_idle(timeout_secs=2.0):
    deadline = time.time() + timeout_secs
    while time.time() < deadline:
        if not is_capturing:
            acquired = camera_lock.acquire(timeout=0.05)
            if acquired:
                camera_lock.release()
                return True
        time.sleep(0.05)
    return False

def capture_via_picamera2_still(file_path):
    global camera, is_capturing, last_camera_error
    if not camera:
        return False

    is_capturing = True
    wait_for_stream_idle()

    try:
        with camera_lock:
            camera.stop()
            still_config = camera.create_still_configuration(
                main={"size": CAMERA_RESOLUTION, "format": "RGB888"},
            )
            camera.configure(still_config)
            camera.start()
            time.sleep(0.6)
            camera.capture_file(file_path)
            restore_stream_configuration()
        mark_camera_success()
        print(f"[Scanner] Captured via picamera2: {file_path}")
        return True
    except Exception as err:
        last_camera_error = f"picamera2 capture error: {err}"
        print(f"[Scanner] {last_camera_error}")
        try:
            with camera_lock:
                if camera:
                    restore_stream_configuration()
        except Exception:
            pass
        return False
    finally:
        is_capturing = False

def capture_via_camera_cli(file_path):
    global is_capturing, last_camera_error
    camera_cli = get_camera_cli()
    if not camera_cli:
        return False

    is_capturing = True
    wait_for_stream_idle()
    release_picamera2()
    try:
        result = subprocess.run([
            camera_cli, '-o', file_path,
            '--width', str(CAMERA_RESOLUTION[0]),
            '--height', str(CAMERA_RESOLUTION[1]),
            '--nopreview', '-t', str(max(CAMERA_WARMUP_SECS * 1000, 1200)),
        ], capture_output=True, text=True, timeout=20)
        if result.returncode == 0 and os.path.exists(file_path) and os.path.getsize(file_path) > 0:
            mark_camera_success()
            print(f"[Scanner] Captured via {camera_cli}: {file_path}")
            return True
        error = (result.stderr or result.stdout or f"{camera_cli} returned {result.returncode}").strip()
        print(f"[Scanner] {camera_cli} error: {error}")
        last_camera_error = f"{camera_cli} capture error: {error}"
        return False
    except (FileNotFoundError, subprocess.TimeoutExpired) as err:
        last_camera_error = f"{camera_cli} capture failed: {err}"
        print(f"[Scanner] {last_camera_error}")
        return False
    finally:
        is_capturing = False
        if CAMERA_AVAILABLE and not camera:
            init_camera(retries=2, retry_delay=1.0)

def encode_stream_jpeg(image_array, fast=False):
    """Encode RGB888 numpy frame to JPEG without swapping red/blue channels."""
    jpeg_quality = STREAM_JPEG_QUALITY
    optimize = not fast
    if OCR_AVAILABLE and image_array is not None:
        try:
            if len(image_array.shape) == 3 and image_array.shape[2] >= 3:
                rgb = image_array[:, :, :3]
                if CV_AVAILABLE and rgb.dtype != np.uint8:
                    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
                img = Image.fromarray(rgb, mode="RGB")
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=jpeg_quality, optimize=optimize)
                return buf.getvalue()
        except Exception:
            pass

    if CV_AVAILABLE:
        try:
            frame = image_array
            if len(frame.shape) == 3 and frame.shape[2] == 3:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
            if not fast:
                params.extend([cv2.IMWRITE_JPEG_OPTIMIZE, 1])
            ok, encoded = cv2.imencode(".jpg", frame, params)
            if ok:
                return encoded.tobytes()
        except Exception:
            pass

    return None


def capture_stream_jpeg_from_camera():
    """Use libcamera JPEG encoder (ISP colour correction) — most accurate colours."""
    stream = io.BytesIO()
    camera.capture_file(stream, format="jpeg")
    frame = stream.getvalue()
    return frame if frame else None


def capture_stream_frame():
    global last_camera_error

    if is_capturing:
        return None

    if camera:
        try:
            with camera_lock:
                if is_capturing:
                    return None
                if uses_isp_jpeg_stream():
                    frame = capture_stream_jpeg_from_camera()
                else:
                    image_array = camera.capture_array("main")
                    frame = encode_stream_jpeg(image_array, fast=STREAM_FAST_PATH)
            if frame:
                mark_camera_success()
                return frame
        except Exception as e:
            last_camera_error = f"stream frame error: {e}"
        return None

    frame, _ = capture_preview_frame()
    return frame

def stream_frame_producer():
    global latest_stream_frame, stream_producer_running

    isp_mode = uses_isp_jpeg_stream()
    target_interval = 0 if isp_mode else max(1.0 / STREAM_FPS, 0.001)
    mode_label = "ISP jpeg (as fast as camera)" if isp_mode else f"target {STREAM_FPS} fps"
    print(f"[Stream] Producer running — {mode_label} (fast_path={STREAM_FAST_PATH}).")
    next_tick = time.perf_counter()
    while stream_producer_running:
        frame = capture_stream_frame()
        if frame:
            with latest_stream_lock:
                latest_stream_frame = frame
            if USE_WEBSOCKET and WS_AVAILABLE:
                send_ws_frame(frame)

        if target_interval <= 0:
            continue

        next_tick += target_interval
        sleep_for = next_tick - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)
        else:
            next_tick = time.perf_counter()

def capture_preview_frame():
    global last_camera_error

    if is_capturing:
        return None, "Camera is busy capturing a scan."

    if camera and not is_capturing:
        try:
            with camera_lock:
                if is_capturing:
                    return None, "Camera is busy capturing a scan."
                stream = io.BytesIO()
                camera.capture_file(stream, format='jpeg')
                frame = stream.getvalue()
            if frame:
                mark_camera_success()
                return frame, ""
        except Exception as e:
            last_camera_error = f"picamera2 preview error: {e}"
            print(f"[Preview] {last_camera_error}")
        return None, last_camera_error or "picamera2 preview unavailable."

    camera_cli = get_camera_cli()
    if not camera_cli:
        frame, opencv_error = capture_opencv_frame(width=STREAM_RESOLUTION[0], height=STREAM_RESOLUTION[1])
        if frame:
            return frame, ""
        error = opencv_error or last_camera_error or "No camera backend available. Install/configure picamera2, rpicam-still, libcamera-still, or OpenCV camera access."
        return None, error

    fd, temp_path = tempfile.mkstemp(prefix="digipath_preview_", suffix=".jpg")
    os.close(fd)
    try:
        result = subprocess.run([
            camera_cli,
            '-o', temp_path,
            '--width', str(STREAM_RESOLUTION[0]),
            '--height', str(STREAM_RESOLUTION[1]),
            '--nopreview',
            '-t', str(max(CAMERA_WARMUP_SECS * 1000, 700)),
        ], capture_output=True, text=True, timeout=8)
        if result.returncode == 0 and os.path.exists(temp_path) and os.path.getsize(temp_path) > 0:
            with open(temp_path, "rb") as preview_file:
                frame = preview_file.read()
            mark_camera_success()
            return frame, ""

        error = (result.stderr or result.stdout or f"{camera_cli} returned {result.returncode}").strip()
        last_camera_error = f"{camera_cli} preview error: {error}"
        frame, opencv_error = capture_opencv_frame(width=STREAM_RESOLUTION[0], height=STREAM_RESOLUTION[1])
        if frame:
            return frame, ""
        return None, opencv_error or last_camera_error
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        last_camera_error = f"{camera_cli} preview failed: {e}"
        frame, opencv_error = capture_opencv_frame(width=STREAM_RESOLUTION[0], height=STREAM_RESOLUTION[1])
        if frame:
            return frame, ""
        return None, opencv_error or last_camera_error
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass

# ================= OCR & RULESET LOGIC =================
def extract_text_and_title(image_path):
    extracted_text = ""
    extracted_title = "Untitled Document"
    extracted_date = ""
    extracted_sender = ""

    if OCR_AVAILABLE and os.path.exists(image_path) and image_path.lower().endswith(('.png', '.jpg', '.jpeg')):
        print(f"[OCR] Processing {image_path}...")
        try:
            # Resize image for faster OCR
            img = Image.open(image_path)
            # Max width 1500px to speed up Tesseract on Pi
            if img.width > 1500:
                ratio = 1500.0 / img.width
                new_size = (1500, int(img.height * ratio))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
                
            extracted_text = pytesseract.image_to_string(img)
            print("[OCR] Text extracted successfully.")
        except Exception as e:
            print(f"[OCR] Error: {e}")
    else:
        print("[OCR] Cannot process image or OCR not available.")

    # Ruleset for Data Extraction
    print("[Ruleset] Finding Data...")
    lines = extracted_text.split('\n')

    for i, line in enumerate(lines):
        clean_line = line.strip()
        if not clean_line:
            continue

        # Extract Title
        if extracted_title == "Untitled Document":
            if re.search(r'^SUBJECT\s*:', clean_line, re.IGNORECASE):
                title = re.sub(r'^SUBJECT\s*:\s*', '', clean_line, flags=re.IGNORECASE)
                if not title and i + 1 < len(lines):
                    title = lines[i+1].strip()
                if title:
                    extracted_title = title
            elif re.search(r'^(MEMORANDUM|RESOLUTION NO\.)', clean_line, re.IGNORECASE):
                extracted_title = clean_line

        # Extract Date
        if not extracted_date:
            date_match = re.search(r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b', clean_line, re.IGNORECASE)
            if date_match:
                extracted_date = date_match.group(0)

        # Extract Sender (FROM:)
        if not extracted_sender:
            if re.search(r'^FROM\s*:', clean_line, re.IGNORECASE):
                sender = re.sub(r'^FROM\s*:\s*', '', clean_line, flags=re.IGNORECASE)
                if not sender and i + 1 < len(lines):
                    sender = lines[i+1].strip()
                if sender:
                    extracted_sender = sender

    print(f"[Ruleset] Found Title: '{extracted_title}', Date: '{extracted_date}', Sender: '{extracted_sender}'")
    return extracted_text, extracted_title, extracted_date, extracted_sender

# ================= DOCUMENT EDGE DETECTION & CROPPING =================
def auto_crop_document(image_path):
    if not CV_AVAILABLE:
        return image_path
    
    print(f"[Cropper] Detecting document edges in {image_path}...")
    try:
        image = cv2.imread(image_path)
        if image is None: return image_path
        
        orig = image.copy()
        height, width = image.shape[:2]
        
        # 1. Pre-process for edge detection
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blur, 75, 200)
        
        # 2. Find contours
        cnts, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
        
        screen_cnt = None
        for c in cnts:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                screen_cnt = approx
                break
        
        if screen_cnt is None:
            print("[Cropper] No document edges found. Skipping crop.")
            return image_path

        # 3. Perspective Transform
        pts = screen_cnt.reshape(4, 2)
        rect = np.zeros((4, 2), dtype="float32")
        
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        
        (tl, tr, br, bl) = rect
        widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
        widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
        maxWidth = max(int(widthA), int(widthB))
        
        heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
        heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
        maxHeight = max(int(heightA), int(heightB))
        
        dst = np.array([
            [0, 0],
            [maxWidth - 1, 0],
            [maxWidth - 1, maxHeight - 1],
            [0, maxHeight - 1]], dtype="float32")
        
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(orig, M, (maxWidth, maxHeight))
        
        # 4. Save cropped image
        crop_path = image_path.replace(".jpg", "_cropped.jpg")
        cv2.imwrite(crop_path, warped)
        print(f"[Cropper] Successfully cropped to {crop_path}")
        return crop_path
        
    except Exception as e:
        print(f"[Cropper] Error: {e}")
        return image_path

# ================= DOCUMENT CAPTURE (HIGH-RES) =================
def scan_document():
    global is_capturing, last_camera_error
    print("\n[Scanner] Capturing document...")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_name = f"scan_{timestamp}.jpg"
    file_path = os.path.join(SCANS_DIR, file_name)

    captured = False

    if camera:
        captured = capture_via_picamera2_still(file_path)
        if captured:
            file_path = auto_crop_document(file_path)

    if not captured and get_camera_cli():
        captured = capture_via_camera_cli(file_path)
        if captured:
            file_path = auto_crop_document(file_path)

    if not captured and should_try_opencv_camera():
        result_path, error = capture_opencv_frame(
            file_path=file_path,
            width=CAMERA_RESOLUTION[0],
            height=CAMERA_RESOLUTION[1],
        )
        if result_path and os.path.exists(result_path):
            captured = True
            print(f"[Scanner] Captured via OpenCV camera index {OPENCV_CAMERA_INDEX}: {file_path}")
            file_path = auto_crop_document(file_path)
        elif error:
            print(f"[Scanner] OpenCV capture error: {error}")

    if not captured or not os.path.exists(file_path):
        raise RuntimeError(last_camera_error or "Camera capture failed. Check Pi camera connection and camera software.")

    # Convert to PDF
    pdf_path = file_path.replace('.jpg', '.pdf')
    if os.path.exists(file_path) and file_path.endswith('.jpg'):
        try:
            print(f"[Scanner] Converting {file_path} to PDF...")
            img = Image.open(file_path)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img.save(pdf_path, "PDF", resolution=100.0)
            print(f"[Scanner] Converted to {pdf_path}")
            file_path = pdf_path # Use PDF for upload
        except Exception as e:
            print(f"[Scanner] PDF conversion error: {e}")

    text, title, date, sender = extract_text_and_title(file_path.replace('.pdf', '.jpg') if os.path.exists(file_path.replace('.pdf', '.jpg')) else file_path)
    return file_path, text, title, date, sender

# ================= QUEUE TO LOCAL DB =================
def queue_scan(file_path, text, title, date, sender, status="pending"):
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO scans (file_path, extracted_text, extracted_title, extracted_date, extracted_sender, status) VALUES (?, ?, ?, ?, ?, ?)",
        (file_path, text, title, date, sender, status)
    )
    scan_id = cursor.lastrowid
    conn.commit()
    conn.close()
    print(f"[Local DB] Saved '{title}' with status '{status}'.")
    return scan_id

def mark_scan_status(scan_id, status):
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    cursor.execute("UPDATE scans SET status=? WHERE id=?", (status, scan_id))
    conn.commit()
    conn.close()

# ================= LOCAL BRIDGE HTTP SERVER =================
class StreamHandler(BaseHTTPRequestHandler):
    def send_json(self, status_code, payload):
        import json
        data = json.dumps(payload).encode()
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == '/stream.mjpg':
            if not ENABLE_MJPEG_HTTP:
                self.send_json(410, {
                    "ok": False,
                    "message": "MJPEG preview is disabled. Use WebSocket stream via the backend.",
                    "streamMode": get_preview_stream_mode(),
                    "streamUrl": get_preview_stream_url(),
                })
                return

            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Connection', 'close')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()

            frame_interval = max(1.0 / STREAM_FPS, 0.02)
            try:
                while True:
                    with latest_stream_lock:
                        frame = latest_stream_frame

                    if not frame:
                        time.sleep(0.02)
                        continue

                    try:
                        self.wfile.write(b'--frame\r\n')
                        self.wfile.write(b'Content-Type: image/jpeg\r\n')
                        self.wfile.write(f'Content-Length: {len(frame)}\r\n'.encode())
                        self.wfile.write(b'\r\n')
                        self.wfile.write(frame)
                        self.wfile.write(b'\r\n')
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        break

                    time.sleep(frame_interval)

            except Exception as e:
                print(f"[Stream] Client disconnected: {e}")

        elif path == '/snapshot.jpg':
            frame = None
            error = ""
            with latest_stream_lock:
                if latest_stream_frame:
                    frame = latest_stream_frame
            if not frame:
                frame, error = capture_preview_frame()
            if frame:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(frame)))
                self.end_headers()
                self.wfile.write(frame)
            else:
                self.send_error(503, error or "Camera not available")

        elif path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            status = {
                "status": "online",
                "bridgeVersion": BRIDGE_VERSION,
                "camera": is_camera_ready(),
                "cameraReady": is_camera_ready(),
                "cameraConfigured": bool(get_camera_backends()),
                "cameraObjectReady": bool(camera),
                "cameraCli": get_camera_cli(),
                "cameraBackends": get_camera_backends(),
                "opencvAvailable": CV_AVAILABLE,
                "opencvCameraIndex": OPENCV_CAMERA_INDEX,
                "cameraError": last_camera_error,
                "lastCameraSuccessAt": last_camera_success_at,
                "capturing": is_capturing,
                "deviceId": DEVICE_ID,
                "backendBaseUrl": BACKEND_BASE_URL,
                "realtimeWsUrl": get_realtime_ws_url(),
                "bridgeUrl": f"http://{get_local_ip()}:{STREAM_PORT}",
                "streamUrl": get_preview_stream_url(),
                "streamMode": get_preview_stream_mode(),
                "mjpegEnabled": ENABLE_MJPEG_HTTP,
                "websocketEnabled": USE_WEBSOCKET and WS_AVAILABLE,
                "websocketConnected": ws_connected,
                "backendConnected": last_presence_ok and (ws_connected if USE_WEBSOCKET and WS_AVAILABLE else True),
                "autoConnected": connected_once,
                "lastPresenceAt": last_presence_at,
                "lastPresenceError": last_presence_error,
                "lastCommandError": last_command_error,
                "motor": motor_controller.status(),
            }
            import json
            self.wfile.write(json.dumps(status).encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            preview_mode = get_preview_stream_mode()
            preview_url = get_preview_stream_url()
            if ENABLE_MJPEG_HTTP:
                html = f'''<html><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh">
                <img src="/stream.mjpg" style="max-width:100%;max-height:100vh" />
                </body></html>'''
            else:
                html = f'''<html><body style="font-family:sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
                <h1>DigiPath Pi Bridge</h1>
                <p><strong>Preview mode:</strong> {preview_mode}</p>
                <p><strong>Stream endpoint:</strong> {preview_url}</p>
                <p><strong>Status:</strong> <a href="/status" style="color:#38bdf8">/status</a></p>
                <p>MJPEG is disabled. Dashboard preview uses WebSocket through the backend.</p>
                </body></html>'''
            self.wfile.write(html.encode())

    def do_POST(self):
        global connected_once, last_presence_ok, last_presence_error, last_presence_at

        if self.path == '/connect':
            try:
                report_device_presence("device_connected")
                self.send_json(200, {"ok": True, "event": "device_connected", "transport": "websocket" if USE_WEBSOCKET and WS_AVAILABLE else "http"})
            except Exception as e:
                last_presence_ok = False
                last_presence_error = str(e)
                last_presence_at = datetime.now().isoformat()
                self.send_json(502, {"ok": False, "event": "device_connected", "message": f"Connect failed: {e}"})
        elif self.path == '/heartbeat':
            try:
                report_device_presence("device_heartbeat")
                self.send_json(200, {"ok": True, "event": "device_heartbeat", "transport": "websocket" if USE_WEBSOCKET and WS_AVAILABLE else "http"})
            except Exception as e:
                last_presence_ok = False
                last_presence_error = str(e)
                last_presence_at = datetime.now().isoformat()
                self.send_json(502, {"ok": False, "event": "device_heartbeat", "message": f"Heartbeat failed: {e}"})
        elif self.path == '/disconnect':
            try:
                report_device_presence("device_disconnected")
                self.send_json(200, {"ok": True, "event": "device_disconnected", "transport": "websocket" if USE_WEBSOCKET and WS_AVAILABLE else "http"})
            except Exception as e:
                self.send_json(502, {"ok": False, "event": "device_disconnected", "message": f"Disconnect failed: {e}"})
        else:
            self.send_error(404, "Unknown action")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-device-key')
        self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default logging

def is_stream_port_in_use(port=STREAM_PORT):
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.5)
    try:
        return probe.connect_ex(('127.0.0.1', int(port))) == 0
    except Exception:
        return False
    finally:
        probe.close()


def start_stream_server():
    try:
        server = ThreadingHTTPServer(('0.0.0.0', STREAM_PORT), StreamHandler)
    except OSError as err:
        print(f"[Bridge] Could not bind port {STREAM_PORT}: {err}")
        print("[Bridge] Stop the other bridge instance first:")
        print("  sudo systemctl stop digipath-scanner")
        print("  pkill -f pi_scanner_bridge.py")
        print(f"  sudo fuser -k {STREAM_PORT}/tcp")
        return
    print(f"[Bridge] Local bridge server started on port {STREAM_PORT}")
    print(f"[Bridge] Connect endpoint: http://0.0.0.0:{STREAM_PORT}/connect")
    if ENABLE_MJPEG_HTTP:
        print(f"[Stream] MJPEG view at: http://0.0.0.0:{STREAM_PORT}/stream.mjpg")
    else:
        print(f"[Stream] WebSocket preview via: {get_realtime_ws_url()}")
    server.serve_forever()

# ================= COMMAND POLLING WORKER =================
def execute_device_command(cmd):
    if not cmd or not cmd.get("command"):
        return

    cmd_id = cmd.get("id")
    if cmd_id:
        with _active_command_lock:
            if cmd_id in _active_command_ids:
                return
            _active_command_ids.add(cmd_id)

    print(f"\n[Command] Received: {cmd['command']}")

    try:
        if cmd['command'] == 'SCAN':
            doc_id = None
            local_scan_id = None
            file_path = None
            update_data = {'status': 'Failed', 'errorMessage': 'Scan produced no file'}
            try:
                requests.put(
                    f"{BACKEND_BASE_URL}/devices/commands/{cmd['id']}",
                    json={'status': 'Executing'},
                    headers=DEVICE_HEADERS,
                    timeout=10
                )
                sort_layer = 1
                try:
                    motor_controller.run_scan_sequence()
                    file_path, text, title, date, sender = scan_document()
                    sort_layer = motor_controller.resolve_sort_layer(
                        cmd.get("payload") or {},
                        text,
                        title,
                    )
                finally:
                    motor_controller.finish_scan_sequence(sort_layer)
                if file_path and os.path.exists(file_path):
                    local_scan_id = queue_scan(file_path, text, title, date, sender, "pending")
                    result = upload_scan_to_backend(file_path, text, title, date, sender, cmd['id'])
                    doc_id = result.get('documentId')
                    mark_scan_status(local_scan_id, "uploaded")
                    print(f"[Command] Upload success, doc: {doc_id}")
                    update_data = {'status': 'Executed'}
                    if doc_id:
                        update_data['resultDocumentId'] = doc_id
                else:
                    update_data = {'status': 'Failed', 'errorMessage': 'Scan produced no file'}
            except Exception as e:
                print(f"[Command] Upload error: {e}")
                if local_scan_id:
                    mark_scan_status(local_scan_id, "pending")
                update_data = {'status': 'Failed', 'errorMessage': str(e)}

            requests.put(
                f"{BACKEND_BASE_URL}/devices/commands/{cmd['id']}",
                json=update_data,
                headers=DEVICE_HEADERS,
                timeout=10
            )
            print(f"[Command] Executed {cmd['command']} successfully.")

        elif cmd['command'] == 'RESTART':
            print("[Command] Received RESTART command.")
            requests.put(
                f"{BACKEND_BASE_URL}/devices/commands/{cmd['id']}",
                json={'status': 'Executed'},
                headers=DEVICE_HEADERS,
                timeout=10
            )
            time.sleep(1)
            subprocess.run(['sudo', 'reboot'])

        elif cmd['command'] == 'SHUTDOWN':
            print("[Command] Received SHUTDOWN command.")
            requests.put(
                f"{BACKEND_BASE_URL}/devices/commands/{cmd['id']}",
                json={'status': 'Executed'},
                headers=DEVICE_HEADERS,
                timeout=10
            )
            time.sleep(1)
            subprocess.run(['sudo', 'shutdown', '-h', 'now'])
    finally:
        if cmd_id:
            with _active_command_lock:
                _active_command_ids.discard(cmd_id)


def on_realtime_message(ws, message):
    global connected_once, last_presence_ok, last_presence_error, last_presence_at
    try:
        msg = json.loads(message)
    except json.JSONDecodeError:
        return
    if msg.get("type") == "auth:ok":
        try:
            report_device_presence("device_connected")
            print("[Realtime] Authenticated and registered with backend via WebSocket.")
        except Exception as e:
            last_presence_ok = False
            last_presence_error = str(e)
            last_presence_at = datetime.now().isoformat()
            print(f"[Realtime] Post-auth registration failed: {e}")
        return
    if msg.get("type") in ("presence:ok",):
        return
    if msg.get("type") == "command:pending" and msg.get("command"):
        threading.Thread(target=execute_device_command, args=(msg["command"],), daemon=True).start()


def on_realtime_open(ws):
    global ws_connected, realtime_ws
    realtime_ws = ws
    ws_connected = True
    ws.send(json.dumps({
        "type": "auth",
        "deviceId": DEVICE_ID,
        "apiKey": DEVICE_API_KEY,
    }))
    print(f"[Realtime] Connected to {get_realtime_ws_url()}")


def on_realtime_close(ws, close_status_code, close_msg):
    global ws_connected, realtime_ws, ws_connected_once
    ws_connected = False
    ws_connected_once = False
    realtime_ws = None
    print(f"[Realtime] Disconnected ({close_status_code}): {close_msg or 'closed'}")


def on_realtime_error(ws, error):
    print(f"[Realtime] Error: {error}")


def realtime_worker():
    global ws_connected
    if not USE_WEBSOCKET or not WS_AVAILABLE:
        print("[Realtime] WebSocket mode disabled.")
        return

    while True:
        try:
            ws_app = websocket.WebSocketApp(
                get_realtime_ws_url(),
                on_open=on_realtime_open,
                on_message=on_realtime_message,
                on_close=on_realtime_close,
                on_error=on_realtime_error,
            )
            ws_app.run_forever(ping_interval=20, ping_timeout=10)
        except Exception as err:
            print(f"[Realtime] Connection loop error: {err}")
        ws_connected = False
        time.sleep(5)


def command_worker():
    global last_command_error

    while True:
        try:
            response = requests.get(COMMAND_API_URL, headers=DEVICE_HEADERS, timeout=10)
            if response.status_code == 200:
                last_command_error = ""
                commands = response.json()
                for cmd in commands:
                    execute_device_command(cmd)

        except Exception as e:
            last_command_error = str(e)
            print(f"[Command] Polling error: {e}")

        time.sleep(3)

# ================= BACKGROUND UPLOAD WORKER =================
def upload_worker():
    while True:
        try:
            conn = sqlite3.connect(LOCAL_DB)
            cursor = conn.cursor()
            cursor.execute("SELECT id, file_path, extracted_text, extracted_title, extracted_date, extracted_sender FROM scans WHERE status='pending' LIMIT 1")
            row = cursor.fetchone()

            if row:
                scan_id, file_path, ext_text, ext_title, ext_date, ext_sender = row
                if os.path.exists(file_path):
                    print(f"\n[Uploader] Uploading ID {scan_id} ({ext_title})...")
                    upload_scan_to_backend(file_path, ext_text, ext_title, ext_date, ext_sender)
                    print("[Uploader] Success!")
                    cursor.execute("UPDATE scans SET status='uploaded' WHERE id=?", (scan_id,))
                    conn.commit()
                else:
                    cursor.execute("UPDATE scans SET status='file_missing' WHERE id=?", (scan_id,))
                    conn.commit()
            conn.close()
        except requests.exceptions.RequestException:
            pass
        except Exception as e:
            print(f"[Uploader] Error: {e}")

        time.sleep(5)

# ================= MAIN =================
if __name__ == "__main__":
    if DEVICE_API_KEY == "dev-device-key-change-me":
        print("WARNING: DIGIPATH_DEVICE_API_KEY is using the development default.")
        print("Set it to the same DEVICE_API_KEY value configured in backend/.env.")

    atexit.register(send_disconnect)
    atexit.register(motor_controller.cleanup)
    init_db()

    if is_stream_port_in_use(STREAM_PORT):
        print(f"[Main] ERROR: port {STREAM_PORT} is already in use.")
        print("[Main] Another bridge instance is running (usually digipath-scanner systemd).")
        print("[Main] Fix with:")
        print("  sudo bash scripts/pi-restart-clean.sh")
        print("  OR: sudo systemctl stop digipath-scanner && pkill -f pi_scanner_bridge.py")
        print("[Main] Do not run python3 pi_scanner_bridge.py manually while systemd is active.")
        raise SystemExit(1)

    print("[Main] Auto-installing missing dependencies (if any)...")
    ensure_dependencies()
    load_optional_modules()

    # Init camera automatically on startup.
    print("[Main] Auto-starting camera...")
    cam_ok = init_camera()

    stream_producer_running = True
    producer_thread = threading.Thread(target=stream_frame_producer, daemon=True)
    producer_thread.start()

    # Start automatic backend connection and heartbeat reporting.
    presence_thread = threading.Thread(target=device_presence_worker, daemon=True)
    presence_thread.start()

    network_thread = threading.Thread(target=network_change_worker, daemon=True)
    network_thread.start()

    if USE_WEBSOCKET and WS_AVAILABLE:
        realtime_thread = threading.Thread(target=realtime_worker, daemon=True)
        realtime_thread.start()
    else:
        print("[Realtime] Using HTTP-only mode for heartbeat/commands.")

    # Start the local bridge server even when the camera is missing, so the
    # dashboard can still trigger /connect and inspect /status.
    stream_thread = threading.Thread(target=start_stream_server, daemon=True)
    stream_thread.start()
    if not cam_ok:
        print("[Main] Camera not available; stream endpoints will return camera-unavailable status.")

    # Start upload worker
    uploader_thread = threading.Thread(target=upload_worker, daemon=True)
    uploader_thread.start()

    # Start command polling worker
    command_thread = threading.Thread(target=command_worker, daemon=True)
    command_thread.start()

    print("\n" + "=" * 60)
    print("  VinzonsDIGIPATH - Pi Scanner Bridge")
    print("=" * 60)
    print(f"  Camera:  {'Ready' if cam_ok else 'Not available'}")
    motor_status = motor_controller.status()
    print(f"  Motor:   {'Enabled (2x TB6600)' if motor_status.get('enabled') else 'Disabled'}")
    if motor_status.get("enabled"):
        lift = motor_status.get("lift", {})
        rotate = motor_status.get("rotate", {})
        print(
            f"           Lift PUL=GPIO{lift.get('pulGpio')} DIR=GPIO{lift.get('dirGpio')}, "
            f"Rotate PUL=GPIO{rotate.get('pulGpio')} DIR=GPIO{rotate.get('dirGpio')}, "
            f"layers={motor_status.get('layerCount')}"
        )
    print(f"  Preview: {get_preview_stream_mode()} ({get_preview_stream_url()})")
    print(f"  Realtime: {'WebSocket' if USE_WEBSOCKET and WS_AVAILABLE else 'HTTP fallback'}")
    print(f"  Backend: {BACKEND_BASE_URL}")
    print(f"  Device:  {DEVICE_ID}")
    print(f"  Office:  {OFFICE_ID}")
    print(f"  Heartbeat every {HEARTBEAT_INTERVAL_SECS}s")
    print("=" * 60)
    # Keep the main thread alive for workers
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Main] Shutting down...")
        send_disconnect()
