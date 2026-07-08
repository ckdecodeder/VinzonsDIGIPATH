#!/usr/bin/env bash
# VinzonsDIGIPATH Pi — ONE COMMAND (run everything + enable boot autostart)
# Usage: sudo bash start.sh

set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec sudo bash "$ROOT/scripts/pi-start-all.sh"
