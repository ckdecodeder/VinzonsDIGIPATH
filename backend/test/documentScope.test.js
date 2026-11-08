const test = require('node:test');
const assert = require('node:assert/strict');
const { getScopedDocumentQuery, getScopedTransmissionQuery } = require('../utils/documentScope');

test('office visibility includes originated and previously sent documents', () => {
  const query = getScopedDocumentQuery({ user: { role: 'Office', officeId: 'OFF-008' } });
  const clauses = query.$or;

  assert(clauses.some((clause) => clause.originOfficeId === 'OFF-008'));
  assert(clauses.some((clause) => clause['sendHistory.fromOfficeId'] === 'OFF-008'));
  assert(clauses.some((clause) => clause['sendHistory.recipientOfficeId'] === 'OFF-008'));
});

test('receptionist document visibility is limited to incoming documents', () => {
  const query = getScopedDocumentQuery({ user: { role: 'Receptionist', officeId: 'OFF-001' } });

  assert.deepEqual(query.$and[0], { documentDirection: 'Incoming' });
  assert(query.$and[1].$or.some((clause) => clause.currentOfficeId === 'OFF-001'));
  assert(query.$and[1].$or.some((clause) => clause.intakeOfficeId === 'OFF-001'));
});

test('historical receptionist tracking is scoped to the original intake office', () => {
  const query = getScopedDocumentQuery({ user: { role: 'Receptionist', officeId: 'OFF-001' } });
  const clauses = query.$and[1].$or;

  assert(clauses.some((clause) => clause.intakeOfficeId === 'OFF-001'));

  const otherOfficeQuery = getScopedDocumentQuery({ user: { role: 'Receptionist', officeId: 'OFF-009' } });
  assert(otherOfficeQuery.$and[1].$or.some((clause) => clause.intakeOfficeId === 'OFF-009'));
});

test('completed outbound transmissions are visible for Office tracking only', () => {
  const officeId = 'OFF-008';
  const office = { user: { role: 'Office', officeId } };
  const receptionist = { user: { role: 'Receptionist', officeId } };
  const pendingScope = {
    $or: [{ toOfficeId: officeId }, { fromOfficeId: officeId, receivedBy: { $in: [null, ''] } }],
  };

  assert.deepEqual(getScopedTransmissionQuery(office), {
    $or: [{ toOfficeId: officeId }, { fromOfficeId: officeId }],
  });
  assert.deepEqual(getScopedTransmissionQuery(office, { forUpdate: true }), pendingScope);
  assert.deepEqual(getScopedTransmissionQuery(receptionist), pendingScope);
  assert.deepEqual(getScopedTransmissionQuery({ user: { role: 'Office' } }), { id: '__no_office__' });
});
