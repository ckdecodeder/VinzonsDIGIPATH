const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInitialOfficeRoute, normalizePriorityLevel, getStatusAfterSend } = require('../utils/documentRouting');

test('an approval document is routed to Mayor while preserving its requested destination', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorApproval: true, sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.currentOfficeId, 'OFF-001');
  assert.equal(route.status, 'For Signing');
  assert.deepEqual(route.routePlan, ['OFF-008', 'OFF-001', 'OFF-003']);
  assert.equal(route.sendHistory[0].fromOfficeId, 'OFF-008');
  assert.equal(route.sendHistory[0].toOfficeId, 'OFF-001');
});

test('a direct office route is created at the destination in one operation', () => {
  const route = buildInitialOfficeRoute({
    originOfficeId: 'OFF-008', destinationOfficeId: 'OFF-003', mayorsOfficeId: 'OFF-001',
    requiresMayorApproval: false, sentBy: 'USR-008', sentAt: '2026-10-12T00:00:00.000Z',
  });

  assert.equal(route.currentOfficeId, 'OFF-003');
  assert.equal(route.status, 'Received');
  assert.equal(route.sendHistory[0].toOfficeId, 'OFF-003');
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
