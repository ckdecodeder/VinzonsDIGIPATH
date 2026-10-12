const test = require('node:test');
const assert = require('node:assert/strict');
const { getScopedDocumentQuery } = require('../utils/documentScope');

test('office visibility includes originated and previously sent documents', () => {
  const query = getScopedDocumentQuery({ user: { role: 'Office', officeId: 'OFF-008' } });
  const clauses = query.$or;

  assert(clauses.some((clause) => clause.originOfficeId === 'OFF-008'));
  assert(clauses.some((clause) => clause['sendHistory.fromOfficeId'] === 'OFF-008'));
});

test('receptionist document visibility is limited to incoming documents', () => {
  const query = getScopedDocumentQuery({ user: { role: 'Receptionist', officeId: 'OFF-001' } });

  assert.deepEqual(query.$and[0], { documentDirection: 'Incoming' });
  assert(query.$and[1].$or.some((clause) => clause.currentOfficeId === 'OFF-001'));
});
