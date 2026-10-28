const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

test('database failures return 503 while invalid tokens still return 401', async () => {
  const context = { module: { exports: {} }, process: { env: {} }, require: (name) => name === 'jsonwebtoken' ? jwt : {
    User: { findOne: () => ({ lean: async () => { throw new Error('Database unavailable'); } }) },
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8'), context);
  const { protect, createToken } = context.module.exports;
  const response = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await protect({ headers: { authorization: `Bearer ${createToken({ id: 'TEST' })}` } }, response, () => assert.fail('Must not authenticate'));
  assert.equal(response.code, 503);
  await protect({ headers: { authorization: 'Bearer invalid' } }, response, () => assert.fail('Must not authenticate'));
  assert.equal(response.code, 401);
});
