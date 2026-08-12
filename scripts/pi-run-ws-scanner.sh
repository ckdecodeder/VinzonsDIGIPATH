#!/usr/bin/env bash
# Reliable scanner start: load .env with pi_load_env (same as test-motors.sh),
# then run pi_ws_scanner.py. systemd EnvironmentFile alone can miss vars.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=pi-load-env.sh
source "$ROOT/scripts/pi-load-env.sh"

if [[ -f "$ROOT/.env" ]]; then
  pi_load_env "$ROOT/.env"
elif [[ -f "$ROOT/pi_ws_scanner.env" ]]; then
  pi_load_env "$ROOT/pi_ws_scanner.env"
else
  echo "[PiWS] ERROR: no .env at $ROOT" >&2
  exit 1
fi

echo "[PiWS] Env check: MECH_ENABLED=${DIGIPATH_MECH_ENABLED:-unset} OPEN_LOOP=${DIGIPATH_MECH_OPEN_LOOP:-unset} MOVE_STEPS=${DIGIPATH_MOVE_STEPS:-unset}"

PY="${DIGIPATH_PYTHON:-$ROOT/.venv/bin/python}"
if [[ ! -x "$PY" ]]; then
  PY="python3"
fi

exec "$PY" "$ROOT/pi_ws_scanner.py" "$@"
