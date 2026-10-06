#!/usr/bin/env bash
# VinzonsDIGIPATH Pi — ONE COMMAND (run everything + enable boot autostart)
# Usage: sudo bash start.sh
#
# If you see "$'\r': command not found", run once on the Pi:
#   sed -i 's/\r$//' start.sh fix-pi-scripts.sh scripts/*.sh raspberry_pi/*.sh
#   sudo bash start.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Strip Windows CRLF before any strict bash options (USB copies from laptop).
if command -v sed >/dev/null 2>&1; then
  for f in \
    "$ROOT/start.sh" \
    "$ROOT/fix-pi-scripts.sh" \
    "$ROOT/install-pi-deps.sh" \
    "$ROOT/scripts/"*.sh \
    "$ROOT/raspberry_pi/"*.sh; do
    if [ -f "$f" ]; then
      sed -i 's/\r$//' "$f" 2>/dev/null || true
    fi
  done
fi

set -eu
exec sudo bash "$ROOT/scripts/pi-start-all.sh"
