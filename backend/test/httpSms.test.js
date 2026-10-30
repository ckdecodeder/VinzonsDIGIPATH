const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createHttpSmsClient, getSmsConfig, SmsProviderError } = require('../services/httpSms');
const { normalizeSmsNumber, validateSmsPreferences, buildSmsContent, wantsSms } = require('../utils/sms');
const cfg = { ready: true, enabled: true, from: '+639170000000', sim: 'SIM2', apiKey: 'synthetic-private-api-key', timeoutMs: 1000 };
const item = () => ({ recipient: '+639180000000', message: 'DigiPath SYNTHETIC: Your document was registered.', requestId: randomUUID() });
const reply = (notification, extra = {}) => ({ id: randomUUID(), owner: cfg.from, contact: notification.recipient,
  request_id: notification.requestId, sim: cfg.sim, status: 'pending', ...extra });
const json = (data, status = 200) => new Response(JSON.stringify({ status: 'success', data }), { status, headers: { 'content-type': 'application/json' } });
const phones = () => json([{ phone_number: cfg.from, sim: 'SIM2', max_send_attempts: 1 }]);

test('SMS pacing defaults to six seconds and validates bounded custom intervals', () => {
  assert.equal(getSmsConfig({}).minIntervalMs, 6000);
  assert.equal(getSmsConfig({ HTTPSMS_MIN_INTERVAL_MS: '20000' }).minIntervalMs, 20000);
  assert.equal(getSmsConfig({ HTTPSMS_MIN_INTERVAL_MS: '-1' }).minIntervalMs, 1000);
  assert.equal(getSmsConfig({ HTTPSMS_MIN_INTERVAL_MS: 'invalid' }).minIntervalMs, 6000);
});

test('a configured dispatch interval faster than the phone policy rejects before any SMS POST', async () => {
  let posts = 0;
  const client = createHttpSmsClient({ fetch: async (url, options) => {
    if (options.method === 'POST') posts++;
    return json([{ phone_number: cfg.from, sim: cfg.sim, max_send_attempts: 1, messages_per_minute: 5 }]);
  } });
  await assert.rejects(client.send(item(), { ...cfg, minIntervalMs: 6000 }), error => error instanceof SmsProviderError && error.retryable);
  assert.equal(posts, 0);
});

test('SMS defaults paused and requires private sender/key and an explicit SIM', () => {
  assert.equal(getSmsConfig({}).ready, false);
  assert.equal(getSmsConfig({ SMS_ENABLED: 'true' }).ready, false);
  assert.equal(getSmsConfig({ SMS_ENABLED: 'true', HTTPSMS_API_KEY: 'synthetic', HTTPSMS_FROM_NUMBER: '09170000000', HTTPSMS_SIM: 'SIM2' }).ready, true);
  assert.equal(getSmsConfig({ SMS_ENABLED: 'true', HTTPSMS_API_KEY: 'synthetic\nheader', HTTPSMS_FROM_NUMBER: '09170000000' }).ready, false);
});
test('SMS preferences are strict, normalize Philippine mobiles, and content excludes private details', () => {
  assert.equal(normalizeSmsNumber('0917 000 0000'), '+639170000000');
  assert.throws(() => normalizeSmsNumber('+12025550100'), /Philippine/);
  assert.throws(() => validateSmsPreferences({ notifySender: 'false' }), /true or false/);
  const doc = { notifySender: true, senderNotificationConsent: true, senderNotificationChannels: ['sms'], senderContact: '09170000000' };
  validateSmsPreferences(doc); assert.equal(doc.senderContact, cfg.from); assert.equal(wantsSms(doc), true);
  assert.equal(wantsSms({ ...doc, senderNotificationConsent: false }), false);
  const content = buildSmsContent({ trackingNumber: 'SYNTHETIC', subject: 'Private medical subject', remarks: 'private', senderName: 'Private person' }, 'document_received');
  assert.ok(content.length <= 160); assert.doesNotMatch(content, /medical|Private|https?:/);
});
test('httpSMS validates the registered SIM and queues one POST without treating acceptance as Sent', async () => {
  const notification = item(), calls = [];
  const client = createHttpSmsClient({ fetch: async (url, options) => {
    calls.push({ url, options }); return options.method === 'GET' ? phones() : json(reply(notification));
  } });
  const result = await client.send(notification, cfg);
  assert.equal(result.status, 'Accepted'); assert.equal(result.sentAt, null);
  assert.equal(calls.length, 2); assert.equal(calls[1].url, 'https://api.httpsms.com/v1/messages/send');
  assert.equal(calls[1].options.redirect, 'error'); assert.equal(calls[1].options.headers['x-api-key'], cfg.apiKey);
  assert.deepEqual(JSON.parse(calls[1].options.body), { from: cfg.from, to: notification.recipient, content: notification.message, request_id: notification.requestId });
});
test('a mismatched SIM or provider automatic retry setting prevents every POST', async () => {
  for (const phone of [{ phone_number: cfg.from, sim: 'SIM1', max_send_attempts: 1 }, { phone_number: cfg.from, sim: 'SIM2', max_send_attempts: 2 }]) {
    let posts = 0;
    const client = createHttpSmsClient({ fetch: async (_url, options) => { if (options.method === 'POST') posts++; return json([phone]); } });
    await assert.rejects(client.send(item(), cfg), failure => failure instanceof SmsProviderError && failure.retryable);
    assert.equal(posts, 0);
  }
});
test('provider rejection bodies and transport exceptions cannot expose credentials or recipients', async () => {
  for (const httpError of [true, false]) {
    const client = createHttpSmsClient({ fetch: async (_url, options) => {
      if (options.method === 'GET') return phones();
      if (!httpError) throw new Error(`${cfg.apiKey} private recipient/message`);
      return new Response(`${cfg.apiKey} private recipient/message`, { status: 422 });
    } });
    await assert.rejects(client.send(item(), cfg), failure => {
      assert.doesNotMatch(failure.message, /synthetic-private|recipient\/message/);
      assert.equal(failure.retryable, httpError); return true;
    });
  }
});
test('deadline covers a stalled provider response body and makes its outcome unconfirmed', async () => {
  const client = createHttpSmsClient({ fetch: async (_url, options) => {
    if (options.method === 'GET') return phones();
    const body = new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new Error('Synthetic abort')), { once: true }); } });
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(client.send(item(), cfg), failure => !failure.retryable && /timed out/.test(failure.message));
});
test('mismatched accepted responses and HTML cannot establish sending success', async () => {
  const notification = item();
  for (const response of [json(reply(notification, { contact: '+639190000000' })), new Response('<html/>', { headers: { 'content-type': 'text/html' } })]) {
    const client = createHttpSmsClient({ fetch: async (_url, options) => options.method === 'GET' ? phones() : response });
    await assert.rejects(client.send(notification, cfg), failure => !failure.retryable);
  }
});
test('unknown outcomes reconcile by exact request ID without submitting another SMS', async () => {
  const notification = item(), message = reply(notification, { status: 'delivered', sent_at: '2026-10-30T00:00:00Z', delivered_at: '2026-10-30T00:00:01Z' });
  const client = createHttpSmsClient({ fetch: async (_url, options) => { assert.equal(options.method, 'GET'); return json([message]); } });
  const result = await client.reconcile(notification, cfg); assert.equal(result.status, 'Delivered');
  const none = createHttpSmsClient({ fetch: async () => json([{ ...message, request_id: randomUUID() }]) });
  assert.equal(await none.reconcile(notification, cfg), null);
});
