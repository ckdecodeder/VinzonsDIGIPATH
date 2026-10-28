import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReportPdf } from './reportExport.js';

test('report seal bytes reach the worker before a successful result', async (context) => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  context.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => bytes }));
  let sent;
  let terminated = false;
  const worker = {
    terminate() { terminated = true; },
    postMessage(value) { sent = value; queueMicrotask(() => this.onmessage({ data: { type: 'complete', buffer: new ArrayBuffer(2), pageCount: 1 } })); },
  };
  const result = await prepareReportPdf({ recordCount: 7 }, { workerFactory: () => worker });
  assert.equal(sent.model.sealBytes, bytes);
  assert.equal(sent.model.recordCount, 7);
  assert.equal(result.pageCount, 1);
  assert.equal(terminated, true);
});

test('cancelling during the seal response body download prevents a worker from starting', async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, 'fetch', async (_, { signal }) => ({ ok: true, arrayBuffer: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
    controller.abort();
  }) }));
  await assert.rejects(prepareReportPdf({}, { signal: controller.signal, workerFactory: () => assert.fail('worker started after cancellation') }), { name: 'AbortError' });
});

test('unavailable branding fails clearly instead of leaving generation active', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(prepareReportPdf({}, { workerFactory: () => assert.fail('worker started without seal') }), /seal could not load.*retry/i);
});

test('the seal deadline covers a stalled response body as well as the initial request', { timeout: 10000 }, async (context) => {
  context.mock.method(globalThis, 'fetch', async (_, { signal }) => ({ ok: true, arrayBuffer: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('body deadline')), { once: true });
  }) }));
  await assert.rejects(prepareReportPdf({}, { workerFactory: () => assert.fail('worker started after deadline') }), /seal could not load.*retry/i);
});
