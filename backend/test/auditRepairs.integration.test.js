const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
const integration = (name, fn) => test(name, { skip: !databaseUrl }, fn);
let db, models, raw, base, server, tempRoot, failSave = false, failSend = false, failSaveTarget = 'FILES';
const schema = 'audit_repair_test_' + randomUUID().replaceAll('-', '');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const loadModule = async (filename, overrides) => {
  const realRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: id => overrides[id] || realRequire(id), process, console, Buffer, structuredClone };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), context, { filename });
  return context.module.exports;
};
before(async () => {
  if (!databaseUrl) return;
  assert.match(new URL(databaseUrl).pathname, /_test(?:_|$)/);
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'digipath-audit-test-'));
  process.env.UPLOADS_ROOT = tempRoot;
  await fs.mkdir(path.join(tempRoot, 'scans'));
  const { Sequelize } = require('sequelize');
  db = new Sequelize(databaseUrl, { logging: false, define: { schema } });
  await db.createSchema(schema);
  models = await loadModule(path.resolve(__dirname, '../models/index.js'), { '../config/db': { sequelize: db } });
  raw = models._sequelizeModels;
  await db.sync();
  for (const id of ['SOURCE', 'OTHER', 'MAYOR']) await raw.OfficeModel.create({ id, name: id === 'MAYOR' ? 'Mayor Office' : id });
  await raw.DocumentTypeModel.create({ id: 'TYPE', category: 'Synthetic', requiresMayorApproval: false });
  raw.DocumentModel.addHook('beforeUpdate', row => { if (failSave && row.id === failSaveTarget) throw new Error('Synthetic database failure'); });
  const { createHandoffService } = require('../utils/documentHandoffs');
  const handoffs = createHandoffService({ ...raw, TransmissionModel: new Proxy(raw.TransmissionModel, { get(target, key) { if (key === 'bulkCreate') return (...args) => { if (failSend) throw new Error('Synthetic handoff failure'); return target.bulkCreate(...args); }; return Reflect.get(target, key); } }) });
  const archive = require('../utils/archiveWorkflow').createArchiveService(raw);
  const context = require('../utils/transactionContext');
  const helpers = require('../utils/helpers');
  const overrides = {
    '../models': models,
    '../middleware/auth': { ...require('../middleware/auth'), protect: (req, res, next) => req.user ? next() : res.sendStatus(401) },
    '../utils/helpers': { ...helpers, createLogEntry: async () => {}, createNotification: async () => {}, notifyApprovalUsers: async () => {},
      appendDocumentTimeline: (id, event, updates, opts = {}) => models.Document.findOneAndUpdate({ id }, { $set: updates, $push: { timeline: event } }, { new: true, ...opts }) },
    '../utils/documentHandoffs': { sendHandoffs: handoffs.send, receiveHandoff: handoffs.receive, cancelHandoff: handoffs.cancel },
    '../utils/archiveWorkflow': { archiveDocument: archive.create, restoreArchive: archive.remove },
    '../utils/realtime': { broadcastDataInvalidate: () => {}, broadcastCommandUpdated: () => {}, pushCommandToDevice: () => false },
    '../services/devicePresence': { getDeviceSnapshot: async () => ({ connected: true }), hardwarePresenceEvents: [] },
    '../utils/bridge': { ...require('../utils/bridge'), requireDeviceApiKey: (req, res, next) => next() },
    '../utils/transactionContext': { ...context, withDeviceCommandLock: (id, fn) => context.withDeviceCommandLock(id, fn, raw.CommandModel) },
  };
  overrides['../utils/logScope'] = await loadModule(path.resolve(__dirname, '../utils/logScope.js'), { '../models': models });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-role']) req.user = { id: req.headers['x-test-user'] || 'TEST-USER', role: req.headers['x-test-role'], officeId: req.headers['x-test-office'] || 'SOURCE' }; next(); });
  for (const name of ['documents', 'archives', 'logs', 'users']) app.use('/' + name, await loadModule(path.resolve(__dirname, '../routes', name + '.js'), overrides));
  app.use('/', await loadModule(path.resolve(__dirname, '../routes/devices.js'), overrides));
  app.use('/uploads', require('../routes/files').createFileRouter({ Document: models.Document, DocumentModel: raw.DocumentModel, root: path.join(tempRoot, 'scans'), authenticate: overrides['../middleware/auth'].protect }));
  app.use((error, req, res, next) => { if (!res.headersSent) res.status(error.status || (error.name === 'SequelizeUniqueConstraintError' ? 409 : 500)).json({ message: error.message }); });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) { try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); } }
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
});
const request = async (url, method = 'GET', body, role = 'Admin', office = 'SOURCE', user = 'TEST-USER', extraHeaders = {}) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role, 'x-test-office': office, 'x-test-user': user } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text, headers: res.headers };
};
const fixture = (id, extra = {}) => raw.DocumentModel.create({ id, subject: 'Synthetic ' + id, trackingNumber: 'SYNTHETIC-' + id, status: 'Received', intakeStatus: 'Approved', documentDirection: 'Outgoing', currentOfficeId: 'SOURCE', originOfficeId: 'SOURCE', documentTypeId: 'TYPE', scannedFiles: [], timeline: [], createdAt: new Date().toISOString(), ...extra });

integration('Audit repair: new saves reject duplicate identities and never overwrite an existing record', async () => {
  await fixture('EXISTING', { subject: 'Original', currentOfficeId: 'OTHER', originOfficeId: 'OTHER' });
  await assert.rejects(new models.Document({ id: 'EXISTING', subject: 'Replacement', trackingNumber: 'REPLACEMENT' }).save(), { name: 'SequelizeUniqueConstraintError' });
  assert.equal((await raw.DocumentModel.findByPk('EXISTING')).subject, 'Original');
  const created = await request('/documents', 'POST', { id: 'EXISTING', subject: 'New item', senderName: 'Synthetic', destinationOfficeId: 'OTHER', scannedFiles: [{ name: 'test.png', dataUrl: png }] }, 'Office');
  assert.equal(created.status, 201, created.text); assert.notEqual(created.body.id, 'EXISTING');
  assert.equal((await raw.DocumentModel.findByPk('EXISTING')).subject, 'Original');
});
integration('Audit repair: registration rolls back its document if initial deliveries fail', async () => {
  failSend = true;
  try {
    const res = await request('/documents', 'POST', { subject: 'Failure', senderName: 'Synthetic', trackingNumber: 'SYNTHETIC-ROLLBACK', destinationOfficeId: 'OTHER', scannedFiles: [{ name: 'test.png', dataUrl: png }] }, 'Office');
    assert.equal(res.status, 500, res.text);
    assert.equal(await raw.DocumentModel.count({ where: { trackingNumber: 'SYNTHETIC-ROLLBACK' } }), 0);
  } finally { failSend = false; }
});

integration('SMS HTTP registration records paused workflow SMS and opt-out cancels them atomically', async () => {
  const response = await request('/documents', 'POST', { subject: 'Synthetic SMS registration', senderName: 'Synthetic',
    trackingNumber: 'SYNTHETIC-SMS-HTTP', senderContact: '09180000000', notifySender: true,
    senderNotificationConsent: true, senderNotificationChannels: ['sms'], destinationOfficeId: 'OTHER',
    scannedFiles: [{ name: 'test.png', dataUrl: png }] }, 'Office');
  assert.equal(response.status, 201, response.text);
  const messages = await raw.SmsNotificationModel.findAll({ where: { documentId: response.body.id } });
  assert.ok(messages.length > 0); assert.ok(messages.every(message => message.status === 'Paused'));
  const update = await request('/documents/' + response.body.id, 'PUT', { senderNotificationConsent: false });
  assert.equal(update.status, 200, update.text);
  assert.ok((await raw.SmsNotificationModel.findAll({ where: { documentId: response.body.id } })).every(message => message.status === 'Cancelled'));
});

integration('SMS HTTP registration rolls back document and initial handoff when outbox storage fails', async () => {
  raw.SmsNotificationModel.addHook('beforeBulkCreate', 'smsHttpFault', () => { throw new Error('Synthetic outbox write failure'); });
  try {
    const response = await request('/documents', 'POST', { subject: 'Synthetic SMS failure', senderName: 'Synthetic',
      trackingNumber: 'SYNTHETIC-SMS-FAILURE', senderContact: '09180000000', notifySender: true,
      senderNotificationConsent: true, senderNotificationChannels: ['sms'], destinationOfficeId: 'OTHER',
      scannedFiles: [{ name: 'test.png', dataUrl: png }] }, 'Office');
    assert.equal(response.status, 500, response.text);
    assert.equal(await raw.DocumentModel.count({ where: { trackingNumber: 'SYNTHETIC-SMS-FAILURE' } }), 0);
  } finally { raw.SmsNotificationModel.removeHook('beforeBulkCreate', 'smsHttpFault'); }
});
integration('Audit repair: scan serving enforces role and ownership, including PDF pages and byte ranges', async () => {
  await fs.writeFile(path.join(tempRoot, 'scans', 'private.png'), Buffer.from('synthetic-image-data'));
  await fixture('PRIVATE', { currentOfficeId: 'OTHER', originOfficeId: 'OTHER', scannedFiles: [{ url: '/uploads/scans/private.pdf', pages: [{ url: '/uploads/scans/private.png' }] }] });
  assert.equal((await request('/uploads/scans/private.png', 'GET', null, null)).status, 401);
  assert.equal((await request('/uploads/scans/private.png', 'GET', null, 'Office', 'SOURCE')).status, 404);
  const authorized = await request('/uploads/scans/private.png', 'GET', null, 'Office', 'OTHER', 'OTHER-USER', { Range: 'bytes=0-3' });
  assert.equal(authorized.status, 206); assert.equal(authorized.text, 'synt'); assert.equal(authorized.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('/uploads/scans/..%2Fprivate.png')).status, 404);
});
integration('Audit repair: stored scans from another document cannot be attached to gain access', async () => {
  await fixture('OWN');
  const res = await request('/documents/OWN', 'PUT', { scannedFiles: [{ name: 'stolen.png', url: '/uploads/scans/private.png' }] });
  assert.equal(res.status, 400, res.text);
});
integration('Audit repair: failed attachment saves retain the old file and its references', async () => {
  await fs.writeFile(path.join(tempRoot, 'scans', 'old.png'), 'synthetic old scan');
  await fixture('FILES', { scannedFiles: [{ id: 'OLD', name: 'old.png', type: 'image/png', url: '/uploads/scans/old.png' }] });
  failSave = true;
  try { assert.equal((await request('/documents/FILES', 'PUT', { scannedFiles: [{ name: 'replacement.png', dataUrl: png }] })).status, 500); }
  finally { failSave = false; }
  assert.equal(await fs.readFile(path.join(tempRoot, 'scans', 'old.png'), 'utf8'), 'synthetic old scan');
  assert.equal((await raw.DocumentModel.findByPk('FILES')).scannedFiles[0].id, 'OLD');
});
integration('Audit repair: archive creation is atomic and simultaneous attempts produce one archive', async () => {
  await fixture('ARCHIVE', { status: 'Signed' });
  const results = await Promise.all([request('/archives', 'POST', { documentId: 'ARCHIVE' }), request('/archives', 'POST', { documentId: 'ARCHIVE' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARCHIVE' } }), 1);
  const arc = await raw.ArchiveModel.findOne({ where: { documentId: 'ARCHIVE' } });
  assert.equal((await request('/archives/' + arc.id, 'PUT', { documentId: 'OWN', statusBeforeArchive: 'Signed' })).status, 400);
  assert.equal((await request('/archives/' + arc.id, 'DELETE')).status, 200);
  assert.equal((await raw.DocumentModel.findByPk('ARCHIVE')).status, 'Signed');
  assert.equal((await raw.DocumentModel.findByPk('OWN')).status, 'Received');
});
integration('Audit repair: signing requires current custody in both action and generic update routes', async () => {
  await fixture('SIGN', { currentOfficeId: 'OTHER', status: 'For Signing' });
  assert.equal((await request('/documents/SIGN/process-note', 'POST', { action: 'sign_document' }, 'Mayor', 'MAYOR')).status, 403);
  assert.equal((await request('/documents/SIGN', 'PUT', { status: 'Signed' }, 'Mayor', 'MAYOR')).status, 403);
  assert.equal((await request('/documents/SIGN/process-note', 'POST', { action: 'sign_document' }, 'Admin', 'OTHER')).status, 200);
});
integration('Audit repair: scanner admission serializes concurrent requests and allows camera-light exception', async () => {
  const results = await Promise.all([request('/commands', 'POST', { deviceId: 'TEST-DEVICE', command: 'SCAN' }), request('/commands', 'POST', { deviceId: 'TEST-DEVICE', command: 'SORT' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409], JSON.stringify(results));
  assert.equal(await raw.CommandModel.count({ where: { deviceId: 'TEST-DEVICE' } }), 1);
  assert.equal((await request('/commands', 'POST', { deviceId: 'TEST-DEVICE', command: 'CAMERA_LIGHT' })).status, 201);
});
integration('Audit repair: Office log pages and totals exclude unrelated activity', async () => {
  await raw.LogModel.bulkCreate([{ id: 'LOG-OWN', userId: 'TEST-USER', action: 'synthetic', referenceId: 'OWN' }, { id: 'LOG-PRIVATE', userId: 'OTHER-USER', action: 'synthetic', referenceId: 'PRIVATE' }]);
  const response = await request('/logs?limit=20', 'GET', null, 'Office', 'SOURCE');
  assert.equal(response.status, 200, response.text); assert.equal(response.body.total, 1); assert.equal(response.body.items[0].id, 'LOG-OWN');
});
integration('Audit repair: failed archive or restore saves roll back both linked records', async () => {
  await fixture('ARC-FAIL', { status: 'Signed' });
  failSaveTarget = 'ARC-FAIL'; failSave = true;
  try {
    assert.equal((await request('/archives', 'POST', { documentId: 'ARC-FAIL' })).status, 500);
    assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARC-FAIL' } }), 0);
    assert.equal((await raw.DocumentModel.findByPk('ARC-FAIL')).status, 'Signed');
    failSave = false;
    const created = await request('/archives', 'POST', { documentId: 'ARC-FAIL' });
    assert.equal(created.status, 200, created.text);
    failSave = true;
    assert.equal((await request('/archives/' + created.body.id, 'DELETE')).status, 500);
    assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARC-FAIL' } }), 1);
    assert.equal((await raw.DocumentModel.findByPk('ARC-FAIL')).status, 'Archived');
  } finally { failSave = false; failSaveTarget = 'FILES'; }
});
integration('Audit repair: concurrent metadata edits reject stale state under the document lock', async () => {
  await fixture('EDIT-RACE');
  let reads = 0, release; const barrier = new Promise(resolve => { release = resolve; });
  raw.DocumentModel.addHook('afterFind', 'editBarrier', async (row, opts) => {
    if (row?.id === 'EDIT-RACE' && !opts.transaction) { reads++; if (reads === 2) release(); await barrier; }
  });
  try {
    const result = await Promise.all([request('/documents/EDIT-RACE', 'PUT', { subject: 'First edit' }), request('/documents/EDIT-RACE', 'PUT', { subject: 'Second edit' })]);
    assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  } finally { raw.DocumentModel.removeHook('afterFind', 'editBarrier'); }
});
integration('Audit repair: routing and archiving cannot leave an archived document with a pending delivery', async () => {
  await fixture('FLOW-RACE', { status: 'Signed' });
  const result = await Promise.all([request('/archives', 'POST', { documentId: 'FLOW-RACE' }), request('/documents/FLOW-RACE/send', 'POST', { toOfficeIds: ['OTHER'] })]);
  assert.equal(result.filter(r => r.status === 200).length, 1, JSON.stringify(result));
  assert(result.some(r => [400, 409].includes(r.status)));
  const doc = await raw.DocumentModel.findByPk('FLOW-RACE');
  const deliveries = await raw.TransmissionModel.count({ where: { documentId: 'FLOW-RACE' } });
  assert(!(doc.status === 'Archived' && deliveries > 0));
});
integration('Audit repair: deleting an account retains immutable receipt identity and time', async () => {
  await raw.UserModel.create({ id: 'REMOVED-USER', username: 'synthetic-removed', password: 'synthetic-unused', fname: 'Synthetic', lname: 'User', role: 'Office', officeId: 'OTHER' });
  await fixture('RECEIPT-HISTORY');
  const receivedAt = new Date().toISOString();
  await raw.TransmissionModel.create({ id: 'RECEIPT-KEEP', documentId: 'RECEIPT-HISTORY', receivedBy: 'REMOVED-USER', receivedAt });
  assert.equal((await request('/users/REMOVED-USER', 'DELETE')).status, 200);
  assert.equal(await raw.UserModel.findByPk('REMOVED-USER'), null);
  const transmission = await raw.TransmissionModel.findByPk('RECEIPT-KEEP');
  assert.equal(transmission.receivedBy, 'REMOVED-USER'); assert.equal(transmission.receivedAt, receivedAt);
});
integration('Audit repair: saving separately loaded instances preserves unrelated updates', async () => {
  await fixture('DIRTY');
  const first = await models.Document.findOne({ id: 'DIRTY' }), second = await models.Document.findOne({ id: 'DIRTY' });
  first.subject = 'New subject'; await first.save();
  second.remarks = 'Independent remarks'; await second.save();
  const doc = await raw.DocumentModel.findByPk('DIRTY'); assert.equal(doc.subject, 'New subject'); assert.equal(doc.remarks, 'Independent remarks');
});
integration('Audit repair: late hardware acknowledgements cannot reactivate terminal commands or rewrite outcome time', async () => {
  const executedAt = '2026-10-29T10:00:00.000Z';
  await raw.CommandModel.create({ id: 'TERMINAL', deviceId: 'TEST-TERMINAL', command: 'SCAN', status: 'Cancelled', executedAt });
  assert.equal((await request('/devices/commands/TERMINAL', 'PUT', { status: 'Executing' })).status, 409);
  assert.equal((await request('/devices/commands/TERMINAL', 'PUT', { status: 'Cancelled' })).status, 200);
  const command = await raw.CommandModel.findByPk('TERMINAL'); assert.equal(command.status, 'Cancelled'); assert.equal(command.executedAt, executedAt);
});
integration('Audit repair: deletion and archiving preserve cross-record integrity under concurrency', async () => {
  await fixture('DELETE-RACE', { status: 'Signed' });
  const results = await Promise.all([request('/documents/DELETE-RACE', 'DELETE'), request('/archives', 'POST', { documentId: 'DELETE-RACE' })]);
  assert.equal(results[0].status, 200, JSON.stringify(results));
  assert([200, 404, 409].includes(results[1].status));
  assert.equal(await raw.DocumentModel.count({ where: { id: 'DELETE-RACE' } }), 0);
  assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'DELETE-RACE' } }), 0);
});
