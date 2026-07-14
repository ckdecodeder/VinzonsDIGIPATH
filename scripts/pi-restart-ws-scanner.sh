#!/usr/bin/env bash
# Restart WS scanner from Desktop package (stop old → bootstrap → systemd or background).
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

scanner_running() {
  pgrep -af "pi_ws_scanner.py" >/dev/null 2>&1
}

if [[ ! -f "$DEST/pi_ws_scanner.py" ]]; then
  log "Restart skipped — missing $DEST/pi_ws_scanner.py"
  exit 1
fi

log "Restarting WS scanner from $DEST..."

pkill -f "$DEST/pi_ws_scanner.py" 2>/dev/null || true
pkill -f "pi_ws_scanner.py" 2>/dev/null || true
sleep 1

if [[ -f "$DEST/fix-pi-scripts.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/fix-pi-scripts.sh" >>"$LOG" 2>&1 || true
fi

if [[ -f "$DEST/scripts/pi-bootstrap-ws.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/scripts/pi-bootstrap-ws.sh" >>"$LOG" 2>&1 || true
fi

PY="$DEST/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  log "ERROR: Python venv missing at $PY"
  exit 1
fi

if ! "$PY" -c "import cv2, websocket" >>"$LOG" 2>&1; then
  log "ERROR: venv missing cv2 or websocket-client"
  exit 1
fi

start_systemd() {
  if systemctl list-unit-files digipath-ws-scanner.service >/dev/null 2>&1 \
    && systemctl is-enabled digipath-ws-scanner.service >/dev/null 2>&1; then
    systemctl restart digipath-ws-scanner.service >>"$LOG" 2>&1
    log "digipath-ws-scanner.service restarted."
    return 0
  fi
  return 1
}

install_and_start_systemd() {
  if [[ ! -f "$DEST/scripts/pi-install-ws-service.sh" ]]; then
    return 1
  fi
  log "Installing digipath-ws-scanner.service (one-time)..."
  DIGIPATH_WS_DIR="$DEST" DIGIPATH_USER="$RUN_USER" \
    bash "$DEST/scripts/pi-install-ws-service.sh" >>"$LOG" 2>&1 || return 1
  log "digipath-ws-scanner.service installed and started."
  return 0
}

start_background() {
  log "No systemd service — starting scanner in background..."
  sudo -u "$RUN_USER" bash -lc "
    cd '$DEST'
    nohup bash '$DEST/scripts/pi-run-ws-scanner.sh' >>'$DEST/scanner.log' 2>&1 &
    disown
  " >>"$LOG" 2>&1 || return 1
  log "Scanner started in background (see $DEST/scanner.log)."
  return 0
}

if start_systemd || install_and_start_systemd || start_background; then
  sleep 2
  if scanner_running; then
    log "Scanner is running after restart."
    exit 0
  fi
  log "WARN: Restart command finished but scanner process not found — retrying once..."
  start_systemd || start_background || true
  sleep 2
fi

if scanner_running; then
  log "Scanner is running after restart."
  exit 0
fi

log "ERROR: Scanner failed to start — check $LOG and $DEST/scanner.log"
exit 1
