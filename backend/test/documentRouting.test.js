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

test('test_send_transition_keeps_custody_at_source_and_queues_later_offices', () => {
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
  assert.deepEqual(transition.documentUpdates.sendQueue, ['OFF-005']);
  assert.equal(transition.transmission.fromOfficeId, 'OFF-003');
  assert.equal(transition.transmission.toOfficeId, 'OFF-004');
  assert.equal(transition.transmission.sentBy, 'USR-003');
  assert.equal(transition.transmission.receivedBy, null);
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
