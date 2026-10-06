#!/usr/bin/env bash
# Source KEY=value env files safely (strips Windows CR from USB copies).
pi_load_env() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    echo "[PiWS] Missing env file: $env_file" >&2
    return 1
  fi
  set -a
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    export "$line"
  done < "$env_file"
  set +a
}
