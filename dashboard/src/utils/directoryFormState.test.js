import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createSubmissionGate } from './submissionGate.js';

function harness(page, save) {
  const source = fs.readFileSync(new URL(`../pages/${page}.jsx`, import.meta.url), 'utf8');
  const state = { showForm: true, formError: '', isSaving: false, focused: 0 };
  const context = vm.createContext({
    formData: page === 'OfficeList' ? { name: 'Synthetic office' } : { category: 'Synthetic type', routingTrack: 'direct' },
    editOffice: null, editType: null, search: '', documentTypes: [],
    setShowForm: value => { state.showForm = value; },
    setFormError: value => { state.formError = value; },
    setIsSaving: value => { state.isSaving = value; context.isSaving = value; },
    setEditOffice() {}, setEditType() {}, setFormData() {},
    onAddOffice: save, onUpdateOffice: save, onAddDocumentType: save, onUpdateDocumentType: save,
    focusFormError: () => { state.focused++; }, isSaving: false,
  });
  context.submitGate = { current: createSubmissionGate(context.setIsSaving) };
  const start = source.indexOf('  const closeForm =');
  const fallback = page === 'OfficeList' ? source.indexOf('  const handleSubmit =') : source.indexOf('  const openForm =');
  const end = page === 'OfficeList' ? source.indexOf('\n  return (\n    <>') : source.indexOf('  const getTrackInfo =');
  vm.runInContext((start < 0 ? 'const closeForm = () => setShowForm(false);\n' : '')
    + source.slice(start < 0 ? fallback : start, end)
    + '\nglobalThis.submit = handleSubmit; globalThis.close = closeForm;', context);
  return { state, data: context.formData, close: context.close, submit: () => context.submit({ preventDefault() {}, currentTarget: {} }) };
}

for (const page of ['OfficeList', 'DocumentTypeList']) {
  test(`${page}: failed saves keep entered values, focus the inline error and permit deliberate retry`, async () => {
    let calls = 0;
    const app = harness(page, async payload => {
      calls++; assert.equal(payload, app.data);
      if (calls === 1) throw new Error('Synthetic save conflict');
      return { id: 'SAVED' };
    });
    await assert.doesNotReject(app.submit());
    assert.equal(app.state.showForm, true);
    assert.match(app.state.formError, /Synthetic save conflict/);
    assert.equal(app.state.focused, 1);
    assert.equal(app.state.isSaving, false);
    await app.submit();
    assert.equal(calls, 2); assert.equal(app.state.showForm, false);
    assert.equal(app.state.formError, '');
  });

  test(`${page}: pending save blocks duplicate submissions and dismissal until confirmation`, async () => {
    let finish, calls = 0;
    const saved = new Promise(resolve => { finish = resolve; });
    const app = harness(page, () => { calls++; return saved; });
    const pending = app.submit();
    app.close(); const duplicate = app.submit();
    assert.equal(calls, 1); assert.equal(app.state.showForm, true); assert.equal(app.state.isSaving, true);
    finish({ id: 'SAVED' }); await Promise.all([pending, duplicate]);
    assert.equal(app.state.showForm, false); assert.equal(app.state.isSaving, false);
  });

  test(`${page}: cancelled confirmation retains the form without fabricating success or an error`, async () => {
    const app = harness(page, async () => null);
    await app.submit();
    assert.equal(app.state.showForm, true); assert.equal(app.state.isSaving, false);
    assert.equal(app.state.formError, ''); assert.equal(app.state.focused, 0);
  });
}
