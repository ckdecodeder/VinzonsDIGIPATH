#!/usr/bin/env bash
# Fix Windows CRLF after USB copy.
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
while IFS= read -r -d '' file; do
  if [[ -f "$file" ]]; then
    sed -i 's/\r$//' "$file"
    chmod +x "$file" 2>/dev/null || true
    echo "fixed $file"
  fi
done < <(find "$SCRIPT_DIR" "$ROOT_DIR" \( -name '*.sh' -o -name '.env' -o -name 'pi_ws_scanner.env' -o -name 'pi_ws_scanner.env.example' \) -print0 2>/dev/null)
echo "Done. Run: bash scripts/ws.sh"
