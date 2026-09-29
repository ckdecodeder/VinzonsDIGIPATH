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
from collections import deque
from contextlib import contextmanager
from datetime import datetime

# Quieter OpenCV logs; libjpeg MJPEG warnings are handled separately in _camera_read().
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np
import requests
import websocket

from digipath_mechanism import (
    get_mechanism,
    mechanism_home_on_startup,
    mechanism_start_door_monitor,
    mechanism_startup_self_test,
    resolve_sort_layer,
)

PI_CODE_VERSION = "2026-09-30-lift-hold"
BACKEND_BASE_URL = os.environ.get("DIGIPATH_BACKEND_BASE_URL", "").rstrip("/")
DEVICE_ID = os.environ.get("DIGIPATH_DEVICE_ID", "DEV-001")
DEVICE_API_KEY = os.environ.get("DIGIPATH_DEVICE_API_KEY", "dev-device-key-change-me")
OFFICE_ID = os.environ.get("DIGIPATH_OFFICE_ID", "OFF-001")
CAMERA_INDEX_RAW = os.environ.get("DIGIPATH_CAMERA_INDEX", "auto").strip().lower()
CAMERA_SCAN_MAX = max(0, int(os.environ.get("DIGIPATH_CAMERA_SCAN_MAX", "8")))
USE_PICAMERA2_RAW = os.environ.get("DIGIPATH_USE_PICAMERA2", "auto").strip().lower()
FRAME_WIDTH = int(os.environ.get("DIGIPATH_STREAM_WIDTH", "2560"))
FRAME_HEIGHT = int(os.environ.get("DIGIPATH_STREAM_HEIGHT", "1440"))
PREVIEW_WIDTH = int(os.environ.get("DIGIPATH_PREVIEW_WIDTH", "1920"))
PREVIEW_HEIGHT = int(os.environ.get("DIGIPATH_PREVIEW_HEIGHT", "1080"))
SCAN_WIDTH = int(os.environ.get("DIGIPATH_SCAN_WIDTH", str(PREVIEW_WIDTH)))
SCAN_HEIGHT = int(os.environ.get("DIGIPATH_SCAN_HEIGHT", str(PREVIEW_HEIGHT)))
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
STREAM_JPEG_MIN_QUALITY = max(35, int(os.environ.get("DIGIPATH_STREAM_JPEG_MIN_QUALITY", "40")))
WS_MAX_FPS = min(120.0, max(1.0, float(os.environ.get("DIGIPATH_STREAM_WS_MAX_FPS", "12"))))
STREAM_ADAPTIVE = os.environ.get("DIGIPATH_STREAM_ADAPTIVE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
STREAM_ADAPTIVE_MIN_FPS = max(4.0, float(os.environ.get("DIGIPATH_STREAM_ADAPTIVE_MIN_FPS", "10")))
STREAM_ADAPTIVE_MAX_FPS = min(
    120.0,
    max(STREAM_ADAPTIVE_MIN_FPS, float(os.environ.get("DIGIPATH_STREAM_ADAPTIVE_MAX_FPS", str(WS_MAX_FPS)))),
)
STREAM_ADAPTIVE_TICK_SECS = max(1.5, float(os.environ.get("DIGIPATH_STREAM_ADAPTIVE_TICK_SECS", "3")))
STREAM_SEND_INTERVAL = (1.0 / WS_MAX_FPS) if WS_MAX_FPS > 0 else 0.05
STREAM_BUFFER_FRAMES = max(1, int(os.environ.get("DIGIPATH_STREAM_BUFFER_FRAMES", "1")))
STREAM_DRIVER_DRAIN = max(1, int(os.environ.get("DIGIPATH_STREAM_DRIVER_DRAIN", "3")))
CAMERA_READ_TIMEOUT_MS = max(500, int(os.environ.get("DIGIPATH_CAMERA_READ_TIMEOUT_MS", "4000")))
CAMERA_READ_RETRIES = max(1, int(os.environ.get("DIGIPATH_CAMERA_READ_RETRIES", "2")))
AUTO_CROP_PAPER = os.environ.get("DIGIPATH_AUTO_CROP_PAPER", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
AUTO_CROP_MIN_AREA = max(0.08, min(0.8, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_AREA", "0.12"))))
# Reject near-full-frame boxes (walls/room) but allow large paper close to camera.
AUTO_CROP_MAX_AREA = max(0.35, min(0.95, float(os.environ.get("DIGIPATH_AUTO_CROP_MAX_AREA", "0.88"))))
AUTO_CROP_DETECT_EVERY = max(1, int(os.environ.get("DIGIPATH_AUTO_CROP_DETECT_EVERY", "3")))
# Lower = smoother live crop (less jitter). 0.10–0.15 is usually best.
AUTO_CROP_SMOOTHING = max(0.05, min(1.0, float(os.environ.get("DIGIPATH_AUTO_CROP_SMOOTHING", "0.12"))))
AUTO_CROP_MAX_MISSES = max(1, int(os.environ.get("DIGIPATH_AUTO_CROP_MAX_MISSES", "3")))
AUTO_CROP_LOCK_HITS = max(1, int(os.environ.get("DIGIPATH_AUTO_CROP_LOCK_HITS", "2")))
AUTO_CROP_PAD_RATIO = max(0.0, min(0.08, float(os.environ.get("DIGIPATH_AUTO_CROP_PAD_RATIO", "0.008"))))
AUTO_CROP_ASPECT_MIN = max(0.35, float(os.environ.get("DIGIPATH_AUTO_CROP_ASPECT_MIN", "0.55")))
AUTO_CROP_ASPECT_MAX = min(2.2, float(os.environ.get("DIGIPATH_AUTO_CROP_ASPECT_MAX", "1.85")))
AUTO_CROP_MIN_BRIGHTNESS = max(40.0, min(220.0, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_BRIGHTNESS", "70"))))
AUTO_CROP_REQUIRE_BRIGHT = os.environ.get("DIGIPATH_AUTO_CROP_REQUIRE_BRIGHT", "0").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
# Soft preference — hard-reject only when paper is darker than background.
AUTO_CROP_MIN_CONTRAST = max(0.0, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_CONTRAST", "8")))
AUTO_CROP_MIN_SCORE = max(0.0, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_SCORE", "2.2")))
# HSV gates (0-255): paper must be low-saturation (white/gray) and reasonably bright.
AUTO_CROP_MAX_SATURATION = max(10.0, min(255.0, float(os.environ.get("DIGIPATH_AUTO_CROP_MAX_SATURATION", "70"))))
AUTO_CROP_MIN_PAPER_VALUE = max(0.0, min(255.0, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_PAPER_VALUE", "160"))))
AUTO_CROP_SIZE_LOCK = os.environ.get("DIGIPATH_AUTO_CROP_SIZE_LOCK", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
AUTO_CROP_SIZE_SMOOTHING = max(0.02, min(0.4, float(os.environ.get("DIGIPATH_AUTO_CROP_SIZE_SMOOTHING", "0.06"))))
AUTO_CROP_REFINE = os.environ.get("DIGIPATH_AUTO_CROP_REFINE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
# Reject tiny false locks (hand / UI tile) — document must cover enough of the camera.
AUTO_CROP_MIN_FRAME_COVERAGE = max(0.10, min(0.9, float(os.environ.get("DIGIPATH_AUTO_CROP_MIN_FRAME_COVERAGE", "0.14"))))
AUTO_CROP_MIN_EDGE_PX = max(200, int(os.environ.get("DIGIPATH_AUTO_CROP_MIN_EDGE_PX", "360")))
# Live preview: crop = show the warped document (WYSIWYG). overlay = full cam + green box.
# both = cropped view with a small border.
AUTO_CROP_LIVE_MODE = os.environ.get("DIGIPATH_AUTO_CROP_LIVE_MODE", "crop").strip().lower()
if AUTO_CROP_LIVE_MODE not in ("overlay", "crop", "both"):
    AUTO_CROP_LIVE_MODE = "crop"
PREVIEW_SHADOW_LIFT = os.environ.get("DIGIPATH_PREVIEW_SHADOW_LIFT", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
PREVIEW_SHADOW_MEAN_LIMIT = max(20.0, min(160.0, float(os.environ.get("DIGIPATH_PREVIEW_SHADOW_MEAN_LIMIT", "105"))))
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
CAMERA_WARMUP_SECS = max(0.0, float(os.environ.get("DIGIPATH_CAMERA_WARMUP_SECS", "0.15")))
SCAN_WARMUP_FRAMES = max(1, int(os.environ.get("DIGIPATH_SCAN_WARMUP_FRAMES", "2")))
SCAN_BURST_FRAMES = max(1, int(os.environ.get("DIGIPATH_SCAN_BURST_FRAMES", "1")))
SCAN_CAPTURE_DRAIN = max(1, int(os.environ.get("DIGIPATH_SCAN_CAPTURE_DRAIN", "2")))
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
CAMERA_AUTO_EXPOSURE = os.environ.get("DIGIPATH_CAMERA_AUTO_EXPOSURE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
CAMERA_AUTO_WB = os.environ.get("DIGIPATH_CAMERA_AUTO_WB", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
CAMERA_BACKLIGHT_COMP = os.environ.get("DIGIPATH_CAMERA_BACKLIGHT_COMP", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
FOCUS_SETTLE_SECS = max(0.0, float(os.environ.get("DIGIPATH_FOCUS_SETTLE_SECS", "0.15")))
FOCUS_TRIGGER_ON_CAPTURE = os.environ.get("DIGIPATH_FOCUS_TRIGGER_ON_CAPTURE", "0").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
# Instant capture: use the live preview frame already on screen (no AF wait / burst).
CAPTURE_INSTANT = os.environ.get("DIGIPATH_CAPTURE_INSTANT", "1").strip().lower() not in (
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
active_v4l2_image_devices: list[str] = []
camera_focus_status = "unknown"
active_stream_width = PREVIEW_WIDTH
active_stream_height = PREVIEW_HEIGHT
capture_cap_lock = threading.RLock()
_scan_in_progress = threading.Event()
_scan_upload_busy = threading.Event()
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
_ws_offline_since = None
_ws_last_reconnect_kick_at = 0.0
WS_STALE_SECS = max(15.0, float(os.environ.get("DIGIPATH_WS_STALE_SECS", "60")))
WS_RECONNECT_MAX_SECS = max(1.0, float(os.environ.get("DIGIPATH_WS_RECONNECT_MAX_SECS", "5")))
WS_RECONNECT_MIN_SECS = max(0.5, float(os.environ.get("DIGIPATH_WS_RECONNECT_MIN_SECS", "1")))
WS_PING_INTERVAL = int(os.environ.get("DIGIPATH_WS_PING_INTERVAL", "20"))
WS_PING_TIMEOUT = max(5, int(os.environ.get("DIGIPATH_WS_PING_TIMEOUT", "10")))
# websocket-client refuses to connect at all unless ping_interval > ping_timeout.
if WS_PING_INTERVAL > 0 and WS_PING_TIMEOUT >= WS_PING_INTERVAL:
    WS_PING_INTERVAL = max(WS_PING_INTERVAL, 12)
    WS_PING_TIMEOUT = WS_PING_INTERVAL // 2
WS_OFFLINE_KICK_SECS = max(5.0, float(os.environ.get("DIGIPATH_WS_OFFLINE_KICK_SECS", "15")))
STREAM_HTTP_UPLOAD_RAW = os.environ.get("DIGIPATH_STREAM_HTTP_UPLOAD", "auto").strip().lower()
STREAM_HTTP_UPLOAD = STREAM_HTTP_UPLOAD_RAW not in ("0", "false", "no", "off")
STREAM_HTTP_WS_PRIORITY = STREAM_HTTP_UPLOAD_RAW in ("auto", "ws", "1", "true", "yes", "on")
_last_http_frame_upload_at = 0.0
_http_frame_upload_boot = 0
_http_upload_session = None
_http_upload_lock = threading.Lock()
_http_upload_inflight = False
_http_upload_pending: bytes | None = None
_last_ws_frame_sent_at = 0.0
_last_ws_jpeg_sent: bytes | None = None
_last_ws_jpeg_lock = threading.Lock()
_auto_crop_frame_count = 0
_last_paper_quad = None
_last_paper_shape = None
_last_paper_output_size = None
_auto_crop_misses = 0
_auto_crop_hits = 0
_auto_crop_last_log_at = 0.0
_auto_crop_was_locked = False
_adaptive_lock = threading.Lock()
_adaptive_fps = WS_MAX_FPS
_adaptive_jpeg_quality = PREVIEW_JPEG_QUALITY
_adaptive_jpeg_max_bytes = STREAM_JPEG_MAX_BYTES
_backend_pressure = 0.0
_consumer_paint_fps = 0.0
_ws_send_samples = 0
_ws_send_slow = 0
_last_adaptive_tick_at = 0.0
_last_adaptive_log_at = 0.0
_adaptive_hold_until = 0.0
STREAM_POST_SCAN_HOLD_SECS = 10.0
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
            "websocketConnected": bool(ws_connected and ws_authenticated),
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
            "previewFps": _effective_stream_fps(),
            "adaptiveStream": STREAM_ADAPTIVE,
            "adaptiveStreamFps": _effective_stream_fps(),
            "autofocus": camera_focus_status,
            "mechanism": _safe_mechanism_status(),
            "piCodeVersion": PI_CODE_VERSION,
            "wsLastIssue": _ws_last_issue,
        },
    }


def _safe_mechanism_status() -> dict:
    try:
        return get_mechanism().status_dict()
    except Exception as err:
        return {"enabled": False, "initError": f"mechanism status error: {err}"}


def _effective_stream_fps() -> float:
    # Free tunnel bandwidth for heartbeats/pings while a scan JPEG uploads.
    if _scan_upload_busy.is_set() or _scan_in_progress.is_set():
        return 1.0
    if not STREAM_ADAPTIVE:
        return WS_MAX_FPS
    with _adaptive_lock:
        return _adaptive_fps


def _effective_preview_jpeg_quality() -> int:
    if not STREAM_ADAPTIVE:
        return PREVIEW_JPEG_QUALITY
    with _adaptive_lock:
        return int(_adaptive_jpeg_quality)


def _effective_jpeg_max_bytes() -> int:
    if not STREAM_ADAPTIVE:
        return STREAM_JPEG_MAX_BYTES
    with _adaptive_lock:
        return int(_adaptive_jpeg_max_bytes)


_last_ws_send_ms = 0.0
_last_ws_send_done_at = 0.0


def _record_ws_send_sample(elapsed_ms: float):
    global _ws_send_samples, _ws_send_slow, _last_ws_send_ms, _last_ws_send_done_at
    _last_ws_send_ms = elapsed_ms
    _last_ws_send_done_at = time.monotonic()
    with _adaptive_lock:
        _ws_send_samples = min(_ws_send_samples + 1, 40)
        if elapsed_ms > 60.0:
            _ws_send_slow = min(_ws_send_slow + 1, 40)


def _apply_stream_hint(data: dict):
    global _backend_pressure, _consumer_paint_fps
    with _adaptive_lock:
        _backend_pressure = max(0.0, min(1.0, float(data.get("pressure") or 0)))
        consumer = float(data.get("consumerFps") or 0)
        if consumer > 0:
            _consumer_paint_fps = consumer


def _adaptive_stream_tick():
    """Raise/lower fps + JPEG size based on WS health and backend backpressure."""
    global _adaptive_fps, _adaptive_jpeg_quality, _adaptive_jpeg_max_bytes
    global _ws_send_samples, _ws_send_slow, _last_adaptive_tick_at, _last_adaptive_log_at

    if not STREAM_ADAPTIVE:
        return

    now = time.monotonic()
    if now - _last_adaptive_tick_at < STREAM_ADAPTIVE_TICK_SECS:
        return
    _last_adaptive_tick_at = now

    # The scan upload deliberately throttles the stream to 1 fps; judging the link
    # during that window (or right after) would permanently blur the live feed.
    if _scan_upload_busy.is_set() or _scan_in_progress.is_set() or now < _adaptive_hold_until:
        with _adaptive_lock:
            _ws_send_samples = 0
            _ws_send_slow = 0
        return

    with _adaptive_lock:
        # link_score: real transport trouble (slow WS sends, backend backlog, stalls).
        link_score = 0.0
        if _ws_send_samples > 0:
            slow_ratio = _ws_send_slow / _ws_send_samples
            link_score -= slow_ratio * 0.45
        link_score -= _backend_pressure * 0.4
        if _last_ws_frame_sent_at > 0 and (now - _last_ws_frame_sent_at) > 2.5:
            link_score -= 0.35

        utilization = None
        target_fps = _adaptive_fps
        if _consumer_paint_fps > 0 and target_fps > 0:
            utilization = _consumer_paint_fps / target_fps

        prev_fps = _adaptive_fps
        prev_q = _adaptive_jpeg_quality
        prev_bytes = _adaptive_jpeg_max_bytes

        if link_score < -0.2:
            _adaptive_jpeg_quality = max(STREAM_JPEG_MIN_QUALITY, _adaptive_jpeg_quality - 4)
            _adaptive_jpeg_max_bytes = max(
                max(60_000, int(STREAM_JPEG_MAX_BYTES * 0.6)),
                int(_adaptive_jpeg_max_bytes * 0.85),
            )
        elif link_score >= -0.05:
            _adaptive_jpeg_quality = min(PREVIEW_JPEG_QUALITY, _adaptive_jpeg_quality + 2)
            _adaptive_jpeg_max_bytes = min(
                STREAM_JPEG_MAX_BYTES,
                int(_adaptive_jpeg_max_bytes * 1.06) + 8000,
            )

        # A slow viewer only costs fps, never sharpness.
        if link_score < -0.35 or (utilization is not None and utilization < 0.55):
            _adaptive_fps = max(STREAM_ADAPTIVE_MIN_FPS, _adaptive_fps - 1.0)
        elif link_score >= -0.05 and (utilization is None or utilization >= 0.9):
            _adaptive_fps = min(STREAM_ADAPTIVE_MAX_FPS, _adaptive_fps + 1.0)

        _ws_send_samples = 0
        _ws_send_slow = 0

        changed = (
            int(prev_fps) != int(_adaptive_fps)
            or prev_q != _adaptive_jpeg_quality
            or abs(prev_bytes - _adaptive_jpeg_max_bytes) > 12_000
        )
        if changed and (now - _last_adaptive_log_at) > 8.0:
            _last_adaptive_log_at = now
            print(
                f"[PiWS] Adaptive stream -> {_adaptive_fps:.0f}fps "
                f"q{_adaptive_jpeg_quality} max={_adaptive_jpeg_max_bytes // 1000}KB "
                f"(pressure={_backend_pressure:.2f} consumer={_consumer_paint_fps:.0f}fps)"
            )


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
    """Fast preview JPEG — adaptive quality/size cap for network conditions."""
    if frame is None:
        return None
    max_bytes = _effective_jpeg_max_bytes()
    base_quality = _effective_preview_jpeg_quality()
    jpeg = encode_jpeg(frame, base_quality, optimize=False)
    if jpeg and len(jpeg) <= max_bytes:
        return jpeg
    for quality in range(base_quality - 6, STREAM_JPEG_MIN_QUALITY - 1, -6):
        jpeg = encode_jpeg(frame, quality, optimize=False)
        if jpeg and len(jpeg) <= max_bytes:
            return jpeg
    return jpeg


def _frame_pace_sleep(remaining_secs: float):
    time.sleep(min(max(remaining_secs, 0.0), 0.008 if _effective_stream_fps() >= 45 else 0.02))


def _order_paper_points(points):
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    total = points.sum(axis=1)
    diff = np.diff(points, axis=1).reshape(4)
    return np.array(
        [points[np.argmin(total)], points[np.argmin(diff)], points[np.argmax(total)], points[np.argmax(diff)]],
        dtype=np.float32,
    )


def _quad_from_contour(contour, image_area: float):
    """Return ordered 4-point quad + score extras, or None."""
    area = float(cv2.contourArea(contour))
    area_ratio = area / image_area if image_area else 0.0
    if area_ratio < AUTO_CROP_MIN_AREA or area_ratio > AUTO_CROP_MAX_AREA:
        return None
    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return None

    polygon = None
    used_min_area_rect = False
    for eps in (0.015, 0.02, 0.028, 0.04):
        approx = cv2.approxPolyDP(contour, eps * perimeter, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            polygon = approx.reshape(4, 2).astype(np.float32)
            break
    if polygon is None:
        # Near-rectangle fallback — only for mid-sized blobs (not whole-room edges).
        if area_ratio > 0.70:
            return None
        rect = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rect).astype(np.float32)
        rect_area = max(1.0, float(abs(rect[1][0] * rect[1][1])))
        if area / rect_area < 0.80:
            return None
        polygon = box
        used_min_area_rect = True

    if not cv2.isContourConvex(polygon.astype(np.float32)):
        return None

    ordered = _order_paper_points(polygon)
    top_left, top_right, bottom_right, bottom_left = ordered
    width = float(max(np.linalg.norm(top_right - top_left), np.linalg.norm(bottom_right - bottom_left)))
    height = float(max(np.linalg.norm(bottom_left - top_left), np.linalg.norm(bottom_right - top_right)))
    if width < 80 or height < 80:
        return None
    aspect = width / max(1.0, height)
    aspect_ok = (AUTO_CROP_ASPECT_MIN <= aspect <= AUTO_CROP_ASPECT_MAX) or (
        AUTO_CROP_ASPECT_MIN <= (1.0 / aspect) <= AUTO_CROP_ASPECT_MAX
    )
    if not aspect_ok:
        return None

    x, y, box_w, box_h = cv2.boundingRect(ordered.astype(np.int32))
    rectangularity = area / max(1.0, float(box_w * box_h))
    min_rect = 0.62 if used_min_area_rect else 0.55
    if rectangularity < min_rect:
        return None

    return {
        "quad": ordered,
        "area": area,
        "area_ratio": area_ratio,
        "rectangularity": rectangularity,
        "aspect": aspect,
        "width": width,
        "height": height,
    }


def _paper_brightness_score(gray_small, quad) -> float:
    """Prefer bright paper interiors vs darker desk/room background."""
    mask = np.zeros(gray_small.shape, dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 255)
    inside = gray_small[mask > 0]
    if inside.size < 80:
        return 0.0
    mean_in = float(np.mean(inside))
    outside = gray_small[mask == 0]
    coverage = float(inside.size) / float(max(1, gray_small.size))
    # Near-full-frame "paper" (room walls) — hard reject.
    if coverage > AUTO_CROP_MAX_AREA or outside.size < max(80, int(gray_small.size * 0.06)):
        return 0.0
    mean_out = float(np.mean(outside))
    contrast = mean_in - mean_out
    # Hard reject only if the region is darker than its surroundings (not paper).
    if contrast < -8.0:
        return 0.0
    if AUTO_CROP_REQUIRE_BRIGHT and mean_in < AUTO_CROP_MIN_BRIGHTNESS and contrast < AUTO_CROP_MIN_CONTRAST:
        return 0.0
    score = mean_in + max(0.0, contrast) * 1.4
    if mean_in < AUTO_CROP_MIN_BRIGHTNESS:
        score *= 0.72
    if contrast < AUTO_CROP_MIN_CONTRAST:
        score *= 0.78
    return max(1.0, score)


def _paper_color_ok(hsv_small, quad) -> bool:
    """Paper is bright and nearly colorless; wood, boards and desks are not."""
    if hsv_small is None:
        return True
    mask = np.zeros(hsv_small.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 255)
    inside = hsv_small[mask > 0]
    if inside.size < 80:
        return False
    mean_sat = float(np.mean(inside[:, 1]))
    mean_val = float(np.mean(inside[:, 2]))
    return mean_sat <= AUTO_CROP_MAX_SATURATION and mean_val >= AUTO_CROP_MIN_PAPER_VALUE


def _paper_center_score(quad, width: int, height: int) -> float:
    center = quad.mean(axis=0)
    dx = abs((center[0] / max(1.0, width)) - 0.5)
    dy = abs((center[1] / max(1.0, height)) - 0.5)
    return max(0.0, 1.0 - (dx + dy) * 1.6)


def _collect_edge_maps(gray):
    """Fewer maps = much lower CPU on Pi (was 7 maps/frame → laggy feed)."""
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    kernel = np.ones((5, 5), dtype=np.uint8)
    maps = []
    for low, high in ((30, 110), (45, 150)):
        edges = cv2.Canny(blurred, low, high)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        maps.append(edges)
    # Bright-paper mask helps when desk is dark
    adaptive = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, -6
    )
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = cv2.bitwise_or(adaptive, otsu)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, kernel, iterations=2)
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, kernel, iterations=1)
    maps.append(bright)
    return maps


def _detect_paper_quad_simple(gray, image_area: float, scale: float, hsv=None):
    """Reliable fallback — largest convex 4-gon that still looks like paper."""
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 45, 150)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), dtype=np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_area = 0.0
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:25]:
        area = float(cv2.contourArea(contour))
        area_ratio = area / image_area if image_area else 0.0
        if area_ratio < AUTO_CROP_MIN_AREA or area_ratio > AUTO_CROP_MAX_AREA:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        for eps in (0.02, 0.03, 0.04):
            polygon = cv2.approxPolyDP(contour, eps * perimeter, True)
            if len(polygon) != 4 or not cv2.isContourConvex(polygon):
                continue
            ordered = _order_paper_points(polygon.reshape(4, 2).astype(np.float32))
            x, y, box_w, box_h = cv2.boundingRect(ordered.astype(np.int32))
            if box_w < 80 or box_h < 80:
                continue
            if area / max(1.0, float(box_w * box_h)) < 0.55:
                continue
            aspect = float(box_w) / max(1.0, float(box_h))
            aspect_ok = (AUTO_CROP_ASPECT_MIN <= aspect <= AUTO_CROP_ASPECT_MAX) or (
                AUTO_CROP_ASPECT_MIN <= (1.0 / aspect) <= AUTO_CROP_ASPECT_MAX
            )
            if not aspect_ok:
                continue
            if _paper_brightness_score(gray, ordered) <= 0:
                continue
            if not _paper_color_ok(hsv, ordered):
                continue
            if area > best_area:
                best = ordered
                best_area = area
            break
    if best is None:
        return None
    return _order_paper_points(best / scale)


def _is_plausible_paper_quad(quad, frame_shape) -> bool:
    """Reject tiny false locks and giant room-edge locks."""
    if quad is None:
        return False
    height, width = frame_shape[:2]
    frame_area = float(max(1, width * height))
    qw, qh = _quad_dims(quad)
    coverage = (qw * qh) / frame_area
    if coverage < AUTO_CROP_MIN_FRAME_COVERAGE:
        return False
    if coverage > AUTO_CROP_MAX_AREA:
        return False
    if max(qw, qh) < AUTO_CROP_MIN_EDGE_PX:
        return False
    if min(qw, qh) < max(160, int(AUTO_CROP_MIN_EDGE_PX * 0.45)):
        return False
    # Must not be a thin strip
    aspect = qw / max(1, qh)
    if aspect < 0.4 or aspect > 2.5:
        return False
    return True


def _detect_paper_quad(frame):
    if not AUTO_CROP_PAPER or frame is None or getattr(frame, "size", 0) == 0:
        return None
    height, width = frame.shape[:2]
    scale = min(1.0, 960.0 / max(height, width))
    small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else frame
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    image_area = float(small.shape[0] * small.shape[1])
    sh, sw = gray.shape[:2]

    best = None
    best_score = -1.0
    seen = set()

    for edge_map in _collect_edge_maps(gray):
        contours, _ = cv2.findContours(edge_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:40]
        for contour in contours:
            candidate = _quad_from_contour(contour, image_area)
            if candidate is None:
                continue
            key = tuple(np.round(candidate["quad"]).astype(int).reshape(-1).tolist())
            if key in seen:
                continue
            seen.add(key)
            brightness = _paper_brightness_score(gray, candidate["quad"])
            if brightness <= 0:
                continue
            if not _paper_color_ok(hsv, candidate["quad"]):
                continue
            center = _paper_center_score(candidate["quad"], sw, sh)
            aspect_bonus = 1.0 - min(abs(candidate["aspect"] - 0.77), abs(candidate["aspect"] - 1.29)) * 0.35
            score = (
                candidate["area_ratio"] * 3.2
                + candidate["rectangularity"] * 2.4
                + (brightness / 255.0) * 2.0
                + center * 1.3
                + max(0.0, aspect_bonus)
            )
            if score > best_score:
                best_score = score
                best = candidate["quad"]

    if best is None or best_score < AUTO_CROP_MIN_SCORE:
        simple = _detect_paper_quad_simple(gray, image_area, scale, hsv)
        if simple is None or not _is_plausible_paper_quad(simple, frame.shape):
            return None
        # Re-check brightness on full-res-ish gray for the simple path too
        simple_small = (simple * scale).astype(np.float32) if scale < 1 else simple
        if _paper_brightness_score(gray, simple_small) <= 0:
            return None
        return _refine_paper_corners(frame, simple)

    full_quad = _order_paper_points(best / scale)
    refined = _refine_paper_corners(frame, full_quad)
    if not _is_plausible_paper_quad(refined, frame.shape):
        return None
    return refined


def _refine_paper_corners(frame, quad):
    """Snap corners to true edges (sub-pixel) for exact crop borders."""
    if quad is None or not AUTO_CROP_REFINE:
        return quad
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        corners = np.asarray(quad, dtype=np.float32).reshape(-1, 1, 2)
        win = max(5, min(21, int(min(frame.shape[0], frame.shape[1]) * 0.02) | 1))
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.001)
        refined = cv2.cornerSubPix(gray, corners, (win, win), (-1, -1), criteria)
        refined = refined.reshape(4, 2).astype(np.float32)
        refined[:, 0] = np.clip(refined[:, 0], 0, frame.shape[1] - 1)
        refined[:, 1] = np.clip(refined[:, 1], 0, frame.shape[0] - 1)
        return _order_paper_points(refined)
    except Exception:
        return _order_paper_points(quad)


def _expand_paper_quad(points, frame_shape, pad_ratio: float = AUTO_CROP_PAD_RATIO):
    """Slight padding so text near edges is not clipped."""
    if points is None or pad_ratio <= 0:
        return points
    height, width = frame_shape[:2]
    center = points.mean(axis=0)
    expanded = center + (points - center) * (1.0 + pad_ratio)
    expanded[:, 0] = np.clip(expanded[:, 0], 0, width - 1)
    expanded[:, 1] = np.clip(expanded[:, 1], 0, height - 1)
    return expanded.astype(np.float32)


def _even_dim(value: int) -> int:
    value = max(2, int(value))
    return value if value % 2 == 0 else value + 1


def _quad_dims(points):
    top_left, top_right, bottom_right, bottom_left = points
    width = int(round(max(np.linalg.norm(bottom_right - bottom_left), np.linalg.norm(top_right - top_left))))
    height = int(round(max(np.linalg.norm(top_right - bottom_right), np.linalg.norm(top_left - bottom_left))))
    return _even_dim(width), _even_dim(height)


def _warp_paper_quad(frame, points, output_size=None):
    if points is None:
        return frame
    points = _expand_paper_quad(points, frame.shape)
    if output_size is None:
        target_width, target_height = _quad_dims(points)
    else:
        target_width, target_height = _even_dim(output_size[0]), _even_dim(output_size[1])
    if target_width < 100 or target_height < 100:
        return frame
    destination = np.array(
        [[0, 0], [target_width - 1, 0], [target_width - 1, target_height - 1], [0, target_height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(points.astype(np.float32), destination)
    return cv2.warpPerspective(
        frame,
        matrix,
        (target_width, target_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _crop_paper(frame, *, exact: bool = False):
    """Live crop (smooth) or exact crop (scan)."""
    global _auto_crop_frame_count, _last_paper_quad, _last_paper_shape, _last_paper_output_size, _auto_crop_misses
    global _auto_crop_last_log_at, _auto_crop_was_locked, _auto_crop_hits
    if frame is None or getattr(frame, "size", 0) == 0:
        return frame
    shape = frame.shape[:2]
    _auto_crop_frame_count += 1

    if exact:
        detected = _detect_paper_quad(frame)
        points = detected if detected is not None else _last_paper_quad
        if points is None:
            return frame
        # Prefer locked live size for stable scan aspect; else use detected dims.
        out_size = _last_paper_output_size if (AUTO_CROP_SIZE_LOCK and _last_paper_output_size) else _quad_dims(points)
        return _warp_paper_quad(frame, points, out_size)

    if shape != _last_paper_shape:
        _last_paper_output_size = None
        _last_paper_quad = None
        _auto_crop_misses = 0
        _auto_crop_hits = 0

    if shape != _last_paper_shape or _auto_crop_frame_count % AUTO_CROP_DETECT_EVERY == 1:
        detected_quad = _detect_paper_quad(frame)
        has_doc = detected_quad is not None and _is_plausible_paper_quad(detected_quad, frame.shape)
        if not has_doc:
            _auto_crop_misses += 1
            _auto_crop_hits = 0
            # Unlock immediately — never keep a stale zoomed crop when paper is gone.
            if _last_paper_quad is not None:
                print("[PiWS] Auto-crop UNLOCKED (no document) — full preview")
                _last_paper_quad = None
                _last_paper_output_size = None
                _auto_crop_was_locked = False
        elif _last_paper_quad is None:
            _auto_crop_hits += 1
            _auto_crop_misses = 0
            # Require consecutive hits so a one-frame room false-positive does not zoom in.
            if _auto_crop_hits >= AUTO_CROP_LOCK_HITS:
                _last_paper_quad = detected_quad
                w, h = _quad_dims(detected_quad)
                print(f"[PiWS] Auto-crop LOCKED ({w}x{h})")
                _auto_crop_was_locked = True
        else:
            jump = float(np.mean(np.linalg.norm(detected_quad - _last_paper_quad, axis=1)))
            diag = float(np.hypot(shape[1], shape[0]))
            # Huge jump = lost document / wrong object → drop crop right away
            if jump > diag * 0.18:
                _auto_crop_misses += 1
                _auto_crop_hits = 0
                print("[PiWS] Auto-crop UNLOCKED (unstable) — full preview")
                _last_paper_quad = None
                _last_paper_output_size = None
                _auto_crop_was_locked = False
            else:
                alpha = AUTO_CROP_SMOOTHING
                if jump < diag * 0.01:
                    alpha = max(0.04, AUTO_CROP_SMOOTHING * 0.45)
                elif jump < diag * 0.03:
                    alpha = max(0.06, AUTO_CROP_SMOOTHING * 0.7)
                _last_paper_quad = (
                    (1.0 - alpha) * _last_paper_quad + alpha * detected_quad
                ).astype(np.float32)
                _auto_crop_misses = 0
                _auto_crop_hits = AUTO_CROP_LOCK_HITS
        _last_paper_shape = shape

    if _last_paper_quad is not None and not _is_plausible_paper_quad(_last_paper_quad, frame.shape):
        print("[PiWS] Auto-crop UNLOCKED (implausible) — full preview")
        _last_paper_quad = None
        _last_paper_output_size = None
        _auto_crop_was_locked = False
        _auto_crop_hits = 0

    # No document → original camera frame (later resized to PREVIEW_WIDTH x PREVIEW_HEIGHT)
    if _last_paper_quad is None:
        return frame

    detected_width, detected_height = _quad_dims(_last_paper_quad)
    if _last_paper_output_size is None:
        target_width, target_height = detected_width, detected_height
    elif AUTO_CROP_SIZE_LOCK:
        # Keep output size almost fixed so live feed does not "breathe"
        size_alpha = AUTO_CROP_SIZE_SMOOTHING
        prev_w, prev_h = _last_paper_output_size
        # Ignore tiny size noise completely
        if abs(detected_width - prev_w) / max(1, prev_w) < 0.02 and abs(detected_height - prev_h) / max(1, prev_h) < 0.02:
            target_width, target_height = prev_w, prev_h
        else:
            target_width = _even_dim((1.0 - size_alpha) * prev_w + size_alpha * detected_width)
            target_height = _even_dim((1.0 - size_alpha) * prev_h + size_alpha * detected_height)
    else:
        size_alpha = min(0.12, AUTO_CROP_SMOOTHING)
        prev_w, prev_h = _last_paper_output_size
        target_width = _even_dim((1.0 - size_alpha) * prev_w + size_alpha * detected_width)
        target_height = _even_dim((1.0 - size_alpha) * prev_h + size_alpha * detected_height)
    _last_paper_output_size = (target_width, target_height)
    # Live crop fills the whole preview canvas — no black bars / letterbox.
    return _warp_paper_quad(frame, _last_paper_quad, (PREVIEW_WIDTH, PREVIEW_HEIGHT))


def _lift_preview_shadows(frame):
    """Brighten only very dark preview frames; keep the camera/scan frame unchanged."""
    if not PREVIEW_SHADOW_LIFT or frame is None or not getattr(frame, "size", 0):
        return frame
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if float(np.mean(gray)) >= PREVIEW_SHADOW_MEAN_LIMIT:
            return frame
        gamma = 0.72
        lut = np.array([((value / 255.0) ** gamma) * 255 for value in range(256)], dtype=np.uint8)
        return cv2.LUT(frame, lut)
    except Exception:
        return frame


def _draw_paper_overlay(frame, quad):
    """Draw green document outline so auto-crop detection is visible on live preview."""
    if frame is None or quad is None:
        return frame
    out = frame.copy()
    pts = np.round(quad).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(out, [pts], True, (0, 220, 80), 3, cv2.LINE_AA)
    for point in pts.reshape(-1, 2):
        cv2.circle(out, (int(point[0]), int(point[1])), 6, (0, 255, 120), -1, cv2.LINE_AA)
    label = "DOCUMENT DETECTED"
    cv2.putText(out, label, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(out, label, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 120), 2, cv2.LINE_AA)
    return out


def _fit_to_preview(frame, *, letterbox: bool = False):
    """Always emit PREVIEW_WIDTH x PREVIEW_HEIGHT. Default fills the canvas (no black bars)."""
    if frame is None or getattr(frame, "size", 0) == 0:
        return frame
    height, width = frame.shape[:2]
    if width == PREVIEW_WIDTH and height == PREVIEW_HEIGHT:
        return frame
    # letterbox kept only for rare callers — live crop/full preview always fill.
    if letterbox:
        scale = min(float(PREVIEW_WIDTH) / float(max(1, width)), float(PREVIEW_HEIGHT) / float(max(1, height)))
        new_w = _even_dim(max(2, int(width * scale)))
        new_h = _even_dim(max(2, int(height * scale)))
        resized = cv2.resize(
            frame,
            (new_w, new_h),
            interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR,
        )
        canvas = np.zeros((PREVIEW_HEIGHT, PREVIEW_WIDTH, 3), dtype=frame.dtype)
        x0 = max(0, (PREVIEW_WIDTH - new_w) // 2)
        y0 = max(0, (PREVIEW_HEIGHT - new_h) // 2)
        canvas[y0 : y0 + new_h, x0 : x0 + new_w] = resized
        return canvas
    downscale = width > PREVIEW_WIDTH or height > PREVIEW_HEIGHT
    return cv2.resize(
        frame,
        (PREVIEW_WIDTH, PREVIEW_HEIGHT),
        interpolation=cv2.INTER_AREA if downscale else cv2.INTER_LINEAR,
    )


def _prepare_preview_frame(frame):
    """Live preview: cropped document fills view when locked; full camera when unlocked."""
    if frame is None:
        return frame
    rotated = _apply_preview_rotation(frame)
    if AUTO_CROP_LIVE_MODE == "crop":
        cropped = _crop_paper(rotated, exact=False)
        if _last_paper_quad is not None and cropped is not None and cropped is not rotated:
            return _lift_preview_shadows(cropped)  # already PREVIEW_WxH, edge-to-edge
        return _fit_to_preview(_lift_preview_shadows(rotated), letterbox=False)
    if AUTO_CROP_LIVE_MODE == "both":
        cropped = _crop_paper(rotated, exact=False)
        if _last_paper_quad is not None and cropped is not None and cropped is not rotated:
            # No green border / no black pad — just the filled crop.
            return _lift_preview_shadows(cropped)
        return _fit_to_preview(_lift_preview_shadows(rotated), letterbox=False)

    # overlay: keep full frame, draw green document box when locked
    _crop_paper(rotated, exact=False)
    oriented = _lift_preview_shadows(rotated)
    if _last_paper_quad is not None:
        oriented = _draw_paper_overlay(oriented, _last_paper_quad)
    return _fit_to_preview(oriented, letterbox=False)


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


def discover_v4l2_image_devices(preferred_index=None) -> list[str]:
    """Find video nodes exposing exposure or white-balance controls."""
    candidates: list[str] = []
    if preferred_index is not None:
        candidates.append(f"/dev/video{preferred_index}")
        candidates.extend(
            f"/dev/video{preferred_index + offset}"
            for offset in (1, -1, 2, -2, 3)
            if preferred_index + offset >= 0
        )
    candidates.extend(f"/dev/video{idx}" for idx in range(0, CAMERA_SCAN_MAX + 4))

    image_keys = {
        "exposure_auto",
        "exposure_auto_priority",
        "white_balance_temperature_auto",
        "backlight_compensation",
    }
    found: list[str] = []
    for dev in dict.fromkeys(candidates):
        if os.path.exists(dev) and _v4l2_control_names(dev) & image_keys:
            found.append(dev)
    return found


def _v4l2_set_ctrl(device: str, control: str, value) -> bool:
    proc = _run_v4l2_ctl(device, f"--set-ctrl={control}={value}")
    return bool(proc and proc.returncode == 0)


def force_v4l2_capture_mode(device_index, width: int, height: int) -> bool:
    """Request the camera's native MJPEG mode before OpenCV negotiates a fallback."""
    if device_index is None or not isinstance(device_index, int):
        return False
    device = f"/dev/video{device_index}"
    if not os.path.exists(device):
        return False
    format_proc = _run_v4l2_ctl(
        device,
        f"--set-fmt-video=width={int(width)},height={int(height)},pixelformat=MJPG",
    )
    fps_proc = _run_v4l2_ctl(device, f"--set-parm={CAMERA_FPS:g}")
    return bool(
        format_proc
        and format_proc.returncode == 0
        and fps_proc
        and fps_proc.returncode == 0
    )


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


def enable_v4l2_auto_image_controls(devices: list[str]) -> bool:
    enabled = False
    for dev in devices:
        names = _v4l2_control_names(dev)
        if CAMERA_AUTO_EXPOSURE and "exposure_auto" in names:
            if _v4l2_set_ctrl(dev, "exposure_auto", 3):
                enabled = True
        if CAMERA_AUTO_EXPOSURE and "exposure_auto_priority" in names:
            if _v4l2_set_ctrl(dev, "exposure_auto_priority", 1):
                enabled = True
        if CAMERA_AUTO_EXPOSURE and "gain_automatic" in names:
            if _v4l2_set_ctrl(dev, "gain_automatic", 1):
                enabled = True
        if CAMERA_AUTO_EXPOSURE and "gain_auto" in names:
            if _v4l2_set_ctrl(dev, "gain_auto", 1):
                enabled = True
        if CAMERA_AUTO_WB and "white_balance_temperature_auto" in names:
            if _v4l2_set_ctrl(dev, "white_balance_temperature_auto", 1):
                enabled = True
        if CAMERA_BACKLIGHT_COMP and "backlight_compensation" in names:
            if _v4l2_set_ctrl(dev, "backlight_compensation", 1):
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
    global active_v4l2_devices, active_v4l2_image_devices, camera_focus_status

    if not CAMERA_AUTOFOCUS:
        camera_focus_status = "disabled"
        return camera_focus_status

    active_v4l2_devices = discover_v4l2_focus_devices(device_index)
    active_v4l2_image_devices = discover_v4l2_image_devices(device_index)
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
    if auto_exp_prop is not None and CAMERA_AUTO_EXPOSURE:
        try:
            if not cap.set(auto_exp_prop, 0.75):
                cap.set(auto_exp_prop, 1)
        except Exception:
            pass

    if device_index is not None and CAMERA_AUTOFOCUS and not active_v4l2_devices:
        active_v4l2_devices[:] = discover_v4l2_focus_devices(device_index)
    if active_v4l2_devices:
        enable_v4l2_continuous_autofocus(active_v4l2_devices)
    if device_index is not None and not active_v4l2_image_devices:
        active_v4l2_image_devices[:] = discover_v4l2_image_devices(device_index)
    if active_v4l2_image_devices:
        enable_v4l2_auto_image_controls(active_v4l2_image_devices)


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


def read_sharpest_frame(cap, attempts: int | None = None, *, reject_corrupt: bool = True):
    """Burst-read frames after AF settle — keep the sharpest non-corrupt frame."""
    count = attempts if attempts is not None else SCAN_BURST_FRAMES
    best = None
    best_score = -1.0
    for _ in range(max(1, count)):
        ok, frame = _camera_read(cap)
        if not ok or frame is None or not getattr(frame, "size", 0):
            time.sleep(0.04)
            continue
        if reject_corrupt and _frame_looks_corrupt(frame):
            time.sleep(0.04)
            continue
        score = _frame_sharpness_score(frame)
        if score > best_score:
            best_score = score
            best = frame
        time.sleep(0.05)
    return best


def _copy_latest_scan_frame():
    """Last frame shown in live preview — true WYSIWYG fallback when USB read stalls."""
    with frame_lock:
        if latest_preview_bgr is not None and getattr(latest_preview_bgr, "size", 0):
            return latest_preview_bgr.copy()
        if latest_bgr is not None and getattr(latest_bgr, "size", 0):
            return _prepare_preview_frame(latest_bgr.copy())
    return None


def _copy_last_ws_jpeg() -> bytes | None:
    with _last_ws_jpeg_lock:
        if _last_ws_jpeg_sent and _jpeg_is_complete(_last_ws_jpeg_sent):
            return _last_ws_jpeg_sent
    return None


def _bgr_from_jpeg(jpeg: bytes):
    if not jpeg or not _jpeg_is_complete(jpeg):
        return None
    try:
        arr = np.frombuffer(jpeg, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None or not getattr(frame, "size", 0):
            return None
        return frame
    except Exception:
        return None


def _copy_raw_camera_frame():
    """Copy the latest raw camera frame (no green overlay) — never blocks USB."""
    with frame_lock:
        if latest_bgr is not None and getattr(latest_bgr, "size", 0):
            return latest_bgr.copy()
    return None


def _crop_locked_paper(frame):
    """Warp using the live-locked green-box region only — no re-detect (keeps stream smooth)."""
    if frame is None or getattr(frame, "size", 0) == 0:
        return None
    points = _last_paper_quad
    if points is None:
        return None
    try:
        if not _is_plausible_paper_quad(points, frame.shape):
            return None
        out_size = (
            _last_paper_output_size
            if (AUTO_CROP_SIZE_LOCK and _last_paper_output_size)
            else _quad_dims(points)
        )
        return _warp_paper_quad(frame, points, out_size)
    except Exception:
        return None


def _copy_wysiwyg_preview_frame():
    """Exact pixels from live preview — BGR buffer first, then last WS JPEG sent."""
    preview = _copy_latest_scan_frame()
    if preview is not None:
        return preview, "preview buffer"
    jpeg = _copy_last_ws_jpeg()
    if jpeg:
        decoded = _bgr_from_jpeg(jpeg)
        if decoded is not None:
            if decoded.shape[1] != PREVIEW_WIDTH or decoded.shape[0] != PREVIEW_HEIGHT:
                decoded = _prepare_preview_frame(decoded)
            return decoded, "ws jpeg"
    return None, ""


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
    if CAPTURE_MATCH_PREVIEW or CAPTURE_INSTANT:
        width, height = PREVIEW_WIDTH, PREVIEW_HEIGHT
    else:
        width = int(payload.get("scanWidth") or SCAN_WIDTH)
        height = int(payload.get("scanHeight") or SCAN_HEIGHT)
    if height > width:
        width, height = height, width
    capture_frame_count = max(
        1,
        min(12, int(payload.get("captureFrameCount") or SCAN_BURST_FRAMES)),
    )
    return {
        "portrait": False,
        "width": max(320, width),
        "height": max(320, height),
        "orientation": "landscape",
        "paperGuideId": str(payload.get("paperGuideId") or "").strip(),
        "captureFrameCount": capture_frame_count,
    }


def _scan_output_dims(profile: dict | None = None) -> tuple[int, int]:
    if CAPTURE_MATCH_PREVIEW or CAPTURE_INSTANT:
        return PREVIEW_WIDTH, PREVIEW_HEIGHT
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


def _finalize_scan_frame(
    frame,
    profile: dict | None = None,
    *,
    already_cropped: bool = False,
    preserve_size: bool = False,
) -> bytes | None:
    """Encode scan JPEG. preserve_size keeps the document crop aspect (no stretch)."""
    if frame is None:
        return None
    oriented = frame if already_cropped else _crop_paper(frame, exact=True)
    if oriented is None:
        return None
    if not preserve_size:
        target_w, target_h = _scan_output_dims(profile)
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


def _capture_still_frame(
    cap,
    *,
    for_2k: bool = False,
    for_preview: bool = False,
    burst_frames: int | None = None,
):
    """Exclusive still capture — preview worker must be paused."""
    if for_preview:
        # Light path — same frames as live stream; no heavy AF drain that stalls USB.
        warmup_camera_frames(cap, max(2, SCAN_BURST_FRAMES // 2), min_secs=0.06)
        _drain_capture_buffer(cap, 2)
        frame = read_sharpest_frame(
            cap,
            attempts=max(1, burst_frames or SCAN_BURST_FRAMES),
            reject_corrupt=False,
        )
        if frame is None:
            ok, frame = _camera_read(cap, retries=3)
            if not ok or frame is None:
                return None
        return frame

    autofocus_settle(cap, active_camera_index, for_capture=True)
    drain_reads = max(SCAN_CAPTURE_DRAIN, 12 if for_2k else SCAN_CAPTURE_DRAIN)
    _drain_capture_buffer(cap, drain_reads)
    burst = max(1, burst_frames or SCAN_BURST_FRAMES)
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
    frame = _capture_still_frame(
        cap,
        for_2k=is_2k_target,
        burst_frames=(profile or {}).get("captureFrameCount"),
    )
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
    """Instant capture from live buffer — never pauses the stream / never locks USB."""
    started = time.monotonic()

    # Instant path (default): copy raw camera frame, crop to green-box region, enhance.
    # Stream keeps running — no _scan_in_progress, no capture_cap_lock.
    if CAPTURE_INSTANT or CAPTURE_MATCH_PREVIEW:
        raw = _copy_raw_camera_frame()
        source = "raw buffer"
        if raw is None:
            # Last resort: decode last WS JPEG (may include overlay — crop strips edges)
            preview, source = _copy_wysiwyg_preview_frame()
            raw = preview
        if raw is not None:
            rotated = _apply_preview_rotation(raw) if source == "raw buffer" else raw
            cropped = _crop_locked_paper(rotated)
            used_crop = cropped is not None and cropped is not rotated
            frame_out = cropped if used_crop else rotated
            # Strip accidental overlay pixels if we fell back to preview buffer
            if source != "raw buffer" and not used_crop:
                # Preview may have green box drawn — prefer raw-only path next time
                pass
            jpeg = _finalize_scan_frame(
                frame_out,
                profile,
                already_cropped=True,
                preserve_size=used_crop,
            )
            if jpeg:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                h, w = frame_out.shape[:2]
                mode = "document-crop" if used_crop else "full-frame"
                print(
                    f"[PiWS] Instant capture {w}x{h} ({mode}) from {source} in {elapsed_ms}ms — "
                    "stream uninterrupted"
                )
                return jpeg

    # Opt-in slow hi-res path only when instant is disabled
    if not CAPTURE_MATCH_PREVIEW and not CAPTURE_INSTANT:
        cap = active_capture_cap
        if cap is None or not cap.isOpened():
            return None
        _scan_in_progress.set()
        try:
            return capture_scan_snapshot(profile)
        finally:
            _scan_in_progress.clear()

    print("[PiWS] Scan capture miss — no live frame buffer yet (wait for stream)")
    return None


def _run_scan_command(cmd_id: str, payload: dict | None = None):
    """Capture only — motors stay idle until Confirm & Register sends SORT."""
    profile = _scan_profile_from_payload(payload)
    try:
        guide_label = f" ({profile['paperGuideId']})" if profile.get("paperGuideId") else ""
        print(
            f"[PiWS] Scan {cmd_id} capture-only "
            f"{profile['width']}x{profile['height']} {profile['orientation']}{guide_label} "
            "(motors wait for SORT / Confirm & Register)"
        )

        snap = capture_scan_bytes(profile)
        if not snap:
            update_command_status(
                cmd_id,
                "Failed",
                "No preview frame yet — wait for live stream, then capture again",
            )
            return
        update_command_status(cmd_id, "Executing")
        upload_scan(snap, cmd_id)
        update_command_status(cmd_id, "Executed")
        print(f"[PiWS] Scan {cmd_id} uploaded — motors NOT started (wait for Confirm & Register)")
    except Exception as err:
        print(f"[PiWS] Scan {cmd_id} failed: {err}")
        update_command_status(cmd_id, "Failed", str(err))


def _run_sort_command(cmd_id: str, payload: dict | None = None):
    """Confirm & Register → lift to layer → sort deposit → return main."""
    payload = payload or {}
    sort_layer = resolve_sort_layer(payload)
    mech = get_mechanism()
    try:
        print(f"[PiWS] SORT {cmd_id} layer={sort_layer} (Confirm & Register)")
        if not mech.enabled:
            update_command_status(
                cmd_id,
                "Failed",
                "Mechanism disabled — set DIGIPATH_MECH_ENABLED=1",
            )
            return
        update_command_status(cmd_id, "Executing")
        # Block until sort finishes so command status is accurate.
        mech.sort_and_return(sort_layer)
        update_command_status(cmd_id, "Executed")
        print(f"[PiWS] SORT {cmd_id} done (layer {sort_layer})")
    except Exception as err:
        print(f"[PiWS] SORT {cmd_id} failed: {err}")
        update_command_status(cmd_id, "Failed", str(err))


def _run_motor_test_command(cmd_id: str, payload: dict | None = None):
    """Dashboard Test Motors button — same jog as the startup test."""
    mech = get_mechanism()
    try:
        print(f"[PiWS] MOTOR_TEST {cmd_id}")
        if not mech.enabled:
            update_command_status(
                cmd_id,
                "Failed",
                "Mechanism disabled — set DIGIPATH_MECH_ENABLED=1",
            )
            return
        try:
            update_command_status(cmd_id, "Executing")
        except Exception as err:
            print(f"[PiWS] MOTOR_TEST {cmd_id}: could not report Executing ({err}) — running test anyway")
        ok = mech.startup_self_test()
        _send_presence_now("motor_test")
        if ok:
            update_command_status(cmd_id, "Executed")
        else:
            update_command_status(
                cmd_id,
                "Failed",
                (mech.last_test or {}).get("message")
                or mech.status_dict().get("lastError")
                or "Motor test failed — check Pi log",
            )
    except Exception as err:
        print(f"[PiWS] MOTOR_TEST {cmd_id} failed: {err}")
        try:
            update_command_status(cmd_id, "Failed", str(err))
        except Exception as report_err:
            print(f"[PiWS] MOTOR_TEST {cmd_id}: could not report failure ({report_err})")


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
    global _http_upload_inflight, _http_upload_pending
    if not STREAM_HTTP_UPLOAD or not jpeg or not BACKEND_BASE_URL:
        return
    if _scan_in_progress.is_set():
        return
    if _scan_upload_busy.is_set():
        # Don't fight the scan JPEG upload for tunnel bandwidth — keep WS stream only.
        return
    if STREAM_HTTP_WS_PRIORITY and ws_authenticated:
        # WS is the live path — skip HTTPS preview cache while frames are flowing.
        if _last_ws_frame_sent_at > 0 and (time.monotonic() - _last_ws_frame_sent_at) < 3.0:
            return
    now = time.monotonic()
    min_gap = 1.0 / max(1.0, _effective_stream_fps())
    if now - _last_http_frame_upload_at < min_gap * 0.7:
        return
    _last_http_frame_upload_at = now
    _http_frame_upload_boot += 1

    with _http_upload_lock:
        _http_upload_pending = jpeg
        if _http_upload_inflight:
            return
        _http_upload_inflight = True

    def _worker():
        global _last_http_upload_error_log_at, _http_upload_inflight, _http_upload_pending
        while not stop_event.is_set():
            with _http_upload_lock:
                current = _http_upload_pending
                _http_upload_pending = None
            if not current:
                with _http_upload_lock:
                    _http_upload_inflight = False
                return
            try:
                response = _http_upload_session_get().post(
                    f"{BACKEND_BASE_URL}/devices/stream/frame",
                    params={"deviceId": DEVICE_ID},
                    data=current,
                    headers={"Content-Type": "image/jpeg"},
                    timeout=12,
                )
                if response.status_code >= 400:
                    if time.monotonic() - _last_http_upload_error_log_at > 30:
                        print(f"[PiWS] HTTP frame upload {response.status_code}: {response.text[:120]}")
                        _last_http_upload_error_log_at = time.monotonic()
                elif _http_frame_upload_boot <= 3:
                    print(f"[PiWS] HTTP frame upload OK ({len(current)} bytes)")
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
    global _ws_frame_slot, _last_ws_frame_sent_at, _last_ws_jpeg_sent
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
            started = time.perf_counter()
            realtime_ws.send(jpeg, opcode=websocket.ABNF.OPCODE_BINARY)
            _record_ws_send_sample((time.perf_counter() - started) * 1000.0)
            _touch_ws_activity()
            _last_ws_frame_sent_at = time.monotonic()
            with _last_ws_jpeg_lock:
                _last_ws_jpeg_sent = jpeg
        except Exception as err:
            if _is_ws_closed_error(err):
                print(f"[PiWS] WS closed during frame send: {err}")
                # Large scan uploads saturate the tunnel — don't tear down WS
                # on a single failed frame; heartbeat + watchdog will recover.
                if _scan_upload_busy.is_set() or _scan_in_progress.is_set():
                    print("[PiWS] Deferring reconnect during scan/upload")
                    continue
                _force_ws_reconnect_debounced(f"frame send: {err}")


def _signal_preview_encode():
    _preview_encode_event.set()


def preview_encode_send_worker():
    """Encode + send latest frame only — paced to WS_MAX_FPS for steady 2K."""
    global _last_encoded_version
    while not stop_event.is_set():
        if not _preview_encode_event.wait(timeout=0.12):
            continue
        _preview_encode_event.clear()

        if _scan_in_progress.is_set() or _scan_upload_busy.is_set():
            # Keep encoding paused during capture/upload so WS keepalive can breathe.
            continue

        # Tunnel congested — skip this encode tick so we only ship the newest frame later.
        # Time-bounded: _last_ws_send_ms only refreshes after a new send, so an unbounded
        # check would stop encoding forever after a single slow frame.
        if _last_ws_send_ms > 120.0 and (time.monotonic() - _last_ws_send_done_at) < 0.35:
            time.sleep(0.02)
            continue

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
            _adaptive_stream_tick()
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
                if _scan_upload_busy.is_set() or _scan_in_progress.is_set():
                    continue
                _force_ws_reconnect_debounced(f"outbound text: {err}")


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
                # Prefer HTTP keepalive over tearing the socket mid-upload/blip.
                if _scan_upload_busy.is_set() or _scan_in_progress.is_set():
                    return False
                _force_ws_reconnect_debounced(f"presence send: {err}")
            return False
    return send_ws_json({"type": message_type, "payload": device_payload(event_type)})


def _touch_ws_activity():
    global _ws_last_activity_at
    _ws_last_activity_at = time.monotonic()


def _mark_ws_offline():
    global _ws_offline_since
    if _ws_offline_since is None:
        _ws_offline_since = time.monotonic()


def _mark_ws_online():
    global _ws_offline_since
    _ws_offline_since = None


def _close_ws_socket(ws) -> None:
    """Hard-close websocket-client sockets so run_forever() cannot hang forever."""
    if ws is None:
        return
    sock = getattr(ws, "sock", None)
    if sock is not None:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass
    try:
        ws.close()
    except Exception:
        pass


_last_force_reconnect_at = 0.0
WS_RECONNECT_DEBOUNCE_SECS = max(2.0, float(os.environ.get("DIGIPATH_WS_RECONNECT_DEBOUNCE_SECS", "4")))


_ws_last_issue = ""


def _note_ws_issue(text: str):
    global _ws_last_issue
    _ws_last_issue = f"{time.strftime('%H:%M:%S')} {text}"[:240]


def _force_ws_reconnect(reason: str):
    global ws_connected, ws_authenticated, realtime_ws, _active_ws_app, _ws_last_reconnect_kick_at
    global _last_force_reconnect_at
    # Keep the underlying connect error visible instead of the generic supervisor kick.
    if not (reason.startswith("offline supervisor") and _ws_last_issue and "offline supervisor" not in _ws_last_issue):
        _note_ws_issue(f"reconnect: {reason}")
    _last_force_reconnect_at = time.monotonic()
    ws_connected = False
    ws_authenticated = False
    _mark_ws_offline()
    _ws_last_reconnect_kick_at = time.monotonic()
    ws = realtime_ws
    realtime_ws = None
    _close_ws_socket(ws)
    app = _active_ws_app
    if app is not None and app is not ws:
        _close_ws_socket(app)
    print(f"[PiWS] Auto-reconnect: {reason}")


def _force_ws_reconnect_debounced(reason: str):
    """Avoid reconnect storms when the tunnel blips for a second."""
    global _last_force_reconnect_at
    now = time.monotonic()
    if now - _last_force_reconnect_at < WS_RECONNECT_DEBOUNCE_SECS:
        return
    _force_ws_reconnect(reason)


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
    """Upload the captured JPEG — this exact file becomes the document attachment."""
    global _adaptive_fps, _adaptive_jpeg_quality, _adaptive_jpeg_max_bytes
    global _ws_send_samples, _ws_send_slow, _adaptive_hold_until
    with _adaptive_lock:
        saved = (_adaptive_fps, _adaptive_jpeg_quality, _adaptive_jpeg_max_bytes)
    _scan_upload_busy.set()
    try:
        return _upload_scan_body(image_bytes, command_id)
    finally:
        with _adaptive_lock:
            _adaptive_fps = max(_adaptive_fps, saved[0])
            _adaptive_jpeg_quality = max(_adaptive_jpeg_quality, saved[1])
            _adaptive_jpeg_max_bytes = max(_adaptive_jpeg_max_bytes, saved[2])
            _ws_send_samples = 0
            _ws_send_slow = 0
            _adaptive_hold_until = time.monotonic() + STREAM_POST_SCAN_HOLD_SECS
        _scan_upload_busy.clear()


def _upload_scan_body(image_bytes: bytes, command_id: str):
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
        if AI_EXTRACT_BACKGROUND:
            ai_extract_pending = True
            print("[PiWS] Uploading scan first — AI field extraction will run in background")
        else:
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
    if AI_EXTRACT_ENABLED and GROQ_API_KEY and document_id and (ai_extract_pending or not extracted):
        print("[PiWS] Scheduling background AI enrich...")
        start_ai_enrich_async(document_id, command_id, image_bytes)
    print(
        f"[PiWS] Saved attachment = captured JPEG ({len(image_bytes)} bytes) "
        f"→ document {document_id or '?'}"
    )
    return result


def _user_scan_error_message(err) -> str:
    text = str(err or "").strip()
    if not text:
        return "Scan could not be completed. Please try again."
    lower = text.lower()
    if "no preview frame" in lower or "wait for live stream" in lower:
        return "No preview frame yet — wait for live stream, then capture again."
    if "lift/hall" in lower or "mechanism" in lower or "hall prep" in lower:
        return "Scanner mechanism error. Check motors and sensors, then try again."
    if "groq" in lower or "api.groq" in lower or "digipath_groq" in lower:
        return "Scan could not be completed. Enter the document details manually."
    if "timeout" in lower or "timed out" in lower:
        return "Scan timed out. Please try again."
    if "connection" in lower and ("refused" in lower or "error" in lower):
        return "Could not reach the server. Check network connection and try again."
    if len(text) > 160 or "traceback" in lower or "http://" in lower or "https://" in lower:
        return "Scan could not be completed. Please try again."
    return text


def update_command_status(command_id: str, status: str, error: str = ""):
    body = {"status": status}
    if error:
        body["errorMessage"] = _user_scan_error_message(error)
    last_err = None
    # Without a timeout a stalled tunnel request blocks the command thread forever.
    for attempt in range(3):
        try:
            requests.put(
                f"{BACKEND_BASE_URL}/devices/commands/{command_id}",
                json=body,
                headers=DEVICE_HEADERS,
                timeout=10,
            ).raise_for_status()
            return
        except Exception as err:
            last_err = err
            print(f"[PiWS] Command {command_id} → {status} update failed (try {attempt + 1}/3): {err}")
            time.sleep(1.0 + attempt)
    raise last_err


_handled_command_ids: deque = deque(maxlen=200)
_handled_command_lock = threading.Lock()


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
    # Backend re-sends Pending commands on reconnect; never run one twice.
    with _handled_command_lock:
        if cmd_id in _handled_command_ids:
            return
        _handled_command_ids.append(cmd_id)
    cmd_name = str(command.get("command") or "").strip().upper()
    payload = command.get("payload") or {}
    if cmd_name == "SCAN":
        threading.Thread(
            target=_run_scan_command,
            args=(cmd_id, payload),
            daemon=True,
        ).start()
        return
    if cmd_name == "SORT":
        threading.Thread(
            target=_run_sort_command,
            args=(cmd_id, payload),
            daemon=True,
        ).start()
        return
    if cmd_name == "MOTOR_TEST":
        threading.Thread(
            target=_run_motor_test_command,
            args=(cmd_id, payload),
            daemon=True,
        ).start()
        return

    update_command_status(cmd_id, "Failed", f"Unsupported command: {cmd_name}")


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
        force_v4l2_capture_mode(index, PREVIEW_WIDTH, PREVIEW_HEIGHT)
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
                f"[PiWS] Camera worker — JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {_effective_stream_fps():.0f}fps"
                f"{' (adaptive)' if STREAM_ADAPTIVE else ''}"
                f"{' (fast capture)' if STREAM_FAST else ''}"
            )
            frame_interval = (1.0 / _effective_stream_fps()) if _effective_stream_fps() > 0 else 0.0
            last_capture_at = 0.0
            while not stop_event.is_set():
                if _scan_in_progress.is_set():
                    time.sleep(0.02)
                    continue
                frame_interval = (1.0 / _effective_stream_fps()) if _effective_stream_fps() > 0 else 0.0
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
            f"[PiWS] Camera worker — JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {_effective_stream_fps():.0f}fps"
            f"{' (adaptive)' if STREAM_ADAPTIVE else ''}"
            f"{' (fast capture)' if STREAM_FAST else ''}"
        )

        frame_interval = (1.0 / _effective_stream_fps()) if _effective_stream_fps() > 0 else 0.0
        last_capture_at = 0.0
        miss_reads = 0
        reopen_camera = False

        while not stop_event.is_set() and not reopen_camera:
            if _scan_in_progress.is_set():
                time.sleep(0.02)
                continue
            frame_interval = (1.0 / _effective_stream_fps()) if _effective_stream_fps() > 0 else 0.0
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


def _http_presence_heartbeat() -> bool:
    """Fallback when WebSocket is down so the backend still sees the Pi recovering."""
    try:
        response = requests.post(
            f"{BACKEND_BASE_URL}/devices/heartbeat",
            json=device_payload("device_heartbeat"),
            headers=DEVICE_HEADERS,
            timeout=8,
        )
        if response.status_code >= 400:
            print(f"[PiWS] HTTP heartbeat failed: {response.status_code} {response.text[:160]}")
            return False
        _dispatch_http_pending_commands(response)
        return True
    except Exception as err:
        print(f"[PiWS] HTTP heartbeat error: {err}")
        return False


def _dispatch_http_pending_commands(response):
    """Backup command channel: the WS link can be down while HTTP heartbeats still work."""
    try:
        commands = (response.json() or {}).get("pendingCommands") or []
    except Exception:
        return
    for command in commands:
        if isinstance(command, dict) and command.get("id"):
            print(f"[PiWS] Command {command.get('id')} ({command.get('command')}) received via HTTP heartbeat")
            handle_command_message(json.dumps({"type": "command:pending", "command": command}))


def _send_presence_now(reason: str):
    """Push mechanism/test status right away instead of waiting for the next heartbeat."""
    ok = False
    try:
        if ws_authenticated:
            ok = send_ws_presence("device_heartbeat")
    except Exception as err:
        print(f"[PiWS] Presence push ({reason}) failed: {err}")
    if not ok:
        _http_presence_heartbeat()


def heartbeat_worker():
    """WS heartbeat every tick; HTTP backup only when needed (avoids tunnel lag)."""
    http_tick = 0
    while not stop_event.wait(HEARTBEAT_SECS):
        ws_ok = False
        if ws_authenticated:
            ws_ok = send_ws_presence("device_heartbeat")
        http_tick += 1
        need_http = (
            not ws_ok
            or _scan_upload_busy.is_set()
            or _scan_in_progress.is_set()
            or (http_tick % 3 == 0)
        )
        if need_http:
            _http_presence_heartbeat()
        if ws_ok:
            _touch_ws_activity()


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
        _ws_reconnect_delay = WS_RECONNECT_MIN_SECS
        _mark_ws_online()
        _touch_ws_activity()
        print("[PiWS] Backend auth OK — starting stream + heartbeat")
        send_ws_presence("device_connected")
        _signal_preview_encode()
        return
    if msg_type == "auth:error":
        _clear_auth_timer()
        _stop_auth_retry()
        _note_ws_issue(f"auth failed: {data.get('message')} (check DIGIPATH_DEVICE_API_KEY)")
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
    if msg_type == "stream:hint":
        _apply_stream_hint(data)
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
    print(
        f"[PiWS] Auto-crop={'ON' if AUTO_CROP_PAPER else 'OFF'} "
        f"live_mode={AUTO_CROP_LIVE_MODE} (crop=show document; overlay=green box; capture always crops)"
    )
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
    _mark_ws_offline()
    _note_ws_issue(f"closed ({close_status_code or 'n/a'}): {close_msg or 'closed'}")
    print(
        f"[PiWS] WebSocket disconnected ({close_status_code or 'n/a'}): "
        f"{close_msg or 'closed'} — auto-reconnect pending"
    )


def on_realtime_error(_ws, error):
    _note_ws_issue(f"error: {error}")
    print(f"[PiWS] WebSocket error: {error} — auto-reconnect pending")
    _mark_ws_offline()
    _close_ws_socket(_ws)


def ws_health_watchdog():
    """Keep the reconnect loop alive: kick stale or stuck sockets quickly."""
    while not stop_event.wait(3):
        now = time.monotonic()
        if ws_connected and ws_authenticated:
            idle = now - _ws_last_activity_at
            # Uploads saturate the tunnel — give more slack before declaring stale.
            stale_limit = WS_STALE_SECS * 2 if (
                _scan_upload_busy.is_set() or _scan_in_progress.is_set()
            ) else WS_STALE_SECS
            if idle > stale_limit:
                _force_ws_reconnect(f"stale link ({idle:.0f}s idle)")
            continue

        offline_since = _ws_offline_since or now
        offline_for = now - offline_since
        since_kick = now - _ws_last_reconnect_kick_at
        # If run_forever() is hung after a network drop, keep force-closing
        # the socket so the reconnect loop can start a new connection.
        if offline_for >= WS_OFFLINE_KICK_SECS and since_kick >= WS_OFFLINE_KICK_SECS:
            _force_ws_reconnect(f"offline supervisor ({offline_for:.0f}s)")


def realtime_worker():
    global ws_connected, ws_authenticated, realtime_ws, _ws_reconnect_delay, _active_ws_app
    _ws_reconnect_delay = WS_RECONNECT_MIN_SECS
    while not stop_event.is_set():
        try:
            print(f"[PiWS] Connecting WebSocket → {ws_url()}")
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
            _note_ws_issue(f"connect loop error: {err}")
            print(f"[PiWS] Connection loop error: {err}")

        _active_ws_app = None
        ws_connected = False
        ws_authenticated = False
        realtime_ws = None
        _mark_ws_offline()
        if stop_event.is_set():
            break

        delay = max(WS_RECONNECT_MIN_SECS, min(_ws_reconnect_delay, WS_RECONNECT_MAX_SECS))
        print(f"[PiWS] Auto-reconnect in {delay:.1f}s...")
        if stop_event.wait(delay):
            break
        _ws_reconnect_delay = min(_ws_reconnect_delay * 1.35, WS_RECONNECT_MAX_SECS)


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
        f"JPEG-WS preview {PREVIEW_WIDTH}x{PREVIEW_HEIGHT} @ {WS_MAX_FPS:.0f}fps"
        f"{' adaptive' if STREAM_ADAPTIVE else ''}, "
        f"preview_rotate={PREVIEW_ROTATE}, "
        f"capture_instant={int(CAPTURE_INSTANT)}, "
        f"capture_match_preview={int(CAPTURE_MATCH_PREVIEW)}, "
        f"heartbeat={HEARTBEAT_SECS}s"
    )

    threading.Thread(target=stream_producer_worker, daemon=True).start()
    threading.Thread(target=preview_encode_send_worker, daemon=True).start()
    threading.Thread(target=ws_frame_sender_worker, daemon=True).start()
    threading.Thread(target=ws_sender_worker, daemon=True).start()
    threading.Thread(target=ws_health_watchdog, daemon=True).start()
    threading.Thread(target=heartbeat_worker, daemon=True).start()
    try:
        mechanism_startup_self_test()
    except Exception as err:
        print(f"[PiWS] Startup motor test error: {err}")
    _send_presence_now("startup_motor_test")
    try:
        if get_mechanism().home_on_start:
            print("[PiWS] Homing lift to MAIN (top) before ready...")
            mechanism_home_on_startup()
        else:
            print("[PiWS] Startup home skipped (sensors/home off)")
    except Exception as err:
        print(f"[PiWS] Startup home failed: {err}")
    try:
        if get_mechanism().door_monitor_enabled:
            mechanism_start_door_monitor()
        else:
            print("[PiWS] Door monitor off — Capture button drives lift down")
    except Exception as err:
        print(f"[PiWS] Door monitor not started: {err}")
    mech = get_mechanism()
    if mech.enabled:
        mode = (
            f"Capture→{mech.capture_down_count}×DOWN {mech.move_steps}→photo→"
            f"SORT {mech.sort_deposit_steps}→UP {mech.move_steps}"
            if mech.open_loop
            else "hall-guided (no Hall #3)"
        )
        print(f"[PiWS] Mechanism: ON — motors on Confirm&Register/SORT only — {mode}")
    else:
        print(
            "[PiWS] Mechanism: OFF — scan will not move NEMA motors. "
            "Set DIGIPATH_MECH_ENABLED=1 in .env (test-motors.sh is separate)."
        )
    realtime_worker()


def shutdown(*_):
    stop_event.set()
    try:
        get_mechanism().close()
    except Exception:
        pass
    if ws_authenticated:
        send_ws_presence("device_disconnected")
    _force_ws_reconnect("shutdown")
    print(f"[PiWS] stopped at {datetime.now().isoformat()}")


if __name__ == "__main__":
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    run()
