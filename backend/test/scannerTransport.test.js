const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { streamFrameLimiter, deviceLimiter } = require('../utils/rateLimit');
const { registerPresenceHandler, initRealtimeHub } = require('../ws/realtimeHub');

test('presence registered before initialization survives hub creation', () => {
  const handler = async () => {};
  registerPresenceHandler(handler);
  const server = http.createServer();
  const hub = initRealtimeHub(server);
  assert.equal(hub.presenceHandler, handler);
  clearInterval(hub.pingTimer);
  hub.wss.close();
});

test('25 FPS fallback stays within its own budget without consuming device control limits', () => {
  const original = Date.now;
  let now = original() + 100000;
  Date.now = () => now;
  try {
    let frames = 0; let controls = 0;
    const req = { ip: 'rate-test', streamDeviceId: 'TEST', query: {}, body: { deviceId: 'TEST' }, params: {} };
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json() { assert.fail('Unexpected rate limit'); } };
    for (let second = 0; second < 60; second += 1) {
      for (let frame = 0; frame < 25; frame += 1) {
        now += 40;
        streamFrameLimiter(req, res, () => { frames += 1; });
      }
      deviceLimiter(req, res, () => { controls += 1; });
    }
    assert.equal(frames, 1500);
    assert.equal(controls, 60);
  } finally { Date.now = original; }
});
