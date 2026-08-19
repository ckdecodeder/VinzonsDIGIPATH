const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTunnelArgs, maybeStartTunnel } = require('./start-all.js');

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
