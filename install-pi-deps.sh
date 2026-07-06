#!/usr/bin/env bash
# One-shot dependency install for manual pi_scanner_bridge.py runs on Raspberry Pi.
set -euo pipefail

echo "[DigiPath] Installing system packages..."
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv python3-requests python3-pil
sudo apt-get install -y python3-opencv python3-numpy python3-picamera2
sudo apt-get install -y tesseract-ocr rpicam-apps libgl1 libglib2.0-0

echo "[DigiPath] Installing pip packages..."
python3 -m pip install --upgrade pip
python3 -m pip install requests Pillow pytesseract websocket-client --break-system-packages

echo "[DigiPath] Done. Run: python3 pi_scanner_bridge.py"
