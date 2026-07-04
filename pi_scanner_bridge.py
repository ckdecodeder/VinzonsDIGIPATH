"""
VinzonsDIGIPATH - Raspberry Pi Scanner Bridge with MJPEG Streaming
=================================================================
This script runs on the Raspberry Pi 3B and provides:
1. MJPEG live camera stream (port 8080) for the web app
2. Command polling worker - listens for SCAN commands from the web app
3. Background upload worker - uploads scanned documents to the backend
4. Automatic device connection and heartbeat reporting

Install requirements:
  sudo apt install -y tesseract-ocr
  pip3 install picamera2 pytesseract Pillow requests

Required environment variables:
  DIGIPATH_BACKEND_BASE_URL=http://YOUR_BACKEND_IP:5000/api
  DIGIPATH_DEVICE_API_KEY=the_same_DEVICE_API_KEY_from_backend_env
Optional:
  DIGIPATH_DEVICE_ID=DEV-001
  DIGIPATH_OFFICE_ID=OFF-001
  DIGIPATH_STREAM_PORT=8080
"""

import base64
import mimetypes
import sqlite3
import requests
import time
import threading
import os
import re
import io
import atexit
import platform
import shutil
import socket
import tempfile
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import subprocess

# OCR Libraries
try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    print("WARNING: pytesseract or Pillow not installed. OCR will use dummy text.")

# Image Processing & Edge Detection
try:
    import cv2
    import numpy as np
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False
    print("WARNING: opencv-python or numpy not installed. Cropping will be disabled.")

# Pi Camera Module
try:
    from picamera2 import Picamera2
    CAMERA_AVAILABLE = True
    CAMERA_IMPORT_ERROR = ""
except ImportError as e:
    CAMERA_AVAILABLE = False
    CAMERA_IMPORT_ERROR = str(e)
    print("INFO: picamera2 not available. Camera features will use CLI fallback when possible.")

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
BRIDGE_VERSION = "bridge-1.2"
DEVICE_FIRMWARE = os.environ.get("DIGIPATH_DEVICE_FIRMWARE", BRIDGE_VERSION)
DEVICE_SERIAL = os.environ.get("DIGIPATH_DEVICE_SERIAL", socket.gethostname())
LOCAL_DB = "local_scans.db"
SCANS_DIR = "scanned_files"
DUMMY_IMAGE_PATH = "dummy_test.jpg"

# Camera settings
CAMERA_RESOLUTION = (3280, 2464)     # Max resolution for Pi Camera v2 (capture)
STREAM_RESOLUTION = (1280, 720)      # Lower resolution for live stream
CAMERA_WARMUP_SECS = 1
STREAM_PORT = 8080                   # MJPEG stream port
STREAM_PORT = int(os.environ.get("DIGIPATH_STREAM_PORT", str(STREAM_PORT)))
STREAM_FPS = 10                      # Target frames per second for stream
OPENCV_CAMERA_INDEX = int(os.environ.get("DIGIPATH_OPENCV_CAMERA_INDEX", "0"))
ENABLE_OPENCV_CAMERA = os.environ.get("DIGIPATH_ENABLE_OPENCV_CAMERA", "auto").lower()

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
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        ip_address = probe.getsockname()[0]
        probe.close()
        return ip_address
    except Exception:
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

    return {
        "deviceId": DEVICE_ID,
        "name": DEVICE_NAME,
        "model": DEVICE_MODEL,
        "type": "Scanner",
        "ip": get_local_ip(),
        "location": DEVICE_LOCATION,
        "firmware": DEVICE_FIRMWARE,
        "serialNumber": DEVICE_SERIAL,
        "resolution": f"{CAMERA_RESOLUTION[0]}x{CAMERA_RESOLUTION[1]}",
        "assignedTo": OFFICE_ID,
        "details": f"Scanner bridge reported {event_type}",
        "payload": {
            "host": socket.gethostname(),
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
            "streamUrl": f"http://{get_local_ip()}:{STREAM_PORT}/stream.mjpg",
            "diskUsage": disk_usage,
            "cpuLoad": round(load_average, 2),
            "cpuUsage": cpu_usage,
            "memoryUsage": get_memory_usage_percent(),
            "networkLatency": 0,
        },
    }

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

def device_presence_worker():
    global connected_once, last_presence_ok, last_presence_error, last_presence_at

    while True:
        try:
            if not connected_once:
                post_device_presence("device_connected")
                connected_once = True
                print("[Device] Auto-connected to backend.")
            else:
                post_device_presence("device_heartbeat")
                print("[Device] Heartbeat sent.")
            last_presence_ok = True
            last_presence_error = ""
            last_presence_at = datetime.now().isoformat()
        except Exception as e:
            connected_once = False
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
        post_device_presence("device_disconnected")
        connected_once = False
        last_presence_ok = True
        last_presence_error = ""
        last_presence_at = datetime.now().isoformat()
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

def init_camera():
    global camera, last_camera_error
    if not CAMERA_AVAILABLE:
        last_camera_error = f"picamera2 not available: {CAMERA_IMPORT_ERROR or 'module import failed'}"
        print(f"[Camera] {last_camera_error}")
        return False
    try:
        camera = Picamera2()
        # Start with stream resolution for live preview
        config = camera.create_still_configuration(
            main={"size": STREAM_RESOLUTION, "format": "RGB888"}
        )
        camera.configure(config)
        camera.start()
        time.sleep(CAMERA_WARMUP_SECS)
        print(f"[Camera] Initialized at {STREAM_RESOLUTION} for streaming.")
        mark_camera_success()
        return True
    except Exception as e:
        last_camera_error = f"picamera2 init error: {e}"
        print(f"[Camera] Init error: {e}")
        camera = None
        return False

def capture_preview_frame():
    global last_camera_error

    if is_capturing:
        return None, "Camera is busy capturing a scan."

    if camera and not is_capturing:
        try:
            with camera_lock:
                stream = io.BytesIO()
                camera.capture_file(stream, format='jpeg')
                frame = stream.getvalue()
            if frame:
                mark_camera_success()
                return frame, ""
        except Exception as e:
            last_camera_error = f"picamera2 preview error: {e}"
            print(f"[Preview] {last_camera_error}")

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
    global is_capturing
    print("\n[Scanner] Capturing document...")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_name = f"scan_{timestamp}.jpg"
    file_path = os.path.join(SCANS_DIR, file_name)

    captured = False

    # Method 1: Use the running picamera2 instance
    if CAMERA_AVAILABLE and camera:
        try:
            is_capturing = True
            time.sleep(0.3)  # Let stream pause

            with camera_lock:
                # Switch to high-res for capture
                camera.stop()
                hi_config = camera.create_still_configuration(
                    main={"size": CAMERA_RESOLUTION, "format": "RGB888"}
                )
                camera.configure(hi_config)
                camera.start()
                time.sleep(0.5)  # Reduced settling time
                camera.capture_file(file_path)

                # Switch back to stream resolution
                camera.stop()
                lo_config = camera.create_still_configuration(
                    main={"size": STREAM_RESOLUTION, "format": "RGB888"}
                )
                camera.configure(lo_config)
                camera.start()

            is_capturing = False
            captured = True
            mark_camera_success()
            print(f"[Scanner] Captured via picamera2: {file_path}")
            
            # Apply automatic cropping
            file_path = auto_crop_document(file_path)
        except Exception as e:
            is_capturing = False
            print(f"[Scanner] picamera2 capture error: {e}")

    # Method 2: Raspberry Pi camera CLI fallback
    if not captured:
        camera_cli = get_camera_cli()
        if not camera_cli:
            print("[Scanner] No camera CLI available. Install rpicam-apps or libcamera-apps.")
        else:
            try:
                result = subprocess.run([
                    camera_cli, '-o', file_path,
                    '--width', str(CAMERA_RESOLUTION[0]),
                    '--height', str(CAMERA_RESOLUTION[1]),
                    '--nopreview', '-t', str(CAMERA_WARMUP_SECS * 1000),
                ], capture_output=True, text=True, timeout=15)
                if result.returncode == 0 and os.path.exists(file_path):
                    captured = True
                    mark_camera_success()
                    print(f"[Scanner] Captured via {camera_cli}: {file_path}")
                    # Apply automatic cropping
                    file_path = auto_crop_document(file_path)
                else:
                    print(f"[Scanner] {camera_cli} error: {result.stderr}")
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                print(f"[Scanner] Camera CLI not available: {e}")

    # Method 3: OpenCV webcam/USB camera fallback.
    if not captured:
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

# ================= MJPEG STREAMING SERVER =================
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
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()

            try:
                while True:
                    if is_capturing or not camera:
                        frame, _ = capture_preview_frame()
                        if not frame:
                            time.sleep(0.5)
                            continue
                    else:
                        try:
                            with camera_lock:
                                stream = io.BytesIO()
                                camera.capture_file(stream, format='jpeg')
                                frame = stream.getvalue()
                        except Exception:
                            time.sleep(0.5)
                            continue

                    try:
                        self.wfile.write(b'--frame\r\n')
                        self.wfile.write(b'Content-Type: image/jpeg\r\n')
                        self.wfile.write(f'Content-Length: {len(frame)}\r\n'.encode())
                        self.wfile.write(b'\r\n')
                        self.wfile.write(frame)
                        self.wfile.write(b'\r\n')
                    except (BrokenPipeError, ConnectionResetError):
                        break

                    time.sleep(1.0 / STREAM_FPS)

            except Exception as e:
                print(f"[Stream] Client disconnected: {e}")

        elif path == '/snapshot.jpg':
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
                "bridgeUrl": f"http://{get_local_ip()}:{STREAM_PORT}",
                "streamUrl": f"http://{get_local_ip()}:{STREAM_PORT}/stream.mjpg",
                "backendConnected": last_presence_ok,
                "autoConnected": connected_once,
                "lastPresenceAt": last_presence_at,
                "lastPresenceError": last_presence_error,
                "lastCommandError": last_command_error,
            }
            import json
            self.wfile.write(json.dumps(status).encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            html = f'''<html><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh">
            <img src="/stream.mjpg" style="max-width:100%;max-height:100vh" />
            </body></html>'''
            self.wfile.write(html.encode())

    def do_POST(self):
        global connected_once, last_presence_ok, last_presence_error, last_presence_at

        if self.path == '/connect':
            try:
                post_device_presence("device_connected")
                connected_once = True
                last_presence_ok = True
                last_presence_error = ""
                last_presence_at = datetime.now().isoformat()
                self.send_json(200, {"ok": True, "event": "device_connected"})
            except Exception as e:
                last_presence_ok = False
                last_presence_error = str(e)
                last_presence_at = datetime.now().isoformat()
                self.send_json(502, {"ok": False, "event": "device_connected", "message": f"Connect failed: {e}"})
        elif self.path == '/heartbeat':
            try:
                post_device_presence("device_heartbeat")
                connected_once = True
                last_presence_ok = True
                last_presence_error = ""
                last_presence_at = datetime.now().isoformat()
                self.send_json(200, {"ok": True, "event": "device_heartbeat"})
            except Exception as e:
                last_presence_ok = False
                last_presence_error = str(e)
                last_presence_at = datetime.now().isoformat()
                self.send_json(502, {"ok": False, "event": "device_heartbeat", "message": f"Heartbeat failed: {e}"})
        elif self.path == '/disconnect':
            try:
                post_device_presence("device_disconnected")
                connected_once = False
                last_presence_ok = True
                last_presence_error = ""
                last_presence_at = datetime.now().isoformat()
                self.send_json(200, {"ok": True, "event": "device_disconnected"})
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

def start_stream_server():
    server = ThreadingHTTPServer(('0.0.0.0', STREAM_PORT), StreamHandler)
    print(f"[Bridge] Local bridge server started on port {STREAM_PORT}")
    print(f"[Bridge] Connect endpoint: http://0.0.0.0:{STREAM_PORT}/connect")
    print(f"[Stream] View at: http://0.0.0.0:{STREAM_PORT}/stream.mjpg")
    server.serve_forever()

# ================= COMMAND POLLING WORKER =================
def command_worker():
    global last_command_error

    while True:
        try:
            response = requests.get(COMMAND_API_URL, headers=DEVICE_HEADERS, timeout=10)
            if response.status_code == 200:
                last_command_error = ""
                commands = response.json()
                for cmd in commands:
                    print(f"\n[Command] Received: {cmd['command']}")

                    if cmd['command'] == 'SCAN':
                        doc_id = None
                        local_scan_id = None
                        update_data = {'status': 'Failed', 'errorMessage': 'Scan produced no file'}
                        try:
                            requests.put(
                                f"{BACKEND_BASE_URL}/devices/commands/{cmd['id']}",
                                json={'status': 'Executing'},
                                headers=DEVICE_HEADERS,
                                timeout=10
                            )
                            file_path, text, title, date, sender = scan_document()
                            if os.path.exists(file_path):
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
    init_db()

    # Init camera
    cam_ok = init_camera()

    # Start automatic backend connection and heartbeat reporting.
    presence_thread = threading.Thread(target=device_presence_worker, daemon=True)
    presence_thread.start()

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
    print(f"  Stream:  http://0.0.0.0:{STREAM_PORT}/stream.mjpg")
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
