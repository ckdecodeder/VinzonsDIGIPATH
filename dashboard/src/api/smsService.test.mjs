import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('SMS history collects every page, document history is scoped, and retry only queues', async () => {
  const file = new URL('./documentService.js', import.meta.url);
  const api = `data:text/javascript,${encodeURIComponent("export async function bootstrapApiBase(){return 'https://synthetic.invalid/api'};export function recoverApiConnection(){}")}`;
  const http = `data:text/javascript,${encodeURIComponent('export async function requestWithDeadline(url, options){return globalThis.__smsTestRequest(url, options)}')}`;
  const requests = [];
  globalThis.__smsTestRequest = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') return { status: 'Queued' };
    const parsed = new URL(url), page = Number(parsed.searchParams.get('page'));
    const limit = Number(parsed.searchParams.get('limit'));
    return { page, limit, total: 260, items: Array.from({ length: page === 3 ? 60 : 100 }, (_, index) => ({ id: `SMS-${(page - 1) * 100 + index}` })) };
  };
  try {
    const source = (await readFile(file, 'utf8')).replaceAll("'./apiBase'", JSON.stringify(api))
      .replaceAll("'./httpClient.mjs'", JSON.stringify(http))
      .replaceAll("'./collectionLoader.mjs'", JSON.stringify(new URL('./collectionLoader.mjs', file).href))
      .replaceAll("'./pagination.mjs'", JSON.stringify(new URL('./pagination.mjs', file).href))
      .replaceAll('import.meta.env', '({})');
    const { senderNotificationService } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal((await senderNotificationService.getAll()).length, 260);
    requests.length = 0;
    assert.equal((await senderNotificationService.forDocument('SYNTHETIC-DOC')).length, 260);
    assert.ok(requests.every(request => request.url.includes('/documents/SYNTHETIC-DOC/sender-notifications')));
    assert.equal((await senderNotificationService.resend('SYNTHETIC-ID')).status, 'Queued');
    assert.equal(requests.at(-1).options.method, 'POST');
  } finally { delete globalThis.__smsTestRequest; }
});
