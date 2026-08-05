import React, { useEffect, useState } from 'react';
import PageShell from '../components/PageShell';
import ModalOverlay from '../components/ModalOverlay';
import ScannedPreviewModal from '../components/ScannedPreviewModal';
import DocumentWorkflowPipeline from '../components/DocumentWorkflowPipeline';
import {
  Search, Trash2, Edit2, Inbox, Send, Eye, FileText, Plus, X,
  Flag, User, Phone, Mail, MessageSquare, ChevronDown, ChevronUp,
  Paperclip, Upload, Download, MapPin, History, ArrowRightLeft,
  CheckCircle2, Archive, Clock, CalendarDays, AlertTriangle,
} from 'lucide-react';
import {
  documentTypes as defaultDocumentTypes,
  offices as defaultOffices,
  users as defaultUsers,
  priorityLevels,
  getPriorityInfo,
} from '../data/mockData';
import { compareNewest } from '../utils/sorting';
import { validateRequiredFields, clearFieldError } from '../utils/formValidation';

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
  onRouteDocument,
  onReceiveTransmission,
  onVerifyDocument,
  onResubmitDocument,
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
  const getInitialForm = () => {
    const myOfficeId = currentUser?.officeId || offices[0]?.id || 'OFF-001';
    const defaultDestination = offices.find(o => o.id !== myOfficeId)?.id || '';
    const isOffice = currentRole === 'office' || currentUser?.role === 'Office';
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
      destinationOfficeId: isOffice ? defaultDestination : '',
      destinationOfficeOther: '',
      senderName: isOffice
        ? `${currentUser?.fname || ''} ${currentUser?.lname || ''}`.trim()
        : '',
      senderContact: '',
      senderEmail: '',
      notifySender: true,
      senderNotificationConsent: true,
      senderNotificationChannels: ['sms', 'email'],
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
  const [routeForm, setRouteForm] = useState({
    fromOfficeId: currentUser?.officeId || offices[0]?.id || 'OFF-001',
    toOfficeId: offices[1]?.id || offices[0]?.id || 'OFF-001',
    transmissionDate: new Date().toISOString().split('T')[0],
    transmissionType: 'Internal',
  });

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
  const statuses = ['All', 'Received', 'In Transit', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived'];
  const directions = currentRole === 'receptionist'
    ? ['All', 'Incoming']
    : currentRole === 'office'
      ? ['All', 'Outgoing']
      : ['All', 'Incoming', 'Outgoing'];
  const priorities = ['All', ...priorityLevels.map(p => p.id)];

  const getWorkflowStatus = (value) => {
    const status = typeof value === 'string' ? value : value?.status;
    if (status === 'For Signature') return 'For Signing';
    if (status === 'Acknoweledged') return 'Acknowledged';
    return status || 'Received';
  };

  const getStatusClass = (status) => getWorkflowStatus(status).toLowerCase().replace(/\s+/g, '-');

  const getTableStatusDisplay = (doc) => {
    const intake = doc.intakeStatus || 'Approved';
    if (intake === 'Pending Review') {
      return { label: 'Pending Review', className: 'status-pending' };
    }
    if (intake === 'Rejected') {
      return { label: 'Rejected', className: 'status-archived' };
    }
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
  const getDestinationOfficeLabel = (doc) => doc.destinationOfficeOther || (doc.destinationOfficeId ? getOfficeName(doc.destinationOfficeId) : '-');

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
    return senderNotifications
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
      .sort((a, b) => new Date(b.transmissionDate || 0) - new Date(a.transmissionDate || 0))[0];
  };

  const getWorkflowExplanation = (doc) => {
    const pending = getPendingTransmission(doc.id);
    const status = getWorkflowStatus(doc);
    if (doc.intakeStatus === 'Pending Review') {
      return 'Waiting for Admin or Mayor intake review before the document can be routed, signed, filed, or archived.';
    }
    if (doc.intakeStatus === 'Rejected') {
      return doc.rejectionReason
        ? `Rejected for correction: ${doc.rejectionReason}`
        : 'Rejected for correction. Resubmit after fixing the document details.';
    }
    if (pending) {
      return `Waiting for ${getOfficeName(pending.toOfficeId)} to receive transmission ${pending.id}.`;
    }
    if (status === 'For Signing') {
      return 'Waiting for Mayor/Admin signing action.';
    }
    if (status === 'For Filing') {
      return 'Waiting for Mayor/Admin acknowledgement.';
    }
    if (status === 'Signed') {
      return 'Signed and ready to route back or archive.';
    }
    if (status === 'Acknowledged') {
      return 'Acknowledged and ready to route back or archive.';
    }
    if (status === 'Archived') {
      return 'Archived as a final record. No routing or status actions are allowed.';
    }
    if (status === 'Received' && isApprovedForWorkflow(doc)) {
      return 'Approved and ready to acknowledge or route.';
    }
    return '';
  };

  const getCurrentLocation = (doc) => {
    const pending = getPendingTransmission(doc.id);
    const latest = getLatestTransmission(doc.id);

    if (doc.lastDetectedOfficeId && doc.status === 'In Transit') {
      return `Detected at ${getOfficeName(doc.lastDetectedOfficeId)} (pending receipt)`;
    }

    if (doc.status === 'In Transit' && pending) {
      return `In transit to ${getOfficeName(pending.toOfficeId)}`;
    }

    return getOfficeName(
      doc.currentOfficeId ||
      latest?.toOfficeId ||
      doc.originOfficeId ||
      currentUser?.officeId
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
      const matchStatus = filterStatus === 'All' || getWorkflowStatus(d) === filterStatus;
      const matchDir = filterDirection === 'All' || d.documentDirection === filterDirection;
      const matchPriority = filterPriority === 'All' || d.priorityLevel === filterPriority;
      const receivedDate = d.dateReceived || '';
      const matchDate = !filterDate || receivedDate === filterDate;
      return matchSearch && matchStatus && matchDir && matchPriority && matchDate;
    })
    .sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      if (sortBy === 'priority') {
        const diff = (priorityOrder[a.priorityLevel] || 2) - (priorityOrder[b.priorityLevel] || 2);
        if (diff !== 0) return sortAsc ? -diff : diff;
        return compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
      }
      if (sortBy === 'dateReceived') {
        const diff = compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
        return sortAsc ? -diff : diff;
      }
      return compareNewest(a, b, ['createdAt', 'updatedAt', 'dateReceived']);
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

  const handleOpenForm = (doc = null) => {
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

  const handleSubmit = async (e) => {
    e.preventDefault();

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
        when: isOfficeStaff && !editDoc,
      },
    ];
    const validation = validateRequiredFields(requiredFields);

    if (!validation.isValid) {
      setDocumentFormErrors(validation.errors);
      setDocumentFormErrorSummary(validation.summary);
      return;
    }

    setDocumentFormErrors({});
    setDocumentFormErrorSummary('');

    const newFiles = attachmentFile ? [await fileToAttachment(attachmentFile)] : [];
    const nextScannedFiles = [...formScannedFiles, ...newFiles];
    if (!nextScannedFiles.length) {
      setDocumentFormErrors({ attachmentFile: 'Attach at least one scanned file.' });
      setDocumentFormErrorSummary('A scanned file attachment is required.');
      return;
    }

    const isReceptionist = currentUser?.role === 'Receptionist';
    const myOfficeId = currentUser?.officeId || formData.currentOfficeId;
    const editingDoc = editDoc;
    // On edit, never rewrite location offices — routing/receive/RFID own those fields.
    const normalizedFormData = {
      ...formData,
      documentDirection: isReceptionist
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

    if (isOfficeStaff && !editingDoc && !normalizedFormData.destinationOfficeId) {
      setDocumentFormErrors({ destinationOfficeId: 'Choose where to send this document.' });
      setDocumentFormErrorSummary('Destination office is required.');
      return;
    }

    if (isOfficeStaff && !editingDoc && normalizedFormData.destinationOfficeId === myOfficeId) {
      setDocumentFormErrors({ destinationOfficeId: 'Choose a different office than your own.' });
      setDocumentFormErrorSummary('Send the document to reception or another office.');
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

    setShowForm(false);
    setEditDoc(null);
    setAttachmentFile(null);
    setFormScannedFiles([]);

    if (editingDoc) {
      await onEdit(payload);
      return;
    }

    const saved = await onAdd(payload);
    // Office staff: register then route directly to the chosen destination.
    if (isOfficeStaff && saved?.id && normalizedFormData.destinationOfficeId) {
      await onRouteDocument({
        documentId: saved.id,
        fromOfficeId: myOfficeId,
        toOfficeId: normalizedFormData.destinationOfficeId,
        transmissionDate: normalizedFormData.dateReceived,
        transmissionType: 'Internal',
      });
    }
  };

  const openRouteModal = (doc) => {
    const fromOfficeId = doc.currentOfficeId || currentUser?.officeId || offices[0]?.id || 'OFF-001';
    setRouteDoc(doc);
    setRouteForm({
      fromOfficeId,
      toOfficeId: doc.destinationOfficeId && doc.destinationOfficeId !== fromOfficeId
        ? doc.destinationOfficeId
        : offices.find(o => o.id !== fromOfficeId)?.id || fromOfficeId,
      transmissionDate: new Date().toISOString().split('T')[0],
      transmissionType: 'Internal',
    });
  };

  const handleRouteSubmit = async (e) => {
    e.preventDefault();
    if (!routeDoc) return;
    if (routeForm.fromOfficeId === routeForm.toOfficeId) {
      notify('Choose a different destination office before routing.');
      return;
    }

    const routingDoc = routeDoc;
    setRouteDoc(null);

    await onRouteDocument({
      documentId: routingDoc.id,
      ...routeForm,
    });
  };

  const handleReceive = async (doc) => {
    const pending = getPendingTransmission(doc.id);
    if (!pending) return;

    try {
      await onReceiveTransmission(pending.id, {
        receivedBy: currentUser?.id,
        receivedAt: new Date().toISOString(),
      });
    } catch {
      // The shared save handler already shows the API error.
    }
  };

  const handleRejectDocument = (doc) => {
    setRejectDoc(doc);
    setRejectReason(doc.rejectionReason || '');
    setRejectError('');
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectDoc) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required.');
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
      title: 'Mark Signed',
      helper: 'Use this after the document has been signed.',
      button: 'Mark Signed',
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
    if (!processingAction) return;
    const config = processingActionLabels[processingAction.action];
    if (config?.required && !processingNote.trim()) {
      setProcessingError('Action note is required.');
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
  const canManageAttachments = canEdit || isOfficeUser;
  const canRoute = isApprovalUser || currentRole === 'receptionist' || isOfficeUser;
  const canVerify = isApprovalUser;
  const isApprovedForWorkflow = (doc) => (doc.intakeStatus || 'Approved') === 'Approved';
  const canResubmitDocument = (doc) => doc.intakeStatus === 'Rejected' && registrationStatuses.includes(getWorkflowStatus(doc)) && (
    currentRole === 'admin' || doc.currentOfficeId === currentUser?.officeId
  );
  const canRouteDocument = (doc) => {
    const status = getWorkflowStatus(doc);
    const finalStatus = finalWorkflowStatuses.includes(status);
    return canRoute && isApprovedForWorkflow(doc) && transmittableStatuses.includes(status) && (
      isApprovalUser || (!finalStatus && doc.currentOfficeId === currentUser?.officeId)
    );
  };
  const canReceiveTransmission = (transmission) => Boolean(transmission) && !transmission.receivedBy && (
    transmission.toOfficeId === currentUser?.officeId
  );
  const canTakeDocumentAction = (doc) => isApprovalUser && isApprovedForWorkflow(doc) && ['Received', 'For Signing', 'For Filing', ...finalWorkflowStatuses].includes(getWorkflowStatus(doc));
  const canArchiveDocument = (doc) => isApprovalUser && isApprovedForWorkflow(doc) && finalWorkflowStatuses.includes(getWorkflowStatus(doc));
  const pageTitle = isOfficeUser ? 'My Documents' : 'Documents';
  const pageSubtitle = isOfficeUser
    ? 'Send documents to reception or other offices and track their progress'
    : 'Scan, route, acknowledge, sign, file, and archive official documents';
  const createButtonLabel = isOfficeUser ? 'Send Document' : 'New Document';
  const destinationOffices = offices.filter(o => o.id !== (currentUser?.officeId || formData.currentOfficeId));

  const renderDocumentActions = (doc, pendingTransmission) => {
    const status = getWorkflowStatus(doc);
    return (
      <div className="workflow-actions">
        {canVerify && doc.intakeStatus === 'Pending Review' && (
          <>
            <button className="btn btn-sm btn-success" onClick={() => onVerifyDocument?.(doc.id, 'Approved')}>
              <CheckCircle2 size={14} /> Approve
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => handleRejectDocument(doc)}>
              <X size={14} /> Reject
            </button>
          </>
        )}
        {canResubmitDocument(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => onResubmitDocument?.(doc.id)}>
            <Clock size={14} /> Resubmit
          </button>
        )}
        {canRouteDocument(doc) && (
          <button className="btn btn-sm btn-primary" onClick={() => openRouteModal(doc)}>
            <Send size={14} /> Route
          </button>
        )}
        {canReceiveTransmission(pendingTransmission) && (
          <button className="btn btn-sm btn-success" onClick={() => handleReceive(doc)}>
            <CheckCircle2 size={14} /> Receive
          </button>
        )}
        {canTakeDocumentAction(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => openProcessingAction(doc, 'action_note')}>
            <MessageSquare size={14} /> Add Action
          </button>
        )}
        {canTakeDocumentAction(doc) && status === 'For Signing' && (
          <button className="btn btn-sm btn-success" onClick={() => openProcessingAction(doc, 'sign_document')}>
            <CheckCircle2 size={14} /> Signed
          </button>
        )}
        {canTakeDocumentAction(doc) && ['Received', 'For Filing'].includes(status) && (
          <button className="btn btn-sm btn-success" onClick={() => openProcessingAction(doc, 'acknowledge_document')}>
            <CheckCircle2 size={14} /> Acknowledge
          </button>
        )}
        {canArchiveDocument(doc) && (
          <button className="btn btn-sm btn-secondary" onClick={() => onArchiveDocument(doc.id)}>
            <Archive size={14} /> Archive
          </button>
        )}
        {!canVerify && !canResubmitDocument(doc) && !canRouteDocument(doc) && !canReceiveTransmission(pendingTransmission) && !canTakeDocumentAction(doc) && !canArchiveDocument(doc) && (
          <p className="detail-empty">No actions are currently available for your role and this document status.</p>
        )}
      </div>
    );
  };

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
              <label>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="Search by subject, tracking, sender, office, type, or location..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="filter-dropdown filter-dropdown-date">
              <label htmlFor="document-date-filter">Date</label>
              <input
                id="document-date-filter"
                className="form-input"
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
              />
            </div>

            <div className="filter-dropdowns">
              <div className="filter-dropdown">
                <label>Status</label>
                <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div className="filter-dropdown">
                <label>Direction</label>
                <select className="form-select" value={filterDirection} onChange={e => setFilterDirection(e.target.value)}>
                  {directions.map(direction => (
                    <option key={direction} value={direction}>{direction}</option>
                  ))}
                </select>
              </div>

              <div className="filter-dropdown">
                <label>Priority</label>
                <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
                  {priorities.map(priority => {
                    const pInfo = priority === 'All' ? null : getPriorityInfo(priority);
                    return (
                      <option key={priority} value={priority}>
                        {priority === 'All' ? 'All Priority' : pInfo?.label}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </div>
        }
      >
      <section className="document-panel">
        <div className="table-container documents-table-container">
          <table className="documents-table">
          <thead>
            <tr>
              <th className="documents-col-tracking">Tracking #</th>
              <th className="documents-col-subject">Subject</th>
              <th className="documents-col-priority" style={{ cursor: 'pointer' }} onClick={() => handleSort('priority')}>
                Priority <SortIcon field="priority" />
              </th>
              <th className="documents-col-type">Type</th>
              <th className="documents-col-location">Location</th>
              <th className="documents-col-direction">Direction</th>
              <th className="documents-col-status-header">Status</th>
              <th className="documents-col-files">Files</th>
              <th className="documents-col-date" style={{ cursor: 'pointer' }} onClick={() => handleSort('dateReceived')}>
                Date <SortIcon field="dateReceived" />
              </th>
              <th className="documents-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedDocs.length > 0 ? paginatedDocs.map(doc => {
              const pInfo = getPriorityInfo(doc.priorityLevel);
              const isExpanded = expandedRow === doc.id;
              const pendingTransmission = getPendingTransmission(doc.id);
              const files = getDocumentFiles(doc);
              const timeline = getTimeline(doc);
              const workflowExplanation = getWorkflowExplanation(doc);
              const tableStatus = getTableStatusDisplay(doc);

              return (
                <React.Fragment key={doc.id}>
                  <tr
                    className="clickable-row"
                    aria-label="Open document details"
                    onClick={() => setDetailDoc(doc)}
                  >
                    <td className="documents-col-tracking" title={doc.trackingNumber}>
                      <span className="td-mono documents-tracking-code">{doc.trackingNumber}</span>
                    </td>
                    <td className="td-primary documents-col-subject" title={doc.subject}>{doc.subject}</td>
                    <td className="documents-col-priority">
                      <span
                        className="documents-priority-badge"
                        style={{
                          background: pInfo.bg,
                          color: pInfo.color,
                          border: `1px solid ${pInfo.color}22`,
                        }}
                      >
                        <Flag size={9} />
                        {pInfo.label}
                      </span>
                    </td>
                    <td className="documents-col-type" title={getDocumentTypeLabel(doc)}>{getDocumentTypeLabel(doc)}</td>
                    <td className="documents-col-location" title={getCurrentLocation(doc)}>
                      <span className="documents-location-label">
                        <MapPin size={11} />
                        <span className="documents-location-text">{getCurrentLocation(doc)}</span>
                      </span>
                    </td>
                    <td className="documents-col-direction">
                      <span className={`direction-badge direction-${doc.documentDirection.toLowerCase()}`}>
                        {doc.documentDirection === 'Incoming' ? <Inbox size={11} /> : <Send size={11} />}
                        {doc.documentDirection}
                      </span>
                    </td>
                    <td className="documents-col-status-cell">
                      <span className={`status-badge ${tableStatus.className}`}>
                        {tableStatus.label}
                      </span>
                    </td>
                    <td className="documents-col-files">
                      <span className={`documents-files-count ${files.length ? 'has-files' : ''}`}>
                        <Paperclip size={12} /> {files.length}
                      </span>
                    </td>
                    <td className="documents-col-date">{doc.dateReceived}</td>
                    <td className="documents-col-actions">
                      <div className="documents-actions-wrap">
                        <button className="btn-icon" title="Open details" onClick={(e) => { e.stopPropagation(); setDetailDoc(doc); }}>
                          <Eye size={14} />
                        </button>
                        {canEdit && (
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
                      <td colSpan="10" style={{ padding: '1rem 1.5rem', background: 'var(--bg-elevated)' }}>
                        <DocumentWorkflowPipeline
                          doc={doc}
                          hasPendingTransmission={Boolean(pendingTransmission)}
                          locationLabel={getCurrentLocation(doc)}
                          workflowNote={workflowExplanation}
                        />
                        <div className="document-detail-grid">
                          <div className="document-detail-section">
                            <h4><User size={14} /> Sender and Metadata</h4>
                            <div className="detail-pair"><span>Sender</span><strong>{doc.senderName || '-'}</strong></div>
                            <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
                            <div className="detail-pair"><span>Email</span><strong>{doc.senderEmail || '-'}</strong></div>
                            <div className="detail-pair"><span>Remarks</span><strong>{doc.remarks || '-'}</strong></div>
                          </div>

                          <div className="document-detail-section">
                            <h4><ArrowRightLeft size={14} /> Workflow Actions</h4>
                            {renderDocumentActions(doc, pendingTransmission)}
                            <div className="detail-pair"><span>Origin</span><strong>{getOriginOfficeLabel(doc)}</strong></div>
                            <div className="detail-pair"><span>Current</span><strong>{getCurrentLocation(doc)}</strong></div>
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
                                      title="Choose download format"
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
                                    {canManageAttachments && (
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
                <td colSpan="10">
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
        const doc = documents.find(item => item.id === detailDoc.id) || detailDoc;
        const files = getDocumentFiles(doc);
        const timeline = getTimeline(doc);
        const pendingTransmission = getPendingTransmission(doc.id);
        const senderOutbox = getSenderNotifications(doc.id);
        const workflowExplanation = getWorkflowExplanation(doc);

        return (
          <ModalOverlay onClose={() => setDetailDoc(null)}>
            <div className="modal document-detail-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2>{doc.subject}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {doc.trackingNumber} - {getDocumentTypeLabel(doc)}
                  </p>
                </div>
                <button className="btn-icon" onClick={() => setDetailDoc(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <DocumentWorkflowPipeline
                  doc={doc}
                  hasPendingTransmission={Boolean(pendingTransmission)}
                  locationLabel={getCurrentLocation(doc)}
                  workflowNote={workflowExplanation}
                />
                <div className="document-detail-grid">
                  <div className="document-detail-section">
                    <h4><MapPin size={14} /> Location</h4>
                    <div className="detail-pair"><span>Status</span><strong>{getWorkflowStatus(doc)}</strong></div>
                    <div className="detail-pair"><span>Intake Review</span><strong>{doc.intakeStatus || 'Approved'}</strong></div>
                    {workflowExplanation && <div className="detail-pair"><span>Workflow Note</span><strong>{workflowExplanation}</strong></div>}
                    {doc.rejectionReason && <div className="detail-pair"><span>Rejection Reason</span><strong>{doc.rejectionReason}</strong></div>}
                    <div className="detail-pair"><span>Current</span><strong>{getCurrentLocation(doc)}</strong></div>
                    <div className="detail-pair"><span>Origin</span><strong>{getOriginOfficeLabel(doc)}</strong></div>
                    <div className="detail-pair"><span>Destination</span><strong>{getDestinationOfficeLabel(doc)}</strong></div>
                    {currentRole !== 'receptionist' && (
                      <>
                        <div className="detail-pair"><span>RFID Tag</span><strong>{doc.rfidTag || '-'}</strong></div>
                        <div className="detail-pair"><span>Last Detected</span><strong>{doc.lastDetectedOfficeId ? `${getOfficeName(doc.lastDetectedOfficeId)} - ${formatDateTime(doc.lastDetectedAt)}` : '-'}</strong></div>
                      </>
                    )}
                  </div>

                  <div className="document-detail-section">
                    <h4><User size={14} /> Sender</h4>
                    <div className="detail-pair"><span>Name</span><strong>{doc.senderName || '-'}</strong></div>
                    <div className="detail-pair"><span>Contact</span><strong>{doc.senderContact || '-'}</strong></div>
                    <div className="detail-pair"><span>Email</span><strong>{doc.senderEmail || '-'}</strong></div>
                    <div className="detail-pair"><span>Priority</span><strong>{getPriorityInfo(doc.priorityLevel).label}</strong></div>
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
                              title="Choose download format"
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
                            {canManageAttachments && (
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

                  <div className="document-detail-section document-actions-section document-timeline-section">
                    <h4><ArrowRightLeft size={14} /> Document Actions</h4>
                    {renderDocumentActions(doc, pendingTransmission)}
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
                    {senderOutbox.length ? (
                      <div className="sender-notification-list">
                        {senderOutbox.map(item => (
                          <div key={item.id} className="sender-notification-item">
                            <div>
                              <span className={`sender-channel-badge ${item.channel}`}>{item.channel?.toUpperCase()}</span>
                              <strong>{item.subject || item.eventType}</strong>
                              <p>{item.message}</p>
                              <small>{item.recipient} - {item.status} - {formatDateTime(item.createdAt)}</small>
                            </div>
                            <button className="btn btn-sm btn-secondary" onClick={() => onResendSenderNotification?.(item.id)}>
                              <Send size={13} /> Requeue
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="detail-empty">No sender updates queued yet. Updates are created when the document moves through the workflow.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </ModalOverlay>
        );
      })()}

      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="modal document-form-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {editDoc
                  ? 'Edit Document'
                  : (isOfficeUser ? 'Send Document' : 'New Document')}
              </h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              <div className="modal-body">
                {documentFormErrorSummary && (
                  <div className="form-error-summary" role="alert">{documentFormErrorSummary}</div>
                )}
                <div className="form-group">
                  <label className="form-label">Document Subject <span className="required-mark">*</span></label>
                  <input
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
                    <p className="form-field-error">{documentFormErrors.subject}</p>
                  )}
                  <p className="field-hint">Shortly describe the document so staff can recognize it in lists, reports, and tracking.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Document Type</label>
                    <select
                      className="form-select"
                      value={formData.documentTypeId}
                      onChange={e => setFormData({ ...formData, documentTypeId: e.target.value })}
                    >
                      {documentTypes.map(dt => (
                        <option key={dt.id} value={dt.id}>{dt.category}</option>
                      ))}
                    </select>
                    <p className="field-hint">Classifies the record for filtering and official reports.</p>
                    {isOtherDocumentType(formData.documentTypeId) && (
                      <>
                        <input
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
                          <p className="form-field-error">{documentFormErrors.documentTypeOther}</p>
                        )}
                        <p className="field-hint">Names the custom document type when it is not in the list.</p>
                      </>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Direction</label>
                    <select
                      className="form-select"
                      value={formData.documentDirection}
                      onChange={e => setFormData({ ...formData, documentDirection: e.target.value })}
                      disabled={currentRole === 'receptionist' || isOfficeUser}
                    >
                      {!isOfficeUser && <option>Incoming</option>}
                      {(currentRole !== 'receptionist' || isOfficeUser) && <option>Outgoing</option>}
                    </select>
                    <p className="field-hint">
                      {isOfficeUser
                        ? 'Office staff send outgoing documents to reception or other offices.'
                        : 'Incoming means received from a sender; outgoing means created by the office.'}
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">
                      <Flag size={12} style={{ marginRight: '0.25rem' }} />
                      Priority Level
                    </label>
                    <div
                      className="priority-select-wrap"
                      style={{
                        '--priority-color': getPriorityInfo(formData.priorityLevel).color,
                        '--priority-bg': getPriorityInfo(formData.priorityLevel).bg,
                      }}
                    >
                      <span className="priority-color-preview"></span>
                      <select
                        className="form-select priority-select"
                        value={formData.priorityLevel}
                        onChange={e => setFormData({ ...formData, priorityLevel: e.target.value })}
                      >
                        {priorityLevels.map(p => (
                          <option key={p.id} value={p.id} style={{ color: p.color, backgroundColor: p.bg }}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <p className="field-hint">Controls queue urgency and highlights items that need faster attention.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Pending Workflow Status</label>
                    <select
                      className="form-select"
                      value={formData.status}
                      onChange={e => setFormData({ ...formData, status: e.target.value })}
                      disabled={Boolean(editDoc) || (currentRole !== 'receptionist' && currentRole !== 'admin') || isOfficeUser}
                    >
                      {registrationStatuses.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <p className="field-hint">Set the starting workflow status. Mayor actions finish it after approval.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Date Received</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.dateReceived}
                      disabled
                      required
                    />
                    <p className="field-hint">Locked to the registration date.</p>
                  </div>
                  {isOfficeUser ? (
                    <div className="form-group">
                      <label className="form-label">Send To Office <span className="required-mark">*</span></label>
                      <select
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
                        <p className="form-field-error">{documentFormErrors.destinationOfficeId}</p>
                      )}
                      <p className="field-hint">Document is registered from your office, then sent to this destination.</p>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">Incoming Office</label>
                      <select
                        className="form-select"
                        value={formData.originOfficeId}
                        onChange={e => setFormData({
                          ...formData,
                          originOfficeId: e.target.value,
                        })}
                        disabled={Boolean(editDoc)}
                      >
                        {(Boolean(editDoc)
                          ? offices.filter(o => o.id === formData.originOfficeId)
                          : offices
                        ).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <p className="field-hint">Where the document came from within the municipal office list.</p>
                    </div>
                  )}
                </div>
                {!isOfficeUser && (
                  <div className="form-group">
                    <label className="form-label">Receiving Office</label>
                    <select
                      className="form-select"
                      value={formData.currentOfficeId}
                      onChange={e => setFormData({
                        ...formData,
                        currentOfficeId: e.target.value,
                        destinationOfficeId: e.target.value,
                      })}
                      disabled={Boolean(editDoc)}
                    >
                      {(Boolean(editDoc)
                        ? offices.filter(o => o.id === formData.currentOfficeId)
                        : offices
                      ).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">The office currently responsible for the document after registration.</p>
                  </div>
                )}
                {isOfficeUser && (
                  <div className="form-group">
                    <label className="form-label">From Office</label>
                    <select className="form-select" value={formData.currentOfficeId} disabled>
                      {offices
                        .filter(o => o.id === formData.currentOfficeId)
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">Your assigned office — documents are always sent from here.</p>
                  </div>
                )}

                {!isOfficeUser && (
                <div className="form-group">
                  <label className="form-label">External / Other Source Office</label>
                  <input
                    className="form-input"
                    type="text"
                    value={formData.originOfficeOther}
                    onChange={e => setFormData({ ...formData, originOfficeOther: e.target.value })}
                    placeholder="School, agency, municipality, barangay, or other sender office"
                  />
                  <p className="field-hint">Use this when the document came from outside the municipal office list.</p>
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
                  <div className="form-group">
                    <label className="form-label">Sender Name <span className="required-mark">*</span></label>
                    <input
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
                      <p className="form-field-error">{documentFormErrors.senderName}</p>
                    )}
                    <p className="field-hint">Appears in tracking and helps staff identify who submitted the document.</p>
                  </div>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">
                        <Phone size={12} style={{ marginRight: '0.25rem' }} />Contact Number
                      </label>
                      <input className="form-input" type="tel" value={formData.senderContact}
                        onChange={e => setFormData({ ...formData, senderContact: e.target.value })}
                        placeholder="09XX-XXX-XXXX" />
                      <p className="field-hint">Used for SMS tracking updates when sender notifications are enabled.</p>
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        <Mail size={12} style={{ marginRight: '0.25rem' }} />Email
                      </label>
                      <input className="form-input" type="email" value={formData.senderEmail}
                        onChange={e => setFormData({ ...formData, senderEmail: e.target.value })}
                        placeholder="email@example.com" />
                      <p className="field-hint">Used for email tracking updates and status notices.</p>
                    </div>
                  </div>
                  <div className="sender-notification-options">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={formData.notifySender}
                        onChange={e => setFormData({ ...formData, notifySender: e.target.checked })}
                      />
                      Send tracking number and status updates to sender
                    </label>
                    <div className="sender-channel-options">
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(formData.senderNotificationChannels || []).includes('sms')}
                          onChange={() => toggleSenderChannel('sms')}
                        />
                        SMS
                      </label>
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(formData.senderNotificationChannels || []).includes('email')}
                          onChange={() => toggleSenderChannel('email')}
                        />
                        Email
                      </label>
                    </div>
                    <p className="field-hint">Choose how the sender receives the tracking number and workflow updates.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <MessageSquare size={12} style={{ marginRight: '0.25rem' }} />Remarks
                    </label>
                    <textarea className="form-input" value={formData.remarks}
                      onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                      placeholder="Additional notes" rows={2} style={{ resize: 'vertical' }} />
                    <p className="field-hint">Optional internal note for context, instructions, or special handling.</p>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">
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
                  <input
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
                    <p className="form-field-error">{documentFormErrors.attachmentFile}</p>
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
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    Attach a scanned image or PDF. You can remove existing files above, then add a replacement if needed.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">
                  {editDoc
                    ? 'Update'
                    : (isOfficeUser ? 'Send Document' : 'Create Document')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {rejectDoc && (
        <ModalOverlay onClose={() => setRejectDoc(null)}>
          <div className="modal reject-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Reject Document</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {rejectDoc.trackingNumber} - {rejectDoc.subject}
                </p>
              </div>
              <button className="btn-icon" onClick={() => setRejectDoc(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleRejectSubmit} noValidate>
              <div className="modal-body">
                {rejectError && (
                  <div className="form-error-summary" role="alert">{rejectError}</div>
                )}
                <div className="reject-warning">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Reason is required</strong>
                    <span>The receptionist will see this reason before correcting and resubmitting the document.</span>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Rejection Reason</label>
                  <textarea
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
                  <p className="field-hint">This is shown to the office that must correct and resubmit the document.</p>
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
          <ModalOverlay onClose={() => setProcessingAction(null)}>
            <div className="modal reject-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2>{config?.title || 'Document Action'}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {doc.trackingNumber} - {doc.subject}
                  </p>
                </div>
                <button className="btn-icon" onClick={() => setProcessingAction(null)}><X size={18} /></button>
              </div>
              <form onSubmit={handleProcessingSubmit} noValidate>
                <div className="modal-body">
                  {processingError && (
                    <div className="form-error-summary" role="alert">{processingError}</div>
                  )}
                  <div className="reject-warning">
                    <Clock size={18} />
                    <div>
                      <strong>{getWorkflowStatus(doc)} document</strong>
                      <span>{config?.helper}</span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{config?.required ? 'Action Note' : 'Remarks'}</label>
                    <textarea
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
                      <p className="form-field-error">{processingError}</p>
                    )}
                    <p className="field-hint">Records the action on the document timeline for audit and tracking.</p>
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
          canEdit={canManageAttachments}
          onClose={closePreview}
          onSaveRotated={handleSaveRotatedAttachment}
          onRemove={canManageAttachments ? () => handleRemoveAttachment(previewDoc, previewFile.id) : undefined}
          onNotify={onNotify}
        />
      )}

      {routeDoc && (
        <ModalOverlay onClose={() => setRouteDoc(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Route Document</h2>
              <button className="btn-icon" onClick={() => setRouteDoc(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleRouteSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Document</label>
                  <input className="form-input" value={`${routeDoc.trackingNumber} - ${routeDoc.subject}`} readOnly />
                  <p className="field-hint">The selected document that will be transmitted to another office.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">From Office</label>
                    <select
                      className="form-select"
                      value={routeForm.fromOfficeId}
                      onChange={e => setRouteForm({ ...routeForm, fromOfficeId: e.target.value })}
                      disabled={!isApprovalUser}
                    >
                      {(isApprovalUser ? offices : offices.filter(o => o.id === routeForm.fromOfficeId))
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">The office currently holding and sending the document.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">To Office</label>
                    <select className="form-select" value={routeForm.toOfficeId}
                      onChange={e => setRouteForm({ ...routeForm, toOfficeId: e.target.value })}>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">The destination office that must receive the transmission.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Transmission Type</label>
                    <select className="form-select" value={routeForm.transmissionType}
                      onChange={e => setRouteForm({ ...routeForm, transmissionType: e.target.value })}>
                      <option>Internal</option>
                      <option>External</option>
                    </select>
                    <p className="field-hint">Marks whether the route stays inside the municipality or goes outside.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input className="form-input" type="date" value={routeForm.transmissionDate}
                      onChange={e => setRouteForm({ ...routeForm, transmissionDate: e.target.value })} required />
                    <p className="field-hint">The official sending date recorded in the transmission history.</p>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRouteDoc(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><Send size={16} /> Route Document</button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default DocumentList;
