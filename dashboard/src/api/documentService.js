import { bootstrapApiBase, recoverApiConnection } from './apiBase';
import { requestWithDeadline } from './httpClient.mjs';
import { createCollectionLoader, sectionsForPage } from './collectionLoader.mjs';
import { collectPages } from './pagination.mjs';

const STORAGE_KEYS = {
  currentUser: 'dp_currentUser',
  authToken: 'dp_authToken',
};

const canUseStorage = () => typeof localStorage !== 'undefined';

const getFromStorage = (key, fallback) => {
  if (!canUseStorage()) return fallback;

  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const saveToStorage = (key, data) => {
  if (!canUseStorage()) return;
  localStorage.setItem(key, JSON.stringify(data));
};

// Auth session lives in sessionStorage so it survives page refreshes but is
// cleared automatically when the browser/tab is closed. That way reopening the
// system always starts at the login page, even if the user forgot to log out.
const canUseSession = () => typeof sessionStorage !== 'undefined';

const getAuthToken = () => {
  if (!canUseSession()) return null;
  return sessionStorage.getItem(STORAGE_KEYS.authToken);
};

const setAuthToken = (token) => {
  if (!canUseSession()) return;
  if (token) {
    sessionStorage.setItem(STORAGE_KEYS.authToken, token);
  } else {
    sessionStorage.removeItem(STORAGE_KEYS.authToken);
  }
};

const saveCurrentUser = (user) => {
  if (!canUseSession()) return;
  if (user) {
    sessionStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(STORAGE_KEYS.currentUser);
  }
};

const getCurrentUser = () => {
  if (!canUseSession()) return null;
  try {
    const data = sessionStorage.getItem(STORAGE_KEYS.currentUser);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const clearAuthSession = () => {
  if (canUseSession()) {
    sessionStorage.removeItem(STORAGE_KEYS.currentUser);
    sessionStorage.removeItem(STORAGE_KEYS.authToken);
  }
  // Clean up any legacy session persisted in localStorage by older versions.
  if (canUseStorage()) {
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    localStorage.removeItem(STORAGE_KEYS.authToken);
  }
};

const notifyAuthExpired = () => {
  clearAuthSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dp_auth_expired'));
  }
};

const clearCachedAppData = () => {
  if (!canUseStorage()) return;
  [
    'dp_documents',
    'dp_transmissions',
    'dp_archives',
    'dp_device',
    'dp_logs',
    'dp_users',
    'dp_offices',
    'dp_documentTypes',
    'dp_notifications',
    'dp_senderNotifications',
  ].forEach(key => localStorage.removeItem(key));
};

const configuredMs = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const performRequest = async (path, options = {}, responseType = 'json') => {
  const token = getAuthToken();
  const { headers = {}, ...rest } = options;
  const isWrite = !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase());
  const timeoutMs = responseType === 'blob'
    ? configuredMs(import.meta.env.VITE_EXPORT_TIMEOUT_MS, 90000)
    : isWrite ? configuredMs(import.meta.env.VITE_UPLOAD_TIMEOUT_MS, 60000)
    : configuredMs(import.meta.env.VITE_READ_TIMEOUT_MS, 15000);
  try {
    const base = await bootstrapApiBase();
    return await requestWithDeadline(`${base}${path}`, {
      timeoutMs, responseType, ...rest,
      headers: { ...(responseType === 'json' ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
  } catch (error) {
    if (error.status === 401 && error.data?.message && path !== '/auth/login') notifyAuthExpired();
    if (['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(error.code)) recoverApiConnection();
    throw error;
  }
};
const apiRequest = (path, options) => performRequest(path, options);
const apiBlobRequest = (path, options) => performRequest(path, options, 'blob');

const buildQuery = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

const createCollectionService = (path) => ({
  getAll(options = {}) {
    return apiRequest(path, options);
  },

  create(item) {
    return apiRequest(path, {
      method: 'POST',
      body: JSON.stringify(item),
    });
  },

  update(id, updates) {
    return apiRequest(`${path}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  delete(id) {
    return apiRequest(`${path}/${id}`, { method: 'DELETE' });
  },
});

const documents = createCollectionService('/documents');
const transmissions = createCollectionService('/transmissions');
const archives = createCollectionService('/archives');
const logs = createCollectionService('/logs');
const offices = createCollectionService('/offices');
const users = createCollectionService('/users');
const documentTypes = createCollectionService('/document-types');
const deviceEvents = createCollectionService('/device-events');
const notifications = createCollectionService('/notifications');
const senderNotifications = createCollectionService('/sender-notifications');

export const documentService = {
  ...documents,

  getPage(params = {}, options = {}) {
    return apiRequest(`/documents${buildQuery(params)}`, options);
  },

  // Complete metadata, never a silently truncated first page. Media is detail-only.
  getAll(options = {}) {
    return collectPages((params, requestOptions) => this.getPage(params, requestOptions), options);
  },

  getById(id, options = {}) {
    return apiRequest(`/documents/${encodeURIComponent(id)}`, options);
  },

  update(updatedDoc) {
    const { _summary, attachmentCount, ...record } = updatedDoc;
    return documents.update(record.id, record);
  },

  verify(id, intakeStatus, rejectionReason = '') {
    return apiRequest(`/documents/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ intakeStatus, rejectionReason }),
    });
  },

  resubmit(id) {
    return apiRequest(`/documents/${id}/resubmit`, {
      method: 'POST',
    });
  },

  processNote(id, action, note = '') {
    return apiRequest(`/documents/${id}/process-note`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    });
  },

  send(id, toOfficeIds = []) {
    return apiRequest(`/documents/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ toOfficeIds }),
    });
  },

  returnToSender(id, note = '') {
    return apiRequest(`/documents/${id}/return-to-sender`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async search(query) {
    const q = query.toLowerCase();
    const all = await this.getAll();
    return all.filter(d =>
      d.subject?.toLowerCase().includes(q) ||
      d.trackingNumber?.toLowerCase().includes(q) ||
      d.senderName?.toLowerCase().includes(q)
    );
  },
};

export const scannerService = {
  createDocument(payload) {
    return apiRequest('/documents/scanner', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const transmissionService = transmissions;
export const archiveService = archives;
export const logService = {
  ...logs,
  getPage(params = {}, options = {}) { return apiRequest(`/logs${buildQuery(params)}`, options); },
  getAll(options = {}) { return collectPages((params, requestOptions) => this.getPage(params, requestOptions), options); },
};
export const officeService = offices;
export const userService = {
  ...users,

  updateProfile(updates) {
    return apiRequest('/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },
};
export const documentTypeService = documentTypes;
export const deviceEventService = deviceEvents;

export const notificationService = {
  ...notifications,

  markRead(id) {
    return apiRequest(`/notifications/${id}/read`, {
      method: 'PUT',
    });
  },

  markAllRead() {
    return apiRequest('/notifications/read-all', {
      method: 'PUT',
    });
  },
};

export const senderNotificationService = {
  ...senderNotifications,

  resend(id) {
    return apiRequest(`/sender-notifications/${id}/resend`, {
      method: 'POST',
    });
  },
};

export const trackingService = {
  track(trackingNumber) {
    return apiRequest(`/public/track/${encodeURIComponent(trackingNumber)}`);
  },
};

export const deviceService = {
  get() {
    return apiRequest('/device');
  },

  update(updates) {
    return apiRequest('/device', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },
};

export const bridgeService = {
  status(payload = {}) {
    return apiRequest(`/device/bridge/status${buildQuery(payload)}`);
  },

  connect(payload = {}) {
    return apiRequest('/device/bridge/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  disconnect(payload = {}) {
    return apiRequest('/device/bridge/disconnect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  probe(payload = {}) {
    return apiRequest(`/device/bridge/probe${buildQuery(payload)}`);
  },

  snapshot(payload = {}) {
    const { signal, ...rest } = payload;
    return apiBlobRequest(`/device/bridge/snapshot${buildQuery(rest)}`, {
      headers: { Accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.5' },
      signal,
    });
  },
};

export const commandService = {
  sendScan(deviceId = 'DEV-001', payload = {}) {
    return apiRequest('/commands', {
      method: 'POST',
      body: JSON.stringify({ deviceId, command: 'SCAN', payload }),
    });
  },

  sendSort(deviceId = 'DEV-001', payload = {}) {
    return apiRequest('/commands', {
      method: 'POST',
      body: JSON.stringify({ deviceId, command: 'SORT', payload }),
    });
  },

  sendMotorTest(deviceId = 'DEV-001', payload = {}) {
    return apiRequest('/commands', {
      method: 'POST',
      body: JSON.stringify({ deviceId, command: 'MOTOR_TEST', payload }),
    });
  },

  sendCameraLight(deviceId = 'DEV-001', payload = {}) {
    return apiRequest('/commands', {
      method: 'POST',
      body: JSON.stringify({ deviceId, command: 'CAMERA_LIGHT', payload }),
    });
  },

  cancelPending(deviceId = 'DEV-001', reason = 'Cancelled by dashboard user.') {
    return apiRequest('/commands/cancel', {
      method: 'POST',
      body: JSON.stringify({ deviceId, reason }),
    });
  },

  checkStatus(id) {
    return apiRequest(`/commands/${id}/status`);
  },
};

export const reportService = {
  exportOfficialReport(payload = {}) {
    return apiBlobRequest(`/reports/export${buildQuery(payload)}`, {
      retries: 0,
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    });
  },
};

export const authService = {
  async login(username, password) {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const user = result.user || result;
    setAuthToken(result.token || null);
    saveCurrentUser(user);
    clearCachedAppData();
    appDataService.clear();
    return user;
  },

  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Still clear the local session even if the audit log request fails.
    }
    clearAuthSession();
    appDataService.clear();
  },

  async getCurrentUser() {
    return getCurrentUser();
  },
};

const collectionLoader = createCollectionLoader({
  documents: () => documentService.getAll(),
  transmissions: () => transmissionService.getAll(),
  archives: () => archiveService.getAll(),
  device: () => ['Admin', 'Mayor', 'Receptionist'].includes(getCurrentUser()?.role) ? deviceService.get() : null,
  logs: () => logService.getAll(),
  users: () => ['Admin', 'Mayor'].includes(getCurrentUser()?.role) ? userService.getAll() : [getCurrentUser()].filter(Boolean),
  offices: () => officeService.getAll(),
  documentTypes: () => documentTypeService.getAll(),
  deviceEvents: () => ['Admin', 'Mayor', 'Receptionist'].includes(getCurrentUser()?.role) ? deviceEventService.getAll() : [],
  notifications: () => notificationService.getAll(),
  senderNotifications: () => senderNotificationService.getAll(),
}, { stableKeys: ['offices', 'documentTypes', 'users'] });

export const appDataService = {
  sectionsForPage,
  load: (keys, callbacks) => collectionLoader.load(keys, callbacks),
  invalidate: (keys) => collectionLoader.invalidate(keys),
  clear: () => collectionLoader.clear(),
};

export const systemService = {
  async getStatus() {
    try {
      return await apiRequest('/status');
    } catch {
      return {
        status: 'API unavailable',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  },
};
