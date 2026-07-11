#!/usr/bin/env python3
"""
Pi scanner — JPEG live preview over WebSocket + scan commands.

Works on any network when Pi and dashboard share the same backend URL.
"""

import base64
import json
import os
import queue
import re
import signal
import socket
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime

# Quieter OpenCV logs; libjpeg MJPEG warnings are handled separately in _camera_read().
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np
import requests
import websocket

BACKEND_BASE_URL = os.environ.get("DIGIPATH_BACKEND_BASE_URL", "").rstrip("/")
DEVICE_ID = os.environ.get("DIGIPATH_DEVICE_ID", "DEV-001")
DEVICE_API_KEY = os.environ.get("DIGIPATH_DEVICE_API_KEY", "dev-device-key-change-me")
OFFICE_ID = os.environ.get("DIGIPATH_OFFICE_ID", "OFF-001")
CAMERA_INDEX_RAW = os.environ.get("DIGIPATH_CAMERA_INDEX", "auto").strip().lower()
CAMERA_SCAN_MAX = max(0, int(os.environ.get("DIGIPATH_CAMERA_SCAN_MAX", "8")))
USE_PICAMERA2_RAW = os.environ.get("DIGIPATH_USE_PICAMERA2", "auto").strip().lower()
FRAME_WIDTH = int(os.environ.get("DIGIPATH_STREAM_WIDTH", "2560"))
FRAME_HEIGHT = int(os.environ.get("DIGIPATH_STREAM_HEIGHT", "1440"))
PREVIEW_WIDTH = int(os.environ.get("DIGIPATH_PREVIEW_WIDTH", "2560"))
PREVIEW_HEIGHT = int(os.environ.get("DIGIPATH_PREVIEW_HEIGHT", "1440"))
SCAN_WIDTH = int(os.environ.get("DIGIPATH_SCAN_WIDTH", "2560"))
SCAN_HEIGHT = int(os.environ.get("DIGIPATH_SCAN_HEIGHT", "1440"))
SCAN_ORIENTATION = os.environ.get("DIGIPATH_SCAN_ORIENTATION", "landscape").strip().lower()
PREVIEW_ROTATE = os.environ.get("DIGIPATH_PREVIEW_ROTATE", "none").strip().lower()
STREAM_FAST = os.environ.get("DIGIPATH_STREAM_FAST", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
CAPTURE_MATCH_PREVIEW = os.environ.get("DIGIPATH_CAPTURE_MATCH_PREVIEW", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
HIGH_RES_PREVIEW = (PREVIEW_WIDTH * PREVIEW_HEIGHT) >= (1920 * 1080)
CAMERA_FPS = float(os.environ.get("DIGIPATH_STREAM_FPS", "20"))
JPEG_QUALITY = int(os.environ.get("DIGIPATH_STREAM_JPEG_QUALITY", "92"))
SCAN_JPEG_QUALITY = max(75, min(100, int(os.environ.get("DIGIPATH_SCAN_JPEG_QUALITY", "98"))))
PREVIEW_JPEG_QUALITY = int(os.environ.get("DIGIPATH_PREVIEW_JPEG_QUALITY", "76"))
STREAM_JPEG_MAX_BYTES = max(120_000, int(os.environ.get("DIGIPATH_STREAM_JPEG_MAX_BYTES", "650000")))
STREAM_JPEG_MIN_QUALITY = max(55, int(os.environ.get("DIGIPATH_STREAM_JPEG_MIN_QUALITY", "68")))
WS_MAX_FPS = min(120.0, max(1.0, float(os.environ.get("DIGIPATH_STREAM_WS_MAX_FPS", "20"))))
STREAM_SEND_INTERVAL = (1.0 / WS_MAX_FPS) if WS_MAX_FPS > 0 else 0.05
STREAM_BUFFER_FRAMES = max(1, int(os.environ.get("DIGIPATH_STREAM_BUFFER_FRAMES", "1")))
STREAM_DRIVER_DRAIN = max(1, int(os.environ.get("DIGIPATH_STREAM_DRIVER_DRAIN", "3")))
CAMERA_READ_TIMEOUT_MS = max(500, int(os.environ.get("DIGIPATH_CAMERA_READ_TIMEOUT_MS", "4000")))
CAMERA_READ_RETRIES = max(1, int(os.environ.get("DIGIPATH_CAMERA_READ_RETRIES", "4")))
CAMERA_RECOVER_AFTER_MISSES = max(3, int(os.environ.get("DIGIPATH_CAMERA_RECOVER_AFTER_MISSES", "12")))
CAMERA_REOPEN_AFTER_MISSES = max(
    CAMERA_RECOVER_AFTER_MISSES + 1,
    int(os.environ.get("DIGIPATH_CAMERA_REOPEN_AFTER_MISSES", "36")),
)
SUPPRESS_LIBJPEG_WARN = os.environ.get("DIGIPATH_SUPPRESS_LIBJPEG_WARN", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
HEARTBEAT_SECS = int(os.environ.get("DIGIPATH_HEARTBEAT_INTERVAL_SECS", "5"))
CAMERA_WARMUP_SECS = max(0.0, float(os.environ.get("DIGIPATH_CAMERA_WARMUP_SECS", "1")))
SCAN_WARMUP_FRAMES = max(4, int(os.environ.get("DIGIPATH_SCAN_WARMUP_FRAMES", "15")))
SCAN_BURST_FRAMES = max(1, int(os.environ.get("DIGIPATH_SCAN_BURST_FRAMES", "6")))
SCAN_CAPTURE_DRAIN = max(2, int(os.environ.get("DIGIPATH_SCAN_CAPTURE_DRAIN", "8")))
SCAN_ENHANCE = os.environ.get("DIGIPATH_SCAN_ENHANCE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
SCAN_SHARPEN = os.environ.get("DIGIPATH_SCAN_SHARPEN", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
CAMERA_AUTOFOCUS = os.environ.get("DIGIPATH_CAMERA_AUTOFOCUS", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
FOCUS_SETTLE_SECS = max(0.2, float(os.environ.get("DIGIPATH_FOCUS_SETTLE_SECS", "0.8")))
FOCUS_TRIGGER_ON_CAPTURE = os.environ.get("DIGIPATH_FOCUS_TRIGGER_ON_CAPTURE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
GROQ_API_KEY = os.environ.get("DIGIPATH_GROQ_API_KEY", "").strip()
GROQ_API_URL = os.environ.get(
    "DIGIPATH_GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions"
).strip()
GROQ_VISION_MODEL = os.environ.get(
    "DIGIPATH_GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
).strip()
GROQ_TEXT_MODEL = os.environ.get("DIGIPATH_GROQ_TEXT_MODEL", "llama-3.3-70b-versatile").strip()
_ai_extract_default = "1" if GROQ_API_KEY else "0"
AI_EXTRACT_ENABLED = (
    os.environ.get("DIGIPATH_AI_EXTRACT", _ai_extract_default).strip().lower()
    not in ("0", "false", "no", "off")
    and bool(GROQ_API_KEY)
)
AI_USE_VISION = os.environ.get("DIGIPATH_AI_USE_VISION", "1").strip().lower() not in (
    "0", "false", "no", "off",
)
AI_EXTRACT_BACKGROUND = os.environ.get("DIGIPATH_AI_BACKGROUND", "1").strip().lower() not in (
    "0", "false", "no", "off",
)
AI_EXTRACT_MAX_TOKENS = max(1024, int(os.environ.get("DIGIPATH_AI_EXTRACT_MAX_TOKENS", "4096")))
AI_VISION_MAX_BYTES = max(400_000, int(os.environ.get("DIGIPATH_AI_VISION_MAX_BYTES", "3500000")))
AI_VISION_MAX_EDGE = max(1024, int(os.environ.get("DIGIPATH_AI_VISION_MAX_EDGE", "2048")))
DEVTUNNEL_TOKEN = os.environ.get("DIGIPATH_DEVTUNNEL_TOKEN", "").strip()
WS_AUTH_TIMEOUT_SECS = int(os.environ.get("DIGIPATH_WS_AUTH_TIMEOUT_SECS", "20"))

DEVICE_HEADERS = {"x-device-key": DEVICE_API_KEY}
stop_event = threading.Event()
latest_bgr = None
latest_preview_bgr = None
frame_lock = threading.Lock()
active_camera_index = None
active_capture_width = FRAME_WIDTH
active_capture_height = FRAME_HEIGHT
active_capture_cap = None
active_v4l2_devices: list[str] = []
camera_focus_status = "unknown"
active_stream_width = PREVIEW_WIDTH
active_stream_height = PREVIEW_HEIGHT
capture_cap_lock = threading.RLock()
_scan_in_progress = threading.Event()
_preview_encode_event = threading.Event()
_preview_encode_lock = threading.Lock()
_last_encoded_version = -1
_ws_frame_slot: bytes | None = None
_ws_frame_slot_lock = threading.Lock()
_ws_frame_send_event = threading.Event()

ws_connected = False
ws_authenticated = False
realtime_ws = None
ws_outbound = queue.Queue(maxsize=1)
_camera_frame_version = 0
_ws_reconnect_delay = 1.0
_auth_timer = None
_auth_retry_stop = threading.Event()
_active_ws_app = None
_ws_last_activity_at = 0.0
WS_STALE_SECS = max(15.0, float(os.environ.get("DIGIPATH_WS_STALE_SECS", "90")))
WS_RECONNECT_MAX_SECS = max(2.0, float(os.environ.get("DIGIPATH_WS_RECONNECT_MAX_SECS", "12")))
WS_PING_INTERVAL = int(os.environ.get("DIGIPATH_WS_PING_INTERVAL", "0"))
WS_PING_TIMEOUT = max(10, int(os.environ.get("DIGIPATH_WS_PING_TIMEOUT", "30")))
STREAM_HTTP_UPLOAD_RAW = os.environ.get("DIGIPATH_STREAM_HTTP_UPLOAD", "auto").strip().lower()
STREAM_HTTP_UPLOAD = STREAM_HTTP_UPLOAD_RAW not in ("0", "false", "no", "off")
STREAM_HTTP_WS_PRIORITY = STREAM_HTTP_UPLOAD_RAW in ("auto", "ws", "1", "true", "yes", "on")
_last_http_frame_upload_at = 0.0
_http_frame_upload_boot = 0
_http_upload_session = None
_last_ws_frame_sent_at = 0.0
_last_http_upload_error_log_at = 0.0


def _http_upload_session_get():
    global _http_upload_session
    if _http_upload_session is None:
        _http_upload_session = requests.Session()
        _http_upload_session.headers.update({**DEVICE_HEADERS, "Connection": "keep-alive"})
    return _http_upload_session

PICAMERA2_AVAILABLE = False
try:
    from picamera2 import Picamera2

    PICAMERA2_AVAILABLE = True
except ImportError:
    Picamera2 = None  # type: ignore


def _native_camera_resolution() -> tuple[int, int]:
    """USB webcams expose landscape modes — open at the preview size."""
    return max(PREVIEW_WIDTH, PREVIEW_HEIGHT), min(PREVIEW_WIDTH, PREVIEW_HEIGHT)


def _target_camera_resolution() -> tuple[int, int]:
    return max(PREVIEW_WIDTH, PREVIEW_HEIGHT), min(PREVIEW_WIDTH, PREVIEW_HEIGHT)


def _preview_rotation_enabled() -> bool:
    return PREVIEW_ROTATE not in ("none", "0", "off", "false", "no", "native")


def _apply_preview_rotation(frame):
    """Resize-only preview — never auto-rotate (WYSIWYG with scan output)."""
    if frame is None:
        return None
    if not _preview_rotation_enabled():
        return frame
    if PREVIEW_ROTATE in ("cw", "clockwise", "90"):
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if PREVIEW_ROTATE in ("ccw", "counterclockwise", "counter-clockwise", "270"):
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def _is_native_camera_resolution(w: int, h: int) -> bool:
    return max(w, h) >= max(PREVIEW_WIDTH, PREVIEW_HEIGHT) and min(w, h) >= min(
        PREVIEW_WIDTH, PREVIEW_HEIGHT
    )


def _is_target_stream_resolution(w: int, h: int) -> bool:
    return w >= PREVIEW_WIDTH and h >= PREVIEW_HEIGHT


def _log_stream_resolution(camera_w: int, camera_h: int, *, opened: bool = False):
    target_cam_w, target_cam_h = _target_camera_resolution()
    cam_ok = _is_native_camera_resolution(camera_w, camera_h)
    stream_ok = _is_target_stream_resolution(PREVIEW_WIDTH, PREVIEW_HEIGHT)
    label = "opened" if opened else "active"
    print(
        f"[PiWS] 2K check ({label}): camera={camera_w}x{camera_h} "
        f"(target {target_cam_w}x{target_cam_h}, {'OK' if cam_ok else 'FALLBACK'}), "
        f"stream={PREVIEW_WIDTH}x{PREVIEW_HEIGHT} "
        f"({'OK' if stream_ok else 'MISCONFIGURED'})"
    )
    if opened and not cam_ok:
        print(
            "[PiWS] WARNING: Webcam did not open at target resolution — preview may be upscaled. "
            f"Set DIGIPATH_PREVIEW_WIDTH={PREVIEW_WIDTH} in .env and use a cam that supports "
            f"{target_cam_w}x{target_cam_h}."
        )


def capture_resolution_candidates():
    """Try native 2K first in fast mode, then common fallbacks for USB webcams."""
    seen = set()
    candidates = []
    ordered = []
    native_w, native_h = _native_camera_resolution()
    target_w, target_h = _target_camera_resolution()
    if STREAM_FAST:
        ordered.extend(
            (
                (native_w, native_h),
                (target_w, target_h),
                (FRAME_WIDTH, FRAME_HEIGHT),
                (2560, 1440),
                (1920, 1080),
                (1280, 720),
            )
        )
    ordered.extend(
        (
            (FRAME_WIDTH, FRAME_HEIGHT),
            (native_w, native_h),
            (target_w, target_h),
            (2560, 1440),
            (1920, 1080),
            (1280, 720),
            (640, 480),
        )
    )
    for w, h in ordered:
        if w > 0 and h > 0 and (w, h) not in seen:
            seen.add((w, h))
            candidates.append((w, h))
    return candidates


def should_try_picamera2() -> bool:
    if USE_PICAMERA2_RAW in ("0", "false", "no", "off"):
        return False
    if USE_PICAMERA2_RAW in ("1", "true", "yes", "on"):
        return PICAMERA2_AVAILABLE
    # auto: only when no USB capture nodes (CSI-only Pi)
    return PICAMERA2_AVAILABLE and not _discover_usb_capture_indices()


def ws_url() -> str:
    root = BACKEND_BASE_URL.replace("/api", "")
    if root.startswith("https://"):
        return root.replace("https://", "wss://", 1) + "/ws/device"
    return root.replace("http://", "ws://", 1) + "/ws/device"


def ws_connect_headers():
    if not DEVTUNNEL_TOKEN:
        return None
    token = (
        DEVTUNNEL_TOKEN
        if DEVTUNNEL_TOKEN.lower().startswith("tunnel ")
        else f"tunnel {DEVTUNNEL_TOKEN}"
    )
    return [f"X-Tunnel-Authorization: {token}"]


def _clear_auth_timer():
    global _auth_timer
    if _auth_timer:
        _auth_timer.cancel()
        _auth_timer = None


def _start_auth_timer():
    global _auth_timer
    _clear_auth_timer()

    def _on_auth_timeout():
        if ws_authenticated or not ws_connected:
            return
        print(
            "[PiWS] No auth:ok after "
            f"{WS_AUTH_TIMEOUT_SECS}s. Dev tunnel may block remote clients.\n"
            "  Laptop: devtunnel host -p 5000 --allow-anonymous\n"
            "  Or set DIGIPATH_DEVTUNNEL_TOKEN in .env "
            "(devtunnel token TUNNELID --scopes connect)"
        )
        _force_ws_reconnect("auth timeout")

    _auth_timer = threading.Timer(float(WS_AUTH_TIMEOUT_SECS), _on_auth_timeout)
    _auth_timer.daemon = True
    _auth_timer.start()


def _stop_auth_retry():
    _auth_retry_stop.set()


def _start_auth_retry(ws):
    _auth_retry_stop.clear()

    def _retry():
        while not stop_event.is_set() and not _auth_retry_stop.is_set():
            if ws_authenticated or not ws_connected:
                return
            try:
                ws.send(json.dumps({"type": "auth", "deviceId": DEVICE_ID, "apiKey": DEVICE_API_KEY}))
            except Exception as err:
                print(f"[PiWS] Auth resend failed: {err}")
                return
            if _auth_retry_stop.wait(3):
                return

    threading.Thread(target=_retry, daemon=True).start()


def _mask_secret(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return "(empty)"
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-2:]}"


def local_ip() -> str:
    try:
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return "127.0.0.1"


def device_payload(event_type: str) -> dict:
    ip = local_ip()
    resolution = f"{active_capture_width}x{active_capture_height}"
    return {
        "deviceId": DEVICE_ID,
        "name": "Physical Document Scanner",
        "model": "Raspberry Pi WS Scanner",
        "type": "Scanner",
        "ip": ip,
        "bridgeUrl": f"http://{ip}:8080",
        "assignedTo": OFFICE_ID,
        "resolution": resolution,
        "details": f"Scanner bridge reported {event_type}",
        "payload": {
            "ip": ip,
            "bridgeVersion": "ws-jpeg-1.0",
            "backendBaseUrl": BACKEND_BASE_URL,
            "websocketConnected": True,
            "streamMode": "jpeg-ws",
            "httpBridgeEnabled": False,
            "cameraReady": latest_bgr is not None,
            "resolution": resolution,
            "previewResolution": f"{PREVIEW_WIDTH}x{PREVIEW_HEIGHT}",
            "previewOrientation": "landscape" if PREVIEW_WIDTH >= PREVIEW_HEIGHT else "portrait",
            "previewRotate": PREVIEW_ROTATE,
            "scanResolution": f"{SCAN_WIDTH}x{SCAN_HEIGHT}",
            "scanOrientation": SCAN_ORIENTATION,
            "streamResolution": f"{active_stream_width}x{active_stream_height}",
            "cameraCaptureResolution": f"{active_capture_width}x{active_capture_height}",
            "streamIs2K": _is_target_stream_resolution(active_stream_width, active_stream_height)
            and _is_native_camera_resolution(active_capture_width, active_capture_height),
            "streamIsHd": active_stream_width >= 1920 and active_stream_height >= 1080,
            "previewFps": WS_MAX_FPS,
            "autofocus": camera_focus_status,
        },
    }


def encode_jpeg(frame, quality: int, *, optimize: bool = True) -> bytes | None:
    params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    if optimize:
        params.extend(
            (
                int(cv2.IMWRITE_JPEG_OPTIMIZE),
                1,
                int(cv2.IMWRITE_JPEG_PROGRESSIVE),
                0,
            )
        )
    ok, encoded = cv2.imencode(".jpg", frame, params)
    if not ok:
        return None
    return encoded.tobytes()


def encode_stream_jpeg(frame) -> bytes | None:
    """Fast preview JPEG — single encode first, brief quality step-down if oversized."""
    if frame is None:
        return None
    quality = PREVIEW_JPEG_QUALITY
    jpeg = encode_jpeg(frame, quality, optimize=False)
    if jpeg and len(jpeg) <= STREAM_JPEG_MAX_BYTES:
        return jpeg
    for quality in range(PREVIEW_JPEG_QUALITY - 6, STREAM_JPEG_MIN_QUALITY - 1, -6):
        jpeg = encode_jpeg(frame, quality, optimize=False)
        if jpeg and len(jpeg) <= STREAM_JPEG_MAX_BYTES:
            return jpeg
    return jpeg


def _frame_pace_sleep(remaining_secs: float):
    time.sleep(min(max(remaining_secs, 0.0), 0.008 if WS_MAX_FPS >= 45 else 0.02))


def _prepare_preview_frame(frame):
    oriented = _apply_preview_rotation(frame)
    if oriented is None:
        return frame
    height, width = oriented.shape[:2]
    if PREVIEW_WIDTH == width and PREVIEW_HEIGHT == height:
        return oriented
    downscale = PREVIEW_WIDTH < width or PREVIEW_HEIGHT < height
    return cv2.resize(
        oriented,
        (PREVIEW_WIDTH, PREVIEW_HEIGHT),
        interpolation=cv2.INTER_AREA if downscale else cv2.INTER_LINEAR,
    )


def configure_capture(cap, width: int, height: int):
    try:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    except Exception:
        pass
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    read_timeout = _cap_prop("CAP_PROP_READ_TIMEOUT_MSEC")
    if read_timeout is not None:
        try:
            cap.set(read_timeout, float(CAMERA_READ_TIMEOUT_MS))
        except Exception:
            pass
    apply_usb_camera_tuning(cap, device_index=active_camera_index)


def _cap_prop(name: str):
    return getattr(cv2, name, None)


@contextmanager
def _suppress_libjpeg_stderr():
    """USB webcams in MJPEG mode can emit harmless libjpeg stderr on partial frames."""
    if not SUPPRESS_LIBJPEG_WARN:
        yield
        return
    saved_fd = None
    try:
        saved_fd = os.dup(2)
        with open(os.devnull, "w") as devnull:
            os.dup2(devnull.fileno(), 2)
            yield
    finally:
        if saved_fd is not None:
            os.dup2(saved_fd, 2)
            os.close(saved_fd)


def _camera_read(cap, retries: int | None = None):
    attempts = CAMERA_READ_RETRIES if retries is None else max(1, retries)
    last_frame = None
    for attempt in range(attempts):
        with _suppress_libjpeg_stderr():
            ok, frame = cap.read()
        if ok and frame is not None and getattr(frame, "size", 0):
            return True, frame
        last_frame = frame
        if attempt + 1 < attempts:
            time.sleep(0.006)
    return False, last_frame


def _release_capture(cap):
    if cap is None:
        return
    try:
        cap.release()
    except Exception:
        pass


def _soft_recover_capture(cap) -> bool:
    """Flush USB driver buffers and re-apply capture settings without reopening."""
    if cap is None or not cap.isOpened():
        return False
    with capture_cap_lock:
        try:
            for _ in range(max(STREAM_DRIVER_DRAIN + 2, 5)):
                _camera_read(cap, retries=1)
            if active_capture_width > 0 and active_capture_height > 0:
                configure_capture(cap, active_capture_width, active_capture_height)
            warmup_camera_frames(cap, 4, min_secs=0.08)
            ok, frame = _camera_read(cap)
            return bool(ok and frame is not None and getattr(frame, "size", 0))
        except Exception:
            return False


def _run_v4l2_ctl(device: str, *args) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            ["v4l2-ctl", "-d", device, *args],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def _v4l2_control_names(device: str) -> set[str]:
    proc = _run_v4l2_ctl(device, "-l")
    if not proc or proc.returncode != 0:
        return set()
    names: set[str] = set()
    for line in proc.stdout.splitlines():
        match = re.match(r"^\s*([a-z0-9_]+)", line, re.IGNORECASE)
        if match:
            names.add(match.group(1).lower())
    return names


def _v4l2_device_supports_capture(device: str) -> bool:
    proc = _run_v4l2_ctl(device, "--all")
    if not proc or proc.returncode != 0:
        return False
    text = (proc.stdout or "") + (proc.stderr or "")
    return "Video Capture" in text


def _discover_usb_capture_indices() -> list[int]:
    """Return /dev/videoN indices that actually support Video Capture (skip metadata nodes)."""
    indices: list[int] = []
    for idx in range(0, CAMERA_SCAN_MAX + 4):
        dev = f"/dev/video{idx}"
        if not os.path.exists(dev):
            continue
        if _v4l2_device_supports_capture(dev):
            indices.append(idx)
    return indices


def discover_v4l2_focus_devices(preferred_index=None) -> list[str]:
    """Find /dev/video* nodes that expose focus controls (may differ from OpenCV index)."""
    candidates: list[str] = []
    seen: set[str] = set()

    def add(path: str):
        if path in seen or not os.path.exists(path):
            return
        seen.add(path)
        candidates.append(path)

    if preferred_index is not None:
        add(f"/dev/video{preferred_index}")
        for offset in (1, -1, 2, -2, 3):
            idx = preferred_index + offset
            if idx >= 0:
                add(f"/dev/video{idx}")

    for idx in range(0, CAMERA_SCAN_MAX + 4):
        add(f"/dev/video{idx}")

    found: list[str] = []
    focus_keys = {"focus_automatic_continuous", "focus_auto", "focus_absolute"}
    for dev in candidates:
        if _v4l2_control_names(dev) & focus_keys:
            found.append(dev)
    return found


def _v4l2_set_ctrl(device: str, control: str, value) -> bool:
    proc = _run_v4l2_ctl(device, f"--set-ctrl={control}={value}")
    return bool(proc and proc.returncode == 0)


def enable_v4l2_continuous_autofocus(devices: list[str]) -> bool:
    enabled = False
    for dev in devices:
        names = _v4l2_control_names(dev)
        if "focus_automatic_continuous" in names:
            for value in (1, 2):
                if _v4l2_set_ctrl(dev, "focus_automatic_continuous", value):
                    enabled = True
                    break
        elif "focus_auto" in names:
            if _v4l2_set_ctrl(dev, "focus_auto", 1):
                enabled = True
    return enabled


def trigger_v4l2_autofocus(devices: list[str]) -> bool:
    """Pulse autofocus so a still capture re-locks on the document."""
    triggered = False
    for dev in devices:
        names = _v4l2_control_names(dev)
        if "focus_automatic_continuous" in names:
            _v4l2_set_ctrl(dev, "focus_automatic_continuous", 0)
            time.sleep(0.06)
            for value in (1, 2):
                if _v4l2_set_ctrl(dev, "focus_automatic_continuous", value):
                    triggered = True
                    break
        elif "focus_auto" in names:
            _v4l2_set_ctrl(dev, "focus_auto", 0)
            time.sleep(0.06)
            if _v4l2_set_ctrl(dev, "focus_auto", 1):
                triggered = True
    return triggered


def _opencv_autofocus_enabled(cap) -> bool:
    autofocus_prop = _cap_prop("CAP_PROP_AUTOFOCUS")
    if autofocus_prop is None or not CAMERA_AUTOFOCUS:
        return False
    try:
        if cap.set(autofocus_prop, 1):
            return True
        cap.set(autofocus_prop, 1)
        return float(cap.get(autofocus_prop) or 0) > 0
    except Exception:
        return False


def initialize_camera_autofocus(cap, device_index=None) -> str:
    """Detect focus controls and enable continuous AF when supported."""
    global active_v4l2_devices, camera_focus_status

    if not CAMERA_AUTOFOCUS:
        camera_focus_status = "disabled"
        return camera_focus_status

    active_v4l2_devices = discover_v4l2_focus_devices(device_index)
    opencv_af = _opencv_autofocus_enabled(cap)
    v4l2_af = False
    if active_v4l2_devices:
        v4l2_af = enable_v4l2_continuous_autofocus(active_v4l2_devices)

    if v4l2_af:
        camera_focus_status = f"enabled ({active_v4l2_devices[0]})"
    elif opencv_af:
        camera_focus_status = "enabled (opencv)"
    elif active_v4l2_devices:
        camera_focus_status = f"controls on {active_v4l2_devices[0]} (manual set failed)"
    else:
        camera_focus_status = "fixed-focus webcam (no AF controls)"

    print(f"[PiWS] Autofocus: {camera_focus_status}")
    return camera_focus_status


def autofocus_settle(cap, device_index=None, *, for_capture: bool = False):
    """Let autofocus converge — light settle for live stream, full settle for scan."""
    if not CAMERA_AUTOFOCUS or cap is None or not cap.isOpened():
        return

    if device_index is not None and camera_focus_status == "unknown":
        initialize_camera_autofocus(cap, device_index)

    if for_capture and FOCUS_TRIGGER_ON_CAPTURE and active_v4l2_devices:
        if trigger_v4l2_autofocus(active_v4l2_devices):
            print("[PiWS] Autofocus pulse before capture")

    apply_usb_camera_tuning(cap, device_index=device_index)

    if for_capture:
        frames = SCAN_WARMUP_FRAMES
        min_secs = FOCUS_SETTLE_SECS
    else:
        frames = max(2, int(CAMERA_WARMUP_SECS * 2))
        min_secs = min(0.2, CAMERA_WARMUP_SECS)
    warmup_camera_frames(cap, frames, min_secs=min_secs)


def apply_usb_camera_tuning(cap, device_index=None):
    """Enable driver autofocus / auto-exposure / AWB when the webcam supports them."""
    if cap is None or not cap.isOpened():
        return

    autofocus_prop = _cap_prop("CAP_PROP_AUTOFOCUS")
    if autofocus_prop is not None and CAMERA_AUTOFOCUS:
        try:
            cap.set(autofocus_prop, 1)
        except Exception:
            pass

    auto_wb_prop = _cap_prop("CAP_PROP_AUTO_WB")
    if auto_wb_prop is not None:
        try:
            cap.set(auto_wb_prop, 1)
        except Exception:
            pass

    auto_exp_prop = _cap_prop("CAP_PROP_AUTO_EXPOSURE")
    if auto_exp_prop is not None:
        try:
            # 0.75 = auto on many V4L2 USB drivers; 1 = auto on others.
            if not cap.set(auto_exp_prop, 0.75):
                cap.set(auto_exp_prop, 1)
        except Exception:
            pass

    if device_index is not None and CAMERA_AUTOFOCUS and not active_v4l2_devices:
        active_v4l2_devices[:] = discover_v4l2_focus_devices(device_index)
    if active_v4l2_devices:
        enable_v4l2_continuous_autofocus(active_v4l2_devices)


def warmup_camera_frames(cap, frames: int = 8, min_secs: float = 0.0):
    """Let autofocus / auto-exposure settle before preview or still capture."""
    if cap is None or not cap.isOpened():
        return
    started = time.perf_counter()
    for _ in range(max(1, frames)):
        _camera_read(cap)
        if min_secs > 0 and (time.perf_counter() - started) >= min_secs:
            break
        time.sleep(0.04)
    remaining = min_secs - (time.perf_counter() - started)
    if remaining > 0:
        time.sleep(remaining)


def read_test_frame(cap, attempts: int = 6):
    for _ in range(attempts):
        ok, frame = _camera_read(cap)
        if ok and frame is not None and getattr(frame, "size", 0):
            return frame
        time.sleep(0.05)
    return None


def _frame_sharpness_score(frame) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _frame_looks_corrupt(frame) -> bool:
    """Detect torn MJPEG frames (horizontal seam / doubled image)."""
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
        height, width = gray.shape
        if height < 40 or width < 40:
            return True
        row_jump = np.mean(np.abs(gray[1:, :] - gray[:-1, :]), axis=1)
        median_jump = float(np.median(row_jump))
        peak_jump = float(np.max(row_jump))
        if peak_jump > max(30.0, median_jump * 5.5):
            return True
        half = width // 2
        left = gray[:, :half]
        right = gray[:, half : half + left.shape[1]]
        if right.shape[1] != left.shape[1]:
            right = cv2.resize(right, (left.shape[1], height))
        seam_diff = float(np.mean(np.abs(left - right)))
        if seam_diff > 28.0 and seam_diff > float(np.mean(np.abs(np.diff(gray, axis=1)))) * 2.2:
            return True
        return False
    except Exception:
        return False


def _jpeg_is_complete(jpeg: bytes | None) -> bool:
    return bool(jpeg) and len(jpeg) >= 4 and jpeg[-2:] == b"\xff\xd9"


def _drain_capture_buffer(cap, reads: int):
    for _ in range(max(1, reads)):
        _camera_read(cap)
        time.sleep(0.02)


def read_sharpest_frame(cap, attempts: int | None = None):
    """Burst-read frames after AF settle — keep the sharpest non-corrupt frame."""
    count = attempts if attempts is not None else SCAN_BURST_FRAMES
    best = None
    best_score = -1.0
    for _ in range(max(1, count)):
        ok, frame = _camera_read(cap)
        if not ok or frame is None or not getattr(frame, "size", 0) or _frame_looks_corrupt(frame):
            time.sleep(0.04)
            continue
        score = _frame_sharpness_score(frame)
        if score > best_score:
            best_score = score
            best = frame
        time.sleep(0.05)
    return best


def _enhance_document_frame(frame):
    """Boost text contrast + edge clarity for scan upload and AI extraction."""
    if frame is None or not SCAN_ENHANCE:
        return frame
    try:
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        l_channel = clahe.apply(l_channel)
        enhanced = cv2.cvtColor(cv2.merge([l_channel, a_channel, b_channel]), cv2.COLOR_LAB2BGR)
        if SCAN_SHARPEN:
            blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
            enhanced = cv2.addWeighted(enhanced, 1.4, blurred, -0.4, 0)
        return enhanced
    except Exception:
        return frame


def _scan_profile_from_payload(payload: dict | None = None) -> dict:
    """Per-scan size from dashboard paper guide — landscape output only."""
    payload = payload or {}
    width = int(payload.get("scanWidth") or SCAN_WIDTH)
    height = int(payload.get("scanHeight") or SCAN_HEIGHT)
    if height > width:
        width, height = height, width
    return {
        "portrait": False,
        "width": max(320, width),
        "height": max(320, height),
        "orientation": "landscape",
        "paperGuideId": str(payload.get("paperGuideId") or "").strip(),
    }


def _scan_output_dims(profile: dict | None = None) -> tuple[int, int]:
    if profile is not None:
        return int(profile["width"]), int(profile["height"])
    return SCAN_WIDTH, SCAN_HEIGHT


def _camera_dims_for_scan(profile: dict | None = None) -> tuple[int, int]:
    """Prefer native stream size; upscale to scan output in _finalize_scan_frame."""
    out_w, out_h = _scan_output_dims(profile)
    if active_capture_width > 0 and active_capture_height > 0:
        if active_capture_width >= out_w and active_capture_height >= out_h:
            return out_w, out_h
        return active_capture_width, active_capture_height
    return out_w, out_h


def configure_capture_for_scan(cap, width: int, height: int):
    """2K still capture — MJPEG + longer read timeout for USB mode switch."""
    configure_capture(cap, width, height)
    read_timeout = _cap_prop("CAP_PROP_READ_TIMEOUT_MSEC")
    if read_timeout is not None:
        try:
            cap.set(read_timeout, float(max(CAMERA_READ_TIMEOUT_MS, 12000)))
        except Exception:
            pass
    try:
        cap.set(cv2.CAP_PROP_FPS, min(CAMERA_FPS, 15.0))
    except Exception:
        pass


def _scan_capture_candidates(profile: dict | None = None) -> list[tuple[int, int]]:
    """Try native 2K first, then common hi-res modes before upscale fallback."""
    out_w, out_h = _scan_output_dims(profile)
    seen: set[tuple[int, int]] = set()
    candidates: list[tuple[int, int]] = []

    def add(w: int, h: int):
        if w > 0 and h > 0 and (w, h) not in seen:
            seen.add((w, h))
            candidates.append((w, h))

    add(out_w, out_h)
    add(FRAME_WIDTH, FRAME_HEIGHT)
    add(2560, 1440)
    add(2560, 1080)
    add(2048, 1536)
    add(1920, 1080)
    if active_capture_width > 0 and active_capture_height > 0:
        add(active_capture_width, active_capture_height)
    add(PREVIEW_WIDTH, PREVIEW_HEIGHT)
    add(1280, 720)
    return candidates


def _finalize_scan_frame(frame, profile: dict | None = None) -> bytes | None:
    """Encode scan JPEG — same pixels as live preview (no rotation)."""
    if frame is None:
        return None
    target_w, target_h = _scan_output_dims(profile)
    oriented = frame
    if oriented.shape[1] != target_w or oriented.shape[0] != target_h:
        upscaling = oriented.shape[1] < target_w or oriented.shape[0] < target_h
        oriented = cv2.resize(
            oriented,
            (target_w, target_h),
            interpolation=cv2.INTER_LANCZOS4 if upscaling else cv2.INTER_AREA,
        )
    oriented = _enhance_document_frame(oriented)
    jpeg = encode_jpeg(oriented, SCAN_JPEG_QUALITY, optimize=False)
    if not _jpeg_is_complete(jpeg):
        return None
    return jpeg


def _capture_still_frame(cap, *, for_2k: bool = False):
    """Exclusive still capture — preview worker must be paused."""
    autofocus_settle(cap, active_camera_index, for_capture=True)
    drain_reads = max(SCAN_CAPTURE_DRAIN, 12 if for_2k else SCAN_CAPTURE_DRAIN)
    _drain_capture_buffer(cap, drain_reads)
    burst = max(SCAN_BURST_FRAMES, 10 if for_2k else SCAN_BURST_FRAMES)
    frame = read_sharpest_frame(cap, attempts=burst)
    if frame is None:
        _drain_capture_buffer(cap, max(6, drain_reads // 2))
        frame = read_sharpest_frame(cap, attempts=burst + 4)
    return frame


def _try_scan_capture_at(cap, cam_w: int, cam_h: int, profile: dict | None) -> tuple[object | None, tuple[int, int] | None]:
    target_w, target_h = _scan_output_dims(profile)
    is_2k_target = cam_w >= target_w and cam_h >= target_h
    configure_capture_for_scan(cap, cam_w, cam_h)
    if is_2k_target:
        warmup_camera_frames(cap, max(SCAN_WARMUP_FRAMES, 12), min_secs=max(0.45, FOCUS_SETTLE_SECS * 0.5))
    else:
        warmup_camera_frames(cap, max(4, SCAN_BURST_FRAMES // 2), min_secs=0.12)
    frame = _capture_still_frame(cap, for_2k=is_2k_target)
    if frame is None:
        return None, None
    actual_h, actual_w = frame.shape[:2]
    return frame, (actual_w, actual_h)


def capture_scan_snapshot(profile: dict | None = None) -> bytes | None:
    """Hi-res still — native 2K when supported; never downscale through preview resize."""
    cap = active_capture_cap
    if cap is None or not cap.isOpened():
        return None

    target_w, target_h = _scan_output_dims(profile)
    with capture_cap_lock:
        saved_w, saved_h = active_capture_width, active_capture_height
        frame = None
        used_dims = None
        for cam_w, cam_h in _scan_capture_candidates(profile):
            frame, used_dims = _try_scan_capture_at(cap, cam_w, cam_h, profile)
            if frame is not None:
                break
            print(f"[PiWS] Scan capture miss at {cam_w}x{cam_h} — trying fallback...")
        if STREAM_FAST and saved_w > 0 and saved_h > 0:
            configure_capture(cap, saved_w, saved_h)
            warmup_camera_frames(cap, 3, min_secs=0.08)
        if frame is None:
            return None
        if used_dims:
            native_2k = used_dims[0] >= target_w and used_dims[1] >= target_h
            if native_2k:
                print(f"[PiWS] Scan captured native 2K at {used_dims[0]}x{used_dims[1]}")
            else:
                print(
                    f"[PiWS] Scan captured at {used_dims[0]}x{used_dims[1]}, "
                    f"upscaling to {target_w}x{target_h}"
                )
        return _finalize_scan_frame(frame, profile)


def capture_scan_bytes(profile: dict | None = None) -> bytes | None:
    """WYSIWYG still capture — never race the live preview reader on the same USB cam."""
    cap = active_capture_cap
    if cap is None or not cap.isOpened():
        return None

    _scan_in_progress.set()
    try:
        if not CAPTURE_MATCH_PREVIEW:
            return capture_scan_snapshot(profile)

        with capture_cap_lock:
            frame = _capture_still_frame(cap)
            if frame is None:
                return None
            _store_camera_frames(frame, _prepare_preview_frame(frame))
            actual_h, actual_w = frame.shape[:2]
            print(f"[PiWS] Scan frame {actual_w}x{actual_h} (WYSIWYG, no rotate)")
            return _finalize_scan_frame(frame, profile)
    finally:
        _scan_in_progress.clear()


def _run_scan_command(cmd_id: str, payload: dict | None = None):
    """Background scan — keeps WebSocket + live preview from stalling."""
    profile = _scan_profile_from_payload(payload)
    try:
        guide_label = f" ({profile['paperGuideId']})" if profile.get("paperGuideId") else ""
        print(
            f"[PiWS] Scan {cmd_id} capture "
            f"{profile['width']}x{profile['height']} {profile['orientation']}{guide_label}"
        )
        snap = capture_scan_bytes(profile)
        if not snap:
            update_command_status(
                cmd_id,
                "Failed",
                "No camera frame available — replug USB cam or retry capture",
            )
            return
        update_command_status(cmd_id, "Executing")
        upload_scan(snap, cmd_id)
        update_command_status(cmd_id, "Executed")
        print(f"[PiWS] Scan {cmd_id} uploaded — live preview resumed")
    except Exception as err:
        print(f"[PiWS] Scan {cmd_id} failed: {err}")
        update_command_status(cmd_id, "Failed", str(err))


def _is_ws_closed_error(err) -> bool:
    name = type(err).__name__.lower()
    if "connectionclosed" in name or "closed" in name:
        return True
    if isinstance(err, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    msg = str(err).lower()
    return "connection closed" in msg or "broken pipe" in msg


def _drain_latest_frame(cap, max_reads: int | None = None):
    """Flush the USB driver queue, keep one fresh frame (pipeline depth stays 1)."""
    reads = 1 if max_reads is None else max(1, max_reads)
    frame = None
    ok = False
    with capture_cap_lock:
        if cap is None or not cap.isOpened():
            return False, None
        for _ in range(reads):
            ok_read, candidate = _camera_read(cap, retries=1)
            if not ok_read or candidate is None or not getattr(candidate, "size", 0):
                continue
            ok = True
            frame = candidate
        if not ok:
            ok_read, candidate = _camera_read(cap)
            if ok_read and candidate is not None and getattr(candidate, "size", 0):
                ok = True
                frame = candidate
    return ok, frame


def send_ws_frame(frame: bytes):
    """Queue latest JPEG only — never block the encoder on a slow tunnel send."""
    global _ws_frame_slot
    if not frame:
        return
    with _ws_frame_slot_lock:
        _ws_frame_slot = frame
    _ws_frame_send_event.set()


def upload_stream_frame_http(jpeg: bytes):
    """HTTPS preview cache — skipped when WS is actively sending (avoids duplicate tunnel load)."""
    global _last_http_frame_upload_at, _http_frame_upload_boot, _last_http_upload_error_log_at
    if not STREAM_HTTP_UPLOAD or not jpeg or not BACKEND_BASE_URL:
        return
    if STREAM_HTTP_WS_PRIORITY and ws_authenticated:
        if (time.monotonic() - _last_ws_frame_sent_at) < 3.0:
            return
    now = time.monotonic()
    min_gap = 1.0 / max(1.0, WS_MAX_FPS)
    if now - _last_http_frame_upload_at < min_gap * 0.7:
        return
    _last_http_frame_upload_at = now
    _http_frame_upload_boot += 1

    def _worker():
        global _last_http_upload_error_log_at
        try:
            response = _http_upload_session_get().post(
                f"{BACKEND_BASE_URL}/devices/stream/frame",
                params={"deviceId": DEVICE_ID},
                data=jpeg,
                headers={"Content-Type": "image/jpeg"},
                timeout=4,
            )
            if response.status_code >= 400:
                if time.monotonic() - _last_http_upload_error_log_at > 30:
                    print(f"[PiWS] HTTP frame upload {response.status_code}: {response.text[:120]}")
                    _last_http_upload_error_log_at = time.monotonic()
            elif _http_frame_upload_boot <= 3:
                print(f"[PiWS] HTTP frame upload OK ({len(jpeg)} bytes)")
        except Exception as err:
            if time.monotonic() - _last_http_upload_error_log_at > 30:
                err_text = str(err)
                if "name resolution" in err_text.lower() or "failed to resolve" in err_text.lower():
                    print(
                        "[PiWS] HTTP frame upload DNS fail (WS preview still works) — "
                        "check Pi internet/DNS or set nameserver 8.8.8.8"
                    )
                else:
                    print(f"[PiWS] HTTP frame upload failed: {err_text[:160]}")
                _last_http_upload_error_log_at = time.monotonic()

    threading.Thread(target=_worker, daemon=True).start()


def ws_frame_sender_worker():
    """Send only the newest JPEG over WS (drops stale sends)."""
    global _ws_frame_slot, _last_ws_frame_sent_at
    while not stop_event.is_set():
        if not _ws_frame_send_event.wait(timeout=0.25):
            continue
        _ws_frame_send_event.clear()
        while _ws_frame_send_event.is_set():
            _ws_frame_send_event.clear()

        with _ws_frame_slot_lock:
            jpeg = _ws_frame_slot
            _ws_frame_slot = None
        if not jpeg or not ws_connected or not ws_authenticated or not realtime_ws:
            continue
        try:
            realtime_ws.send(jpeg, opcode=websocket.ABNF.OPCODE_BINARY)
            _touch_ws_activity()
            _last_ws_frame_sent_at = time.monotonic()
        except Exception as err:
            if _is_ws_closed_error(err):
                print(f"[PiWS] WS closed during frame send: {err}")
                _force_ws_reconnect(f"frame send: {err}")


def _signal_preview_encode():
    _preview_encode_event.set()


def preview_encode_send_worker():
    """Encode + send latest frame only — paced to WS_MAX_FPS for steady 2K."""
    global _last_encoded_version
    while not stop_event.is_set():
        if not _preview_encode_event.wait(timeout=0.12):
            continue
        _preview_encode_event.clear()

        drained = True
        while drained and not stop_event.is_set():
            drained = _preview_encode_event.is_set()
            if drained:
                _preview_encode_event.clear()

        if not _preview_encode_lock.acquire(blocking=False):
            _signal_preview_encode()
            continue

        jpeg = None
        version = -1
        try:
            with frame_lock:
                version = _camera_frame_version
                if version == _last_encoded_version or latest_preview_bgr is None:
                    continue
                preview = latest_preview_bgr

            jpeg = encode_stream_jpeg(preview)
            if not jpeg:
                continue

            with frame_lock:
                if version >= _camera_frame_version:
                    _last_encoded_version = version
                elif _camera_frame_version > version:
                    _signal_preview_encode()
                    continue

            send_ws_frame(jpeg)
            upload_stream_frame_http(jpeg)
        finally:
            _preview_encode_lock.release()


def ws_sender_worker():
    """Text-only outbound (presence, commands)."""
    while not stop_event.is_set():
        try:
            kind, payload = ws_outbound.get(timeout=0.5)
        except queue.Empty:
            continue
        if kind != "text":
            continue
        ws = realtime_ws
        if not ws_connected or not ws_authenticated or not ws:
            continue
        try:
            ws.send(payload)
        except Exception as err:
            print(f"[PiWS] WS outbound failed (text): {err}")
            if _is_ws_closed_error(err):
                _force_ws_reconnect(f"outbound text: {err}")


def send_ws_signal(payload: dict):
    """Legacy alias — queue JSON control message."""
    queue_ws_text(json.dumps(payload), drop_if_full=False)


def queue_ws_text(payload: str, drop_if_full: bool = False):
    item = ("text", payload)
    if drop_if_full:
        try:
            ws_outbound.put_nowait(item)
        except queue.Full:
            pass
        return
    while not stop_event.is_set():
        try:
            ws_outbound.put(item, timeout=0.2)
            return
        except queue.Full:
            try:
                dropped_kind, _ = ws_outbound.get_nowait()
                if dropped_kind == "frame":
                    continue
                ws_outbound.put_nowait(item)
                return
            except queue.Empty:
                pass


def send_ws_json(payload) -> bool:
    if not ws_connected or not ws_authenticated:
        return False
    queue_ws_text(json.dumps(payload), drop_if_full=False)
    return True


def send_ws_presence(event_type: str) -> bool:
    message_type = "heartbeat" if event_type == "device_heartbeat" else event_type
    payload = json.dumps({"type": message_type, "payload": device_payload(event_type)})
    ws = realtime_ws
    if ws_connected and ws_authenticated and ws is not None:
        try:
            ws.send(payload)
            _touch_ws_activity()
            return True
        except Exception as err:
            if _is_ws_closed_error(err):
                _force_ws_reconnect(f"presence send: {err}")
            return False
    return send_ws_json({"type": message_type, "payload": device_payload(event_type)})


def _touch_ws_activity():
    global _ws_last_activity_at
    _ws_last_activity_at = time.monotonic()


def _force_ws_reconnect(reason: str):
    global ws_connected, ws_authenticated, realtime_ws, _active_ws_app
    ws_connected = False
    ws_authenticated = False
    ws = realtime_ws
    if ws is not None:
        try:
            ws.close()
        except Exception:
            pass
    app = _active_ws_app
    if app is not None:
        try:
            app.close()
        except Exception:
            pass
    print(f"[PiWS] Auto-reconnect: {reason}")


def extract_text_with_groq(image_bytes: bytes) -> tuple[str, str]:
    """Legacy shim — returns (title, fullText)."""
    ai = ai_extract_document(image_bytes)
    if not ai:
        return "Scanned Document", ""
    title = str(ai.get("title") or "").strip() or "Scanned Document"
    summary = str(ai.get("summary") or "").strip()
    full = str(ai.get("fullText") or "").strip()
    combined = f"SUMMARY: {summary}\n\n{full}".strip() if summary else full
    return title[:120], combined


AI_EXTRACT_PROMPT = (
    "You are a document intake assistant for the Municipal Government of Vinzons, Camarines Norte, Philippines. "
    "You are reading a high-resolution scanned physical document (memo, letter, resolution, ordinance, etc.). "
    "Read every visible printed word carefully — letterhead, reference numbers, body paragraphs, and signature blocks. "
    "Extract its contents accurately and return ONLY a valid JSON object — no markdown, no code fences, no extra text. "
    "JSON keys and what to put in each:\n"
    "  \"title\"        — the document subject line only (short title as written on the document; NOT a summary; "
    "e.g. 'RE: Budget Realignment for FY2026')\n"
    "  \"date\"         — the document date exactly as written (e.g. 'July 8, 2026'); leave '' if not found\n"
    "  \"sender\"       — full name and/or designation/office of the person who signed or authored the document; "
    "leave '' if not found\n"
    "  \"documentType\" — exactly one of: Memorandum, Executive Order, Communication Letter, Proposal, Resolution, "
    "Ordinance, Report, Request, Others\n"
    "  \"summary\"      — 2-3 sentence plain-English summary of what the document says\n"
    "  \"fullText\"     — the complete, corrected, readable text of the document (fix obvious OCR errors; "
    "preserve paragraph structure; include reference numbers and signatory lines when visible)\n"
    "Rules: never invent information; if a field is unclear use an empty string; "
    "Philippine name formats and abbreviations (e.g. 'Hon.', 'Engr.', 'Atty.', 'Municipal Mayor') are normal — preserve them."
)

_DOC_TYPE_MAP = {
    "memorandum": "DT-001",
    "executive order": "DT-002",
    "communication letter": "DT-003",
    "letter": "DT-003",
    "proposal": "DT-004",
    "resolution": "DT-005",
    "ordinance": "DT-006",
    "report": "DT-007",
    "request": "DT-008",
    "others": "DT-009",
    "other": "DT-009",
    "notice": "DT-009",
    "invoice": "DT-009",
}


def _parse_json_lenient(text: str):
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _map_doc_type_id(label: str) -> str:
    key = (label or "").strip().lower()
    if not key:
        return ""
    if key in _DOC_TYPE_MAP:
        return _DOC_TYPE_MAP[key]
    for name, doc_id in _DOC_TYPE_MAP.items():
        if name in key or key in name:
            return doc_id
    return ""


def _normalize_extracted_date(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    for fmt in (
        "%B %d, %Y",
        "%b %d, %Y",
        "%d %B %Y",
        "%d %b %Y",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%Y-%m-%d",
        "%m-%d-%Y",
        "%d-%m-%Y",
    ):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _prepare_vision_jpeg(image_bytes: bytes) -> bytes:
    """HQ upload stays full-res; Groq vision gets a size-safe copy when needed."""
    if not image_bytes:
        return image_bytes
    if len(image_bytes) <= AI_VISION_MAX_BYTES:
        try:
            probe = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if probe is not None and max(probe.shape[:2]) <= AI_VISION_MAX_EDGE:
                return image_bytes
        except Exception:
            return image_bytes

    frame = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return image_bytes

    height, width = frame.shape[:2]
    max_edge = max(height, width)
    if max_edge > AI_VISION_MAX_EDGE:
        scale = AI_VISION_MAX_EDGE / max_edge
        frame = cv2.resize(
            frame,
            (int(width * scale), int(height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    quality = min(SCAN_JPEG_QUALITY, 92)
    vision_jpeg = encode_jpeg(frame, quality, optimize=False)
    while vision_jpeg and len(vision_jpeg) > AI_VISION_MAX_BYTES and quality > 72:
        quality -= 6
        vision_jpeg = encode_jpeg(frame, quality, optimize=False)
    return vision_jpeg or image_bytes


def ai_extract_document(image_bytes: bytes, ocr_text: str = "") -> dict | None:
    """Groq vision/text extraction — title, date, sender, documentType, summary, fullText."""
    if not AI_EXTRACT_ENABLED or not GROQ_API_KEY:
        return None

    use_vision = AI_USE_VISION and bool(image_bytes)
    try:
        if use_vision:
            vision_bytes = _prepare_vision_jpeg(image_bytes)
            image_b64 = base64.b64encode(vision_bytes).decode("ascii")
            messages = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": AI_EXTRACT_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            }]
            model = GROQ_VISION_MODEL
        else:
            if not (ocr_text or "").strip():
                return None
            model = GROQ_TEXT_MODEL
            messages = [
                {"role": "system", "content": AI_EXTRACT_PROMPT},
                {"role": "user", "content": f"Document OCR text:\n\n{ocr_text}"},
            ]

        response = requests.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": AI_EXTRACT_MAX_TOKENS,
                "response_format": {"type": "json_object"},
            },
            timeout=90,
        )
        if response.status_code != 200:
            print(f"[PiWS] Groq API error {response.status_code}: {response.text[:200]}")
            return None
        content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "{}")
        data = _parse_json_lenient(content)
        if not isinstance(data, dict):
            print("[PiWS] Groq returned no parseable JSON.")
            return None
        print(
            "[PiWS] AI extracted -> "
            f"title='{str(data.get('title') or '')[:60]}' "
            f"date='{data.get('date')}' sender='{str(data.get('sender') or '')[:40]}' "
            f"type='{data.get('documentType')}'"
        )
        return data
    except Exception as err:
        print(f"[PiWS] Groq extract failed: {err}")
        return None


def _ai_payload_fields(ai: dict) -> dict:
    title = str(ai.get("title") or "").strip()
    date = str(ai.get("date") or "").strip()
    sender = str(ai.get("sender") or "").strip()
    summary = str(ai.get("summary") or "").strip()
    full = str(ai.get("fullText") or "").strip()
    doc_type_id = _map_doc_type_id(str(ai.get("documentType") or ""))

    combined = ""
    if summary:
        combined += f"SUMMARY: {summary}\n\n"
    combined += full

    payload = {}
    if title:
        payload["subject"] = title[:120]
        payload["extractedTitle"] = title[:120]
    if combined.strip():
        payload["extractedText"] = combined.strip()
        payload["scannedText"] = combined.strip()
    if sender:
        payload["extractedSender"] = sender
    if date:
        payload["extractedDate"] = _normalize_extracted_date(date)
    if doc_type_id:
        payload["documentTypeId"] = doc_type_id
    return payload


def _do_ai_enrich(document_id: str, command_id: str, image_bytes: bytes) -> bool:
    if not (AI_EXTRACT_ENABLED and GROQ_API_KEY and document_id):
        return False
    ai = ai_extract_document(image_bytes)
    if not ai:
        return False
    payload = {
        "deviceId": DEVICE_ID,
        "commandId": command_id,
        **_ai_payload_fields(ai),
    }
    if not payload.get("extractedTitle") and not payload.get("scannedText"):
        return False
    response = requests.put(
        f"{BACKEND_BASE_URL}/devices/scans/{document_id}",
        json=payload,
        headers=DEVICE_HEADERS,
        timeout=30,
    )
    if response.status_code == 200:
        print(f"[PiWS] AI enrich applied to {document_id}")
        return True
    print(f"[PiWS] AI enrich failed {response.status_code}: {response.text[:200]}")
    return False


def start_ai_enrich_async(document_id: str, command_id: str, image_bytes: bytes):
    if not (AI_EXTRACT_ENABLED and GROQ_API_KEY and document_id):
        return

    def _worker():
        _do_ai_enrich(document_id, command_id, image_bytes)

    threading.Thread(target=_worker, daemon=True).start()


def upload_scan(image_bytes: bytes, command_id: str):
    encoded = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "deviceId": DEVICE_ID,
        "officeId": OFFICE_ID,
        "commandId": command_id,
        "subject": "",
        "attachment": {
            "name": f"scan-{int(time.time())}.jpg",
            "type": "image/jpeg",
            "size": len(image_bytes),
            "dataUrl": f"data:image/jpeg;base64,{encoded}",
        },
    }

    extracted = False
    ai_extract_pending = False
    if AI_EXTRACT_ENABLED and GROQ_API_KEY:
        print("[PiWS] Running AI field extraction (Groq vision)...")
        ai = ai_extract_document(image_bytes)
        if ai:
            payload.update(_ai_payload_fields(ai))
            if payload.get("extractedTitle"):
                payload["subject"] = payload["extractedTitle"]
            extracted = bool(payload.get("extractedTitle") or payload.get("scannedText"))
            print(f"[PiWS] AI fields ready for upload (title={'yes' if payload.get('extractedTitle') else 'no'})")
        else:
            print("[PiWS] AI extraction returned no data — upload will use placeholders")
        ai_extract_pending = not extracted

    if ai_extract_pending:
        payload["aiExtractPending"] = True

    response = requests.post(
        f"{BACKEND_BASE_URL}/devices/scans",
        json=payload,
        headers=DEVICE_HEADERS,
        timeout=90,
    )
    response.raise_for_status()
    result = response.json()
    document_id = result.get("documentId") or (result.get("document") or {}).get("id")
    if AI_EXTRACT_ENABLED and GROQ_API_KEY and document_id and not extracted:
        print("[PiWS] Scheduling background AI enrich retry...")
        start_ai_enrich_async(document_id, command_id, image_bytes)
    return result


def update_command_status(command_id: str, status: str, error: str = ""):
    body = {"status": status}
    if error:
        body["errorMessage"] = error
    requests.put(
        f"{BACKEND_BASE_URL}/devices/commands/{command_id}",
        json=body,
        headers=DEVICE_HEADERS,
    ).raise_for_status()


def handle_command_message(message: str):
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        return
    if data.get("type") != "command:pending":
        return

    command = data.get("command") or {}
    cmd_id = command.get("id")
    if not cmd_id:
        return
    if command.get("command") != "SCAN":
        update_command_status(cmd_id, "Failed", "Unsupported command")
        return

    threading.Thread(
        target=_run_scan_command,
        args=(cmd_id, command.get("payload") or {}),
        daemon=True,
    ).start()


def _store_camera_frames(frame, preview):
    global latest_bgr, latest_preview_bgr, _camera_frame_version
    global active_stream_width, active_stream_height
    with frame_lock:
        latest_bgr = frame
        latest_preview_bgr = preview
        if preview is not None and getattr(preview, "shape", None):
            active_stream_height, active_stream_width = preview.shape[:2]
        _camera_frame_version += 1
    _signal_preview_encode()


def stream_producer_worker():
    """Capture camera frames; push JPEG preview over WS + keep scan buffer."""
    global latest_bgr, latest_preview_bgr, active_camera_index
    global active_capture_width, active_capture_height, active_capture_cap, _camera_frame_version

    def try_open_index(index: int, backend):
        cap = cv2.VideoCapture(index, backend)
        try:
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 3000)
        except Exception:
            pass
        if not cap.isOpened():
            cap.release()
            return None

        apply_usb_camera_tuning(cap, device_index=index)
        initialize_camera_autofocus(cap, index)
        frame = read_test_frame(cap)
        if frame is None:
            cap.release()
            return None

        for width, height in capture_resolution_candidates():
            configure_capture(cap, width, height)
            sized = read_test_frame(cap, attempts=3)
            if sized is not None:
                autofocus_settle(cap, index, for_capture=False)
                warmup_camera_frames(cap, max(3, int(CAMERA_WARMUP_SECS * 2)), min_secs=CAMERA_WARMUP_SECS)
                cam_w, cam_h = sized.shape[1], sized.shape[0]
                _log_stream_resolution(cam_w, cam_h, opened=True)
                return cap, index, cam_w, cam_h

        h, w = frame.shape[:2]
        _log_stream_resolution(w, h, opened=True)
        return cap, index, w, h

    def discover_indices():
        capture_nodes = _discover_usb_capture_indices()
        if CAMERA_INDEX_RAW and CAMERA_INDEX_RAW != "auto":
            try:
                preferred = int(CAMERA_INDEX_RAW)
                if capture_nodes:
                    if preferred in capture_nodes:
                        return [preferred] + [i for i in capture_nodes if i != preferred]
                    print(
                        f"[PiWS] /dev/video{preferred} is not a capture node — "
                        f"trying {capture_nodes}"
                    )
                    return capture_nodes
                return [preferred]
            except ValueError:
                pass
        if capture_nodes:
            return capture_nodes
        return list(range(0, CAMERA_SCAN_MAX + 1))

    def opencv_backends():
        # V4L2 only — CAP_ANY probes obsensor/CSI backends and breaks USB webcams.
        if hasattr(cv2, "CAP_V4L2"):
            return [cv2.CAP_V4L2]
        return [cv2.CAP_ANY]

    def run_picamera2_loop():
        global active_camera_index, active_capture_width, active_capture_height
        if not should_try_picamera2():
            return False

        picam2 = None
        try:
            picam2 = Picamera2()
            for width, height in capture_resolution_candidates():
                try:
                    controls = {"FrameRate": CAMERA_FPS}
                    try:
                        from libcamera import controls as lc

                        controls["AwbMode"] = lc.AwbModeEnum.Auto
                        if CAMERA_AUTOFOCUS:
                            controls["AfMode"] = lc.AfModeEnum.Continuous
                    except Exception:
                        pass
                    config = picam2.create_video_configuration(
                        main={"size": (width, height), "format": "RGB888"},
                        controls=controls,
                    )
                    picam2.configure(config)
                    picam2.start()
                    if CAMERA_WARMUP_SECS > 0:
                        time.sleep(CAMERA_WARMUP_SECS)
                    frame = picam2.capture_array("main")
                    if frame is None or getattr(frame, "size", 0) == 0:
                        picam2.stop()
                        continue
                    active_camera_index = "picamera2"
                    active_capture_width = frame.shape[1]
                    active_capture_height = frame.shape[0]
                    _log_stream_resolution(active_capture_width, active_capture_height, opened=True)
                    print(
                        f"[PiWS] Camera opened via picamera2 (CSI) "
                        f"at {active_capture_width}x{active_capture_height}"
                    )
                    break
                except Exception as err:
                    print(f"[PiWS] picamera2 {width}x{height} failed: {err}")
                    try:
                        picam2.stop()
                    except Exception:
                        pass
            else:
                return False

            print(
                f"[PiWS] Camera worker — JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {WS_MAX_FPS}fps"
                f"{' (fast capture)' if STREAM_FAST else ''}"
            )
            frame_interval = (1.0 / WS_MAX_FPS) if WS_MAX_FPS > 0 else 0.0
            last_capture_at = 0.0
            while not stop_event.is_set():
                if _scan_in_progress.is_set():
                    time.sleep(0.02)
                    continue
                now = time.perf_counter()
                if frame_interval > 0 and last_capture_at > 0:
                    wait = frame_interval - (now - last_capture_at)
                    if wait > 0:
                        _frame_pace_sleep(wait)

                frame_rgb = picam2.capture_array("main")
                if frame_rgb is None:
                    time.sleep(0.01)
                    continue
                frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
                preview = _prepare_preview_frame(frame)
                _store_camera_frames(frame, preview)
                last_capture_at = time.perf_counter()
            return True
        except Exception as err:
            print(f"[PiWS] picamera2 unavailable: {err}")
            return False
        finally:
            if picam2 is not None:
                try:
                    picam2.stop()
                except Exception:
                    pass

    cap = None
    opened_index = None
    while not stop_event.is_set():
        cap = None
        opened_index = None
        while not stop_event.is_set() and cap is None:
            for backend in opencv_backends():
                backend_name = "V4L2"
                for idx in discover_indices():
                    opened = try_open_index(idx, backend)
                    if opened is not None:
                        cap, opened_index, active_capture_width, active_capture_height = opened
                        active_camera_index = opened_index
                        active_capture_cap = cap
                        actual_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0) or CAMERA_FPS
                        _log_stream_resolution(active_capture_width, active_capture_height, opened=True)
                        print(
                            f"[PiWS] Camera opened on /dev/video{opened_index} ({backend_name}) "
                            f"at {active_capture_width}x{active_capture_height} @ {actual_fps:.0f}fps"
                        )
                        break
                    else:
                        print(f"[PiWS] /dev/video{idx} ({backend_name}) not readable")
                if cap is not None:
                    break
            if cap is None:
                if run_picamera2_loop():
                    return
                print(
                    "[PiWS] No readable camera device yet, retrying in 2s... "
                    "(USB: ls /dev/video* ; v4l2-ctl --list-devices ; replug webcam)"
                )
                time.sleep(2)

        if cap is None:
            continue

        print(
            f"[PiWS] Camera worker — JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {WS_MAX_FPS}fps"
            f"{' (fast capture)' if STREAM_FAST else ''}"
        )

        frame_interval = (1.0 / WS_MAX_FPS) if WS_MAX_FPS > 0 else 0.0
        last_capture_at = 0.0
        miss_reads = 0
        reopen_camera = False

        while not stop_event.is_set() and not reopen_camera:
            if _scan_in_progress.is_set():
                time.sleep(0.02)
                continue
            now = time.perf_counter()
            if frame_interval > 0 and last_capture_at > 0:
                wait = frame_interval - (now - last_capture_at)
                if wait > 0:
                    _frame_pace_sleep(wait)

            if cap is None or not cap.isOpened():
                reopen_camera = True
                continue

            ok, frame = _drain_latest_frame(cap)
            if not ok or frame is None:
                miss_reads += 1
                if miss_reads >= CAMERA_REOPEN_AFTER_MISSES:
                    preferred = opened_index if opened_index is not None else active_camera_index
                    print(
                        f"[PiWS] Camera read stall ({miss_reads}) — reopening "
                        f"/dev/video{preferred} (stream stays connected)"
                    )
                    with capture_cap_lock:
                        _release_capture(cap)
                        cap = None
                        active_capture_cap = None
                        reopened = None
                        for backend in opencv_backends():
                            if preferred is not None and preferred != "picamera2":
                                reopened = try_open_index(int(preferred), backend)
                            if reopened is not None:
                                break
                        # Never hop to /dev/video1+ on reopen — metadata nodes break USB preview.
                        if reopened is not None:
                            cap, opened_index, active_capture_width, active_capture_height = reopened
                            active_camera_index = opened_index
                            active_capture_cap = cap
                            miss_reads = 0
                            print(
                                f"[PiWS] Camera recovered on /dev/video{opened_index} "
                                f"at {active_capture_width}x{active_capture_height}"
                            )
                            continue
                        print(
                            f"[PiWS] Camera reopen failed on /dev/video{preferred} — "
                            "retrying same index after cooldown"
                        )
                    reopen_camera = True
                    continue

                if miss_reads == CAMERA_RECOVER_AFTER_MISSES or (
                    miss_reads > CAMERA_RECOVER_AFTER_MISSES
                    and miss_reads % CAMERA_RECOVER_AFTER_MISSES == 0
                ):
                    print(
                        f"[PiWS] Camera buffer flush ({miss_reads} misses) — "
                        "keeping preview alive"
                    )
                    if _soft_recover_capture(cap):
                        miss_reads = 0
                        continue

                time.sleep(min(0.004 + (miss_reads * 0.001), 0.03))
                continue

            miss_reads = 0
            preview = _prepare_preview_frame(frame)
            _store_camera_frames(frame, preview)
            last_capture_at = time.perf_counter()

        _release_capture(cap)
        active_capture_cap = None
        cap = None
        if not stop_event.is_set():
            time.sleep(0.35)


def heartbeat_worker():
    while not stop_event.wait(HEARTBEAT_SECS):
        if ws_authenticated:
            send_ws_presence("device_heartbeat")


def handle_realtime_control_message(message: str):
    global ws_authenticated
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        return

    msg_type = data.get("type")
    if msg_type == "auth:ok":
        global _ws_reconnect_delay
        _clear_auth_timer()
        _stop_auth_retry()
        ws_authenticated = True
        _ws_reconnect_delay = 1.0
        _touch_ws_activity()
        print("[PiWS] Backend auth OK — starting stream + heartbeat")
        send_ws_presence("device_connected")
        _signal_preview_encode()
        return
    if msg_type == "auth:error":
        _clear_auth_timer()
        _stop_auth_retry()
        print(f"[PiWS] Backend auth failed: {data.get('message')}")
        print(f"[PiWS] Check DIGIPATH_DEVICE_API_KEY matches backend DEVICE_API_KEY (got {_mask_secret(DEVICE_API_KEY)})")
        _force_ws_reconnect("auth failed")
        return
    if msg_type == "presence:error":
        print(f"[PiWS] Presence error: {data.get('message')}")
        return
    if msg_type == "command:pending":
        handle_command_message(message)
        return


def on_realtime_open(ws):
    global ws_connected, ws_authenticated, realtime_ws
    ws_connected = True
    ws_authenticated = False
    realtime_ws = ws
    _touch_ws_activity()
    ws.send(json.dumps({"type": "auth", "deviceId": DEVICE_ID, "apiKey": DEVICE_API_KEY}))
    print(f"[PiWS] WebSocket connected to {ws_url()} — waiting for auth:ok")
    print(f"[PiWS] Device {DEVICE_ID}, apiKey={_mask_secret(DEVICE_API_KEY)}")
    if DEVTUNNEL_TOKEN:
        print("[PiWS] Using DIGIPATH_DEVTUNNEL_TOKEN for tunnel authorization")
    _start_auth_timer()
    _start_auth_retry(ws)


def on_realtime_message(_ws, message):
    _touch_ws_activity()
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    if not isinstance(message, str) or not message.strip():
        return
    if not ws_authenticated:
        preview = message if len(message) < 240 else f"{message[:240]}..."
        print(f"[PiWS] WS control: {preview}")
    handle_realtime_control_message(message)


def on_realtime_close(_ws, close_status_code, close_msg):
    global ws_connected, ws_authenticated, realtime_ws
    _clear_auth_timer()
    _stop_auth_retry()
    ws_connected = False
    ws_authenticated = False
    realtime_ws = None
    print(
        f"[PiWS] WebSocket disconnected ({close_status_code or 'n/a'}): "
        f"{close_msg or 'closed'} — auto-reconnect pending"
    )


def on_realtime_error(_ws, error):
    print(f"[PiWS] WebSocket error: {error} — auto-reconnect pending")
    try:
        _ws.close()
    except Exception:
        pass


def ws_health_watchdog():
    """Reconnect if the WS link goes idle while we should still be streaming."""
    while not stop_event.wait(5):
        if not ws_connected or not ws_authenticated:
            continue
        idle = time.monotonic() - _ws_last_activity_at
        if idle > WS_STALE_SECS:
            _force_ws_reconnect(f"stale link ({idle:.0f}s idle)")


def realtime_worker():
    global ws_connected, ws_authenticated, realtime_ws, _ws_reconnect_delay, _active_ws_app
    while not stop_event.is_set():
        try:
            ws_app = websocket.WebSocketApp(
                ws_url(),
                header=ws_connect_headers(),
                on_open=on_realtime_open,
                on_message=on_realtime_message,
                on_close=on_realtime_close,
                on_error=on_realtime_error,
            )
            _active_ws_app = ws_app
            run_kwargs = {
                "skip_utf8_validation": True,
                "sockopt": [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)],
            }
            if WS_PING_INTERVAL > 0:
                run_kwargs["ping_interval"] = WS_PING_INTERVAL
                run_kwargs["ping_timeout"] = WS_PING_TIMEOUT
            ws_app.run_forever(**run_kwargs)
        except Exception as err:
            print(f"[PiWS] Connection loop error: {err}")

        _active_ws_app = None
        ws_connected = False
        ws_authenticated = False
        realtime_ws = None
        if stop_event.is_set():
            break

        delay = max(1.0, _ws_reconnect_delay)
        print(f"[PiWS] Auto-reconnect in {delay:.0f}s...")
        if stop_event.wait(delay):
            break
        _ws_reconnect_delay = min(_ws_reconnect_delay * 1.4, WS_RECONNECT_MAX_SECS)


def run():
    if not BACKEND_BASE_URL:
        raise RuntimeError("Missing DIGIPATH_BACKEND_BASE_URL")

    print(f"[PiWS] Starting bridge: {ws_url()}")
    if AI_EXTRACT_ENABLED and not GROQ_API_KEY:
        print(
            "[PiWS] WARNING: DIGIPATH_AI_EXTRACT=1 but DIGIPATH_GROQ_API_KEY is empty — "
            "subject/sender/date/type will NOT auto-fill. Add your Groq key to .env"
        )
    elif AI_EXTRACT_ENABLED:
        print(
            f"[PiWS] AI extract: vision={int(AI_USE_VISION)} model={GROQ_VISION_MODEL} "
            f"background={int(AI_EXTRACT_BACKGROUND)} max_tokens={AI_EXTRACT_MAX_TOKENS}"
        )
    fast_label = (
        f"fast preview-first ({PREVIEW_WIDTH}x{PREVIEW_HEIGHT})"
        if STREAM_FAST
        else f"{FRAME_WIDTH}x{FRAME_HEIGHT}"
    )
    print(
        f"[PiWS] Tuning: capture {fast_label}, "
        f"scan {SCAN_WIDTH}x{SCAN_HEIGHT} landscape "
        f"q={SCAN_JPEG_QUALITY} enhance={int(SCAN_ENHANCE)} burst={SCAN_BURST_FRAMES}, "
        f"JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {WS_MAX_FPS}fps, "
        f"preview_rotate={PREVIEW_ROTATE}, "
        f"capture_match_preview={int(CAPTURE_MATCH_PREVIEW)}, "
        f"heartbeat={HEARTBEAT_SECS}s"
    )

    threading.Thread(target=stream_producer_worker, daemon=True).start()
    threading.Thread(target=preview_encode_send_worker, daemon=True).start()
    threading.Thread(target=ws_frame_sender_worker, daemon=True).start()
    threading.Thread(target=ws_sender_worker, daemon=True).start()
    threading.Thread(target=ws_health_watchdog, daemon=True).start()
    threading.Thread(target=heartbeat_worker, daemon=True).start()
    realtime_worker()


def shutdown(*_):
    stop_event.set()
    if ws_authenticated:
        send_ws_presence("device_disconnected")
    _force_ws_reconnect("shutdown")
    print(f"[PiWS] stopped at {datetime.now().isoformat()}")


if __name__ == "__main__":
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    run()
