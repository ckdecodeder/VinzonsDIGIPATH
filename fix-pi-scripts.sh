#!/usr/bin/env bash
# Fix Windows CRLF line endings after copying from USB / laptop.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fix_file() {
  if [ -f "$1" ]; then
    sed -i 's/\r$//' "$1"
    chmod +x "$1" 2>/dev/null || true
    echo "fixed $1"
  fi
}

for file in \
  "$SCRIPT_DIR/start.sh" \
  "$SCRIPT_DIR/install-pi-deps.sh" \
  "$SCRIPT_DIR/verify-pi-deps.py" \
  "$SCRIPT_DIR/raspberry_pi/install_digipath_scanner.sh" \
  "$SCRIPT_DIR/scripts/pi-start-all.sh" \
  "$SCRIPT_DIR/scripts/pi-restart-clean.sh" \
  "$SCRIPT_DIR/scripts/pi-update-network.sh" \
  "$SCRIPT_DIR/scripts/pi-test-backend.sh"; do
  fix_file "$file"
done

echo "Done. Run: sudo bash start.sh"
