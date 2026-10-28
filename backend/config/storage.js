const path = require('node:path');

// Writers, readers and Express static serving must share this root.
const defaultUploadsRoot = path.join(__dirname, '..', 'uploads');
const uploadsRoot = path.resolve(process.env.UPLOADS_ROOT || defaultUploadsRoot);
const scansRoot = path.join(uploadsRoot, 'scans');

const resolveScanPath = (attachment) => {
  const stored = attachment?.storagePath;
  let name;
  if (stored) {
    const normalized = stored.replaceAll('\\', '/');
    if (normalized.startsWith('uploads/scans/')) name = normalized.slice('uploads/scans/'.length);
    else if (path.isAbsolute(stored)) {
      // Rebase historical absolute paths when using a restored storage copy.
      for (const root of [scansRoot, path.join(defaultUploadsRoot, 'scans')]) {
        const relative = path.relative(root, stored);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) { name = relative; break; }
      }
    }
  } else {
    name = String(attachment?.url || '').match(/\/uploads\/scans\/([^/?#]+)(?:[?#].*)?$/)?.[1];
  }
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  return path.join(scansRoot, name);
};

module.exports = { uploadsRoot, scansRoot, resolveScanPath };
