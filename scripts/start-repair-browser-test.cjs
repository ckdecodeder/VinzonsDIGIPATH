// Synthetic browser acceptance server. No .env loading, database, hardware or notification delivery.
delete process.env.DATABASE_URL;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const backend = createRequire(path.join(root, 'backend/package.json'));
const dashboard = createRequire(path.join(root, 'dashboard/package.json'));
const express = backend('express');
const jwt = backend('jsonwebtoken');
const tempRoot = path.join(root, 'database-export/system-repair-2026-10-29/browser-fixtures');
fs.mkdirSync(tempRoot, { recursive: true });
fs.writeFileSync(path.join(tempRoot, 'synthetic.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const { jsPDF } = dashboard('jspdf'); const pdf = new jsPDF(); pdf.text('Synthetic protected scan', 20, 30);
fs.writeFileSync(path.join(tempRoot, 'synthetic.pdf'), Buffer.from(pdf.output('arraybuffer')));
const secret = crypto.randomBytes(32).toString('hex');
const syntheticToken = jwt.sign({ id: 'SYNTHETIC', role: 'Office' }, secret, { expiresIn: '1h' });
const metrics = { authorizedFiles: 0, unauthorizedFiles: 0 };
const app = express();
app.get('/api/status', (req, res) => res.json({ status: 'API is running', database: 'connected', ready: true }));
app.get('/api/config', (req, res) => res.json({ apiUrl: '/api', iceServers: [] }));
app.get('/test/config', (req, res) => res.json({ syntheticToken }));
app.get('/test/metrics', (req, res) => res.json(metrics));
const authenticate = (req, res, next) => {
  try { const user = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), secret); req.user = { ...user, officeId: 'SOURCE' }; metrics.authorizedFiles++; next(); }
  catch { metrics.unauthorizedFiles++; res.sendStatus(401); }
};
app.use('/uploads', backend('./routes/files').createFileRouter({ authenticate, root: tempRoot,
  Document: { _buildWhere: () => ({}) },
  DocumentModel: { sequelize: { escape: value => "'" + value.replaceAll("'", "''") + "'" }, findOne: async () => ({ id: 'SYNTHETIC-DOC' }) },
}));
const server = app.listen(0, '127.0.0.1', () => {
  const api = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5181'], {
    cwd: path.join(root, 'dashboard'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_API_BASE_URL: '/api', VITE_BACKEND_PROXY_TARGET: api, VITE_WS_URL: '' },
  });
  child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
  console.log('Synthetic acceptance: http://127.0.0.1:5181/test/security-harness.html');
  const stop = () => { child.kill(); server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); child.on('exit', () => server.close());
});
