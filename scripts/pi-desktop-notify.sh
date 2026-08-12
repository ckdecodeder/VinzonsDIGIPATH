#!/usr/bin/env bash
# Desktop feedback on Pi (notification + optional live terminal).
set -euo pipefail

RUN_USER="${DIGIPATH_USER:-digipathberry}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
if [[ -z "$USER_HOME" ]]; then
  USER_HOME="/home/$RUN_USER"
fi
DEST="${DIGIPATH_WS_DIR:-$USER_HOME/Desktop/VinzonsDIGIPATH-Pi}"
TITLE="${1:-DigiPath}"
BODY="${2:-Update complete}"
SHOW_TERMINAL="${DIGIPATH_USB_SHOW_TERMINAL:-1}"

run_as_user() {
  local uid
  uid="$(id -u "$RUN_USER" 2>/dev/null || echo "")"
  local display="${DISPLAY:-:0}"
  local dbus="unix:path=/run/user/${uid}/bus"
  if [[ -n "$uid" && -S "/run/user/${uid}/bus" ]]; then
    sudo -u "$RUN_USER" env DISPLAY="$display" DBUS_SESSION_BUS_ADDRESS="$dbus" "$@"
  else
    sudo -u "$RUN_USER" env DISPLAY="$display" "$@"
  fi
}

notify_desktop() {
  if command -v notify-send >/dev/null 2>&1; then
    run_as_user notify-send -t 8000 "$TITLE" "$BODY" 2>/dev/null || true
  fi
}

open_log_terminal() {
  [[ "$SHOW_TERMINAL" == "1" ]] || return 0

  local watch_cmd
  if systemctl is-active digipath-ws-scanner.service >/dev/null 2>&1; then
    watch_cmd="journalctl -u digipath-ws-scanner -f -n 40 --no-pager"
  elif [[ -f "$DEST/scanner.log" ]]; then
    watch_cmd="tail -f '$DEST/scanner.log'"
  else
    watch_cmd="tail -f /var/log/digipath-usb-update.log"
  fi

  local full_cmd="${watch_cmd}; echo; echo '--- Log ended (Ctrl+C to close) ---'; read -r _"

  if command -v lxterminal >/dev/null 2>&1; then
    run_as_user lxterminal -t "DigiPath Scanner" -e bash -lc "$full_cmd" 2>/dev/null &
    return 0
  fi
  if command -v x-terminal-emulator >/dev/null 2>&1; then
    run_as_user x-terminal-emulator -e bash -lc "$full_cmd" 2>/dev/null &
    return 0
  fi
  if command -v xterm >/dev/null 2>&1; then
    run_as_user xterm -T "DigiPath Scanner" -e bash -lc "$full_cmd" 2>/dev/null &
  fi
}

notify_desktop
open_log_terminal
