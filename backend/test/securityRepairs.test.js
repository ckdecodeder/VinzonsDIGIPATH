const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');
const { RealtimeHub } = require('../ws/realtimeHub');

const socket = (id, role = 'Office') => Object.assign(new EventEmitter(), {
  OPEN: 1, readyState: 1, subscriptions: new Set(), messages: [],
  auth: id ? { kind: 'user', userId: id, role, officeId: 'SOURCE', expiresAt: Date.now() + 60000 } : null,
  send(value) { this.messages.push(typeof value === 'string' ? JSON.parse(value) : value); },
  close(code) { this.closed = code; this.readyState = 3; this.emit('close'); },
});
test('command events reach only the requester and approval users and never contain full documents', () => {
  const hub = new RealtimeHub();
  const requester = socket('REQUESTER', 'Receptionist'), unrelated = socket('OTHER'), admin = socket('ADMIN', 'Admin');
  for (const ws of [requester, unrelated, admin]) { ws.subscriptions.add('command:PRIVATE'); hub.trackUserClient(ws); }
  hub.broadcastCommandUpdated({ id: 'PRIVATE', requestedBy: 'REQUESTER' }, { id: 'DOC', scannedText: 'private OCR' });
  assert.equal(unrelated.messages.length, 0);
  const formerRequester = socket('REQUESTER', 'Office'); hub.trackUserClient(formerRequester);
  hub.broadcastCommandUpdated({ id: 'PRIVATE', requestedBy: 'REQUESTER' });
  assert.equal(formerRequester.messages.length, 0);
  for (const ws of [requester, admin]) { assert.equal(ws.messages.length, 2); assert.equal(ws.messages[0].resultDocument, undefined); assert.equal(ws.messages[0].resultDocumentId, 'DOC'); }
});
test('Office sockets cannot subscribe to camera frames or send scanner signals', () => {
  const hub = new RealtimeHub(); const ws = socket('OFFICE'); hub.handleUserSocket(ws);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', channel: 'scanner:DEV-001:stream' })), false);
  assert.equal(ws.subscriptions.size, 0);
  let relayed = false; hub.relayWebRtcToDevice = () => { relayed = true; };
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'scanner:webrtc:offer', channel: 'scanner:DEV-001', sdp: 'synthetic' })), false);
  assert.equal(relayed, false);
});
test('WebSocket authentication rejects missing accounts and uses the current role with an expiry', async () => {
  const original = process.env.JWT_SECRET; process.env.JWT_SECRET = 'synthetic-security-test-secret-0123456789';
  try {
    let user = null; const hub = new RealtimeHub({ resolveUser: async () => user }); hub.pushDeviceSnapshotToClient = () => {};
    const token = jwt.sign({ id: 'ACCOUNT', role: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '60s' });
    const missing = socket(); await hub.authenticateUser(missing, token); assert.equal(missing.closed, 4401);
    user = { id: 'ACCOUNT', role: 'Office', officeId: 'SOURCE' };
    const active = socket(); await hub.authenticateUser(active, token);
    assert.equal(active.auth.role, 'Office'); assert(active.auth.expiresAt > Date.now());
    active.auth.expiresAt = Date.now() - 1;
    hub.broadcastDataInvalidate(['documents']); assert.equal(active.messages.filter(m => m.type === 'data:invalidate').length, 0);
    await hub.revalidateUsers(); assert.equal(active.closed, 4401); clearTimeout(active.sessionTimer);
  } finally { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; }
});
test('deleted or reassigned accounts lose existing WebSocket sessions', async () => {
  const hub = new RealtimeHub({ resolveUser: async () => null }); const ws = socket('REMOVED'); hub.trackUserClient(ws);
  await hub.revalidateUsers(); assert.equal(ws.closed, 4401); assert.equal(hub.userClients.size, 0);
  const other = socket('REVOKED'); hub.trackUserClient(other); hub.revokeUser('REVOKED'); assert.equal(other.closed, 4401);
});
test('device authentication fails closed for defaults or absent configuration', () => {
  const { getDeviceApiKey, requireDeviceApiKey } = require('../utils/bridge'); const original = process.env.DEVICE_API_KEY;
  try {
    for (const key of ['', 'dev-device-key-change-me', 'short']) {
      process.env.DEVICE_API_KEY = key; assert.equal(getDeviceApiKey(), null);
      const res = { status(code) { this.code = code; return this; }, json() {} };
      requireDeviceApiKey({ get: () => key }, res, () => assert.fail('Weak configuration accepted')); assert.equal(res.code, 503);
    }
    process.env.DEVICE_API_KEY = 'synthetic-device-key-with-sufficient-length-1234';
    let accepted = false; requireDeviceApiKey({ get: () => process.env.DEVICE_API_KEY }, {}, () => { accepted = true; }); assert(accepted);
  } finally { if (original === undefined) delete process.env.DEVICE_API_KEY; else process.env.DEVICE_API_KEY = original; }
});
test('bridge calls require the registered numeric LAN address and reject arbitrary hosts and ports', () => {
  const { getBridgeBaseUrl, assertBridgeDestination } = require('../utils/bridge');
  const device = { ip: '192.168.1.45' };
  assert.equal(getBridgeBaseUrl({ query: {}, body: {} }, device), 'http://192.168.1.45:8080');
  for (const bridgeUrl of ['http://audit.invalid:8080', 'http://127.0.0.1:8080', 'http://192.168.1.45:5000', 'http://192.168.1.46:8080']) assert.throws(() => getBridgeBaseUrl({ query: { bridgeUrl } }, device), { status: 400 });
  assert.throws(() => assertBridgeDestination('http://scanner.attacker.invalid:8080'), { status: 400 });
});
test('bridge timeout covers a stalled body and redirects are rejected', async () => {
  const filename = path.resolve(__dirname, '../utils/bridge.js'), realRequire = createRequire(filename);
  let redirect;
  const context = { module: { exports: {} }, process: { env: { SCANNER_BRIDGE_TIMEOUT_MS: '20' } }, require: realRequire, URL, AbortController, Response, setTimeout, clearTimeout,
    fetch: async (url, options) => { redirect = options.redirect; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); options.signal.addEventListener('abort', () => controller.error(new Error('deadline'))); } })); },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  await assert.rejects(context.module.exports.fetchBridgeEndpoint('http://192.168.1.45:8080', '/status'), /deadline/);
  assert.equal(redirect, 'error');
});
