const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const load = (relative, overrides) => {
  const filename = path.resolve(__dirname, '..', relative);
  const nativeRequire = createRequire(filename);
  const context = {
    module: { exports: {} }, console: { log() {} },
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
};

test('notification router exposes only normal in-app notification routes', async () => {
  const router = load('routes/notifications.js', {
    '../models': { Notification: { find: () => ({ sort() { return this; }, limit() { return this; },
      lean: async () => [{ id: 'SYNTHETIC-NOTIFICATION', readBy: ['SYNTHETIC-USER'] }],
    }) } },
    '../middleware/auth': { protect() {}, allowRoles: () => () => {} },
    '../utils/helpers': { asyncHandler: fn => fn, createLogEntry: async () => {} },
    '../utils/realtime': { broadcastDataInvalidate() {} },
    '../utils/documentScope': { isGlobalDocumentViewer: () => true },
  });
  const routes = router.stack.filter(layer => layer.route).map(layer => layer.route);
  assert.deepEqual(routes.map(route => route.path), [
    '/notifications', '/notifications/:id/read', '/notifications/read-all', '/notifications/:id',
  ]);
  const list = routes.find(route => route.path === '/notifications' && route.methods.get);
  let result;
  await list.stack.at(-1).handle({ user: { id: 'SYNTHETIC-USER', role: 'Admin' } }, {
    json(value) { result = value; },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].isRead, true);
});

test('model initialization retains document preferences without SMS tables or SMS schema writes', async () => {
  const defined = [], queries = [];
  let syncCalls = 0;
  const sequelize = {
    define(name, attributes, options) {
      defined.push({ name, attributes, tableName: options.tableName });
      return { tableName: options.tableName };
    },
    async query(sql) { queries.push(sql); },
    async sync() { syncCalls++; },
  };
  const models = load('models/index.js', { '../config/db': { sequelize } });
  assert.equal(models.SenderNotification, undefined);
  assert.equal(models._sequelizeModels.SenderNotificationModel, undefined);
  assert.equal(defined.some(model => /sender_notification/i.test(model.tableName)), false);
  assert.ok(defined.find(model => model.name === 'Notification'));
  const document = defined.find(model => model.name === 'Document');
  for (const field of ['senderContact', 'notifySender', 'senderNotificationConsent', 'senderNotificationChannels']) {
    assert.ok(document.attributes[field], field);
  }
  await models.syncModels();
  assert.equal(syncCalls, 1);
  assert.equal(queries.some(sql => /sender_notifications|drop\s+table/i.test(sql)), false);
});
