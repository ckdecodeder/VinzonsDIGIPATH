#!/usr/bin/env bash
# One command on Pi: first-time install (if needed) → sync → deploy → restart → boot autostart
# Usage: sudo bash scripts/pi-start-all.sh   OR   sudo bash start.sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "========================================"
echo "  VinzonsDIGIPATH — Pi (start all)"
echo "========================================"
echo ""

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Re-running with sudo..."
  exec sudo bash "$0" "$@"
fi

read_env_value() {
  local file="$1"
  local key="$2"
  local default="${3:-}"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    grep "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  else
    echo "$default"
  fi
}

echo "[DigiPath] 1/5 — fix line endings..."
if [[ -f "$REPO_ROOT/fix-pi-scripts.sh" ]]; then
  bash "$REPO_ROOT/fix-pi-scripts.sh"
fi

if ! systemctl cat digipath-scanner.service >/dev/null 2>&1; then
  echo "[DigiPath] 2/5 — first-time install (deps + systemd)..."
  if [[ -f "$REPO_ROOT/install-pi-deps.sh" ]]; then
    bash "$REPO_ROOT/install-pi-deps.sh"
  fi
  BACKEND_URL="$(read_env_value "$REPO_ROOT/bridge.env" DIGIPATH_BACKEND_BASE_URL "")"
  DEVICE_KEY="$(read_env_value "$REPO_ROOT/bridge.env" DIGIPATH_DEVICE_API_KEY "dev-device-key-change-me")"
  if [[ -n "$BACKEND_URL" && -f "$REPO_ROOT/raspberry_pi/install_digipath_scanner.sh" ]]; then
    bash "$REPO_ROOT/raspberry_pi/install_digipath_scanner.sh" \
      --backend-url "$BACKEND_URL" \
      --device-key "$DEVICE_KEY"
  else
    echo "[DigiPath] WARNING: No bridge.env backend URL — copy bridge.env from laptop first."
  fi
else
  echo "[DigiPath] 2/5 — service already installed (skip full install)."
fi

echo "[DigiPath] 3/5 — sync backend URL..."
bash "$SCRIPT_DIR/pi-update-network.sh"

echo "[DigiPath] 4/5 — deploy files + restart (one instance only)..."
bash "$SCRIPT_DIR/pi-restart-clean.sh"

echo "[DigiPath] 5/5 — enable autostart on boot + test..."
systemctl enable digipath-scanner 2>/dev/null || true
systemctl is-enabled digipath-scanner 2>/dev/null || true

if [[ -f "$SCRIPT_DIR/pi-test-backend.sh" ]]; then
  sudo -u "${SUDO_USER:-$USER}" bash "$SCRIPT_DIR/pi-test-backend.sh" || true
fi

echo ""
echo "========================================"
echo "  DONE — Pi auto-starts on every boot"
echo "========================================"
echo ""
echo "  Check:  systemctl status digipath-scanner"
echo "  Status: curl http://127.0.0.1:8080/status"
echo ""
echo "  After USB copy from laptop, run again:"
echo "    sudo bash start.sh"
echo ""
