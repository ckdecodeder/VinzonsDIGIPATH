const test = require('node:test');
const assert = require('node:assert/strict');
const { ModelWrapper } = require('../models/ModelWrapper');
const { parsePagination } = require('../utils/listing');
const { Op, Sequelize, DataTypes } = require('sequelize');
const { getScopedDocumentQuery, getScopedDocumentReadQuery } = require('../utils/documentScope');

test('office history filters produce constrained JSON SQL instead of an empty visibility clause', async () => {
  let where;
  const model = new ModelWrapper({ tableName: 'documents', findAll: async (options) => { where = options.where; return []; } });
  await model.find(getScopedDocumentQuery({ user: { role: 'Office', officeId: "OFF-'SECOND" } })).lean();
  for (const clause of where[Op.or]) assert(Reflect.ownKeys(clause).length > 0, 'No office visibility clause may match every document');
  const sql = where[Op.or].flatMap((clause) => clause[Op.and] || []).map((literal) => literal.val).join(' ');
  assert.match(sql, /sendHistory/);
  assert.match(sql, /recipientOfficeId/);
  assert.match(sql, /OFF-''SECOND/);
});

test('legacy document tracking uses only the Office sender in the same schema', async () => {
  const db = new Sequelize({ dialect: 'postgres', logging: false });
  try {
    const model = db.define('FixtureDocument', { id: { type: DataTypes.TEXT, primaryKey: true } }, {
      tableName: 'documents', schema: 'workflow-test',
    });
    const wrapper = new ModelWrapper(model);
    const office = { user: { role: 'Office', officeId: "OFF-'SENDER" } };
    const sql = (query) => db.getQueryInterface().queryGenerator.selectQuery(
      model.getTableName(), { where: wrapper._buildWhere(query) }, model,
    );
    assert.match(sql(getScopedDocumentReadQuery(office, model)),
      /"id" IN \(SELECT "documentId" FROM "workflow-test"\."transmissions" WHERE "fromOfficeId" = 'OFF-''SENDER'\)/);
    assert.doesNotMatch(sql(getScopedDocumentQuery(office)), /FROM .*"transmissions"/);
    const receptionist = { user: { ...office.user, role: 'Receptionist' } };
    assert.doesNotMatch(sql(getScopedDocumentReadQuery(receptionist, model)), /FROM .*"transmissions"/);
  } finally {
    await db.close();
  }
});

test('positive and negative projections reach SQL and retain password exclusion', async () => {
  const calls = [];
  const model = new ModelWrapper({ tableName: 'documents', findAll: async (options) => { calls.push(options); return []; } });
  await model.find({}).select('id').skip(20).limit(10).lean();
  assert.deepEqual(calls[0].attributes, ['id']);
  assert.equal(calls[0].offset, 20);
  await model.find({}).select('-timeline -scannedFiles').lean();
  assert.deepEqual(calls[1].attributes.exclude, ['timeline', 'scannedFiles']);
  const users = new ModelWrapper({ tableName: 'users', findAll: async (options) => { calls.push(options); return []; } });
  await users.find({}).select('id password').lean();
  assert.deepEqual(calls[2].attributes, ['id']);
  await users.find({}).select('+password').lean();
  assert.equal(calls[3].attributes, undefined);
});
test('pagination defaults and maximum bounds reject malformed or unbounded requests', () => {
  assert.deepEqual(parsePagination({ page: '2', limit: '20' }), { page: 2, limit: 20, offset: 20 });
  for (const query of [{ limit: '101' }, { limit: '-1' }, { page: 'NaN' }, { page: '1.5' }]) {
    assert.throws(() => parsePagination(query), { status: 400 });
  }
});
