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
  2. Plug USB → copy to Desktop → restart scanner from Desktop → eject USB
  3. If eject stopped the old process, scanner auto-starts again from Desktop
  4. Log: /var/log/digipath-usb-update.log

  Tip: Always run the scanner from ~/Desktop/VinzonsDIGIPATH-Pi (not from the USB
  mount). USB update copies there first, restarts, then ejects safely.

FILES (13 total):
  pi_ws_scanner.py
  scripts/ws.sh                    start (install + run)
  scripts/pi-bootstrap-ws.sh         deps only
  scripts/pi-restart-ws-scanner.sh stop + bootstrap + restart
  scripts/pi-usb-auto-update.sh    USB copy + restart + eject
  scripts/pi-usb-ensure-scanner.sh restart if scanner died after eject
  scripts/pi-install-usb-hook.sh   install udev hook (once)
  scripts/pi-apt-lib.sh
  scripts/pi-venv-lib.sh

INSTALLS: python3, opencv, numpy, websocket-client, requests
NO WebRTC / aiortc required for USB webcam.
