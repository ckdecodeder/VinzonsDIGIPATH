VinzonsDIGIPATH-Pi — minimal USB package
=======================================

FIRST TIME:
  1. Edit .env — DIGIPATH_BACKEND_BASE_URL + DIGIPATH_DEVICE_API_KEY
  2. cd ~/Desktop/VinzonsDIGIPATH-Pi
     bash fix-pi-scripts.sh
     bash scripts/ws.sh

USB AUTO-UPDATE (plug USB while Pi is running):
  1. One-time: sudo bash scripts/pi-install-usb-hook.sh
     (or automatic on first bash scripts/ws.sh via bootstrap)
  2. Plug USB → copy to Desktop → eject USB → restart scanner
  3. Log: /var/log/digipath-usb-update.log

FILES (12 total):
  pi_ws_scanner.py
  scripts/ws.sh                    start (install + run)
  scripts/pi-bootstrap-ws.sh         deps only
  scripts/pi-restart-ws-scanner.sh stop + bootstrap + restart
  scripts/pi-usb-auto-update.sh    USB copy + eject + restart
  scripts/pi-install-usb-hook.sh   install udev hook (once)
  scripts/pi-apt-lib.sh
  scripts/pi-venv-lib.sh

INSTALLS: python3, opencv, numpy, websocket-client, requests
NO WebRTC / aiortc required for USB webcam.
