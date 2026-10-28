#!/usr/bin/env node
/**
 * Start backend + dashboard and open browser. Configuration sync is opt-in.
 * Usage: npm start   (or: npm run dev without browser/sync)
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
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

const buildTunnelArgs = (tunnelId = '') => {
  const normalizedId = (tunnelId || '').trim();
  return normalizedId
    ? ['host', normalizedId, '-p', '5000', '--allow-anonymous']
    : ['host', '-p', '5000', '--allow-anonymous'];
};

const networkEnv = parseEnvFile(path.join(root, 'network.env'));
const shouldSyncNetworkOnStart = (processEnv = process.env, networkSettings = networkEnv) => (
  processEnv.DIGIPATH_SYNC_NETWORK_ON_START ?? networkSettings.DIGIPATH_SYNC_NETWORK_ON_START ?? '0'
).trim() === '1';
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

const waitForUrl = async (url, timeoutMs = 120000, { pollIntervalMs = 1000 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  const apiHealth = new URL(url).pathname.endsWith('/api/status');
  while (Date.now() < deadline) {
    const healthy = await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const req = (url.startsWith('https:') ? https : http).get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 65536) { finish(false); req.destroy(); }
        });
        res.on('error', () => finish(false));
        res.on('end', () => {
          let valid = res.statusCode >= 200 && res.statusCode < 300;
          if (apiHealth) {
            try {
              const data = JSON.parse(body);
              valid = valid && /application\/json/i.test(res.headers['content-type'] || '')
                && data.status === 'API is running' && data.database === 'connected';
            } catch { valid = false; }
          }
          finish(valid);
        });
      });
      req.on('error', () => finish(false));
      timer = setTimeout(() => { finish(false); req.destroy(); }, Math.min(4000, Math.max(1, deadline - Date.now())));
    });
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`Timed out waiting for a healthy response from ${url}`);
};

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

const maybeStartTunnel = (opts = {}) => {
  const {
    autoTunnelEnabled = autoTunnel,
    env = networkEnv,
    spawnFn = spawn,
    logger = console,
    childList = children,
  } = opts;

  if (!autoTunnelEnabled) return null;

  const tunnelId = (env.DIGIPATH_TUNNEL_ID || '').trim();
  if (tunnelId) {
    logger.warn('[DigiPath] Existing dev tunnel ID detected; skipping automatic host launch to avoid the "host token" panic.');
    logger.warn('         Keep the public URL in DIGIPATH_PUBLIC_BACKEND_URL, or run: devtunnel host <tunnel-id> -p 5000 --allow-anonymous');
    return null;
  }

  const args = buildTunnelArgs();
  const tunnel = spawnFn('devtunnel', args, {
    cwd: root,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tunnel.stdout.on('data', (chunk) => process.stdout.write(`[tunnel] ${chunk}`));
  tunnel.stderr.on('data', (chunk) => process.stderr.write(`[tunnel] ${chunk}`));
  tunnel.on('error', () => {
    logger.warn('[DigiPath] devtunnel not found — skip auto tunnel or install: https://aka.ms/devtunnels/cli');
  });
  tunnel.on('exit', (code) => {
    if (code && code !== 0) {
      logger.warn('[DigiPath] devtunnel exited without a host token; continuing without the auto tunnel.');
      logger.warn('         If the tunnel is already public, keep DIGIPATH_AUTO_TUNNEL=0 and use the public URL in network.env.');
    }
  });
  childList.push(tunnel);
  return tunnel;
};

const main = () => {
  console.log('');
  console.log('========================================');
  console.log('  VinzonsDIGIPATH — starting all services');
  console.log('========================================');
  console.log('');

  if (shouldSyncNetworkOnStart()) {
    console.log('[DigiPath] Step 1/3 — synchronize network.env (explicitly enabled) ...');
    const sync = spawnSync('node', ['scripts/sync-network-config.js'], { cwd: root, stdio: 'inherit' });
    if (sync.status !== 0) {
      console.error('[DigiPath] Configuration synchronization failed; services were not started.');
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('[DigiPath] Step 1/3 — using existing configuration. Run npm run network:sync explicitly when changing endpoints.');
  }

  const publicUrl = parseEnvFile(path.join(root, 'backend', '.env')).PUBLIC_API_URL
    || networkEnv.DIGIPATH_PUBLIC_BACKEND_URL || '';
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
      await waitForUrl(backendHealthUrl);
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
};

if (require.main === module) {
  main();
}

module.exports = {
  shouldSyncNetworkOnStart,
  parseEnvFile,
  buildTunnelArgs,
  maybeStartTunnel,
  waitForUrl,
  openBrowser,
};
