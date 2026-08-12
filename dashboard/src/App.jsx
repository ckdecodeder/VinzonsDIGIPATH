import React, { useCallback, useEffect, useState } from 'react';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import AppModal from './components/AppModal';
import ActionToast from './components/ActionToast';
import {
  getProcessActionToastMessage,
  getStatusToastMessage,
  getTransmissionUpdateToastMessage,
  getVerificationToastMessage,
} from './utils/actionToastMessages';
import {
  isDocumentVisibleToUser,
  isTransmissionVisibleToUser,
} from './utils/documentScope';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/DashboardHome';
import DocumentList from './pages/DocumentList';
import ArchiveList from './pages/ArchiveList';
import OfficeList from './pages/OfficeList';
import UserList from './pages/UserList';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import DeviceControlPanel from './pages/DeviceControlPanel';
import ActivityLogs from './pages/ActivityLogs';
import Scanner from './components/Scanner';
import ReportsPage from './pages/ReportsPage';
import ProfileSettings from './pages/ProfileSettings';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import {
  appDataService,
  archiveService,
  authService,
  documentService,
  notificationService,
  officeService,
  scannerService,
  senderNotificationService,
  systemService,
  transmissionService,
  userService,
} from './api/documentService';
import { sortNewest } from './utils/sorting';
import { RealtimeProvider } from './context/RealtimeContext';
import { realtimeClient } from './ws/realtimeClient';

const PAGE_STORAGE_KEY = 'dp_currentPage';

const ROLE_PAGES = {
  admin: ['dashboard', 'documents', 'add-document', 'archives', 'offices', 'users', 'reports', 'logs', 'device-panel', 'scan-documents', 'profile-settings'],
  mayor: ['dashboard', 'documents', 'add-document', 'archives', 'reports', 'logs', 'profile-settings'],
  office: ['dashboard', 'documents', 'add-document', 'reports', 'logs', 'profile-settings'],
  receptionist: ['dashboard', 'scan-documents', 'documents', 'reports', 'logs', 'profile-settings'],
};

const getRoleKey = (user) => {
  if (!user?.role) return null;
  switch (user.role) {
    case 'Admin': return 'admin';
    case 'Mayor': return 'mayor';
    case 'Office': return 'office';
    case 'Receptionist': return 'receptionist';
    default: return 'receptionist';
  }
};

const resolvePageForRole = (page, role) => {
  const allowed = ROLE_PAGES[role] || ROLE_PAGES.receptionist;
  return allowed.includes(page) ? page : 'dashboard';
};

const getSavedPage = (user) => {
  const role = getRoleKey(user);
  if (!role) return 'dashboard';

  try {
    const saved = localStorage.getItem(PAGE_STORAGE_KEY);
    return resolvePageForRole(saved || 'dashboard', role);
  } catch {
    return 'dashboard';
  }
};

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      // Read from sessionStorage so a closed/reopened browser always lands on
      // the login page, while a simple refresh keeps the active session.
      const saved = sessionStorage.getItem('dp_currentUser');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [currentPage, setCurrentPage] = useState(() => getSavedPage(
    (() => {
      try {
        const saved = sessionStorage.getItem('dp_currentUser');
        return saved ? JSON.parse(saved) : null;
      } catch {
        return null;
      }
    })(),
  ));

  const getCurrentRole = () => getRoleKey(currentUser);

  const currentRole = getCurrentRole();

  const [documents, setDocuments] = useState([]);
  const [transmissions, setTransmissions] = useState([]);
  const [archives, setArchives] = useState([]);
  const [device, setDevice] = useState(null);
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [offices, setOffices] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [deviceEvents, setDeviceEvents] = useState([]);
  const [serverNotifications, setServerNotifications] = useState([]);
  const [senderNotifications, setSenderNotifications] = useState([]);
  const [appDialog, setAppDialog] = useState({
    open: false,
    type: 'info',
    title: '',
    message: '',
  });

  const [systemStatus, setSystemStatus] = useState({ database: 'checking' });
  const [dataError, setDataError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isRefreshingContent, setIsRefreshingContent] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [actionToast, setActionToast] = useState(null);
  const [documentFocusId, setDocumentFocusId] = useState('');
  const [documentFocusKey, setDocumentFocusKey] = useState(0);
  const [documentStatusFocus, setDocumentStatusFocus] = useState('All');
  const [previewDocument, setPreviewDocument] = useState(null);
  const [dismissedNotifications, setDismissedNotifications] = useState(() => {
    const saved = localStorage.getItem('dp_dismissedNotifications');
    return saved ? JSON.parse(saved) : [];
  });

  const loadData = async ({ silent = hasLoadedData, quiet = false } = {}) => {
    if (silent) {
      if (!quiet) {
        setIsRefreshingContent(true);
      }
    } else {
      setIsLoadingData(true);
    }
    if (!silent) {
      setDataError('');
    }

    try {
      const data = await appDataService.loadAll();
      setDocuments(sortNewest(data.documents, ['createdAt', 'updatedAt', 'dateReceived']));
      setTransmissions(sortNewest(data.transmissions, ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']));
      setArchives(sortNewest(data.archives, ['createdAt', 'updatedAt', 'date']));
      setDevice(data.device);
      setLogs(data.logs);
      setUsers(data.users);
      setOffices(data.offices);
      setDocumentTypes(data.documentTypes);
      setDeviceEvents(data.deviceEvents);
      setServerNotifications(data.notifications || []);
      setSenderNotifications(data.senderNotifications || []);
      setHasLoadedData(true);
    } catch (err) {
      if (!silent || !hasLoadedData) {
        setDataError(err.message || 'Unable to load database data. Check that the backend and MongoDB are running.');
      }
    } finally {
      setIsLoadingData(false);
      setIsRefreshingContent(false);
    }
  };

  const refreshSystemStatus = async () => {
    const status = await systemService.getStatus();
    setSystemStatus(status);
  };

  const runMutation = async (operation) => {
    setSaveError('');
    try {
      return await operation();
    } catch (err) {
      const message = err.message || 'The requested action could not be saved.';
      setSaveError(message);
      notifyUser({
        type: 'danger',
        title: 'Action could not be saved',
        message,
      });
      throw err;
    }
  };

  const closeDialog = () => setAppDialog(prev => ({ ...prev, open: false }));

  const notifyUser = ({ type = 'info', title = 'Notice', message = '' }) => {
    setAppDialog({
      open: true,
      type,
      title,
      message,
      confirmLabel: 'OK',
      cancelLabel: '',
      onConfirm: closeDialog,
      onCancel: closeDialog,
    });
  };

  const showActionToast = useCallback((type, message = '') => {
    const defaultMessages = {
      created: 'Created successfully',
      updated: 'Updated successfully',
      saved: 'Saved successfully',
      deleted: 'Deleted successfully',
    };

    setActionToast({
      id: Date.now(),
      type,
      message: message || defaultMessages[type] || defaultMessages.saved,
    });
  }, []);

  const clearActionToast = useCallback(() => setActionToast(null), []);

  const refreshAfterMutation = () => {
    loadData({ quiet: true }).catch(() => {});
  };

  const upsertDocument = (savedDoc) => {
    setDocuments((prev) => sortNewest(
      [savedDoc, ...prev.filter((item) => item.id !== savedDoc.id)],
      ['createdAt', 'updatedAt', 'dateReceived'],
    ));
  };

  const upsertTransmission = (savedTransmission) => {
    setTransmissions((prev) => sortNewest(
      [savedTransmission, ...prev.filter((item) => item.id !== savedTransmission.id)],
      ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate'],
    ));
  };

  const upsertArchive = (savedArchive) => {
    setArchives((prev) => sortNewest(
      [savedArchive, ...prev.filter((item) => item.id !== savedArchive.id)],
      ['createdAt', 'updatedAt', 'date'],
    ));
  };

  const upsertUser = (savedUser) => {
    setUsers((prev) => [savedUser, ...prev.filter((item) => item.id !== savedUser.id)]);
  };

  const upsertOffice = (savedOffice) => {
    setOffices((prev) => [savedOffice, ...prev.filter((item) => item.id !== savedOffice.id)]);
  };

  const confirmUser = ({ type = 'warning', title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) => (
    new Promise(resolve => {
      const closeWith = (answer) => {
        resolve(answer);
        setAppDialog(prev => ({ ...prev, open: false }));
      };
      setAppDialog({
        open: true,
        type,
        title,
        message,
        confirmLabel,
        cancelLabel,
        onConfirm: () => closeWith(true),
        onCancel: () => closeWith(false),
      });
    })
  );

  const getUserOfficeId = () => currentUser?.officeId || 'OFF-001';

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      await refreshSystemStatus();
      if (!cancelled && currentUser) {
        await loadData();
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;

    const offDevice = realtimeClient.on('device:updated', (message) => {
      if (message.device) {
        setDevice((prev) => ({ ...(prev || {}), ...message.device }));
      }
    });

    const offInvalidate = realtimeClient.on('data:invalidate', (message) => {
      const collections = Array.isArray(message?.collections) ? message.collections : [];
      const shouldReload = !collections.length
        || collections.some((name) => ['device', 'device-events', 'documents', 'logs'].includes(name));
      if (shouldReload) {
        loadData({ silent: true, quiet: true });
      }
    });

    return () => {
      offDevice();
      offInvalidate();
    };
  }, [currentUser]);

  useEffect(() => { localStorage.setItem('dp_dismissedNotifications', JSON.stringify(dismissedNotifications)); }, [dismissedNotifications]);
  useEffect(() => {
    if (currentUser && currentPage) {
      localStorage.setItem(PAGE_STORAGE_KEY, currentPage);
    }
  }, [currentPage, currentUser]);
  useEffect(() => {
    if (currentUser) {
      sessionStorage.setItem('dp_currentUser', JSON.stringify(currentUser));
    } else {
      sessionStorage.removeItem('dp_currentUser');
    }
    // Remove any legacy localStorage session so it can never auto-restore.
    localStorage.removeItem('dp_currentUser');
  }, [currentUser]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null);
      setCurrentPage('dashboard');
      setHasLoadedData(false);
      localStorage.removeItem(PAGE_STORAGE_KEY);
      setDataError('Your session expired. Please sign in again.');
    };

    window.addEventListener('dp_auth_expired', handleAuthExpired);
    return () => window.removeEventListener('dp_auth_expired', handleAuthExpired);
  }, []);

  const handleLogin = async (user) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');

    await refreshSystemStatus();
    await loadData();
  };

  const handleLogout = async () => {
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Log out?',
      message: 'You will be signed out of DigiPath and need to sign in again to continue.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
    });
    if (!confirmed) return;

    await authService.logout();
    localStorage.removeItem(PAGE_STORAGE_KEY);
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setHasLoadedData(false);
    setDocumentFocusId('');
    setDocumentStatusFocus('All');
  };

  const handleOpenProfile = () => {
    handleNavigate('profile-settings');
  };

  const handleUpdateProfile = async (updates) => {
    const savedUser = await runMutation(() => userService.updateProfile(updates));
    upsertUser(savedUser);
    setCurrentUser(savedUser);
    showActionToast('updated');
    return savedUser;
  };

  const handleNavigate = (page) => {
    const nextPage = resolvePageForRole(page, currentRole);
    setPreviewDocument(null);
    if (nextPage !== 'documents') {
      setDocumentFocusId('');
      setDocumentStatusFocus('All');
    } else {
      // Sidebar / plain navigate to documents shows the full list, not a focused record
      setDocumentFocusId('');
      setDocumentStatusFocus('All');
    }
    setCurrentPage(nextPage);
  };

  const handleFocusDocumentConsumed = useCallback(() => {
    setDocumentFocusId('');
  }, []);

  const handlePreviewDocument = useCallback((doc) => {
    if (!doc) return;
    setPreviewDocument(doc);
  }, []);

  const handleOpenDocument = (documentId) => {
    if (!documentId) {
      setDocumentFocusId('');
      setDocumentStatusFocus('All');
      setCurrentPage('documents');
      return;
    }
    setDocumentStatusFocus('All');
    setDocumentFocusId(documentId);
    setDocumentFocusKey((key) => key + 1);
    setCurrentPage('documents');
  };

  const handleOpenDocumentsByStatus = (status = 'All') => {
    setPreviewDocument(null);
    setDocumentFocusId('');
    setDocumentStatusFocus(status || 'All');
    setCurrentPage('documents');
  };

  const handleAddDocument = async (doc) => {
    const savedDoc = await runMutation(() => documentService.create({
      ...doc,
      originOfficeId: doc.originOfficeId || getUserOfficeId(),
      currentOfficeId: doc.currentOfficeId || doc.originOfficeId || getUserOfficeId(),
    }));
    upsertDocument(savedDoc);
    showActionToast('created');
    refreshAfterMutation();
    return savedDoc;
  };

  const handleEditDocument = async (updated) => {
    const savedDoc = await runMutation(() => documentService.update(updated));
    upsertDocument(savedDoc);
    showActionToast('updated');
    refreshAfterMutation();
    return savedDoc;
  };

  const handleDeleteDocument = async (id) => {
    const confirmed = await confirmUser({
      type: 'danger',
      title: 'Delete document?',
      message: 'This removes the document record from DigiPath. Continue only if this entry is incorrect or duplicated.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await runMutation(() => documentService.delete(id));
    setDocuments((prev) => prev.filter((item) => item.id !== id));
    showActionToast('deleted');
    refreshAfterMutation();
  };

  const handleAddTransmission = async (transmission) => {
    const savedTransmission = await runMutation(() => transmissionService.create({
      ...transmission,
      transmissionDate: transmission.transmissionDate || new Date().toISOString().split('T')[0],
    }));
    upsertTransmission(savedTransmission);
    showActionToast('created', 'Transmission created successfully');
    refreshAfterMutation();
    return savedTransmission;
  };

  const handleRouteDocument = async (transmission) => {
    // Legacy route handler kept for compatibility — prefer handleSendDocument.
    const toOfficeId = transmission?.toOfficeId;
    const documentId = transmission?.documentId;
    if (!documentId || !toOfficeId) return null;
    return handleSendDocument(documentId, [toOfficeId]);
  };

  const handleSendDocument = async (documentId, toOfficeIds = []) => {
    const savedDoc = await runMutation(() => documentService.send(documentId, toOfficeIds));
    upsertDocument(savedDoc);
    showActionToast('saved', 'Document sent successfully');
    refreshAfterMutation();
    return savedDoc;
  };

  const handleReturnToSender = async (documentId, note = '') => {
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Return to sender?',
      message: 'This marks the rejected external document as returned to the citizen sender.',
      confirmLabel: 'Return to sender',
    });
    if (!confirmed) return null;
    const savedDoc = await runMutation(() => documentService.returnToSender(documentId, note));
    upsertDocument(savedDoc);
    showActionToast('saved', 'Returned to sender');
    refreshAfterMutation();
    return savedDoc;
  };

  const handleUpdateTransmission = async (id, updates) => {
    const savedTransmission = await runMutation(() => transmissionService.update(id, updates));
    upsertTransmission(savedTransmission);
    showActionToast('saved', getTransmissionUpdateToastMessage(updates));
    refreshAfterMutation();
    return savedTransmission;
  };

  const handleAddArchive = async (archive) => {
    const savedArchive = await runMutation(() => archiveService.create(archive));
    upsertArchive(savedArchive);
    showActionToast('created', 'Archived successfully');
    refreshAfterMutation();
    return savedArchive;
  };

  const handleSetDocumentStatus = async (documentId, status) => {
    const doc = documents.find((item) => item.id === documentId);
    if (!doc) return;

    const savedDoc = await runMutation(() => documentService.update({
      ...doc,
      status,
      ...(status === 'Signed' ? { completedAt: new Date().toISOString() } : {}),
    }));
    upsertDocument(savedDoc);
    showActionToast('saved', getStatusToastMessage(status));
    refreshAfterMutation();
    return savedDoc;
  };

  const handleVerifyDocument = async (documentId, intakeStatus, rejectionReason = '') => {
    const savedDoc = await runMutation(() => documentService.verify(documentId, intakeStatus, rejectionReason));
    upsertDocument(savedDoc);
    showActionToast('saved', getVerificationToastMessage(intakeStatus));
    refreshAfterMutation();
    return savedDoc;
  };

  const handleResubmitDocument = async (documentId) => {
    const savedDoc = await runMutation(() => documentService.resubmit(documentId));
    upsertDocument(savedDoc);
    showActionToast('saved', 'Resubmitted successfully');
    refreshAfterMutation();
    return savedDoc;
  };

  const handleProcessDocument = async (documentId, action, note = '') => {
    const savedDoc = await runMutation(() => documentService.processNote(documentId, action, note));
    upsertDocument(savedDoc);
    showActionToast('saved', getProcessActionToastMessage(action));
    refreshAfterMutation();
    return savedDoc;
  };

  const handleArchiveDocument = async (documentId) => {
    const doc = documents.find((item) => item.id === documentId);
    if (!doc) return;

    await handleAddArchive({
      documentId,
      date: new Date().toISOString().split('T')[0],
    });
  };

  const handleResendSenderNotification = async (notificationId) => {
    const saved = await runMutation(() => senderNotificationService.resend(notificationId));
    showActionToast('saved', 'Notification sent successfully');
    refreshAfterMutation();
    return saved;
  };

  const handleScanCapture = async (imageData, text, newDoc, newTransmission) => {
    const attachment = imageData ? {
      name: `${Date.now()}-scan.jpg`,
      type: 'image/jpeg',
      size: imageData.length,
      dataUrl: imageData,
      source: 'camera',
    } : null;

    const saved = await runMutation(() => scannerService.createDocument({
      document: {
        ...newDoc,
        scannedText: text,
        originOfficeId: newDoc.originOfficeId || newTransmission?.fromOfficeId || getUserOfficeId(),
        currentOfficeId: newDoc.currentOfficeId || newDoc.destinationOfficeId || getUserOfficeId(),
        destinationOfficeId: newDoc.destinationOfficeId || newTransmission?.toOfficeId || newDoc.currentOfficeId || '',
        intakeStatus: 'Approved',
        senderEmail: '',
        priorityLevel: 'normal',
      },
      attachment,
    }));
    if (saved?.document) {
      upsertDocument(saved.document);
    }
    showActionToast('created');
    refreshAfterMutation();
    return saved;
  };

  const handleAddUser = async (user) => {
    const fullName = `${user.fname || ''} ${user.lname || ''}`.trim() || user.username;
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Create new user?',
      message: `Add ${fullName} as ${user.role}? This account will be able to sign in to DigiPath.`,
      confirmLabel: 'Create user',
    });
    if (!confirmed) return null;

    const savedUser = await runMutation(() => userService.create(user));
    upsertUser(savedUser);
    showActionToast('created');
    refreshAfterMutation();
    return savedUser;
  };

  const handleUpdateUser = async (id, updates) => {
    const existing = users.find((item) => item.id === id);
    const fullName = existing ? `${existing.fname || ''} ${existing.lname || ''}`.trim() : 'this user';
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Save user changes?',
      message: `Update the account details for ${fullName}?`,
      confirmLabel: 'Save changes',
    });
    if (!confirmed) return null;

    const savedUser = await runMutation(() => userService.update(id, updates));
    upsertUser(savedUser);
    showActionToast('updated');
    refreshAfterMutation();
    return savedUser;
  };

  const handleDeleteUser = async (id) => {
    const existing = users.find((item) => item.id === id);
    const fullName = existing ? `${existing.fname || ''} ${existing.lname || ''}`.trim() : 'this user';
    const confirmed = await confirmUser({
      type: 'danger',
      title: 'Delete user?',
      message: `Remove ${fullName}'s account? They will no longer be able to sign in.`,
      confirmLabel: 'Delete user',
    });
    if (!confirmed) return;

    await runMutation(() => userService.delete(id));
    setUsers((prev) => prev.filter((item) => item.id !== id));
    showActionToast('deleted');
    refreshAfterMutation();
  };

  const handleAddOffice = async (office) => {
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Create new office?',
      message: `Add "${office.name}" to the office list? It will appear in routing, reports, and user assignments.`,
      confirmLabel: 'Create office',
    });
    if (!confirmed) return null;

    const savedOffice = await runMutation(() => officeService.create(office));
    upsertOffice(savedOffice);
    showActionToast('created');
    refreshAfterMutation();
    return savedOffice;
  };

  const handleUpdateOffice = async (id, updates) => {
    const existing = offices.find((item) => item.id === id);
    const confirmed = await confirmUser({
      type: 'warning',
      title: 'Save office changes?',
      message: `Update "${existing?.name || 'this office'}" in the office list?`,
      confirmLabel: 'Save changes',
    });
    if (!confirmed) return null;

    const savedOffice = await runMutation(() => officeService.update(id, updates));
    upsertOffice(savedOffice);
    showActionToast('updated');
    refreshAfterMutation();
    return savedOffice;
  };

  const handleDeleteOffice = async (id) => {
    const existing = offices.find((item) => item.id === id);
    const confirmed = await confirmUser({
      type: 'danger',
      title: 'Delete office?',
      message: `Remove "${existing?.name || 'this office'}" from the office list? Documents already tied to it may keep their historical reference.`,
      confirmLabel: 'Delete office',
    });
    if (!confirmed) return;

    await runMutation(() => officeService.delete(id));
    setOffices((prev) => prev.filter((item) => item.id !== id));
    showActionToast('deleted');
    refreshAfterMutation();
  };

  const canSeeDocument = (doc) => isDocumentVisibleToUser(doc, currentUser, { role: currentRole });

  const canSeeTransmission = (transmission) => isTransmissionVisibleToUser(transmission, currentUser, { role: currentRole });

  const visibleDocuments = sortNewest(documents.filter(canSeeDocument), ['createdAt', 'updatedAt', 'dateReceived']);
  const visibleTransmissions = sortNewest(transmissions.filter(canSeeTransmission), ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']);
  const visibleArchives = archives.filter((archive) => visibleDocuments.some((doc) => doc.id === archive.documentId));
  const visibleLogs = currentRole === 'admin' || currentRole === 'mayor'
    ? logs
    : logs.filter((log) => log.userId === currentUser?.id || visibleDocuments.some((doc) => doc.id === log.referenceId));

  const getOfficeName = (officeId) => offices.find((office) => office.id === officeId)?.name || 'Unknown Office';
  const getDocument = (documentId) => visibleDocuments.find((doc) => doc.id === documentId);

  const overdueTransmissions = visibleTransmissions.filter((item) => {
    if (item.receivedBy || !item.transmissionDate) return false;
    const sentAt = new Date(item.transmissionDate);
    if (Number.isNaN(sentAt.getTime())) return false;
    const ageMs = Date.now() - sentAt.getTime();
    return ageMs > 1000 * 60 * 60 * 24 * 2;
  });

  const serverNotificationItems = serverNotifications
    .filter((item) => !item.isRead && !dismissedNotifications.includes(item.id))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      type: item.type === 'danger' ? 'urgent' : item.type,
      text: item.title ? `${item.title}: ${item.message}` : item.message,
      page: item.page || 'documents',
      referenceType: item.referenceType,
      referenceId: item.referenceId,
      persisted: true,
    }));

  const rawNotifications = [
    ...visibleDocuments
      .filter((doc) => doc.priorityLevel === 'urgent' && doc.status !== 'Archived')
      .slice(0, 3)
      .map((doc) => ({ id: `urgent-${doc.id}`, type: 'urgent', status: doc.status, text: `Urgent: ${doc.subject} is ${doc.status}`, page: 'documents', referenceType: 'document', referenceId: doc.id })),
    ...visibleTransmissions
      .filter((item) => {
        if (item.receivedBy) return false;
        if (currentRole === 'admin' || currentRole === 'mayor') return true;
        return item.toOfficeId === currentUser?.officeId;
      })
      .slice(0, 3)
      .map((item) => {
        const doc = getDocument(item.documentId);
        return {
          id: `pending-${item.id}`,
          type: 'pending',
          status: 'In Transit',
          text: `Pending receipt: ${doc?.trackingNumber || item.id} is waiting for ${getOfficeName(item.toOfficeId)} to acknowledge the route.`,
          page: 'transmissions',
          referenceType: 'transmission',
          referenceId: item.id,
        };
      }),
    ...overdueTransmissions
      .slice(0, 2)
      .map((item) => {
        const doc = getDocument(item.documentId);
        return {
          id: `overdue-${item.id}`,
          type: 'overdue',
          status: 'In Transit',
          text: `Overdue receipt: ${doc?.trackingNumber || item.id} has not been acknowledged by ${getOfficeName(item.toOfficeId)} for more than 2 days.`,
          page: 'transmissions',
          referenceType: 'transmission',
          referenceId: item.id,
        };
      }),
  ];
  const rawNotificationItems = rawNotifications.filter((item) => !dismissedNotifications.includes(item.id));
  const notifications = [
    ...serverNotificationItems,
    ...rawNotificationItems,
  ].slice(0, 12);
  const notificationBadgeCount = serverNotificationItems.length + rawNotificationItems.length;

  const handleDismissNotification = async (id) => {
    const persisted = serverNotifications.some((item) => item.id === id);
    setDismissedNotifications((prev) => [...new Set([...prev, id])]);

    if (!persisted) return;

    try {
      await notificationService.markRead(id);
      setServerNotifications((prev) => prev.map((item) => (
        item.id === id ? { ...item, isRead: true } : item
      )));
    } catch {
      // The local dismissal keeps the alert out of the user's way until the next refresh.
    }
  };

  const handleNotificationSelect = async (item) => {
    const persisted = serverNotifications.some((notification) => notification.id === item.id);

    if (persisted) {
      setServerNotifications((prev) => prev.map((notification) => (
        notification.id === item.id ? { ...notification, isRead: true } : notification
      )));
      try {
        await notificationService.markRead(item.id);
      } catch {
        // ignore failure if the server can't update immediately; local state still hides it.
      }
    } else {
      setDismissedNotifications((prev) => [...new Set([...prev, item.id])]);
    }

    if (item?.referenceType === 'document' && item.referenceId) {
      handleOpenDocument(item.referenceId);
      return;
    }
    setCurrentPage(item?.page || 'documents');
  };

  const pendingTransmissions = visibleTransmissions.filter((item) => {
    if (item.receivedBy) return false;
    // Admin/Mayor: all pending moves. Office/Receptionist: only inbound to their office.
    if (currentRole === 'admin' || currentRole === 'mayor') return true;
    return item.toOfficeId === currentUser?.officeId;
  }).length;

  if (!currentUser) {
    return (
      <>
        <LoginPage onLogin={handleLogin} systemMessage={dataError} onNotify={notifyUser} />
        <AppModal
          open={appDialog.open}
          type={appDialog.type}
          title={appDialog.title}
          message={appDialog.message}
          confirmLabel={appDialog.confirmLabel}
          cancelLabel={appDialog.cancelLabel}
          onConfirm={appDialog.onConfirm}
          onCancel={appDialog.onCancel}
        />
      </>
    );
  }

  const renderPage = () => {
    if (currentPage === 'scan-documents') {
      return (
        <Scanner
          onCapture={handleScanCapture}
          currentUser={currentUser}
          offices={offices}
          documentTypes={documentTypes}
          device={device}
          onEditDocument={handleEditDocument}
        />
      );
    }

    if (currentPage === 'logs') {
      return <ActivityLogs logs={visibleLogs} users={users} />;
    }

    if (currentPage === 'device-panel' && currentRole === 'admin') {
      return (
        <DeviceControlPanel
          device={device}
          onRefresh={() => loadData({ silent: true })}
          logs={visibleLogs}
          users={users}
          offices={offices}
          deviceEvents={deviceEvents}
        />
      );
    }

    if (currentPage === 'reports') {
      return (
        <ReportsPage
          documents={visibleDocuments}
          transmissions={visibleTransmissions}
          archives={visibleArchives}
          offices={offices}
          users={users}
          logs={visibleLogs}
          documentTypes={documentTypes}
          currentRole={currentRole}
          currentUser={currentUser}
          onNotify={notifyUser}
        />
      );
    }

    if (currentPage === 'profile-settings') {
      return (
        <ProfileSettings
          currentUser={currentUser}
          offices={offices}
          onUpdateProfile={handleUpdateProfile}
          onNotify={notifyUser}
        />
      );
    }

    switch (currentRole) {
      case 'admin':
        switch (currentPage) {
          case 'dashboard':
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
          case 'documents':
          case 'add-document':
            return (
              <DocumentList
                key={`documents-${documentFocusKey}`}
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddDocument}
                onEdit={handleEditDocument}
                onDelete={handleDeleteDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                onFocusDocumentConsumed={handleFocusDocumentConsumed}
                initialStatusFilter={documentStatusFocus}
                autoOpenCreate={currentPage === 'add-document'}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <DocumentList
                key={"documents-fallback-{documentFocusKey}"}
                documents={visibleDocuments}
                transmissions={[]}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onDelete={handleDeleteDocument}
                onEdit={handleEditDocument}
                onAdd={handleAddDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                onNotify={notifyUser}
              />
            );
          case 'archives':
            return (
              <ArchiveList
                archives={visibleArchives}
                documents={visibleDocuments}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddArchive}
                onEditDocument={handleEditDocument}
                onNotify={notifyUser}
              />
            );
          case 'offices':
            return (
              <OfficeList
                offices={offices}
                users={users}
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                onAddOffice={handleAddOffice}
                onUpdateOffice={handleUpdateOffice}
                onDeleteOffice={handleDeleteOffice}
              />
            );
          case 'users':
            return (
              <UserList
                users={users}
                offices={offices}
                onAddUser={handleAddUser}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
              />
            );
          default:
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
        }

      case 'mayor':
        switch (currentPage) {
          case 'dashboard':
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
          case 'documents':
          case 'add-document':
            return (
              <DocumentList
                key={`documents-${documentFocusKey}`}
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddDocument}
                onEdit={handleEditDocument}
                onDelete={handleDeleteDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                onFocusDocumentConsumed={handleFocusDocumentConsumed}
                initialStatusFilter={documentStatusFocus}
                autoOpenCreate={currentPage === 'add-document'}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <DocumentList
                key={"documents-fallback-{documentFocusKey}"}
                documents={visibleDocuments}
                transmissions={[]}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onDelete={handleDeleteDocument}
                onEdit={handleEditDocument}
                onAdd={handleAddDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                onNotify={notifyUser}
              />
            );
          case 'archives':
            return (
              <ArchiveList
                archives={visibleArchives}
                documents={visibleDocuments}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddArchive}
                onEditDocument={handleEditDocument}
                onNotify={notifyUser}
              />
            );
          default:
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
        }

      case 'office':
        switch (currentPage) {
          case 'dashboard':
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
          case 'documents':
          case 'add-document':
            return (
              <DocumentList
                key={`documents-${documentFocusKey}`}
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddDocument}
                onEdit={handleEditDocument}
                onDelete={handleDeleteDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                onFocusDocumentConsumed={handleFocusDocumentConsumed}
                initialStatusFilter={documentStatusFocus}
                autoOpenCreate={currentPage === 'add-document'}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <DocumentList
                key={"documents-fallback-{documentFocusKey}"}
                documents={visibleDocuments}
                transmissions={[]}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onDelete={handleDeleteDocument}
                onEdit={handleEditDocument}
                onAdd={handleAddDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                onNotify={notifyUser}
              />
            );
          default:
            return (
              <AdminDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                archives={visibleArchives}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                onNavigate={handleNavigate}
                onPreviewDocument={handlePreviewDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
        }

      case 'receptionist':
        switch (currentPage) {
          case 'dashboard':
          case 'receive-document':
            return (
              <ReceptionistDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                currentUser={currentUser}
                onAddDocument={handleAddDocument}
                onReturnToSender={handleReturnToSender}
                onNavigate={handleNavigate}
                onOpenDocument={handleOpenDocument}
                onNotify={notifyUser}
              />
            );
          case 'documents':
            return (
              <DocumentList
                key={`documents-${documentFocusKey}`}
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                senderNotifications={senderNotifications}
                currentUser={currentUser}
                currentRole={currentRole}
                onAdd={handleAddDocument}
                onEdit={handleEditDocument}
                onDelete={handleDeleteDocument}
                onSendDocument={handleSendDocument}
                onReturnToSender={handleReturnToSender}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                onFocusDocumentConsumed={handleFocusDocumentConsumed}
                initialStatusFilter={documentStatusFocus}
                onNotify={notifyUser}
              />
            );
          default:
            return (
              <ReceptionistDashboard
                documents={visibleDocuments}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                currentUser={currentUser}
                onAddDocument={handleAddDocument}
                onReturnToSender={handleReturnToSender}
                onNavigate={handleNavigate}
                onOpenDocument={handleOpenDocument}
                onNotify={notifyUser}
              />
            );
        }

      default:
        return null;
    }
  };

  return (
    <RealtimeProvider enabled={Boolean(currentUser)}>
      <Layout
        currentPage={currentPage}
        currentRole={currentRole}
        currentUser={currentUser}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        onOpenProfile={handleOpenProfile}
        pendingTransmissions={pendingTransmissions}
        dataError={dataError}
        saveError={saveError}
        isLoadingContent={isLoadingData && !hasLoadedData}
        isRefreshingContent={isRefreshingContent}
        notifications={notifications}
        onDismissNotification={handleDismissNotification}
        onNotificationSelect={handleNotificationSelect}
      >
        <ErrorBoundary resetKey={`${currentPage}-${currentUser?.id || ''}`}>
          {renderPage()}
        </ErrorBoundary>
      </Layout>
      {previewDocument && (
        <DocumentPreviewModal
          doc={visibleDocuments.find((item) => item.id === previewDocument.id) || previewDocument}
          offices={offices}
          users={users}
          documentTypes={documentTypes}
          transmissions={visibleTransmissions}
          currentUser={currentUser}
          onClose={() => setPreviewDocument(null)}
        />
      )}
      <AppModal
        open={appDialog.open}
        type={appDialog.type}
        title={appDialog.title}
        message={appDialog.message}
        confirmLabel={appDialog.confirmLabel}
        cancelLabel={appDialog.cancelLabel}
        onConfirm={appDialog.onConfirm}
        onCancel={appDialog.onCancel}
      />
      <ActionToast toast={actionToast} onDone={clearActionToast} />
    </RealtimeProvider>
  );
}

export default App;

