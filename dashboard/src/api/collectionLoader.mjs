// One request per collection, independent commits, and no stale results after invalidation.
export function createCollectionLoader(loaders, { ttlMs = 30000, stableKeys = [] } = {}) {
  const entries = new Map();
  const entryFor = (key) => {
    if (!entries.has(key)) entries.set(key, { version: 0, updatedAt: 0, value: undefined, pending: null });
    return entries.get(key);
  };
  const invalidate = (keys = Object.keys(loaders)) => keys.forEach((key) => {
    const entry = entryFor(key); entry.version += 1; entry.updatedAt = 0;
  });
  const loadOne = async (key, { onData, onState }) => {
    if (!loaders[key]) return;
    const entry = entryFor(key);
    const ttl = stableKeys.includes(key) ? 300000 : ttlMs;
    if (!entry.updatedAt || Date.now() - entry.updatedAt > ttl) {
      onState?.(key, { status: 'loading', error: null });
      if (!entry.pending) {
        entry.pending = (async () => {
          // An event received during a fetch requires one fresh fetch before committing.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const version = entry.version;
            const value = await loaders[key]();
            if (entries.get(key) !== entry) return;
            if (version !== entry.version) continue;
            entry.value = value;
            entry.updatedAt = Date.now();
            return;
          }
          throw new Error('Data changed repeatedly during loading. Please retry this section.');
        })().finally(() => { entry.pending = null; });
      }
      try { await entry.pending; }
      catch (error) {
        if (entries.get(key) === entry) onState?.(key, { status: 'error', error: error.message });
        return;
      }
    }
    if (entries.get(key) !== entry || !entry.updatedAt) return;
    onData?.(key, entry.value);
    onState?.(key, { status: 'ready', error: null });
  };
  return {
    load: (keys, callbacks = {}) => Promise.all([...new Set(keys)].map((key) => loadOne(key, callbacks))),
    invalidate,
    clear: () => entries.clear(),
  };
}

export function sectionsForPage(page, role) {
  const shared = ['notifications'];
  const documents = ['documents', 'transmissions', 'offices', 'documentTypes', 'users'];
  const pages = {
    dashboard: [...documents, 'archives', ...(role === 'Receptionist' ? ['device'] : [])],
    documents: [...documents, 'senderNotifications'],
    'add-document': [...documents, 'senderNotifications'],
    archives: [...documents, 'archives'],
    reports: [...documents, 'archives', 'logs'],
    logs: ['users'],
    'scan-documents': ['device', 'offices', 'documentTypes', 'documents'],
    'device-panel': ['device', 'deviceEvents', 'logs', 'users', 'offices'],
    offices: [...documents],
    users: ['users', 'offices'],
    'document-types': ['documentTypes', 'documents'],
    'profile-settings': ['offices'],
  };
  return [...new Set([...shared, ...(pages[page] || pages.dashboard)])];
}
