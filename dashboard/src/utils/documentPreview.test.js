import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Drive the hook's real effect/cleanup with deferred requests, without a DOM dependency.
function harness() {
  const values = []; let cursor = 0, dependencies, cleanup, pendingEffect;
  const context = { AbortController, module: { exports: {} },
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(effect, next) {
      if (!dependencies || next.some((value, index) => !Object.is(value, dependencies[index]))) {
        dependencies = next; pendingEffect = effect;
      }
    } };
  const source = fs.readFileSync(new URL('../hooks/useDocumentPreview.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/, '').replace('export function', 'function');
  vm.runInNewContext(source + '\nmodule.exports = useDocumentPreview;', context);
  const requests = []; let closed = 0;
  const load = (id, { signal }) => new Promise((resolve, reject) => requests.push({ id, signal, resolve, reject }));
  const close = () => { closed++; };
  return {
    requests, get closed() { return closed; },
    render(id, user, revision) {
      cursor = 0; const result = context.module.exports(id, user, revision, load, close);
      if (pendingEffect) { cleanup?.(); const effect = pendingEffect; pendingEffect = null; cleanup = effect(); }
      return result;
    },
    unmount() { cleanup?.(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('preview refetches changed collections and reconnect refreshes, hiding obsolete custody', async () => {
  const app = harness(); let revision = [];
  assert.equal(app.render('A', 'USER', revision).loading, true);
  app.requests[0].resolve({ id: 'A', currentOfficeId: 'SOURCE' }); await settle();
  assert.equal(app.render('A', 'USER', revision).document.currentOfficeId, 'SOURCE');
  revision = [];
  const refreshing = app.render('A', 'USER', revision);
  assert.equal(refreshing.document, null); assert.equal(refreshing.loading, true);
  app.requests[1].resolve({ id: 'A', currentOfficeId: 'DESTINATION' }); await settle();
  assert.equal(app.render('A', 'USER', revision).document.currentOfficeId, 'DESTINATION');
  app.unmount();
});

test('selection/session changes and closing discard late detail responses', async () => {
  const app = harness(), revision = [];
  app.render('A', 'USER', revision); app.render('B', 'USER', revision);
  assert.equal(app.requests[0].signal.aborted, true);
  app.requests[1].resolve({ id: 'B' }); app.requests[0].resolve({ id: 'A' }); await settle();
  assert.equal(app.render('B', 'USER', revision).document.id, 'B');
  assert.equal(app.render('B', 'OTHER-USER', revision).document, null);
  app.render(null, 'OTHER-USER', revision);
  app.requests[2].resolve({ id: 'B' }); await settle();
  assert.equal(app.render(null, 'OTHER-USER', revision).document, null);
  app.unmount();
});

test('temporary preview failures expose Retry and recover without retaining stale data', async () => {
  const app = harness(), revision = [];
  app.render('A', 'USER', revision);
  app.requests[0].reject(new Error('Synthetic connection failure')); await settle();
  const failed = app.render('A', 'USER', revision);
  assert.equal(failed.error, 'Synthetic connection failure'); assert.equal(failed.document, null);
  failed.retry(); assert.equal(app.render('A', 'USER', revision).loading, true);
  app.requests[1].resolve({ id: 'A' }); await settle();
  assert.equal(app.render('A', 'USER', revision).document.id, 'A'); app.unmount();
});

test('deleted documents and lost access close the preview', async () => {
  for (const status of [401, 403, 404]) {
    const app = harness(); app.render('A', 'USER', []);
    app.requests[0].reject(Object.assign(new Error('Unavailable'), { status })); await settle();
    assert.equal(app.closed, 1); app.unmount();
  }
});
