import { getApiBase } from './apiBase';

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

const parseResponse = async (res) => {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const apiRequest = async (path, options = {}) => {
  const token = getAuthToken();
  const { headers = {}, ...fetchOptions } = options;

  const res = await fetch(`${getApiBase()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...fetchOptions,
  });
  const data = await parseResponse(res);

  if (!res.ok) {
    const message = data?.message || data?.error || `API request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    if (res.status === 401 && path !== '/auth/login') {
      notifyAuthExpired();
    }
    throw error;
  }

  return data;
};

const apiBlobRequest = async (path, options = {}) => {
  const token = getAuthToken();
  const { headers = {}, ...fetchOptions } = options;

  const res = await fetch(`${getApiBase()}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...fetchOptions,
  });

  if (!res.ok) {
    const data = await parseResponse(res);
    const message = data?.message || data?.error || `API request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    if (res.status === 401) {
      notifyAuthExpired();
    }
    throw error;
  }

  return res.blob();
};

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
  getAll() {
    return apiRequest(path);
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

  getById(id) {
    return apiRequest(`/documents/${id}`);
  },

  update(updatedDoc) {
    return documents.update(updatedDoc.id, updatedDoc);
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
export const logService = logs;
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
    return user;
  },

  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Still clear the local session even if the audit log request fails.
    }
    clearAuthSession();
  },

  async getCurrentUser() {
    return getCurrentUser();
  },
};

export const appDataService = {
  async loadAll() {
    const currentUser = getCurrentUser();
    const usersRequest = currentUser?.role === 'Admin' || currentUser?.role === 'Mayor'
      ? userService.getAll()
      : Promise.resolve(currentUser ? [currentUser] : []);
    // Device APIs are Admin/Mayor/Receptionist only — Office staff must not hit them on bootstrap.
    const canAccessDevice = ['Admin', 'Mayor', 'Receptionist'].includes(currentUser?.role);

    const [
      documentsData,
      transmissionsData,
      archivesData,
      deviceData,
      logsData,
      usersData,
      officesData,
      documentTypesData,
      deviceEventsData,
      notificationsData,
      senderNotificationsData,
    ] = await Promise.all([
      documentService.getAll(),
      transmissionService.getAll(),
      archiveService.getAll(),
      canAccessDevice ? deviceService.get() : Promise.resolve(null),
      logService.getAll(),
      usersRequest,
      officeService.getAll(),
      documentTypeService.getAll(),
      canAccessDevice ? deviceEventService.getAll() : Promise.resolve([]),
      notificationService.getAll(),
      senderNotificationService.getAll(),
    ]);

    return {
      documents: documentsData || [],
      transmissions: transmissionsData || [],
      archives: archivesData || [],
      device: deviceData || null,
      logs: logsData || [],
      users: usersData || [],
      offices: officesData || [],
      documentTypes: documentTypesData || [],
      deviceEvents: deviceEventsData || [],
      notifications: notificationsData || [],
      senderNotifications: senderNotificationsData || [],
    };
  },
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
