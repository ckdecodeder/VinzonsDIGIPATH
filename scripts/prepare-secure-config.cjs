// Prepare a coordinated local rollout bundle. Does not replace running configuration or contact the Pi.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dotenv = require('../backend/node_modules/dotenv');
const { weakSecret } = require('../backend/config/runtime');
const set = (text, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : text.trimEnd() + `\n${key}=${value}\n`;
};
const prepare = () => {
  const folder = path.join(root, 'database-export', 'secure-rollout-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'));
  execFileSync('git', ['check-ignore', path.join(folder, 'backend.env')], { cwd: root, stdio: 'ignore' });
  const backend = fs.readFileSync(path.join(root, 'backend/.env'), 'utf8');
  const config = dotenv.parse(backend);
  if (!config.PUBLIC_API_URL || !/^https?:\/\//.test(config.PUBLIC_API_URL)) throw new Error('Set the intended public backend in the current configuration before preparing a rollout.');
  const deviceKey = crypto.randomBytes(32).toString('hex');
  const jwtSecret = weakSecret(config.JWT_SECRET) ? crypto.randomBytes(48).toString('hex') : config.JWT_SECRET;
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const write = (name, content) => fs.writeFileSync(path.join(folder, name), content, { flag: 'wx', mode: 0o600 });
  write('previous-backend.env', backend);
  write('backend.env', set(set(set(backend, 'DEVICE_API_KEY', deviceKey), 'JWT_SECRET', jwtSecret), 'NODE_ENV', 'production'));
  for (const [file, name, key, urlKey] of [['network.env', 'network.env', 'DIGIPATH_DEVICE_API_KEY', 'DIGIPATH_PUBLIC_BACKEND_URL'], ['pi_ws_scanner.env', 'pi_ws_scanner.env', 'DIGIPATH_DEVICE_API_KEY', 'DIGIPATH_BACKEND_BASE_URL']]) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    write('previous-' + name, original);
    write(name, set(set(original, key, deviceKey), urlKey, config.PUBLIC_API_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')));
  }
  write('README.txt', 'Private rollout configuration. Preserve old settings securely. Coordinate backend and physical Pi key changes in one maintenance window. Apply matching files, then restart and verify HTTP/device WS/scan behavior. Do not publish this folder. No files were applied automatically.\n');
  console.log('Prepared private configuration bundle: ' + folder);
  console.log('Current backend/Pi/network configuration and running services were not changed.');
  return folder;
};
if (require.main === module) { try { prepare(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { prepare };
