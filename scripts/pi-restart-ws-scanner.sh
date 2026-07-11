#!/usr/bin/env bash
# Restart WS scanner after USB update (bootstrap + systemd or background).
set -euo pipefail

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

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  log "Restart skipped — missing $DEST/pi_ws_scanner.py"
  exit 1
fi

log "Restarting WS scanner from $DEST..."

pkill -f "$DEST/pi_ws_scanner.py" 2>/dev/null || true
pkill -f pi_ws_scanner.py 2>/dev/null || true
sleep 1

if [[ -f "$DEST/scripts/pi-bootstrap-ws.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/scripts/pi-bootstrap-ws.sh" >>"$LOG" 2>&1 || true
fi

if systemctl list-unit-files digipath-ws-scanner.service >/dev/null 2>&1 \
  && systemctl is-enabled digipath-ws-scanner.service >/dev/null 2>&1; then
  systemctl restart digipath-ws-scanner.service >>"$LOG" 2>&1
  log "digipath-ws-scanner.service restarted."
  exit 0
fi

if [[ -f "$DEST/scripts/pi-install-ws-service.sh" ]]; then
  bash "$DEST/scripts/pi-install-ws-service.sh" >>"$LOG" 2>&1 && exit 0
fi

log "No systemd service — starting scanner in background..."
sudo -u "$RUN_USER" bash -lc "
  cd '$DEST'
  source '$DEST/scripts/pi-load-env.sh'
  pi_load_env '$DEST/.env'
  nohup '$DEST/.venv/bin/python' '$DEST/pi_ws_scanner.py' >>'$DEST/scanner.log' 2>&1 &
"
log "Scanner started in background (see $DEST/scanner.log)."
