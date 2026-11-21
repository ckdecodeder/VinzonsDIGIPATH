import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesQueue, matchesReceptionQueue } from './documentQueue.js';

const mayor = { role: 'Mayor', officeId: 'MAYOR' };
const receptionist = { role: 'Receptionist', officeId: 'RECEPTION' };
const office = { role: 'Office', officeId: 'OFFICE' };
const document = (status = 'Received', extra = {}) => ({
  id: 'DOC', status, currentOfficeId: 'MAYOR', intakeStatus: 'Approved',
  documentDirection: 'Incoming', priorityLevel: 'normal', ...extra,
});

test('Mayor approval work remains actionable through received, filing, signed and acknowledged states', () => {
  for (const status of ['Received', 'For Signing', 'For Signature', 'For Filing', 'Signed', 'Acknowledged', 'Acknoweledged']) {
    assert.equal(matchesQueue(document(status), 'Needs your action', mayor), true, status);
  }
});

test('ready-to-archive work is explicit and limited to the existing archive guard', () => {
  const completed = document('Completed', { completedAt: '2026-11-21T01:00:00Z', attachmentCount: 1 });
  assert.equal(matchesQueue(completed, 'Ready to archive', mayor), true);
  assert.equal(matchesQueue(completed, 'Needs your action', mayor), true);
  assert.equal(matchesQueue(completed, 'Ready to archive', receptionist), false);
  assert.equal(matchesQueue({ ...completed, sendHistory: [{ active: true }] }, 'Ready to archive', mayor), false);
  assert.equal(matchesQueue({ ...completed, attachmentCount: 0 }, 'Ready to archive', mayor), false);
});

test('dashboard action chips exclude other custody and terminal or rejected tracking', () => {
  for (const filter of ['Newly received', 'Pending review', 'Urgent active']) {
    assert.equal(matchesQueue(document('Received', { currentOfficeId: 'OTHER', intakeStatus: 'Pending Review', priorityLevel: 'urgent' }), filter, office), false, filter);
    assert.equal(matchesQueue(document('Archived', { intakeStatus: 'Pending Review', priorityLevel: 'urgent' }), filter, mayor), false, filter);
  }
  assert.equal(matchesQueue(document('Received', { intakeStatus: 'Rejected' }), 'Newly received', mayor), false);
  assert.equal(matchesQueue(document('Received', { priorityLevel: 'urgent' }), 'Urgent active', mayor), true);
});

test('global approval send work and Admin corrections stay in action queues outside their own custody', () => {
  const otherOffice = document('Signed', { currentOfficeId: 'OTHER' });
  assert.equal(matchesQueue(otherOffice, 'Needs your action', mayor), true);
  assert.equal(matchesQueue({ ...otherOffice, sendHistory: [{ active: true }] }, 'Needs your action', mayor), false);
  assert.equal(matchesQueue(document('Received', { currentOfficeId: 'OTHER', intakeStatus: 'Rejected' }), 'Needs your action', { role: 'Admin', officeId: 'ADMIN' }), true);
  assert.equal(matchesQueue(document('Received', { currentOfficeId: 'OTHER', intakeStatus: 'Rejected' }), 'Needs your action', mayor), false);
});

test('incoming copy receipt is actionable while an office sender only tracks another office', () => {
  const transit = document('In Transit', { currentOfficeId: 'OTHER', destinationOfficeId: 'OTHER', originOfficeId: 'OFFICE' });
  assert.equal(matchesQueue(transit, 'Needs your action', office), false);
  const deliveries = [{ documentId: 'DOC', toOfficeId: 'OFFICE', receivedBy: null }];
  assert.equal(matchesQueue(transit, 'Needs your action', office, deliveries), true);
  assert.equal(matchesQueue(transit, 'Pending receipt', office, deliveries), true);
  assert.equal(matchesQueue(transit, 'Pending receipt', office, [{ ...deliveries[0], receivedBy: 'STAFF' }]), false);
});

test('Reception received-today drill-down uses Manila calendar dates, including UTC midnight boundaries', () => {
  const options = { now: new Date('2026-11-20T17:00:00Z'), mayorsOfficeId: 'MAYOR' };
  assert.equal(matchesReceptionQueue(document('Received', { dateReceived: '2026-11-21' }), 'Received Today', options), true);
  assert.equal(matchesReceptionQueue(document('Received', { dateReceived: '2026-11-20T16:01:00Z' }), 'Received Today', options), true);
  assert.equal(matchesReceptionQueue(document('Received', { dateReceived: '2026-11-20T15:59:00Z' }), 'Received Today', options), false);
  assert.equal(matchesReceptionQueue(document('Received', { documentDirection: 'Outgoing', dateReceived: '2026-11-21' }), 'Received Today', options), false);
  assert.equal(matchesReceptionQueue(document('Received'), 'Received Today', options), false);
  assert.equal(matchesReceptionQueue(document('Received', { dateReceived: 'invalid' }), 'Received Today', options), false);
});

test('Reception pending tracking excludes completed work and Mayor drill-down keeps only actual handoffs', () => {
  const options = { mayorsOfficeId: 'MAYOR', transmissions: [{ documentId: 'HISTORICAL', toOfficeId: 'MAYOR', receivedBy: 'STAFF' }] };
  assert.equal(matchesReceptionQueue(document('Completed'), 'Pending', options), false);
  assert.equal(matchesReceptionQueue(document('Received'), 'Pending', options), true);
  assert.equal(matchesReceptionQueue(document('Received'), 'Sent to Mayor', options), true);
  assert.equal(matchesReceptionQueue(document('Received', { currentOfficeId: 'RECEPTION', destinationOfficeId: 'OTHER' }), 'Sent to Mayor', options), false);
  assert.equal(matchesReceptionQueue(document('Received', { currentOfficeId: 'RECEPTION', destinationOfficeId: 'MAYOR' }), 'Sent to Mayor', options), false);
  assert.equal(matchesReceptionQueue(document('In Transit', { currentOfficeId: 'RECEPTION', destinationOfficeId: 'MAYOR' }), 'Sent to Mayor', options), true);
  assert.equal(matchesReceptionQueue(document('Received', { currentOfficeId: 'OTHER', id: 'HISTORICAL' }), 'Sent to Mayor', options), true);
});

test('Office and Reception queues offer only available custody work and respect outstanding approvals/handoffs', () => {
  const types = [{ id: 'TYPE', requiresMayorApproval: true }];
  const held = document('Signed', { currentOfficeId: 'OFFICE', documentTypeId: 'TYPE' });
  assert.equal(matchesQueue(held, 'Needs your action', office, [], types), false);
  assert.equal(matchesQueue({ ...held, mayorApprovalCleared: true }, 'Needs your action', office, [], types), true);
  assert.equal(matchesQueue({ ...held, mayorApprovalCleared: true, sendQueue: ['NEXT'] }, 'Needs your action', office, [], types), false);
  assert.equal(matchesQueue({ ...held, currentOfficeId: 'RECEPTION', mayorApprovalCleared: true }, 'Needs your action', receptionist, [], types), true);
  assert.equal(matchesQueue(document('Received', { currentOfficeId: 'RECEPTION', intakeStatus: 'Pending Review' }), 'Needs your action', receptionist), false);
  assert.equal(matchesQueue(document('Received', { currentOfficeId: 'RECEPTION', intakeStatus: 'Rejected' }), 'Needs your action', receptionist), true);
  assert.equal(matchesQueue(document('Received'), 'Needs your action', { role: 'Unknown', officeId: 'MAYOR' }), false);
});
