import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('preserved SMS service loads empty history without an API and rejects sending honestly', async () => {
  const file = new URL('./documentService.js', import.meta.url);
  const unavailableApi = `data:text/javascript,${encodeURIComponent(`
    export async function bootstrapApiBase() { throw new Error('Unexpected API bootstrap'); }
    export function recoverApiConnection() { throw new Error('Unexpected API recovery'); }
  `)}`;
  const unavailableHttp = `data:text/javascript,${encodeURIComponent(`
    export async function requestWithDeadline() { throw new Error('Unexpected HTTP request'); }
  `)}`;
  const source = (await readFile(file, 'utf8'))
    .replaceAll("'./apiBase'", JSON.stringify(unavailableApi))
    .replaceAll("'./httpClient.mjs'", JSON.stringify(unavailableHttp))
    .replaceAll("'./collectionLoader.mjs'", JSON.stringify(new URL('./collectionLoader.mjs', file).href))
    .replaceAll("'./pagination.mjs'", JSON.stringify(new URL('./pagination.mjs', file).href))
    .replaceAll('import.meta.env', '({})');
  const { senderNotificationService, appDataService } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(await senderNotificationService.getAll(), []);
  let loaded, state;
  await appDataService.load(['senderNotifications'], {
    onData: (_key, value) => { loaded = value; },
    onState: (_key, value) => { state = value; },
  });
  assert.deepEqual(loaded, []);
  assert.equal(state.status, 'ready');
  await assert.rejects(senderNotificationService.resend('SYNTHETIC-ID'), /unavailable.*rebuilt/);
});
