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
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
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
const bridgeUrl = (cfg.DIGIPATH_SCANNER_BRIDGE_URL || '').replace(/\/$/, '');

if (!publicRoot) {
  console.error('Set DIGIPATH_PUBLIC_BACKEND_URL in network.env first.');
  process.exit(1);
}

const apiBase = publicRoot.endsWith('/api') ? publicRoot : `${publicRoot}/api`;

console.log('Syncing network config...');
console.log(`  public API: ${apiBase}`);

// dashboard/.env
const dashboardEnvPath = path.join(root, 'dashboard', '.env');
let dashboardEnv = ensureFile(dashboardEnvPath, path.join(root, 'dashboard', '.env.example'));
dashboardEnv = upsertEnvLine(dashboardEnv, 'VITE_API_BASE_URL', apiBase);
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
  'REALTIME_STREAM_MIN_INTERVAL_MS',
  cfg.REALTIME_STREAM_MIN_INTERVAL_MS || '0',
);
writeFile(backendEnvPath, backendEnv);

// bridge.env (Pi package)
const bridgeEnvPath = path.join(root, 'bridge.env');
let bridgeEnv = ensureFile(bridgeEnvPath, path.join(root, 'bridge.env.example'));
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_BACKEND_BASE_URL', apiBase);
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_DEVICE_API_KEY', deviceKey);
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_USE_WEBSOCKET', '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_ENABLE_MJPEG_HTTP', '1');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_FPS', cfg.DIGIPATH_STREAM_FPS || '30');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_WIDTH', cfg.DIGIPATH_STREAM_WIDTH || '640');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_HEIGHT', cfg.DIGIPATH_STREAM_HEIGHT || '360');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_JPEG_QUALITY', cfg.DIGIPATH_STREAM_JPEG_QUALITY || '82');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_FAST', cfg.DIGIPATH_STREAM_FAST || '0');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_WS_MAX_FPS', cfg.DIGIPATH_STREAM_WS_MAX_FPS || '24');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_STREAM_COLOR_MODE', cfg.DIGIPATH_STREAM_COLOR_MODE || 'jpeg');
bridgeEnv = upsertEnvLine(bridgeEnv, 'DIGIPATH_RESTART_ON_IP_CHANGE', cfg.DIGIPATH_RESTART_ON_IP_CHANGE || '1');
bridgeEnv = upsertEnvLine(
  bridgeEnv,
  'DIGIPATH_IP_RESTART_DEBOUNCE_SECS',
  cfg.DIGIPATH_IP_RESTART_DEBOUNCE_SECS || '30',
);
writeFile(bridgeEnvPath, bridgeEnv);

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
console.log('  1. Laptop: npm run dev  (+ dev tunnel public on port 5000 if using dev tunnel URL)');
console.log('  2. Pi: sudo bash scripts/pi-update-network.sh && sudo systemctl restart digipath-scanner');
console.log('  3. Browser: hard refresh dashboard (Ctrl+Shift+R)');
console.log('  4. Optional: clear stale API cache in browser DevTools → Application → localStorage → dp_api_url');
