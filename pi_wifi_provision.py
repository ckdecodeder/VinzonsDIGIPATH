#!/usr/bin/env python3
"""
DigiPath WiFi provisioning portal — runs on the Pi when no WiFi is available.

Serves a mobile-friendly setup page (port 80) with captive-portal detection so
phones show a "Sign in to network" prompt after joining the Pi hotspot.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PROVISION_PORT = int(os.environ.get("DIGIPATH_WIFI_PROVISION_PORT", "80"))
HOTSPOT_CON_NAME = os.environ.get("DIGIPATH_WIFI_HOTSPOT_CON", "digipath-setup")
DEVICE_LABEL = os.environ.get("DIGIPATH_DEVICE_ID", "DigiPath Scanner").strip() or "DigiPath Scanner"
SCAN_TIMEOUT_SECS = int(os.environ.get("DIGIPATH_WIFI_SCAN_TIMEOUT", "25"))
CONNECT_TIMEOUT_SECS = int(os.environ.get("DIGIPATH_WIFI_CONNECT_TIMEOUT", "90"))

CAPTIVE_HINT_PATHS = {
    "/generate_204",
    "/gen_204",
    "/hotspot-detect.html",
    "/library/test/success.html",
    "/connecttest.txt",
    "/ncsi.txt",
    "/redirect",
    "/canonical.html",
    "/success.txt",
}

_shutdown_lock = threading.Lock()
_shutdown_requested = False
_hotspot_lock = threading.Lock()


def hotspot_env() -> tuple[str, str, str]:
    con_name = os.environ.get("DIGIPATH_WIFI_HOTSPOT_CON", "digipath-setup")
    ssid = os.environ.get("DIGIPATH_WIFI_HOTSPOT_SSID", "DigiPath-Setup")
    password = os.environ.get("DIGIPATH_WIFI_HOTSPOT_PASSWORD", "").strip()
    return con_name, ssid, password


def start_hotspot() -> None:
    con_name, ssid, password = hotspot_env()
    iface = os.environ.get("DIGIPATH_WIFI_IFACE", "wlan0")
    with _hotspot_lock:
        run_cmd(nmcli_base() + ["connection", "down", con_name], timeout=15)
        run_cmd(nmcli_base() + ["connection", "delete", con_name], timeout=15)
        if password:
            run_cmd(
                nmcli_base()
                + [
                    "device",
                    "wifi",
                    "hotspot",
                    "ifname",
                    iface,
                    "con-name",
                    con_name,
                    "ssid",
                    ssid,
                    "password",
                    password,
                ],
                timeout=30,
            )
        else:
            run_cmd(
                nmcli_base()
                + [
                    "connection",
                    "add",
                    "type",
                    "wifi",
                    "ifname",
                    iface,
                    "con-name",
                    con_name,
                    "autoconnect",
                    "no",
                    "ssid",
                    ssid,
                ],
                timeout=30,
            )
            run_cmd(
                nmcli_base()
                + ["connection", "modify", con_name, "802-11-wireless.mode", "ap", "ipv4.method", "shared"],
                timeout=30,
            )
            run_cmd(nmcli_base() + ["connection", "up", con_name], timeout=30)


def log(message: str) -> None:
    print(f"[wifi-provision] {message}", flush=True)


def run_cmd(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def nmcli_base() -> list[str]:
    return ["nmcli", "--wait", "20"]


def wifi_client_connected() -> bool:
    result = run_cmd(nmcli_base() + ["-t", "-f", "NAME,TYPE", "connection", "show", "--active"])
    if result.returncode != 0:
        return False
    for line in result.stdout.splitlines():
        if not line:
            continue
        parts = line.split(":")
        if len(parts) < 2:
            continue
        name, conn_type = parts[0], parts[1]
        if conn_type != "802-11-wireless":
            continue
        if name == HOTSPOT_CON_NAME:
            continue
        state = run_cmd(nmcli_base() + ["-t", "-f", "STATE", "g"])
        if state.returncode == 0 and "connected" in state.stdout:
            return True
    return False


def stop_hotspot() -> None:
    con_name, _, _ = hotspot_env()
    run_cmd(nmcli_base() + ["connection", "down", con_name], timeout=15)
    run_cmd(nmcli_base() + ["connection", "delete", con_name], timeout=15)


def scan_wifi_networks() -> list[dict[str, str | int]]:
    stop_hotspot()
    time.sleep(1.5)
    result = run_cmd(
        nmcli_base() + ["-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes"],
        timeout=SCAN_TIMEOUT_SECS,
    )
    networks: dict[str, dict[str, str | int]] = {}
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = parts[0].strip()
        if not ssid:
            continue
        try:
            signal = int(parts[1] or "0")
        except ValueError:
            signal = 0
        security = parts[2].strip()
        secured = security not in ("", "--")
        existing = networks.get(ssid)
        if not existing or int(existing["signal"]) < signal:
            networks[ssid] = {
                "ssid": ssid,
                "signal": signal,
                "secured": secured,
            }
    ordered = sorted(networks.values(), key=lambda row: int(row["signal"]), reverse=True)
    start_hotspot()
    return ordered[:40]


def connect_wifi(ssid: str, password: str | None) -> tuple[bool, str]:
    ssid = (ssid or "").strip()
    if not ssid:
        return False, "WiFi name is required."

    stop_hotspot()
    time.sleep(2)

    args = nmcli_base() + ["device", "wifi", "connect", ssid]
    if password:
        args += ["password", password]

    result = run_cmd(args, timeout=CONNECT_TIMEOUT_SECS)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Connection failed.").strip()
        detail = re.sub(r"\s+", " ", detail)
        start_hotspot()
        return False, detail[:240]

    deadline = time.time() + 20
    while time.time() < deadline:
        if wifi_client_connected():
            return True, "Connected."
        time.sleep(1)

    start_hotspot()
    return False, "Connected command succeeded but WiFi did not become active."


def request_shutdown() -> None:
    global _shutdown_requested
    with _shutdown_lock:
        _shutdown_requested = True


def shutdown_requested() -> bool:
    with _shutdown_lock:
        return _shutdown_requested


def unit_installed(unit: str) -> bool:
    name = unit if unit.endswith(".service") else f"{unit}.service"
    return any(
        os.path.isfile(path)
        for path in (
            f"/etc/systemd/system/{name}",
            f"/lib/systemd/system/{name}",
        )
    )


def unit_prop(unit: str, prop: str) -> str:
    result = run_cmd(["systemctl", prop, unit], timeout=8)
    return (result.stdout or result.stderr or "unknown").strip() or "unknown"


def scanner_process_running() -> bool:
    return run_cmd(["pgrep", "-f", "pi_ws_scanner.py"], timeout=5).returncode == 0


def hotspot_active() -> bool:
    con_name, _, _ = hotspot_env()
    result = run_cmd(nmcli_base() + ["-t", "-f", "NAME,TYPE", "connection", "show", "--active"])
    return con_name in result.stdout


def service_row(label: str, unit: str) -> dict[str, str | bool]:
    installed = unit_installed(unit)
    if not installed:
        return {
            "label": label,
            "installed": False,
            "enabled": False,
            "active": False,
            "state": "not_installed",
            "text": "Not installed",
        }
    enabled = unit_prop(unit, "is-enabled")
    active = unit_prop(unit, "is-active")
    ok = enabled in {"enabled", "static"} and active == "active"
    if active == "active":
        text = "On · auto-start enabled" if enabled in {"enabled", "static"} else f"On ({enabled})"
        state = "ok"
    elif enabled in {"enabled", "static"}:
        text = f"Enabled · {active}"
        state = "warn"
    else:
        text = f"{enabled} · {active}"
        state = "warn"
    return {
        "label": label,
        "installed": installed,
        "enabled": enabled in {"enabled", "static"},
        "active": active == "active",
        "state": state,
        "text": text,
    }


def collect_system_status() -> dict:
    office_wifi = wifi_client_connected()
    scanner_running = scanner_process_running()
    usb_hook = os.path.isfile("/usr/local/bin/digipath-usb-update")
    backend = os.environ.get("DIGIPATH_BACKEND_BASE_URL", "").strip() or "(not set)"

    rows = [
        {
            "label": "Office WiFi",
            "installed": True,
            "enabled": office_wifi,
            "active": office_wifi,
            "state": "ok" if office_wifi else "bad",
            "text": "Connected" if office_wifi else "Not connected",
        },
        {
            "label": "Scanner app",
            "installed": True,
            "enabled": scanner_running,
            "active": scanner_running,
            "state": "ok" if scanner_running else "bad",
            "text": "Running" if scanner_running else "Stopped",
        },
        service_row("Boot auto-start", "digipath-ws-scanner.service"),
        service_row("WiFi setup service", "digipath-wifi-provision.service"),
        {
            "label": "USB auto-update",
            "installed": usb_hook,
            "enabled": usb_hook,
            "active": usb_hook,
            "state": "ok" if usb_hook else "bad",
            "text": "Installed" if usb_hook else "Not installed",
        },
        {
            "label": "Pi hotspot",
            "installed": True,
            "enabled": hotspot_active(),
            "active": hotspot_active(),
            "state": "ok" if hotspot_active() else "warn",
            "text": "On (DigiPath-Setup)" if hotspot_active() else "Off",
        },
    ]

    return {
        "device": DEVICE_LABEL,
        "backend": backend,
        "office_wifi": office_wifi,
        "scanner_running": scanner_running,
        "services": rows,
        "install_hint": "On Pi run: sudo bash scripts/pi-install-all.sh",
    }


def html_page() -> bytes:
    body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>DigiPath WiFi Setup</title>
  <style>
    :root {{
      --bg: #f4f7fb;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --accent: #0f766e;
      --accent-dark: #0b5f59;
      --danger: #dc2626;
      --border: #dbe3ee;
      --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: linear-gradient(180deg, #e8f3f1 0%, var(--bg) 40%);
      color: var(--text);
      min-height: 100vh;
      padding: 1rem;
    }}
    .wrap {{ max-width: 520px; margin: 0 auto; }}
    .hero {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1.25rem 1.1rem;
      box-shadow: var(--shadow);
      margin-bottom: 1rem;
    }}
    .badge {{
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--accent);
      background: #e6f4f1;
      border-radius: 999px;
      padding: 0.25rem 0.65rem;
      margin-bottom: 0.65rem;
    }}
    h1 {{ margin: 0 0 0.35rem; font-size: 1.45rem; line-height: 1.2; }}
    p {{ margin: 0; color: var(--muted); line-height: 1.5; font-size: 0.95rem; }}
    .card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1rem;
      box-shadow: var(--shadow);
      margin-bottom: 1rem;
    }}
    label {{
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }}
    input, select, button {{
      width: 100%;
      font: inherit;
    }}
    input, select {{
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.8rem 0.85rem;
      margin-bottom: 0.85rem;
      background: #fff;
    }}
    button {{
      border: 0;
      border-radius: 12px;
      padding: 0.9rem 1rem;
      font-weight: 700;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
    }}
    button.secondary {{
      background: #eef2f7;
      color: var(--text);
      margin-top: 0.5rem;
    }}
    button:disabled {{ opacity: 0.65; cursor: wait; }}
    .network-list {{
      display: grid;
      gap: 0.55rem;
      margin: 0.75rem 0 1rem;
      max-height: 240px;
      overflow: auto;
    }}
    .network-item {{
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.75rem 0.85rem;
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: center;
      cursor: pointer;
      background: #fafcff;
    }}
    .network-item.active {{
      border-color: var(--accent);
      background: #edf8f6;
    }}
    .network-meta {{ font-size: 0.78rem; color: var(--muted); }}
    .status {{
      min-height: 1.2rem;
      font-size: 0.88rem;
      margin-top: 0.35rem;
    }}
    .status.error {{ color: var(--danger); }}
    .status.ok {{ color: var(--accent-dark); }}
    .steps {{
      margin: 0.85rem 0 0;
      padding-left: 1.1rem;
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }}
    .success {{
      text-align: center;
      padding: 1.5rem 0.5rem;
    }}
    .success h2 {{ margin: 0 0 0.5rem; color: var(--accent-dark); }}
    .status-panel h2 {{
      margin: 0 0 0.75rem;
      font-size: 1rem;
    }}
    .status-grid {{
      display: grid;
      gap: 0.55rem;
    }}
    .status-row {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.7rem 0.8rem;
      background: #fafcff;
      font-size: 0.88rem;
    }}
    .status-row strong {{ font-size: 0.84rem; }}
    .pill {{
      font-size: 0.72rem;
      font-weight: 700;
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      white-space: nowrap;
    }}
    .pill.ok {{ background: #dcfce7; color: #166534; }}
    .pill.warn {{ background: #fef3c7; color: #92400e; }}
    .pill.bad {{ background: #fee2e2; color: #991b1b; }}
    .hint {{
      margin-top: 0.75rem;
      font-size: 0.78rem;
      color: var(--muted);
      line-height: 1.4;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="badge">DigiPath Setup</div>
      <h1>Connect this scanner to WiFi</h1>
      <p>Device: <strong>{DEVICE_LABEL}</strong></p>
      <ol class="steps">
        <li>Stay on this Pi hotspot.</li>
        <li>Pick your office WiFi below.</li>
        <li>After success, hotspot turns off automatically.</li>
      </ol>
    </div>

    <div class="card status-panel">
      <h2>Scanner status</h2>
      <div class="status-grid" id="system-status">
        <div class="status-row"><strong>Loading…</strong><span class="pill warn">…</span></div>
      </div>
      <div class="hint" id="install-hint"></div>
    </div>

    <div class="card" id="setup-card">
      <label for="ssid">WiFi network</label>
      <input id="ssid" name="ssid" placeholder="Network name (SSID)" autocomplete="off" />

      <label for="password">WiFi password</label>
      <input id="password" name="password" type="password" placeholder="Leave empty if open WiFi" autocomplete="off" />

      <button id="scan-btn" class="secondary" type="button">Scan nearby networks</button>

      <div class="network-list" id="network-list"></div>

      <button id="connect-btn" type="button">Connect scanner to WiFi</button>
      <div class="status" id="status"></div>
    </div>
  </div>

  <script>
    const ssidInput = document.getElementById('ssid');
    const passwordInput = document.getElementById('password');
    const scanBtn = document.getElementById('scan-btn');
    const connectBtn = document.getElementById('connect-btn');
    const statusEl = document.getElementById('status');
    const networkList = document.getElementById('network-list');
    const setupCard = document.getElementById('setup-card');
    const systemStatus = document.getElementById('system-status');
    const installHint = document.getElementById('install-hint');

    function pillClass(state) {{
      if (state === 'ok') return 'ok';
      if (state === 'bad') return 'bad';
      return 'warn';
    }}

    async function refreshSystemStatus() {{
      try {{
        const response = await fetch('/api/system-status');
        const data = await response.json();
        systemStatus.innerHTML = (data.services || []).map((row) => (
          '<div class="status-row"><strong>' + row.label + '</strong>' +
          '<span class="pill ' + pillClass(row.state) + '">' + row.text + '</span></div>'
        )).join('');
        const needsInstall = (data.services || []).some((row) => row.state === 'not_installed' || row.state === 'bad');
        installHint.textContent = needsInstall
          ? (data.install_hint || '') + ' · Backend: ' + (data.backend || '')
          : 'Backend: ' + (data.backend || '');
      }} catch (error) {{
        systemStatus.innerHTML = '<div class="status-row"><strong>Status</strong><span class="pill bad">Unavailable</span></div>';
      }}
    }}

    function setStatus(message, kind) {{
      statusEl.textContent = message || '';
      statusEl.className = 'status' + (kind ? ' ' + kind : '');
    }}

    function renderNetworks(networks) {{
      networkList.innerHTML = '';
      if (!networks.length) {{
        networkList.innerHTML = '<div class="network-meta">No networks found. You can type the WiFi name manually.</div>';
        return;
      }}
      networks.forEach((network) => {{
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'network-item';
        item.innerHTML = '<div><strong>' + network.ssid + '</strong><div class="network-meta">' +
          (network.secured ? 'Secured' : 'Open') + ' · ' + network.signal + '% signal</div></div>';
        item.addEventListener('click', () => {{
          [...networkList.querySelectorAll('.network-item')].forEach((el) => el.classList.remove('active'));
          item.classList.add('active');
          ssidInput.value = network.ssid;
          if (!network.secured) passwordInput.value = '';
        }});
        networkList.appendChild(item);
      }});
    }}

    async function scanNetworks() {{
      scanBtn.disabled = true;
      connectBtn.disabled = true;
      setStatus('Scanning… hotspot may pause for a few seconds.', '');
      try {{
        const response = await fetch('/api/networks');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Scan failed');
        renderNetworks(data.networks || []);
        setStatus('Tap a network or type the name manually.', 'ok');
      }} catch (error) {{
        setStatus(error.message || 'Scan failed', 'error');
      }} finally {{
        scanBtn.disabled = false;
        connectBtn.disabled = false;
      }}
    }}

    async function connectWifi() {{
      const ssid = ssidInput.value.trim();
      const password = passwordInput.value;
      if (!ssid) {{
        setStatus('Enter or select a WiFi network first.', 'error');
        return;
      }}
      connectBtn.disabled = true;
      scanBtn.disabled = true;
      setStatus('Connecting… this can take up to a minute.', '');
      try {{
        const response = await fetch('/api/connect', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ ssid, password }}),
        }});
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Connection failed');
        setupCard.innerHTML = '<div class="success"><h2>Connected!</h2><p>Hotspot is turning off. You can disconnect from this Pi WiFi and use the scanner on your office network.</p></div>';
      }} catch (error) {{
        setStatus(error.message || 'Connection failed', 'error');
        connectBtn.disabled = false;
        scanBtn.disabled = false;
      }}
    }}

    scanBtn.addEventListener('click', scanNetworks);
    connectBtn.addEventListener('click', connectWifi);
    refreshSystemStatus();
    setInterval(refreshSystemStatus, 5000);
    scanNetworks();
  </script>
</body>
</html>"""
    return body.encode("utf-8")


class ProvisionHandler(BaseHTTPRequestHandler):
    server_version = "DigiPathWiFiProvision/1.0"

    def log_message(self, fmt: str, *args) -> None:
        log(f"{self.address_string()} - {fmt % args}")

    def _send(self, code: int, body: bytes, content_type: str = "text/html; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _redirect_home(self) -> None:
        self.send_response(302)
        self.send_header("Location", "/")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in CAPTIVE_HINT_PATHS:
            self._redirect_home()
            return
        if path == "/api/status":
            payload = {"connected": wifi_client_connected(), "device": DEVICE_LABEL}
            self._send(200, json.dumps(payload).encode("utf-8"), "application/json")
            return
        if path == "/api/system-status":
            self._send(200, json.dumps(collect_system_status()).encode("utf-8"), "application/json")
            return
        if path == "/api/networks":
            try:
                networks = scan_wifi_networks()
                # Hotspot is down during scan; page reload reconnects user if needed.
                self._send(200, json.dumps({"networks": networks}).encode("utf-8"), "application/json")
            except Exception as exc:
                self._send(500, json.dumps({"error": str(exc)}).encode("utf-8"), "application/json")
            return
        if path == "/" or path == "/setup":
            self._send(200, html_page())
            return
        self._redirect_home()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/connect":
            self._send(404, b'{"error":"Not found"}', "application/json")
            return

        payload = self._read_json()
        ssid = str(payload.get("ssid", ""))
        password = str(payload.get("password", "")).strip() or None

        ok, message = connect_wifi(ssid, password)
        if ok:
            request_shutdown()
            self._send(200, json.dumps({"ok": True, "message": message}).encode("utf-8"), "application/json")
            return

        self._send(400, json.dumps({"ok": False, "error": message}).encode("utf-8"), "application/json")


def main() -> int:
    if os.environ.get("DIGIPATH_WIFI_PROVISION", "1").strip() in {"0", "false", "no"}:
        log("Provisioning disabled by DIGIPATH_WIFI_PROVISION.")
        return 0

    if wifi_client_connected():
        log("Already connected to WiFi — provisioning not needed.")
        return 0

    server = None
    port = PROVISION_PORT
    for candidate in (PROVISION_PORT, 8088, 8888):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", candidate), ProvisionHandler)
            port = candidate
            break
        except OSError as exc:
            log(f"Port {candidate} unavailable: {exc}")

    if server is None:
        log("ERROR: could not bind provisioning web port.")
        return 1

    log(f"Serving setup page on 0.0.0.0:{port}")

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        while not shutdown_requested():
            if wifi_client_connected():
                log("WiFi connection detected.")
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("Interrupted.")
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
