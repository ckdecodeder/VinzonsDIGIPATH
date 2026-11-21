const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTestWrite, requireMaintenanceWrite } = require('../utils/maintenanceGuard');
const { validateRuntimeConfig } = require('../config/runtime');
const { timestampCandidates } = require('../../scripts/reconcile-system-data.cjs');
test('maintenance guards refuse a live seed/import and implicit schema writes', () => {
  assert.throws(() => requireTestWrite('postgres://localhost/live', ['--apply']), /disposable/);
  assert.throws(() => requireTestWrite('postgres://localhost/live_test', []), /apply/);
  requireTestWrite('postgres://localhost/live_test_20261029', ['--apply']);
  assert.throws(() => requireMaintenanceWrite('postgres://localhost/live', ['--apply']), /backup/);
  assert.throws(() => requireMaintenanceWrite('postgres://localhost/live_test', []), /apply/);
});
test('runtime rejects weak credentials even when production mode is disabled', () => {
  const env = { DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 's'.repeat(48), DEVICE_API_KEY: 'd'.repeat(48), NODE_ENV: 'development' };
  validateRuntimeConfig(env);
  assert.throws(() => validateRuntimeConfig({ ...env, DEVICE_API_KEY: 'dev-device-key-change-me' }), /DEVICE_API_KEY/);
  assert.throws(() => validateRuntimeConfig({ ...env, JWT_SECRET: '' }), /JWT_SECRET/);
});
test('receipt reconciliation preserves ambiguity and requires a matching transmission and user', () => {
  const tx = { id: 'T', receivedBy: 'U' }, timestamp = '2026-10-29T12:00:00.000Z';
  assert.deepEqual(timestampCandidates({ timeline: [{ referenceId: 'OTHER', userId: 'U', action: 'transmission_received', timestamp }] }, tx), []);
  assert.deepEqual(timestampCandidates({ timeline: [{ referenceId: 'T', userId: 'WRONG', action: 'transmission_received', timestamp }] }, tx), []);
  const doc = { timeline: [{ referenceId: 'T', userId: 'U', action: 'transmission_received', timestamp }], sendHistory: [{ transmissionId: 'T', receivedBy: 'U', receivedAt: '2026-10-29T13:00:00.000Z' }] };
  assert.equal(timestampCandidates(doc, tx).length, 2);
});
test('network synchronization refuses a weak source key before rewriting any application settings', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const filename = path.resolve(__dirname, '../../scripts/sync-network-config.js');
  const realRequire = require('node:module').createRequire(filename); let writes = 0;
  const fakeFs = { existsSync: () => true, readFileSync: () => 'DIGIPATH_PUBLIC_BACKEND_URL=https://synthetic.invalid\nDIGIPATH_DEVICE_API_KEY=short\n', writeFileSync: () => { writes++; }, copyFileSync: () => { writes++; } };
  const context = { __dirname: path.dirname(filename), require: id => id === 'fs' ? fakeFs : realRequire(id), console: { log() {}, error() {} }, process: { exit: () => { throw new Error('refused'); } } };
  assert.throws(() => vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context), /refused/);
  assert.equal(writes, 0);
});


test('test workflow reset retains every scan file', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const filename = path.resolve(__dirname, '../scripts/wipe-workflow-data.js');
  let ended = false;
  const client = { connect: async () => {}, end: async () => { ended = true; },
    query: async sql => ({ rows: sql.includes('COUNT') ? [{ n: 0 }] : [], rowCount: 0 }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => {
      if (id === 'dotenv') return { config() {} };
      if (id === '../utils/maintenanceGuard') return { requireTestWrite };
      if (id === 'pg') return { Client: function () { return client; } };
      throw new Error('Unexpected dependency or filesystem access: ' + id);
    },
    process: { env: { DATABASE_URL: 'postgres://localhost/synthetic_test' }, argv: ['node', 'reset', '--apply'] },
    console: { log() {}, error(message) { throw Error(message); } },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ended, true);
});

test('network sync never exports synthetic credentials into tracked shell source', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const filename = path.resolve(__dirname, '../../scripts/sync-network-config.js');
  const realRequire = require('node:module').createRequire(filename);
  const key = 'synthetic-private-scanner-key-0123456789', token = 'synthetic-private-tunnel-token';
  for (const configuredToken of ['', token]) {
    const writes = new Map();
    const fakeFs = { existsSync: () => true,
      readFileSync: file => file.endsWith('network.env')
        ? `DIGIPATH_PUBLIC_BACKEND_URL=https://synthetic.invalid\nDIGIPATH_DEVICE_API_KEY=${key}\nDIGIPATH_DEVTUNNEL_TOKEN=${configuredToken}\n`
        : file.endsWith('pi-update-network.sh') ? fs.readFileSync(file, 'utf8') : '',
      writeFileSync: (file, content) => writes.set(file, content) };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      __dirname: path.dirname(filename), require: id => id === 'fs' ? fakeFs : realRequire(id),
      console: { log() {}, error() {} }, process: { exit: () => { throw Error('Unexpected refusal'); } },
    });
    const shell = writes.get(path.resolve(__dirname, '../../scripts/pi-update-network.sh'));
    assert.ok(shell); assert.ok(!shell.includes(key)); assert.ok(!shell.includes(token));
    assert.ok(shell.includes('pi_load_env'));
  }
});
