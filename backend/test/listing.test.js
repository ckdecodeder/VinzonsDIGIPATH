const test = require('node:test');
const assert = require('node:assert/strict');
const { ModelWrapper } = require('../models/ModelWrapper');
const { parsePagination } = require('../utils/listing');

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
