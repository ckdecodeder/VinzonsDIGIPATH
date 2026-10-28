import test from 'node:test';
import assert from 'node:assert/strict';
import { runReportWorker, waitForReportTask } from './reportWorkerClient.js';

function fakeWorker() {
  return { stopped: 0, postMessage() {}, terminate() { this.stopped += 1; } };
}

test('progress and result settle once and terminate the worker', async () => {
  const worker = fakeWorker();
  const progress = [];
  const pending = runReportWorker({}, { workerFactory: () => worker, onProgress: (value) => progress.push(value) });
  worker.onmessage({ data: { type: 'progress', progress: { completedRows: 100 } } });
  worker.onmessage({ data: { type: 'complete', buffer: new ArrayBuffer(1), pageCount: 1 } });
  worker.onmessage({ data: { type: 'progress', progress: { completedRows: 999 } } });
  assert.equal((await pending).pageCount, 1);
  assert.deepEqual(progress, [{ completedRows: 100 }]);
  assert.equal(worker.stopped, 1);
});

test('cancel stops an active job, ignores a late result and allows a fresh retry', async () => {
  const worker = fakeWorker();
  const controller = new AbortController();
  const pending = runReportWorker({}, { signal: controller.signal, workerFactory: () => worker });
  controller.abort();
  worker.onmessage({ data: { type: 'complete', pageCount: 999 } });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.stopped, 1);
  const retry = fakeWorker();
  const next = runReportWorker({}, { workerFactory: () => retry });
  retry.onmessage({ data: { type: 'complete', pageCount: 2 } });
  assert.equal((await next).pageCount, 2);
});

test('already-cancelled jobs do not create a worker', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runReportWorker({}, { signal: controller.signal, workerFactory: () => { assert.fail('unexpected worker'); } }), { name: 'AbortError' });
});

test('cancelling a stalled module download releases the caller without waiting for the network', async () => {
  const controller = new AbortController();
  let finish;
  const pending = waitForReportTask(new Promise((resolve) => { finish = resolve; }), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finish('late module');
});

test('deadline and worker errors stop generation with retry guidance', async () => {
  const worker = fakeWorker();
  await assert.rejects(runReportWorker({}, { timeoutMs: 10, workerFactory: () => worker }), /took too long/);
  assert.equal(worker.stopped, 1);
  for (const event of ['onerror', 'onmessageerror']) {
    const broken = fakeWorker();
    const pending = runReportWorker({}, { workerFactory: () => broken });
    broken[event]();
    await assert.rejects(pending, /retry/i);
    assert.equal(broken.stopped, 1);
  }
  await assert.rejects(runReportWorker({}, { workerFactory: () => { throw new Error('unsupported'); } }), /supported browser/);
});
