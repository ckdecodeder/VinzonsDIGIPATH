// HISTORICAL: the audited SMS backend was subsequently removed at user request.
// Requires the pre-removal source snapshot; not runnable against the reset checkout.
// Audit reproductions of pre-removal defects, not acceptance tests for repaired code.
// No dotenv, database, network, phone, credentials, or business records are used.
// Run from repository root: node --test docs/sms-audit-evidence-2026-10-30/probes.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const fixture = (extra = {}) => ({
  id: 'SYNTHETIC-NOTIFICATION', documentId: 'SYNTHETIC-DOCUMENT',
  trackingNumber: 'SYNTHETIC-TRACKING', channel: 'sms',
  recipient: '09170000000', message: 'Synthetic status update',
  status: 'Queued', metadata: {}, ...extra,
});
const makeModel = (initial = [], options = {}) => {
  const rows = initial.map(row => structuredClone(row));
  class Model {
    constructor(data) { Object.assign(this, structuredClone(data)); }
    async save() {
      if (options.failSave) throw new Error('Synthetic outbox storage failure');
      rows.push(structuredClone({ ...this }));
      return this;
    }
    static findOne(filter) {
      return { lean: async () => structuredClone(rows.find(row => row.id === filter.id) || null) };
    }
    static async findOneAndUpdate(filter, update) {
      const row = rows.find(item => item.id === filter.id
        && (!filter.status || filter.status.$in.includes(item.status)));
      if (!row) return null;
      if (options.failSentSave && update.$set.status === 'Sent') {
        throw new Error('Synthetic final status persistence failure');
      }
      Object.assign(row, structuredClone(update.$set));
      return structuredClone(row);
    }
  }
  return { Model, rows };
};
const loadModule = (relative, overrides, globals = {}) => {
  const filename = path.join(root, relative);
  const nativeRequire = createRequire(filename);
  const context = {
    module: { exports: {} },
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id),
    structuredClone, Buffer, URL, AbortSignal,
    console: { error() {} }, ...globals,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
};
const loadSender = (store, fetchMock, provider = 'android_sms_gateway') => {
  let nextId = 0;
  return loadModule('backend/utils/senderNotifications.js', {
    './helpers': {
      normalizeText: value => typeof value === 'string' ? value.trim() : value,
      generateId: () => `SYNTHETIC-${++nextId}`,
    },
    '../models': { SenderNotification: store.Model },
  }, {
    process: { env: {
      SENDER_NOTIFICATION_PROVIDER: provider,
      ANDROID_SMS_GATEWAY_URL: 'http://192.168.1.55:8080',
      ANDROID_SMS_GATEWAY_USERNAME: 'synthetic-user',
      ANDROID_SMS_GATEWAY_PASSWORD: 'synthetic-test-only-password',
    } },
    fetch: fetchMock || (async () => { throw new Error('Unexpected mocked network call'); }),
  });
};
const loadResendHandler = (store, sender, currentDocument) => {
  const handlers = [];
  const router = Object.fromEntries(['get', 'post', 'put', 'delete', 'use'].map(method => [method,
    (...args) => { handlers.push({ method, args }); },
  ]));
  loadModule('backend/routes/notifications.js', {
    express: { Router: () => router },
    '../models': { SenderNotification: store.Model, Document: { findOne: async () => currentDocument } },
    '../middleware/auth': { protect() {}, allowRoles: () => () => {} },
    '../utils/helpers': { asyncHandler: fn => fn, createLogEntry: async () => {} },
    '../utils/senderNotifications': sender,
    '../utils/realtime': { broadcastDataInvalidate() {} },
    '../utils/documentScope': {
      isGlobalDocumentViewer: () => true,
      getScopedDocumentQueryWithTransmissions: async () => ({}),
    },
  }, { process: { env: { SENDER_NOTIFICATION_PROVIDER: 'android_sms_gateway' } } });
  return handlers.find(item => item.method === 'post'
    && item.args[0] === '/sender-notifications/:id/resend').args.at(-1);
};

test('SMS-01: accepted Pending response is stored as Sent without reading its ID/state', async () => {
  const store = makeModel([fixture()]);
  let bodyReads = 0;
  const sender = loadSender(store, async () => ({
    ok: true, status: 202,
    json: async () => { bodyReads++; return { id: 'SYNTHETIC-GATEWAY-ID', state: 'Pending' }; },
  }));
  const result = await sender.deliverSenderNotification(fixture());
  assert.equal(result.status, 'Sent');
  assert.ok(result.sentAt);
  assert.equal(bodyReads, 0);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC-GATEWAY-ID'), false);
});

test('SMS-02: ambiguous accepted-then-timeout request becomes retryable and is submitted twice', async () => {
  const store = makeModel([fixture()]);
  const submissions = [];
  const sender = loadSender(store, async (_url, request) => {
    submissions.push(JSON.parse(request.body));
    const error = new Error('Synthetic timeout after assumed gateway acceptance');
    error.name = 'TimeoutError';
    throw error;
  });
  await sender.deliverSenderNotification(fixture());
  assert.equal(store.rows[0].status, 'Failed');
  await sender.deliverSenderNotification(structuredClone(store.rows[0]));
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].id, undefined);
  assert.equal(submissions[1].id, undefined);
});

test('SMS-02: provider acceptance followed by status-save failure strands Sending', async () => {
  const store = makeModel([fixture()], { failSentSave: true });
  let submissions = 0;
  const sender = loadSender(store, async () => { submissions++; return { ok: true, status: 202 }; });
  await assert.rejects(sender.deliverSenderNotification(fixture()), /persistence failure/);
  assert.equal(store.rows[0].status, 'Sending');
  assert.equal(await sender.deliverSenderNotification(structuredClone(store.rows[0])), null);
  assert.equal(submissions, 1);
});

test('SMS-03: resend handler sends saved recipient despite current opt-out and changed contact', async () => {
  const store = makeModel([fixture({ status: 'Failed' })]);
  const recipients = [];
  const sender = loadSender(store, async (_url, request) => {
    recipients.push(JSON.parse(request.body).phoneNumbers[0]);
    return { ok: true, status: 202 };
  });
  const handler = loadResendHandler(store, sender, {
    id: 'SYNTHETIC-DOCUMENT', notifySender: false,
    senderNotificationConsent: false, senderContact: '09180000000',
  });
  let status = 200, body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  await handler({ params: { id: 'SYNTHETIC-NOTIFICATION' }, user: { id: 'TEST', role: 'Admin' } }, res);
  assert.equal(status, 200);
  assert.equal(body.status, 'Sent');
  assert.deepEqual(recipients, ['+639170000000']);
});

test('SMS-04: outbox storage failure is swallowed and leaves no notification row', async () => {
  const store = makeModel([], { failSave: true });
  const sender = loadSender(store, undefined, 'outbox');
  const result = await sender.queueSenderNotifications({ user: { id: 'TEST' } }, {
    id: 'SYNTHETIC-DOCUMENT', trackingNumber: 'SYNTHETIC-TRACKING',
    subject: 'Synthetic', senderContact: '09170000000', senderNotificationChannels: ['sms'],
    notifySender: true, senderNotificationConsent: true,
  }, 'document_received');
  assert.equal(result.length, 0);
  assert.equal(store.rows.length, 0);
});

test('SMS-06: two stale fourth-attempt snapshots both send and both persist attempt five', async () => {
  const original = fixture({ status: 'Failed', metadata: { deliveryAttempts: 4 } });
  const store = makeModel([original]);
  let submissions = 0;
  const sender = loadSender(store, async () => { submissions++; throw new Error('Synthetic connection failure'); });
  // Both requests read and pass the route's <5 check before either delivery.
  const firstSnapshot = structuredClone(original), secondSnapshot = structuredClone(original);
  await sender.deliverSenderNotification(firstSnapshot);
  await sender.deliverSenderNotification(secondSnapshot);
  assert.equal(submissions, 2);
  assert.equal(store.rows[0].metadata.deliveryAttempts, 5);
});

test('SMS-08: outbox accepts unsupported international recipient before provider validation', async () => {
  const store = makeModel();
  const sender = loadSender(store, undefined, 'outbox');
  await sender.queueSenderNotifications({ user: { id: 'TEST' } }, {
    id: 'SYNTHETIC-DOCUMENT', trackingNumber: 'SYNTHETIC-TRACKING',
    subject: 'Synthetic', senderContact: '+12025550100', senderNotificationChannels: ['sms'],
    notifySender: true, senderNotificationConsent: true,
  }, 'document_received');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].status, 'Queued');
  assert.equal(store.rows[0].recipient, '+12025550100');
  assert.throws(() => sender.normalizeSmsPhoneNumber(store.rows[0].recipient), /Philippine mobile/);
});

test('Additional observation: SMS message length is unbounded by the content builder', () => {
  const sender = loadSender(makeModel());
  const message = sender.buildSenderNotificationContent({}, {
    trackingNumber: 'SYNTHETIC-TRACKING', subject: 'Synthetic',
  }, 'document_received', { message: 'A'.repeat(2000) }).message;
  assert.ok(message.length > 2000);
});
