const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTwilioPhoneNumber,
  sendTwilioSms,
  deliverSenderNotification,
} = require('../utils/senderNotifications');

test('Twilio phone numbers normalize Philippine mobile input and require international format otherwise', () => {
  assert.equal(normalizeTwilioPhoneNumber('0917 123 4567'), '+639171234567');
  assert.equal(normalizeTwilioPhoneNumber('639171234567'), '+639171234567');
  assert.equal(normalizeTwilioPhoneNumber('+1 (415) 555-0123'), '+14155550123');
  assert.throws(() => normalizeTwilioPhoneNumber('12345'), /E\.164/);
  assert.throws(() => normalizeTwilioPhoneNumber('+0123456789'), /E\.164/);
});

test('Twilio request is encoded, bounded, and does not read provider bodies', async (t) => {
  const names = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SENDER_NOTIFICATION_TIMEOUT_MS'];
  const savedEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  t.after(() => { for (const name of names) savedEnv[name] === undefined ? delete process.env[name] : process.env[name] = savedEnv[name]; global.fetch = originalFetch; });
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
    TWILIO_AUTH_TOKEN: 'test-only-auth-token',
    TWILIO_FROM_NUMBER: '+15555550123',
    SENDER_NOTIFICATION_TIMEOUT_MS: '1000',
  });
  let request;
  global.fetch = async (url, options) => {
    request = { url, ...options };
    return { ok: true, status: 201, text: async () => { throw new Error('response body must not be read'); } };
  };
  await sendTwilioSms({ recipient: '09171234567', message: 'Document status update' });
  assert.match(request.url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC/);
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(request.signal.aborted, false);
  assert.equal(new URLSearchParams(request.body).get('To'), '+639171234567');
  assert.equal(new URLSearchParams(request.body).get('Body'), 'Document status update');
});

test('provider error bodies cannot leak recipient or SMS data into the outbox error', async (t) => {
  const names = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
  const savedEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  t.after(() => { for (const name of names) savedEnv[name] === undefined ? delete process.env[name] : process.env[name] = savedEnv[name]; global.fetch = originalFetch; });
  process.env.TWILIO_ACCOUNT_SID = 'AC' + 'b'.repeat(32);
  process.env.TWILIO_AUTH_TOKEN = 'test-only-auth-token';
  process.env.TWILIO_FROM_NUMBER = '+15555550123';
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'phone +639171234567 private SMS body' });
  await assert.rejects(sendTwilioSms({ recipient: '+639171234567', message: 'private SMS body' }), error => (
    error.message.includes('HTTP 429') && !error.message.includes('639171234567') && !error.message.includes('private SMS body')
  ));
});

test('concurrent retry claims send only once, records attempts, and keeps provider errors private', async () => {
  const savedProvider = process.env.SENDER_NOTIFICATION_PROVIDER;
  process.env.SENDER_NOTIFICATION_PROVIDER = 'twilio_sendgrid';
  const record = { id: 'SYNTHETIC-SMS', status: 'Failed', metadata: { existing: true }, errorMessage: 'old failure' };
  let sendCount = 0;
  const SenderNotification = {
    async findOneAndUpdate(filter, update) {
      if (filter.status && !filter.status.$in.includes(record.status)) return null;
      Object.assign(record, update.$set);
      return structuredClone(record);
    },
  };
  const dependencies = { SenderNotification, sendTwilioSms: async () => {
    sendCount += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    throw new Error('provider response includes +639171234567 and message contents');
  } };
  try {
    const notification = { id: record.id, channel: 'sms', status: 'Failed', metadata: record.metadata };
    const [first, second] = await Promise.all([
      deliverSenderNotification(notification, dependencies),
      deliverSenderNotification(notification, dependencies),
    ]);
    assert.equal(sendCount, 1);
    assert.equal([first, second].filter(Boolean).length, 1);
    assert.equal(record.status, 'Failed');
    assert.equal(record.metadata.deliveryAttempts, 1);
    assert.equal(record.metadata.existing, true);
    assert.doesNotMatch(record.errorMessage, /639171234567|message contents|provider response/);
  } finally {
    if (savedProvider === undefined) delete process.env.SENDER_NOTIFICATION_PROVIDER;
    else process.env.SENDER_NOTIFICATION_PROVIDER = savedProvider;
  }
});

test('outbox mode leaves SMS queued without invoking a provider', async (t) => {
  const savedProvider = process.env.SENDER_NOTIFICATION_PROVIDER;
  process.env.SENDER_NOTIFICATION_PROVIDER = 'outbox';
  let called = false;
  t.after(() => {
    if (savedProvider === undefined) delete process.env.SENDER_NOTIFICATION_PROVIDER;
    else process.env.SENDER_NOTIFICATION_PROVIDER = savedProvider;
  });
  const notification = { id: 'SYNTHETIC-OUTBOX', status: 'Queued' };
  const result = await deliverSenderNotification(notification, {
    sendTwilioSms: async () => { called = true; },
    SenderNotification: { findOneAndUpdate: async () => { called = true; } },
  });
  assert.equal(result, notification);
  assert.equal(called, false);
});
