#!/usr/bin/env bash
# Shared apt lock helpers for Pi scripts (Bookworm / Raspberry Pi OS).
# Usage: source "$(dirname "$0")/pi-apt-lib.sh"

pi_apt_lock_paths=(
  /var/lib/dpkg/lock-frontend
  /var/lib/dpkg/lock
  /var/lib/apt/lists/lock
  /var/cache/apt/archives/lock
)

pi_apt_is_locked() {
  local path
  for path in "${pi_apt_lock_paths[@]}"; do
    if sudo fuser -s "$path" >/dev/null 2>&1; then
      return 0
    fi
  done
  if pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

pi_apt_show_holders() {
  local label="${1:-PiApt}"
  echo "[$label] Processes holding apt/dpkg locks:"
  local path
  for path in "${pi_apt_lock_paths[@]}"; do
    sudo fuser -v "$path" 2>/dev/null || true
  done
  ps aux 2>/dev/null | grep -E '[a]pt|[d]pkg|[u]nattended|[p]ackagekit' || true
}

pi_apt_stop_background_apt() {
  local label="${1:-PiApt}"
  echo "[$label] Stopping background apt services..."
  sudo systemctl stop unattended-upgrades.service 2>/dev/null || true
  sudo systemctl stop apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
  sudo systemctl stop packagekit.service 2>/dev/null || true
  sudo killall -q apt.systemd.daily 2>/dev/null || true
}

pi_apt_recover_dpkg() {
  local label="${1:-PiApt}"
  echo "[$label] Recovering interrupted dpkg state..."
  sudo dpkg --configure -a 2>/dev/null || true
  sudo apt-get -f install -y 2>/dev/null || true
}

pi_wait_for_apt() {
  local label="${1:-PiApt}"
  local max_wait="${2:-600}"
  local waited=0
  local nudged=0

  while pi_apt_is_locked; do
    if (( waited == 0 )); then
      echo "[$label] Waiting for apt lock (unattended-upgrades / apt-daily)..."
    elif (( waited % 30 == 0 )); then
      echo "[$label] Still waiting (${waited}s / ${max_wait}s)..."
      pi_apt_show_holders "$label"
    fi

    if (( nudged == 0 && waited >= 60 )); then
      nudged=1
      pi_apt_stop_background_apt "$label"
      pi_apt_recover_dpkg "$label"
    fi

    sleep 5
    waited=$((waited + 5))
    if (( waited >= max_wait )); then
      echo "[$label] ERROR: apt still locked after ${max_wait}s"
      echo "[$label] Run: bash scripts/pi-unlock-apt.sh"
      pi_apt_show_holders "$label"
      return 1
    fi
  done
  return 0
}

pi_apt_pkg_installed() {
  dpkg -s "$1" >/dev/null 2>&1
}

pi_apt_install_missing() {
  local label="$1"
  shift
  local skip_update=0
  if [[ "${1:-}" == "--skip-update" ]]; then
    skip_update=1
    shift
  fi

  local missing=()
  local pkg
  for pkg in "$@"; do
    if ! pi_apt_pkg_installed "$pkg"; then
      missing+=("$pkg")
    fi
  done

  if (( ${#missing[@]} == 0 )); then
    echo "[$label] All apt packages already installed — skipping apt"
    return 0
  fi

  if [[ "${DIGIPATH_SKIP_APT:-}" == "1" ]]; then
    echo "[$label] ERROR: DIGIPATH_SKIP_APT=1 but missing packages: ${missing[*]}"
    return 1
  fi

  echo "[$label] Installing missing apt packages: ${missing[*]}"
  pi_wait_for_apt "$label" || return 1

  if (( skip_update == 0 )); then
    sudo apt-get update -qq 2>/dev/null || sudo apt-get update
    pi_wait_for_apt "$label" || return 1
  fi

  if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"; then
    pi_apt_recover_dpkg "$label"
    pi_wait_for_apt "$label" 120 || return 1
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
  fi
}

# Install the first package name that exists in apt (e.g. libvpx9 on Trixie, libvpx7 on Bookworm).
pi_apt_install_first_available() {
  local label="$1"
  shift
  local skip_update=0
  if [[ "${1:-}" == "--skip-update" ]]; then
    skip_update=1
    shift
  fi

  for pkg in "$@"; do
    if pi_apt_pkg_installed "$pkg"; then
      echo "[$label] $pkg already installed"
      return 0
    fi
    if apt-cache show "$pkg" &>/dev/null; then
      echo "[$label] Using apt package: $pkg"
      if (( skip_update )); then
        pi_apt_install_missing "$label" --skip-update "$pkg"
      else
        pi_apt_install_missing "$label" "$pkg"
      fi
      return $?
    fi
  done

  echo "[$label] WARN: none of these apt packages found: $*"
  return 1
}

pi_apt_install_python_dev() {
  local label="$1"
  local py="${2:-python3}"
  local ver=""

  if command -v "$py" &>/dev/null; then
    ver="$("$py" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
  fi

  echo "[$label] Installing Python dev headers for ${py} (${ver:-unknown})..."
  pi_apt_install_missing "$label" --skip-update python3-dev build-essential || true

  if [[ -n "$ver" ]]; then
    pi_apt_install_first_available "$label" --skip-update \
      "python${ver}-dev" "libpython${ver}-dev" "python${ver}-venv" || true
  fi
}

pi_python_has_headers() {
  local py="$1"
  "$py" - <<'PY'
import os
import sysconfig
inc = sysconfig.get_path("include")
path = os.path.join(inc, "Python.h")
raise SystemExit(0 if os.path.isfile(path) else 1)
PY
}
