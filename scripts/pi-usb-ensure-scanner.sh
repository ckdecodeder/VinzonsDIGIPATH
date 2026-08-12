#!/usr/bin/env bash
# If scanner died (e.g. USB unmount), start it again from Desktop copy.
set -uo pipefail

RUN_USER="${DIGIPATH_USER:-digipathberry}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
if [[ -z "$USER_HOME" ]]; then
  USER_HOME="/home/$RUN_USER"
fi
DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"
LOG="/var/log/digipath-usb-update.log"

log() {
  echo "$(date -Iseconds) $*" | tee -a "$LOG"
}

if pgrep -af "pi_ws_scanner.py" >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  exit 0
fi

log "Scanner not running after USB event — ensuring Desktop scanner is started..."
if command -v digipath-ws-restart >/dev/null 2>&1; then
  DIGIPATH_USER="$RUN_USER" DIGIPATH_WS_DIR="$DEST" \
    digipath-ws-restart >>"$LOG" 2>&1 || true
elif [[ -f "$DEST/scripts/pi-restart-ws-scanner.sh" ]]; then
  DIGIPATH_USER="$RUN_USER" DIGIPATH_WS_DIR="$DEST" \
    bash "$DEST/scripts/pi-restart-ws-scanner.sh" >>"$LOG" 2>&1 || true
fi
