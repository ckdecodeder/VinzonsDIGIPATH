/* Read-only, isolated probes of the checked-in application source. No server or DB writes. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
const parser = createRequire(path.join(root, 'dashboard/package.json'))('@babel/parser');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const results = {};

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

function serviceFor(role, responseMode = 'ok') {
  const calls = [];
  const source = read('dashboard/src/api/documentService.js')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export const /g, 'const ');
  const sandbox = {
    module: { exports: {} },
    getApiBase: () => 'https://audit.invalid/api',
    sessionStorage: storage({ dp_currentUser: JSON.stringify({ id: 'audit-user', role }), dp_authToken: 'audit-token' }),
    localStorage: storage(),
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname, hasAbortSignal: Boolean(options.signal) });
      if (responseMode === 'hang-logs' && url.endsWith('/logs')) return new Promise(() => {});
      const failed = responseMode === 'fail-logs' && url.endsWith('/logs');
      return { ok: !failed, status: failed ? 503 : 200, text: async () => failed ? '{"message":"audit failure"}' : '[]' };
    },
  };
  vm.runInNewContext(`${source}\nmodule.exports = { appDataService };`, sandbox);
  return { ...sandbox.module.exports, calls };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

async function main() {
  results.requestsPerFullReload = {};
  for (const role of ['Admin', 'Mayor', 'Receptionist', 'Office']) {
    const service = serviceFor(role);
    await service.appDataService.loadAll();
    results.requestsPerFullReload[role] = { count: service.calls.length, paths: service.calls.map((call) => call.path) };
    assert(service.calls.every((call) => !call.hasAbortSignal));
  }
  results.ordinaryRequestsHaveAbortSignal = false;

  const overlap = serviceFor('Admin');
  await Promise.all(Array.from({ length: 3 }, () => overlap.appDataService.loadAll()));
  results.threeOverlappingAdminReloads = { httpRequests: overlap.calls.length, expectedWithDeduplication: 11 };
  assert.equal(overlap.calls.length, 33);

  const broken = serviceFor('Admin', 'fail-logs');
  await assert.rejects(() => broken.appDataService.loadAll(), /audit failure/);
  results.oneFailedCollectionRejectsEntireLoad = true;
  const hanging = serviceFor('Admin', 'hang-logs');
  const timeoutResult = await Promise.race([
    hanging.appDataService.loadAll().then(() => 'loaded'),
    new Promise((resolve) => setTimeout(() => resolve('still pending'), 75)),
  ]);
  assert.equal(timeoutResult, 'still pending');
  results.hangingCollection = { afterMs: 75, result: timeoutResult, abortedBySource: false };

  const app = read('dashboard/src/App.jsx');
  const ast = parser.parse(app, { sourceType: 'module', plugins: ['jsx'] });
  let handlerSource;
  walk(ast, (node) => {
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'on' && node.arguments[0]?.value === 'data:invalidate') {
      handlerSource = app.slice(node.arguments[1].start, node.arguments[1].end);
    }
  });
  assert(handlerSource, 'Cannot find source invalidation callback');
  let reloads = 0;
  const invalidationHandler = vm.runInNewContext(`(${handlerSource})`, { loadData: () => { reloads += 1; } });
  for (let browser = 0; browser < 4; browser += 1) invalidationHandler({ collections: ['device-events'] });
  results.oneDeviceEventForFourBrowsers = {
    fullReloads: reloads,
    allAdminHttpRequests: reloads * results.requestsPerFullReload.Admin.count,
    mixedRolesHttpRequests: Object.values(results.requestsPerFullReload).reduce((sum, value) => sum + value.count, 0),
  };
  assert.equal(reloads, 4);

  const modelSandbox = {
    module: { exports: {} },
    require: (name) => name === '../config/db' ? { sequelize: null } : backendRequire(name),
  };
  vm.runInNewContext(read('backend/models/ModelWrapper.js'), modelSandbox);
  const { ModelWrapper } = modelSandbox.module.exports;
  let selectedOptions;
  const projected = new ModelWrapper({ tableName: 'documents', findAll: async (options) => { selectedOptions = options; return [{ id: 'audit-document', scannedText: 'large text', timeline: [{ id: 'event' }] }]; } });
  const selected = await projected.find({}).select('id').lean();
  results.selectIdProjection = { sequelizeAttributes: selectedOptions.attributes ?? null, returnedKeys: Object.keys(selected[0]) };
  assert.equal(selectedOptions.attributes, undefined);

  let rowState = { id: 'audit-document', timeline: [], count: 0 };
  const racing = new ModelWrapper({
    tableName: 'documents',
    findOne: async () => {
      const snapshot = structuredClone(rowState);
      return { toJSON: () => snapshot, update: async (changes) => { await new Promise((resolve) => setImmediate(resolve)); rowState = { ...rowState, ...changes }; } };
    },
  });
  await Promise.all(['first', 'second'].map((id) => racing.findOneAndUpdate({ id: rowState.id }, { $push: { timeline: { id } }, $inc: { count: 1 } })));
  results.concurrentModelUpdates = { intendedEvents: 2, actualEvents: rowState.timeline.length, intendedCounter: 2, actualCounter: rowState.count };
  assert.equal(rowState.timeline.length, 1);
  assert.equal(rowState.count, 1);

  const hubModule = backendRequire('./ws/realtimeHub');
  const realtime = backendRequire('./utils/realtime');
  realtime.setPresenceHandler(async () => ({}));
  const server = require('node:http').createServer();
  const initialized = hubModule.initRealtimeHub(server);
  results.presenceRegistrationBeforeHubInit = { handlerRegistered: Boolean(initialized.presenceHandler) };
  assert.equal(initialized.presenceHandler, null);
  clearInterval(initialized.pingTimer);
  initialized.wss.close();

  const hub = new hubModule.RealtimeHub();
  const frame = Buffer.alloc(100_000);
  let bytes = 0;
  let sends = 0;
  for (let index = 0; index < 4; index += 1) hub.userClients.add({ auth: { userId: `audit-${index}` }, subscriptions: new Set(['scanner:DEV-001:stream']), readyState: 1, OPEN: 1, bufferedAmount: 0, send: (value) => { bytes += value.length; sends += 1; } });
  hub.streamRelayPending.set('DEV-001', { latest: frame, flushScheduled: false });
  hub.flushStreamRelay('DEV-001');
  results.cameraRelay = { jpegBytes: frame.length, subscribers: 4, sendsForOneFrame: sends, outgoingBytesPerFrame: bytes, outgoingMbpsAt15fps: bytes * 15 * 8 / 1_000_000 };
  assert.equal(sends, 4);

  const limiter = backendRequire('./utils/rateLimit').deviceLimiter;
  let allowed = 0;
  let blocked = 0;
  for (let index = 0; index < 301; index += 1) {
    const req = { ip: 'audit-only', body: Buffer.alloc(64), params: {}, query: { deviceId: 'DEV-001' } };
    const res = { setHeader: () => {}, status: () => ({ json: () => { blocked += 1; } }) };
    limiter(req, res, () => { allowed += 1; });
  }
  results.httpPreviewLimiter = { allowed, blocked, configuredRequestsPerMinute: 300, minutesAt15fps: 300 / (15 * 60) };
  assert.equal(blocked, 1);

  const apiSource = read('dashboard/src/api/apiBase.js').replace(/export /g, '').replace(/import\.meta\.env/g, 'auditEnv');
  const discoveryCalls = [];
  const discovery = {
    module: { exports: {} }, auditEnv: { DEV: false, VITE_API_BASE_URL: 'https://down.audit.invalid/api' },
    localStorage: storage(), window: { location: { origin: 'https://frontend.audit.invalid', hostname: 'frontend.audit.invalid' } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url) => {
      discoveryCalls.push(url);
      if (url.startsWith('https://down.audit.invalid')) throw new Error('unavailable');
      return { ok: true, headers: new Map([['content-type', 'text/html']]), json: async () => { throw new Error('HTML is not JSON'); } };
    },
  };
  vm.runInNewContext(`${apiSource}\nmodule.exports={bootstrapApiBase,getApiBase,preloadIceServers};`, discovery);
  const selectedApi = await discovery.module.exports.bootstrapApiBase();
  results.apiDiscovery = { unavailableApiProbes: discoveryCalls.filter((url) => url.startsWith('https://down.audit.invalid')).length, selectedApi, acceptedHtmlAsApiStatus: selectedApi === 'https://frontend.audit.invalid/api' };
  assert.equal(results.apiDiscovery.acceptedHtmlAsApiStatus, true);

  const local = {
    module: { exports: {} }, auditEnv: { DEV: true }, localStorage: storage(),
    window: { location: { origin: 'http://localhost:5173', hostname: 'localhost' } },
    AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ apiUrl: 'https://tunnel.audit.invalid/api', wsUrl: 'wss://tunnel.audit.invalid/ws', iceServers: [{ urls: 'stun:audit.invalid' }] }) }),
  };
  vm.runInNewContext(`${apiSource}\nmodule.exports={bootstrapApiBase,getApiBase,preloadIceServers};`, local);
  await local.module.exports.bootstrapApiBase();
  const beforePreload = local.module.exports.getApiBase();
  await local.module.exports.preloadIceServers();
  results.localProxyAfterConfigPreload = { before: beforePreload, after: local.module.exports.getApiBase() };
  assert.equal(beforePreload, '/api');
  assert.equal(local.module.exports.getApiBase(), 'https://tunnel.audit.invalid/api');

  const authSandbox = { module: { exports: {} }, process: { env: {} }, require: (name) => {
    if (name === 'jsonwebtoken') return { verify: () => ({ id: 'audit-user' }) };
    if (name === '../models') return { User: { findOne: () => ({ lean: async () => { throw new Error('SequelizeConnectionAcquireTimeoutError'); } }) } };
    throw new Error(`Unexpected require: ${name}`);
  } };
  vm.runInNewContext(read('backend/middleware/auth.js'), authSandbox);
  let authResponse;
  await authSandbox.module.exports.protect({ headers: { authorization: 'Bearer audit-token' } }, { status: (status) => ({ json: (body) => { authResponse = { status, body }; } }) }, () => { throw new Error('Unexpected authentication success'); });
  results.databaseFailureInAuthentication = authResponse;
  assert.equal(authResponse.status, 401);

  console.log(JSON.stringify({ sourceCommit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), kind: 'isolated source probes; not live capacity measurements', ...results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
