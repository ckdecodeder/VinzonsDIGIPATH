import React, { useEffect, useState } from 'react';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import AppModal from './components/AppModal';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/DashboardHome';
import DocumentList from './pages/DocumentList';
import TransmissionList from './pages/TransmissionList';
import ArchiveList from './pages/ArchiveList';
import OfficeList from './pages/OfficeList';
import UserList from './pages/UserList';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import DeviceControlPanel from './pages/DeviceControlPanel';
import ActivityLogs from './pages/ActivityLogs';
import Scanner from './components/Scanner';
import ReportsPage from './pages/ReportsPage';
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

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('dp_currentUser');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentPage, setCurrentPage] = useState('dashboard');

  const getCurrentRole = () => {
    if (!currentUser) return null;
    switch (currentUser.role) {
      case 'Admin': return 'admin';
      case 'Mayor': return 'mayor';
      case 'Receptionist': return 'receptionist';
      default: return 'receptionist';
    }
  };

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
  const [documentFocusId, setDocumentFocusId] = useState('');
  const [documentStatusFocus, setDocumentStatusFocus] = useState('All');
  const [dismissedNotifications, setDismissedNotifications] = useState(() => {
    const saved = localStorage.getItem('dp_dismissedNotifications');
    return saved ? JSON.parse(saved) : [];
  });

  const loadData = async () => {
    setIsLoadingData(true);
    setDataError('');

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
    } catch (err) {
      setDataError(err.message || 'Unable to load database data. Check that the backend and MongoDB are running.');
    } finally {
      setIsLoadingData(false);
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

    const refreshMs = currentPage === 'device-panel' ? 5000 : 15000;
    const interval = setInterval(() => {
      refreshSystemStatus();
      loadData();
    }, refreshMs);

    return () => clearInterval(interval);
  }, [currentUser?.id, currentPage]);

  useEffect(() => { localStorage.setItem('dp_dismissedNotifications', JSON.stringify(dismissedNotifications)); }, [dismissedNotifications]);
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('dp_currentUser', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('dp_currentUser');
    }
  }, [currentUser]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null);
      setCurrentPage('dashboard');
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

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setDocumentFocusId('');
    setDocumentStatusFocus('All');
  };

  const handleNavigate = (page) => {
    if (page !== 'documents') {
      setDocumentFocusId('');
      setDocumentStatusFocus('All');
    } else {
      setDocumentFocusId('');
      setDocumentStatusFocus('All');
    }
    setCurrentPage(page);
  };

  const handleOpenDocument = (documentId) => {
    if (!documentId) {
      setCurrentPage('documents');
      return;
    }
    setDocumentFocusId(documentId);
    setDocumentStatusFocus('All');
    setCurrentPage('documents');
  };

  const handleOpenDocumentsByStatus = (status = 'All') => {
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
    await loadData();
    return savedDoc;
  };

  const handleEditDocument = async (updated) => {
    const savedDoc = await runMutation(() => documentService.update(updated));
    await loadData();
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
    await loadData();
  };

  const handleAddTransmission = async (transmission) => {
    const savedTransmission = await runMutation(() => transmissionService.create({
      ...transmission,
      transmissionDate: transmission.transmissionDate || new Date().toISOString().split('T')[0],
    }));
    await loadData();
    return savedTransmission;
  };

  const handleUpdateTransmission = async (id, updates) => {
    const savedTransmission = await runMutation(() => transmissionService.update(id, updates));
    await loadData();
    return savedTransmission;
  };

  const handleAddArchive = async (archive) => {
    const savedArchive = await runMutation(() => archiveService.create(archive));
    await loadData();
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
    await loadData();
    return savedDoc;
  };

  const handleVerifyDocument = async (documentId, intakeStatus, rejectionReason = '') => {
    const savedDoc = await runMutation(() => documentService.verify(documentId, intakeStatus, rejectionReason));
    await loadData();
    return savedDoc;
  };

  const handleResubmitDocument = async (documentId) => {
    const savedDoc = await runMutation(() => documentService.resubmit(documentId));
    await loadData();
    return savedDoc;
  };

  const handleProcessDocument = async (documentId, action, note = '') => {
    const savedDoc = await runMutation(() => documentService.processNote(documentId, action, note));
    await loadData();
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
    await loadData();
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
        originOfficeId: newDoc.originOfficeId || newTransmission.fromOfficeId || getUserOfficeId(),
        currentOfficeId: newDoc.currentOfficeId || newTransmission.fromOfficeId || getUserOfficeId(),
        intakeStatus: 'Pending Review',
      },
      attachment,
    }));
    await loadData();
    return saved;
  };

  const handleAddUser = async (user) => {
    const savedUser = await runMutation(() => userService.create(user));
    await loadData();
    return savedUser;
  };

  const handleUpdateUser = async (id, updates) => {
    const savedUser = await runMutation(() => userService.update(id, updates));
    await loadData();
    return savedUser;
  };

  const handleDeleteUser = async (id) => {
    const confirmed = await confirmUser({
      type: 'danger',
      title: 'Delete user?',
      message: 'This removes the user account and prevents future sign-ins with it.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await runMutation(() => userService.delete(id));
    await loadData();
  };

  const handleAddOffice = async (office) => {
    const savedOffice = await runMutation(() => officeService.create(office));
    await loadData();
    return savedOffice;
  };

  const handleUpdateOffice = async (id, updates) => {
    const savedOffice = await runMutation(() => officeService.update(id, updates));
    await loadData();
    return savedOffice;
  };

  const handleDeleteOffice = async (id) => {
    const confirmed = await confirmUser({
      type: 'danger',
      title: 'Delete office?',
      message: 'This removes the office from office lists. Documents already tied to it may keep their historical reference.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await runMutation(() => officeService.delete(id));
    await loadData();
  };

  const isGlobalViewer = currentRole === 'admin' || currentRole === 'mayor';
  const userOfficeId = currentUser?.officeId;

  const canSeeDocument = (doc) => {
    if (!currentUser || isGlobalViewer) return true;
    const touchedByUser = (doc.timeline || []).some((event) => event.userId === currentUser.id) ||
      doc.verifiedBy === currentUser.id;
    const visibleViaTransmission = transmissions.some((transmission) => {
      if (transmission.documentId !== doc.id) return false;
      if (currentRole === 'receptionist') {
        return transmission.sentBy === currentUser.id ||
          transmission.receivedBy === currentUser.id ||
          (transmission.toOfficeId === userOfficeId && !transmission.receivedBy);
      }
      return transmission.fromOfficeId === userOfficeId ||
        transmission.toOfficeId === userOfficeId ||
        transmission.sentBy === currentUser.id ||
        transmission.receivedBy === currentUser.id;
    });

    if (currentRole === 'receptionist') {
      return touchedByUser || visibleViaTransmission;
    }

    return [
      doc.originOfficeId,
      doc.currentOfficeId,
      doc.destinationOfficeId,
    ].includes(userOfficeId) || touchedByUser || visibleViaTransmission;
  };

  const canSeeTransmission = (transmission) => {
    if (!currentUser || isGlobalViewer) return true;
    if (currentRole === 'receptionist') {
      return transmission.sentBy === currentUser.id ||
        transmission.receivedBy === currentUser.id ||
        (transmission.toOfficeId === userOfficeId && !transmission.receivedBy);
    }
    return transmission.fromOfficeId === userOfficeId ||
      transmission.toOfficeId === userOfficeId ||
      transmission.sentBy === currentUser.id ||
      transmission.receivedBy === currentUser.id;
  };

  const visibleDocuments = sortNewest(documents.filter(canSeeDocument), ['createdAt', 'updatedAt', 'dateReceived']);
  const visibleTransmissions = sortNewest(transmissions.filter(canSeeTransmission), ['createdAt', 'updatedAt', 'receivedAt', 'transmissionDate']);
  const visibleArchives = archives.filter((archive) => visibleDocuments.some((doc) => doc.id === archive.documentId));
  const visibleLogs = currentRole === 'admin' || currentRole === 'mayor'
    ? logs
    : logs.filter((log) => log.userId === currentUser?.id || visibleDocuments.some((doc) => doc.id === log.referenceId));

  const getOfficeName = (officeId) => offices.find((office) => office.id === officeId)?.name || 'Unknown Office';
  const getDocument = (documentId) => visibleDocuments.find((doc) => doc.id === documentId) || documents.find((doc) => doc.id === documentId);

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
      .filter((item) => !item.receivedBy)
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

  const pendingTransmissions = visibleTransmissions.filter((item) => !item.receivedBy).length;

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
          onRefresh={loadData}
          logs={visibleLogs}
          users={users}
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
                onOpenDocument={handleOpenDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
          case 'documents':
          case 'add-document':
            return (
              <DocumentList
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
                onRouteDocument={handleAddTransmission}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                initialStatusFilter={documentStatusFocus}
                autoOpenCreate={currentPage === 'add-document'}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <TransmissionList
                transmissions={visibleTransmissions}
                documents={visibleDocuments}
                offices={offices}
                users={users}
                currentUser={currentUser}
                onAdd={handleAddTransmission}
                onUpdate={handleUpdateTransmission}
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
                onAdd={handleAddArchive}
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
                onOpenDocument={handleOpenDocument}
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
                onOpenDocument={handleOpenDocument}
                onStatusSelect={handleOpenDocumentsByStatus}
                currentUser={currentUser}
              />
            );
          case 'documents':
          case 'add-document':
            return (
              <DocumentList
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
                onRouteDocument={handleAddTransmission}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                initialStatusFilter={documentStatusFocus}
                autoOpenCreate={currentPage === 'add-document'}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <TransmissionList
                transmissions={visibleTransmissions}
                documents={visibleDocuments}
                offices={offices}
                users={users}
                currentUser={currentUser}
                onAdd={handleAddTransmission}
                onUpdate={handleUpdateTransmission}
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
                onAdd={handleAddArchive}
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
                onOpenDocument={handleOpenDocument}
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
                onAddTransmission={handleAddTransmission}
                onReceiveTransmission={handleUpdateTransmission}
                onNavigate={handleNavigate}
                onOpenDocument={handleOpenDocument}
                onNotify={notifyUser}
              />
            );
          case 'documents':
            return (
              <DocumentList
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
                onRouteDocument={handleAddTransmission}
                onReceiveTransmission={handleUpdateTransmission}
                onSetDocumentStatus={handleSetDocumentStatus}
                onVerifyDocument={handleVerifyDocument}
                onResubmitDocument={handleResubmitDocument}
                onProcessDocument={handleProcessDocument}
                onArchiveDocument={handleArchiveDocument}
                onResendSenderNotification={handleResendSenderNotification}
                focusDocumentId={documentFocusId}
                initialStatusFilter={documentStatusFocus}
                onNotify={notifyUser}
              />
            );
          case 'transmissions':
            return (
              <TransmissionList
                transmissions={visibleTransmissions}
                documents={visibleDocuments}
                offices={offices}
                users={users}
                currentUser={currentUser}
                onAdd={handleAddTransmission}
                onUpdate={handleUpdateTransmission}
                onNotify={notifyUser}
              />
            );
          default:
            return (
              <ReceptionistDashboard
                documents={visibleDocuments}
                transmissions={visibleTransmissions}
                offices={offices}
                users={users}
                documentTypes={documentTypes}
                currentUser={currentUser}
                onAddDocument={handleAddDocument}
                onAddTransmission={handleAddTransmission}
                onReceiveTransmission={handleUpdateTransmission}
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
    <>
      <Layout
        currentPage={currentPage}
        currentRole={currentRole}
        currentUser={currentUser}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        pendingTransmissions={pendingTransmissions}
        systemStatus={systemStatus}
        dataError={dataError}
        saveError={saveError}
        isLoadingData={isLoadingData}
        notifications={notifications}
        onDismissNotification={handleDismissNotification}
        onNotificationSelect={handleNotificationSelect}
      >
        <ErrorBoundary resetKey={`${currentPage}-${currentUser?.id || ''}`}>
          {renderPage()}
        </ErrorBoundary>
      </Layout>
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

export default App;

