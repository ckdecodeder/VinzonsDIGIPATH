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
let db, models, raw, base, server, tempRoot, failSave = false, failSend = false, failSaveTarget = 'FILES', failNotifications = false, invalidations = 0;
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
    '../utils/helpers': { ...helpers, createLogEntry: async () => {}, createNotification: async () => { if (failNotifications) throw Error('Synthetic notification failure'); }, notifyApprovalUsers: async () => { if (failNotifications) throw Error('Synthetic notification failure'); },
      appendDocumentTimeline: (id, event, updates, opts = {}) => models.Document.findOneAndUpdate({ id }, { $set: updates, $push: { timeline: event } }, { new: true, ...opts }) },
    '../utils/documentHandoffs': { sendHandoffs: handoffs.send, receiveHandoff: handoffs.receive, cancelHandoff: handoffs.cancel },
    '../utils/archiveWorkflow': { archiveDocument: archive.create, restoreArchive: archive.remove },
    '../utils/realtime': { broadcastDataInvalidate: () => { invalidations++; }, broadcastDeviceUpdated: () => {}, broadcastCommandUpdated: () => {}, pushCommandToDevice: () => false },
    '../services/devicePresence': { getDeviceSnapshot: async () => ({ connected: true }), hardwarePresenceEvents: [] },
    '../utils/bridge': { ...require('../utils/bridge'), requireDeviceApiKey: (req, res, next) => next() },
    '../utils/transactionContext': { ...context, withDeviceCommandLock: (id, fn) => context.withDeviceCommandLock(id, fn, raw.CommandModel) },
  };
  overrides['../utils/logScope'] = await loadModule(path.resolve(__dirname, '../utils/logScope.js'), { '../models': models });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-role']) req.user = { id: req.headers['x-test-user'] || 'TEST-USER', role: req.headers['x-test-role'], officeId: req.headers['x-test-office'] || 'SOURCE' }; next(); });
  for (const name of ['documents', 'transmissions', 'archives', 'logs', 'users']) app.use('/' + name, await loadModule(path.resolve(__dirname, '../routes', name + '.js'), overrides));
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

integration('Physical retakes preserve originals through abandonment and failed registration, then commit once in order', async () => {
  const deviceId = 'RETAKE-TEST';
  const capture = async (id, documentId, retake = false, failUpload = false) => {
    const payload = { officeId: 'SOURCE', documentId, retake };
    const queue = () => request('/commands', 'POST', { id, deviceId, command: 'SCAN', payload });
    const queued = await queue();
    assert.equal(queued.status, 201, queued.text);
    assert.equal((await queue()).body.id, id);
    const upload = () => request('/devices/scans', 'POST', { deviceId, commandId: id, documentId,
      attachment: { name: id + '.png', type: 'image/png', dataUrl: failUpload ? 'invalid' : png } });
    const response = await upload();
    if (failUpload) {
      assert.equal(response.status, 400, response.text);
      assert.equal((await request('/commands/cancel', 'POST', { deviceId, commandId: id })).status, 200);
      return;
    }
    assert.equal(response.status, 201, response.text);
    const replay = await upload();
    assert.equal(replay.status, 201, replay.text);
    assert.equal(replay.body.documentId, response.body.documentId);
    if (retake) {
      const status = await request('/commands/' + id + '/status');
      assert.equal(status.body.retakePage.dataUrl, png, status.text);
      assert.equal(status.body.retakePage.id, 'SCANPAGE_' + id);
    }
    return response.body.document;
  };
  for (const count of [1, 3]) {
    const original = await capture('ORIGINAL-' + count);
    const oldFiles = original.scannedFiles;
    const oldIds = oldFiles.map(page => page.id);
    const fresh = () => raw.DocumentModel.findByPk(original.id);
    await capture('ABANDON-' + count, original.id, true);
    await capture('FAIL-' + count, original.id, true, true);
    assert.deepEqual((await fresh()).scannedFiles, oldFiles);
    const commandIds = [];
    for (let page = 1; page <= count; page++) {
      const id = 'REPLACEMENT-' + count + '-' + page;
      commandIds.push(id);
      await capture(id, original.id, true);
      assert.deepEqual((await fresh()).scannedFiles, oldFiles);
    }
    const body = { subject: 'Reviewed paperwork', senderName: 'Synthetic', destinationOfficeId: 'OTHER',
      documentTypeId: 'TYPE', scannedFiles: [{ name: 'reviewed.pdf', type: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK' }],
      scannerRegistration: { originalPageIds: oldIds, commandIds, retake: true } };
    const register = () => request('/documents/' + original.id + '/register-scan', 'POST', body);
    failSend = true;
    try {
      const failed = await register();
      assert.equal(failed.status, 500, failed.text);
      assert.deepEqual((await fresh()).scannedFiles, oldFiles);
      assert.equal((await fresh()).intakeStatus, 'Pending Review');
    } finally { failSend = false; }
    const results = await Promise.all([register(), register()]);
    for (const response of results) {
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.id, original.id);
      assert.equal(response.body.trackingNumber, original.trackingNumber);
      assert.deepEqual(response.body.scannedFiles[0].pages.map(page => page.id), commandIds.map(id => 'SCANPAGE_' + id));
    }
    assert.equal(await raw.TransmissionModel.count({ where: { documentId: original.id } }), 1);
    assert.equal(await raw.DocumentModel.count({ where: { trackingNumber: original.trackingNumber } }), 1);
    assert.equal((await fresh()).timeline.filter(event => event.action === 'scanner_intake').length, 1);
  }
});

integration('Cancelling a pending scan leaves executing and unrelated commands intact', async () => {
  const deviceId = 'CANCEL-TEST';
  const issue = (id, command) => request('/commands', 'POST', { id, deviceId, command });
  const pending = await issue('ONLY-THIS-SCAN', 'SCAN');
  const light = await issue('SYNTHETIC-LIGHT', 'CAMERA_LIGHT');
  assert.equal(pending.status, 201, pending.text);
  assert.equal(light.status, 201, light.text);
  const cancel = commandId => request('/commands/cancel', 'POST', { deviceId, commandId });
  assert.equal((await cancel()).status, 400);
  assert.equal((await cancel(light.body.id)).status, 404);
  assert.equal((await request('/commands/cancel', 'POST', { deviceId: 'WRONG', commandId: pending.body.id })).status, 404);
  assert.equal((await request('/commands/cancel', 'POST', { deviceId, commandId: pending.body.id }, 'Receptionist', 'SOURCE', 'OTHER-USER')).status, 404);
  assert.equal((await cancel(pending.body.id)).body.status, 'Cancelled');
  assert.equal((await cancel(pending.body.id)).body.status, 'Cancelled');
  assert.equal((await raw.CommandModel.findByPk(light.body.id)).status, 'Pending');
  assert.equal((await request('/devices/scans', 'POST', { deviceId, commandId: pending.body.id,
    attachment: { name: 'late.png', type: 'image/png', dataUrl: png } })).status, 409);
  const active = await issue('EXECUTING-SCAN', 'SCAN');
  assert.equal((await request('/devices/commands/' + active.body.id, 'PUT', { status: 'Executing' })).status, 200);
  assert.equal((await cancel(active.body.id)).status, 409);
  assert.equal((await request('/commands/' + active.body.id + '/status')).body.status, 'Executing');
});

integration('Office handoff monitoring keeps completed sends visible and the sender cannot edit or receive in transit', async () => {
  const documentId = 'OFFICE-HANDOFF';
  await fixture(documentId);
  const sent = await request(`/documents/${documentId}/send`, 'POST', { toOfficeIds: ['OTHER'] }, 'Office', 'SOURCE');
  assert.equal(sent.status, 200, sent.text);
  const pending = (await request('/transmissions', 'GET', null, 'Office', 'SOURCE')).body.find(row => row.documentId === documentId);
  assert.ok(pending);
  assert.equal((await request(`/documents/${documentId}`, 'PUT', { subject: 'Changed' }, 'Office', 'SOURCE')).status, 403);

  const endpoint = `/transmissions/${pending.id}`;
  assert.equal((await request(endpoint, 'GET', null, 'Receptionist', 'OTHER')).body.id, pending.id);
  assert.equal((await request(endpoint, 'GET', null, 'Office', 'OUTSIDE')).status, 404);
  assert.equal((await request(endpoint, 'PUT', { confirmReceipt: true }, 'Office', 'SOURCE')).status, 403);
  const receipt = await request(endpoint, 'PUT', { confirmReceipt: true }, 'Office', 'OTHER', 'OTHER-USER');
  assert.equal(receipt.status, 200, receipt.text);
  const completed = (await request('/transmissions', 'GET', null, 'Office', 'SOURCE')).body.find(row => row.id === pending.id);
  assert.equal(completed.receivedBy, 'OTHER-USER');
  assert.equal((await request(endpoint, 'GET', null, 'Office', 'OTHER')).body.receivedBy, 'OTHER-USER');
  assert.ok(completed.receivedAt);
  assert.equal((await request(endpoint, 'PUT', { confirmReceipt: true }, 'Office', 'SOURCE')).status, 404);
  assert.equal((await request('/transmissions', 'GET', null, 'Office', 'OUTSIDE')).body.some(row => row.id === pending.id), false);
  assert.equal((await request('/transmissions', 'GET', null, 'Receptionist', 'SOURCE')).body.some(row => row.id === pending.id), false);
});

integration('repeated workflow operations append one event under the document lock', async () => {
  for (const action of ['action_note', 'sign_document', 'acknowledge_document', 'document_rejected']) {
    const id = 'WORKFLOW-' + action;
    await fixture(id);
    const rejection = action === 'document_rejected';
    const endpoint = `/documents/${id}/${rejection ? 'verify' : 'process-note'}`;
    const operationId = randomUUID();
    const payload = rejection ? { intakeStatus: 'Rejected', rejectionReason: 'Fixture reason', operationId }
      : { action, note: 'Fixture note', operationId };
    const replies = await Promise.all([request(endpoint, 'POST', payload), request(endpoint, 'POST', payload)]);
    assert.ok(replies.some(reply => reply.status === 200));
    assert.ok(replies.every(reply => [200, 409].includes(reply.status)));
    assert.equal((await request(endpoint, 'POST', payload)).status, 200);
    const saved = await request('/documents/' + id);
    assert.equal(saved.body.timeline.filter(entry => entry.action === action && entry.operationId === operationId).length, 1);
  }
});

integration('Office tracking reads legacy outbound documents and attachments without expanding mutation scope', async () => {
  const documentId = 'OFFICE-LEGACY-TRACKING';
  const filename = 'legacy-tracking.png';
  const attachment = `/uploads/scans/${filename}`;
  await fs.writeFile(path.join(tempRoot, 'scans', filename), Buffer.from(png.split(',')[1], 'base64'));
  await fixture(documentId, { currentOfficeId: 'MAYOR', destinationOfficeId: 'MAYOR', scannedFiles: [{ url: attachment }] });
  await raw.TransmissionModel.create({ id: 'LEGACY-OUTBOUND', documentId, fromOfficeId: 'OTHER', toOfficeId: 'MAYOR', receivedBy: 'MAYOR-USER' });

  const list = await request(`/documents?search=${documentId}`, 'GET', null, 'Office', 'OTHER');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.items.some(doc => doc.id === documentId), true);
  assert.equal((await request(`/documents/${documentId}`, 'GET', null, 'Office', 'OTHER')).status, 200);
  assert.equal((await request(attachment, 'GET', null, 'Office', 'OTHER')).status, 200);
  assert.equal((await request(`/documents/${documentId}`, 'PUT', { subject: 'Changed' }, 'Office', 'OTHER')).status, 404);
  assert.equal((await request(`/documents/${documentId}`, 'GET', null, 'Office', 'OUTSIDE')).status, 404);
  assert.equal((await request(attachment, 'GET', null, 'Office', 'OUTSIDE')).status, 404);
});

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
  await fixture('ARCHIVE', { status: 'Completed', completedAt: new Date().toISOString(), scannedImageUrl: png });
  const results = await Promise.all([request('/archives', 'POST', { documentId: 'ARCHIVE' }), request('/archives', 'POST', { documentId: 'ARCHIVE' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARCHIVE' } }), 1);
  const arc = await raw.ArchiveModel.findOne({ where: { documentId: 'ARCHIVE' } });
  assert.equal((await request('/archives/' + arc.id, 'PUT', { documentId: 'OWN', statusBeforeArchive: 'Signed' })).status, 400);
  assert.equal((await request('/archives/' + arc.id, 'DELETE')).status, 200);
  assert.equal((await raw.DocumentModel.findByPk('ARCHIVE')).status, 'Completed');
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
  await fixture('ARC-FAIL', { status: 'Completed', completedAt: new Date().toISOString(), scannedImageUrl: png });
  failSaveTarget = 'ARC-FAIL'; failSave = true;
  try {
    assert.equal((await request('/archives', 'POST', { documentId: 'ARC-FAIL' })).status, 500);
    assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARC-FAIL' } }), 0);
    assert.equal((await raw.DocumentModel.findByPk('ARC-FAIL')).status, 'Completed');
    failSave = false;
    const created = await request('/archives', 'POST', { documentId: 'ARC-FAIL' });
    assert.equal(created.status, 200, created.text);
    failSave = true;
    assert.equal((await request('/archives/' + created.body.id, 'DELETE')).status, 500);
    assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'ARC-FAIL' } }), 1);
    assert.equal((await raw.DocumentModel.findByPk('ARC-FAIL')).status, 'Archived');
  } finally { failSave = false; failSaveTarget = 'FILES', failNotifications = false, invalidations = 0; }
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
  await fixture('FLOW-RACE', { status: 'Completed', completedAt: new Date().toISOString(), scannedImageUrl: png });
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
  await fixture('DELETE-RACE', { status: 'Completed', completedAt: new Date().toISOString(), scannedImageUrl: png });
  const results = await Promise.all([request('/documents/DELETE-RACE', 'DELETE'), request('/archives', 'POST', { documentId: 'DELETE-RACE' })]);
  assert.equal(results[0].status, 200, JSON.stringify(results));
  assert([200, 404, 409].includes(results[1].status));
  assert.equal(await raw.DocumentModel.count({ where: { id: 'DELETE-RACE' } }), 0);
  assert.equal(await raw.ArchiveModel.count({ where: { documentId: 'DELETE-RACE' } }), 0);
});


integration('Internal Mayor requests enforce the selected action after primary receipt', async () => {
  const payload = { subject: 'Synthetic Mayor request', senderName: 'Synthetic', destinationOfficeId: 'MAYOR',
    scannedFiles: [{ name: 'test.png', dataUrl: png }] };
  assert.equal((await request('/documents', 'POST', payload, 'Office')).status, 400);
  for (const requestedMayorAction of ['information', 'signature']) {
    const registration = await request('/documents', 'POST', { ...payload, requestedMayorAction }, 'Office');
    assert.equal(registration.status, 201, registration.text);
    const doc = registration.body;
    assert.equal(doc.requestedMayorAction, requestedMayorAction);
    const delivery = await raw.TransmissionModel.findOne({ where: { documentId: doc.id } });
    assert.equal((await request(`/transmissions/${delivery.id}`, 'PUT', { confirmReceipt: true }, 'Mayor', 'MAYOR')).status, 200);
    const act = action => request(`/documents/${doc.id}/process-note`, 'POST', { action }, 'Mayor', 'MAYOR');
    if (requestedMayorAction === 'signature') {
      assert.equal((await act('complete_document')).status, 409);
      assert.equal((await act('acknowledge_document')).status, 409);
      assert.equal((await act('sign_document')).status, 200);
    }
    assert.equal((await act('complete_document')).status, 200);
  }
});

integration('Audit follow-up: registration visits Mayor before the requested final office', async () => {
  await raw.DocumentTypeModel.create({ id: 'REQUIRES-APPROVAL', category: 'Synthetic approval', requiresMayorApproval: true, requiresMayorReception: true });
  for (const [role, endpoint] of [['Office', '/documents'], ['Receptionist', '/documents'], ['Receptionist', '/documents/scanner']]) {
    const result = await request(endpoint, 'POST', { subject: 'Synthetic approval route', senderName: 'Synthetic',
      documentTypeId: 'REQUIRES-APPROVAL', destinationOfficeId: 'OTHER', scannedFiles: [{ name: 'test.png', dataUrl: png }] }, role);
    assert.equal(result.status, 201, result.text);
    const doc = endpoint.endsWith('scanner') ? result.body.document : result.body;
    assert.deepEqual(doc.routePlan, ['SOURCE', 'MAYOR', 'OTHER']);
    if (role === 'Receptionist') assert.equal(doc.intakeOfficeId, 'SOURCE');
    let deliveries = await raw.TransmissionModel.findAll({ where: { documentId: doc.id } });
    assert.deepEqual(deliveries.map(row => row.toOfficeId), ['MAYOR']);
    assert.equal((await request(`/transmissions/${deliveries[0].id}`, 'PUT', { confirmReceipt: true }, 'Mayor', 'MAYOR')).status, 200);
    assert.equal((await request(`/documents/${doc.id}/send`, 'POST', { toOfficeIds: ['OTHER'] }, 'Mayor', 'MAYOR')).status, 400);
    assert.equal((await request(`/documents/${doc.id}/process-note`, 'POST', { action: 'sign_document' }, 'Mayor', 'MAYOR')).status, 200);
    assert.equal((await request(`/documents/${doc.id}/process-note`, 'POST', { action: 'complete_document' }, 'Mayor', 'MAYOR')).status, 409);
    assert.equal((await request(`/documents/${doc.id}/send`, 'POST', { toOfficeIds: ['OTHER'] }, 'Mayor', 'MAYOR')).status, 200);
    deliveries = await raw.TransmissionModel.findAll({ where: { documentId: doc.id, toOfficeId: 'OTHER' } });
    assert.equal(deliveries.length, 1);
    assert.equal((await request(`/transmissions/${deliveries[0].id}`, 'PUT', { confirmReceipt: true }, 'Office', 'OTHER')).status, 200);
    assert.equal((await request(`/documents/${doc.id}/process-note`, 'POST', { action: 'complete_document' }, 'Office', 'OTHER')).status, 200);
  }
});

integration('Audit follow-up: physical scan registration retains the original intake office after receipt', async () => {
  const capture = await request('/devices/scans', 'POST', { deviceId: 'SYNTHETIC-SCANNER', officeId: 'SOURCE', documentTypeId: 'TYPE', attachment: { name: 'capture.png', type: 'image/png', dataUrl: png } });
  assert.equal(capture.status, 201, capture.text);
  const doc = capture.body.document;
  assert.equal(doc.intakeOfficeId, 'SOURCE');
  const registration = await request(`/documents/${doc.id}`, 'PUT', { subject: 'Synthetic registered scan', intakeStatus: 'Approved', intakeOfficeId: 'OTHER' }, 'Receptionist');
  assert.equal(registration.status, 200, registration.text);
  assert.equal(registration.body.intakeOfficeId, 'SOURCE');
  assert.equal((await request(`/documents/${doc.id}/send`, 'POST', { toOfficeIds: ['OTHER'] }, 'Office')).status, 200);
  const delivery = await raw.TransmissionModel.findOne({ where: { documentId: doc.id } });
  assert.equal((await request(`/transmissions/${delivery.id}`, 'PUT', { confirmReceipt: true }, 'Office', 'OTHER')).status, 200);
  assert.equal((await request(`/documents/${doc.id}`, 'GET', null, 'Receptionist', 'SOURCE')).status, 200);
  assert.equal((await request(`/documents/${doc.id}`, 'GET', null, 'Receptionist', 'UNRELATED')).status, 404);
});

integration('Audit follow-up: generic signing succeeds once and invalidates despite notification failure', async () => {
  for (const [before, after] of [['For Signing', 'Signed'], ['For Filing', 'Acknowledged']]) {
    const id = 'GENERIC-' + after;
    await fixture(id, { status: before });
    for (const failure of [false, true]) {
      await raw.DocumentModel.update({ status: before, timeline: [] }, { where: { id } });
      const previousInvalidations = invalidations;
      failNotifications = failure;
      try {
        const result = await request(`/documents/${id}`, 'PUT', { status: after });
        assert.equal(result.status, 200, result.text);
        const saved = await raw.DocumentModel.findByPk(id);
        assert.equal(saved.status, after); assert.equal(saved.timeline.length, 1);
        assert.ok(invalidations > previousInvalidations);
      } finally { failNotifications = false; }
    }
  }
});
