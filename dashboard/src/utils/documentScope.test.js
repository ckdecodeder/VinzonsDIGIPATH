import test from 'node:test';
import assert from 'node:assert/strict';
import { isDocumentVisibleToUser, isTransmissionVisibleToUser } from './documentScope.js';
import { isOfficeReadOnlyTracking } from './documentActionRules.js';
import { buildReceiveTransition, buildSendTransition } from '../../../backend/utils/documentRouting.js';

test('Receptionist can track an incoming document after it is forwarded', () => {
  const doc = { documentDirection: 'Incoming', intakeOfficeId: 'OFF-001', status: 'In Transit', destinationOfficeId: 'OFF-003' };
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Receptionist', officeId: 'OFF-001' }), true);
});

test('Receptionist tracking does not grant visibility to another office', () => {
  const doc = { documentDirection: 'Incoming', intakeOfficeId: 'OFF-001', status: 'Received', currentOfficeId: 'OFF-003' };
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Receptionist', officeId: 'OFF-009' }), false);
  assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'OFF-001' }), false);
});

test('every selected office sees its current copy before and after receipt, while unrelated offices remain excluded', () => {
  const doc = { status: 'In Transit', currentOfficeId: 'SOURCE', destinationOfficeId: 'FIRST', sendHistory: [
    { toOfficeId: 'FIRST', recipientOfficeId: 'FIRST', active: true },
    { toOfficeId: 'SECOND', recipientOfficeId: 'SECOND', active: true },
    { toOfficeId: 'OLD', recipientOfficeId: '', active: false },
  ] };
  for (const status of ['In Transit', 'Received']) {
    doc.status = status;
    assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'FIRST' }), true);
    assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'SECOND' }), true);
    assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'OTHER' }), false);
    assert.equal(isDocumentVisibleToUser(doc, { role: 'Office', officeId: 'OLD' }), false);
  }
});

test('Office senders retain read-only tracking through receipt and onward forwarding', () => {
  const office = (officeId) => ({ role: 'Office', officeId });
  const sendAt = '2026-11-08T01:00:00.000Z';
  const send = (document, toOfficeIds) => buildSendTransition({ document, toOfficeIds, sentAt: sendAt });
  const receive = (document, delivery) => ({ ...document, ...buildReceiveTransition({
    document, transmissionId: delivery.id, toOfficeId: delivery.toOfficeId,
    receivedBy: 'RECEIVER', receivedAt: sendAt,
  }) });
  const original = { id: 'DOCUMENT', status: 'Received', originOfficeId: 'A', currentOfficeId: 'A' };
  const first = send(original, ['B', 'COPY']);
  const inTransit = { ...original, ...first.documentUpdates };
  assert.equal(isDocumentVisibleToUser(inTransit, office('A')), true);
  assert.equal(isOfficeReadOnlyTracking(inTransit, office('A')), true);
  const received = first.transmissions.reduce(receive, inTransit);
  assert.equal(isDocumentVisibleToUser(received, office('A')), true);
  assert.equal(isOfficeReadOnlyTracking(received, office('B')), false);

  const onward = send(received, ['C']);
  const atC = receive({ ...received, ...onward.documentUpdates }, onward.transmission);
  for (const sender of [office('A'), office('B')]) {
    assert.equal(isDocumentVisibleToUser(atC, sender), true);
    assert.equal(isOfficeReadOnlyTracking(atC, sender), true);
  }
  assert.equal(isDocumentVisibleToUser(atC, office('C')), true);
  assert.equal(isDocumentVisibleToUser(atC, office('COPY')), false);
  assert.equal(isDocumentVisibleToUser(atC, office('UNRELATED')), false);
});

test('Office senders can track a legacy delivery with only a transmission record', () => {
  const sender = { role: 'Office', officeId: 'A' };
  const transmission = { documentId: 'LEGACY', fromOfficeId: 'A', toOfficeId: 'B', receivedBy: 'RECEIVER' };
  const doc = { id: 'LEGACY', originOfficeId: 'ORIGIN', currentOfficeId: 'B' };
  assert.equal(isTransmissionVisibleToUser(transmission, sender), true);
  assert.equal(isTransmissionVisibleToUser(transmission, { role: 'Receptionist', officeId: 'A' }), false);
  assert.equal(isTransmissionVisibleToUser(transmission, { role: 'Office', officeId: 'UNRELATED' }), false);
  assert.equal(isDocumentVisibleToUser(doc, sender, { sentDocumentIds: new Set([transmission.documentId]) }), true);
  assert.equal(isOfficeReadOnlyTracking(doc, sender, true), true);
});
