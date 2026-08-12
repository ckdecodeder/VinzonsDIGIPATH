#!/usr/bin/env bash
# NEMA CW/CCW motor test on Pi — loads .env then runs digipath_motor_test.py
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=pi-load-env.sh
source "$ROOT/scripts/pi-load-env.sh"

if [[ -f "$ROOT/.env" ]]; then
  pi_load_env "$ROOT/.env"
elif [[ -f "$ROOT/pi_ws_scanner.env" ]]; then
  pi_load_env "$ROOT/pi_ws_scanner.env"
fi

if [[ -f "$ROOT/scripts/pi-apt-lib.sh" ]]; then
  # shellcheck source=pi-apt-lib.sh
  source "$ROOT/scripts/pi-apt-lib.sh"
  pi_apt_install_missing PiWS python3-gpiozero 2>/dev/null || true
fi

PY="${DIGIPATH_PYTHON:-python3}"
exec "$PY" "$ROOT/digipath_motor_test.py" "$@"
