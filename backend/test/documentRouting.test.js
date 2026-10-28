const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInitialOfficeRoute,
  normalizePriorityLevel,
  getStatusAfterSend,
  canSendDocument,
  buildResubmissionUpdates,
  buildSendTransition,
  buildReceiveTransition,
  canArchiveDocument,
} = require('../utils/documentRouting');

test('an approval document keeps source custody while planning a Mayor review route', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorApproval: true, sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.currentOfficeId, 'OFF-008');
  assert.equal(route.status, 'For Signing');
  assert.deepEqual(route.routePlan, ['OFF-008', 'OFF-001', 'OFF-003']);
  assert.equal(route.firstDestinationOfficeId, 'OFF-001');
  assert.deepEqual(route.sendHistory, []);
});

test('a direct office route records its destination without transferring custody early', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorApproval: false, sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.currentOfficeId, 'OFF-008');
  assert.equal(route.status, 'Received');
  assert.equal(route.firstDestinationOfficeId, 'OFF-003');
  assert.deepEqual(route.sendHistory, []);
});

test('initial Mayor reception is a separate route decision from Mayor approval', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorReception: true, requiresMayorApproval: false,
    sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.firstDestinationOfficeId, 'OFF-001');
  assert.equal(route.status, 'Received');
  assert.equal(route.intakeOfficeId, 'OFF-001');
});

test('Mayor approval still routes through the Mayor even when initial reception is not requested', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorReception: false, requiresMayorApproval: true,
    sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.firstDestinationOfficeId, 'OFF-001');
  assert.equal(route.status, 'For Signing');
  assert.equal(route.intakeOfficeId, 'OFF-008');
});

test('initial reception and Mayor approval combine as separate workflow decisions', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorReception: true, requiresMayorApproval: true,
    sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.firstDestinationOfficeId, 'OFF-001');
  assert.equal(route.intakeOfficeId, 'OFF-001');
  assert.equal(route.status, 'For Signing');
  assert.deepEqual(route.routePlan, ['OFF-008', 'OFF-001', 'OFF-003']);
});

test('priority values are preserved when valid and default to normal otherwise', () => {
  assert.equal(normalizePriorityLevel(' UrGent '), 'urgent');
  assert.equal(normalizePriorityLevel('invalid'), 'normal');
});

test('sending a completed document preserves its signed or acknowledged status', () => {
  assert.equal(getStatusAfterSend('Signed'), 'Signed');
  assert.equal(getStatusAfterSend('Acknowledged'), 'Acknowledged');
  assert.equal(getStatusAfterSend('For Signing'), 'Received');
});

test('test_send_gate_blocks_required_unapproved_document', () => {
  assert.equal(canSendDocument({ requiresMayorApproval: true, mayorApprovalCleared: false }), false);
});

test('test_send_gate_allows_type_without_mayor_approval', () => {
  assert.equal(canSendDocument({ requiresMayorApproval: false, mayorApprovalCleared: false }), true);
});

test('test_resubmission_resets_mayor_approval', () => {
  assert.deepEqual(buildResubmissionUpdates(), {
    intakeStatus: 'Pending Review',
    verifiedBy: '',
    verifiedAt: '',
    rejectionReason: '',
    mayorApprovalCleared: false,
  });
});

test('sending to multiple offices creates every delivery and keeps custody until confirmed', () => {
  const transition = buildSendTransition({
    document: {
      id: 'DOC-001', status: 'Signed', currentOfficeId: 'OFF-003', routePlan: ['OFF-003'],
      routeStep: 0, sendHistory: [], sendQueue: [],
    },
    toOfficeIds: ['OFF-004', 'OFF-005'], sentBy: 'USR-003', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(transition.documentUpdates.status, 'In Transit');
  assert.equal(transition.documentUpdates.preTransitStatus, 'Signed');
  assert.equal(transition.documentUpdates.currentOfficeId, 'OFF-003');
  assert.equal(transition.documentUpdates.destinationOfficeId, 'OFF-004');
  assert.deepEqual(transition.documentUpdates.sendQueue, []);
  assert.deepEqual(transition.transmissions.map((item) => item.toOfficeId), ['OFF-004', 'OFF-005']);
  assert.equal(new Set(transition.transmissions.map((item) => item.id)).size, 2);
  assert.deepEqual(transition.documentUpdates.sendHistory.map((event) => event.recipientOfficeId), ['OFF-004', 'OFF-005']);
  assert.equal(transition.transmission.fromOfficeId, 'OFF-003');
  assert.equal(transition.transmission.toOfficeId, 'OFF-004');
  assert.equal(transition.transmission.sentBy, 'USR-003');
  assert.equal(transition.transmission.receivedBy, null);
});

test('all recipients can confirm in either order without moving primary custody to a copy office', () => {
  for (const order of [['OFF-004', 'OFF-005'], ['OFF-005', 'OFF-004']]) {
    const initial = { id: 'DOC-001', status: 'Signed', currentOfficeId: 'OFF-003', sendHistory: [] };
    const sent = buildSendTransition({ document: initial, toOfficeIds: ['OFF-004', 'OFF-005'], sentBy: 'SENDER', sentAt: '2026-10-29T00:00:00Z' });
    let doc = { ...initial, ...sent.documentUpdates };
    for (const officeId of order) {
      const transmissionId = sent.transmissions.find((item) => item.toOfficeId === officeId).id;
      doc = { ...doc, ...buildReceiveTransition({ document: doc, toOfficeId: officeId, transmissionId, receivedBy: officeId, receivedAt: '2026-10-29T00:05:00Z' }) };
      assert.equal(doc.sendHistory.find((event) => event.toOfficeId === officeId).active, false);
    }
    assert.equal(doc.currentOfficeId, 'OFF-004');
    assert.equal(doc.status, 'Signed');
    assert(doc.sendHistory.every((event) => event.receivedBy && !event.active));
  }
});

test('new delivery deduplicates recipients, clears old copy visibility, and retires legacy queues', () => {
  const sent = buildSendTransition({
    document: { id: 'DOC-001', status: 'Received', currentOfficeId: 'OFF-003', sendQueue: ['OFF-009'], sendHistory: [{ id: 'OLD', recipientOfficeId: 'OFF-008', receivedBy: 'USER' }] },
    toOfficeIds: ['OFF-004', 'OFF-004', '', 'OFF-003', 'OFF-005'], sentBy: 'SENDER', sentAt: '2026-10-29T00:00:00Z',
  });
  assert.deepEqual(sent.transmissions.map((item) => item.toOfficeId), ['OFF-004', 'OFF-005']);
  assert.equal(sent.documentUpdates.sendHistory[0].recipientOfficeId, '');
  assert.equal(sent.documentUpdates.sendHistory[0].receivedBy, 'USER');
  assert.deepEqual(sent.documentUpdates.sendQueue, []);
});

test('test_receive_transition_moves_custody_only_after_destination_receipt', () => {
  const updates = buildReceiveTransition({
    document: {
      status: 'In Transit', preTransitStatus: 'Signed', currentOfficeId: 'OFF-003',
      destinationOfficeId: 'OFF-004', routePlan: ['OFF-003', 'OFF-004', 'OFF-005'],
      routeStep: 0, sendHistory: [{ id: 'TRN-001', toOfficeId: 'OFF-004', active: true }],
    },
    toOfficeId: 'OFF-004', transmissionId: 'TRN-001', receivedBy: 'USR-004',
    receivedAt: '2026-10-12T00:05:00.000Z',
  });

  assert.equal(updates.status, 'Signed');
  assert.equal(updates.preTransitStatus, '');
  assert.equal(updates.currentOfficeId, 'OFF-004');
  assert.equal(updates.destinationOfficeId, 'OFF-004');
  assert.equal(updates.routeStep, 1);
  assert.equal(updates.sendHistory[0].active, false);
  assert.equal(updates.sendHistory[0].receivedBy, 'USR-004');
  assert.equal(updates.sendHistory[0].receivedAt, '2026-10-12T00:05:00.000Z');
});

test('archiving is blocked while a handoff or queued office remains incomplete', () => {
  assert.equal(canArchiveDocument({ status: 'Signed', hasPendingTransmission: true, sendQueue: [] }), false);
  assert.equal(canArchiveDocument({ status: 'Acknowledged', hasPendingTransmission: false, sendQueue: ['OFF-005'] }), false);
});

test('a completed document without unfinished routes remains eligible for archive', () => {
  assert.equal(canArchiveDocument({ status: 'Acknowledged', hasPendingTransmission: false, sendQueue: [] }), true);
});
