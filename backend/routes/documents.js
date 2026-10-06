const express = require('express');
const router = express.Router();
const { Document, Transmission, Archive, DeviceEvent, Command, SenderNotification, Notification, Office, User, DocumentType } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  generateId,
  generateTrackingNumber,
  notifyApprovalUsers,
  createNotification,
  appendDocumentTimeline,
  createTimelineEvent,
  normalizeWorkflowStatus,
  normalizeText,
  isApprovalRole,
  getUserOfficeId,
} = require('../utils/helpers');
const { normalizeSenderNotificationChannels, queueSenderNotifications } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');
const { getScopedDocumentQueryWithTransmissions } = require('../utils/documentScope');
const { persistAttachments, removeOrphanedAttachments } = require('../utils/attachments');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const approvalRoles = allowRoles('Admin', 'Mayor');
const scannerRoles = allowRoles('Admin', 'Receptionist');
const documentCreateRoles = allowRoles('Admin', 'Receptionist', 'Office');
const sendRoles = allowRoles('Admin', 'Mayor', 'Office');

const updateOptions = { new: true, runValidators: true };
const intakeStatuses = ['Pending Review', 'Approved', 'Rejected', 'Returned to Sender'];
const registrationStatuses = ['Received', 'For Signing', 'For Filing'];
const finalWorkflowStatuses = ['Signed', 'Acknowledged'];
const transmittableStatuses = ['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'];

const storedWorkflowStatuses = ['Received', 'In Transit', 'Processing', 'For Signature', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived', 'Returned to Sender'];

const runPostSaveSideEffects = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`Post-save side effect failed (${label}):`, err.message);
  }
};

const findMayorsOfficeId = async () => {
  const offices = await Office.find({}).lean();
  const mayorOffice = (offices || []).find((office) => /mayor/i.test(office.name || ''));
  return mayorOffice?.id || 'OFF-001';
};

const findReceptionOfficeId = async (fallbackId = '') => {
  const receptionist = await User.findOne({ role: 'Receptionist' }).lean();
  if (receptionist?.officeId) return receptionist.officeId;
  return fallbackId || 'OFF-001';
};

const assertCanAccessDocument = async (req, documentId) => {
  const doc = await Document.findOne({ id: documentId, ...(await getScopedDocumentQueryWithTransmissions(req)) });
  if (!doc) {
    const err = new Error('Document not found or not visible to your office');
    err.status = 404;
    throw err;
  }

  return doc;
};

const assertValidDocumentUpdate = (req, existingDoc, updates) => {
  if (updates.status && !storedWorkflowStatuses.includes(updates.status)) {
    const err = new Error(`Invalid document status: ${updates.status}`);
    err.status = 400;
    throw err;
  }

  if (updates.intakeStatus && !intakeStatuses.includes(updates.intakeStatus)) {
    const err = new Error(`Invalid intake status: ${updates.intakeStatus}`);
    err.status = 400;
    throw err;
  }

  if (existingDoc.status === 'Archived') {
    const err = new Error('Archived documents are final. Restore or create a correction record instead of editing the archived document.');
    err.status = 403;
    throw err;
  }

  const comparable = (value) => value === undefined || value === null ? '' : value;

  if (updates.dateReceived !== undefined && comparable(updates.dateReceived) !== comparable(existingDoc.dateReceived)) {
    const err = new Error('Date received is locked after registration');
    err.status = 400;
    throw err;
  }

  if (!isApprovalRole(req) && existingDoc.currentOfficeId !== getUserOfficeId(req)) {
    const err = new Error('Only the current office or an approval user can edit this document');
    err.status = 403;
    throw err;
  }

  if (updates.intakeStatus && updates.intakeStatus !== existingDoc.intakeStatus) {
    const err = new Error('Use the approval/rejection action to change intake review status');
    err.status = isApprovalRole(req) ? 400 : 403;
    throw err;
  }

  const changedVerificationField = ['verifiedBy', 'verifiedAt', 'rejectionReason'].some(field =>
    updates[field] !== undefined && comparable(updates[field]) !== comparable(existingDoc[field])
  );
  if (changedVerificationField) {
    const err = new Error('Use the approval/rejection action to change document verification details');
    err.status = isApprovalRole(req) ? 400 : 403;
    throw err;
  }

  const isPendingRegistrationStatusChange = !isApprovalRole(req) &&
    ['Pending Review', 'Rejected'].includes(existingDoc.intakeStatus || 'Approved') &&
    registrationStatuses.includes(updates.status);

  if (updates.status && updates.status !== existingDoc.status && !isApprovalRole(req) && !isPendingRegistrationStatusChange) {
    const err = new Error('Only approval users can change document workflow status');
    err.status = 403;
    throw err;
  }

  if (updates.status && updates.status !== existingDoc.status) {
    if (isPendingRegistrationStatusChange) {
      return;
    }
    if (existingDoc.intakeStatus !== 'Approved') {
      const err = new Error('Document must be approved before its workflow status can change');
      err.status = 400;
      throw err;
    }

    const allowedTransitions = {
      'For Signing': ['Signed'],
      'For Signature': ['Signed'],
      'For Filing': ['Acknowledged'],
    };
    const nextStatuses = allowedTransitions[existingDoc.status] || [];
    if (!nextStatuses.includes(updates.status)) {
      const err = new Error(`Invalid workflow transition from ${existingDoc.status} to ${updates.status}. Use routing, receiving, signing, filing, and archiving actions in order.`);
      err.status = 400;
      throw err;
    }
  }
};

const normalizeDocumentPayload = async (req, body, { scanner = false } = {}) => {
  const userOfficeId = getUserOfficeId(req);
  const isOfficeUser = req.user?.role === 'Office';
  const isReceptionist = req.user?.role === 'Receptionist';
  const mayorsOfficeId = await findMayorsOfficeId();
  const documentDirection = isOfficeUser
    ? 'Outgoing'
    : (!isApprovalRole(req)
      ? 'Incoming'
      : (body.documentDirection === 'Outgoing' ? 'Outgoing' : 'Incoming'));

  let originOfficeId;
  let currentOfficeId;
  let destinationOfficeId;

  if (isReceptionist || (scanner && !isApprovalRole(req))) {
    // External citizen docs: register at reception custody source, deliver only to Mayor.
    originOfficeId = userOfficeId;
    currentOfficeId = mayorsOfficeId;
    destinationOfficeId = mayorsOfficeId;
  } else if (isOfficeUser) {
    originOfficeId = userOfficeId;
    currentOfficeId = userOfficeId;
    destinationOfficeId = body.destinationOfficeId || '';
  } else if (isApprovalRole(req)) {
    originOfficeId = body.originOfficeId || body.currentOfficeId || userOfficeId;
    currentOfficeId = body.currentOfficeId || body.destinationOfficeId || body.originOfficeId || userOfficeId;
    destinationOfficeId = body.destinationOfficeId || '';
  } else {
    originOfficeId = userOfficeId;
    currentOfficeId = userOfficeId;
    destinationOfficeId = body.destinationOfficeId || '';
  }

  const now = new Date().toISOString();
  const scannedFiles = await persistAttachments(req, body.scannedFiles || []);
  // External docs go straight to Mayor as actionable (no Pending Review gate).
  const defaultIntakeStatus = (isReceptionist || scanner)
    ? 'Approved'
    : 'Approved';
  const requestedIntakeStatus = isApprovalRole(req) && intakeStatuses.includes(body.intakeStatus)
    ? body.intakeStatus
    : defaultIntakeStatus;
  const requestedStatus = normalizeWorkflowStatus(body.status);
  const canSetInitialStatus = isApprovalRole(req);
  const registrationStatus = canSetInitialStatus && registrationStatuses.includes(requestedStatus) ? requestedStatus : 'Received';

  // Document type is for outsiders only; internal office docs get a placeholder type.
  let documentTypeId = body.documentTypeId;
  if (isOfficeUser && !documentTypeId) {
    documentTypeId = 'DT-INTERNAL';
  }

  // Phase 2 — Mayor Gate & Route Plan Setup
  let docType = null;
  if (documentTypeId) {
    docType = await DocumentType.findOne({ id: documentTypeId }).lean();
  }
  const requiresMayorApproval = docType?.requiresMayorApproval || false;

  let routePlan = [];
  let routeStep = 0;
  let finalStatus = registrationStatus;

  if (requiresMayorApproval) {
    // Force path through Mayor's Office
    routePlan = [originOfficeId, mayorsOfficeId];
    if (destinationOfficeId && destinationOfficeId !== mayorsOfficeId && destinationOfficeId !== originOfficeId) {
      routePlan.push(destinationOfficeId);
    }
    currentOfficeId = mayorsOfficeId;
    finalStatus = 'For Signing';
    routeStep = 1; // Start at Mayor's office
  } else {
    // Direct routing
    routePlan = [originOfficeId];
    if (destinationOfficeId && destinationOfficeId !== originOfficeId) {
      routePlan.push(destinationOfficeId);
    }
    routeStep = 0; // Start at origin
    // currentOfficeId remains as calculated earlier
  }

  const channels = normalizeSenderNotificationChannels(body.senderNotificationChannels, body)
    .filter((channel) => channel !== 'email');

  return {
    ...body,
    id: body.id || generateId('DOC'),
    trackingNumber: body.trackingNumber || generateTrackingNumber(),
    documentDirection,
    status: finalStatus,
    intakeStatus: requestedIntakeStatus,
    priorityLevel: 'normal',
    dateReceived: body.dateReceived || now.split('T')[0],
    createdAt: body.createdAt || now,
    updatedAt: now,
    documentTypeId,
    documentTypeOther: normalizeText(body.documentTypeOther),
    originOfficeId,
    originOfficeOther: normalizeText(body.originOfficeOther),
    currentOfficeId,
    destinationOfficeId,
    destinationOfficeOther: normalizeText(body.destinationOfficeOther),
    rfidTag: '',
    lastDetectedOfficeId: '',
    lastDetectedAt: '',
    senderEmail: '',
    senderNotificationChannels: channels.length ? channels : (body.senderContact ? ['sms'] : []),
    notifySender: body.notifySender !== undefined ? Boolean(body.notifySender) : true,
    senderNotificationConsent: body.senderNotificationConsent !== undefined ? Boolean(body.senderNotificationConsent) : true,
    scannedFiles,
    scannedImageUrl: body.scannedImageUrl || scannedFiles[0]?.url || scannedFiles[0]?.dataUrl,
    sendHistory: Array.isArray(body.sendHistory) ? body.sendHistory : [],
    sendQueue: Array.isArray(body.sendQueue) ? body.sendQueue : [],
    routePlan,
    routeStep,
    mayorApprovalCleared: false,
  };
};

router.use(protect);

// ================= SCANNER INTAKE =================
router.post('/scanner', scannerRoles, asyncHandler(async (req, res) => {
  const payload = req.body.document || req.body;
  requireFields(payload, ['subject', 'senderName']);

  const now = new Date().toISOString();

  const rawScannedFiles = payload.scannedFiles || (req.body.attachment ? [{
    id: req.body.attachment.id,
    name: req.body.attachment.name || 'scanner-capture',
    type: req.body.attachment.type,
    size: req.body.attachment.size,
    dataUrl: req.body.attachment.dataUrl,
    uploadedAt: req.body.attachment.uploadedAt || now,
    uploadedBy: req.user.id,
    source: req.body.attachment.source || 'scanner',
  }] : []);
  const documentPayload = await normalizeDocumentPayload(req, {
    ...payload,
    scannedFiles: rawScannedFiles,
  }, { scanner: true });

  const officeId = documentPayload.currentOfficeId;

  const doc = new Document({
    ...documentPayload,
    status: documentPayload.status,
    currentOfficeId: officeId,
    timeline: [
      {
        id: generateId('TL'),
        action: 'scanner_intake',
        label: 'Scanned and registered',
        details: `External document captured and forwarded to Mayor's Office: ${payload.subject}`,
        officeId,
        userId: req.user.id,
        referenceId: documentPayload.id,
        timestamp: now,
      },
    ],
  });
  await doc.save();

  let deviceEvent = null;
  if (req.body.deviceId) {
    try {
      deviceEvent = new DeviceEvent({
        id: generateId('EVT'),
        deviceId: req.body.deviceId,
        eventType: 'scan_completed',
        documentId: doc.id,
        officeId,
        details: `Dashboard capture saved ${doc.trackingNumber}`,
        recordedBy: req.user.id,
        timestamp: now,
      });
      await deviceEvent.save();
    } catch (err) {
      console.error('Device event save failed (non-fatal):', err.message);
    }
  }

  await runPostSaveSideEffects('scanner_log', () =>
    createLogEntry(req, 'document_scanned', `Scanned document forwarded to Mayor: ${doc.subject}`, doc.id));
  await runPostSaveSideEffects('scanner_notify', () =>
    notifyApprovalUsers({
      title: 'External document registered',
      message: `${doc.trackingNumber} was registered by Reception and is ready at Mayor's Office (FIFO).`,
      type: 'info',
      referenceType: 'document',
      referenceId: doc.id,
      page: 'documents',
    }));
  await runPostSaveSideEffects('scanner_sender', () =>
    queueSenderNotifications(req, doc, 'document_scanned', {
      message: `Your document was scanned and registered with tracking number ${doc.trackingNumber}.`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications', 'device']);
  res.status(201).json({ document: doc, deviceEvent });
}));

// ================= DOCUMENTS =================
router.get('/', allRoles, asyncHandler(async (req, res) => {
  // FIFO: oldest registration first
  const docs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).sort({ createdAt: 1, dateReceived: 1, _id: 1 }).lean();
  res.json(docs);
}));

router.get('/:id', allRoles, asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ id: req.params.id, ...(await getScopedDocumentQueryWithTransmissions(req)) }).lean();
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  res.json(doc);
}));

router.post('/', documentCreateRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['subject', 'senderName']);
  const hasAttachment = Boolean(
    (Array.isArray(req.body.scannedFiles) && req.body.scannedFiles.length)
    || req.body.scannedImageUrl,
  );
  if (!hasAttachment) {
    return res.status(400).json({ message: 'A scanned file attachment is required' });
  }
  const documentPayload = await normalizeDocumentPayload(req, req.body);
  const doc = new Document({
    ...documentPayload,
    timeline: [
      ...(documentPayload.timeline || []),
      createTimelineEvent(
        req,
        documentPayload.scannedFiles?.length ? 'document_scanned' : 'document_received',
        documentPayload.scannedFiles?.length ? 'Scanned and registered' : 'Registered',
        req.user?.role === 'Receptionist'
          ? `External document registered and forwarded to Mayor's Office: ${documentPayload.subject}`
          : `Document registered: ${documentPayload.subject}`,
        documentPayload.currentOfficeId,
        documentPayload.id,
      ),
    ],
  });
  await doc.save();

  await runPostSaveSideEffects('create_log', () =>
    createLogEntry(req, 'document_received', `Registered document: ${doc.subject}`, doc.id));
  await runPostSaveSideEffects('create_notify', async () => {
    if (req.user?.role === 'Receptionist') {
      await notifyApprovalUsers({
        title: 'External document registered',
        message: `${doc.trackingNumber} is ready at Mayor's Office (FIFO).`,
        type: 'info',
        referenceType: 'document',
        referenceId: doc.id,
        page: 'documents',
      });
    } else {
      await createNotification({
        officeId: doc.currentOfficeId,
        title: 'Document registered',
        message: `${doc.trackingNumber} is ready for office workflow.`,
        type: 'info',
        referenceType: 'document',
        referenceId: doc.id,
        page: 'documents',
      });
    }
  });
  await runPostSaveSideEffects('create_sender', () =>
    queueSenderNotifications(req, doc, 'document_received', {
      message: `Your document was received and registered with tracking number ${doc.trackingNumber}.`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.status(201).json(doc);
}));

router.put('/:id', allRoles, asyncHandler(async (req, res) => {
  const existingDoc = await assertCanAccessDocument(req, req.params.id);
  const requestedUpdates = {
    ...req.body,
    ...(req.body.status ? { status: normalizeWorkflowStatus(req.body.status) } : {}),
  };
  assertValidDocumentUpdate(req, existingDoc, requestedUpdates);
  if (requestedUpdates.intakeStatus && !intakeStatuses.includes(requestedUpdates.intakeStatus)) {
    return res.status(400).json({ message: `Invalid intake status: ${requestedUpdates.intakeStatus}` });
  }

  const updates = { ...requestedUpdates };
  delete updates._id;
  delete updates.__v;
  delete updates.timeline;
  // Current office still moves via route/receive/RFID only.
  delete updates.currentOfficeId;
  // While still in intake, allow From/To from the scanner form so the destined
  // office is stored (destination) without moving the physical current office.
  const canSetIntakeOffices = (existingDoc.intakeStatus || 'Approved') === 'Pending Review';
  if (!canSetIntakeOffices) {
    delete updates.originOfficeId;
    delete updates.destinationOfficeId;
    delete updates.originOfficeOther;
    delete updates.destinationOfficeOther;
  }
  updates.updatedAt = new Date().toISOString();
  if (Array.isArray(updates.scannedFiles)) {
    if (updates.scannedFiles.length === 0) {
      return res.status(400).json({ message: 'A document must keep at least one scanned file attachment' });
    }
    const previousFiles = existingDoc.scannedFiles || [];
    updates.scannedFiles = await persistAttachments(req, updates.scannedFiles);
    // Always derive cover URL from the remaining files (supports removals).
    updates.scannedImageUrl = updates.scannedFiles[0]?.url
      || updates.scannedFiles[0]?.dataUrl
      || '';
    await removeOrphanedAttachments(previousFiles, updates.scannedFiles);
  }

  const timelineEvents = [];
  if (updates.status && updates.status !== existingDoc.status) {
    const labels = {
      Received: 'Marked as received',
      'For Signing': 'Marked for signing',
      'For Signature': 'Marked for signing',
      'For Filing': 'Marked for filing',
      Signed: 'Signed',
      Acknowledged: 'Acknowledged',
      Archived: 'Archived',
    };
    timelineEvents.push(createTimelineEvent(
      req,
      `document_${updates.status.toLowerCase().replace(/\s+/g, '_')}`,
      labels[updates.status] || `Marked as ${updates.status}`,
      `${existingDoc.subject} is now ${updates.status}`,
      updates.currentOfficeId || existingDoc.currentOfficeId,
      existingDoc.id,
    ));
  }
  if (Array.isArray(updates.scannedFiles)) {
    const previousCount = (existingDoc.scannedFiles || []).length;
    const nextCount = updates.scannedFiles.length;
    if (nextCount > previousCount) {
      timelineEvents.push(createTimelineEvent(
        req,
        'document_attachment_added',
        'Scanned file attached',
        `Added scanned file to ${existingDoc.subject}`,
        updates.currentOfficeId || existingDoc.currentOfficeId,
        existingDoc.id,
      ));
    } else if (nextCount < previousCount) {
      timelineEvents.push(createTimelineEvent(
        req,
        'document_attachment_removed',
        'Scanned file removed',
        `Removed scanned file from ${existingDoc.subject}`,
        updates.currentOfficeId || existingDoc.currentOfficeId,
        existingDoc.id,
      ));
    }
  }

  const updateCommand = {
    $set: updates,
    ...(timelineEvents.length ? { $push: { timeline: { $each: timelineEvents } } } : {}),
  };
  const doc = await Document.findOneAndUpdate({ id: req.params.id }, updateCommand, updateOptions);
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  await createLogEntry(req, 'document_updated', `Updated document: ${doc.subject}`, doc.id);
  const existingSenderOutboxCount = await SenderNotification.countDocuments({ documentId: doc.id });
  if (!existingSenderOutboxCount && doc.notifySender !== false && doc.senderNotificationConsent !== false && (doc.senderContact || doc.senderEmail)) {
    await queueSenderNotifications(req, doc, 'document_received', {
      message: `Your document was registered with tracking number ${doc.trackingNumber}.`,
      metadata: { queuedAfterSenderDetailsUpdate: true },
    });
  }
  if (updates.status && updates.status !== existingDoc.status) {
    await createNotification({
      officeId: doc.currentOfficeId,
      title: `Document ${doc.status.toLowerCase()}`,
      message: `${doc.trackingNumber} is now ${doc.status}.`,
      type: ['Signed', 'Acknowledged'].includes(doc.status) ? 'success' : 'info',
      referenceType: 'document',
      referenceId: doc.id,
      page: 'documents',
    });
    if (['Signed', 'Acknowledged'].includes(doc.status)) {
      await notifyApprovalUsers({
        title: 'Document finished',
        message: `${doc.trackingNumber} is ${doc.status.toLowerCase()} and can be returned or archived.`,
        type: 'success',
        referenceType: 'document',
        referenceId: doc.id,
        page: 'archives',
      });
    }
    await queueSenderNotifications(req, doc, `document_${doc.status.toLowerCase().replace(/\s+/g, '_')}`, {
      message: `${doc.subject} is now ${doc.status}.`,
    });
  }
  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(doc);
}));

router.post('/:id/verify', approvalRoles, asyncHandler(async (req, res) => {
  const { intakeStatus, rejectionReason } = req.body;
  if (!['Approved', 'Rejected'].includes(intakeStatus)) {
    return res.status(400).json({ message: 'intakeStatus must be Approved or Rejected' });
  }
  if (intakeStatus === 'Rejected' && !String(rejectionReason || '').trim()) {
    return res.status(400).json({ message: 'A rejection reason is required when rejecting a document' });
  }

  const doc = await assertCanAccessDocument(req, req.params.id);
  const currentStatus = normalizeWorkflowStatus(doc.status, doc.status);
  const canReviewPending = doc.intakeStatus === 'Pending Review';
  const canRejectApproved = intakeStatus === 'Rejected'
    && doc.intakeStatus === 'Approved'
    && registrationStatuses.includes(currentStatus)
    && !['Signed', 'Acknowledged', 'Archived'].includes(currentStatus);

  if (!canReviewPending && !canRejectApproved) {
    return res.status(400).json({
      message: `Document cannot be ${intakeStatus.toLowerCase()} in its current state (${doc.intakeStatus} / ${doc.status}).`,
    });
  }
  if (!registrationStatuses.includes(currentStatus) && currentStatus !== 'Returned to Sender') {
    return res.status(400).json({ message: `Only Received, For Signing, or For Filing documents can be reviewed. Current status: ${doc.status}` });
  }

  const now = new Date().toISOString();
  const receptionOfficeId = doc.originOfficeId || await findReceptionOfficeId(getUserOfficeId(req));
  const nextOfficeId = intakeStatus === 'Rejected' ? receptionOfficeId : doc.currentOfficeId;

  const event = createTimelineEvent(
    req,
    intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected',
    intakeStatus === 'Approved' ? 'Document approved' : 'Document rejected',
    intakeStatus === 'Approved'
      ? `${doc.subject} approved by Mayor`
      : `Rejected and returned to Reception: ${rejectionReason || doc.subject}`,
    nextOfficeId,
    doc.id,
  );

  const savedDoc = await appendDocumentTimeline(doc.id, event, {
    intakeStatus,
    verifiedBy: req.user.id,
    verifiedAt: now,
    rejectionReason: intakeStatus === 'Rejected' ? String(rejectionReason).trim() : '',
    ...(intakeStatus === 'Rejected' ? { currentOfficeId: nextOfficeId, destinationOfficeId: nextOfficeId } : {}),
  });

  await runPostSaveSideEffects('verify_log', () => createLogEntry(
    req,
    intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected',
    `${intakeStatus} document: ${doc.subject}`,
    doc.id,
  ));
  await runPostSaveSideEffects('verify_notify', () => createNotification({
    officeId: nextOfficeId,
    title: intakeStatus === 'Approved' ? 'Document approved' : 'Document rejected',
    message: intakeStatus === 'Approved'
      ? `${doc.trackingNumber} can continue Mayor document actions.`
      : `${doc.trackingNumber} was rejected and returned to Reception: ${String(rejectionReason).trim()}`,
    type: intakeStatus === 'Approved' ? 'success' : 'danger',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  }));
  await runPostSaveSideEffects('verify_sender', () =>
    queueSenderNotifications(req, savedDoc, intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected', {
      message: intakeStatus === 'Approved'
        ? `Your document ${doc.trackingNumber} was approved.`
        : `Your document ${doc.trackingNumber} was rejected. Reason: ${String(rejectionReason).trim()}`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(savedDoc);
}));

router.post('/:id/resubmit', documentCreateRoles, asyncHandler(async (req, res) => {
  const doc = await assertCanAccessDocument(req, req.params.id);
  if (doc.intakeStatus !== 'Rejected') {
    return res.status(400).json({ message: 'Only rejected documents can be resubmitted for review' });
  }
  const currentStatus = normalizeWorkflowStatus(doc.status, doc.status);
  if (!registrationStatuses.includes(currentStatus)) {
    return res.status(400).json({ message: `Only Received, For Signing, or For Filing documents can be resubmitted for review. Current status: ${doc.status}` });
  }
  if (!isApprovalRole(req) && doc.currentOfficeId !== getUserOfficeId(req)) {
    return res.status(403).json({ message: 'Only the current office can resubmit this document' });
  }

  const savedDoc = await appendDocumentTimeline(
    doc.id,
    createTimelineEvent(
      req,
      'document_resubmitted',
      'Resubmitted for review',
      `${doc.subject} was corrected and resubmitted for intake review`,
      doc.currentOfficeId,
      doc.id,
    ),
    {
      intakeStatus: 'Pending Review',
      verifiedBy: '',
      verifiedAt: '',
      rejectionReason: '',
    }
  );

  await createLogEntry(req, 'document_resubmitted', `Resubmitted document for review: ${doc.subject}`, doc.id);
  await notifyApprovalUsers({
    title: 'Document resubmitted',
    message: `${doc.trackingNumber} was corrected and needs review again.`,
    type: 'warning',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  });
  await queueSenderNotifications(req, savedDoc, 'document_resubmitted', {
    message: `Your corrected document ${doc.trackingNumber} was resubmitted for intake review.`,
  });
  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(savedDoc);
}));

router.post('/:id/process-note', approvalRoles, asyncHandler(async (req, res) => {
  const rawAction = normalizeText(req.body.action || 'action_note');
  const actionAliases = {
    processing_note: 'action_note',
    signed: 'sign_document',
    document_signed: 'sign_document',
    mark_signed: 'sign_document',
    acknowledged: 'acknowledge_document',
    acknowledge: 'acknowledge_document',
    document_acknowledged: 'acknowledge_document',
  };
  const action = actionAliases[rawAction] || rawAction;
  const note = normalizeText(req.body.note || '');
  const labels = {
    action_note: 'Action note',
    sign_document: 'Signed',
    acknowledge_document: 'Acknowledged',
  };

  if (!labels[action]) {
    return res.status(400).json({ message: 'Invalid document action' });
  }
  if (action === 'action_note' && !note) {
    return res.status(400).json({ message: 'A note is required for a document action note' });
  }

  const doc = await assertCanAccessDocument(req, req.params.id);
  const currentStatus = normalizeWorkflowStatus(doc.status, doc.status);
  if (currentStatus === 'Archived') {
    return res.status(400).json({ message: 'Archived documents can no longer be updated' });
  }
  if (currentStatus === 'In Transit') {
    return res.status(400).json({ message: 'Documents must be received by the destination office before actions can be recorded' });
  }
  if (doc.intakeStatus !== 'Approved') {
    return res.status(400).json({ message: 'Document must be approved before workflow actions can be applied' });
  }
  if (!['Received', 'For Signing', 'For Signature', 'For Filing', 'Signed', 'Acknowledged'].includes(currentStatus)) {
    return res.status(400).json({ message: `Only received, for-signing, for-filing, signed, or acknowledged documents can be updated. Current status: ${doc.status}` });
  }

  const updates = {};
  if (action === 'sign_document') {
    if (!['Received', 'For Signing', 'For Signature'].includes(currentStatus)) {
      return res.status(400).json({ message: 'Only Received or For Signing documents can be marked Signed' });
    }
    updates.status = 'Signed';
    updates.completedAt = new Date().toISOString();
  }
  if (action === 'acknowledge_document') {
    if (!['Received', 'For Filing', 'For Signing', 'Signed'].includes(currentStatus)) {
      return res.status(400).json({ message: 'Only Received, For Filing, For Signing, or Signed documents can be acknowledged' });
    }
    updates.status = 'Acknowledged';
    updates.completedAt = new Date().toISOString();
  }

  const savedDoc = await appendDocumentTimeline(
    doc.id,
    createTimelineEvent(
      req,
      action,
      labels[action],
      note || `${doc.subject} ${labels[action].toLowerCase()}`,
      doc.currentOfficeId,
      doc.id,
    ),
    updates,
  );

  await runPostSaveSideEffects('process_log', () => createLogEntry(req, action, `${labels[action]}: ${doc.subject}`, doc.id));
  await runPostSaveSideEffects('process_notify', () => notifyApprovalUsers({
    title: labels[action],
    message: `${doc.trackingNumber}: ${note || labels[action]}`,
    type: ['sign_document', 'acknowledge_document'].includes(action) ? 'success' : 'info',
    referenceType: 'document',
    referenceId: doc.id,
    page: ['sign_document', 'acknowledge_document'].includes(action) ? 'archives' : 'documents',
  }));

  if (['sign_document', 'acknowledge_document'].includes(action)) {
    await runPostSaveSideEffects('process_office_notify', () => createNotification({
      officeId: doc.currentOfficeId,
      title: 'Document finished',
      message: `${doc.trackingNumber} is ${updates.status.toLowerCase()} and ready to return or archive.`,
      type: 'success',
      referenceType: 'document',
      referenceId: doc.id,
      page: 'documents',
    }));
  }
  await runPostSaveSideEffects('process_sender', () =>
    queueSenderNotifications(req, savedDoc, updates.status ? `document_${updates.status.toLowerCase()}` : action, {
      message: `${labels[action]} for ${doc.trackingNumber}${note ? `: ${note}` : '.'}`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(savedDoc);
}));

// Office / Mayor send to one or many offices (chronological send history; custody to first).
router.post('/:id/send', sendRoles, asyncHandler(async (req, res) => {
  const doc = await assertCanAccessDocument(req, req.params.id);
  const toOfficeIds = [...new Set(
    (Array.isArray(req.body.toOfficeIds) ? req.body.toOfficeIds : [req.body.toOfficeId])
      .map((id) => normalizeText(id))
      .filter(Boolean),
  )];

  if (!toOfficeIds.length) {
    return res.status(400).json({ message: 'Select at least one destination office' });
  }
  if (doc.intakeStatus !== 'Approved') {
    return res.status(400).json({ message: 'Document must be approved before it can be sent' });
  }
  if (['Archived', 'Returned to Sender'].includes(doc.status) || doc.intakeStatus === 'Rejected') {
    return res.status(400).json({ message: 'This document can no longer be sent' });
  }
  if (!isApprovalRole(req) && doc.currentOfficeId !== getUserOfficeId(req)) {
    return res.status(403).json({ message: 'Only the current office can send this document' });
  }
  if (toOfficeIds.includes(doc.currentOfficeId)) {
    return res.status(400).json({ message: 'Cannot send a document to its current office' });
  }

  const offices = await Office.find({}).lean();
  const officeMap = new Map((offices || []).map((office) => [office.id, office.name]));
  const invalid = toOfficeIds.filter((id) => !officeMap.has(id));
  if (invalid.length) {
    return res.status(400).json({ message: `Unknown office id(s): ${invalid.join(', ')}` });
  }

  const now = new Date().toISOString();
  const fromOfficeId = doc.currentOfficeId;
  const [firstOfficeId, ...remaining] = toOfficeIds;
  const existingHistory = Array.isArray(doc.sendHistory) ? doc.sendHistory : [];
  const sendEvents = toOfficeIds.map((toOfficeId, index) => ({
    id: generateId('SND'),
    fromOfficeId,
    toOfficeId,
    sentBy: req.user.id,
    sentAt: new Date(new Date(now).getTime() + index).toISOString(),
    order: index + 1,
    active: index === 0,
  }));

  const timelineEvents = sendEvents.map((event) => {
    const label = toOfficeIds.length > 1
      ? `Sent to office (${event.order}/${toOfficeIds.length})`
      : 'Sent to office';
    const tl = createTimelineEvent(
      req,
      'document_sent',
      label,
      `Sent from ${officeMap.get(fromOfficeId) || fromOfficeId} to ${officeMap.get(event.toOfficeId) || event.toOfficeId}`,
      event.toOfficeId,
      doc.id,
    );
    tl.timestamp = event.sentAt;
    return tl;
  });

  const existingTimeline = Array.isArray(doc.timeline) ? doc.timeline : [];
  const savedDoc = await Document.findOneAndUpdate(
    { id: doc.id },
    {
      $set: {
        currentOfficeId: firstOfficeId,
        destinationOfficeId: firstOfficeId,
        lastRoutedAt: now,
        preTransitStatus: normalizeWorkflowStatus(doc.status, 'Received'),
        status: 'Received',
        sendHistory: [...existingHistory, ...sendEvents],
        sendQueue: remaining,
        timeline: [...existingTimeline, ...timelineEvents],
        updatedAt: now,
      },
    },
    updateOptions,
  );

  await runPostSaveSideEffects('send_log', () =>
    createLogEntry(req, 'document_sent', `Sent ${doc.subject} to ${toOfficeIds.map((id) => officeMap.get(id) || id).join(' → ')}`, doc.id));
  await runPostSaveSideEffects('send_notify', () => createNotification({
    officeId: firstOfficeId,
    title: 'Document received',
    message: `${doc.trackingNumber} was sent to your office.`,
    type: 'info',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  }));
  await runPostSaveSideEffects('send_sender', () =>
    queueSenderNotifications(req, savedDoc, 'document_routed', {
      message: `Your document ${doc.trackingNumber} was sent to ${officeMap.get(firstOfficeId) || firstOfficeId}.`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(savedDoc);
}));

// Receptionist returns a rejected external document to the citizen sender.
router.post('/:id/return-to-sender', allowRoles('Admin', 'Receptionist'), asyncHandler(async (req, res) => {
  const doc = await assertCanAccessDocument(req, req.params.id);
  if (doc.intakeStatus !== 'Rejected') {
    return res.status(400).json({ message: 'Only rejected documents can be returned to the sender' });
  }
  if (!isApprovalRole(req) && doc.currentOfficeId !== getUserOfficeId(req)) {
    return res.status(403).json({ message: 'Only Reception can return this document to the sender' });
  }

  const note = normalizeText(req.body.note) || 'Document returned to external sender';
  const savedDoc = await appendDocumentTimeline(
    doc.id,
    createTimelineEvent(
      req,
      'returned_to_sender',
      'Returned to sender',
      note,
      doc.currentOfficeId,
      doc.id,
    ),
    {
      intakeStatus: 'Returned to Sender',
      status: 'Returned to Sender',
      completedAt: new Date().toISOString(),
      destinationOfficeId: '',
      sendQueue: [],
    },
  );

  await runPostSaveSideEffects('return_log', () =>
    createLogEntry(req, 'returned_to_sender', `Returned to sender: ${doc.subject}`, doc.id));
  await runPostSaveSideEffects('return_sender', () =>
    queueSenderNotifications(req, savedDoc, 'document_rejected', {
      message: `Your document ${doc.trackingNumber} has been returned. ${note}`,
    }));

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(savedDoc);
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ id: req.params.id }).lean();
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  const [relatedTransmissions, relatedArchives, relatedEvents, relatedCommands] = await Promise.all([
    Transmission.find({ documentId: req.params.id }).select('id').lean(),
    Archive.find({ documentId: req.params.id }).select('id').lean(),
    DeviceEvent.find({ documentId: req.params.id }).select('id').lean(),
    Command.find({ resultDocumentId: req.params.id }).select('id').lean(),
  ]);
  const relatedReferenceIds = [
    req.params.id,
    ...relatedTransmissions.map((item) => item.id),
    ...relatedArchives.map((item) => item.id),
    ...relatedEvents.map((item) => item.id),
    ...relatedCommands.map((item) => item.id),
  ];

  await Document.findOneAndDelete({ id: req.params.id });
  await Promise.all([
    Transmission.deleteMany({ documentId: req.params.id }),
    Archive.deleteMany({ documentId: req.params.id }),
    DeviceEvent.deleteMany({ documentId: req.params.id }),
    Command.deleteMany({ resultDocumentId: req.params.id }),
    SenderNotification.deleteMany({ documentId: req.params.id }),
    Notification.deleteMany({ referenceId: { $in: relatedReferenceIds } }),
  ]);
  await createLogEntry(req, 'document_deleted', `Deleted document and related workflow records: ${doc.subject}`, req.params.id);
  broadcastDataInvalidate(['documents', 'transmissions', 'archives', 'logs', 'notifications', 'senderNotifications']);
  res.json({ success: true });
}));

module.exports = router;
