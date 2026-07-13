#!/usr/bin/env bash
# Start Pi hotspot + captive portal when no office WiFi is available.
# Usage: sudo bash scripts/pi-wifi-provision.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=pi-load-env.sh
source "$SCRIPT_DIR/pi-load-env.sh"

for candidate in \
  "/etc/digipath-scanner.env" \
  "$ROOT_DIR/.env" \
  "$ROOT_DIR/pi_ws_scanner.env" \
  "/home/digipath/Desktop/VinzonsDIGIPATH-Pi/.env" \
  "/home/digipathberry/Desktop/VinzonsDIGIPATH-Pi/.env" \
  "$HOME/Desktop/VinzonsDIGIPATH-Pi/.env"; do
  if [[ -f "$candidate" ]]; then
    pi_load_env "$candidate"
    break
  fi
done

CON_NAME="${DIGIPATH_WIFI_HOTSPOT_CON:-digipath-setup}"
WLAN_IFACE="${DIGIPATH_WIFI_IFACE:-wlan0}"
HOTSPOT_SSID="${DIGIPATH_WIFI_HOTSPOT_SSID:-DigiPath-Setup}"
HOTSPOT_PASSWORD="${DIGIPATH_WIFI_HOTSPOT_PASSWORD:-digipath123}"
PROVISION_PORT="${DIGIPATH_WIFI_PROVISION_PORT:-80}"
PROVISION_PY="${DIGIPATH_WIFI_PROVISION_PY:-$ROOT_DIR/pi_wifi_provision.py}"
PROVISION_ENABLED="${DIGIPATH_WIFI_PROVISION:-1}"
LOCK_FILE="/run/digipath-wifi-provisioning.lock"

log() {
  echo "[wifi-provision] $*"
}

require_root() {
  if [[ "${EUID:-0}" -ne 0 ]]; then
    log "Run with sudo."
    exit 1
  fi
}

wifi_client_connected() {
  local line name conn_type
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    name="${line%%:*}"
    conn_type="${line#*:}"
    if [[ "$conn_type" == "802-11-wireless" && "$name" != "$CON_NAME" ]]; then
      return 0
    fi
  done < <(nmcli -t -f NAME,TYPE connection show --active 2>/dev/null || true)

  if nmcli -t -f DEVICE,STATE device status 2>/dev/null | grep -E "^(wlan|wl)" | grep -qE ":connected$"; then
    nmcli -t -f NAME,TYPE connection show --active 2>/dev/null | grep -q "802-11-wireless" || return 1
    nmcli -t -f NAME connection show --active 2>/dev/null | grep -q "^${CON_NAME}$" && return 1
    return 0
  fi
  return 1
}

stop_hotspot() {
  nmcli connection down "$CON_NAME" >/dev/null 2>&1 || true
  nmcli connection delete "$CON_NAME" >/dev/null 2>&1 || true
}

start_hotspot() {
  local err=0
  stop_hotspot
  nmcli device disconnect "$WLAN_IFACE" >/dev/null 2>&1 || true
  sleep 2

  if [[ -n "${DIGIPATH_WIFI_HOTSPOT_PASSWORD:-}" ]]; then
    log "Starting secured hotspot SSID=$HOTSPOT_SSID"
    nmcli device wifi hotspot ifname "$WLAN_IFACE" con-name "$CON_NAME" ssid "$HOTSPOT_SSID" password "$HOTSPOT_PASSWORD" || err=1
  else
    log "Starting open hotspot SSID=$HOTSPOT_SSID"
    nmcli connection add type wifi ifname "$WLAN_IFACE" con-name "$CON_NAME" autoconnect no ssid "$HOTSPOT_SSID" >/dev/null 2>&1 || true
    nmcli connection modify "$CON_NAME" 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared >/dev/null 2>&1 || true
    nmcli connection up "$CON_NAME" >/dev/null 2>&1 || err=1
  fi

  if [[ "$err" -ne 0 ]]; then
    log "WARN: hotspot start failed — trying nmcli device wifi hotspot fallback"
    nmcli device wifi hotspot ifname "$WLAN_IFACE" con-name "$CON_NAME" ssid "$HOTSPOT_SSID" password "${HOTSPOT_PASSWORD:-digipath123}" || {
      log "ERROR: could not start hotspot on $WLAN_IFACE"
      return 1
    }
    log "Hotspot up with fallback password: ${HOTSPOT_PASSWORD:-digipath123}"
  fi
  return 0
}

run_portal() {
  export DIGIPATH_WIFI_HOTSPOT_CON="$CON_NAME"
  export DIGIPATH_WIFI_PROVISION_PORT="$PROVISION_PORT"
  export DIGIPATH_DEVICE_ID="${DIGIPATH_DEVICE_ID:-DigiPath Scanner}"
  if [[ ! -f "$PROVISION_PY" ]]; then
    log "Missing $PROVISION_PY"
    return 1
  fi
  python3 "$PROVISION_PY"
}

main() {
  require_root

  if [[ "$PROVISION_ENABLED" == "0" || "$PROVISION_ENABLED" == "false" ]]; then
    log "Disabled by DIGIPATH_WIFI_PROVISION."
    exit 0
  fi

  if ! command -v nmcli >/dev/null 2>&1; then
    log "NetworkManager (nmcli) is required. Install with: sudo apt install network-manager"
    exit 1
  fi

  if wifi_client_connected; then
    log "Already on office WiFi — hotspot stays off."
    stop_hotspot
    rm -f "$LOCK_FILE"
    exit 0
  fi

  echo $$ >"$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT

  if ! start_hotspot; then
    log "ERROR: hotspot unavailable — cannot show phone setup page."
    exit 1
  fi

  log "Phone: join $HOTSPOT_SSID (password: ${HOTSPOT_PASSWORD:-none}) → http://10.42.0.1"
  if run_portal; then
    log "WiFi connected — shutting down hotspot."
    stop_hotspot
    nmcli device wifi rescan >/dev/null 2>&1 || true
    exit 0
  fi

  log "Provisioning portal stopped."
  exit 0
}

main "$@"
