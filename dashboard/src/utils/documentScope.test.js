import test from 'node:test';
import assert from 'node:assert/strict';
import { isDocumentVisibleToUser } from './documentScope.js';

test('Receptionist can track an incoming document after it is forwarded', () => {
  const doc = { documentDirection: 'Incoming', intakeOfficeId: 'OFF-001', status: 'In Transit', destinationOfficeId: 'OFF-003' };
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Receptionist', officeId: 'OFF-001' }), true);
});

test('Receptionist tracking does not grant visibility to another office', () => {
  const doc = { documentDirection: 'Incoming', intakeOfficeId: 'OFF-001', status: 'Received', currentOfficeId: 'OFF-003' };
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Receptionist', officeId: 'OFF-009' }), false);
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'OFF-001' }), false);
});
