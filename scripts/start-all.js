#!/usr/bin/env node
/**
 * One command: sync network → start backend + dashboard → open browser.
 * Usage: npm start   (or: npm run dev without browser/sync)
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dashboardUrl = process.env.DIGIPATH_DASHBOARD_URL || 'http://localhost:5173';
const backendHealthUrl = process.env.DIGIPATH_BACKEND_HEALTH_URL || 'http://127.0.0.1:5000/api/status';

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

const networkEnv = parseEnvFile(path.join(root, 'network.env'));
const autoOpenBrowser = (process.env.DIGIPATH_AUTO_OPEN_BROWSER
  ?? networkEnv.DIGIPATH_AUTO_OPEN_BROWSER
  ?? '1').trim() !== '0';
const autoTunnel = (process.env.DIGIPATH_AUTO_TUNNEL
  ?? networkEnv.DIGIPATH_AUTO_TUNNEL
  ?? '0').trim() === '1';

let shuttingDown = false;
const children = [];

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (child && !child.killed) child.kill();
  });
  process.exitCode = code;
};

const waitForUrl = (url, timeoutMs = 120000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const attempt = () => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 1000);
    });
    req.setTimeout(4000, () => {
      req.destroy();
    });
  };
  attempt();
});

const openBrowser = (url) => {
  if (!autoOpenBrowser) return;
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
};

const startService = (name, args) => {
  const child = spawn(npmCommand, args, {
    cwd: root,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
};

const maybeStartTunnel = () => {
  if (!autoTunnel) return;
  const tunnelId = (networkEnv.DIGIPATH_TUNNEL_ID || '').trim();
  const args = tunnelId
    ? ['host', tunnelId, '-p', '5000', '--allow-anonymous']
    : ['host', '-p', '5000', '--allow-anonymous'];
  const tunnel = spawn('devtunnel', args, {
    cwd: root,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tunnel.stdout.on('data', (chunk) => process.stdout.write(`[tunnel] ${chunk}`));
  tunnel.stderr.on('data', (chunk) => process.stderr.write(`[tunnel] ${chunk}`));
  tunnel.on('error', () => {
    console.warn('[DigiPath] devtunnel not found — skip auto tunnel or install: https://aka.ms/devtunnels/cli');
  });
  children.push(tunnel);
};

console.log('');
console.log('========================================');
console.log('  VinzonsDIGIPATH — starting all services');
console.log('========================================');
console.log('');

console.log('[DigiPath] Step 1/3 — sync network.env ...');
const sync = spawnSync('node', ['scripts/sync-network-config.js'], { cwd: root, stdio: 'inherit' });
if (sync.status !== 0) {
  console.warn('[DigiPath] network:sync had warnings — continuing anyway');
}

const publicUrl = networkEnv.DIGIPATH_PUBLIC_BACKEND_URL || '';
if (publicUrl.includes('devtunnels.ms') && !autoTunnel) {
  console.log('');
  console.log('[DigiPath] Tip: Public URL uses dev tunnel. Keep VS Code port 5000 tunnel PUBLIC,');
  console.log('         or set DIGIPATH_AUTO_TUNNEL=1 in network.env if devtunnel CLI is installed.');
  console.log('');
}

console.log('[DigiPath] Step 2/3 — start backend + dashboard ...');
maybeStartTunnel();
startService('backend', ['--prefix', 'backend', 'run', 'dev']);
startService('dashboard', ['--prefix', 'dashboard', 'run', 'dev']);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

(async () => {
  try {
    console.log('[DigiPath] Waiting for backend ...');
    await waitForUrl(backendHealthUrl).catch(async () => {
      await waitForUrl('http://127.0.0.1:5000/');
    });
    console.log('[DigiPath] Waiting for dashboard ...');
    await waitForUrl(dashboardUrl);
    console.log('');
    console.log('[DigiPath] Step 3/3 — ready!');
    console.log(`  Dashboard: ${dashboardUrl}`);
    console.log('  Backend:   http://127.0.0.1:5000');
    if (publicUrl) console.log(`  Public:    ${publicUrl}`);
    console.log('');
    openBrowser(dashboardUrl);
    console.log('[DigiPath] Press Ctrl+C to stop all services.');
    console.log('');
  } catch (err) {
    console.warn(`[DigiPath] ${err.message}`);
    console.warn('[DigiPath] Services are still starting — check terminal output above.');
  }
})();
