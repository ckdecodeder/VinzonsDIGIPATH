import { focusFormError } from '../utils/formAccessibility';
import { matchesQueue, queueFilters } from '../utils/documentQueue';
import { createSubmissionGate } from '../utils/submissionGate';
import { getSendRecipients, confirmsDocumentSend, sendDocumentWithRecovery } from '../utils/documentSend';
import React, { useId, useEffect, useRef, useState } from 'react';
import { documentService, senderNotificationService } from '../api/documentService';
import PageShell from '../components/PageShell';
import DocumentHandoffSummary from '../components/DocumentHandoffSummary';
import ModalOverlay from '../components/ModalOverlay';
import ScannedPreviewModal from '../components/ScannedPreviewModal';
import {
  Search, Trash2, Edit2, Inbox, Send, Eye, FileText, Plus, X,
  User, Phone, MessageSquare, ChevronDown, ChevronUp,
  Paperclip, Upload, Download, MapPin, History,
  CheckCircle2, Archive, Clock, CalendarDays, AlertTriangle,
} from 'lucide-react';
import {
  documentTypes as defaultDocumentTypes,
  offices as defaultOffices,
  users as defaultUsers,
  priorityLevels as defaultPriorityLevels,
} from '../data/mockData';
import { compareOldest } from '../utils/sorting';
import { validateRequiredFields, clearFieldError } from '../utils/formValidation';
import {
  canAcknowledgeDocument as canAcknowledgeByWorkflow,
  canArchiveDocument as canArchiveByWorkflow,
  canRejectDocument as canRejectByWorkflow,
  canSignDocument as canSignByWorkflow,
  canTakeDocumentAction as canActByWorkflow,
  isOfficeReadOnlyTracking,
} from '../utils/documentActionRules';

const priorityLevels = ['All', ...defaultPriorityLevels.map(level => level.label)];

const OTHER_OFFICE_VALUE = '__external_source__';

const DocumentList = ({
  documents,
  transmissions = [],
  offices = defaultOffices,
  users = defaultUsers,
  documentTypes = defaultDocumentTypes,
  currentUser,
  currentRole,
  onDelete,
  onEdit,
  onAdd,
  onSendDocument,
  onSendReconciled,
  pendingSendAttempts,
  onRouteDocument,
  onReceiveTransmission,
  onVerifyDocument,
  onResubmitDocument,
  onReturnToSender,
  onProcessDocument,
  onArchiveDocument,
  senderNotifications = [],
  onResendSenderNotification,
  focusDocumentId = '',
  initialStatusFilter = 'All',
  autoOpenCreate = false,
  onFocusDocumentConsumed,
  onNotify,
}) => {
  const formId = useId();
  const sendDocument = onSendDocument || (async (documentId, toOfficeIds) => {
    if (onRouteDocument && toOfficeIds?.[0]) {
      return onRouteDocument({ documentId, toOfficeIds, toOfficeId: toOfficeIds[0], fromOfficeId: currentUser?.officeId });
    }
    return null;
  });

  const getInitialForm = () => {
    const myOfficeId = currentUser?.officeId || offices[0]?.id || 'OFF-001';
    const defaultDestination = offices.find(o => o.id !== myOfficeId)?.id || '';
    const isOffice = currentRole === 'office' || currentUser?.role === 'Office';
    const isReceptionist = currentRole === 'receptionist' || currentUser?.role === 'Receptionist';
    const mayorsOfficeId = offices.find(o => o.name?.toLowerCase().includes('mayor'))?.id || 'OFF-001';
    return {
      subject: '',
      documentDirection: isOffice ? 'Outgoing' : 'Incoming',
      status: 'Received',
      priorityLevel: 'normal',
      dateReceived: new Date().toISOString().split('T')[0],
      documentTypeId: documentTypes[0]?.id || 'DT-001',
      documentTypeOther: '',
      originOfficeId: myOfficeId,
      originOfficeOther: '',
      currentOfficeId: myOfficeId,
      destinationOfficeId: (isReceptionist || isOffice) ? defaultDestination : '',
      destinationOfficeOther: '',
      senderName: isOffice
        ? `${currentUser?.fname || ''} ${currentUser?.lname || ''}`.trim()
        : '',
      senderContact: '',
      senderEmail: '',
      notifySender: !isOffice,
      senderNotificationConsent: true,
      senderNotificationChannels: ['sms'],
      remarks: '',
      scannedText: '',
    };
  };

  const notify = (message, title = 'Action needed', type = 'warning') => {
    onNotify?.({ type, title, message });
  };

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterDirection, setFilterDirection] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');
  const [filterDate, setFilterDate] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const documentSubmitGate = useRef(null);
  if (!documentSubmitGate.current) documentSubmitGate.current = createSubmissionGate(setIsSavingDocument);
  const [editDoc, setEditDoc] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [sortBy, setSortBy] = useState('dateReceived');
  const [sortAsc, setSortAsc] = useState(false);
  const [formData, setFormData] = useState(getInitialForm);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [formScannedFiles, setFormScannedFiles] = useState([]);
  const [downloadFormats, setDownloadFormats] = useState({});
  const [routeDoc, setRouteDoc] = useState(null);
  const [detailDoc, setDetailDoc] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [smsHistory, setSmsHistory] = useState([]);
  const [smsError, setSmsError] = useState('');
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsReady, setSmsReady] = useState(false);
  const [smsRetry, setSmsRetry] = useState(0);
  const [smsSending, setSmsSending] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [rejectDoc, setRejectDoc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [processingAction, setProcessingAction] = useState(null);
  const [processingNote, setProcessingNote] = useState('');
  const [processingError, setProcessingError] = useState('');
  const [documentFormErrors, setDocumentFormErrors] = useState({});
  const [documentFormErrorSummary, setDocumentFormErrorSummary] = useState('');
  const [sendCustodyOfficeId, setSendCustodyOfficeId] = useState('');
  const [sendCopyOfficeIds, setSendCopyOfficeIds] = useState([]);
  const [routeError, setRouteError] = useState('');
  const [routeAttempt, setRouteAttempt] = useState(null);
  const [isSendingDocument, setIsSendingDocument] = useState(false);
  const routeFormRef = useRef(null);
  const routeSubmitGate = useRef(null);
  if (!routeSubmitGate.current) routeSubmitGate.current = createSubmissionGate(setIsSendingDocument);
  // shortcut: attempts are session-local; recovery across reloads needs server idempotency.
  const localSendAttempts = useRef(new Map());
  const sendAttempts = pendingSendAttempts || localSendAttempts.current;
  const [receivingDocumentId, setReceivingDocumentId] = useState('');

  const detailVersion = documents.find((item) => item.id === detailDoc?.id)?.updatedAt;
  const smsVersion = senderNotifications.filter(item => item.documentId === detailDoc?.id)
    .map(item => `${item.id}:${item.status}:${item.metadata?.deliveryAttempts}:${item.errorMessage}`).join('|');
  useEffect(() => {
    if (!detailDoc) return undefined;
    const controller = new AbortController();
    setDetailLoading(true); setDetailError('');
    documentService.getById(detailDoc.id, { signal: controller.signal }).then(setDetailDoc).catch((error) => {
      if (error.code !== 'ABORTED') setDetailError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [detailDoc?.id, detailVersion, detailRetry]);

  useEffect(() => {
    if (!detailDoc?.id) return undefined;
    const controller = new AbortController();
    const id = detailDoc.id;
    setSmsHistory([]); setSmsLoading(true); setSmsError(''); setSmsReady(false);
    Promise.all([
      senderNotificationService.forDocument(id, { signal: controller.signal }),
      senderNotificationService.status({ signal: controller.signal }),
    ]).then(([items, status]) => {
      if (!controller.signal.aborted) { setSmsHistory(items); setSmsReady(status.ready); }
    }).catch(error => {
      if (!controller.signal.aborted) setSmsError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setSmsLoading(false); });
    return () => controller.abort();
  }, [detailDoc?.id, detailVersion, smsVersion, smsRetry]);

  const requeueSms = async id => {
    if (smsSending) return;
    setSmsSending(id); setSmsError('');
    try {
      await (onResendSenderNotification ? onResendSenderNotification(id) : senderNotificationService.resend(id));
      setSmsRetry(value => value + 1);
    } catch (error) { setSmsError(error.message); }
    finally { setSmsSending(''); }
  };

  useEffect(() => {
    if (!initialStatusFilter) return;
    setFilterStatus(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (!focusDocumentId) return;
    const focusedDoc = documents.find((doc) => doc.id === focusDocumentId);
    if (!focusedDoc) return;

    setFilterStatus('All');
    setFilterDirection('All');
    setFilterPriority('All');
    setSearch('');
    setPage(1);
    setDetailDoc(focusedDoc);
    onFocusDocumentConsumed?.();
  }, [focusDocumentId, documents, onFocusDocumentConsumed]);

  useEffect(() => {
    setPage(1);
  }, [search, filterStatus, filterDirection, filterPriority, filterDate]);

  const registrationStatuses = ['Received', 'For Signing', 'For Filing'];
  const finalWorkflowStatuses = ['Signed', 'Acknowledged'];
  const transmittableStatuses = [...registrationStatuses, ...finalWorkflowStatuses];
  const statuses = ['All', ...queueFilters, 'In Transit', 'Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Completed', 'Archived', 'Returned to Sender'];
  const directions = currentRole === 'receptionist'
    ? ['All', 'Incoming']
    : currentRole === 'office'
      ? ['All', 'Outgoing']
      : ['All', 'Incoming', 'Outgoing'];
  const priorities = priorityLevels;

  const getWorkflowStatus = (value) => {
    const status = typeof value === 'string' ? value : value?.status;
    if (status === 'For Signature') return 'For Signing';
    if (status === 'Acknoweledged') return 'Acknowledged';
    return status || 'Received';
  };

  const getStatusClass = (status) => getWorkflowStatus(status).toLowerCase().replace(/\s+/g, '-');

  const getTableStatusDisplay = (doc) => {
    const intake = doc.intakeStatus || 'Approved';
    if (intake === 'Returned to Sender') {
      return { label: 'Returned to Sender', className: 'handoff-revision-badge' };
    }
    if (intake === 'Rejected') {
      return { label: 'Correction required', className: 'handoff-revision-badge' };
    }
    if (doc.status === 'Completed' || doc.status === 'Archived') {
      return { label: doc.status, className: `status-${getStatusClass(doc)}` };
    }
    const delivery = (doc.sendHistory || []).find((event) => event.recipientOfficeId === currentUser?.officeId);
    if (delivery?.active) return { label: 'Awaiting receipt', className: 'status-in-transit' };
    if (delivery?.receivedBy && doc.currentOfficeId !== currentUser?.officeId) return { label: 'Received copy', className: 'status-received' };
    return {
      label: getWorkflowStatus(doc),
      className: `status-${getStatusClass(doc)}`,
    };
  };

  const isOtherDocumentType = (typeId) => {
    const docType = documentTypes.find(d => d.id === typeId);
    return docType?.category?.toLowerCase().includes('other');
  };

  const getDocTypeName = (typeId) => {
    const docType = documentTypes.find(d => d.id === typeId);
    return docType ? docType.category : 'Unknown';
  };

  const getDocumentTypeLabel = (doc) => {
    const label = getDocTypeName(doc.documentTypeId);
    return label === 'Others' && doc.documentTypeOther ? doc.documentTypeOther : label;
  };

  const getOfficeName = (officeId) => {
    const office = offices.find(o => o.id === officeId);
    return office ? office.name : 'Unknown Office';
  };

  const getOriginOfficeLabel = (doc) => doc.originOfficeOther || getOfficeName(doc.originOfficeId);
  const getDeliveryRecipients = (doc) => (doc.sendHistory || []).filter((event) => event.recipientOfficeId);
  const getDestinationOfficeLabel = (doc) => getDeliveryRecipients(doc).map((event) => getOfficeName(event.toOfficeId)).join(', ')
    || doc.destinationOfficeOther || (doc.destinationOfficeId ? getOfficeName(doc.destinationOfficeId) : '-');
  const renderDeliveryStatus = (doc) => {
    const recipients = getDeliveryRecipients(doc);
    const currentDeliveryIds = new Set(recipients.map((event) => event.transmissionId || event.id));
    const earlierSends = currentUser?.role === 'Office' && currentUser.officeId
      ? transmissions.filter((item) => item.documentId === doc.id
        && item.fromOfficeId === currentUser.officeId && !currentDeliveryIds.has(item.id))
      : [];
    const deliveries = [
      ...recipients.map((event) => ({ ...event, note: event.primary ? 'Custody destination' : '' })),
      ...earlierSends.map((item) => ({ ...item, note: 'Sent by your office' })),
    ];
    if (!deliveries.length) return null;
    return <div className="document-detail-section document-deliveries-section">
      <h4><Send size={14} /> Office Deliveries</h4>
      {deliveries.map((event) => <div key={event.id} className="detail-pair">
        <span>{getOfficeName(event.toOfficeId)}{event.note && <small className="document-delivery-custody">{event.note}</small>}</span>
        <strong>{event.receivedBy ? <>
          Received
          {event.receivedAt && <time dateTime={event.receivedAt}>{formatDateTime(event.receivedAt)}</time>}
        </> : 'Awaiting receipt'}</strong>
      </div>)}
    </div>;
  };

  const getUserFullName = (userId) => {
    const user = users.find(u => u.id === userId);
    return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : 'Unknown';
  };

  const getDocumentFiles = (doc) => {
    if (!doc) return [];
    if (doc.scannedFiles?.length) return doc.scannedFiles;
    if (doc.scannedImageUrl) {
      return [{
        id: `${doc.id}-scan`,
        name: `${doc.trackingNumber || doc.id}-scan.jpg`,
        type: 'image/jpeg',
        url: doc.scannedImageUrl.startsWith('data:') ? undefined : doc.scannedImageUrl,
        dataUrl: doc.scannedImageUrl.startsWith('data:') ? doc.scannedImageUrl : undefined,
        uploadedAt: doc.dateReceived,
        uploadedBy: null,
        source: 'camera',
      }];
    }
    return [];
  };

  const getSenderNotifications = (documentId) => {
    return (detailDoc?.id === documentId ? smsHistory : senderNotifications)
      .filter(item => item.documentId === documentId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  };

  const toggleSenderChannel = (channel) => {
    setFormData(prev => {
      const channels = prev.senderNotificationChannels || [];
      return {
        ...prev,
        senderNotificationChannels: channels.includes(channel)
          ? channels.filter(item => item !== channel)
          : [...channels, channel],
      };
    });
  };

  const getLatestTransmission = (documentId) => {
    return [...transmissions]
      .filter(t => t.documentId === documentId)
      .sort((a, b) => new Date(b.receivedAt || b.transmissionDate || 0) - new Date(a.receivedAt || a.transmissionDate || 0))[0];
  };

  const getPendingTransmission = (documentId) => {
    return [...transmissions]
      .filter(t => t.documentId === documentId && !t.receivedBy)
      .sort((a, b) => Number(b.toOfficeId === currentUser?.officeId) - Number(a.toOfficeId === currentUser?.officeId)
        || new Date(b.transmissionDate || 0) - new Date(a.transmissionDate || 0))[0];
  };

  const getCurrentLocation = (doc, summarizeDeliveries = false) => {
    const pending = getPendingTransmission(doc.id);
    const latest = getLatestTransmission(doc.id);

    const pendingOffices = getDeliveryRecipients(doc).filter((event) => event.active).map((event) => getOfficeName(event.toOfficeId));
    if (summarizeDeliveries && pendingOffices.length > 1) return `At ${getOfficeName(doc.currentOfficeId)} — ${pendingOffices.length} offices awaiting receipt`;
    if (pendingOffices.length) return `At ${getOfficeName(doc.currentOfficeId)} — awaiting receipt: ${pendingOffices.join(', ')}`;
    if (doc.status === 'In Transit' && pending) {
      const detected = doc.lastDetectedOfficeId
        ? ` (last detected at ${getOfficeName(doc.lastDetectedOfficeId)})`
        : '';
      return `At ${getOfficeName(doc.currentOfficeId)} — in transit to ${getOfficeName(pending.toOfficeId)}${detected}`;
    }

    return getOfficeName(
      doc.currentOfficeId ||
      (latest?.receivedBy ? latest.toOfficeId : latest?.fromOfficeId) ||
      doc.originOfficeId
    );
  };

  const getTimeline = (doc) => {
    if (doc.timeline?.length) {
      return [...doc.timeline].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    const derived = [{
      id: `${doc.id}-registered`,
      label: 'Registered',
      details: `Document registered with tracking number ${doc.trackingNumber}`,
      officeId: doc.originOfficeId || currentUser?.officeId,
      userId: null,
      timestamp: doc.dateReceived,
    }];

    transmissions
      .filter(t => t.documentId === doc.id)
      .forEach(t => {
        derived.push({
          id: `${t.id}-sent`,
          label: 'Routed to office',
          details: `Sent from ${getOfficeName(t.fromOfficeId)} to ${getOfficeName(t.toOfficeId)}`,
          officeId: t.fromOfficeId,
          userId: t.sentBy,
          referenceId: t.id,
          timestamp: t.transmissionDate,
        });

        if (t.receivedBy) {
          derived.push({
            id: `${t.id}-received`,
            label: 'Received and acknowledged',
            details: `Received at ${getOfficeName(t.toOfficeId)}`,
            officeId: t.toOfficeId,
            userId: t.receivedBy,
            referenceId: t.id,
            timestamp: t.receivedAt || t.transmissionDate,
          });
        }
      });

    if (getWorkflowStatus(doc) === 'Archived') {
      derived.push({
        id: `${doc.id}-archived`,
        label: 'Archived',
        details: 'Document moved to archive records',
        officeId: doc.currentOfficeId,
        timestamp: doc.archivedAt || doc.dateReceived,
      });
    }

    return derived.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  };

  const filteredDocs = documents
    .filter(d => {
      const term = search.toLowerCase();
      const matchSearch = !term ||
        (d.subject || '').toLowerCase().includes(term) ||
        (d.trackingNumber || '').toLowerCase().includes(term) ||
        (d.senderName || '').toLowerCase().includes(term) ||
        (d.originOfficeOther || '').toLowerCase().includes(term) ||
        (d.documentTypeOther || '').toLowerCase().includes(term) ||
        getDocumentTypeLabel(d).toLowerCase().includes(term) ||
        getOfficeName(d.originOfficeId).toLowerCase().includes(term) ||
        getCurrentLocation(d).toLowerCase().includes(term);
      const matchStatus = matchesQueue(d, filterStatus, currentUser, transmissions, documentTypes);
      const matchDir = filterDirection === 'All' || d.documentDirection === filterDirection;
      const priority = (d.priorityLevel || 'normal').toLowerCase();
      const matchPriority = filterPriority === 'All' || priority === filterPriority.toLowerCase();
      const receivedDate = d.dateReceived || '';
      const matchDate = !filterDate || receivedDate === filterDate;
      return matchSearch && matchStatus && matchDir && matchPriority && matchDate;
    })
    .sort((a, b) => {
      if (sortBy === 'updatedAt') {
        const diff = compareOldest(a, b, ['updatedAt', 'createdAt', 'dateReceived']);
        return sortAsc ? diff : -diff;
      }
      // FIFO by default: oldest registration first
      if (sortBy === 'dateReceived' || sortBy === 'createdAt') {
        const fifo = compareOldest(a, b, ['createdAt', 'dateReceived', 'updatedAt']);
        return sortAsc === false ? -fifo : fifo;
      }
      if (sortBy === 'subject') {
        const diff = (a.subject || '').localeCompare(b.subject || '');
        return sortAsc ? diff : -diff;
      }
      if (sortBy === 'status') {
        const diff = getWorkflowStatus(a).localeCompare(getWorkflowStatus(b));
        return sortAsc ? diff : -diff;
      }
      return compareOldest(a, b, ['createdAt', 'dateReceived', 'updatedAt']);
    });

  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / pageSize));
  const paginatedDocs = filteredDocs.slice((page - 1) * pageSize, page * pageSize);
  const showFrom = filteredDocs.length ? (page - 1) * pageSize + 1 : 0;
  const showTo = Math.min(filteredDocs.length, page * pageSize);

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    setPage(Math.max(1, Math.min(totalPages, newPage)));
  };

  const fileToAttachment = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUser?.id || null,
      source: 'upload',
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleOpenForm = async (doc = null) => {
    if (doc?._summary) {
      try { doc = await documentService.getById(doc.id); }
      catch (error) { notify(error.message, 'Unable to open document', 'danger'); return; }
    }
    setAttachmentFile(null);
    setDocumentFormErrors({});
    setDocumentFormErrorSummary('');
    if (doc) {
      setEditDoc(doc);
      setFormScannedFiles(getDocumentFiles(doc));
      setFormData({
        subject: doc.subject,
        documentDirection: doc.documentDirection,
        status: getWorkflowStatus(doc),
        priorityLevel: doc.priorityLevel || 'normal',
        dateReceived: doc.dateReceived,
        documentTypeId: doc.documentTypeId,
        documentTypeOther: doc.documentTypeOther || '',
        originOfficeId: doc.originOfficeId || doc.currentOfficeId || currentUser?.officeId || offices[0]?.id,
        originOfficeOther: doc.originOfficeOther || '',
        currentOfficeId: doc.currentOfficeId || doc.originOfficeId || currentUser?.officeId || offices[0]?.id,
        destinationOfficeId: doc.destinationOfficeId || '',
        destinationOfficeOther: doc.destinationOfficeOther || '',
        senderName: doc.senderName || '',
        senderContact: doc.senderContact || '',
        senderEmail: doc.senderEmail || '',
        notifySender: doc.notifySender ?? true,
        senderNotificationConsent: doc.senderNotificationConsent ?? true,
        senderNotificationChannels: doc.senderNotificationChannels?.length ? doc.senderNotificationChannels : ['sms', 'email'],
        remarks: doc.remarks || '',
        scannedText: doc.scannedText || '',
      });
    } else {
      setEditDoc(null);
      setFormScannedFiles([]);
      setFormData(getInitialForm());
    }
    setShowForm(true);
  };

  useEffect(() => {
    if (!autoOpenCreate) return;
    handleOpenForm();
  }, [autoOpenCreate]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    return documentSubmitGate.current(async () => {

      const hasExistingAttachment = Boolean(formScannedFiles.length || editDoc?.scannedImageUrl);
      const isOfficeStaff = currentUser?.role === 'Office';
      const requiredFields = [
        { key: 'subject', label: 'Document subject', value: formData.subject },
        {
          key: 'documentTypeOther',
          label: 'Document type',
          value: formData.documentTypeOther,
          when: isOtherDocumentType(formData.documentTypeId),
        },
        { key: 'senderName', label: 'Sender name', value: formData.senderName },
        {
          key: 'attachmentFile',
          label: 'Scanned file attachment',
          value: attachmentFile?.name || (formScannedFiles.length || hasExistingAttachment ? 'existing' : ''),
        },
        {
          key: 'destinationOfficeId',
          label: 'Destination office',
          value: formData.destinationOfficeId,
          when: (isOfficeStaff || currentUser?.role === 'Receptionist') && !editDoc,
        },
      ];
      const validation = validateRequiredFields(requiredFields);

      if (!validation.isValid) {
        setDocumentFormErrors(validation.errors);
        setDocumentFormErrorSummary(validation.summary);
        focusFormError(form);
        return;
      }

      setDocumentFormErrors({});
      setDocumentFormErrorSummary('');

      try {
        const newFiles = attachmentFile ? [await fileToAttachment(attachmentFile)] : [];
        const nextScannedFiles = [...formScannedFiles, ...newFiles];
        if (!nextScannedFiles.length) {
          setDocumentFormErrors({ attachmentFile: 'Attach at least one scanned file.' });
          setDocumentFormErrorSummary('A scanned file attachment is required.');
          focusFormError(form);
          return;
        }

        const isReceptionist = currentUser?.role === 'Receptionist';
        const myOfficeId = currentUser?.officeId || formData.currentOfficeId;
        const editingDoc = editDoc;
        // On edit, never rewrite location offices — routing/receive/RFID own those fields.
        const normalizedFormData = {
          ...formData,
          documentDirection: editingDoc ? editingDoc.documentDirection : isReceptionist
            ? 'Incoming'
            : (isOfficeStaff ? 'Outgoing' : formData.documentDirection),
          status: editingDoc
            ? (editingDoc.status || getWorkflowStatus(formData.status))
            : getWorkflowStatus(formData.status),
          dateReceived: editingDoc ? editingDoc.dateReceived : formData.dateReceived,
          documentTypeOther: isOtherDocumentType(formData.documentTypeId) ? formData.documentTypeOther.trim() : '',
          originOfficeOther: editingDoc
            ? (editingDoc.originOfficeOther || '')
            : formData.originOfficeOther.trim(),
          originOfficeId: editingDoc
            ? editingDoc.originOfficeId
            : (isOfficeStaff
              ? myOfficeId
              : (formData.originOfficeId || formData.currentOfficeId || currentUser?.officeId)),
          currentOfficeId: editingDoc
            ? editingDoc.currentOfficeId
            : (isOfficeStaff
              ? myOfficeId
              : (formData.currentOfficeId || formData.originOfficeId || currentUser?.officeId)),
          destinationOfficeId: editingDoc
            ? (editingDoc.destinationOfficeId || '')
            : (formData.destinationOfficeId || (isOfficeStaff ? '' : formData.currentOfficeId) || ''),
          destinationOfficeOther: editingDoc
            ? (editingDoc.destinationOfficeOther || '')
            : (formData.destinationOfficeOther || ''),
          // Do not change intake on metadata edits.
          intakeStatus: editingDoc
            ? undefined
            : (isOfficeStaff ? 'Approved' : undefined),
        };

        if ((isOfficeStaff || isReceptionist) && !editingDoc && !normalizedFormData.destinationOfficeId) {
          setDocumentFormErrors({ destinationOfficeId: 'Choose where to send this document.' });
          setDocumentFormErrorSummary('Destination office is required.');
          focusFormError(form);
          return;
        }

        if ((isOfficeStaff || isReceptionist) && !editingDoc && normalizedFormData.destinationOfficeId === myOfficeId) {
          setDocumentFormErrors({ destinationOfficeId: 'Choose a different office than your own.' });
          setDocumentFormErrorSummary('Choose an office other than the current office.');
          focusFormError(form);
          return;
        }

        const payload = editingDoc
          ? {
              ...editingDoc,
              ...normalizedFormData,
              scannedFiles: nextScannedFiles,
              scannedImageUrl: nextScannedFiles[0]?.url || nextScannedFiles[0]?.dataUrl || '',
            }
          : {
              ...normalizedFormData,
              scannedFiles: nextScannedFiles,
              scannedImageUrl: nextScannedFiles[0]?.dataUrl || nextScannedFiles[0]?.url || '',
            };

        if (editingDoc) {
          await onEdit(payload);
        } else {
          await onAdd(payload);
        }
        setShowForm(false);
        setEditDoc(null);
        setAttachmentFile(null);
        setFormScannedFiles([]);
      } catch (error) {
        setDocumentFormErrorSummary(error?.message || 'Unable to save the document. Please retry.');
        focusFormError(form);
      }
    });
  };

  const openRouteModal = (doc) => {
    const attempt = sendAttempts.get(doc.id);
    setRouteDoc(doc);
    setSendCustodyOfficeId(attempt?.destinations[0] || '');
    setSendCopyOfficeIds(attempt?.destinations.slice(1) || []);
    setRouteAttempt(attempt || null);
    setRouteError(attempt ? 'The previous send result is not confirmed. Check its status before sending again.' : '');
  };

  const clearRouteForm = () => {
    setRouteDoc(null);
    setSendCustodyOfficeId('');
    setSendCopyOfficeIds([]);
    setRouteAttempt(null);
    setRouteError('');
  };
  const closeRouteModal = () => {
    if (!isSendingDocument && sendAttempts.get(routeDoc?.id)?.status !== 'sending') clearRouteForm();
  };

  const handleRouteSubmit = async (e) => {
    e.preventDefault();
    if (!routeDoc || routeAttempt || sendAttempts.has(routeDoc.id)) return;
    await routeSubmitGate.current(async () => {
      setRouteError('');
      let attempt;
      try {
        const destinations = getSendRecipients(sendCustodyOfficeId, sendCopyOfficeIds, routeDoc.currentOfficeId, offices);
        attempt = { document: routeDoc, destinations, userId: currentUser?.id, status: 'preparing' };
        sendAttempts.set(routeDoc.id, attempt);
        let latest;
        try { latest = await documentService.getById(routeDoc.id); }
        catch { throw new Error('No send was attempted. Unable to check the latest document; restore the connection and try again.'); }
        if (sendAttempts.get(routeDoc.id) !== attempt) return;
        if (!latest || latest.id !== routeDoc.id) throw new Error('No send was attempted. The latest document could not be checked.');
        if (latest.currentOfficeId !== routeDoc.currentOfficeId) {
          setRouteDoc(latest);
          throw new Error('No send was attempted because custody changed. Review the current office and your selections before sending.');
        }
        attempt.document = latest;
        attempt.status = 'sending';
        const result = await sendDocumentWithRecovery({ ...attempt, send: sendDocument, read: id => documentService.getById(id) });
        if (sendAttempts.get(routeDoc.id) !== attempt) return;
        if (result.status === 'sent') {
          sendAttempts.delete(routeDoc.id);
          setDetailDoc(previous => previous?.id === result.document.id ? result.document : previous);
          clearRouteForm();
          if (result.reconciled) onSendReconciled?.(result.document);
          return;
        }
        attempt.status = 'unknown';
        setRouteAttempt(attempt);
        setRouteError('The send result is not confirmed. Your selections are kept and another send is blocked. Check send status when the connection is available.');
      } catch (error) {
        if (attempt && sendAttempts.get(routeDoc.id) !== attempt) return;
        if (attempt) sendAttempts.delete(routeDoc.id);
        setRouteError(error.message || 'The document could not be sent. Your selections are kept.');
      }
      focusFormError(routeFormRef.current);
    });
  };

  const checkRouteSendStatus = async () => {
    const attempt = routeAttempt;
    if (!attempt) return;
    if (attempt.status === 'preparing') {
      setRouteError('The latest document is still being checked before sending. Wait for that check to finish.');
      return;
    }
    await routeSubmitGate.current(async () => {
      try {
        const current = await documentService.getById(attempt.document.id);
        if (sendAttempts.get(attempt.document.id) !== attempt) return;
        if (confirmsDocumentSend(attempt.document, current, attempt.destinations, attempt.userId)) {
          sendAttempts.delete(attempt.document.id);
          setDetailDoc(previous => previous?.id === current.id ? current : previous);
          clearRouteForm();
          onSendReconciled?.(current);
          return;
        }
        setRouteError('A matching send is not confirmed yet. Another send remains blocked because the earlier request may still finish. Check send status again later.');
      } catch {
        if (sendAttempts.get(attempt.document.id) !== attempt) return;
        setRouteError('Unable to check the send result. Restore the connection and check again. Your selections are kept and another send remains blocked.');
      }
      focusFormError(routeFormRef.current);
    });
  };

  const handleReceive = async (doc) => {
    const pending = transmissions.find((item) => item.documentId === doc.id && !item.receivedBy && item.toOfficeId === currentUser?.officeId);
    if (!pending || !onReceiveTransmission || receivingDocumentId) return;
    setReceivingDocumentId(doc.id);
    try {
      await onReceiveTransmission(pending.id, {
        receivedBy: currentUser?.id,
      });
    } catch {
      // The shared save handler already shows the API error.
    } finally {
      setReceivingDocumentId('');
    }
  };

  const handleRejectDocument = (doc) => {
    setRejectDoc(doc);
    setRejectReason(doc.rejectionReason || '');
    setRejectError('');
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!rejectDoc) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required.');
      focusFormError(form);
      return;
    }
    setRejectError('');
    await onVerifyDocument?.(rejectDoc.id, 'Rejected', rejectReason.trim());
    setRejectDoc(null);
    setRejectReason('');
  };

  const processingActionLabels = {
    action_note: {
      title: 'Record Document Action',
      helper: 'Add a decision, instruction, or handoff note without changing the document status.',
      button: 'Save Action',
      required: true,
    },
    sign_document: {
      title: 'Mark as signed',
      helper: 'Use this after the document has been signed.',
      button: 'Mark as signed',
      required: false,
    },
    acknowledge_document: {
      title: 'Acknowledge Document',
      helper: 'Use this after a Received or For Filing document has been reviewed and checked.',
      button: 'Acknowledge',
      required: false,
    },
  };

  const openProcessingAction = (doc, action) => {
    setProcessingAction({ doc, action });
    setProcessingNote('');
    setProcessingError('');
  };

  const handleProcessingSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!processingAction) return;
    const config = processingActionLabels[processingAction.action];
    if (config?.required && !processingNote.trim()) {
      setProcessingError('Action note is required.');
      focusFormError(form);
      return;
    }
    setProcessingError('');
    const { doc, action } = processingAction;
    const note = processingNote.trim();
    setProcessingAction(null);
    setProcessingNote('');
    await onProcessDocument?.(doc.id, action, note);
  };

  const escapeSlipText = (value) => String(value || '-').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));

  const handlePrintClaimSlip = (doc) => {
    const trackingUrl = `${window.location.origin}${window.location.pathname}?tracking=${encodeURIComponent(doc.trackingNumber || '')}`;
    const popup = window.open('', '_blank', 'width=720,height=820');
    if (!popup) {
      notify('Allow popups to print the document claim slip.', 'Popup blocked');
      return;
    }

    popup.document.write(`<!doctype html>
      <html>
        <head>
          <title>DigiPath Claim Slip - ${escapeSlipText(doc.trackingNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; }
            .slip { border: 1px solid #cbd5e1; border-radius: 8px; padding: 28px; max-width: 640px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
            h1 { font-size: 22px; margin: 0 0 4px; }
            p { margin: 0; color: #475569; font-size: 13px; line-height: 1.5; }
            .tracking { font-size: 24px; font-weight: 800; color: #0f4c75; letter-spacing: 0.04em; margin: 18px 0; }
            .grid { display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; font-size: 14px; }
            .label { color: #64748b; font-weight: 700; }
            .value { color: #0f172a; font-weight: 600; }
            .footer { border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 16px; }
            @media print { body { padding: 0; } .slip { border: 0; } }
          </style>
        </head>
        <body>
          <div class="slip">
            <div class="header">
              <div>
                <h1>Vinzons DigiPath Claim Slip</h1>
                <p>Keep this tracking number to check document status.</p>
              </div>
              <p>${escapeSlipText(new Date().toLocaleString())}</p>
            </div>
            <div class="tracking">${escapeSlipText(doc.trackingNumber)}</div>
            <div class="grid">
              <div class="label">Subject</div><div class="value">${escapeSlipText(doc.subject)}</div>
              <div class="label">Type</div><div class="value">${escapeSlipText(getDocumentTypeLabel(doc))}</div>
              <div class="label">Date received</div><div class="value">${escapeSlipText(doc.dateReceived)}</div>
              <div class="label">Current office</div><div class="value">${escapeSlipText(getCurrentLocation(doc))}</div>
              <div class="label">Status</div><div class="value">${escapeSlipText(getWorkflowStatus(doc))}</div>
            </div>
            <div class="footer">
              <p>Track online: ${escapeSlipText(trackingUrl)}</p>
            </div>
          </div>
        </body>
      </html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return null;
    return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const formatDateTime = (value) => {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const handleAttachmentDownload = async (file) => {
    const format = downloadFormats[file.id] || 'original';
    try {
      await downloadAttachment(file, format);
    } catch (err) {
      notify(err.message || 'Unable to download this scanned file.', 'Download failed', 'danger');
    }
  };

  const openPreview = (file, doc) => {
    setPreviewDoc(doc);
    setPreviewFile(file);
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewDoc(null);
  };

  const handleSaveRotatedAttachment = async (rotatedFile) => {
    if (!previewDoc || !onEdit) {
      throw new Error('This scan cannot be saved right now.');
    }

    const existingFiles = getDocumentFiles(previewDoc);
    const updatedFiles = existingFiles.map((file) => (
      file.id === rotatedFile.id ? rotatedFile : file
    ));

    const savedDoc = await onEdit({
      ...previewDoc,
      scannedFiles: updatedFiles,
      scannedImageUrl: updatedFiles[0]?.url || updatedFiles[0]?.dataUrl || '',
    });

    const savedFile = getDocumentFiles(savedDoc).find((file) => file.id === rotatedFile.id) || rotatedFile;
    setPreviewDoc(savedDoc);
    setPreviewFile(savedFile);
    if (detailDoc?.id === savedDoc.id) {
      setDetailDoc(savedDoc);
    }
  };

  const handleRemoveAttachment = async (doc, fileId) => {
    if (!onEdit || !doc) return;
    const existingFiles = getDocumentFiles(doc);
    if (existingFiles.length <= 1) {
      notify('A document needs at least one attachment. Open Edit to replace this file.', 'Cannot remove', 'warning');
      return;
    }

    const confirmed = window.confirm('Remove this scanned file from the document?');
    if (!confirmed) return;

    const updatedFiles = existingFiles.filter((file) => file.id !== fileId);
    const savedDoc = await onEdit({
      ...doc,
      scannedFiles: updatedFiles,
      scannedImageUrl: updatedFiles[0]?.url || updatedFiles[0]?.dataUrl || '',
    });

    if (previewDoc?.id === savedDoc?.id) {
      if (previewFile?.id === fileId) {
        closePreview();
      } else {
        setPreviewDoc(savedDoc);
      }
    }
    if (detailDoc?.id === savedDoc?.id) {
      setDetailDoc(savedDoc);
    }
  };

  const isApprovalUser = currentRole === 'admin' || currentRole === 'mayor';
  const isOfficeUser = currentRole === 'office';
  const canDelete = currentRole === 'admin';
  const canCreate = currentRole === 'admin' || currentRole === 'receptionist' || isOfficeUser;
  const canEdit = currentRole === 'admin' || currentRole === 'receptionist';
  const canManageAttachments = (doc) => canEdit || (
    isOfficeUser && currentUser?.officeId && doc?.currentOfficeId === currentUser.officeId
    && getWorkflowStatus(doc) !== 'In Transit'
  );
  const canRoute = isApprovalUser || isOfficeUser;
  const canVerify = isApprovalUser;
  const isApprovedForWorkflow = (doc) => (doc.intakeStatus || 'Approved') === 'Approved';
  const canReturnToSender = (doc) => (
    doc.intakeStatus === 'Rejected'
    && (currentRole === 'admin' || currentRole === 'receptionist')
    && (currentRole === 'admin' || doc.currentOfficeId === currentUser?.officeId)
  );
  const canResubmitDocument = doc => canCreate && ['Rejected', 'Returned to Sender'].includes(doc.intakeStatus)
    && (currentRole === 'admin' || doc.currentOfficeId === currentUser?.officeId);
  const canCompleteDocument = doc => currentUser?.officeId && currentUser.officeId === doc.currentOfficeId
    && isApprovedForWorkflow(doc) && transmittableStatuses.includes(getWorkflowStatus(doc))
    && !getPendingTransmission(doc.id) && !(doc.sendHistory || []).some(event => event.active)
    && !(doc.sendQueue || []).some(Boolean)
    && (!documentTypes.find(type => type.id === doc.documentTypeId)?.requiresMayorApproval || doc.mayorApprovalCleared);
  const canRouteDocument = (doc) => {
    const status = getWorkflowStatus(doc);
    const finalStatus = finalWorkflowStatuses.includes(status);
    return canRoute && !(doc.sendHistory || []).some((event) => event.active) && !getPendingTransmission(doc.id) && isApprovedForWorkflow(doc) && transmittableStatuses.includes(status) && (
      isApprovalUser || (!finalStatus && doc.currentOfficeId === currentUser?.officeId)
    );
  };
  const canReceiveTransmission = (doc) => Boolean(onReceiveTransmission && transmissions.some((item) => (
    item.documentId === doc.id && !item.receivedBy && item.toOfficeId === currentUser?.officeId
  )));
  const approvalActor = {
    role: currentRole === 'admin' ? 'Admin' : currentRole === 'mayor' ? 'Mayor' : currentUser?.role,
    officeId: currentUser?.officeId,
  };
  const canTakeDocumentAction = (doc) => canActByWorkflow(doc, approvalActor);
  const canSignDocument = (doc) => canSignByWorkflow(doc, approvalActor);
  const canAcknowledgeDocument = (doc) => canAcknowledgeByWorkflow(doc, approvalActor);
  const canArchiveDocument = (doc) => canArchiveByWorkflow(doc, approvalActor);
  const canRejectDocument = (doc) => canVerify && canRejectByWorkflow(doc, approvalActor);
  const pageTitle = isOfficeUser ? 'My Documents' : 'Documents';
  const pageSubtitle = isOfficeUser
    ? 'Send documents to selected offices and confirm incoming deliveries'
    : 'Register external documents, mayor actions, and office-to-office sending';
  const createButtonLabel = isOfficeUser ? 'Send Document' : (currentRole === 'receptionist' ? 'Register Document' : 'New Document');
  const destinationOffices = offices.filter(o => o.id !== (currentUser?.officeId || formData.currentOfficeId));

  const renderDocumentActions = (doc) => {
    return (
      <div className="workflow-actions">
        {canReceiveTransmission(doc) && (
          <button className="btn btn-sm btn-success" disabled={Boolean(receivingDocumentId)} onClick={() => handleReceive(doc)}>
            <CheckCircle2 size={14} /> {receivingDocumentId === doc.id ? 'Receiving…' : 'Receive document'}
          </button>
        )}
        {canVerify && doc.intakeStatus === 'Pending Review' && doc.currentOfficeId === currentUser?.officeId && registrationStatuses.includes(getWorkflowStatus(doc)) && (
          <button className="btn btn-sm btn-success" onClick={() => onVerifyDocument?.(doc.id, 'Approved')}>
            <CheckCircle2 size={14} /> Approve
          </button>
        )}
        {canRejectDocument(doc) && (
          <button className="btn btn-sm btn-danger" onClick={() => handleRejectDocument(doc)}>
            <X size={14} /> Reject
          </button>
        )}
        {canResubmitDocument(doc) && (
          <button className="btn btn-sm btn-primary" onClick={() => onResubmitDocument(doc.id)}>Resubmit corrected document</button>
        )}
        {canCompleteDocument(doc) && (
          <button className="btn btn-sm btn-success" onClick={() => onProcessDocument(doc.id, 'complete_document')}>Complete processing</button>
        )}
        {canReturnToSender(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => onReturnToSender?.(doc.id)}>
            <Inbox size={14} /> Return to Sender
          </button>
        )}
        {canRouteDocument(doc) && (
          <button className="btn btn-sm btn-primary" onClick={() => openRouteModal(doc)}>
            <Send size={14} /> Send
          </button>
        )}
        {canTakeDocumentAction(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => openProcessingAction(doc, 'action_note')}>
            <MessageSquare size={14} /> Add Action
          </button>
        )}
        {canSignDocument(doc) && (
          <button className="btn btn-sm btn-success" onClick={() => openProcessingAction(doc, 'sign_document')}>
            <CheckCircle2 size={14} /> Mark as signed
          </button>
        )}
        {canAcknowledgeDocument(doc) && (
          <button className="btn btn-sm btn-success" onClick={() => openProcessingAction(doc, 'acknowledge_document')}>
            <CheckCircle2 size={14} /> Acknowledge
          </button>
        )}
        {canArchiveDocument(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => onArchiveDocument(doc.id)}>
            <Archive size={14} /> Archive
          </button>
        )}
      </div>
    );
  };

  const renderHandoffSummary = (doc) => (
    <DocumentHandoffSummary
      doc={doc}
      status={getWorkflowStatus(doc)}
      badge={getTableStatusDisplay(doc)}
      officeId={currentUser?.officeId}
      getOfficeName={getOfficeName}
      recipients={getDeliveryRecipients(doc)}
      pending={transmissions.filter(item => item.documentId === doc.id && !item.receivedBy)}
      ownReceipt={canReceiveTransmission(doc)}
      trackingOnly={isOfficeReadOnlyTracking(doc, currentUser, transmissions.some(item =>
        item.documentId === doc.id && item.fromOfficeId === currentUser?.officeId))}
    >
      {renderDocumentActions(doc)}
    </DocumentHandoffSummary>
  );

  return (
    <>
      <PageShell
        className="documents-page"
        header={
          <div className="page-header page-header--align-bottom">
            <div className="page-header-left">
              <h1>{pageTitle}</h1>
              <p>{pageSubtitle}</p>
            </div>
            {canCreate && (
              <div className="page-header-actions page-header-actions--inline">
                <button className="btn btn-primary" onClick={() => handleOpenForm()}>
                  <Plus size={16} /> {createButtonLabel}
                </button>
              </div>
            )}
          </div>
        }
        toolbar={
          <div className="document-toolbar">
            <div className="filter-dropdown filter-dropdown-search">
              <label htmlFor={`${formId}-search`}>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input
                  id={`${formId}-search`}
                  type="text"
                  placeholder="Subject, tracking #, or sender"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="filter-dropdown filter-dropdown-date">
              <label htmlFor={`${formId}-date-filter`}>Date</label>
              <input
                id={`${formId}-date-filter`}
                className="form-input"
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
              />
            </div>

            <div className="filter-dropdowns">
              <div className="filter-dropdown">
                <label htmlFor={`${formId}-status-filter`}>Status</label>
                <select id={`${formId}-status-filter`} className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div className="filter-dropdown">
                <label htmlFor={`${formId}-direction-filter`}>Direction</label>
                <select id={`${formId}-direction-filter`} className="form-select" value={filterDirection} onChange={e => setFilterDirection(e.target.value)}>
                  {directions.map(direction => (
                    <option key={direction} value={direction}>{direction}</option>
                  ))}
                </select>
              </div>
              <div className="filter-dropdown">
                <label htmlFor={`${formId}-priority-filter`}>Priority</label>
                <select id={`${formId}-priority-filter`} className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
                  {priorities.map(priority => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </div>
            </div>
          </div>
        }
      >
      <section className="document-panel">
        <div className="table-container documents-table-container" role="region" aria-label="Documents table" tabIndex={0}>
          <table className="documents-table compact-documents">
          <thead>
            <tr>
              <th>Document</th><th>Holding office</th><th>Status</th>
              <th aria-sort={sortBy === 'updatedAt' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="list-sort" onClick={() => handleSort('updatedAt')}>Last updated <SortIcon field="updatedAt" /></button>
              </th>
              <th className="documents-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedDocs.length > 0 ? paginatedDocs.map(doc => {
              const isExpanded = expandedRow === doc.id;
              const files = getDocumentFiles(doc);
              const timeline = getTimeline(doc);
              const tableStatus = getTableStatusDisplay(doc);

              return (
                <React.Fragment key={doc.id}>
                  <tr
                    className="clickable-row"
                    aria-label="Open document details"
                    onClick={() => setDetailDoc(doc)}
                  >
                    <td data-label="Document"><strong>{doc.subject}</strong><small className="doc-reference">{doc.trackingNumber}</small>
                      {doc.priorityLevel === 'urgent' && <span className="status-badge handoff-revision-badge">Urgent</span>}</td>
                    <td data-label="Holding office">{doc.currentOfficeId ? getOfficeName(doc.currentOfficeId) : 'Unrecorded'}</td>
                    <td data-label="Status"><span className={`status-badge ${tableStatus.className}`}>{tableStatus.label}</span></td>
                    <td data-label="Last updated">{formatDateTime(doc.updatedAt || doc.createdAt || doc.dateReceived)}</td>
                    <td className="documents-col-actions">
                      <div className="documents-actions-wrap">
                        <button className="btn-icon" title="Open details" onClick={(e) => { e.stopPropagation(); setDetailDoc(doc); }}>
                          <Eye size={14} />
                        </button>
                        {canReceiveTransmission(doc) && (
                          <button className="btn btn-sm btn-success" disabled={Boolean(receivingDocumentId)} onClick={(e) => { e.stopPropagation(); handleReceive(doc); }}>
                            <CheckCircle2 size={14} /> {receivingDocumentId === doc.id ? 'Receiving…' : 'Receive'}
                          </button>
                        )}
                        {(canEdit || canResubmitDocument(doc)) && (
                          <button className="btn-icon" title="Edit" onClick={(e) => { e.stopPropagation(); handleOpenForm(doc); }}>
                            <Edit2 size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button className="btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
                            style={{ color: 'var(--danger)' }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan="5" style={{ padding: '1rem 1.5rem', background: 'var(--bg-elevated)' }}>
                        {renderHandoffSummary(doc)}

                        {/* Phase 4 — Route Progress Stepper */}
                        {renderDeliveryStatus(doc)}
                        {!getDeliveryRecipients(doc).length && Array.isArray(doc.routePlan) && doc.routePlan.length > 1 && (
                          <div style={{
                            margin: '0.75rem 0 1rem',
                            padding: '0.85rem 1.1rem',
                            background: 'var(--surface-2)',
                            borderRadius: '10px',
                            border: '1px solid var(--border)',
                          }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
                              Route Progress
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {doc.routePlan.map((officeId, idx) => {
                                const isCurrent = idx === (doc.routeStep ?? 0);
                                const isDone = idx < (doc.routeStep ?? 0);
                                const officeName = getOfficeName(officeId);
                                return (
                                  <React.Fragment key={officeId + idx}>
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                                      padding: '0.3rem 0.65rem',
                                      borderRadius: '999px',
                                      fontSize: '0.78rem',
                                      fontWeight: isCurrent ? 700 : 500,
                                      background: isCurrent
                                        ? 'var(--primary)'
                                        : isDone
                                          ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                                          : 'var(--surface)',
                                      color: isCurrent
                                        ? 'white'
                                        : isDone
                                          ? 'var(--success)'
                                          : 'var(--text-muted)',
                                      border: isCurrent
                                        ? 'none'
                                        : `1px solid ${isDone ? 'var(--success)' : 'var(--border)'}`,
                                    }}>
                                      {isDone && <CheckCircle2 size={11} />}
                                      {isCurrent && <MapPin size={11} />}
                                      {officeName}
                                    </div>
                                    {idx < doc.routePlan.length - 1 && (
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>›</span>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="document-detail-grid">
                          <div className="document-detail-section">
                            <h4><User size={14} /> Sender and Metadata</h4>
                            <div className="detail-pair"><span>Sender</span><strong>{doc.senderName || '-'}</strong></div>
                            <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
                            <div className="detail-pair"><span>Email</span><strong>{doc.senderEmail || '-'}</strong></div>
                            <div className="detail-pair"><span>Remarks</span><strong>{doc.remarks || '-'}</strong></div>
                          </div>

                          <div className="document-detail-section">
                            <h4><MapPin size={14} /> Location</h4>
                            <div className="detail-pair"><span>Origin</span><strong>{getOriginOfficeLabel(doc)}</strong></div>
                            <div className="detail-pair"><span>Current</span><strong>{getCurrentLocation(doc, true)}</strong></div>
                            <div className="detail-pair"><span>Destination</span><strong>{getDestinationOfficeLabel(doc)}</strong></div>
                          </div>

                          <div className="document-detail-section">
                            <h4><Paperclip size={14} /> Scanned Files</h4>
                            {files.length ? (
                              <div className="attachment-list">
                                {files.map(file => (
                                  <div key={file.id} className="attachment-item">
                                    <button type="button" className="attachment-link" onClick={() => openPreview(file, doc)}>
                                      <Eye size={14} />
                                      <span>{file.name}</span>
                                    </button>
                                    <select
                                      className="attachment-format-select"
                                      value={downloadFormats[file.id] || 'original'}
                                      onChange={e => setDownloadFormats(prev => ({ ...prev, [file.id]: e.target.value }))}
                                      aria-label={`Download format for ${file.name}`} title="Choose download format"
                                    >
                                      <option value="original">Original</option>
                                      <option value="pdf">PDF</option>
                                      <option value="png">PNG</option>
                                      <option value="jpeg">JPG</option>
                                    </select>
                                    <button type="button" className="attachment-download" onClick={() => handleAttachmentDownload(file)} title="Download scanned file">
                                      <Download size={14} />
                                      {(downloadFormats[file.id] || 'original') === 'pdf'
                                        ? ' PDF'
                                        : (downloadFormats[file.id] || 'original') === 'jpeg'
                                          ? ' JPEG'
                                          : (downloadFormats[file.id] || 'original') === 'png'
                                            ? ' PNG'
                                            : ''}
                                    </button>
                                    {canManageAttachments(doc) && (
                                      <button
                                        type="button"
                                        className="attachment-remove"
                                        onClick={() => handleRemoveAttachment(doc, file.id)}
                                        title="Remove scanned file"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="detail-empty">No scanned file attached yet.</p>
                            )}
                          </div>

                          <div className="document-detail-section document-timeline-section">
                            <h4><History size={14} /> Document Timeline</h4>
                            <div className="timeline-compact">
                              {timeline.map(event => (
                                <div key={event.id} className="timeline-compact-item">
                                  <span className="timeline-compact-dot"></span>
                                  <div>
                                    <strong>{event.label}</strong>
                                    <p>{event.details}</p>
                                    <small>
                                      {formatDateTime(event.timestamp)}
                                      {event.userId ? ` - ${getUserFullName(event.userId)}` : ''}
                                      {event.officeId ? ` - ${getOfficeName(event.officeId)}` : ''}
                                    </small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }) : (
              <tr>
              <td colSpan="5">
                  <div className="empty-state">
                    <div className="empty-state-icon"><FileText size={24} /></div>
                    <h3>No documents found</h3>
                    <p>Try adjusting your search or filters</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-toolbar">
        <div className="pagination-summary">
          Showing {showFrom}-{showTo} of {filteredDocs.length} matching documents
        </div>
        <div className="pagination-controls">
          <label>
            Rows per page
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={pageSize}
              className="form-input pagination-page-size-input"
              onChange={e => handlePageSizeChange(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        <div className="pagination-pages">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
      </section>
      </PageShell>

      {detailDoc && !previewFile && (() => {
        const doc = detailDoc;
        const files = getDocumentFiles(doc);
        const timeline = getTimeline(doc);
        const senderOutbox = getSenderNotifications(doc.id);

        return (
          <ModalOverlay aria-labelledby={`${formId}-detail-title`} onClose={() => setDetailDoc(null)}>
            <div className="modal document-detail-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2 id={`${formId}-detail-title`}>{doc.subject}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {doc.trackingNumber} - {getDocumentTypeLabel(doc)}
                  </p>
                </div>
                <button className="btn-icon" aria-label="Close document details" onClick={() => setDetailDoc(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                {(detailLoading || detailError) && <div role="status" className="page-content-alert">
                  {detailLoading ? 'Loading scans and history…' : detailError}
                  {detailError && <button onClick={() => setDetailRetry((value) => value + 1)}>Retry</button>}
                </div>}

                {renderHandoffSummary(doc)}
                <div className="document-detail-grid">
                  {renderDeliveryStatus(doc)}
                  <div className="document-detail-section">
                    <h4><MapPin size={14} /> Location</h4>
                    <div className="detail-pair"><span>Status</span><strong>{getWorkflowStatus(doc)}</strong></div>
                    <div className="detail-pair"><span>Intake Review</span><strong>{doc.intakeStatus || 'Approved'}</strong></div>
                    <div className="detail-pair"><span>Origin</span><strong>{getOriginOfficeLabel(doc)}</strong></div>
                    <div className="detail-pair"><span>Destination</span><strong>{getDestinationOfficeLabel(doc)}</strong></div>
                    {currentRole !== 'receptionist' && (
                      <>
                        <div className="detail-pair"><span>From Organization</span><strong>{doc.originOfficeOther || '-'}</strong></div>
                        <div className="detail-pair"><span>Last Detected</span><strong>{doc.lastDetectedOfficeId ? `${getOfficeName(doc.lastDetectedOfficeId)} - ${formatDateTime(doc.lastDetectedAt)}` : '-'}</strong></div>
                      </>
                    )}
                  </div>

                  <div className="document-detail-section">
                    <h4><User size={14} /> Sender</h4>
                    <div className="detail-pair"><span>Name</span><strong>{doc.senderName || '-'}</strong></div>
                    <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
                    <div className="detail-pair"><span>From Organization</span><strong>{doc.originOfficeOther || '-'}</strong></div>
                    <div className="detail-pair"><span>Updates</span><strong>{doc.notifySender === false ? 'Disabled' : (doc.senderNotificationChannels || []).join(', ').toUpperCase() || 'Enabled'}</strong></div>
                  </div>

                  <div className="document-detail-section">
                    <h4><Paperclip size={14} /> Attachments</h4>
                    {files.length ? (
                      <div className="attachment-list">
                        {files.map(file => (
                          <div key={file.id} className="attachment-item">
                            <button type="button" className="attachment-link" onClick={() => openPreview(file, doc)}>
                              <Eye size={14} />
                              <span>{file.name}</span>
                            </button>
                            <select
                              className="attachment-format-select"
                              value={downloadFormats[file.id] || 'original'}
                              onChange={e => setDownloadFormats(prev => ({ ...prev, [file.id]: e.target.value }))}
                              aria-label={`Download format for ${file.name}`} title="Choose download format"
                            >
                              <option value="original">Original</option>
                              <option value="pdf">PDF</option>
                              <option value="png">PNG</option>
                              <option value="jpeg">JPG</option>
                            </select>
                            <button type="button" className="attachment-download" onClick={() => handleAttachmentDownload(file)} title="Download scanned file">
                              <Download size={14} />
                              {(downloadFormats[file.id] || 'original') === 'pdf'
                                ? ' PDF'
                                : (downloadFormats[file.id] || 'original') === 'jpeg'
                                  ? ' JPEG'
                                  : (downloadFormats[file.id] || 'original') === 'png'
                                    ? ' PNG'
                                    : ''}
                            </button>
                            {canManageAttachments(doc) && (
                              <button
                                type="button"
                                className="attachment-remove"
                                onClick={() => handleRemoveAttachment(doc, file.id)}
                                title="Remove scanned file"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="detail-empty">No scanned file attached yet.</p>
                    )}
                  </div>

                  <div className="document-detail-section document-timeline-section">
                    <h4><History size={14} /> Timeline</h4>
                    <div className="timeline-compact">
                      {timeline.map(event => (
                        <div key={event.id} className="timeline-compact-item">
                          <span className="timeline-compact-dot"></span>
                          <div>
                            <strong>{event.label}</strong>
                            <p>{event.details}</p>
                            <small>
                              {formatDateTime(event.timestamp)}
                              {event.userId ? ` - ${getUserFullName(event.userId)}` : ''}
                              {event.officeId ? ` - ${getOfficeName(event.officeId)}` : ''}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="document-detail-section document-timeline-section">
                    <h4><MessageSquare size={14} /> Sender Notification Outbox</h4>
                    {!smsReady && !smsLoading && !smsError && <p className="detail-empty">SMS delivery is paused until configured and enabled.</p>}
                    {smsLoading && <p className="detail-empty" role="status">Loading sender updates…</p>}
                    {smsError && <p className="form-field-error" role="alert">{smsError} <button className="btn btn-sm btn-secondary" onClick={() => setSmsRetry(value => value + 1)}>Retry history</button></p>}
                    {senderOutbox.length ? (
                      <div className="sender-notification-list">
                        {senderOutbox.map(item => (
                          <div key={item.id} className="sender-notification-item">
                            <div>
                              <span className={`sender-channel-badge ${item.channel}`}>{item.channel?.toUpperCase()}</span>
                              <strong>{item.subject || item.eventType}</strong>
                              <p>{item.message}</p>
                              <small>{item.recipient} - {item.status} - {formatDateTime(item.createdAt)}</small>
                              {item.errorMessage && <p>{item.errorMessage}</p>}
                              {item.deliveredAt && <small>Delivered: {formatDateTime(item.deliveredAt)}</small>}
                            </div>
                            {smsReady && ['Admin', 'Receptionist'].includes(currentUser?.role) && item.canRetry && (
                              <button className="btn btn-sm btn-secondary" disabled={!!smsSending} onClick={() => requeueSms(item.id)}>
                                <Send size={13} /> Requeue
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : !smsLoading && !smsError && (
                      <p className="detail-empty">No sender updates queued yet. Updates are created when the document moves through the workflow.</p>
                    )}
                  </div>
                </div>
              </div>
              {!detailLoading && !detailError && doc.trackingNumber && (
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => handlePrintClaimSlip(doc)}>
                    <FileText size={16} /> Print claim slip
                  </button>
                </div>
              )}
            </div>
          </ModalOverlay>
        );
      })()}

      {showForm && (
        <ModalOverlay aria-labelledby={`${formId}-form-title`} onClose={() => { if (!isSavingDocument) setShowForm(false); }}>
          <div className="modal document-form-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id={`${formId}-form-title`}>
                {editDoc
                  ? 'Edit Document'
                  : (isOfficeUser ? 'Send Document' : 'New Document')}
              </h2>
              <button className="btn-icon" aria-label="Close document form" disabled={isSavingDocument} onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              <div className="modal-body">
                {documentFormErrorSummary && (
                  <div data-form-error tabIndex={-1} className="form-error-summary" role="alert">{documentFormErrorSummary}</div>
                )}
                <div className="form-group">
                  <label htmlFor={`${formId}-subject`} className="form-label">Document Subject <span className="required-mark">*</span></label>
                  <input id={`${formId}-subject`} aria-describedby={`${formId}-subject-hint${documentFormErrors.subject ? ` ${formId}-subject-error` : ''}`} aria-invalid={Boolean(documentFormErrors.subject)} required
                    className={`form-input${documentFormErrors.subject ? ' is-invalid' : ''}`}
                    type="text"
                    value={formData.subject}
                    onChange={e => {
                      setFormData({ ...formData, subject: e.target.value });
                      setDocumentFormErrors(prev => clearFieldError(prev, 'subject'));
                      if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                    }}
                    placeholder="Enter document subject"
                  />
                  {documentFormErrors.subject && (
                    <p id={`${formId}-subject-error`} className="form-field-error">{documentFormErrors.subject}</p>
                  )}
                  <p id={`${formId}-subject-hint`} className="field-hint">Shortly describe the document so staff can recognize it in lists, reports, and tracking.</p>
                </div>
                <div className="form-grid document-registration-metadata">
                  {!isOfficeUser && (
                    <div className="form-group">
                      <label htmlFor={`${formId}-type`} className="form-label">Document Type</label>
                      <select id={`${formId}-type`} aria-describedby={`${formId}-type-hint`}
                        className="form-select"
                        value={formData.documentTypeId}
                        onChange={e => setFormData({ ...formData, documentTypeId: e.target.value })}
                      >
                        {documentTypes.map(dt => (
                          <option key={dt.id} value={dt.id}>{dt.category}</option>
                        ))}
                      </select>
                      <p id={`${formId}-type-hint`} className="field-hint">For external/citizen documents only.</p>
                      {isOtherDocumentType(formData.documentTypeId) && (
                        <>
                          <input id={`${formId}-other-type`} aria-label="Other document type" required aria-invalid={Boolean(documentFormErrors.documentTypeOther)} aria-describedby={documentFormErrors.documentTypeOther ? `${formId}-other-type-error` : undefined}
                            className={`form-input${documentFormErrors.documentTypeOther ? ' is-invalid' : ''}`}
                            type="text"
                            value={formData.documentTypeOther}
                            onChange={e => {
                              setFormData({ ...formData, documentTypeOther: e.target.value });
                              setDocumentFormErrors(prev => clearFieldError(prev, 'documentTypeOther'));
                              if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                            }}
                            placeholder="Specify document type"
                            style={{ marginTop: '0.5rem' }}
                          />
                          {documentFormErrors.documentTypeOther && (
                            <p id={`${formId}-other-type-error`} className="form-field-error">{documentFormErrors.documentTypeOther}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label" htmlFor={`${formId}-priority`}>Priority Level</label>
                    <select
                      id={`${formId}-priority`}
                      className="form-select"
                      value={formData.priorityLevel || 'normal'}
                      onChange={e => setFormData({ ...formData, priorityLevel: e.target.value })}
                    >
                      {defaultPriorityLevels.map(level => (
                        <option key={level.id} value={level.id}>{level.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-direction`} className="form-label">Direction</label>
                    <select id={`${formId}-direction`} aria-describedby={`${formId}-direction-hint`}
                      className="form-select"
                      value={formData.documentDirection}
                      onChange={e => setFormData({ ...formData, documentDirection: e.target.value })}
                      disabled={currentRole === 'receptionist' || isOfficeUser}
                    >
                      {!isOfficeUser && <option>Incoming</option>}
                      {(currentRole !== 'receptionist' || isOfficeUser) && <option>Outgoing</option>}
                    </select>
                    <p id={`${formId}-direction-hint`} className="field-hint">
                      {isOfficeUser
                        ? 'Office staff send outgoing documents to other offices.'
                        : 'Incoming means received from an external sender.'}
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-date`} className="form-label">Date Received</label>
                    <input id={`${formId}-date`} aria-describedby={`${formId}-date-hint`}
                      className="form-input"
                      type="date"
                      value={formData.dateReceived}
                      disabled
                      required
                    />
                    <p id={`${formId}-date-hint`} className="field-hint">Locked to the registration date. Processing follows FIFO (oldest first).</p>
                  </div>
                  {isOfficeUser ? (
                    <div className="form-group document-registration-destination">
                      <label htmlFor={`${formId}-destination`} className="form-label">Send To Office <span className="required-mark">*</span></label>
                      <select id={`${formId}-destination`} aria-describedby={`${formId}-destination-hint${documentFormErrors.destinationOfficeId ? ` ${formId}-destination-error` : ''}`} aria-invalid={Boolean(documentFormErrors.destinationOfficeId)} required
                        className={`form-select${documentFormErrors.destinationOfficeId ? ' is-invalid' : ''}`}
                        value={formData.destinationOfficeId}
                        onChange={e => {
                          setFormData({ ...formData, destinationOfficeId: e.target.value });
                          setDocumentFormErrors(prev => clearFieldError(prev, 'destinationOfficeId'));
                          if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                        }}
                        disabled={Boolean(editDoc)}
                      >
                        <option value="">Select reception or other office</option>
                        {destinationOffices.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      {documentFormErrors.destinationOfficeId && (
                        <p id={`${formId}-destination-error`} className="form-field-error">{documentFormErrors.destinationOfficeId}</p>
                      )}
                      <p id={`${formId}-destination-hint`} className="field-hint">Document is registered from your office, then sent to this destination.</p>
                    </div>
                  ) : currentRole === 'receptionist' ? (
                    <div className="form-group document-registration-destination">
                      <label htmlFor={`${formId}-destination`} className="form-label">Destination <span className="required-mark">*</span></label>
                      <select id={`${formId}-destination`} aria-describedby={`${formId}-destination-hint${documentFormErrors.destinationOfficeId ? ` ${formId}-destination-error` : ''}`} aria-invalid={Boolean(documentFormErrors.destinationOfficeId)} required
                        className={`form-select${documentFormErrors.destinationOfficeId ? ' is-invalid' : ''}`}
                        value={formData.destinationOfficeId}
                        onChange={e => {
                          setFormData({ ...formData, destinationOfficeId: e.target.value });
                          setDocumentFormErrors(prev => clearFieldError(prev, 'destinationOfficeId'));
                          if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                        }}
                        disabled={Boolean(editDoc)}
                      >
                        <option value="">Select a destination office</option>
                        {destinationOffices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      {documentFormErrors.destinationOfficeId && <p id={`${formId}-destination-error`} className="form-field-error">{documentFormErrors.destinationOfficeId}</p>}
                      <p id={`${formId}-destination-hint`} className="field-hint">If this document type requires Mayor approval, it will go there first. The selected office remains its destination after approval.</p>
                    </div>
                  ) : null}
                </div>
                {isOfficeUser && (
                  <div className="form-group">
                    <label htmlFor={`${formId}-office`} className="form-label">From Office</label>
                    <select id={`${formId}-office`} aria-describedby={`${formId}-office-hint`} className="form-select" value={formData.currentOfficeId} disabled>
                      {offices
                        .filter(o => o.id === formData.currentOfficeId)
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p id={`${formId}-office-hint`} className="field-hint">Your assigned office — documents are always sent from here.</p>
                  </div>
                )}

                <div style={{
                  padding: '0.75rem', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                  marginTop: '0.5rem',
                }}>
                  <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    <User size={12} style={{ marginRight: '0.25rem' }} />
                    Sender Information
                  </p>
                  {!isOfficeUser && (
                    <div className="form-group">
                      <label htmlFor={`${formId}-organization`} className="form-label">Source organization (optional)</label>
                      <input id={`${formId}-organization`} aria-describedby={`${formId}-organization-hint`}
                        className="form-input"
                        type="text"
                        value={formData.originOfficeOther}
                        onChange={e => setFormData({ ...formData, originOfficeOther: e.target.value })}
                        placeholder="School, agency, barangay, or other external organization"
                        disabled={Boolean(editDoc)}
                      />
                      <p id={`${formId}-organization-hint`} className="field-hint">
                        {editDoc ? 'Source organization is fixed after registration.' : 'The external sender’s organization, separate from municipal offices.'}
                      </p>
                    </div>
                  )}
                  <div className="form-group">
                    <label htmlFor={`${formId}-sender-name`} className="form-label">Sender Name <span className="required-mark">*</span></label>
                    <input id={`${formId}-sender-name`} aria-describedby={`${formId}-sender-name-hint${documentFormErrors.senderName ? ` ${formId}-sender-name-error` : ''}`} aria-invalid={Boolean(documentFormErrors.senderName)} required
                      className={`form-input${documentFormErrors.senderName ? ' is-invalid' : ''}`}
                      type="text"
                      value={formData.senderName}
                      onChange={e => {
                        setFormData({ ...formData, senderName: e.target.value });
                        setDocumentFormErrors(prev => clearFieldError(prev, 'senderName'));
                        if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                      }}
                      placeholder="Full name of the sender"
                    />
                    {documentFormErrors.senderName && (
                      <p id={`${formId}-sender-name-error`} className="form-field-error">{documentFormErrors.senderName}</p>
                    )}
                    <p id={`${formId}-sender-name-hint`} className="field-hint">Appears in tracking and helps staff identify who submitted the document.</p>
                  </div>
                  <div className="form-grid">
                    <div className="form-group">
                      <label htmlFor={`${formId}-contact`} className="form-label">
                        <Phone size={12} style={{ marginRight: '0.25rem' }} />Contact Number
                      </label>
                      <input id={`${formId}-contact`} aria-describedby={`${formId}-contact-hint`} className="form-input" type="tel" value={formData.senderContact}
                        onChange={e => setFormData({ ...formData, senderContact: e.target.value })}
                        placeholder="09XX-XXX-XXXX" />
                      <p id={`${formId}-contact-hint`} className="field-hint">Optional SMS tracking updates for external senders.</p>
                    </div>
                  </div>
                  {!isOfficeUser && (
                    <div className="sender-notification-options">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={formData.notifySender}
                          onChange={e => setFormData({ ...formData, notifySender: e.target.checked })}
                        />
                        Send SMS tracking updates when a contact number is provided
                      </label>
                    </div>
                  )}
                  <div className="form-group">
                    <label htmlFor={`${formId}-remarks`} className="form-label">
                      <MessageSquare size={12} style={{ marginRight: '0.25rem' }} />Remarks
                    </label>
                    <textarea id={`${formId}-remarks`} aria-describedby={`${formId}-remarks-hint`} className="form-input" value={formData.remarks}
                      onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                      placeholder="Additional notes" rows={2} style={{ resize: 'vertical' }} />
                    <p id={`${formId}-remarks-hint`} className="field-hint">Optional internal note for context, instructions, or special handling.</p>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label htmlFor={`${formId}-attachment`} className="form-label">
                    <Upload size={12} style={{ marginRight: '0.25rem' }} />
                    Scanned File Attachment <span className="required-mark">*</span>
                  </label>
                  {formScannedFiles.length > 0 && (
                    <div className="attachment-list" style={{ marginBottom: '0.65rem' }}>
                      {formScannedFiles.map((file) => (
                        <div key={file.id} className="attachment-item">
                          <div className="attachment-link" style={{ cursor: 'default' }}>
                            <Paperclip size={14} />
                            <span>{file.name}</span>
                          </div>
                          <button
                            type="button"
                            className="attachment-remove"
                            onClick={() => {
                              setFormScannedFiles((prev) => prev.filter((item) => item.id !== file.id));
                              setDocumentFormErrors((prev) => clearFieldError(prev, 'attachmentFile'));
                            }}
                            title="Remove scanned file"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input required={!formScannedFiles.length} id={`${formId}-attachment`} aria-describedby={`${formId}-attachment-hint${documentFormErrors.attachmentFile ? ` ${formId}-attachment-error` : ''}`} aria-invalid={Boolean(documentFormErrors.attachmentFile)}
                    className={`form-input${documentFormErrors.attachmentFile ? ' is-invalid' : ''}`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={e => {
                      setAttachmentFile(e.target.files?.[0] || null);
                      setDocumentFormErrors(prev => clearFieldError(prev, 'attachmentFile'));
                      if (documentFormErrorSummary) setDocumentFormErrorSummary('');
                    }}
                  />
                  {documentFormErrors.attachmentFile && (
                    <p id={`${formId}-attachment-error`} className="form-field-error">{documentFormErrors.attachmentFile}</p>
                  )}
                  {attachmentFile && (
                    <div className="attachment-item" style={{ marginTop: '0.45rem' }}>
                      <p className="field-hint" style={{ margin: 0, flex: 1 }}>
                        New file selected: {attachmentFile.name}
                      </p>
                      <button
                        type="button"
                        className="attachment-remove"
                        onClick={() => setAttachmentFile(null)}
                        title="Clear selected file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <p id={`${formId}-attachment-hint`} className="field-hint" style={{ marginTop: '0.35rem' }}>
                    Attach a scanned image or PDF. You can remove existing files above, then add a replacement if needed.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={isSavingDocument} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSavingDocument} aria-busy={isSavingDocument}>
                  {isSavingDocument ? 'Saving…' : editDoc
                    ? 'Update'
                    : (isOfficeUser ? 'Send Document' : 'Create Document')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {rejectDoc && (
        <ModalOverlay aria-labelledby={`${formId}-reject-title`} onClose={() => setRejectDoc(null)}>
          <div className="modal reject-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id={`${formId}-reject-title`}>Reject Document</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {rejectDoc.trackingNumber} - {rejectDoc.subject}
                </p>
              </div>
              <button className="btn-icon" aria-label="Close rejection form" onClick={() => setRejectDoc(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleRejectSubmit} noValidate>
              <div className="modal-body">
                {rejectError && (
                  <div id={`${formId}-reject-error`} data-form-error tabIndex={-1} className="form-error-summary" role="alert">{rejectError}</div>
                )}
                <div className="reject-warning">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Reason is required</strong>
                    <span>The receptionist will see this reason before correcting and resubmitting the document.</span>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor={`${formId}-reject-reason`} className="form-label">Rejection Reason</label>
                  <textarea id={`${formId}-reject-reason`} aria-describedby={`${formId}-reject-reason-hint${rejectError ? ` ${formId}-reject-error` : ''}`} aria-invalid={Boolean(rejectError)} required
                    className={`form-input${rejectError ? ' is-invalid' : ''}`}
                    value={rejectReason}
                    onChange={e => {
                      setRejectReason(e.target.value);
                      if (rejectError) setRejectError('');
                    }}
                    placeholder="Explain what needs to be corrected before approval"
                    rows={5}
                    autoFocus
                    style={{ resize: 'vertical' }}
                  />
                  <p id={`${formId}-reject-reason-hint`} className="field-hint">This is shown to the office that must correct and resubmit the document.</p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRejectDoc(null)}>Cancel</button>
                <button type="submit" className="btn btn-danger">
                  <X size={16} /> Reject Document
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {processingAction && (() => {
        const config = processingActionLabels[processingAction.action];
        const doc = processingAction.doc;
        return (
          <ModalOverlay aria-labelledby={`${formId}-action-title`} onClose={() => setProcessingAction(null)}>
            <div className="modal reject-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2 id={`${formId}-action-title`}>{config?.title || 'Document Action'}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {doc.trackingNumber} - {doc.subject}
                  </p>
                </div>
                <button className="btn-icon" aria-label="Close document action" onClick={() => setProcessingAction(null)}><X size={18} /></button>
              </div>
              <form onSubmit={handleProcessingSubmit} noValidate>
                <div className="modal-body">
                  {processingError && (
                    <div data-form-error tabIndex={-1} className="form-error-summary" role="alert">{processingError}</div>
                  )}
                  <div className="reject-warning">
                    <Clock size={18} />
                    <div>
                      <strong>{getWorkflowStatus(doc)} document</strong>
                      <span>{config?.helper}</span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-action-note`} className="form-label">{config?.required ? 'Action Note' : 'Remarks'}</label>
                    <textarea required={Boolean(config?.required)} id={`${formId}-action-note`} aria-describedby={`${formId}-action-note-hint${processingError ? ` ${formId}-action-note-error` : ''}`} aria-invalid={Boolean(processingError)}
                      className={`form-input${processingError ? ' is-invalid' : ''}`}
                      value={processingNote}
                      onChange={e => {
                        setProcessingNote(e.target.value);
                        if (processingError) setProcessingError('');
                      }}
                      placeholder={config?.required ? 'Enter the action taken or instruction' : 'Optional remarks for the timeline'}
                      rows={4}
                      autoFocus
                      style={{ resize: 'vertical' }}
                    />
                    {processingError && (
                      <p id={`${formId}-action-note-error`} className="form-field-error">{processingError}</p>
                    )}
                    <p id={`${formId}-action-note-hint`} className="field-hint">Records the action on the document timeline for audit and tracking.</p>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setProcessingAction(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">
                    <CheckCircle2 size={16} /> {config?.button || 'Save Update'}
                  </button>
                </div>
              </form>
            </div>
          </ModalOverlay>
        );
      })()}

      {previewFile && (
        <ScannedPreviewModal
          file={previewFile}
          canEdit={canManageAttachments(previewDoc)}
          onClose={closePreview}
          onSaveRotated={handleSaveRotatedAttachment}
          onRemove={canManageAttachments(previewDoc) ? () => handleRemoveAttachment(previewDoc, previewFile.id) : undefined}
          onNotify={onNotify}
        />
      )}

      {routeDoc && (
        <ModalOverlay aria-labelledby={`${formId}-route-title`} onClose={closeRouteModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id={`${formId}-route-title`}>Send Document</h2>
              <button type="button" className="btn-icon" aria-label="Close send form" disabled={isSendingDocument} onClick={closeRouteModal}><X size={18} /></button>
            </div>
            <form ref={routeFormRef} onSubmit={handleRouteSubmit} aria-busy={isSendingDocument}>
              <div className="modal-body">
                {routeError && <div id={`${formId}-route-error`} className="form-error-summary" data-form-error role="alert" tabIndex={-1}>{routeError}</div>}
                <div className="form-group">
                  <label htmlFor={`${formId}-route-document`} className="form-label">Document</label>
                  <input id={`${formId}-route-document`} className="form-input" value={`${routeDoc.trackingNumber} - ${routeDoc.subject}`} readOnly />
                </div>
                <div className="form-group">
                  <label htmlFor={`${formId}-route-office`} className="form-label">Current Office</label>
                  <input id={`${formId}-route-office`} className="form-input" value={getOfficeName(routeDoc.currentOfficeId)} readOnly />
                </div>
                <div className="form-group">
                  <label htmlFor={`${formId}-route-custody`} className="form-label">Custody office *</label>
                  <select id={`${formId}-route-custody`} className="form-select" required
                    value={sendCustodyOfficeId} disabled={isSendingDocument || Boolean(routeAttempt)}
                    aria-invalid={Boolean(routeError && !sendCustodyOfficeId)}
                    aria-describedby={`${formId}-route-custody-hint${routeError ? ` ${formId}-route-error` : ''}`}
                    onChange={event => {
                      setSendCustodyOfficeId(event.target.value);
                      setSendCopyOfficeIds(previous => previous.filter(id => id !== event.target.value));
                    }}>
                    <option value="">Choose the receiving office</option>
                    {offices.filter(office => office.id !== routeDoc.currentOfficeId).map(office => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </select>
                  <p id={`${formId}-route-custody-hint`} className="field-hint">
                    This office takes custody after confirming receipt.
                    {routeDoc.sendQueue?.length > 0 && ` Planned next offices: ${routeDoc.sendQueue.map(getOfficeName).join(', ')}. Choose custody explicitly.`}
                  </p>
                </div>
                <div className="form-group">
                  <div id={`${formId}-route-copies-label`} className="form-label">Copy recipients (optional)</div>
                  <div role="group" aria-labelledby={`${formId}-route-copies-label`} aria-describedby={`${formId}-route-copies-hint`} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '220px', overflow: 'auto' }}>
                    {offices
                      .filter((office) => office.id !== routeDoc.currentOfficeId && office.id !== sendCustodyOfficeId)
                      .map((office) => {
                        const checked = sendCopyOfficeIds.includes(office.id);
                        return (
                          <label key={office.id} className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isSendingDocument || Boolean(routeAttempt)}
                                onChange={() => {
                                  setSendCopyOfficeIds((prev) => (
                                    checked
                                      ? prev.filter((id) => id !== office.id)
                                      : [...prev, office.id]
                                  ));
                                }}
                              />
                              {office.name}
                          </label>
                        );
                      })}
                  </div>
                  <p id={`${formId}-route-copies-hint`} className="field-hint">
                    Copy recipients confirm receipt independently. They do not take custody.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={isSendingDocument} onClick={closeRouteModal}>{routeAttempt ? 'Close' : 'Cancel'}</button>
                {routeAttempt ? (
                  <button type="button" className="btn btn-primary" disabled={isSendingDocument} onClick={checkRouteSendStatus}>
                    {isSendingDocument ? 'Checking send…' : 'Check send status'}
                  </button>
                ) : (
                  <button type="submit" className="btn btn-primary" disabled={isSendingDocument}><Send size={16} /> {isSendingDocument ? 'Sending…' : 'Send Document'}</button>
                )}
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default DocumentList;
