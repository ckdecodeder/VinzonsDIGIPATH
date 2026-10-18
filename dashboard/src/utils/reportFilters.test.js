import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterActivityLogs,
  filterDocuments,
  filterOfficeStats,
  filterTransmissions,
} from './reportFilters.js';

test('activity filters combine action, user, reference, search, and inclusive date range', () => {
  const logs = [
    {
      id: 'log-1',
      action: 'document_received',
      userId: 'user-1',
      referenceId: 'DOC-1042',
      details: 'Received invoice packet',
      timestamp: '2026-04-02T23:59:00.000Z',
    },
    {
      id: 'log-2',
      action: 'document_received',
      userId: 'user-2',
      referenceId: 'DOC-1042',
      details: 'Received invoice packet',
      timestamp: '2026-04-02T10:00:00.000Z',
    },
    {
      id: 'log-3',
      action: 'document_approved',
      userId: 'user-1',
      referenceId: 'DOC-1042',
      details: 'Approved invoice packet',
      timestamp: '2026-04-02T09:00:00.000Z',
    },
    {
      id: 'log-4',
      action: 'document_received',
      userId: 'user-1',
      referenceId: 'DOC-1042',
      details: 'Received invoice packet',
      timestamp: '2026-04-03T00:00:00.000Z',
    },
  ];

  const result = filterActivityLogs(logs, {
    action: 'document_received',
    userId: 'user-1',
    reference: 'doc-104',
    search: 'invoice',
    dateFrom: '2026-04-02',
    dateTo: '2026-04-02',
    users: [{ id: 'user-1', fname: 'Ava', lname: 'Santos' }],
  });

  assert.deepEqual(result.map((log) => log.id), ['log-1']);
});

test('activity search also matches the user name and action label', () => {
  const logs = [
    { id: 'log-user', action: 'user_login', userId: 'user-1', details: 'Signed in', timestamp: '2026-04-02' },
    { id: 'log-action', action: 'document_received', userId: 'user-2', details: 'New item', timestamp: '2026-04-02' },
    { id: 'log-friendly-action', action: 'ready_for_signing', userId: 'user-2', details: 'Marked for approval', timestamp: '2026-04-02' },
  ];
  const users = [{ id: 'user-1', fname: 'Ava', lname: 'Santos' }];

  assert.deepEqual(filterActivityLogs(logs, { search: 'ava santos', users }).map((log) => log.id), ['log-user']);
  assert.deepEqual(filterActivityLogs(logs, { search: 'document received' }).map((log) => log.id), ['log-action']);
  assert.deepEqual(filterActivityLogs(logs, {
    search: 'marked for signing',
    actionLabels: { ready_for_signing: 'Marked For Signing' },
  }).map((log) => log.id), ['log-friendly-action']);
});

test('document report filters use status, type, priority, direction, office, and date fields together', () => {
  const documents = [
    {
      id: 'doc-match',
      status: 'For Signature',
      documentTypeId: 'DT-7',
      priorityLevel: 'urgent',
      documentDirection: 'Incoming',
      originOfficeId: 'OFF-2',
      currentOfficeId: 'OFF-9',
      dateReceived: '2026-04-02T12:00:00.000Z',
    },
    {
      id: 'doc-wrong-office',
      status: 'For Signature',
      documentTypeId: 'DT-7',
      priorityLevel: 'urgent',
      documentDirection: 'Incoming',
      originOfficeId: 'OFF-5',
      currentOfficeId: 'OFF-9',
      dateReceived: '2026-04-02',
    },
    {
      id: 'doc-wrong-status',
      status: 'Signed',
      documentTypeId: 'DT-7',
      priorityLevel: 'urgent',
      documentDirection: 'Incoming',
      originOfficeId: 'OFF-2',
      currentOfficeId: 'OFF-2',
      dateReceived: '2026-04-02',
    },
  ];

  const result = filterDocuments(documents, {
    status: 'For Signature',
    typeId: 'DT-7',
    priority: 'urgent',
    direction: 'Incoming',
    officeId: 'OFF-2',
    dateFrom: '2026-04-02',
    dateTo: '2026-04-02',
  });

  assert.deepEqual(result.map((document) => document.id), ['doc-match']);
});

test('transmission report filters distinguish pending and completed and match their database dimensions', () => {
  const transmissions = [
    {
      id: 'trans-match',
      transmissionType: 'External',
      fromOfficeId: 'OFF-1',
      toOfficeId: 'OFF-3',
      sentBy: 'user-2',
      receivedBy: 'user-3',
      transmissionDate: '2026-04-02T18:00:00.000Z',
    },
    {
      id: 'trans-pending',
      transmissionType: 'External',
      fromOfficeId: 'OFF-1',
      toOfficeId: 'OFF-3',
      sentBy: 'user-2',
      receivedBy: null,
      transmissionDate: '2026-04-02',
    },
    {
      id: 'trans-wrong-recipient',
      transmissionType: 'External',
      fromOfficeId: 'OFF-1',
      toOfficeId: 'OFF-3',
      sentBy: 'user-2',
      receivedBy: 'user-4',
      transmissionDate: '2026-04-02',
    },
  ];

  const result = filterTransmissions(transmissions, {
    status: 'Completed',
    type: 'External',
    fromOfficeId: 'OFF-1',
    toOfficeId: 'OFF-3',
    sentBy: 'user-2',
    receivedBy: 'user-3',
    dateFrom: '2026-04-02',
    dateTo: '2026-04-02',
  });

  assert.deepEqual(result.map((transmission) => transmission.id), ['trans-match']);
});

test('office report selector returns only the selected office while blank keeps every office', () => {
  const offices = [
    { id: 'OFF-1', total: 8 },
    { id: 'OFF-2', total: 3 },
  ];

  assert.deepEqual(filterOfficeStats(offices, 'OFF-2'), [{ id: 'OFF-2', total: 3 }]);
  assert.deepEqual(filterOfficeStats(offices, ''), offices);
});
