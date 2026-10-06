#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pi-apt-lib.sh
source "$SCRIPT_DIR/pi-apt-lib.sh"

echo "[PiUnlock] Freeing apt locks on Raspberry Pi OS..."

pi_apt_stop_background_apt PiUnlock
pi_apt_recover_dpkg PiUnlock

if pi_apt_is_locked; then
  echo "[PiUnlock] Waiting up to 120s for active apt/dpkg to finish..."
  pi_wait_for_apt PiUnlock 120 || true
fi

if pi_apt_is_locked; then
  echo "[PiUnlock] Still locked — showing holders:"
  pi_apt_show_holders PiUnlock
  echo "[PiUnlock] If nothing is running, reboot the Pi: sudo reboot"
  exit 1
fi

echo "[PiUnlock] apt is free. Continue with: bash scripts/pi-webrtc-fix-all.sh"
