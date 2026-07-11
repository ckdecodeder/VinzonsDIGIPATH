#!/usr/bin/env node
/**
 * Sync network.env → dashboard, backend, bridge, and Pi scripts.
 * Usage: node scripts/sync-network-config.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const networkEnvPath = path.join(root, 'network.env');
const examplePath = path.join(root, 'network.env.example');

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const upsertEnvLine = (content, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}\n${line}\n`;
};

const upsertOrComment = (content, key, value, commentPrefix = '# ') => {
  if (!value) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(content)) {
      return content.replace(pattern, `${commentPrefix}${key}=`);
    }
    return content;
  }
  return upsertEnvLine(content, key, value);
};

const ensureFile = (filePath, fallbackPath) => {
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  if (fallbackPath && fs.existsSync(fallbackPath)) return fs.readFileSync(fallbackPath, 'utf8');
  return '';
};

const writeFile = (filePath, content) => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  fs.writeFileSync(filePath, normalized.endsWith('\n') ? normalized : `${normalized}\n`, 'utf8');
  console.log(`  updated ${path.relative(root, filePath)}`);
};

if (!fs.existsSync(networkEnvPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, networkEnvPath);
    console.log('Created network.env from network.env.example — edit DIGIPATH_PUBLIC_BACKEND_URL if needed.');
  } else {
    console.error('Missing network.env and network.env.example');
    process.exit(1);
  }
}

const cfg = parseEnvFile(networkEnvPath);
const publicRoot = (cfg.DIGIPATH_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const deviceKey = cfg.DIGIPATH_DEVICE_API_KEY || 'dev-device-key-change-me';
const groqApiKey = (cfg.DIGIPATH_GROQ_API_KEY || '').trim();
const devtunnelToken = (cfg.DIGIPATH_DEVTUNNEL_TOKEN || '').trim();
const bridgeUrl = (cfg.DIGIPATH_SCANNER_BRIDGE_URL || '').replace(/\/$/, '');

if (!publicRoot) {
  console.error('Set DIGIPATH_PUBLIC_BACKEND_URL in network.env first.');
  process.exit(1);
}

const apiBase = publicRoot.endsWith('/api') ? publicRoot : `${publicRoot}/api`;
const wsUrl = publicRoot
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:')
  .replace(/\/$/, '') + '/ws';

console.log('Syncing network config...');
console.log(`  public API: ${apiBase}`);

// dashboard/.env — local Vite dev uses proxy; Pi/remote devices use the public tunnel.
const dashboardEnvPath = path.join(root, 'dashboard', '.env');
let dashboardEnv = ensureFile(dashboardEnvPath, path.join(root, 'dashboard', '.env.example'));
const dashboardLocalApi = (cfg.DIGIPATH_DASHBOARD_LOCAL_API || '0').trim() === '1';
if (dashboardLocalApi) {
  dashboardEnv = upsertEnvLine(dashboardEnv, 'VITE_API_BASE_URL', '/api');
  dashboardEnv = dashboardEnv.replace(/^VITE_WS_URL=.*$/m, '# VITE_WS_URL=  # use Vite /ws proxy to local backend');
} else {
  dashboardEnv = upsertEnvLine(dashboardEnv, 'VITE_API_BASE_URL', apiBase);
  dashboardEnv = upsertEnvLine(dashboardEnv, 'VITE_WS_URL', wsUrl);
}
if (bridgeUrl) {
  dashboardEnv = upsertEnvLine(dashboardEnv, 'VITE_SCANNER_BRIDGE_URL', bridgeUrl);
} else {
  dashboardEnv = dashboardEnv.replace(/^#?\s*VITE_SCANNER_BRIDGE_URL=.*$/gm, '');
  const marker = '# Optional LAN preview override (leave commented for any-network auto-detect):';
  if (!dashboardEnv.includes(marker)) {
    dashboardEnv = dashboardEnv.replace(
      /(VITE_API_BASE_URL=.*\n)/,
      `$1\n${marker}\n# VITE_SCANNER_BRIDGE_URL=\n`,
    );
  }
}
writeFile(dashboardEnvPath, dashboardEnv);

// backend/.env
const backendEnvPath = path.join(root, 'backend', '.env');
let backendEnv = ensureFile(backendEnvPath, path.join(root, 'backend', '.env.example'));
backendEnv = upsertEnvLine(backendEnv, 'PUBLIC_API_URL', publicRoot);
backendEnv = upsertEnvLine(backendEnv, 'DEVICE_API_KEY', deviceKey);
backendEnv = upsertEnvLine(
  backendEnv,
  'BRIDGE_SNAPSHOT_WS_FALLBACK_MAX_AGE_MS',
  cfg.BRIDGE_SNAPSHOT_WS_FALLBACK_MAX_AGE_MS || '60000',
);
backendEnv = upsertEnvLine(
  backendEnv,
  'REALTIME_STREAM_MIN_INTERVAL_MS',
  cfg.REALTIME_STREAM_MIN_INTERVAL_MS || '0',
);
backendEnv = upsertEnvLine(
  backendEnv,
  'REALTIME_STREAM_MAX_BUFFERED_BYTES',
  cfg.REALTIME_STREAM_MAX_BUFFERED_BYTES || '680000',
);
backendEnv = upsertEnvLine(
  backendEnv,
  'REALTIME_STREAM_MAX_CLIENT_BUFFER_FRAMES',
  cfg.REALTIME_STREAM_MAX_CLIENT_BUFFER_FRAMES || '1',
);
backendEnv = upsertEnvLine(
  backendEnv,
  'REALTIME_STREAM_MAX_PAYLOAD_BYTES',
  cfg.REALTIME_STREAM_MAX_PAYLOAD_BYTES || '1048576',
);
writeFile(backendEnvPath, backendEnv);

// bridge.env (Pi package)
const bridgeEnvPath = path.join(root, 'bridge.env');
let bridgeEnv = ensureFile(bridgeEnvPath, path.join(root, 'bridge.env.example'));
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_BACKEND_BASE_URL', apiBase);
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_DEVICE_API_KEY', deviceKey);
bridgeEnv = upsertOrComment(bridgeEnv, 'DIGIPATH_DEVTUNNEL_TOKEN', devtunnelToken);
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_USE_WEBSOCKET', '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_ENABLE_MJPEG_HTTP', '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_FPS', cfg.DIGIPATH_STREAM_FPS || '20');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_WIDTH', cfg.DIGIPATH_STREAM_WIDTH || '2560');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_HEIGHT', cfg.DIGIPATH_STREAM_HEIGHT || '1440');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_JPEG_QUALITY', cfg.DIGIPATH_STREAM_JPEG_QUALITY || '92');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_FAST', cfg.DIGIPATH_STREAM_FAST || '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_WS_MAX_FPS', cfg.DIGIPATH_STREAM_WS_MAX_FPS || '20');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_PREVIEW_WIDTH', cfg.DIGIPATH_PREVIEW_WIDTH || '2560');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_PREVIEW_HEIGHT', cfg.DIGIPATH_PREVIEW_HEIGHT || '1440');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_PREVIEW_JPEG_QUALITY', cfg.DIGIPATH_PREVIEW_JPEG_QUALITY || '76');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_JPEG_MAX_BYTES', cfg.DIGIPATH_STREAM_JPEG_MAX_BYTES || '650000');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_JPEG_MIN_QUALITY', cfg.DIGIPATH_STREAM_JPEG_MIN_QUALITY || '68');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_PREVIEW_ROTATE', cfg.DIGIPATH_PREVIEW_ROTATE || 'none');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_SCAN_WIDTH', cfg.DIGIPATH_SCAN_WIDTH || '2560');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_SCAN_HEIGHT', cfg.DIGIPATH_SCAN_HEIGHT || '1440');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_SCAN_ORIENTATION', cfg.DIGIPATH_SCAN_ORIENTATION || 'landscape');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_CAPTURE_MATCH_PREVIEW', cfg.DIGIPATH_CAPTURE_MATCH_PREVIEW || '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_COLOR_MODE', cfg.DIGIPATH_STREAM_COLOR_MODE || 'jpeg');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_RESTART_ON_IP_CHANGE', cfg.DIGIPATH_RESTART_ON_IP_CHANGE || '1');
bridgeEnv = upsertEnvLine(
  bridgeEnv,
  'DIGIPATH_IP_RESTART_DEBOUNCE_SECS',
  cfg.DIGIPATH_IP_RESTART_DEBOUNCE_SECS || '30',
);
writeFile(bridgeEnvPath, bridgeEnv);

const syncPiWsEnv = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  let piEnv = fs.readFileSync(filePath, 'utf8');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_BACKEND_BASE_URL', apiBase);
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_DEVICE_API_KEY', deviceKey);
  piEnv = upsertOrComment(piEnv, 'DIGIPATH_DEVTUNNEL_TOKEN', devtunnelToken);
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_FPS', cfg.DIGIPATH_STREAM_FPS || '20');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_WIDTH', cfg.DIGIPATH_STREAM_WIDTH || '2560');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_HEIGHT', cfg.DIGIPATH_STREAM_HEIGHT || '1440');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_WIDTH', cfg.DIGIPATH_SCAN_WIDTH || '2560');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_HEIGHT', cfg.DIGIPATH_SCAN_HEIGHT || '1440');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_ORIENTATION', cfg.DIGIPATH_SCAN_ORIENTATION || 'landscape');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_JPEG_QUALITY', cfg.DIGIPATH_SCAN_JPEG_QUALITY || '98');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_ENHANCE', cfg.DIGIPATH_SCAN_ENHANCE || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_SHARPEN', cfg.DIGIPATH_SCAN_SHARPEN || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_SCAN_BURST_FRAMES', cfg.DIGIPATH_SCAN_BURST_FRAMES || '6');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_JPEG_QUALITY', cfg.DIGIPATH_STREAM_JPEG_QUALITY || '92');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_FAST', cfg.DIGIPATH_STREAM_FAST || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAPTURE_MATCH_PREVIEW', cfg.DIGIPATH_CAPTURE_MATCH_PREVIEW || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAMERA_INDEX', cfg.DIGIPATH_CAMERA_INDEX || '0');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_WS_MAX_FPS', cfg.DIGIPATH_STREAM_WS_MAX_FPS || '15');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_BUFFER_FRAMES', cfg.DIGIPATH_STREAM_BUFFER_FRAMES || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_DRIVER_DRAIN', cfg.DIGIPATH_STREAM_DRIVER_DRAIN || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAMERA_READ_TIMEOUT_MS', cfg.DIGIPATH_CAMERA_READ_TIMEOUT_MS || '10000');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAMERA_READ_RETRIES', cfg.DIGIPATH_CAMERA_READ_RETRIES || '4');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAMERA_RECOVER_AFTER_MISSES', cfg.DIGIPATH_CAMERA_RECOVER_AFTER_MISSES || '24');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_CAMERA_REOPEN_AFTER_MISSES', cfg.DIGIPATH_CAMERA_REOPEN_AFTER_MISSES || '120');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_PREVIEW_WIDTH', cfg.DIGIPATH_PREVIEW_WIDTH || '1280');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_PREVIEW_HEIGHT', cfg.DIGIPATH_PREVIEW_HEIGHT || '720');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_PREVIEW_JPEG_QUALITY', cfg.DIGIPATH_PREVIEW_JPEG_QUALITY || '62');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_JPEG_MAX_BYTES', cfg.DIGIPATH_STREAM_JPEG_MAX_BYTES || '220000');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_JPEG_MIN_QUALITY', cfg.DIGIPATH_STREAM_JPEG_MIN_QUALITY || '68');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_PREVIEW_ROTATE', cfg.DIGIPATH_PREVIEW_ROTATE || 'none');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_STREAM_HTTP_UPLOAD', cfg.DIGIPATH_STREAM_HTTP_UPLOAD || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_WS_PING_INTERVAL', cfg.DIGIPATH_WS_PING_INTERVAL || '0');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_WS_STALE_SECS', cfg.DIGIPATH_WS_STALE_SECS || '90');
  piEnv = upsertOrComment(piEnv, 'DIGIPATH_GROQ_API_KEY', groqApiKey);
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_AI_EXTRACT', groqApiKey ? (cfg.DIGIPATH_AI_EXTRACT || '1') : '0');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_AI_USE_VISION', cfg.DIGIPATH_AI_USE_VISION || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_AI_BACKGROUND', cfg.DIGIPATH_AI_BACKGROUND || '1');
  piEnv = upsertEnvLine(piEnv, 'DIGIPATH_AI_EXTRACT_MAX_TOKENS', cfg.DIGIPATH_AI_EXTRACT_MAX_TOKENS || '4096');
  writeFile(filePath, piEnv);
};

// Pi WS package .env (repo + D: drive copy)
const piWsEnvPath = path.join(root, 'pi_ws_scanner.env');
const piWsEnvExample = path.join(root, 'pi_ws_scanner.env.example');
if (!fs.existsSync(piWsEnvPath) && fs.existsSync(piWsEnvExample)) {
  fs.copyFileSync(piWsEnvExample, piWsEnvPath);
}
syncPiWsEnv(piWsEnvPath);
for (const drivePath of ['D:\\VinzonsDIGIPATH-Pi\\.env']) {
  if (!fs.existsSync(drivePath)) {
    const driveDir = path.dirname(drivePath);
    if (!fs.existsSync(driveDir) && fs.existsSync(piWsEnvExample)) {
      try {
        fs.mkdirSync(driveDir, { recursive: true });
        fs.copyFileSync(piWsEnvExample, drivePath);
      } catch {
        // USB drive letter may be unavailable on this machine
      }
    }
  }
  if (fs.existsSync(drivePath)) {
    syncPiWsEnv(drivePath);
  }
}

// pi-update-network.sh BACKEND_URL
const piScriptPath = path.join(root, 'scripts', 'pi-update-network.sh');
if (fs.existsSync(piScriptPath)) {
  let piScript = fs.readFileSync(piScriptPath, 'utf8');
  piScript = piScript.replace(
    /^BACKEND_URL=".*"$/m,
    `BACKEND_URL="${apiBase}"`,
  );
  piScript = piScript.replace(
    /^DEVICE_KEY=".*"$/m,
    `DEVICE_KEY="${deviceKey}"`,
  );
  if (devtunnelToken) {
    if (/^DEVTUNNEL_TOKEN=".*"$/m.test(piScript)) {
      piScript = piScript.replace(/^DEVTUNNEL_TOKEN=".*"$/m, `DEVTUNNEL_TOKEN="${devtunnelToken}"`);
    } else {
      piScript = piScript.replace(
        /^DEVICE_KEY=".*"$/m,
        `DEVICE_KEY="${deviceKey}"\nDEVTUNNEL_TOKEN="${devtunnelToken}"`,
      );
    }
  }
  writeFile(piScriptPath, piScript);
}

// raspberry_pi env example
const piEnvExample = path.join(root, 'raspberry_pi', 'digipath-scanner.env.example');
if (fs.existsSync(piEnvExample)) {
  let content = fs.readFileSync(piEnvExample, 'utf8');
  content = content.replace(
    /^DIGIPATH_BACKEND_BASE_URL=.*$/m,
    `DIGIPATH_BACKEND_BASE_URL="${apiBase}"`,
  );
  writeFile(piEnvExample, content);
}

console.log('\nDone. Next steps:');
console.log('  1. Laptop: npm start  (hosts dev tunnel + backend + dashboard)');
console.log('  2. Pi: copy D:\\VinzonsDIGIPATH-Pi to Desktop, then bash pi-fix-and-run-ws.sh');
console.log('  3. Browser: hard refresh dashboard (Ctrl+Shift+R)');
if (devtunnelToken) {
  console.log('  4. Pi .env includes DIGIPATH_DEVTUNNEL_TOKEN (refresh daily: npm run tunnel:token)');
}
