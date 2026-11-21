import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Drive the real registration handler with synthetic saves; never call scanner services.
function harness({ hardware = false, saved, error } = {}) {
  const source = fs.readFileSync(new URL('../components/Scanner.jsx', import.meta.url), 'utf8');
  let step = 3, registered = null, message = '', calls = 0;
  const save = async () => { calls++; if (error) throw error; return saved; };
  const context = {
    module: { exports: {} },
    registerSubmitGate: { current: task => task() },
    validateScannerDetails: () => ({ isValid: true }),
    setFormErrors() {}, setFormErrorSummary: value => { message = value; },
    setRegisteredDoc: value => { registered = value; }, setStep: value => { step = value; },
    createScannedDocumentPdf: async () => ({ dataUrl: 'synthetic-pdf', type: 'application/pdf' }),
    capturedImages: [{}], selectedPaperGuide: {}, capturedImagesRef: { current: [] },
    setCapturedImages() {}, setCapturedImage() {}, setCapturedFileType() {},
    hardwareScannedDoc: hardware ? { id: 'SCAN', trackingNumber: 'OLD', currentOfficeId: 'SOURCE' } : null,
    formData: { subject: 'Synthetic', documentTypeId: 'TYPE', documentTypeOther: '', originOfficeOther: '', toOfficeId: 'DEST', senderContact: '', remarks: '' },
    receptionOfficeId: 'SOURCE', extractedText: '',
    getInitialHandoffOfficeIds: () => [], isOtherDocumentType: () => false,
    onCapture: save, onEditDocument: save,
    device: { connected: false }, isPhysicalSource: false,
  };
  vm.runInNewContext(source.slice(source.indexOf('  const handleConfirmSubmit ='), source.indexOf('  const handleRescan ='))
    + '\nmodule.exports = handleConfirmSubmit;', context);
  return { submit: () => context.module.exports(), get step() { return step; }, get registered() { return registered; }, get message() { return message; }, get calls() { return calls; } };
}

test('scanner registration retains the returned record and server-issued tracking number', async () => {
  const document = { id: 'NEW', trackingNumber: 'SERVER-001' };
  const app = harness({ saved: { document } });
  await app.submit();
  assert.equal(app.step, 4);
  assert.equal(app.registered, document);
  assert.equal(app.calls, 1);
});

test('finalizing a hardware scan retains the updated record, not the original scan snapshot', async () => {
  const document = { id: 'SCAN', trackingNumber: 'SERVER-002', subject: 'Saved details' };
  const app = harness({ hardware: true, saved: document });
  await app.submit();
  assert.equal(app.step, 4);
  assert.equal(app.registered, document);
});

test('failed or unconfirmed registration never presents a registered continuation', async () => {
  for (const options of [{ error: new Error('Save failed') }, { saved: null }, { hardware: true, saved: null }]) {
    const app = harness(options);
    await app.submit();
    assert.equal(app.step, 3);
    assert.equal(app.registered, null);
    assert.ok(app.message);
  }
});
