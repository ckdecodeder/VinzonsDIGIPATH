#!/usr/bin/env bash
# Auto-copy VinzonsDIGIPATH-Pi from a plugged-in USB drive to Desktop, then restart.
# Triggered by udev when a USB storage partition is inserted (see pi-install-usb-hook.sh).

set -eu

MARKER="pi_scanner_bridge.py"
LOG="/var/log/digipath-usb-update.log"
LOCK="/run/digipath-usb-update.lock"
RUN_USER="${SUDO_USER:-${DIGIPATH_USER:-digipathberry}}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
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
    if [[ -f "$path/$MARKER" ]]; then
      echo "$path"
      return 0
    fi
    if [[ -f "$path/VinzonsDIGIPATH-Pi/$MARKER" ]]; then
      echo "$path/VinzonsDIGIPATH-Pi"
      return 0
    fi
  done

  while IFS= read -r mount_root; do
    [[ -d "$mount_root" ]] || continue
    for entry in "$mount_root"/*; do
      [[ -e "$entry" ]] || continue
      if [[ -f "$entry/$MARKER" ]]; then
        echo "$entry"
        return 0
      fi
      if [[ -f "$entry/VinzonsDIGIPATH-Pi/$MARKER" ]]; then
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

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -a "$SRC" "$DEST"
chown -R "$RUN_USER:$RUN_USER" "$DEST" 2>/dev/null || true

if [[ -f "$DEST/fix-pi-scripts.sh" ]]; then
  sudo -u "$RUN_USER" bash "$DEST/fix-pi-scripts.sh" >>"$LOG" 2>&1 || true
fi

log "Deploying updated files and restarting digipath-scanner..."
if [[ -f "$DEST/scripts/pi-restart-clean.sh" ]]; then
  bash "$DEST/scripts/pi-restart-clean.sh" >>"$LOG" 2>&1
elif [[ -f "$DEST/start.sh" ]]; then
  bash "$DEST/start.sh" >>"$LOG" 2>&1
else
  systemctl restart digipath-scanner.service >>"$LOG" 2>&1 || true
fi

log "USB auto-update complete."
eject_usb_source "$SRC" || true
