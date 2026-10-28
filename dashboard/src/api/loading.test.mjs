import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWithDeadline } from './httpClient.mjs';
import { createEndpointDiscovery } from './endpointDiscovery.mjs';
import { createCollectionLoader, sectionsForPage } from './collectionLoader.mjs';
import { readFile } from 'node:fs/promises';
import { collectPages, toDocumentSummary } from './pagination.mjs';

test('complete metadata callers retain every page and never retain inline media', async () => {
  const all = await collectPages(async ({ page }) => ({ items: [{ id: String(page) }], page, limit: 1, total: 3 }));
  assert.deepEqual(all.map((item) => item.id), ['1', '2', '3']);
  const summary = toDocumentSummary({ id: 'DOC', scannedImageUrl: 'data:large', scannedFiles: [{ id: 'ATT' }], scannedText: 'private', timeline: [{ id: 'EVENT' }] });
  assert.equal(summary.attachmentCount, 1);
  for (const field of ['scannedImageUrl', 'scannedFiles', 'scannedText', 'timeline']) assert.equal(field in summary, false);
});

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', ...extra },
});
const health = () => json({ status: 'API is running', database: 'connected' });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('deadline aborts a stalled body after successful headers, including blob downloads', async () => {
  for (const responseType of ['json', 'blob']) {
    let signal;
    const fetch = async (_, options) => {
      signal = options.signal;
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: () => new Promise(() => {}), blob: () => new Promise(() => {}) };
    };
    await assert.rejects(requestWithDeadline('/stall', { timeoutMs: 20, retries: 0, responseType }, { fetch }), { code: 'TIMEOUT' });
    assert.equal(signal.aborted, true);
  }
});
test('safe reads retry temporary failures, while failed saves are attempted once', async () => {
  let calls = 0;
  const fetch = async () => ++calls === 1 ? json({ message: 'Temporary' }, 503) : json({ ok: true });
  assert.deepEqual(await requestWithDeadline('/read', {}, { fetch }), { ok: true });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(requestWithDeadline('/save', { method: 'POST' }, { fetch }), { status: 503 });
  assert.equal(calls, 1);
});
test('caller cancellation stops the body and does not retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = requestWithDeadline('/cancel', { signal: controller.signal }, { fetch: async () => {
    calls += 1;
    queueMicrotask(() => controller.abort());
    return { ok: true, headers: new Headers(), text: () => new Promise(() => {}) };
  } });
  await assert.rejects(request, { code: 'ABORTED' });
  assert.equal(calls, 1);
});
test('long Retry-After is respected by returning the error without an early retry', async () => {
  let calls = 0;
  await assert.rejects(requestWithDeadline('/limited', {}, { fetch: async () => {
    calls += 1; return json({}, 429, { 'retry-after': '30' });
  } }), { status: 429 });
  assert.equal(calls, 1);
});
test('discovery rejects HTML, deduplicates equivalent probes, and recovers after failure', async () => {
  const calls = [];
  let recovered = false;
  const discovery = createEndpointDiscovery({ origin: 'https://front.example', failureCooldownMs: 10000,
    candidates: () => ['/api', 'https://front.example/api', 'https://api.example', 'https://api.example/api'],
    fetch: async (url) => { calls.push(url); return recovered && url.startsWith('https://api.example') ? health() : new Response('<html/>', { headers: { 'content-type': 'text/html' } }); },
  });
  await assert.rejects(discovery.bootstrap(), { code: 'API_UNAVAILABLE' });
  assert.equal(discovery.getVerified(), null);
  assert.equal(calls.length, 2);
  recovered = true;
  assert.equal(await discovery.bootstrap({ force: true }), 'https://api.example/api');
  assert.equal(calls.length, 4);
});
test('parallel bootstrap callers join one probe', async () => {
  let calls = 0;
  const discovery = createEndpointDiscovery({ origin: 'https://front.example', candidates: () => ['/api'], fetch: async () => { calls += 1; return health(); } });
  assert.deepEqual(await Promise.all([discovery.bootstrap(), discovery.bootstrap()]), ['/api', '/api']);
  assert.equal(calls, 1);
});
test('documents commit while logs are stalled; each section has its own failure state', async () => {
  const logs = deferred();
  const states = {};
  const values = {};
  const loader = createCollectionLoader({ documents: async () => [{ id: 'DOC' }], logs: () => logs.promise });
  const pending = loader.load(['documents', 'logs'], { onData: (key, value) => { values[key] = value; }, onState: (key, value) => { states[key] = value; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(values.documents[0].id, 'DOC');
  assert.equal(states.logs.status, 'loading');
  logs.resolve(Promise.reject(new Error('Logs unavailable')));
  await pending;
  assert.equal(states.documents.status, 'ready');
  assert.equal(states.logs.status, 'error');
});
test('invalidation during a fetch discards the stale result and deduplicates overlapping callers', async () => {
  const first = deferred();
  let calls = 0;
  const values = [];
  const loader = createCollectionLoader({ documents: () => ++calls === 1 ? first.promise : Promise.resolve('new') });
  const callbacks = { onData: (_, value) => values.push(value) };
  const a = loader.load(['documents'], callbacks);
  loader.invalidate(['documents']);
  const b = loader.load(['documents'], callbacks);
  first.resolve('old');
  await Promise.all([a, b]);
  assert.equal(calls, 2);
  assert.deepEqual(values, ['new', 'new']);
});
test('switching session discards the previous user results and device-only loads never load documents', async () => {
  const first = deferred(); let documents = 0; let commits = 0;
  const loader = createCollectionLoader({ documents: () => { documents += 1; return first.promise; }, device: async () => ({ online: true }) });
  const old = loader.load(['documents'], { onData: () => { commits += 1; } });
  loader.clear(); first.resolve([]); await old;
  assert.equal(commits, 0);
  await loader.load(['device']);
  assert.equal(documents, 1);
  assert.equal(sectionsForPage('dashboard', 'Admin').includes('logs'), false);
});
test('continuous invalidation ends in a bounded section error rather than an endless loader', async () => {
  let calls = 0; let state;
  const loader = createCollectionLoader({ documents: async () => { calls += 1; loader.invalidate(['documents']); return []; } });
  await loader.load(['documents'], { onState: (_, value) => { state = value; } });
  assert.equal(calls, 3);
  assert.equal(state.status, 'error');
});
test('ICE config cannot replace the verified route or silently split the WS backend', async () => {
  const file = new URL('./apiBase.js', import.meta.url);
  const source = (await readFile(file, 'utf8'))
    .replaceAll("'./endpointDiscovery.mjs'", JSON.stringify(new URL('./endpointDiscovery.mjs', file).href))
    .replaceAll("'./httpClient.mjs'", JSON.stringify(new URL('./httpClient.mjs', file).href))
    .replaceAll('import.meta.env', `(${JSON.stringify({ DEV: true, VITE_WS_URL: 'wss://outdated.example/ws' })})`);
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost:5173' }, addEventListener() {} };
  globalThis.fetch = async (url) => url.endsWith('/status') ? health() : json({ apiUrl: 'https://outdated.example/api', wsUrl: 'wss://outdated.example/ws', iceServers: [{ urls: 'stun:test.example' }] });
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal(await api.bootstrapApiBase(), '/api');
    await api.preloadIceServers();
    assert.equal(api.getApiBase(), '/api');
    assert.equal(api.getResolvedWsUrl(), 'ws://localhost:5173/ws');
    assert.deepEqual(api.getCachedIceServers(), [{ urls: 'stun:test.example' }]);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
