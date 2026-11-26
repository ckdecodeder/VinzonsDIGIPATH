import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

test('opening a dashboard record resets filters and focuses the requested document directly', () => {
  const state = { filter: 'Urgent active', focus: '', key: 2, page: 'dashboard' };
  const context = {
    setDocumentStatusFocus: value => { state.filter = value; },
    setDocumentFocusId: value => { state.focus = value; },
    setFocusedDelivery: () => {},
    notificationRequest: { current: 0 },
    setDocumentFocusKey: update => { state.key = update(state.key); },
    setCurrentPage: value => { state.page = value; },
  };
  vm.runInNewContext(source.slice(source.indexOf('  const handleOpenDocument ='), source.indexOf('  const handleOpenDocumentsByStatus =')) + '\nhandleOpenDocument("DOC-1");', context);
  assert.deepEqual(state, { filter: 'All', focus: 'DOC-1', key: 3, page: 'documents' });
});

function sendHarness(send) {
  const state = { upserts: [], refreshes: 0, toasts: [], genericErrors: [], saveError: 'old' };
  const context = vm.createContext({
    currentUser: { id: 'USER' },
    activeUserRef: { current: 'USER' },
    documentService: { send },
    runMutation: async operation => {
      try { return await operation(); }
      catch (error) { state.genericErrors.push(error); throw error; }
    },
    setSaveError: value => { state.saveError = value; },
    upsertDocument: value => state.upserts.push(value),
    showActionToast: (...args) => state.toasts.push(args),
    refreshAfterMutation: () => { state.refreshes++; },
  });
  vm.runInContext(source.slice(source.indexOf('  const handleSendReconciled ='), source.indexOf('  const handleReturnToSender =')) + '\nglobalThis.sendDocument = handleSendDocument;', context);
  return { state, context, send: context.sendDocument };
}

test('an unconfirmed send preserves the original error for inline recovery and refreshes safe reads', async () => {
  const error = Object.assign(new Error('Deadline exceeded'), { code: 'TIMEOUT' });
  const app = sendHarness(async () => { throw error; });
  await assert.rejects(app.send('DOC-1', ['CUSTODY', 'COPY']), actual => actual === error);
  assert.equal(app.state.saveError, '');
  assert.deepEqual(app.state.genericErrors, []);
  assert.deepEqual(app.state.upserts, []);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 1);
});

test('a send only updates the collection and confirms success after the saved result', async () => {
  let finish;
  const app = sendHarness(() => new Promise(resolve => { finish = resolve; }));
  const pending = app.send('DOC-1', ['CUSTODY', 'COPY']);
  assert.deepEqual(app.state.upserts, []);
  assert.deepEqual(app.state.toasts, []);
  const saved = { id: 'DOC-1', status: 'In Transit' };
  finish(saved);
  assert.equal(await pending, saved);
  assert.deepEqual(app.state.upserts, [saved]);
  assert.equal(app.state.toasts.length, 1);
  assert.equal(app.state.refreshes, 1);
});

test('a late send response cannot update a different signed-in session', async () => {
  let finish;
  const app = sendHarness(() => new Promise(resolve => { finish = resolve; }));
  const pending = app.send('DOC-1', ['CUSTODY']);
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  finish({ id: 'DOC-1' });
  await pending;
  assert.deepEqual(app.state.upserts, []);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 0);
});

test('a late send failure cannot refresh a different signed-in session', async () => {
  let fail;
  const app = sendHarness(() => new Promise((resolve, reject) => { fail = reject; }));
  const pending = app.send('DOC-1', ['CUSTODY']);
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  fail(new Error('Old session timed out'));
  await assert.rejects(pending, /Old session timed out/);
  assert.equal(app.state.refreshes, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

function scannerSaveHarness({ update = async () => ({}), createScan = async () => ({}), createTransmission = async () => ({}) } = {}) {
  const state = { documents: [], transmissions: [], toasts: [], errors: [], refreshes: 0, transmissionCalls: 0, saveError: '' };
  const context = vm.createContext({
    currentUser: { id: 'USER', officeId: 'SOURCE' }, activeUserRef: { current: 'USER' },
    documentService: { update }, scannerService: { createDocument: createScan },
    transmissionService: { create: request => { state.transmissionCalls++; return createTransmission(request); } },
    upsertDocument: saved => state.documents.push(saved),
    upsertTransmission: saved => state.transmissions.push(saved),
    showActionToast: (...args) => state.toasts.push(args),
    refreshAfterMutation: () => { state.refreshes++; },
    setSaveError: value => { state.saveError = value; }, notifyUser: error => state.errors.push(error),
    getUserOfficeId: () => 'SOURCE',
  });
  vm.runInContext(
    source.slice(source.indexOf('  const runMutation ='), source.indexOf('  const closeDialog ='))
    + source.slice(source.indexOf('  const handleEditDocument ='), source.indexOf('  const handleDeleteDocument ='))
    + source.slice(source.indexOf('  const handleScanCapture ='), source.indexOf('  const handleAddUser ='))
    + '\nglobalThis.saves = { edit: handleEditDocument, scan: handleScanCapture, mutate: runMutation };', context,
  );
  return { state, context, ...context.saves };
}

test('late scan persistence cannot upsert records or confirm success in a different session', async () => {
  const save = deferred();
  const app = scannerSaveHarness({ createScan: () => save.promise });
  const pending = app.scan(null, 'Synthetic text', { subject: 'Synthetic scan' });
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  const saved = { document: { id: 'SCAN' }, transmission: { id: 'DELIVERY' } };
  save.resolve(saved);
  assert.equal(await pending, saved);
  assert.deepEqual(app.state.documents, []);
  assert.deepEqual(app.state.transmissions, []);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 0);
});

test('stale scanner callbacks cannot begin requests using a replacement session', async () => {
  let edits = 0, scans = 0;
  const app = scannerSaveHarness({
    update: async () => { edits++; return { id: 'SCAN' }; },
    createScan: async () => { scans++; return { document: { id: 'SCAN' } }; },
  });
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  assert.equal(await app.scan(null, 'Old-session text', { subject: 'Old-session scan' }), null);
  assert.equal(await app.edit({ id: 'SCAN' }, { toOfficeIds: ['DEST'] }), null);
  assert.equal(scans, 0);
  assert.equal(edits, 0);
  assert.equal(app.state.transmissionCalls, 0);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 0);
});

test('a session switch during scan finalization prevents a follow-up transmission under the new user', async () => {
  const save = deferred();
  const app = scannerSaveHarness({ update: () => save.promise });
  const pending = app.edit({ id: 'SCAN' }, { toOfficeIds: ['DEST'] });
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  const saved = { id: 'SCAN' };
  save.resolve(saved);
  assert.equal(await pending, saved);
  assert.equal(app.state.transmissionCalls, 0);
  assert.deepEqual(app.state.documents, []);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 0);
});

test('a late initial transmission cannot update the replacement session', async () => {
  const transmission = deferred(), started = deferred();
  const saved = { id: 'SCAN' };
  const app = scannerSaveHarness({ update: async () => saved, createTransmission: () => { started.resolve(); return transmission.promise; } });
  const pending = app.edit(saved, { toOfficeIds: ['DEST'] });
  await started.promise;
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  transmission.resolve({ id: 'DELIVERY' });
  assert.equal(await pending, saved);
  assert.equal(app.state.transmissionCalls, 1);
  assert.deepEqual(app.state.transmissions, []);
  assert.deepEqual(app.state.toasts, []);
  assert.equal(app.state.refreshes, 0);
});

test('same-session scan finalization retains its saved result, delivery and success feedback', async () => {
  const saved = { id: 'SCAN' }, transmission = { id: 'DELIVERY' };
  const app = scannerSaveHarness({ update: async () => saved, createTransmission: async () => transmission });
  assert.equal(await app.edit(saved, { toOfficeIds: ['DEST'] }), saved);
  assert.deepEqual(app.state.documents, [saved]);
  assert.deepEqual(app.state.transmissions, [transmission]);
  assert.equal(app.state.toasts.length, 1);
  assert.equal(app.state.refreshes, 1);
});

test('mutation failures are rethrown without displaying an error to a replacement session', async () => {
  const save = deferred(), error = new Error('Old-session failure');
  const app = scannerSaveHarness();
  const pending = app.mutate(() => save.promise);
  app.context.activeUserRef.current = 'DIFFERENT-USER';
  app.state.saveError = 'New-session state';
  save.reject(error);
  await assert.rejects(pending, actual => actual === error);
  assert.equal(app.state.saveError, 'New-session state');
  assert.deepEqual(app.state.errors, []);
});

test('same-session mutation failures still display the original error and reject', async () => {
  const app = scannerSaveHarness(), error = new Error('Current-session failure');
  await assert.rejects(app.mutate(async () => { throw error; }), actual => actual === error);
  assert.equal(app.state.saveError, error.message);
  assert.equal(app.state.errors[0].message, error.message);
});
