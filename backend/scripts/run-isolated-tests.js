const path = require('node:path');
const { spawnSync } = require('node:child_process');
const run = files => {
  require('dotenv').config({ quiet: true });
  require('../utils/maintenanceGuard').requireTestWrite(process.env.WORKFLOW_TEST_DATABASE_URL, process.argv);
  console.log('Running isolated synthetic HTTP/PostgreSQL checks; no live API or hardware commands.');
  const result = spawnSync(process.execPath, ['--test', ...files.map(file => path.join(__dirname, '../test', file))], {
    env: { ...process.env, DATABASE_URL: '' }, stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = result.status ?? 1;
};
module.exports = { run };
