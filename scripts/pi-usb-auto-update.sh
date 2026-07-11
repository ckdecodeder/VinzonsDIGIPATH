#!/usr/bin/env bash
# Auto-copy VinzonsDIGIPATH-Pi from a plugged-in USB drive to Desktop, then eject.
# Triggered by udev when a USB storage partition is inserted (see pi-install-usb-hook.sh).

set -eu

MARKER_NEW="pi_ws_scanner.py"
MARKER_OLD="pi_scanner_bridge.py"
LOG="/var/log/digipath-usb-update.log"
LOCK="/run/digipath-usb-update.lock"
RUN_USER="${SUDO_USER:-${DIGIPATH_USER:-digipathberry}}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
if [[ -z "$USER_HOME" ]]; then
  USER_HOME="/home/$RUN_USER"
fi
DEST="${USER_HOME}/Desktop/VinzonsDIGIPATH-Pi"

log() {
  echo "$(date -Iseconds) $*" | tee -a "$LOG"
}

if [[ -f "$LOCK" ]]; then
  exit 0
fi
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

log "USB insert detected — waiting for mount..."
sleep 6

resolve_usb_mount() {
  local src="$1"
  local mount_point=""

  mount_point="$(findmnt -n -o TARGET --target "$src" 2>/dev/null || true)"
  if [[ -n "$mount_point" ]]; then
    echo "$mount_point"
    return 0
  fi

  local dir="$src"
  while [[ "$dir" != "/" ]]; do
    if findmnt -n "$dir" &>/dev/null; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

eject_usb_source() {
  local src="$1"
  local mount_point=""
  local part_dev=""
  local disk_dev=""

  mount_point="$(resolve_usb_mount "$src" || true)"
  if [[ -z "$mount_point" ]]; then
    log "Could not resolve USB mount point — skip eject."
    return 0
  fi

  part_dev="$(findmnt -n -o SOURCE --target "$mount_point" 2>/dev/null || true)"
  log "Ejecting USB at $mount_point (${part_dev:-unknown device})..."

  sync
  sleep 1

  if umount "$mount_point" 2>/dev/null; then
    log "Unmounted $mount_point"
  else
    log "WARN: Failed to unmount $mount_point"
    return 1
  fi

  if [[ -n "$part_dev" ]]; then
    disk_dev="$(lsblk -n -o PKNAME "$part_dev" 2>/dev/null | head -1 || true)"
    if [[ -n "$disk_dev" && "$disk_dev" != "$part_dev" ]]; then
      disk_dev="/dev/$disk_dev"
    else
      disk_dev="$part_dev"
    fi
  fi

  if [[ -n "$disk_dev" ]] && command -v udisksctl >/dev/null 2>&1; then
    if udisksctl power-off -b "$disk_dev" >>"$LOG" 2>&1; then
      log "USB powered off — safe to remove."
      return 0
    fi
  fi

  if [[ -n "$disk_dev" ]] && command -v eject >/dev/null 2>&1; then
    if eject "$disk_dev" >>"$LOG" 2>&1; then
      log "USB ejected — safe to remove."
      return 0
    fi
  fi

  log "USB unmounted — safe to remove."
}

find_usb_package() {
  local paths=(
    /media/*/*
    /media/*
    /run/media/*/*
    /run/media/*
  )

  for path in "${paths[@]}"; do
    [[ -e "$path" ]] || continue
    if [[ -f "$path/$MARKER_NEW" || -f "$path/$MARKER_OLD" ]]; then
      echo "$path"
      return 0
    fi
    if [[ -f "$path/VinzonsDIGIPATH-Pi/$MARKER_NEW" || -f "$path/VinzonsDIGIPATH-Pi/$MARKER_OLD" ]]; then
      echo "$path/VinzonsDIGIPATH-Pi"
      return 0
    fi
  done

  while IFS= read -r mount_root; do
    [[ -d "$mount_root" ]] || continue
    for entry in "$mount_root"/*; do
      [[ -e "$entry" ]] || continue
      if [[ -f "$entry/$MARKER_NEW" || -f "$entry/$MARKER_OLD" ]]; then
        echo "$entry"
        return 0
      fi
      if [[ -f "$entry/VinzonsDIGIPATH-Pi/$MARKER_NEW" || -f "$entry/VinzonsDIGIPATH-Pi/$MARKER_OLD" ]]; then
        echo "$entry/VinzonsDIGIPATH-Pi"
        return 0
      fi
    done
  done < <(find /media /run/media -mindepth 1 -maxdepth 2 -type d 2>/dev/null | sort -u)

  return 1
}

SRC="$(find_usb_package || true)"
if [[ -z "$SRC" ]]; then
  log "No VinzonsDIGIPATH-Pi package found on USB."
  exit 0
fi

log "Found USB package: $SRC"
log "Copying to $DEST (overwrite)..."
log "Run user: $RUN_USER | Home: $USER_HOME"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --info=stats1 "$SRC"/ "$DEST"/ >>"$LOG" 2>&1
else
  cp -a "$SRC" "$DEST"
fi
chown -R "$RUN_USER:$RUN_USER" "$DEST" 2>/dev/null || true

# .venv from Windows/USB will not work on Pi — always recreate on bootstrap.
rm -rf "$DEST/.venv"
log "Removed .venv from copy (Pi will recreate locally)."
if [[ ! -d "$DEST" ]]; then
  log "ERROR: Destination folder missing after copy: $DEST"
  exit 1
fi
if [[ ! -f "$DEST/$MARKER_NEW" && ! -f "$DEST/$MARKER_OLD" ]]; then
  log "ERROR: Marker file missing in destination after copy."
  exit 1
fi

calc_stats() {
  local dir="$1"
  local file_count
  local total_bytes
  file_count="$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')"
  total_bytes="$(find "$dir" -type f -printf '%s\n' 2>/dev/null | awk '{s+=$1} END {print s+0}')"
  echo "${file_count}:${total_bytes}"
}

SRC_STATS="$(calc_stats "$SRC")"
DEST_STATS="$(calc_stats "$DEST")"
log "Source stats: ${SRC_STATS}"
log "Dest stats:   ${DEST_STATS}"
if [[ "$SRC_STATS" != "$DEST_STATS" ]]; then
  log "ERROR: Copy integrity check failed (file count/bytes mismatch). Skip eject."
  exit 1
fi

sync
sleep 2

if [[ -f "$DEST/fix-pi-scripts.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/fix-pi-scripts.sh" >>"$LOG" 2>&1 || true
fi

log "USB copy complete (overwrite done)."

eject_usb_source "$SRC" || true

if [[ -f "$DEST/scripts/pi-restart-ws-scanner.sh" ]]; then
  log "Eject done — restarting scanner (bootstrap + run)..."
  DIGIPATH_USER="$RUN_USER" DIGIPATH_WS_DIR="$DEST" \
    bash "$DEST/scripts/pi-restart-ws-scanner.sh" >>"$LOG" 2>&1 || true
else
  log "WARN: pi-restart-ws-scanner.sh missing — scanner not restarted."
fi
