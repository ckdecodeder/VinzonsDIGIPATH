# Raspberry Pi Scanner Setup Guide

This guide sets up a Raspberry Pi 3B/4/5 as the physical scanner bridge for VinzonsDIGIPATH.

## Hardware Requirements

- Raspberry Pi 3B, 4, or 5
- Raspberry Pi Camera Module v2 or v3
- Raspberry Pi and backend computer on the same WiFi/LAN

## Backend Settings

In `backend/.env`, set the device key:

```env
DEVICE_API_KEY=change_this_to_a_long_random_device_key
DEVICE_HEARTBEAT_TIMEOUT_MS=30000
SCANNER_COMMAND_STALE_MS=300000
SCANNER_BRIDGE_TIMEOUT_MS=4000
SCANNER_BRIDGE_PORT=8080
```

The Pi must use the same `DEVICE_API_KEY`.

## Manual Pi Setup

Run these commands on the Raspberry Pi:

```bash
sudo apt update
sudo apt install -y tesseract-ocr python3-pip python3-venv python3-requests python3-pil python3-opencv python3-numpy libgl1 libglib2.0-0
sudo apt install -y python3-picamera2 || true
sudo apt install -y rpicam-apps || sudo apt install -y libcamera-apps || true
```

Copy `pi_scanner_bridge.py` to the Pi, then configure:

```bash
export DIGIPATH_BACKEND_BASE_URL="http://YOUR_BACKEND_COMPUTER_IP:5000/api"
export DIGIPATH_DEVICE_API_KEY="same_value_as_backend_DEVICE_API_KEY"
export DIGIPATH_DEVICE_ID="DEV-001"
export DIGIPATH_OFFICE_ID="OFF-001"
export DIGIPATH_STREAM_PORT="8080"
export DIGIPATH_CAMERA_CLI=""
python3 pi_scanner_bridge.py
```

Use the backend computer's WiFi/LAN IP, not `localhost`.

## Verify The Bridge

Open these URLs from a browser on the dashboard computer:

```text
http://RASPBERRY_PI_IP:8080/status
http://RASPBERRY_PI_IP:8080/snapshot.jpg
http://RASPBERRY_PI_IP:8080/stream.mjpg
```

`/status` should return JSON. If `"camera": false`, the backend connection can still work, but preview and capture need the Pi camera stack fixed. The bridge now tries `picamera2` first, then falls back to `rpicam-still` or `libcamera-still` for preview snapshots.

## Dashboard Flow

1. Start the backend and dashboard.
2. Start `pi_scanner_bridge.py` on the Pi.
3. Open Device Management.
4. Confirm the scanner becomes Online after a heartbeat.
5. Use the Scan Document page and choose Physical Scanner Live Preview.
6. Capture. The preview may warn when `/snapshot.jpg` is not ready, but capture uses the backend command queue and the Pi upload worker.

## Automatic Startup

### Phone WiFi setup (first boot / no network)

When the Pi has no saved office WiFi, it automatically:

1. Turns on hotspot **`DigiPath-Setup`**
2. Your phone can join that network
3. A **sign-in / setup page** opens (captive portal) — or browse to `http://10.42.0.1`
4. Pick your office WiFi and enter the password
5. Hotspot **turns off** after a successful connection

Install on the Pi:

```bash
sudo bash scripts/pi-install-wifi-provision.sh
```

Optional `.env` settings:

```env
DIGIPATH_WIFI_PROVISION=1
DIGIPATH_WIFI_FORCE_HOTSPOT=1
DIGIPATH_WIFI_HOTSPOT_SSID=DigiPath-Setup
DIGIPATH_WIFI_HOTSPOT_PASSWORD=
```

If WiFi is lost later, the hotspot opens again automatically.

By default (`DIGIPATH_WIFI_FORCE_HOTSPOT=1`) the Pi also opens **DigiPath-Setup** even when it already has internet, so you can change the office WiFi later. That uses `wlan0`, so any current WiFi client link is dropped while the hotspot is up (Ethernet internet stays). Set `DIGIPATH_WIFI_FORCE_HOTSPOT=0` if you only want the hotspot when offline.

From this Windows project folder, deploy the bridge over SSH:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-pi-bridge.ps1 -PiHost 192.168.100.157 -PiUser digipathberry
```

With optional WiFi credentials:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-pi-bridge.ps1 -PiHost 192.168.100.157 -PiUser digipathberry -WifiSsid "YOUR_WIFI_NAME" -WifiPassword "YOUR_WIFI_PASSWORD"
```

On the Pi, check the service:

```bash
systemctl status digipath-scanner --no-pager
journalctl -u digipath-scanner -f
```

## Troubleshooting

- If Device Management is Online but preview fails, check `http://RASPBERRY_PI_IP:8080/status`.
- If `/status` is reachable but `"camera": false`, enable/check the camera and confirm one of these works on the Pi:

```bash
rpicam-still -o /tmp/test.jpg --nopreview -t 1000
libcamera-still -o /tmp/test.jpg --nopreview -t 1000
```

- If the command works but the service still fails, set `DIGIPATH_CAMERA_CLI="rpicam-still"` or `DIGIPATH_CAMERA_CLI="libcamera-still"` in `/etc/digipath-scanner.env`, then restart:

```bash
sudo systemctl restart digipath-scanner
```

- If capture stays waiting, check `journalctl -u digipath-scanner -f` and confirm the Pi can reach `http://BACKEND_IP:5000/api/status`.
- If a scan uploaded but looks blank in the dashboard, confirm the attachment is a PDF or image. The scan screen now previews PDFs with an embedded PDF frame.
