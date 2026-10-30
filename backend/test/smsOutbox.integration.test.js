const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Sequelize } = require('sequelize');
const { createSmsOutboxService } = require('../services/smsOutbox');
const { SmsProviderError } = require('../services/httpSms');
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
const integration = (name, fn) => test(name, { skip: !databaseUrl }, fn);
const schema = `sms_test_${randomUUID().replaceAll('-', '')}`;
let db, models, raw, service, clock, calls, sendMode, releaseSend, server, base;
const cfg = { ready: true, enabled: true, from: '+639170000000', sim: 'SIM2', apiKey: 'synthetic-api-key', timeoutMs: 1000 };
const envNames = ['SMS_ENABLED', 'HTTPSMS_API_KEY', 'HTTPSMS_FROM_NUMBER', 'HTTPSMS_SIM'];
const savedEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));

before(async () => {
  if (!databaseUrl) return;
  require('../utils/maintenanceGuard').requireTestWrite(databaseUrl, ['--apply']);
  db = new Sequelize(databaseUrl, { logging: false, define: { schema } });
  await db.createSchema(schema);
  const filename = path.resolve(__dirname, '../models/index.js'), nativeRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, process,
    require: id => id === '../config/db' ? { sequelize: db } : nativeRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  models = context.module.exports; raw = models._sequelizeModels;
  await db.sync();
  service = createSmsOutboxService({ ...raw, config: () => cfg, now: () => clock, spacingMs: 0,
    provider: {
      async send() {
        calls++;
        if (sendMode === 'wait') await new Promise(resolve => { releaseSend = resolve; });
        if (sendMode === 'reject') throw new SmsProviderError('Synthetic definite rejection.', true);
        if (sendMode === 'timeout') throw new SmsProviderError('Synthetic unconfirmed timeout.');
        return { status: 'Accepted', providerMessageId: randomUUID(), sentAt: null, deliveredAt: null, errorMessage: '' };
      },
      async reconcile(notification) { return { status: 'Delivered', providerMessageId: notification.providerMessageId || randomUUID(), sentAt: clock, deliveredAt: clock, errorMessage: '' }; },
    },
  });
  models.smsService = service;
  const app = require('express')(); app.use(require('express').json());
  app.use((req, res, next) => { if (req.headers['x-test-role']) req.user = { id: 'SYNTHETIC-USER', role: req.headers['x-test-role'], officeId: req.headers['x-test-office'] || 'SOURCE' }; next(); });
  app.use(require('../routes/sms').createSmsRouter({ models, config: () => cfg, logEntry: async () => {},
    authenticate: (req, res, next) => req.user ? next() : res.sendStatus(401) }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  if (!db) return;
  Object.assign(process.env, { SMS_ENABLED: 'true', HTTPSMS_API_KEY: 'synthetic-api-key', HTTPSMS_FROM_NUMBER: cfg.from, HTTPSMS_SIM: 'SIM2' });
  cfg.ready = true; cfg.enabled = true; clock = new Date(); calls = 0; sendMode = 'accept'; releaseSend = null;
  await raw.SmsNotificationModel.destroy({ where: {} }); await raw.DocumentModel.destroy({ where: {} });
});
after(async () => {
  service?.stop();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) { try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); } }
  for (const key of envNames) savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key];
});
const fixture = async (extra = {}) => {
  const id = `SYNTHETIC-${randomUUID()}`;
  await db.transaction(transaction => raw.DocumentModel.create({ id, trackingNumber: id,
    subject: 'PRIVATE SUBJECT MUST NOT BE TEXTED', status: 'Received', intakeStatus: 'Approved',
    documentDirection: 'Incoming', currentOfficeId: 'SOURCE', originOfficeId: 'SOURCE',
    notifySender: true, senderNotificationConsent: true, senderNotificationChannels: ['sms'],
    senderContact: '+639180000000', timeline: [], updatedAt: clock.toISOString(), ...extra,
  }, { transaction }));
  return raw.DocumentModel.findByPk(id);
};
const smsFor = doc => raw.SmsNotificationModel.findOne({ where: { documentId: doc.id } });
const request = async (url, method = 'GET', role = 'Admin', office = 'SOURCE') => {
  const res = await fetch(base + url, { method, headers: role ? { 'x-test-role': role, 'x-test-office': office } : {} });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, text };
};

integration('SMS: document and initial outbox insert commit or roll back together', async () => {
  const id = `ROLLBACK-${randomUUID()}`;
  await assert.rejects(db.transaction(async transaction => {
    await raw.DocumentModel.create({ id, trackingNumber: id, subject: 'Synthetic rollback', notifySender: true, senderNotificationConsent: true, senderNotificationChannels: ['sms'], senderContact: '+639180000000' }, { transaction });
    throw new Error('Synthetic workflow failure');
  }), /workflow failure/);
  assert.equal(await raw.DocumentModel.count({ where: { id } }), 0);
  assert.equal(await raw.SmsNotificationModel.count({ where: { documentId: id } }), 0);
  const doc = await fixture(); const sms = await smsFor(doc);
  assert.equal(sms.status, 'Queued'); assert.equal(calls, 0);
  assert.doesNotMatch(sms.message, /PRIVATE/);
});
integration('SMS: outbox insertion failure rolls back the document instead of losing its event', async () => {
  raw.SmsNotificationModel.addHook('beforeBulkCreate', 'syntheticFailure', () => { throw new Error('Synthetic outbox failure'); });
  try { await assert.rejects(fixture(), /outbox failure/); }
  finally { raw.SmsNotificationModel.removeHook('beforeBulkCreate', 'syntheticFailure'); }
  assert.equal(await raw.DocumentModel.count(), 0);
});
integration('SMS: wrapped physical-style creation also shares its outbox transaction', async () => {
  const doc = new models.Document({ id: randomUUID(), trackingNumber: 'SYNTHETIC', subject: 'Synthetic physical-style capture', notifySender: true, senderNotificationConsent: true, senderNotificationChannels: ['sms'], senderContact: '09180000000' });
  await doc.save();
  assert.equal(await raw.SmsNotificationModel.count({ where: { documentId: doc.id } }), 1);
});
integration('SMS: one multi-office batch creates one SMS and action notes never leak', async () => {
  const doc = await fixture(); await raw.SmsNotificationModel.destroy({ where: {} });
  const events = [1, 2, 3].map(n => ({ id: `SYNTHETIC-ROUTE-${n}`, action: 'document_routed', userId: 'TEST', details: 'PRIVATE ROUTING DETAILS' }));
  await db.transaction(transaction => doc.update({ status: 'In Transit', timeline: events }, { transaction }));
  assert.equal(await raw.SmsNotificationModel.count(), 1);
  await db.transaction(transaction => doc.update({ timeline: [...events, { id: 'PRIVATE-NOTE', action: 'action_note', details: 'PRIVATE NOTE' }] }, { transaction }));
  assert.equal(await raw.SmsNotificationModel.count(), 1);
  assert.doesNotMatch((await smsFor(doc)).message, /PRIVATE/);
  await db.transaction(transaction => doc.update({ status: 'Signed', timeline: [...events, { id: 'RESTORE', action: 'archive_restored' }] }, { transaction }));
  assert.equal(await raw.SmsNotificationModel.count(), 1);
});
integration('SMS: disabled mode remains Paused after activation until intentionally queued', async () => {
  process.env.SMS_ENABLED = 'false'; const doc = await fixture();
  const sms = await smsFor(doc); assert.equal(sms.status, 'Paused');
  process.env.SMS_ENABLED = 'true';
  assert.equal(await service.dispatch(sms.id), false); assert.equal(calls, 0);
  await service.requeue(sms.id, async () => true); await service.dispatch(sms.id);
  assert.equal(calls, 1); assert.equal((await sms.reload()).status, 'Accepted');
});
integration('SMS: concurrent claims submit once and acceptance never means Sent', async () => {
  const doc = await fixture(), sms = await smsFor(doc);
  await Promise.all([service.dispatch(sms.id), service.dispatch(sms.id)]);
  await sms.reload(); assert.equal(calls, 1); assert.equal(sms.attempts, 1); assert.equal(sms.status, 'Accepted'); assert.equal(sms.sentAt, null);
});
integration('SMS: consent withdrawal and contact changes cancel queued recipients', async () => {
  const doc = await fixture(), sms = await smsFor(doc);
  await db.transaction(transaction => doc.update({ senderNotificationConsent: false }, { transaction }));
  await assert.rejects(service.requeue(sms.id, async () => true), /consent/);
  assert.equal(await service.dispatch(sms.id), false); assert.equal(calls, 0); assert.equal((await sms.reload()).status, 'Cancelled');
  const next = await fixture(), old = await smsFor(next);
  await db.transaction(transaction => next.update({ senderContact: '+639190000000' }, { transaction }));
  assert.equal((await old.reload()).status, 'Cancelled'); assert.equal(await service.dispatch(old.id), false);
});
integration('SMS: timeout and lost status persistence never make a possibly accepted message retryable', async () => {
  const doc = await fixture(), sms = await smsFor(doc); sendMode = 'timeout';
  await service.dispatch(sms.id); await sms.reload(); assert.equal(sms.status, 'Unknown');
  await assert.rejects(service.requeue(sms.id, async () => true), /cannot be resent/);
  assert.equal(await service.dispatch(sms.id), false); assert.equal(calls, 1);
  sendMode = 'accept';
  const next = await fixture(), pending = await smsFor(next);
  raw.SmsNotificationModel.addHook('beforeBulkUpdate', 'lostStatus', options => { if (options.attributes.status === 'Accepted') throw new Error('Synthetic persistence failure'); });
  try { await assert.rejects(service.dispatch(pending.id), /persistence failure/); }
  finally { raw.SmsNotificationModel.removeHook('beforeBulkUpdate', 'lostStatus'); }
  assert.equal((await pending.reload()).status, 'Sending');
  clock = new Date(clock.getTime() + 61000); await service.tick();
  assert.equal((await pending.reload()).status, 'Delivered'); assert.equal(calls, 2);
});
integration('SMS: provider confirmation advances to Delivered without another POST', async () => {
  const doc = await fixture(), sms = await smsFor(doc); await service.dispatch(sms.id);
  await service.reconcile((await sms.reload()).get({ plain: true }));
  await sms.reload(); assert.equal(sms.status, 'Delivered'); assert.ok(sms.deliveredAt); assert.equal(calls, 1);
});
integration('SMS: attempt cap is checked on the locked current row despite stale retry requests', async () => {
  const doc = await fixture(), sms = await smsFor(doc); sendMode = 'reject';
  await sms.update({ attempts: 4 });
  await service.dispatch(sms.id); assert.equal((await sms.reload()).attempts, 5);
  const results = await Promise.allSettled([service.requeue(sms.id, async () => true), service.requeue(sms.id, async () => true)]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.status === 429));
  assert.equal(calls, 1);
});
integration('SMS: the shared dispatch gate enforces pacing across worker instances', async () => {
  const paced = createSmsOutboxService({ ...raw, config: () => cfg, now: () => clock, spacingMs: 20000,
    provider: { send: async () => { calls++; return { status: 'Accepted', providerMessageId: randomUUID() }; } } });
  const a = await smsFor(await fixture()), b = await smsFor(await fixture());
  await Promise.all([paced.dispatch(a.id), paced.dispatch(b.id)]);
  assert.equal(calls, 1); clock = new Date(clock.getTime() + 20001);
  await paced.dispatch((await a.reload()).status === 'Queued' ? a.id : b.id); assert.equal(calls, 2);
});
integration('SMS: API requires authentication and retry roles, and scopes Office history', async () => {
  const doc = await fixture(), sms = await smsFor(doc);
  assert.equal((await request('/sender-notifications', 'GET', null)).status, 401);
  assert.equal((await request(`/sender-notifications/${sms.id}/resend`, 'POST', 'Office')).status, 403);
  assert.equal((await request('/sender-notifications', 'GET', 'Office', 'OTHER')).body.total, 0);
  assert.equal((await request(`/documents/${doc.id}/sender-notifications`, 'GET', 'Office', 'OTHER')).status, 404);
  const visible = await request(`/documents/${doc.id}/sender-notifications`, 'GET', 'Receptionist');
  assert.equal(visible.status, 200); assert.equal(visible.body.total, 1);
  assert.equal(visible.body.items[0].provider, 'httpsms');
  assert.equal(visible.text.includes(cfg.apiKey), false); assert.equal(visible.text.includes('requestId'), false);
});

integration('SMS: a stalled old status lookup cannot delay dispatch of a new registration', async () => {
  const old = await smsFor(await fixture());
  await old.update({ status: 'Accepted', attempts: 1, requestId: randomUUID(), providerMessageId: randomUUID(),
    senderNumber: cfg.from, sim: cfg.sim, nextPollAt: new Date(clock.getTime() - 1) });
  const fresh = await smsFor(await fixture());
  let release, entered;
  const pollEntered = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const isolated = createSmsOutboxService({ ...raw, config: () => cfg, now: () => clock, spacingMs: 0,
    provider: {
      send: async () => { calls++; return { status: 'Accepted', providerMessageId: randomUUID() }; },
      reconcile: async notification => { entered(); await blocked; return { status: 'Delivered', providerMessageId: notification.providerMessageId }; },
    },
  });
  const polling = isolated.pollTick();
  try {
    await pollEntered;
    await Promise.all([isolated.dispatchTick(), isolated.dispatchTick()]);
    assert.equal(calls, 1);
    assert.equal((await fresh.reload()).status, 'Accepted');
    assert.equal((await old.reload()).status, 'Accepted');
    assert.equal(new Date(fresh.nextPollAt) - clock, 15000);
  } finally { release(); await polling; }
  assert.equal((await old.reload()).status, 'Delivered');
});

integration('SMS: configured six-second spacing permits the next message without a twenty-second hold', async () => {
  const paced = createSmsOutboxService({ ...raw, config: () => ({ ...cfg, minIntervalMs: 6000 }), now: () => clock,
    provider: { send: async () => { calls++; return { status: 'Accepted', providerMessageId: randomUUID() }; } } });
  const first = await smsFor(await fixture()), next = await smsFor(await fixture());
  await paced.dispatch(first.id);
  clock = new Date(clock.getTime() + 5999);
  assert.equal(await paced.dispatch(next.id), false); assert.equal(calls, 1);
  clock = new Date(clock.getTime() + 1);
  assert.equal(await paced.dispatch(next.id), true); assert.equal(calls, 2);
});
integration('SMS: HTTP requeue returns Queued with no provider call and rejects a duplicate request', async () => {
  process.env.SMS_ENABLED = 'false'; const doc = await fixture(), sms = await smsFor(doc);
  process.env.SMS_ENABLED = 'true';
  assert.equal((await request(`/sender-notifications/${sms.id}/resend`, 'POST', 'Receptionist', 'OTHER')).status, 404);
  const result = await request(`/sender-notifications/${sms.id}/resend`, 'POST', 'Receptionist');
  assert.equal(result.status, 202); assert.equal(result.body.status, 'Queued'); assert.equal(calls, 0);
  assert.equal((await request(`/sender-notifications/${sms.id}/resend`, 'POST', 'Receptionist')).status, 409);
  assert.equal((await sms.reload()).attempts, 0);
});
integration('SMS: a consent change holding the document lock wins over a waiting dispatch claim', async () => {
  const doc = await fixture(), sms = await smsFor(doc);
  let unlock, acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  const withdrawn = db.transaction(async transaction => {
    const locked = await raw.DocumentModel.findByPk(doc.id, { transaction, lock: transaction.LOCK.UPDATE });
    await locked.update({ senderNotificationConsent: false }, { transaction });
    acquired(); await new Promise(resolve => { unlock = resolve; });
  });
  await ready;
  const waitingSend = service.dispatch(sms.id);
  unlock(); await withdrawn; await waitingSend;
  assert.equal(calls, 0); assert.equal((await sms.reload()).status, 'Cancelled');
});
integration('SMS: history beyond 250 rows is paginated without hiding older document messages', async () => {
  const doc = await fixture(), sms = (await smsFor(doc)).get({ plain: true });
  await raw.SmsNotificationModel.bulkCreate(Array.from({ length: 260 }, (_, n) => ({ ...sms, sequence: undefined, id: `SMS-HISTORY-${n}`, eventKey: randomUUID() })));
  const page = await request(`/documents/${doc.id}/sender-notifications?page=3&limit=100`);
  assert.equal(page.body.total, 261); assert.equal(page.body.items.length, 61);
  assert.equal((await request('/sender-notifications?limit=100000')).status, 400);
});
integration('SMS: expired rows cannot send, and document deletion removes only its new outbox', async () => {
  const doc = await fixture(), sms = await smsFor(doc); await sms.update({ expiresAt: new Date(clock.getTime() - 1) });
  assert.equal(await service.dispatch(sms.id), false); assert.equal(calls, 0);
  await doc.destroy(); assert.equal(await raw.SmsNotificationModel.count(), 0);
});
