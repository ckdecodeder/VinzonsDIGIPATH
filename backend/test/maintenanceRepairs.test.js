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
