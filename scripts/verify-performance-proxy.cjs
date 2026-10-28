const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const backup = path.join(root, 'database-export', 'performance-operation-2026-10-28');
const env = require('../backend/node_modules/dotenv').parse(fs.readFileSync(path.join(backup, 'test-backend.env')));
if (new URL(env.DATABASE_URL).pathname !== '/vinzons_digipath_perf_test_20261028' || env.PORT !== '5501') throw new Error('Expected isolated configuration');
Object.assign(process.env, env);
const { _sequelizeModels } = require('../backend/models');
const { sequelize } = require('../backend/config/db');
const { createToken } = require('../backend/middleware/auth');
const WebSocket = require('../backend/node_modules/ws');

async function main() {
  try {
    const status = await fetch('http://127.0.0.1:5174/api/status');
    assert.equal(status.status, 200); assert.equal((await status.json()).database, 'connected');
    const config = await (await fetch('http://127.0.0.1:5174/api/config')).json();
    assert.equal(config.apiUrl, 'http://127.0.0.1:5501/api');
    const sample = JSON.parse(fs.readFileSync(path.join(backup, 'scan-manifest.json'))).find((file) => file.name.endsWith('.pdf'));
    const attachment = await fetch(`http://127.0.0.1:5174/uploads/scans/${encodeURIComponent(sample.name)}`);
    assert.equal(attachment.status, 200);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await attachment.arrayBuffer())).digest('hex'), sample.sha256);
    const user = await _sequelizeModels.UserModel.findOne({ where: { role: 'Admin' }, attributes: { exclude: ['password'] }, raw: true });
    const token = createToken(user);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:5174/ws');
      let settled = false;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); ws.close(); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error('WS proxy timeout')), 5000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('error', () => finish(new Error('WS proxy failed')));
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'auth:ok') finish();
        if (message.type === 'auth:error') finish(new Error('WS proxy authentication failed'));
      });
    });
    const frame = Buffer.alloc(64); frame[0] = 0xff; frame[1] = 0xd8;
    const statuses = await Promise.all(Array.from({ length: 31 }, () => fetch('http://127.0.0.1:5501/api/devices/stream/frame?deviceId=PERF-PREVIEW-CHECK', {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-device-key': env.DEVICE_API_KEY }, body: frame,
    }).then(async (response) => { await response.arrayBuffer(); return response.status; })));
    assert.equal(statuses.filter((status) => status === 200).length, 30);
    assert.equal(statuses.filter((status) => status === 429).length, 1);
    const evidence = { verifiedAt: new Date().toISOString(), apiProxy: 'passed', websocketProxyAndAuthentication: 'passed', uploadProxyChecksum: 'passed', authenticatedPreviewBurst: { accepted: 30, limited: 1 }, physicalPi: 'not tested' };
    fs.writeFileSync(path.join(backup, 'proxy-verification.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await sequelize.close(); }
}
main().catch((error) => { console.error('Isolated proxy verification failed:', error.message); process.exitCode = 1; });
