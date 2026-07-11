#!/usr/bin/env bash
# Short alias for pi-install-webrtc.sh (same folder).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/pi-install-webrtc.sh" "$@"
