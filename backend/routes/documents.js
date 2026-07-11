const express = require('express');
const router = express.Router();
const { Document, Transmission, Archive, DeviceEvent, Command, SenderNotification, Notification } = require('../models');
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
  isGlobalRole,
} = require('../utils/helpers');
const { persistAttachments } = require('../utils/attachments');
const { normalizeSenderNotificationChannels, queueSenderNotifications } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');
const approvalRoles = allowRoles('Admin', 'Mayor');
const scannerRoles = allowRoles('Admin', 'Receptionist');
const documentCreateRoles = allowRoles('Admin', 'Receptionist');

const updateOptions = { new: true, runValidators: true };
const intakeStatuses = ['Pending Review', 'Approved', 'Rejected'];
const registrationStatuses = ['Received', 'For Signing', 'For Filing'];
const finalWorkflowStatuses = ['Signed', 'Acknowledged'];
const transmittableStatuses = ['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'];

const storedWorkflowStatuses = ['Received', 'In Transit', 'Processing', 'For Signature', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived'];

const getScopedDocumentQuery = (req) => {
  if (isGlobalRole(req)) return {};

  const officeId = getUserOfficeId(req);
  if (req.user?.role === 'Receptionist') {
    return {
      $or: [
        { 'timeline.userId': req.user.id },
        { verifiedBy: req.user.id },
      ],
    };
  }

  return {
    $or: [
      { originOfficeId: officeId },
      { currentOfficeId: officeId },
      { destinationOfficeId: officeId },
      { 'timeline.userId': req.user.id },
    ],
  };
};

const getScopedTransmissionQuery = (req) => {
  if (isGlobalRole(req)) return {};

  const officeId = getUserOfficeId(req);
  if (req.user?.role === 'Receptionist') {
    return {
      $or: [
        { toOfficeId: officeId, receivedBy: { $in: [null, ''] } },
        { sentBy: req.user.id },
        { receivedBy: req.user.id },
      ],
    };
  }

  return {
    $or: [
      { fromOfficeId: officeId },
      { toOfficeId: officeId },
      { sentBy: req.user.id },
      { receivedBy: req.user.id },
    ],
  };
};

const getScopedDocumentQueryWithTransmissions = async (req) => {
  const baseQuery = getScopedDocumentQuery(req);
  if (isGlobalRole(req)) return baseQuery;

  const transmissions = await Transmission.find(getScopedTransmissionQuery(req)).select('documentId').lean();
  const documentIds = transmissions.map((transmission) => transmission.documentId);

  return {
    $or: [
      ...(baseQuery.$or || []),
      { id: { $in: documentIds } },
    ],
  };
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

  const changedRoutingField = ['originOfficeId', 'currentOfficeId', 'destinationOfficeId'].some(field =>
    updates[field] !== undefined && comparable(updates[field]) !== comparable(existingDoc[field])
  );
  if (changedRoutingField) {
    const err = new Error('Document location can only change through routing, receiving, or RFID detection');
    err.status = 400;
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
  const documentDirection = !isApprovalRole(req)
    ? 'Incoming'
    : (body.documentDirection === 'Outgoing' ? 'Outgoing' : 'Incoming');
  const originOfficeId = isApprovalRole(req)
    ? (body.originOfficeId || body.currentOfficeId || userOfficeId)
    : userOfficeId;
  const currentOfficeId = isApprovalRole(req)
    ? (body.currentOfficeId || body.originOfficeId || userOfficeId)
    : userOfficeId;
  const now = new Date().toISOString();
  const scannedFiles = await persistAttachments(req, body.scannedFiles || []);
  const defaultIntakeStatus = (scanner || !isApprovalRole(req)) ? 'Pending Review' : 'Approved';
  const requestedIntakeStatus = isApprovalRole(req) && intakeStatuses.includes(body.intakeStatus)
    ? body.intakeStatus
    : defaultIntakeStatus;
  const requestedStatus = normalizeWorkflowStatus(body.status);
  const canSetInitialStatus = req.user?.role === 'Receptionist';
  const registrationStatus = canSetInitialStatus && registrationStatuses.includes(requestedStatus) ? requestedStatus : 'Received';

  return {
    ...body,
    id: body.id || generateId('DOC'),
    trackingNumber: body.trackingNumber || generateTrackingNumber(),
    documentDirection,
    status: registrationStatus,
    intakeStatus: requestedIntakeStatus,
    dateReceived: body.dateReceived || now.split('T')[0],
    createdAt: body.createdAt || now,
    updatedAt: now,
    documentTypeOther: normalizeText(body.documentTypeOther),
    originOfficeId,
    originOfficeOther: normalizeText(body.originOfficeOther),
    currentOfficeId,
    destinationOfficeOther: normalizeText(body.destinationOfficeOther),
    notifySender: body.notifySender !== undefined ? Boolean(body.notifySender) : true,
    senderNotificationConsent: body.senderNotificationConsent !== undefined ? Boolean(body.senderNotificationConsent) : true,
    senderNotificationChannels: normalizeSenderNotificationChannels(body.senderNotificationChannels, body),
    scannedFiles,
    scannedImageUrl: body.scannedImageUrl || scannedFiles[0]?.url || scannedFiles[0]?.dataUrl,
  };
};

router.use(protect);

// ================= SCANNER INTAKE =================
router.post('/scanner', scannerRoles, asyncHandler(async (req, res) => {
  const payload = req.body.document || req.body;
  requireFields(payload, ['subject']);

  const officeId = isApprovalRole(req)
    ? (payload.currentOfficeId || payload.originOfficeId || getUserOfficeId(req))
    : getUserOfficeId(req);
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

  const doc = new Document({
    ...documentPayload,
    status: documentPayload.status,
    currentOfficeId: officeId,
    timeline: [
      {
        id: generateId('TL'),
        action: 'scanner_intake',
        label: 'Scanner intake',
        details: `Document captured from scanner endpoint: ${payload.subject}`,
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
  }

  await createLogEntry(req, 'document_scanned', `Scanned document awaiting review: ${doc.subject}`, doc.id);
  await notifyApprovalUsers({
    title: 'Document pending review',
    message: `${doc.trackingNumber} needs intake approval before routing.`,
    type: 'warning',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  });
  await queueSenderNotifications(req, doc, 'document_scanned', {
    message: `Your document was scanned and registered with tracking number ${doc.trackingNumber}.`,
  });

  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications', 'device']);
  res.status(201).json({ document: doc, deviceEvent });
}));

// ================= DOCUMENTS =================
router.get('/', allRoles, asyncHandler(async (req, res) => {
  const docs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).sort({ createdAt: -1, dateReceived: -1, _id: -1 }).lean();
  res.json(docs);
}));

router.get('/:id', allRoles, asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ id: req.params.id, ...(await getScopedDocumentQueryWithTransmissions(req)) }).lean();
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  res.json(doc);
}));

router.post('/', documentCreateRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['subject']);
  const documentPayload = await normalizeDocumentPayload(req, req.body);
  const doc = new Document({
    ...documentPayload,
    timeline: [
      ...(documentPayload.timeline || []),
      createTimelineEvent(
        req,
        documentPayload.scannedFiles?.length ? 'document_scanned' : 'document_received',
        documentPayload.scannedFiles?.length ? 'Scanned and registered' : 'Registered',
        `Document registered: ${documentPayload.subject}`,
        documentPayload.currentOfficeId,
        documentPayload.id,
      ),
    ],
  });
  await doc.save();
  await createLogEntry(req, 'document_received', `Registered document: ${doc.subject}`, doc.id);
  if (doc.intakeStatus === 'Pending Review') {
    await notifyApprovalUsers({
      title: 'Document pending review',
      message: `${doc.trackingNumber} needs intake approval before routing.`,
      type: 'warning',
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
  await queueSenderNotifications(req, doc, 'document_received', {
    message: `Your document was received and registered with tracking number ${doc.trackingNumber}.`,
  });
  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(doc);
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
  updates.updatedAt = new Date().toISOString();
  if (Array.isArray(updates.scannedFiles)) {
    updates.scannedFiles = await persistAttachments(req, updates.scannedFiles);
    updates.scannedImageUrl = updates.scannedImageUrl || updates.scannedFiles[0]?.url || updates.scannedFiles[0]?.dataUrl;
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
  if ((updates.scannedFiles || []).length > (existingDoc.scannedFiles || []).length) {
    timelineEvents.push(createTimelineEvent(
      req,
      'document_attachment_added',
      'Scanned file attached',
      `Added scanned file to ${existingDoc.subject}`,
      updates.currentOfficeId || existingDoc.currentOfficeId,
      existingDoc.id,
    ));
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
  if (doc.intakeStatus !== 'Pending Review') {
    return res.status(400).json({ message: `Only documents pending review can be approved or rejected. Current review status: ${doc.intakeStatus}` });
  }
  const currentStatus = normalizeWorkflowStatus(doc.status, doc.status);
  if (!registrationStatuses.includes(currentStatus)) {
    return res.status(400).json({ message: `Only Received, For Signing, or For Filing documents can be reviewed for intake approval. Current status: ${doc.status}` });
  }

  const now = new Date().toISOString();
  const event = createTimelineEvent(
    req,
    intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected',
    intakeStatus === 'Approved' ? 'Document approved' : 'Document rejected',
    intakeStatus === 'Approved' ? `${doc.subject} passed intake review` : (rejectionReason || `${doc.subject} was rejected during intake review`),
    doc.currentOfficeId,
    doc.id,
  );

  const savedDoc = await appendDocumentTimeline(doc.id, event, {
    intakeStatus,
    verifiedBy: req.user.id,
    verifiedAt: now,
    rejectionReason: intakeStatus === 'Rejected' ? String(rejectionReason).trim() : '',
  });

  await createLogEntry(
    req,
    intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected',
    `${intakeStatus} document: ${doc.subject}`,
    doc.id,
  );
  await createNotification({
    officeId: doc.currentOfficeId,
    title: intakeStatus === 'Approved' ? 'Document approved' : 'Document rejected',
    message: intakeStatus === 'Approved'
      ? `${doc.trackingNumber} can now continue its ${currentStatus} workflow.`
      : `${doc.trackingNumber} was rejected: ${String(rejectionReason).trim()}`,
    type: intakeStatus === 'Approved' ? 'success' : 'danger',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  });
  await queueSenderNotifications(req, savedDoc, intakeStatus === 'Approved' ? 'document_approved' : 'document_rejected', {
    message: intakeStatus === 'Approved'
      ? `Your document ${doc.trackingNumber} passed intake review and can continue its ${currentStatus} workflow.`
      : `Your document ${doc.trackingNumber} was rejected during intake review. Reason: ${String(rejectionReason).trim()}`,
  });

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
    if (!['For Signing', 'For Signature'].includes(currentStatus)) {
      return res.status(400).json({ message: 'Only For Signing documents can be marked Signed' });
    }
    updates.status = 'Signed';
    updates.completedAt = new Date().toISOString();
  }
  if (action === 'acknowledge_document') {
    if (!['Received', 'For Filing'].includes(currentStatus)) {
      return res.status(400).json({ message: 'Only Received or For Filing documents can be acknowledged' });
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

  await createLogEntry(req, action, `${labels[action]}: ${doc.subject}`, doc.id);
  await notifyApprovalUsers({
    title: labels[action],
    message: `${doc.trackingNumber}: ${note || labels[action]}`,
    type: ['sign_document', 'acknowledge_document'].includes(action) ? 'success' : 'info',
    referenceType: 'document',
    referenceId: doc.id,
    page: ['sign_document', 'acknowledge_document'].includes(action) ? 'archives' : 'documents',
  });

  if (['sign_document', 'acknowledge_document'].includes(action)) {
    await createNotification({
      officeId: doc.currentOfficeId,
      title: 'Document finished',
      message: `${doc.trackingNumber} is ${updates.status.toLowerCase()} and ready to return or archive.`,
      type: 'success',
      referenceType: 'document',
      referenceId: doc.id,
      page: 'documents',
    });
  }
  await queueSenderNotifications(req, savedDoc, updates.status ? `document_${updates.status.toLowerCase()}` : action, {
    message: `${labels[action]} for ${doc.trackingNumber}${note ? `: ${note}` : '.'}`,
  });

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
