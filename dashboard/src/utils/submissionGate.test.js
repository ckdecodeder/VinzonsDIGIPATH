import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionGate } from './submissionGate.js';

test('rapid repeated submits cannot create a second document while attachment/save work is pending', async () => {
  const busy = [], gate = createSubmissionGate(value => busy.push(value));
  let release, saves = 0;
  const attachment = new Promise(resolve => { release = resolve; });
  const work = async () => { await attachment; saves++; return 'saved'; };
  const first = gate(work);
  await Promise.all([gate(work), gate(work)]);
  assert.equal(saves, 0); assert.deepEqual(busy, [true]);
  release(); assert.equal(await first, 'saved'); assert.equal(saves, 1);
  assert.deepEqual(busy, [true, false]);
});

test('a failed save releases the form for an intentional retry', async () => {
  const busy = [], gate = createSubmissionGate(value => busy.push(value));
  await assert.rejects(gate(async () => { throw new Error('save failed'); }), /save failed/);
  assert.equal(await gate(async () => 'retry saved'), 'retry saved');
  assert.deepEqual(busy, [true, false, true, false]);
});

test('validation return releases a gate and separate forms do not block each other', async () => {
  const a = createSubmissionGate(), b = createSubmissionGate();
  await a(() => undefined);
  let release;
  const first = a(() => new Promise(resolve => { release = resolve; }));
  assert.equal(await b(() => 'independent'), 'independent');
  release('done'); assert.equal(await first, 'done');
});
