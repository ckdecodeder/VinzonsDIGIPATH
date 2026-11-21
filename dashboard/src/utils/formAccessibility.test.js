import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusFormError } from './formAccessibility.js';

test('form failures focus the rendered summary after the pending render', (t) => {
  let render, focused = 0;
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { render = callback; };
  t.after(() => { globalThis.requestAnimationFrame = previousFrame; });
  const summary = { getClientRects: () => [{}], focus: () => focused++ };
  const container = {
    isConnected: true,
    querySelector: selector => { assert.equal(selector, '[data-form-error]'); return summary; },
    ownerDocument: { querySelectorAll: () => [] },
  };
  focusFormError(container);
  assert.equal(focused, 0);
  render();
  assert.equal(focused, 1);
  focusFormError(container);
  render();
  assert.equal(focused, 2, 'the same error can receive focus again after another submit');
});

test('closed, hidden and background forms cannot steal delayed focus', (t) => {
  let render, focused = 0;
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { render = callback; };
  t.after(() => { globalThis.requestAnimationFrame = previousFrame; });
  const summary = { getClientRects: () => [{}], focus: () => focused++ };
  const container = {
    isConnected: true,
    querySelector: () => summary,
    ownerDocument: { querySelectorAll: () => [] },
  };
  focusFormError(container);
  container.isConnected = false;
  render();
  container.isConnected = true;
  summary.getClientRects = () => [];
  focusFormError(container);
  render();
  summary.getClientRects = () => [{}];
  container.ownerDocument.querySelectorAll = () => [{ contains: () => false }];
  focusFormError(container);
  render();
  assert.equal(focused, 0);
  container.ownerDocument.querySelectorAll = () => [{ contains: () => true }];
  focusFormError(container);
  render();
  assert.equal(focused, 1);
});
