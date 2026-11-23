import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissalKey, pendingOfficeReceipt, readDismissals, resolveNotificationTarget } from './notificationTarget.js';
import { getDocumentHandoff } from './documentHandoff.js';
import { saveWorkflowAction } from './workflowAction.js';
import { createSubmissionGate } from './submissionGate.js';

const user = { id: 'clerk', role: 'Office', officeId: 'records' };
const delivery = { id: 'delivery', documentId: 'doc', fromOfficeId: 'reception', toOfficeId: 'records' };
const doc = { id: 'doc', status: 'In Transit', currentOfficeId: 'reception', destinationOfficeId: 'records' };
const alert = { referenceType: 'transmission', referenceId: 'delivery', page: 'transmissions' };

test('receipt alerts resolve the fresh, scoped delivery and document before navigation', async () => {
  for (const role of ['Office', 'Receptionist', 'Admin', 'Mayor']) {
    const calls = [];
    const target = await resolveNotificationTarget(alert, { ...user, role }, undefined,
      async id => { calls.push(id); return delivery; }, async id => { calls.push(id); return doc; });
    assert.deepEqual(calls, ['delivery', 'doc']);
    assert.deepEqual(target, { delivery, document: doc });
  }
  for (const [actor, readDelivery, readDocument] of [
    [user, async () => null, assert.fail],
    [{ ...user, officeId: 'elsewhere' }, async () => delivery, assert.fail],
    [user, async () => delivery, async () => ({ ...doc, destinationOfficeId: 'elsewhere' })],
    [user, async () => delivery, async () => { throw new Error('temporarily unavailable'); }],
  ]) await assert.rejects(resolveNotificationTarget(alert, actor, [], readDelivery, readDocument));
});

test('receiving never substitutes a different delivery when an alert is already received or targets another office', () => {
  const done = { ...delivery, receivedBy: 'other-clerk' };
  const copy = { ...delivery, id: 'copy' };
  assert.equal(pendingOfficeReceipt(doc, [done, copy], user.officeId, done), undefined);
  assert.equal(pendingOfficeReceipt(doc, [done, copy], user.officeId, copy), copy);
  assert.equal(pendingOfficeReceipt(doc, [done, copy], 'elsewhere', copy), undefined);
  assert.equal(pendingOfficeReceipt(doc, [done, copy], user.officeId), copy);
});

test('dismissals are private to the account and malformed or legacy storage is ignored', () => {
  const entries = new Map([['dp_dismissedNotifications', '["pending-shared"]'], [dismissalKey('a'), '["a1"]']]);
  const storage = { getItem: key => entries.get(key) };
  assert.deepEqual(readDismissals(storage, 'a'), ['a1']);
  assert.deepEqual(readDismissals(storage, 'b'), []);
  entries.set(dismissalKey('a'), '{');
  assert.deepEqual(readDismissals(storage, 'a'), []);
});

test('custody follows the recorded holder through direct, approval and partial-copy workflows', () => {
  const handoff = (document, transmissions = [], officeId = 'copy-a') => getDocumentHandoff(document, transmissions, officeId, id => id);
  assert.equal(handoff({ status: 'Received', currentOfficeId: 'records' }).heading, 'Held by records');
  assert.equal(handoff({ status: 'For Signing', currentOfficeId: 'mayor' }).holder, 'mayor');
  assert.equal(handoff({ status: 'Received' }).holder, 'Unrecorded');
  const history = [
    { recipientOfficeId: 'records', primary: true, active: true },
    { recipientOfficeId: 'copy-a', primary: false, receivedBy: 'clerk' },
    { recipientOfficeId: 'copy-b', primary: false, active: true },
  ];
  const result = handoff({ ...doc, sendHistory: history }, [delivery]);
  assert.deepEqual(result.waiting, ['records', 'copy-b']);
  assert.equal(result.holder, 'reception');
  assert.equal(result.custodyRecipient, 'records');
  assert.deepEqual(result.copies.map(entry => entry.recipientOfficeId), ['copy-a', 'copy-b']);
  assert.equal(result.note, 'Your office has received its copy.');
  assert.equal(handoff(doc, [delivery], 'records').ownReceipt, true);
});

const attempt = { operationId: 'abc1234567890123', documentId: doc.id, action: 'action_note', userId: user.id, note: '  Exact draft\n' };
const confirmed = { ...doc, timeline: [{ ...attempt }] };
test('a slow workflow action keeps one request in flight and completes only when the server responds', async () => {
  let finish, saves = 0;
  const busy = [];
  const gate = createSubmissionGate(value => busy.push(value));
  const submit = () => gate(() => saveWorkflowAction(attempt, {
    save: async draft => { saves++; assert.equal(draft.note, '  Exact draft\n'); return new Promise(resolve => { finish = resolve; }); },
    read: assert.fail,
  }));
  const pending = submit();
  await submit();
  assert.deepEqual(busy, [true]);
  assert.equal(saves, 1);
  finish(confirmed);
  assert.equal((await pending).document, confirmed);
  assert.deepEqual(busy, [true, false]);
});

test('each workflow form reconciles a lost reply against its exact actor, operation and action', async () => {
  for (const action of ['action_note', 'sign_document', 'acknowledge_document', 'document_rejected']) {
    const active = { ...attempt, action };
    const lost = async () => { throw new Error('lost acknowledgement'); };
    const response = await saveWorkflowAction(active, { save: lost, read: async () => ({ ...doc, timeline: [active] }) });
    assert.equal(response.state, 'saved');
    const unknown = await saveWorkflowAction(active, { save: lost, read: lost });
    assert.equal(unknown.state, 'check');
    const otherEvents = [{ ...active, action: 'another-action' }, { ...active, operationId: 'another-id' }, { ...active, userId: 'another-clerk' }];
    assert.equal((await saveWorkflowAction(active, { checkOnly: true, save: assert.fail,
      read: async () => ({ ...doc, timeline: otherEvents }) })).state, 'retry');
    await assert.rejects(saveWorkflowAction(active, { save: async () => { throw Object.assign(new Error('denied'), { status: 403 }); },
      read: assert.fail }), /denied/);
  }
});
