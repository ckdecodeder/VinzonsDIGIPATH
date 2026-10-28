import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildReportPdf } from './reportPdf.js';
import { runReportWorker } from './reportWorkerClient.js';
import { reportFixture } from '../../test/reportFixture.mjs';

async function extract(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      pages.push((await page.getTextContent()).items.map((item) => item.str).join(' '));
      page.cleanup();
    }
    return pages;
  } finally { await pdf.destroy(); }
}

function nodeWorker() {
  const thread = new Worker(new URL('../../test/reportNodeWorker.mjs', import.meta.url));
  const adapter = {
    postMessage: (message) => thread.postMessage(message),
    terminate: () => thread.terminate(),
  };
  thread.on('message', (data) => adapter.onmessage?.({ data }));
  thread.on('error', () => adapter.onerror?.());
  return adapter;
}

test('10,000 records remain complete in a PDF generated off the caller thread', { timeout: 120000 }, async () => {
  const model = reportFixture();
  model.sealBytes = await readFile(new URL('../../public/Seal_of_Vinzons.png', import.meta.url));
  let ticks = 0;
  let lastProgress;
  const timer = setInterval(() => { ticks += 1; }, 10);
  let result;
  try {
    result = await runReportWorker(model, { workerFactory: nodeWorker, onProgress: (value) => { lastProgress = value; } });
  } finally { clearInterval(timer); }
  assert.ok(ticks >= 5, 'caller remains free while the actual worker runs');
  assert.equal(result.rowCount, 10000);
  assert.ok(result.pageCount >= 490);
  assert.equal(lastProgress.completedRows, 10000);
  const pdfBytes = result.buffer.byteLength;
  const pages = await extract(result.buffer);
  const content = pages.join(' ');
  const ids = content.match(/R\d{5}/g) || [];
  assert.equal(ids.length, 10000);
  assert.equal(new Set(ids).size, 10000);
  assert.ok(content.includes('Test Reviewer Peña'));
  assert.ok(pages.at(-1).includes(`Page ${result.pageCount} of ${result.pageCount}`));
  console.log(JSON.stringify({ reportRecords: result.rowCount, reportPages: result.pageCount, pdfBytes, callerTicks: ticks }));
});

test('oversized details continue across pages with every word and the next record retained', async () => {
  const model = reportFixture(2);
  const words = Array.from({ length: 4000 }, (_, index) => `W${String(index).padStart(4, '0')}`);
  model.table.rows[0][5] = words.join(' ');
  const result = buildReportPdf(model);
  const content = (await extract(result.buffer)).join(' ');
  const actual = content.match(/W\d{4}/g) || [];
  assert.deepEqual(actual, words);
  assert.ok(content.includes('R00001'));
  assert.ok(result.pageCount > 5);
});

test('cancellation after actual worker progress stops generation and a new worker can retry', async () => {
  const controller = new AbortController();
  let progressSeen = false;
  await assert.rejects(runReportWorker(reportFixture(), {
    signal: controller.signal, workerFactory: nodeWorker,
    onProgress: () => { progressSeen = true; controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(progressSeen, true);
  const retry = await runReportWorker(reportFixture(2), { workerFactory: nodeWorker });
  assert.equal(retry.rowCount, 2);
  assert.equal(retry.pageCount, 1);
});

test('summary and empty reports include zero counts and clear empty-state text', async () => {
  const model = reportFixture(0);
  const empty = (await extract(buildReportPdf(model).buffer)).join(' ');
  assert.ok(empty.includes('No records found for the selected coverage.'));
  assert.match(empty, /Synthetic count\s+0/);
  model.table.title = '';
  const summary = buildReportPdf(model);
  assert.equal(summary.pageCount, 1);
  assert.equal(summary.rowCount, 0);
  assert.ok((await extract(summary.buffer)).join(' ').includes('Verified / Noted by'));
});
