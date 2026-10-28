const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createHandoffService } = require('../utils/documentHandoffs');

// Opt in explicitly. Never load the application's environment or migrate its tables.
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
const integration = (name, work) => test(name, { skip: !databaseUrl }, work);
const schema = `workflow_delivery_test_${randomUUID().replaceAll('-', '')}`;
let db, DocumentModel, TransmissionModel, service;
before(async () => {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /_test(?:_|$)/, 'Workflow write tests require a separately named test database');
  const { Sequelize, DataTypes } = require('sequelize');
  db = new Sequelize(databaseUrl, { logging: false });
  await db.authenticate();
  await db.createSchema(schema);
  const fields = Object.fromEntries(['id', 'subject', 'trackingNumber', 'documentDirection', 'status', 'intakeStatus', 'intakeOfficeId', 'currentOfficeId', 'originOfficeId', 'destinationOfficeId', 'preTransitStatus', 'createdAt', 'updatedAt', 'lastRoutedAt'].map((field) => [field, { type: DataTypes.TEXT }]));
  fields.id.primaryKey = true;
  for (const field of ['sendHistory', 'sendQueue', 'timeline', 'routePlan']) fields[field] = { type: DataTypes.JSONB, defaultValue: [] };
  fields.routeStep = { type: DataTypes.INTEGER };
  fields.mayorApprovalCleared = { type: DataTypes.BOOLEAN };
  DocumentModel = db.define('WorkflowTestDocument', fields, { tableName: 'documents', schema, timestamps: false });
  const transFields = Object.fromEntries(['id', 'documentId', 'fromOfficeId', 'toOfficeId', 'sentBy', 'receivedBy', 'receivedAt', 'transmissionDate', 'transmissionType', 'acknowledgementRemarks', 'createdAt', 'updatedAt'].map((field) => [field, { type: DataTypes.TEXT }]));
  transFields.id.primaryKey = true;
  TransmissionModel = db.define('WorkflowTestTransmission', transFields, { tableName: 'transmissions', schema, timestamps: false });
  await DocumentModel.sync();
  await TransmissionModel.sync();
  service = createHandoffService({ DocumentModel, TransmissionModel });
});
after(async () => {
  if (!db) return;
  try { await db.dropSchema(schema); }
  finally { await db.close(); }
});

const fixture = async (extra = {}) => {
  const id = `SYNTHETIC-${randomUUID()}`;
  await DocumentModel.create({ id, subject: 'Synthetic office delivery', trackingNumber: id, documentDirection: 'Outgoing', status: 'Signed', intakeStatus: 'Approved', currentOfficeId: 'SOURCE', originOfficeId: 'SOURCE', ...extra });
  return {
    id,
    send: (overrides = {}) => service.send({ documentId: id, fromOfficeId: 'SOURCE', toOfficeIds: ['FIRST', 'SECOND', 'THIRD'], sentBy: 'SENDER', sentAt: new Date().toISOString(), eventFor: (trans) => ({ action: 'sent', referenceId: trans.id }), ...overrides }),
    receive: (trans, overrides = {}) => service.receive({ transmissionId: trans.id, officeId: trans.toOfficeId, receivedBy: `USER-${trans.toOfficeId}`, confirmed: true, eventFor: (item) => ({ action: 'received', referenceId: item.id }), ...overrides }),
    document: () => DocumentModel.findByPk(id, { raw: true }),
    transmissions: () => TransmissionModel.findAll({ where: { documentId: id }, raw: true }),
  };
};

integration('PostgreSQL: every selected office gets a delivery and receipts work in any order', async () => {
  const f = await fixture();
  const sent = await f.send();
  assert.equal(sent.transmissions.length, 3);
  await f.receive(sent.transmissions[2]);
  assert.equal((await f.document()).currentOfficeId, 'SOURCE');
  await f.receive(sent.transmissions[0]);
  await f.receive(sent.transmissions[1]);
  const doc = await f.document();
  assert.equal(doc.currentOfficeId, 'FIRST');
  assert.equal(doc.status, 'Signed');
  assert.equal(doc.sendHistory.filter((item) => item.receivedBy).length, 3);
  assert.equal(doc.timeline.filter((item) => item.action === 'received').length, 3);
  assert((await f.transmissions()).every((item) => item.receivedAt && item.receivedBy));
});

integration('PostgreSQL: simultaneous receipts preserve every office and timeline event', async () => {
  const f = await fixture();
  const sent = await f.send();
  await Promise.all(sent.transmissions.map((trans) => f.receive(trans)));
  const doc = await f.document();
  assert.equal(doc.timeline.length, 6);
  assert(doc.sendHistory.every((item) => !item.active && item.receivedAt));
  assert.equal(doc.currentOfficeId, 'FIRST');
});

integration('PostgreSQL: duplicate concurrent confirmations record exactly one receipt', async () => {
  const f = await fixture();
  const sent = await f.send();
  const results = await Promise.allSettled([f.receive(sent.transmissions[1]), f.receive(sent.transmissions[1])]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.status, 409);
  assert.equal((await f.document()).timeline.filter((item) => item.action === 'received').length, 1);
});

integration('PostgreSQL: concurrent sends create one complete batch and no conflicting deliveries', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.send(), f.send()]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.status, 409);
  assert.equal((await f.transmissions()).length, 3);
  assert.equal((await f.document()).timeline.length, 3);
});

integration('PostgreSQL: missing confirmation and another office cannot record a receipt', async () => {
  const f = await fixture();
  const sent = await f.send();
  await assert.rejects(f.receive(sent.transmissions[1], { confirmed: false }), { status: 400 });
  await assert.rejects(f.receive(sent.transmissions[1], { officeId: 'UNRELATED' }), { status: 403 });
  assert((await f.transmissions()).every((item) => !item.receivedBy));
  assert.equal((await f.document()).timeline.length, 3);
});

integration('PostgreSQL: approval cannot be bypassed by selecting Mayor first among several offices', async () => {
  const f = await fixture({ status: 'For Signing', mayorApprovalCleared: false });
  await assert.rejects(f.send({ requiresMayorApproval: true, mayorsOfficeId: 'FIRST' }), { status: 400 });
  assert.equal((await f.transmissions()).length, 0);
  const sent = await f.send({ requiresMayorApproval: true, mayorsOfficeId: 'FIRST', toOfficeIds: ['FIRST'] });
  assert.equal(sent.transmissions.length, 1);
});

integration('PostgreSQL: document-save failure rolls back deliveries and receipt together', async () => {
  const f = await fixture();
  const failing = createHandoffService({
    DocumentModel: { sequelize: db, findOne: async (options) => {
      const row = await DocumentModel.findOne(options);
      row.update = async () => { throw new Error('Synthetic save failure'); };
      return row;
    } }, TransmissionModel,
  });
  await assert.rejects(failing.send({ documentId: f.id, fromOfficeId: 'SOURCE', toOfficeIds: ['FIRST', 'SECOND'], sentBy: 'SENDER', sentAt: new Date().toISOString(), eventFor: () => ({}) }), /Synthetic save failure/);
  assert.equal((await f.transmissions()).length, 0);
  const sent = await f.send();
  await assert.rejects(failing.receive({ transmissionId: sent.transmissions[0].id, officeId: 'FIRST', receivedBy: 'RECEIVER', confirmed: true, eventFor: () => ({}) }), /Synthetic save failure/);
  assert((await f.transmissions()).every((item) => !item.receivedBy));
  assert.equal((await f.document()).timeline.length, 3);
});

integration('PostgreSQL: cancellation preserves other recipients and promotes a received copy when primary is cancelled', async () => {
  const f = await fixture();
  const sent = await f.send();
  await f.receive(sent.transmissions[1]);
  await service.cancel({ transmissionId: sent.transmissions[0].id, eventFor: () => ({ action: 'cancelled' }) });
  let doc = await f.document();
  assert.equal(doc.currentOfficeId, 'SECOND');
  assert.equal(doc.status, 'Signed');
  assert.equal(doc.sendHistory[0].recipientOfficeId, '');
  assert.equal(doc.sendHistory[1].primary, true);
  await f.receive(sent.transmissions[2]);
  doc = await f.document();
  assert.equal(doc.currentOfficeId, 'SECOND');
  assert.equal(doc.sendHistory.filter((item) => item.receivedBy).length, 2);
});

integration('PostgreSQL: legacy single-office transmissions still receive correctly', async () => {
  const f = await fixture({ status: 'In Transit', preTransitStatus: 'For Signing', destinationOfficeId: 'FIRST', sendQueue: ['SECOND'] });
  const trans = await TransmissionModel.create({ id: `LEGACY-${randomUUID()}`, documentId: f.id, fromOfficeId: 'SOURCE', toOfficeId: 'FIRST' });
  await f.receive(trans.get({ plain: true }));
  const doc = await f.document();
  assert.equal(doc.currentOfficeId, 'FIRST');
  assert.equal(doc.status, 'For Signing');
  assert.deepEqual(doc.sendQueue, ['SECOND']);
});

integration('PostgreSQL: scoped document SQL includes every current recipient and excludes unrelated offices', async () => {
  const { ModelWrapper } = require('../models/ModelWrapper');
  const { getScopedDocumentQuery } = require('../utils/documentScope');
  const f = await fixture();
  await f.send();
  const model = new ModelWrapper(DocumentModel);
  for (const officeId of ['FIRST', 'SECOND', 'THIRD']) {
    const rows = await model.find({ $and: [{ id: f.id }, getScopedDocumentQuery({ user: { role: 'Office', officeId } })] }).lean();
    assert.equal(rows.length, 1);
  }
  const unrelated = await model.find({ $and: [{ id: f.id }, getScopedDocumentQuery({ user: { role: 'Office', officeId: 'UNRELATED' } })] }).lean();
  assert.equal(unrelated.length, 0);
});

integration('HTTP and PostgreSQL: both send endpoints deliver to every office and enforce confirmed, scoped receipt', async () => {
  const express = require('express');
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const { createRequire } = require('node:module');
  const { once } = require('node:events');
  const { ModelWrapper } = require('../models/ModelWrapper');
  const helpers = require('../utils/helpers');
  const notifications = [];
  const offices = ['SOURCE', 'FIRST', 'SECOND', 'THIRD'].map((id) => ({ id, name: id }));
  const models = {
    Document: ModelWrapper.makeConstructable(new ModelWrapper(DocumentModel)),
    Transmission: ModelWrapper.makeConstructable(new ModelWrapper(TransmissionModel)),
    Office: { find: () => ({ lean: async () => offices }), findOne: ({ id }) => ({ lean: async () => offices.find((item) => item.id === id) }) },
    Notification: { deleteMany: async () => {} },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const officeId = req.headers['x-test-office'] || 'SOURCE';
    req.user = { id: `USER-${officeId}`, role: officeId === 'SOURCE' ? 'Admin' : 'Office', officeId };
    next();
  });
  for (const name of ['documents', 'transmissions']) {
    const filename = path.join(__dirname, '../routes', `${name}.js`);
    const realRequire = createRequire(filename);
    const overrides = {
      '../models': models,
      '../middleware/auth': { ...require('../middleware/auth'), protect: (req, res, next) => next() },
      '../utils/helpers': { ...helpers, createLogEntry: async () => {}, createNotification: async (notification) => notifications.push(notification), notifyApprovalUsers: async () => {} },
      '../utils/documentHandoffs': { sendHandoffs: service.send, receiveHandoff: service.receive, cancelHandoff: service.cancel },
      '../utils/senderNotifications': { queueSenderNotifications: async () => {} },
      '../utils/realtime': { broadcastDataInvalidate: () => {} },
    };
    const context = { module: { exports: {} }, console, process, require: (id) => overrides[id] || realRequire(id) };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    app.use(`/${name}`, context.module.exports);
  }
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, method = 'GET', body, office = 'SOURCE') => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-office': office }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  try {
    for (const sendEndpoint of ['documents', 'transmissions']) {
      const f = await fixture();
      const endpoint = sendEndpoint === 'documents' ? `/documents/${f.id}/send` : '/transmissions';
      const sent = await request(endpoint, 'POST', { documentId: f.id, fromOfficeId: 'SOURCE', toOfficeIds: ['FIRST', 'SECOND', 'THIRD'] });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const deliveries = await f.transmissions();
      assert.equal(deliveries.length, 3);
      assert.equal(notifications.filter((item) => item.title === 'Incoming document route').length, 3);
      notifications.length = 0;
      const second = deliveries.find((item) => item.toOfficeId === 'SECOND');
      assert.equal((await request(`/documents/${f.id}`, 'GET', null, 'SECOND')).status, 200);
      assert.equal((await request(`/documents/${f.id}`, 'GET', null, 'UNRELATED')).status, 404);
      const inbox = await request('/transmissions', 'GET', null, 'SECOND');
      assert(inbox.body.some((item) => item.id === second.id));
      assert.equal((await request(`/transmissions/${second.id}`, 'PUT', { receivedBy: 'FORGED' }, 'SECOND')).status, 400);
      const received = await request(`/transmissions/${second.id}`, 'PUT', { receivedBy: 'FORGED', receivedAt: '1900-01-01', confirmReceipt: true }, 'SECOND');
      assert.equal(received.status, 200, JSON.stringify(received.body));
      assert.equal(received.body.receivedBy, 'USER-SECOND');
      assert.notEqual(received.body.receivedAt, '1900-01-01');
      assert.equal((await request(`/transmissions/${second.id}`, 'PUT', { receivedBy: 'USER-SECOND', confirmReceipt: true }, 'SECOND')).status, 409);
      assert.equal((await f.document()).currentOfficeId, 'SOURCE');
      notifications.length = 0;
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
