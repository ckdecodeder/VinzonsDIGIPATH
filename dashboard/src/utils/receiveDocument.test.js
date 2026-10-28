import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveDocumentWithConfirmation } from './receiveDocument.js';

const options = {
  transmission: { id: 'TRANSMISSION', documentId: 'DOCUMENT', toOfficeId: 'SECOND' },
  document: { trackingNumber: 'SYNTHETIC-001', subject: 'Synthetic delivery' },
  currentUser: { id: 'RECEIVER', officeId: 'SECOND' }, office: { name: 'Second office' },
};
test('cancelling receipt confirmation sends no mutation', async () => {
  const result = await receiveDocumentWithConfirmation(options, { confirm: async (dialog) => {
    assert.equal(dialog.confirmLabel, 'Confirm receipt');
    assert.match(dialog.message, /Second office.*SYNTHETIC-001.*Synthetic delivery/);
    return false;
  }, save: () => assert.fail('Cancelled receipt must not save') });
  assert.equal(result, null);
});
test('confirmed receipt saves once using the current user and explicit confirmation', async () => {
  const calls = [];
  const result = await receiveDocumentWithConfirmation({ ...options, updates: { receivedBy: 'FORGED' } }, {
    confirm: async () => true, save: async (id, payload) => { calls.push({ id, payload }); return payload; },
  });
  assert.deepEqual(calls, [{ id: 'TRANSMISSION', payload: { receivedBy: 'RECEIVER', confirmReceipt: true } }]);
  assert.equal(result.receivedBy, 'RECEIVER');
});
test('received and other-office deliveries cannot open confirmation or save', async () => {
  for (const transmission of [{ ...options.transmission, receivedBy: 'DONE' }, { ...options.transmission, toOfficeId: 'OTHER' }]) {
    assert.equal(await receiveDocumentWithConfirmation({ ...options, transmission }, {
      confirm: () => assert.fail('Ineligible delivery'), save: () => assert.fail('Ineligible delivery'),
    }), null);
  }
});
test('failed save rejects without fabricating a receipt and remains retryable', async () => {
  await assert.rejects(receiveDocumentWithConfirmation(options, { confirm: async () => true, save: async () => { throw new Error('Synthetic failure'); } }), /Synthetic failure/);
  assert.equal(options.transmission.receivedBy, undefined);
  assert.equal(await receiveDocumentWithConfirmation(options, { confirm: async () => true, save: async () => 'saved' }), 'saved');
});
