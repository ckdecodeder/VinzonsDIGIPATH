# Vinzons DigiPath — Raspberry Pi package (self-contained)
#
# Copy this whole folder to the Pi:
#   ~/Desktop/VinzonsDIGIPATH-Pi
#
# Contents include the WebSocket scanner, WiFi provision, motors, and systemd installers.

## API pairing (must match)

| Where | Variable | Value |
|---|---|---|
| Backend `backend/.env` | `PUBLIC_API_URL` | `https://HOST` (no `/api`) |
| Backend `backend/.env` | `DEVICE_API_KEY` | shared secret |
| Pi `.env` | `DIGIPATH_BACKEND_BASE_URL` | `https://HOST/api` |
| Pi `.env` | `DIGIPATH_DEVICE_API_KEY` | **same** as `DEVICE_API_KEY` |

Synced from root `network.env` via `npm run network:sync`.
Current pair: tunnel `5s7bbf2l-5000.asse.devtunnels.ms` + key `dev-device-key-change-me`.


```bash
cd ~/Desktop/VinzonsDIGIPATH-Pi
cp pi_ws_scanner.env.example .env
nano .env
# Set:
#   DIGIPATH_BACKEND_BASE_URL=https://YOUR_SERVER_OR_TUNNEL/api
#   DIGIPATH_DEVICE_API_KEY=same_as_backend_DEVICE_API_KEY
# Keep:
#   DIGIPATH_WIFI_FORCE_HOTSPOT=0
#   DIGIPATH_AUTO_INSTALL=0

bash fix-pi-scripts.sh
sudo bash scripts/pi-install-all.sh
```

After that, **power on / reboot only** — `digipath-ws-scanner` auto-starts.

## Why "running" but no signal?

If `digipath-wifi-provision` is on DigiPath-Setup hotspot with
`DIGIPATH_WIFI_FORCE_HOTSPOT=1`, the Pi loses office WiFi and cannot reach the
tunnel. Use `DIGIPATH_WIFI_FORCE_HOTSPOT=0`, reconnect WiFi, then:

```bash
curl -sS "$DIGIPATH_BACKEND_BASE_URL/status"   # or full tunnel /api/status
sudo systemctl restart digipath-ws-scanner
journalctl -u digipath-ws-scanner -n 50 --no-pager
```

## Useful commands

```bash
sudo systemctl status digipath-ws-scanner --no-pager
sudo systemctl restart digipath-ws-scanner
bash scripts/ws.sh
bash scripts/test-motors.sh --interactive
```

## Files

| Path | Purpose |
|---|---|
| `pi_ws_scanner.py` | Main scanner + heartbeat + WS stream |
| `pi_wifi_provision.py` | Phone WiFi setup page |
| `digipath_*.py` | Motors / mechanism |
| `scripts/pi-install-all.sh` | One-shot systemd install |
| `scripts/pi-install-ws-service.sh` | Scanner service |
| `scripts/pi-wifi-provision.sh` | Hotspot runner (only when needed) |
| `pi_ws_scanner.env.example` | Env template → copy to `.env` |
| `pi_scanner_bridge.py` | Legacy bridge (optional fallback) |

Same WiFi as the server is **not** required when using a public tunnel/URL.
The Pi only needs working internet to that URL.
