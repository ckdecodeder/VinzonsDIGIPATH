import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getSendRecipients, confirmsDocumentSend, sendDocumentWithRecovery } from './documentSend.js';
import { createSubmissionGate } from './submissionGate.js';

const offices = ['SOURCE', 'COPY', 'CUSTODY'].map(id => ({ id }));
const before = { id: 'DOC', currentOfficeId: 'SOURCE', sendHistory: [{ id: 'OLD' }] };
const destinations = ['CUSTODY', 'COPY'];
const saved = {
  ...before, status: 'In Transit', destinationOfficeId: 'CUSTODY',
  sendHistory: [...before.sendHistory,
    { id: 'NEW-1', deliveryGroupId: 'GROUP', primary: true, fromOfficeId: 'SOURCE', toOfficeId: 'CUSTODY', sentBy: 'USER' },
    { id: 'NEW-2', deliveryGroupId: 'GROUP', primary: false, fromOfficeId: 'SOURCE', toOfficeId: 'COPY', sentBy: 'USER' },
  ],
};

test('custody is explicit, independent of directory and copy-selection order', () => {
  assert.throws(() => getSendRecipients('', ['COPY'], 'SOURCE', offices), /custody office/i);
  assert.throws(() => getSendRecipients('SOURCE', [], 'SOURCE', offices), /current office/i);
  assert.throws(() => getSendRecipients('MISSING', [], 'SOURCE', offices), /available office/i);
  assert.deepEqual(getSendRecipients('CUSTODY', ['COPY', 'CUSTODY', 'COPY'], 'SOURCE', offices), destinations);
  assert.deepEqual(getSendRecipients('CUSTODY', ['COPY'], 'SOURCE', [...offices].reverse()), destinations);
});

test('a definitive rejected send preserves its error and never retries or reads', async () => {
  const rejected = Object.assign(new Error('Approval required'), { code: 'HTTP_ERROR', status: 409 });
  let writes = 0, reads = 0;
  await assert.rejects(sendDocumentWithRecovery({ document: before, destinations, userId: 'USER',
    send: async () => { writes++; throw rejected; }, read: async () => { reads++; },
  }), error => error === rejected);
  assert.equal(writes, 1); assert.equal(reads, 0);
});

test('a lost send response is reconciled using a fresh matching delivery group without replay', async () => {
  let writes = 0, reads = 0;
  const result = await sendDocumentWithRecovery({ document: before, destinations, userId: 'USER',
    send: async () => { writes++; throw Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }); },
    read: async id => { reads++; assert.equal(id, before.id); return saved; },
  });
  assert.equal(result.status, 'sent'); assert.equal(result.document, saved);
  assert.equal(writes, 1); assert.equal(reads, 1);
});

test('unchanged, unreadable, partial and conflicting reads keep the send outcome unknown', async () => {
  for (const current of [before, null, { ...saved, sendHistory: saved.sendHistory.slice(0, 2) },
    { ...saved, sendHistory: saved.sendHistory.map(event => ({ ...event, primary: !event.primary })) }]) {
    let writes = 0;
    const result = await sendDocumentWithRecovery({ document: before, destinations, userId: 'USER',
      send: async () => { writes++; throw Object.assign(new Error('Network lost'), { code: 'NETWORK_ERROR' }); },
      read: async () => { if (current === null) throw new Error('Offline'); return current; },
    });
    assert.equal(result.status, 'unknown'); assert.equal(writes, 1);
  }
});

test('only new matching custody/copy events confirm an uncertain send, including already received deliveries', () => {
  assert.equal(confirmsDocumentSend(before, saved, destinations, 'USER'), true);
  assert.equal(confirmsDocumentSend(saved, saved, destinations, 'USER'), false);
  assert.equal(confirmsDocumentSend(before, saved, destinations, 'OTHER-USER'), false);
  assert.equal(confirmsDocumentSend(before, saved, ['COPY', 'CUSTODY'], 'USER'), false);
  assert.equal(confirmsDocumentSend(before, { ...saved, sendHistory: saved.sendHistory.map(event => ({ ...event, active: false, recipientOfficeId: '', receivedBy: 'RECEIVER' })) }, destinations, 'USER'), true);
});

test('the send gate blocks rapid submissions until a real save completes', async () => {
  let release, writes = 0;
  const deferred = new Promise(resolve => { release = resolve; });
  const gate = createSubmissionGate();
  const work = () => sendDocumentWithRecovery({ document: before, destinations, userId: 'USER',
    send: async () => { writes++; return deferred; }, read: async () => { throw new Error('Not needed'); },
  });
  const first = gate(work);
  await Promise.all([gate(work), gate(work)]);
  assert.equal(writes, 1);
  release(saved);
  assert.deepEqual(await first, { status: 'sent', document: saved });
});

test('missing confirmation is treated as unknown instead of silently closing the form', async () => {
  const result = await sendDocumentWithRecovery({ document: before, destinations, userId: 'USER',
    send: async () => null, read: async () => before,
  });
  assert.equal(result.status, 'unknown');
});

function routeFormHarness(send, read, sendAttempts = new Map()) {
  const source = fs.readFileSync(new URL('../pages/DocumentList.jsx', import.meta.url), 'utf8');
  const state = { routeDoc: null, routeAttempt: null, routeError: '', sendCustodyOfficeId: '', sendCopyOfficeIds: [], isSendingDocument: false, detailDoc: before };
  const reconciled = [];
  const context = vm.createContext({ ...state, module: { exports: {} }, sendAttempts, offices,
    currentUser: { id: 'USER' }, routeFormRef: { current: {} },
    routeSubmitGate: { current: createSubmissionGate(value => { context.isSendingDocument = value; }) },
    sendDocument: send, documentService: { getById: read },
    getSendRecipients, confirmsDocumentSend, sendDocumentWithRecovery,
    focusFormError() {}, onSendReconciled: document => reconciled.push(document),
  });
  for (const name of Object.keys(state)) {
    context[`set${name[0].toUpperCase()}${name.slice(1)}`] = value => { context[name] = typeof value === 'function' ? value(context[name]) : value; };
  }
  vm.runInContext(source.slice(source.indexOf('  const openRouteModal'), source.indexOf('  const handleReceive'))
    + '\nmodule.exports = { openRouteModal, handleRouteSubmit, closeRouteModal, checkRouteSendStatus };', context);
  return { ...context.module.exports, state: context, reconciled, sendAttempts,
    submit: () => context.module.exports.handleRouteSubmit({ preventDefault() {} }),
    choose() { context.sendCustodyOfficeId = 'CUSTODY'; context.sendCopyOfficeIds = ['COPY']; },
  };
}

test('the real send handlers retain choices during a slow or rejected save and close only on confirmation', async () => {
  let writes = 0, settle;
  const form = routeFormHarness(async () => { writes++; return new Promise((resolve, reject) => { settle = { resolve, reject }; }); }, async () => before);
  form.openRouteModal(before);
  assert.equal(form.state.sendCustodyOfficeId, ''); assert.equal(form.state.sendCopyOfficeIds.length, 0);
  form.choose();
  const first = form.submit();
  form.closeRouteModal(); await form.submit();
  assert.equal(form.state.routeDoc, before); assert.equal(form.state.isSendingDocument, true); assert.equal(writes, 1);
  settle.reject(Object.assign(new Error('Approval required'), { code: 'HTTP_ERROR', status: 409 })); await first;
  assert.equal(form.state.routeDoc, before); assert.equal(form.state.sendCustodyOfficeId, 'CUSTODY');
  assert.deepEqual(form.state.sendCopyOfficeIds, ['COPY']); assert.match(form.state.routeError, /Approval required/);
  assert.equal(form.sendAttempts.size, 0); assert.equal(form.state.isSendingDocument, false);
  const retry = form.submit(); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 2); settle.resolve(saved); await retry;
  assert.equal(form.state.routeDoc, null); assert.equal(writes, 2); assert.equal(form.state.detailDoc, saved);
});

test('an unknown send survives close and remount; only a matching read unlocks it', async () => {
  let writes = 0, current = before;
  const send = async () => { writes++; throw Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }); };
  const read = async () => current;
  const first = routeFormHarness(send, read); first.openRouteModal(before); first.choose(); await first.submit();
  assert.equal(first.sendAttempts.size, 1); first.closeRouteModal(); assert.equal(first.state.routeDoc, null);
  const remounted = routeFormHarness(send, read, first.sendAttempts); remounted.openRouteModal(before);
  assert.equal(remounted.state.sendCustodyOfficeId, 'CUSTODY'); assert.deepEqual(remounted.state.sendCopyOfficeIds, ['COPY']);
  await remounted.submit(); await remounted.checkRouteSendStatus();
  assert.equal(writes, 1); assert.equal(remounted.sendAttempts.size, 1); assert.equal(remounted.state.routeDoc, before);
  current = saved; await remounted.checkRouteSendStatus();
  assert.equal(remounted.state.routeDoc, null); assert.equal(remounted.sendAttempts.size, 0); assert.deepEqual(remounted.reconciled, [saved]); assert.equal(remounted.state.detailDoc, saved);
});

test('a late status read cannot remove another session attempt or publish into it', async () => {
  let resolveRead;
  const map = new Map([['DOC', { document: before, destinations, userId: 'USER', status: 'unknown' }]]);
  const form = routeFormHarness(async () => {}, () => new Promise(resolve => { resolveRead = resolve; }), map);
  form.openRouteModal(before); const check = form.checkRouteSendStatus();
  const newer = { document: before, destinations: ['COPY'], userId: 'OTHER-USER', status: 'unknown' };
  map.clear(); map.set('DOC', newer); resolveRead(saved); await check;
  assert.equal(map.get('DOC'), newer); assert.deepEqual(form.reconciled, []);
});

test('the handler takes a fresh history baseline so an old row cannot confirm a past delivery as this send', async () => {
  let reads = 0, writes = 0;
  const form = routeFormHarness(async () => { writes++; throw Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }); }, async () => { reads++; return saved; });
  form.openRouteModal(before); form.choose(); await form.submit();
  assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(form.state.routeAttempt.document, saved);
  assert.equal(form.state.routeDoc, before); assert.equal(form.sendAttempts.size, 1); assert.deepEqual(form.reconciled, []);
});

test('a failed pre-send read never starts a mutation and leaves choices available', async () => {
  let writes = 0;
  const form = routeFormHarness(async () => { writes++; return saved; }, async () => { throw new Error('Offline'); });
  form.openRouteModal(before); form.choose(); await form.submit();
  assert.equal(writes, 0); assert.equal(form.sendAttempts.size, 0); assert.equal(form.state.sendCustodyOfficeId, 'CUSTODY');
  assert.match(form.state.routeError, /No send was attempted/);
});
