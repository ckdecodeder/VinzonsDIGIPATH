VinzonsDIGIPATH-Pi — minimal USB package
=======================================

FIRST TIME:
  1. Edit .env — DIGIPATH_BACKEND_BASE_URL + DIGIPATH_DEVICE_API_KEY
  2. cd ~/Desktop/VinzonsDIGIPATH-Pi
     bash fix-pi-scripts.sh
  sudo bash scripts/pi-install-all.sh
     (or: sudo bash scripts/pi-install-ws-service.sh)
  bash scripts/ws.sh

USB AUTO-UPDATE (plug USB while Pi is running):
  1. One-time: sudo bash scripts/pi-install-usb-hook.sh
     (or automatic on first bash scripts/ws.sh via bootstrap)
  2. Plug USB → copy to Desktop → restart scanner from Desktop → eject USB
  3. If eject stopped the old process, scanner auto-starts again from Desktop
  4. Log: /var/log/digipath-usb-update.log

WIFI SETUP (first boot / no office WiFi):
  1. Pi turns on hotspot "DigiPath-Setup" automatically
  2. Phone joins hotspot → sign-in page opens (or http://10.42.0.1)
  3. Pick office WiFi + password → hotspot turns off after connect
  4. One-time install: sudo bash scripts/pi-install-wifi-provision.sh
     (or automatic with sudo bash scripts/pi-install-ws-service.sh)

  Tip: Always run the scanner from ~/Desktop/VinzonsDIGIPATH-Pi (not from the USB
  mount). USB update copies there first, restarts, then ejects safely.

FILES (22 total):
  pi_ws_scanner.py
  pi_wifi_provision.py             phone WiFi setup page (captive portal)
  digipath_tb6600.py
  digipath_hall_ys27.py
  digipath_mechanism.py
  digipath_motor_test.py           NEMA CW/CCW test
  digipath_mechanism.env.example
  scripts/ws.sh                    start (install + run)
  scripts/pi-bootstrap-ws.sh         deps only
  scripts/pi-restart-ws-scanner.sh stop + bootstrap + restart
  scripts/pi-usb-auto-update.sh    USB copy + restart + eject
  scripts/pi-usb-ensure-scanner.sh restart if scanner died after eject
  scripts/pi-install-usb-hook.sh   install udev hook (once)
  scripts/pi-install-wifi-provision.sh  WiFi hotspot setup (once)
  scripts/pi-wifi-provision.sh     hotspot + captive portal runner
  scripts/test-motors.sh           NEMA clockwise / counter-clockwise test
  scripts/pi-apt-lib.sh
  scripts/pi-venv-lib.sh

MOTOR TEST (after wiring, stop scanner first):
  cd ~/Desktop/VinzonsDIGIPATH-Pi
  bash fix-pi-scripts.sh
  bash scripts/test-motors.sh --interactive
  # or one-shot:
  bash scripts/test-motors.sh lift cw 400
  bash scripts/test-motors.sh sort ccw 200
  # dry-run without GPIO:
  bash scripts/test-motors.sh --simulate lift cw 50

INSTALLS: python3, opencv, numpy, websocket-client, requests, gpiozero
NO WebRTC / aiortc required for USB webcam.
