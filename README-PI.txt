VinzonsDIGIPATH — Raspberry Pi Package
======================================

*** ONE COMMAND (on the Pi) ***
-------------------------------
  cd ~/Desktop/VinzonsDIGIPATH-Pi
  sudo bash start.sh

This runs everything:
  - fix scripts (USB/Windows copy)
  - install WiFi/IP auto-restart hook
  - first-time install (if the service is not installed yet)
  - sync backend URL from bridge.env
  - deploy bridge + motor files
  - restart scanner (single instance only)
  - enable AUTO-START on every Pi boot
  - test backend connectivity

When the Pi boots, the scanner starts automatically.
When WiFi changes and the IP changes, the scanner restarts and sends the new IP to the dashboard.
You do not need to run anything manually.


After copying files again from the laptop (USB):
  sudo bash start.sh

USB AUTO-UPDATE (one-time install via start.sh):
  Plug in a USB drive with the VinzonsDIGIPATH-Pi folder.
  The Pi automatically copies it to ~/Desktop/VinzonsDIGIPATH-Pi (overwrite),
  restarts digipath-scanner, then ejects the USB. Log: /var/log/digipath-usb-update.log
  Manual install: sudo bash scripts/pi-install-usb-hook.sh

If you see "$'\r': command not found" (Windows line endings):
  sed -i 's/\r$//' start.sh fix-pi-scripts.sh scripts/*.sh raspberry_pi/*.sh
  sudo bash start.sh


Folder: D:\VinzonsDIGIPATH-Pi  (copy whole folder to Pi via USB)


ANY-NETWORK MODE (recommended)
------------------------------
Pi and dashboard use ONE public backend URL (tunnel or cloud).
Run on laptop first:

  npm run network:sync

Edit network.env if tunnel URL changed, then sync again.
On Pi after USB copy:

  cd ~/Desktop/VinzonsDIGIPATH-Pi
  bash fix-pi-scripts.sh
  sudo bash scripts/pi-update-network.sh
  sudo cp pi_scanner_bridge.py /opt/digipath-scanner/
  sudo systemctl restart digipath-scanner
  bash scripts/pi-test-backend.sh


FILES
-----
pi_scanner_bridge.py            Main bridge (WS + HTTP heartbeat)
install-pi-deps.sh              Install ALL apt + pip modules
verify-pi-deps.py               Check modules after install
requirements-pi.txt             Pip package list
fix-pi-scripts.sh               Fix Windows CRLF line endings on Pi
bridge.env                      Runtime config (synced from network.env)
raspberry_pi/install_digipath_scanner.sh   Full install + systemd
scripts/pi-update-network.sh    Apply public backend URL + restart
scripts/pi-install-network-hook.sh  Auto-restart scanner on WiFi / new IP
scripts/pi-test-backend.sh      Test Pi → backend (not laptop-only)


PREVIEW MODES (automatic)
-------------------------
Same WiFi as Pi  → fast LAN preview (MJPEG or snapshot)
Different network → WebSocket relay via public backend (target 60fps, low delay)

Stream tuning in bridge.env:
  DIGIPATH_STREAM_COLOR_MODE=jpeg
  DIGIPATH_STREAM_FAST=0
  DIGIPATH_STREAM_FPS=30
  DIGIPATH_CAMERA_AWB=auto

Do NOT set STREAM_FAST=1 with COLOR_MODE=jpeg — it causes blue-tint preview.
For speed over colour, use DIGIPATH_STREAM_COLOR_MODE=array and DIGIPATH_STREAM_FAST=1.

On laptop backend .env:
  REALTIME_STREAM_MIN_INTERVAL_MS=16

Pi 3B may reach ~20-30fps in practice; Pi 4/5 can get closer to 60fps.
Dev tunnel adds some latency vs same-LAN WebSocket.


3-LAYER SORTING (physical shelves)
----------------------------------
The lift motor has 3 deposit positions (layers) for sorted files.

Capture + sort sequence:
  1. Rotate LEFT  — feed / align document
  2. Lift to SCAN height — camera capture
  3. OCR + decide layer (document type)
  4. Lift to LAYER 1, 2, or 3 — deposit sorted file
  5. Return HOME (bottom)

Default document-type sorting:
  Layer 1 (bottom) -> Memorandum
  Layer 2 (middle) -> Executive Order
  Layer 3 (top)    -> Communication Letter

Tune layer heights in bridge.env:
  DIGIPATH_LIFT_SCAN_STEPS=800
  DIGIPATH_LAYER1_STEPS=250
  DIGIPATH_LAYER2_STEPS=500
  DIGIPATH_LAYER3_STEPS=750
  DIGIPATH_SORT_RULE=document_type
  DIGIPATH_SORT_DOCUMENT_TYPE_LAYERS={"DT-001":1,"DT-002":2,"DT-003":3}

Legacy priority sorting (optional):
  DIGIPATH_SORT_RULE=priority
  DIGIPATH_SORT_LAYER_URGENT=1
  DIGIPATH_SORT_LAYER_HIGH=2
  DIGIPATH_SORT_LAYER_NORMAL=3

Use document-type sorting instead:
  DIGIPATH_SORT_RULE=document_type

Force a layer from dashboard payload:
  sortLayer: 1 | 2 | 3

CAMERA COLOUR (stream looks blue?)
-------------------------------
Stream now uses libcamera JPEG (true ISP colours) by default.

In bridge.env:
  DIGIPATH_STREAM_COLOR_MODE=jpeg
  DIGIPATH_CAMERA_AWB=auto

If still too blue indoors, try:
  DIGIPATH_CAMERA_AWB=tungsten
  or
  DIGIPATH_CAMERA_AWB=indoor

Manual colour gains (advanced):
  DIGIPATH_CAMERA_COLOUR_GAIN_RED=1.6
  DIGIPATH_CAMERA_COLOUR_GAIN_BLUE=1.1

Then: sudo bash start.sh


-------------------------------
TB6600 #1 — LIFT (up/down stepper):
  PUL- -> GPIO17   (PUL+ -> 3.3V or 5V)
  DIR- -> GPIO18   (DIR+ -> 3.3V or 5V)
  ENA- -> GPIO22   (optional; set DIGIPATH_LIFT_ENA_GPIO=0 if unused)
  A+/A-/B+/B- -> lift motor
  Pi GND -> TB6600 GND

TB6600 #2 — ROTATE (left only):
  PUL- -> GPIO27
  DIR- -> GPIO23
  ENA- -> GPIO24   (optional)
  A+/A-/B+/B- -> rotate motor
  Pi GND -> TB6600 GND

On Capture (SCAN command) sequence:
  1. Rotate driver — N steps LEFT
  2. Lift driver   — N steps UP
  3. Camera capture
  4. Lift driver   — N steps DOWN

Edit in bridge.env:
  DIGIPATH_MOTOR_ENABLED=1
  DIGIPATH_LIFT_UP_STEPS=800
  DIGIPATH_LIFT_DOWN_STEPS=800
  DIGIPATH_ROTATE_LEFT_STEPS=400
  DIGIPATH_MOTOR_STEP_DELAY_US=800
  DIGIPATH_LIFT_UP_DIR=1
  DIGIPATH_ROTATE_LEFT_DIR=0

If direction is reversed, flip UP_DIR or LEFT_DIR (0/1).

STEP 0 — FIX "invalid option" (after USB copy)
----------------------------------------------
  cd ~/VinzonsDIGIPATH-Pi
  bash fix-pi-scripts.sh


STEP 1 — INSTALL DEPS
---------------------
  sudo bash install-pi-deps.sh
  python3 verify-pi-deps.py


STEP 2 — UPDATE CONFIG + SERVICE
--------------------------------
  sudo bash scripts/pi-update-network.sh
  sudo cp pi_scanner_bridge.py /opt/digipath-scanner/
  sudo systemctl enable digipath-scanner
  sudo systemctl restart digipath-scanner


STEP 3 — TEST FROM PI
---------------------
  bash scripts/pi-test-backend.sh
  curl http://127.0.0.1:8080/status


TROUBLESHOOTING
---------------
- Port 8080 in use / Camera not available
    → TWO bridge instances (systemd + manual python). Fix:
       sudo bash scripts/pi-restart-clean.sh
    → Do NOT run python3 pi_scanner_bridge.py while systemd is active.
- DISCONNECTED        → run pi-test-backend.sh on Pi; check network.env URL on laptop
- No camera preview   → same WiFi: open http://<pi-ip>:8080/snapshot.jpg
                        other network: WebSocket via public backend must be up
- Tunnel URL changed  → npm run network:sync on laptop, pi-update-network.sh on Pi
