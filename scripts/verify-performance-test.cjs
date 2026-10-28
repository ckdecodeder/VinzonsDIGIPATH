// Read-only HTTP/DB checks against the fixed isolated database; prints aggregates only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const backup = path.join(root, 'database-export', 'performance-operation-2026-10-28');
const env = require('../backend/node_modules/dotenv').parse(fs.readFileSync(path.join(backup, 'test-backend.env')));
if (new URL(env.DATABASE_URL).pathname !== '/vinzons_digipath_perf_test_20261028' || env.PORT !== '5501') throw new Error('Expected isolated test configuration');
Object.assign(process.env, env);
const { _sequelizeModels, Document } = require('../backend/models');
const { sequelize } = require('../backend/config/db');
const { createToken } = require('../backend/middleware/auth');
const { getScopedDocumentQuery } = require('../backend/utils/documentScope');

async function main() {
  const users = await _sequelizeModels.UserModel.findAll({ attributes: { exclude: ['password'] }, raw: true });
  const request = async (route, token) => {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:5501/api${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    assert.equal(response.status, 200, `HTTP failure on ${route}`);
    return { data: JSON.parse(body), bytes: Buffer.byteLength(body), ms: Math.round((performance.now() - start) * 100) / 100 };
  };
  try {
    const roles = await Promise.all(['Admin', 'Mayor', 'Receptionist', 'Office'].map(async (role) => {
      const user = users.find((row) => row.role === role);
      assert.ok(user, `Missing ${role} test account`);
      const token = createToken(user);
      const pages = [];
      let total;
      const ids = [];
      for (let page = 1; total === undefined || ids.length < total; page += 1) {
        assert.ok(page < 100);
        const result = await request(`/documents?page=${page}&limit=50`, token);
        total = result.data.total;
        for (const item of result.data.items) {
          for (const field of ['scannedImageUrl', 'scannedFiles', 'scannedText', 'timeline']) assert.equal(field in item, false);
          ids.push(item.id);
        }
        pages.push({ page, bytes: result.bytes, ms: result.ms });
        if (!total) break;
      }
      const expected = await Document.find(getScopedDocumentQuery({ user })).select('id').lean();
      assert.deepEqual([...ids].sort(), expected.map((row) => row.id).sort());
      assert.equal(ids.length, new Set(ids).size);
      const logs = await request('/logs?page=1&limit=20', token);
      assert.ok(logs.data.items.length <= 20);
      if (role === 'Receptionist') assert.ok(logs.data.items.every((row) => row.userId === user.id));
      if (ids.length) {
        const detail = await request(`/documents/${encodeURIComponent(ids[0])}`, token);
        assert.ok('scannedFiles' in detail.data && 'timeline' in detail.data);
      }
      return { role, scopedDocuments: total, pages, firstLogPageBytes: logs.bytes, logTotal: logs.data.total };
    }));
    const id = `PERF-ATOMIC-${crypto.randomUUID()}`;
    let atomicUpdates;
    await _sequelizeModels.DocumentModel.create({ id, trackingNumber: id, subject: 'Disposable concurrency test', routeStep: 0, timeline: [] });
    try {
      await Promise.all(Array.from({ length: 20 }, (_, index) => Document.findOneAndUpdate({ id }, {
        $inc: { routeStep: 1 }, $push: { timeline: { id: `TEST-${index}` } },
      })));
      const previous = await Document.findOneAndUpdate({ id }, { $push: { timeline: { $each: [{ id: 'EXTRA-1' }, { id: 'EXTRA-2' }] } } }, { new: false });
      assert.equal(previous.timeline.length, 20);
      await Document.updateOne({ id }, { $inc: { routeStep: 1 } });
      const saved = await Document.findOne({ id }).lean();
      assert.equal(saved.routeStep, 21);
      assert.equal(saved.timeline.length, 22);
      assert.equal(new Set(saved.timeline.map((event) => event.id)).size, 22);
      atomicUpdates = { concurrentWrites: 20, retainedEvents: 22, finalCounter: 21, previousValueSemantics: 'verified' };
    } finally {
      // Only the exact fixture created above can be removed; never real records.
      assert.ok(id.startsWith('PERF-ATOMIC-'));
      await _sequelizeModels.DocumentModel.destroy({ where: { id } });
    }
    const coverId = `PERF-COVER-${crypto.randomUUID()}`;
    const admin = users.find((user) => user.role === 'Admin');
    const token = createToken(admin);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    let savedCover;
    let persistedCover;
    try {
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      const response = await fetch('http://127.0.0.1:5501/api/documents', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: coverId, subject: 'Disposable cover persistence test', senderName: 'Test fixture',
          originOfficeId: admin.officeId, currentOfficeId: admin.officeId, notifySender: false, senderNotificationConsent: false,
          scannedImageUrl: dataUrl, scannedFiles: [{ name: 'test-pixel.png', type: 'image/png', dataUrl }] }),
      });
      assert.equal(response.status, 201);
      savedCover = await response.json();
      assert.equal(savedCover.id, coverId);
      assert.equal(savedCover.scannedImageUrl, savedCover.scannedFiles[0].url);
      assert.ok(savedCover.scannedImageUrl.startsWith('/uploads/scans/'));
      const file = await fetch(`http://127.0.0.1:5501${savedCover.scannedImageUrl}`);
      assert.equal(file.status, 200);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      persistedCover = { inlineCoverReplacedByStoredUrl: true, imageDownloadMatches: true };
    } finally {
      assert.ok(coverId.startsWith('PERF-COVER-'));
      await _sequelizeModels.NotificationModel.destroy({ where: { referenceId: coverId } });
      await _sequelizeModels.LogModel.destroy({ where: { referenceId: coverId } });
      await _sequelizeModels.DocumentModel.destroy({ where: { id: coverId } });
      if (savedCover?.scannedFiles?.[0]?.storagePath) {
        const storage = path.join(backup, 'test-uploads');
        const owned = path.join(storage, savedCover.scannedFiles[0].storagePath.replace(/^uploads[/\\]/, ''));
        const relative = path.relative(storage, owned);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
        await fs.promises.unlink(owned);
      }
    }
    const evidence = { verifiedAt: new Date().toISOString(), state: 'Isolated local HTTP, four concurrent role clients; not four physical devices or a public-tunnel test', roles, atomicUpdates, persistedCover };
    fs.writeFileSync(path.join(backup, 'listing-http-verification.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await sequelize.close(); }
}
main().catch(() => { console.error('Isolated listing verification failed; inspect locally without exposing record contents.'); process.exitCode = 1; });
