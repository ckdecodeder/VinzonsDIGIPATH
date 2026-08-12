#!/usr/bin/env bash
# YS-27 hall sensor test on Pi — live magnet detect readout
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

PY="${DIGIPATH_PYTHON:-python3}"
exec "$PY" "$ROOT/digipath_hall_test.py" "$@"
