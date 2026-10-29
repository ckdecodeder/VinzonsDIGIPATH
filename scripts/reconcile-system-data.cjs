// READ ONLY. Private per-record evidence stays in ignored storage; stdout contains aggregate counts only.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const digest = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const timestampCandidates = (doc, transmission) => {
  const candidates = [
    ...(doc.sendHistory || []).filter(e => (e.transmissionId === transmission.id || e.id === transmission.id) && e.receivedBy === transmission.receivedBy).map(e => e.receivedAt),
    ...(doc.timeline || []).filter(e => e.referenceId === transmission.id && e.userId === transmission.receivedBy && e.action === 'transmission_received').map(e => e.timestamp),
  ].filter(value => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  return [...new Set(candidates)];
};
const main = async () => {
  const env = require('../backend/node_modules/dotenv').parse(await fs.readFile(path.join(root, 'backend/.env')));
  const uploads = path.resolve(env.UPLOADS_ROOT || path.join(root, 'backend/uploads'));
  process.env.UPLOADS_ROOT = uploads;
  const { resolveScanPath } = require('../backend/config/storage');
  const out = path.join(root, 'database-export', 'reconciliation-' + new Date().toISOString().replace(/[:.]/g, '-'));
  execFileSync('git', ['check-ignore', path.join(out, 'private-manifest.json')], { cwd: root, stdio: 'ignore' });
  const { Client } = require('../backend/node_modules/pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
  let documents, transmissions, offices;
  try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    documents = (await client.query('SELECT id,status,"currentOfficeId","scannedFiles","scannedImageUrl","sendHistory","sendQueue",timeline FROM documents')).rows;
    transmissions = (await client.query('SELECT id,"documentId","receivedBy","receivedAt","transmissionDate" FROM transmissions')).rows;
    offices = new Set((await client.query('SELECT id FROM offices')).rows.map(o => o.id));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  const backupRoot = path.join(root, 'database-export/performance-operation-2026-10-28');
  let backupManifest = [];
  try { backupManifest = JSON.parse(await fs.readFile(path.join(backupRoot, 'scan-manifest.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const missingFiles = [], invalidCustody = [], legacyQueues = [], receiptTimestamps = [];
  for (const doc of documents) {
    if (!offices.has(doc.currentOfficeId)) invalidCustody.push({ documentId: doc.id, status: doc.status, currentOfficeId: doc.currentOfficeId, resolution: 'Review authoritative custody records; do not infer a replacement office.' });
    if (doc.sendQueue?.some(Boolean)) legacyQueues.push({ documentId: doc.id, status: doc.status, queuedOfficeIds: doc.sendQueue, resolution: 'Confirm intended recipients and complete/reconcile the existing handoff before an explicit resend.' });
    const files = (doc.scannedFiles || []).flatMap(file => [file, ...(file.pages || [])]);
    for (const file of files) {
      const destination = resolveScanPath(file);
      if (!destination) continue;
      try { await fs.access(destination); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const name = path.basename(destination);
      const declared = backupManifest.find(entry => entry.name === name);
      let candidate = null;
      if (declared) {
        const source = path.join(backupRoot, 'scans', name);
        try { if (await digest(source) === declared.sha256) candidate = { source, sha256: declared.sha256, destination }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      missingFiles.push({ documentId: doc.id, fileId: file.id || null, filename: name, hasInlineCoverFallback: /^data:/.test(doc.scannedImageUrl || ''), verifiedBackupCandidate: candidate,
        resolution: candidate ? 'Exact backup candidate verified; restore only after coordinated backup/review.' : 'No exact verified original in the retained backup. Obtain the original; do not fabricate a scan.' });
    }
  }
  for (const transmission of transmissions) {
    if (!transmission.receivedBy || transmission.receivedAt) continue;
    const doc = documents.find(d => d.id === transmission.documentId);
    const candidates = doc ? timestampCandidates(doc, transmission) : [];
    receiptTimestamps.push({ transmissionId: transmission.id, documentId: transmission.documentId, candidates, proposedTimestamp: candidates.length === 1 ? candidates[0] : null,
      resolution: candidates.length === 1 ? 'Review the matching event and record the original value in a rollback manifest before applying.' : 'Timestamp is absent or ambiguous; obtain authoritative receipt evidence.' });
  }
  const summary = { documentsChecked: documents.length, missingStoredFiles: missingFiles.length, verifiedOriginalCandidates: missingFiles.filter(f => f.verifiedBackupCandidate).length,
    missingFilesWithInlineCover: missingFiles.filter(f => f.hasInlineCoverFallback).length, invalidCustody: invalidCustody.length, legacyQueues: legacyQueues.length,
    missingReceiptTimestamps: receiptTimestamps.length, unambiguousTimestampCandidates: receiptTimestamps.filter(r => r.proposedTimestamp).length, productionWrites: 0, appliedRepairs: 0 };
  await fs.mkdir(out, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(out, 'private-manifest.json'), JSON.stringify({ observedAt: new Date().toISOString(), summary, missingFiles, invalidCustody, legacyQueues, receiptTimestamps }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ privateManifestDirectory: out, summary }, null, 2));
  return summary;
};
if (require.main === module) main().catch(error => { console.error('Reconciliation failed:', error.code || error.name); process.exitCode = 1; });
module.exports = { main, timestampCandidates };
