const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('restored scan references resolve only inside the selected storage root', () => {
  process.env.UPLOADS_ROOT = path.join(__dirname, 'isolated-uploads');
  const { uploadsRoot, scansRoot, resolveScanPath } = require('../config/storage');
  assert.equal(uploadsRoot, process.env.UPLOADS_ROOT);
  assert.equal(resolveScanPath({ storagePath: 'uploads/scans/example.pdf' }), path.join(scansRoot, 'example.pdf'));
  assert.equal(resolveScanPath({ url: '/uploads/scans/example.pdf' }), path.join(scansRoot, 'example.pdf'));
  const historical = path.join(__dirname, '..', 'uploads', 'scans', 'example.pdf');
  assert.equal(resolveScanPath({ storagePath: historical }), path.join(scansRoot, 'example.pdf'));
  assert.equal(resolveScanPath({ storagePath: 'uploads/scans/../../.env' }), null);
  assert.equal(resolveScanPath({ storagePath: path.join(__dirname, '..', '.env') }), null);
});
