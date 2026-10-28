const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTunnelArgs, maybeStartTunnel } = require('./start-all.js');
const { waitForUrl } = require('./start-all.js');
const http = require('node:http');
const { preservePiSetting } = require('./network-settings.cjs');
const { shouldSyncNetworkOnStart } = require('./start-all.js');

test('starting services preserves configuration unless synchronization is explicitly requested', () => {
  assert.equal(shouldSyncNetworkOnStart({}, {}), false);
  assert.equal(shouldSyncNetworkOnStart({}, { DIGIPATH_SYNC_NETWORK_ON_START: '1' }), true);
  assert.equal(shouldSyncNetworkOnStart({ DIGIPATH_SYNC_NETWORK_ON_START: '0' }, { DIGIPATH_SYNC_NETWORK_ON_START: '1' }), false);
});

test('readiness rejects 503, HTML and disconnected DB; accepts verified JSON', async (t) => {
  let mode = '503';
  const server = http.createServer((req, res) => {
    if (mode === '503') { res.writeHead(503); res.end('unavailable'); }
    else if (mode === 'html') { res.setHeader('content-type', 'text/html'); res.end('<html/>'); }
    else if (mode === 'body-stall') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'API is running', database: mode })); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/status`;
  for (mode of ['503', 'html', 'disconnected', 'body-stall']) {
    await assert.rejects(waitForUrl(url, 50, { pollIntervalMs: 5 }), /Timed out/);
  }
  mode = 'connected';
  await waitForUrl(url, 500);
});
test('network synchronization preserves Pi tuning unless explicitly enabled', () => {
  const existing = 'DIGIPATH_STREAM_WIDTH=1280\nDIGIPATH_LIFT_INVERT=1\n';
  const upsert = () => 'changed';
  assert.equal(preservePiSetting(existing, 'DIGIPATH_STREAM_WIDTH', '2560', upsert), existing);
  assert.equal(preservePiSetting(existing, 'DIGIPATH_STREAM_WIDTH', '2560', upsert, true), 'changed');
});

const makeFakeTunnel = () => ({
  stdout: { on: () => {} },
  stderr: { on: () => {} },
  on: () => {},
  kill: () => {},
});

test('buildTunnelArgs starts a fresh host tunnel without a saved tunnel ID', () => {
  assert.deepEqual(buildTunnelArgs(''), ['host', '-p', '5000', '--allow-anonymous']);
  assert.deepEqual(buildTunnelArgs('abc123'), ['host', 'abc123', '-p', '5000', '--allow-anonymous']);
});

test('maybeStartTunnel skips auto-host when an existing tunnel ID is configured', () => {
  const logger = { warn: () => {} };
  const calls = [];
  const tunnel = maybeStartTunnel({
    autoTunnelEnabled: true,
    env: { DIGIPATH_TUNNEL_ID: 'sneaky-field-krnwbhm' },
    spawnFn: (...args) => {
      calls.push(args);
      return makeFakeTunnel();
    },
    logger,
    childList: [],
  });

  assert.equal(tunnel, null);
  assert.deepEqual(calls, []);
});

test('maybeStartTunnel starts a fresh tunnel when no ID is configured', () => {
  const calls = [];
  const childList = [];
  const tunnel = maybeStartTunnel({
    autoTunnelEnabled: true,
    env: {},
    spawnFn: (...args) => {
      calls.push(args);
      return makeFakeTunnel();
    },
    logger: { warn: () => {} },
    childList,
  });

  assert.ok(tunnel);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], 'devtunnel');
  assert.deepEqual(calls[0][1], ['host', '-p', '5000', '--allow-anonymous']);
  assert.equal(childList.length, 1);
});
