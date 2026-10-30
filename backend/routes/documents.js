const express = require('express');
const router = express.Router();
const { Document, Transmission, Archive, DeviceEvent, Command, Notification, Office, User, DocumentType } = require('../models');
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
const { broadcastDataInvalidate } = require('../utils/realtime');
const { getScopedDocumentQueryWithTransmissions } = require('../utils/documentScope');
const { persistAttachments } = require('../utils/attachments');
const { validateSmsPreferences } = require('../utils/sms');
const { parsePagination, contains, andFilters, documentSummaryAttributes } = require('../utils/listing');
const {
  buildInitialOfficeRoute,
  normalizePriorityLevel,
  canSendDocument,
  buildResubmissionUpdates,
} = require('../utils/documentRouting');
const { sendHandoffs } = require('../utils/documentHandoffs');
const { withModelTransaction } = require('../utils/transactionContext');
const { snapshotGuard, assertCurrentCustody } = require('../utils/workflowGuard');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const approvalRoles = allowRoles('Admin', 'Mayor');
const scannerRoles = allowRoles('Admin', 'Receptionist');
const documentCreateRoles = allowRoles('Admin', 'Receptionist', 'Office');
const sendRoles = allowRoles('Admin', 'Mayor', 'Office');

const updateOptions = { new: true, runValidators: true };
const intakeStatuses = ['Pending Review', 'Approved', 'Rejected', 'Returned to Sender'];
const registrationStatuses = ['Received', 'For Signing', 'For Filing'];
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

const getOfficeLabel = async (officeId) => {
  const office = await Office.findOne({ id: officeId }).lean();
  return office?.name || officeId || 'Unknown office';
};

const requiresMayorApprovalFor = async (doc) => {
  if (!doc.documentTypeId) return false;
  const docType = await DocumentType.findOne({ id: doc.documentTypeId }).lean();
  return Boolean(docType?.requiresMayorApproval);
};

const staysAtMayorForApproval = async (doc) => (
  await requiresMayorApprovalFor(doc)
  && doc.currentOfficeId === await findMayorsOfficeId()
  && !doc.mayorApprovalCleared
);

const startDocumentHandoff = async (req, doc, toOfficeIds, transmissionType = 'Internal', deferredEffects = null) => {
  const offices = await Office.find({}).lean();
  const knownOfficeIds = new Set((offices || []).map((office) => office.id));
  const invalidOfficeIds = toOfficeIds.filter((id) => !knownOfficeIds.has(id));
  if (invalidOfficeIds.length) {
    const err = new Error(`Unknown office id(s): ${invalidOfficeIds.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const requiresMayorApproval = await requiresMayorApprovalFor(doc);
  const mayorsOfficeId = requiresMayorApproval ? await findMayorsOfficeId() : '';
  const isMayorApprovalHandoff = requiresMayorApproval
    && !doc.mayorApprovalCleared
    && doc.currentOfficeId !== mayorsOfficeId
    && toOfficeIds.length === 1
    && toOfficeIds[0] === mayorsOfficeId;
  if (!canSendDocument({ requiresMayorApproval, mayorApprovalCleared: doc.mayorApprovalCleared }) && !isMayorApprovalHandoff) {
    const err = new Error('Mayor approval must be recorded before routing this document onward');
    err.status = 400;
    throw err;
  }
  const sentAt = new Date().toISOString();
  const fromOffice = await getOfficeLabel(doc.currentOfficeId || doc.originOfficeId);
  const officeLabels = new Map(offices.map((office) => [office.id, office.name]));
  const result = await sendHandoffs({
    documentId: doc.id,
    fromOfficeId: doc.currentOfficeId,
    toOfficeIds,
    sentBy: req.user.id,
    sentAt,
    transmissionType,
    requiresMayorApproval,
    mayorsOfficeId,
    eventFor: (transmission) => createTimelineEvent(req, 'document_routed', 'Sent to office',
      `Sent from ${fromOffice} to ${officeLabels.get(transmission.toOfficeId) || transmission.toOfficeId}`,
      transmission.fromOfficeId, transmission.id),
  });
  const effects = async () => {
    for (const transmission of result.transmissions) {
      const toOffice = officeLabels.get(transmission.toOfficeId) || transmission.toOfficeId;
      await runPostSaveSideEffects('transmission_log', () =>
        createLogEntry(req, 'transmission_created', `Routed "${doc.subject}" from ${fromOffice} to ${toOffice}`, transmission.id));
      await runPostSaveSideEffects('transmission_notify', () => createNotification({
        officeId: transmission.toOfficeId,
        title: 'Incoming document route',
        message: `${doc.trackingNumber} was routed from ${fromOffice}.`,
        type: doc.priorityLevel === 'urgent' ? 'danger' : 'warning',
        referenceType: 'transmission',
        referenceId: transmission.id,
        page: 'transmissions',
      }));
    }
    broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications']);
  };
  if (deferredEffects) deferredEffects.push(effects); else await effects();
  return result;
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
    // Allow correcting date while the hardware scan is still being registered.
    if ((existingDoc.intakeStatus || 'Approved') !== 'Pending Review') {
      const err = new Error('Date received is locked after registration');
      err.status = 400;
      throw err;
    }
  }

  if (!isApprovalRole(req) && existingDoc.currentOfficeId !== getUserOfficeId(req)) {
    const err = new Error('Only the current office or an approval user can edit this document');
    err.status = 403;
    throw err;
  }

  // Hardware scans start as Pending Review. Confirm & Register (Receptionist/Admin)
  // finalizes metadata and may set Approved — same outcome as creating a manual receive.
  // Mayor/Admin reject/approve of already-registered docs still must use /verify.
  if (updates.intakeStatus && updates.intakeStatus !== existingDoc.intakeStatus) {
    const role = req.user?.role || '';
    const nextStatus = updates.status || existingDoc.status;
    const completingScannerRegistration =
      existingDoc.intakeStatus === 'Pending Review'
      && updates.intakeStatus === 'Approved'
      && ['Receptionist', 'Admin'].includes(role)
      && registrationStatuses.includes(normalizeWorkflowStatus(nextStatus, nextStatus));

    if (!completingScannerRegistration) {
      const err = new Error('Use the approval/rejection action to change intake review status');
      err.status = isApprovalRole(req) ? 400 : 403;
      throw err;
    }
  }

  const changedVerificationField = ['verifiedBy', 'verifiedAt', 'rejectionReason'].some(field =>
    updates[field] !== undefined && comparable(updates[field]) !== comparable(existingDoc[field])
  );
  if (changedVerificationField) {
    const err = new Error('Use the approval/rejection action to change document verification details');
    err.status = isApprovalRole(req) ? 400 : 403;
    throw err;
  }

  if (
    updates.mayorApprovalCleared !== undefined
    && Boolean(updates.mayorApprovalCleared) !== Boolean(existingDoc.mayorApprovalCleared)
  ) {
    const err = new Error('Use the authorized Mayor signing action to update the Mayor approval gate');
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
    assertCurrentCustody(req, existingDoc);
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
  validateSmsPreferences(body);
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
    // External documents are first recorded at reception; the selected office is the requested destination.
    originOfficeId = userOfficeId;
    currentOfficeId = userOfficeId;
    destinationOfficeId = body.destinationOfficeId || '';
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
  const sourceFiles = body.scannedFiles?.length ? body.scannedFiles : body.scannedImageUrl ? [{ name: 'scan', dataUrl: body.scannedImageUrl }] : [];
  const scannedFiles = await persistAttachments(req, sourceFiles);
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
  const requiresMayorReception = docType?.requiresMayorReception || false;

  let finalStatus = registrationStatus;
  let initialRoute = null;

  const startsAtOrigin = isOfficeUser || isReceptionist || scanner;
  if (startsAtOrigin) {
    initialRoute = buildInitialOfficeRoute({
      originOfficeId,
      destinationOfficeId,
      mayorsOfficeId,
      requiresMayorReception,
      requiresMayorApproval,
      sentBy: req.user?.id,
      sentAt: now,
    });
    currentOfficeId = originOfficeId;
    destinationOfficeId = initialRoute.firstDestinationOfficeId || destinationOfficeId;
    finalStatus = initialRoute.status;
  } else if (requiresMayorApproval) {
    initialRoute = buildInitialOfficeRoute({
      originOfficeId,
      destinationOfficeId,
      mayorsOfficeId,
      requiresMayorReception: false,
      requiresMayorApproval: true,
      sentBy: req.user?.id,
      sentAt: now,
    });
    finalStatus = 'For Signing';
  } else {
    initialRoute = buildInitialOfficeRoute({
      originOfficeId,
      destinationOfficeId,
      mayorsOfficeId,
      requiresMayorReception: false,
      requiresMayorApproval: false,
      sentBy: req.user?.id,
      sentAt: now,
    });
    currentOfficeId = initialRoute.currentOfficeId;
    finalStatus = initialRoute.status;
  }

  return {
    ...body,
    id: generateId('DOC'),
    trackingNumber: body.trackingNumber || generateTrackingNumber(),
    documentDirection,
    status: finalStatus,
    intakeStatus: requestedIntakeStatus,
    priorityLevel: normalizePriorityLevel(body.priorityLevel),
    dateReceived: body.dateReceived || now.split('T')[0],
    createdAt: now,
    updatedAt: now,
    documentTypeId,
    documentTypeOther: normalizeText(body.documentTypeOther),
    originOfficeId,
    intakeOfficeId: documentDirection === 'Incoming' ? (initialRoute?.intakeOfficeId || originOfficeId) : '',
    originOfficeOther: normalizeText(body.originOfficeOther),
    currentOfficeId,
    destinationOfficeId,
    destinationOfficeOther: normalizeText(body.destinationOfficeOther),
    rfidTag: '',
    lastDetectedOfficeId: '',
    lastDetectedAt: '',
    senderEmail: '',
    // Passive preferences retained for the frontend; no sender delivery backend.
    senderNotificationChannels: Array.isArray(body.senderNotificationChannels) ? body.senderNotificationChannels : [],
    notifySender: body.notifySender !== undefined ? Boolean(body.notifySender) : true,
    senderNotificationConsent: body.senderNotificationConsent !== undefined ? Boolean(body.senderNotificationConsent) : true,
    scannedFiles,
    scannedImageUrl: scannedFiles[0]?.url || scannedFiles[0]?.dataUrl || '',
    sendHistory: startsAtOrigin ? initialRoute.sendHistory : (Array.isArray(body.sendHistory) ? body.sendHistory : []),
    sendQueue: startsAtOrigin ? initialRoute.sendQueue : (Array.isArray(body.sendQueue) ? body.sendQueue : []),
    routePlan: startsAtOrigin ? initialRoute.routePlan : (Array.isArray(body.routePlan) ? body.routePlan : []),
    routeStep: startsAtOrigin ? initialRoute.routeStep : (Number(body.routeStep) || 0),
    // Never trust client-provided approval state during registration.
    mayorApprovalCleared: false,
    verifiedBy: '', verifiedAt: '', rejectionReason: '', completedAt: '', archivedAt: '', timeline: [],
  };
};

router.use(protect);

// ================= SCANNER INTAKE =================
router.post('/scanner', scannerRoles, asyncHandler(async (req, res) => {
  const payload = req.body.document || req.body;
  requireFields(payload, ['subject', 'senderName']);
  if (req.user?.role === 'Receptionist' && !normalizeText(payload.destinationOfficeId)) {
    return res.status(400).json({ message: 'Select a destination office before registering the scanned document' });
  }

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
        details: `External document captured and registered at Reception: ${payload.subject}`,
        officeId,
        userId: req.user.id,
        referenceId: documentPayload.id,
        timestamp: now,
      },
    ],
  });
  const initialDestinations = (documentPayload.routePlan || []).slice(1);
  let savedDoc = doc;
  let transmission = null;
  const deferred = [];
  await withModelTransaction(Document._Model, async () => {
    await doc.save();
    if (initialDestinations.length && !(await staysAtMayorForApproval(doc))) {
      const handoff = await startDocumentHandoff(req, doc, initialDestinations, 'External', deferred);
      savedDoc = handoff.document;
      transmission = handoff.transmission;
    }
  });
  for (const effect of deferred) await effect();

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
    createLogEntry(req, 'document_scanned', `Scanned and registered at Reception: ${doc.subject}`, doc.id));
  broadcastDataInvalidate(['documents', 'logs', 'notifications', 'device']);
  res.status(201).json({ document: savedDoc, transmission, deviceEvent });
}));

// ================= DOCUMENTS =================
router.get('/', allRoles, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const filters = {};
  for (const field of ['status', 'documentDirection', 'priorityLevel', 'documentTypeId', 'dateReceived']) {
    if (req.query[field] && req.query[field] !== 'All') filters[field] = String(req.query[field]);
  }
  if (req.query.search) filters.$or = ['subject', 'trackingNumber', 'senderName', 'originOfficeOther', 'destinationOfficeOther'].map((field) => ({ [field]: contains(req.query.search) }));
  const query = andFilters(await getScopedDocumentQueryWithTransmissions(req), filters);
  const [items, total] = await Promise.all([
    Document.find(query).withAttributes(documentSummaryAttributes).sort({ createdAt: 1, dateReceived: 1, id: 1 }).skip(offset).limit(limit).lean(),
    Document.countDocuments(query),
  ]);
  res.json({ items: items.map((doc) => ({ ...doc, _summary: true })), total, page, limit });
}));

router.get('/:id', allRoles, asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ id: req.params.id, ...(await getScopedDocumentQueryWithTransmissions(req)) }).lean();
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  res.json(doc);
}));

router.post('/', documentCreateRoles, asyncHandler(async (req, res) => {
  if (req.user?.role === 'Office') {
    const requestedDestination = normalizeText(req.body.destinationOfficeId);
    if (!requestedDestination) {
      return res.status(400).json({ message: 'Select a destination office before submitting the document' });
    }
    if (requestedDestination === getUserOfficeId(req)) {
      return res.status(400).json({ message: 'Choose a different office than your own' });
    }
    const destination = await Office.findOne({ id: requestedDestination }).lean();
    if (!destination) {
      return res.status(400).json({ message: 'Select a valid destination office' });
    }
  }
  requireFields(req.body, ['subject', 'senderName']);
  const hasAttachment = Boolean(
    (Array.isArray(req.body.scannedFiles) && req.body.scannedFiles.length)
    || req.body.scannedImageUrl,
  );
  if (!hasAttachment) {
    return res.status(400).json({ message: 'A scanned file attachment is required' });
  }
  const documentPayload = await normalizeDocumentPayload(req, req.body);
  const initialRouteTimeline = req.user?.role === 'Office'
    ? documentPayload.sendHistory.map((event) => {
      const destination = event.toOfficeId === documentPayload.destinationOfficeId
        ? documentPayload.destinationOfficeId
        : event.toOfficeId;
      const tl = createTimelineEvent(
        req,
        'document_sent',
        'Sent to office',
        `Sent from ${event.fromOfficeId} to ${destination}`,
        event.toOfficeId,
        documentPayload.id,
      );
      tl.timestamp = event.sentAt;
      return tl;
    })
    : [];
  const doc = new Document({
    ...documentPayload,
    timeline: [
      ...(documentPayload.timeline || []),
      createTimelineEvent(
        req,
        documentPayload.scannedFiles?.length ? 'document_scanned' : 'document_received',
        documentPayload.scannedFiles?.length ? 'Scanned and registered' : 'Registered',
        req.user?.role === 'Receptionist'
          ? `External document registered at Reception: ${documentPayload.subject}`
          : `Document registered: ${documentPayload.subject}`,
        req.user?.role === 'Office' ? documentPayload.originOfficeId : documentPayload.currentOfficeId,
        documentPayload.id,
      ),
      ...initialRouteTimeline,
    ],
  });
  let savedDoc = doc;
  let createdTransmission = null;
  const deferred = [];
  await withModelTransaction(Document._Model, async () => {
    await doc.save();
    if (['Office', 'Receptionist'].includes(req.user?.role)) {
      const initialDestinations = (documentPayload.routePlan || []).slice(1);
      if (initialDestinations.length && !(await staysAtMayorForApproval(doc))) {
        const handoff = await startDocumentHandoff(req, doc, initialDestinations, 'Internal', deferred);
        savedDoc = handoff.document;
        createdTransmission = handoff.transmission;
      }
    }
  });
  for (const effect of deferred) await effect();

  await runPostSaveSideEffects('create_log', () =>
    createLogEntry(req, 'document_received', `Registered document: ${doc.subject}`, doc.id));
  await runPostSaveSideEffects('create_notify', async () => {
    if (req.user?.role === 'Receptionist' && !createdTransmission) {
      await createNotification({
        officeId: doc.currentOfficeId,
        title: 'Document registered',
        message: `${doc.trackingNumber} was registered at Reception and is awaiting routing.`,
        type: 'info',
        referenceType: 'document',
        referenceId: doc.id,
        page: 'documents',
      });
    } else if (!['Office', 'Receptionist'].includes(req.user?.role)) {
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
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
  res.status(201).json(savedDoc);
}));

router.put('/:id', allRoles, asyncHandler(async (req, res) => {
  const existingDoc = await assertCanAccessDocument(req, req.params.id);
  validateSmsPreferences({ ...existingDoc.toJSON(), ...req.body });
  if (
    req.body.documentTypeId !== undefined
    && req.body.documentTypeId !== existingDoc.documentTypeId
    && !isApprovalRole(req)
  ) {
    const [currentType, nextType] = await Promise.all([
      existingDoc.documentTypeId
        ? DocumentType.findOne({ id: existingDoc.documentTypeId }).lean()
        : null,
      req.body.documentTypeId
        ? DocumentType.findOne({ id: req.body.documentTypeId }).lean()
        : null,
    ]);
    if (currentType?.requiresMayorApproval || nextType?.requiresMayorApproval) {
      return res.status(403).json({ message: 'Only an approval user can change a document type that affects Mayor approval' });
    }
  }
  const requestedUpdates = {
    ...req.body,
    ...(req.body.status ? { status: normalizeWorkflowStatus(req.body.status) } : {}),
  };
  assertValidDocumentUpdate(req, existingDoc, requestedUpdates);
  if (requestedUpdates.intakeStatus && !intakeStatuses.includes(requestedUpdates.intakeStatus)) {
    return res.status(400).json({ message: `Invalid intake status: ${requestedUpdates.intakeStatus}` });
  }

  const updates = { ...requestedUpdates };
  if (updates.id !== undefined && updates.id !== existingDoc.id) return res.status(400).json({ message: 'Document identity is immutable.' });
  if (updates.trackingNumber !== undefined && updates.trackingNumber !== existingDoc.trackingNumber) return res.status(400).json({ message: 'Tracking number is immutable.' });
  for (const field of ['id', 'trackingNumber', 'intakeOfficeId', 'createdAt', 'lastDetectedOfficeId', 'lastDetectedAt', 'rfidTag', 'scannedImageUrl', 'completedAt', 'archivedAt']) delete updates[field];
  delete updates._id;
  delete updates.__v;
  delete updates.timeline;
  for (const field of ['sendHistory', 'sendQueue', 'routePlan', 'routeStep', 'preTransitStatus', 'lastRoutedAt']) delete updates[field];
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
    updates.scannedFiles = await persistAttachments(req, updates.scannedFiles, { existingFiles: existingDoc.scannedFiles || [] });
    // Always derive cover URL from the remaining files (supports removals).
    updates.scannedImageUrl = updates.scannedFiles[0]?.url
      || updates.scannedFiles[0]?.dataUrl
      || '';
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
  if (
    updates.intakeStatus === 'Approved'
    && existingDoc.intakeStatus === 'Pending Review'
  ) {
    const now = new Date().toISOString();
    updates.verifiedBy = req.user?.id || updates.verifiedBy;
    updates.verifiedAt = now;
    timelineEvents.push(createTimelineEvent(
      req,
      'document_approved',
      'Document registered',
      `${existingDoc.subject || updates.subject || 'Document'} confirmed and registered`,
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
  // Recheck the state and permission under the same lock used by routing/receipt/archive.
  const doc = await Document.findOneAndUpdate({ id: req.params.id }, updateCommand, {
    ...updateOptions, validate: current => { snapshotGuard(req, existingDoc)(current); assertValidDocumentUpdate(req, current, requestedUpdates); },
  });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  await createLogEntry(req, 'document_updated', `Updated document: ${doc.subject}`, doc.id);
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
  }
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
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
  assertCurrentCustody(req, doc);
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
    ...(intakeStatus === 'Rejected' ? { mayorApprovalCleared: false } : {}),
    ...(intakeStatus === 'Rejected' ? { currentOfficeId: nextOfficeId, destinationOfficeId: nextOfficeId } : {}),
  }, { validate: snapshotGuard(req, doc, { custody: true }) });

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
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
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
      ...buildResubmissionUpdates(),
    },
    { validate: snapshotGuard(req, doc, { custody: !isApprovalRole(req) }) }
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
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
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
  assertCurrentCustody(req, doc);
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
    const docType = doc.documentTypeId
      ? await DocumentType.findOne({ id: doc.documentTypeId }).lean()
      : null;
    if (docType?.requiresMayorApproval) {
      const mayorsOfficeId = await findMayorsOfficeId();
      if (doc.currentOfficeId === mayorsOfficeId) updates.mayorApprovalCleared = true;
    }
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
    { validate: snapshotGuard(req, doc, { custody: true }) },
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
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
  res.json(savedDoc);
}));

// Deliver to every selected office; first destination retains primary custody.
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
  const docType = doc.documentTypeId
    ? await DocumentType.findOne({ id: doc.documentTypeId }).lean()
    : null;
  const requiresMayorApproval = Boolean(docType?.requiresMayorApproval);
  const mayorsOfficeId = requiresMayorApproval ? await findMayorsOfficeId() : '';
  const isMayorApprovalHandoff = requiresMayorApproval
    && !doc.mayorApprovalCleared
    && doc.currentOfficeId !== mayorsOfficeId
    && toOfficeIds.length === 1
    && toOfficeIds[0] === mayorsOfficeId;
  if (!canSendDocument({ requiresMayorApproval, mayorApprovalCleared: doc.mayorApprovalCleared }) && !isMayorApprovalHandoff) {
    return res.status(400).json({ message: 'Mayor approval must be recorded before routing this document onward' });
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

  const { document: savedDoc } = await startDocumentHandoff(req, doc, toOfficeIds);
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
    { validate: snapshotGuard(req, doc, { custody: !isApprovalRole(req) }) },
  );

  await runPostSaveSideEffects('return_log', () =>
    createLogEntry(req, 'returned_to_sender', `Returned to sender: ${doc.subject}`, doc.id));
  broadcastDataInvalidate(['documents', 'logs', 'notifications']);
  res.json(savedDoc);
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  let doc;
  await withModelTransaction(Document._Model, async () => {
    doc = await Document.findOne({ id: req.params.id }).forUpdate();
    if (!doc) { const error = new Error('Document not found'); error.status = 404; throw error; }
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
      Notification.deleteMany({ referenceId: { $in: relatedReferenceIds } }),
    ]);
  });
  await runPostSaveSideEffects('delete_log', () => createLogEntry(req, 'document_deleted', `Deleted document and related workflow records: ${doc.subject}`, req.params.id));
  broadcastDataInvalidate(['documents', 'transmissions', 'archives', 'logs', 'notifications']);
  res.json({ success: true });
}));

module.exports = router;
