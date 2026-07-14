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
# Empty DIGIPATH_WIFI_HOTSPOT_PASSWORD means open hotspot; unset means secured default.
if [[ -v DIGIPATH_WIFI_HOTSPOT_PASSWORD ]]; then
  HOTSPOT_PASSWORD="$DIGIPATH_WIFI_HOTSPOT_PASSWORD"
else
  HOTSPOT_PASSWORD="digipath123"
fi
PROVISION_PORT="${DIGIPATH_WIFI_PROVISION_PORT:-80}"
PROVISION_PY="${DIGIPATH_WIFI_PROVISION_PY:-$ROOT_DIR/pi_wifi_provision.py}"
PROVISION_ENABLED="${DIGIPATH_WIFI_PROVISION:-1}"
# 1 = always open DigiPath-Setup hotspot so WiFi can be reconfigured even online
FORCE_HOTSPOT="${DIGIPATH_WIFI_FORCE_HOTSPOT:-0}"
LOCK_FILE="/run/digipath-wifi-provisioning.lock"
NM_WAIT_SECS="${DIGIPATH_WIFI_NM_WAIT_SECS:-60}"
HOTSPOT_RETRIES="${DIGIPATH_WIFI_HOTSPOT_RETRIES:-4}"

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

prepare_radio() {
  rfkill unblock wifi >/dev/null 2>&1 || true
  rfkill unblock wlan >/dev/null 2>&1 || true
  if command -v iw >/dev/null 2>&1; then
    iw reg get >/dev/null 2>&1 || true
  fi
}

wait_for_network_manager() {
  local elapsed=0
  local state=""
  log "Waiting for NetworkManager (up to ${NM_WAIT_SECS}s)..."
  while (( elapsed < NM_WAIT_SECS )); do
    if systemctl is-active --quiet NetworkManager.service 2>/dev/null; then
      state="$(nmcli -t -f STATE general 2>/dev/null || true)"
      if [[ "$state" == "connected"* || "$state" == "connecting"* || "$state" == "disconnected" ]]; then
        if nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | grep -E "^(${WLAN_IFACE}|wl):wifi:" >/dev/null; then
          log "NetworkManager ready (state=$state)."
          return 0
        fi
        # Device list may lag right after NM start.
        if nmcli device status >/dev/null 2>&1; then
          log "NetworkManager ready (wlan pending, state=$state)."
          return 0
        fi
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "WARN: NetworkManager not fully ready after ${NM_WAIT_SECS}s — continuing anyway."
  return 0
}

stop_hotspot() {
  nmcli connection down "$CON_NAME" >/dev/null 2>&1 || true
  nmcli connection delete "$CON_NAME" >/dev/null 2>&1 || true
}

start_hotspot_once() {
  local err=0
  local out=""
  stop_hotspot
  nmcli device set "$WLAN_IFACE" managed yes >/dev/null 2>&1 || true
  nmcli device disconnect "$WLAN_IFACE" >/dev/null 2>&1 || true
  sleep 2

  if [[ -n "$HOTSPOT_PASSWORD" ]]; then
    log "Starting secured hotspot SSID=$HOTSPOT_SSID"
    out="$(nmcli device wifi hotspot ifname "$WLAN_IFACE" con-name "$CON_NAME" ssid "$HOTSPOT_SSID" password "$HOTSPOT_PASSWORD" 2>&1)" || err=1
  else
    log "Starting open hotspot SSID=$HOTSPOT_SSID"
    nmcli connection add type wifi ifname "$WLAN_IFACE" con-name "$CON_NAME" autoconnect no ssid "$HOTSPOT_SSID" >/dev/null 2>&1 || true
    nmcli connection modify "$CON_NAME" 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared >/dev/null 2>&1 || true
    out="$(nmcli connection up "$CON_NAME" 2>&1)" || err=1
  fi

  if [[ "$err" -ne 0 ]]; then
    log "WARN: hotspot start failed — trying nmcli device wifi hotspot fallback"
    log "Detail: $(echo "$out" | tr '\n' ' ' | head -c 200)"
    stop_hotspot
    sleep 1
    out="$(nmcli device wifi hotspot ifname "$WLAN_IFACE" con-name "$CON_NAME" ssid "$HOTSPOT_SSID" password "${HOTSPOT_PASSWORD:-digipath123}" 2>&1)" || {
      log "ERROR: could not start hotspot on $WLAN_IFACE"
      log "Detail: $(echo "$out" | tr '\n' ' ' | head -c 240)"
      return 1
    }
    log "Hotspot up with fallback password: ${HOTSPOT_PASSWORD:-digipath123}"
  fi
  return 0
}

start_hotspot() {
  local attempt=1
  prepare_radio
  while (( attempt <= HOTSPOT_RETRIES )); do
    log "Hotspot attempt $attempt/$HOTSPOT_RETRIES on $WLAN_IFACE"
    if start_hotspot_once; then
      return 0
    fi
    prepare_radio
    sleep $((attempt * 3))
    attempt=$((attempt + 1))
  done
  return 1
}

run_portal() {
  export DIGIPATH_WIFI_HOTSPOT_CON="$CON_NAME"
  export DIGIPATH_WIFI_HOTSPOT_SSID="$HOTSPOT_SSID"
  export DIGIPATH_WIFI_HOTSPOT_PASSWORD="$HOTSPOT_PASSWORD"
  export DIGIPATH_WIFI_PROVISION_PORT="$PROVISION_PORT"
  export DIGIPATH_WIFI_FORCE_HOTSPOT="$FORCE_HOTSPOT"
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

  wait_for_network_manager
  prepare_radio

  if [[ "$FORCE_HOTSPOT" == "0" || "$FORCE_HOTSPOT" == "false" || "$FORCE_HOTSPOT" == "no" ]]; then
    if wifi_client_connected; then
      log "Already on office WiFi — hotspot stays off (DIGIPATH_WIFI_FORCE_HOTSPOT=0)."
      stop_hotspot
      rm -f "$LOCK_FILE"
      exit 0
    fi
  else
    if wifi_client_connected; then
      log "Office WiFi is online — still starting hotspot so connections can be reconfigured."
    else
      log "No office WiFi yet — starting setup hotspot."
    fi
  fi

  echo $$ >"$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT

  if ! start_hotspot; then
    log "ERROR: hotspot unavailable — cannot show phone setup page."
    log "Check: rfkill list; iw dev; nmcli device status; journalctl -u NetworkManager -n 50"
    exit 1
  fi

  log "Phone: join $HOTSPOT_SSID (password: ${HOTSPOT_PASSWORD:-none}) → http://10.42.0.1"
  log "Tip: hotspot stays available for WiFi reconfiguration even when the Pi already has internet."
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
