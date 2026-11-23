import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const reportSource = fs.readFileSync(new URL('../pages/ReportsPage.jsx', import.meta.url), 'utf8');

test('collection pages distinguish unavailable data from a confirmed empty result and keep cached rows usable', () => {
  const start = appSource.indexOf('  const primaryPageCollection =');
  assert.ok(start >= 0, 'App must gate false empty states');
  for (const [page, key] of [['documents','documents'],['archives','archives'],['offices','offices'],['users','users'],['document-types','documentTypes']]) {
    const context = vm.createContext({ currentPage: page, visibleDocuments: [], visibleArchives: [], offices: [], users: [], documentTypes: [], sectionStates: {} });
    const code = appSource.slice(start, appSource.indexOf('  const getOfficeName =', start)) + '\nglobalThis.canShow = showCollectionPage;';
    for (const status of [undefined, 'loading', 'error', 'ready']) {
      const ctx = vm.createContext({ ...context, sectionStates: { documents: { status: 'ready' }, [key]: { status }, logs: { status: 'error' } } });
      vm.runInContext(code, ctx);
      assert.equal(ctx.canShow, status === 'ready', `${page}/${status}`);
    }
    if (page === 'archives') {
      for (const documentStatus of ['loading', 'error']) {
        const joined = vm.createContext({ ...context, sectionStates: { archives: { status: 'ready' }, documents: { status: documentStatus } } });
        vm.runInContext(code, joined);
        assert.equal(joined.canShow, false);
      }
    }
    const arrayKey = { documents: 'visibleDocuments', archives: 'visibleArchives' }[key] || key;
    const cached = vm.createContext({ ...context, [arrayKey]: [{ id: 'CACHED' }], sectionStates: { [key]: { status: 'error' } } });
    vm.runInContext(code, cached); assert.equal(cached.canShow, true, page+' cached rows');
    for (const status of ['loading', 'error']) {
      const previouslyEmpty = vm.createContext({ ...context, sectionStates: { documents: { status: 'ready' }, [key]: { status, hasLoaded: true } } });
      vm.runInContext(code, previouslyEmpty); assert.equal(previouslyEmpty.canShow, true, page+' preserves first-record draft during refresh');
    }
  }
});

function reportReadiness(category, states) {
  const start = reportSource.indexOf('  const requiredReportSections =');
  assert.ok(start >= 0, 'Reports must declare required data');
  const context = vm.createContext({ activeCategory: category, dataStates: states });
  vm.runInContext(reportSource.slice(start, reportSource.indexOf('  const [dateFrom,', start)) + '\nglobalThis.ready = reportDataReady;', context);
  return context.ready;
}

test('reports wait for every displayed summary source but unrelated activity loading does not block a document report', () => {
  const states = Object.fromEntries(['documents','transmissions','archives','offices','documentTypes','users','logs'].map(key => [key, { status: 'ready' }]));
  for (const key of ['documents','transmissions','archives','offices','documentTypes']) {
    assert.equal(reportReadiness('documents', { ...states, [key]: { status: 'loading' } }), false, key);
    assert.equal(reportReadiness('summary', { ...states, [key]: { status: 'error' } }), false, key);
  }
  assert.equal(reportReadiness('documents', { ...states, logs: { status: 'error' }, users: { status: 'loading' } }), true);
  assert.equal(reportReadiness('activity', { ...states, logs: { status: 'error' } }), false);
  assert.equal(reportReadiness('transmissions', { ...states, users: { status: 'loading' } }), false);
  assert.equal(reportReadiness('activity', states), true);
  assert.equal(reportReadiness('activity', { ...states, offices: { status: 'error' }, documentTypes: { status: 'loading' } }), true);
  assert.equal(reportReadiness('offices', { ...states, documentTypes: { status: 'error' }, users: { status: 'loading' } }), true);
});

test('an unavailable report cannot open a print tab or start generation even if its handler is invoked directly', async () => {
  let opens = 0, message = '';
  const context = vm.createContext({ reportDataReady: false, jobRef: { current: null }, window: { open() { opens++; return null; } }, setExportError: value => { message = value; } });
  vm.runInContext(reportSource.slice(reportSource.indexOf('  const runReportAction ='), reportSource.indexOf('  const renderDownloadMenu =')) + '\nglobalThis.run = runReportAction;', context);
  for (const action of ['print','preview','pdf','jpeg']) { await context.run(action); assert.equal(opens, 0); }
  assert.equal(opens, 0); assert.match(message, /data|load/i);
});

test('a reversed range blocks every report action before opening windows or starting work', async () => {
  let message = '';
  const context = vm.createContext({ reportDataReady: true, invalidDateRange: true, setExportError: value => { message = value; } });
  vm.runInContext(reportSource.slice(reportSource.indexOf('  const runReportAction ='), reportSource.indexOf('  const renderDownloadMenu =')) + '\nglobalThis.run = runReportAction;', context);
  for (const action of ['print', 'preview', 'pdf', 'jpeg']) {
    await context.run(action);
    assert.match(message, /end date on or after the start/i);
  }
});
