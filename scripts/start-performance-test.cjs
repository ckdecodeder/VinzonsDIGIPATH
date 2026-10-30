// Starts only the verified restored database and cloned scans; no network sync.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const backup = path.join(root, 'database-export', 'performance-operation-2026-10-28');
const env = require('../backend/node_modules/dotenv').parse(fs.readFileSync(path.join(backup, 'test-backend.env')));
if (new URL(env.DATABASE_URL).pathname !== '/vinzons_digipath_perf_test_20261028'
  || path.resolve(env.UPLOADS_ROOT) !== path.join(backup, 'test-uploads')
  || env.HOST !== '127.0.0.1' || env.PORT !== '5501') {
  throw new Error('Refusing to start: expected isolated performance test configuration');
}
Object.assign(process.env, env);
process.chdir(path.join(root, 'backend'));
require('../backend/server');
