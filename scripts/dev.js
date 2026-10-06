const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

const isLocalApiUrl = (raw) => {
  const url = raw?.trim();
  if (!url || url.startsWith('/')) return true;

  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return true;
  }
};

const usesRemoteBackend = () => {
  if (process.env.DIGIPATH_FRONTEND_ONLY === '1') return true;

  const dashboardEnv = parseEnvFile(path.join(process.cwd(), 'dashboard', '.env'));
  const apiUrl = dashboardEnv.VITE_API_BASE_URL?.trim();
  return Boolean(apiUrl && !isLocalApiUrl(apiUrl));
};

const frontendOnly = usesRemoteBackend();
const services = frontendOnly
  ? [{ name: 'dashboard', args: ['--prefix', 'dashboard', 'run', 'dev'] }]
  : [
      { name: 'backend', args: ['--prefix', 'backend', 'run', 'dev'] },
      { name: 'dashboard', args: ['--prefix', 'dashboard', 'run', 'dev'] },
    ];

if (frontendOnly) {
  const dashboardEnv = parseEnvFile(path.join(process.cwd(), 'dashboard', '.env'));
  const apiUrl = dashboardEnv.VITE_API_BASE_URL?.trim() || '(remote API)';
  console.log('[DigiPath] Remote backend mode — dashboard only.');
  console.log(`[DigiPath] API: ${apiUrl}`);
  console.log('[DigiPath] Run from dashboard/: npm run dev');
}

let shuttingDown = false;

const children = services.map((service) => {
  const child = spawn(npmCommand, service.args, {
    cwd: process.cwd(),
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${service.name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${service.name}] ${chunk}`);
  });
  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      console.error(`[${service.name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
  process.exitCode = code;
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
