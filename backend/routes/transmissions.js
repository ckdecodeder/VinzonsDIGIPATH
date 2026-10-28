const express = require('express');
const router = express.Router();
const { Transmission, Document, DocumentType, Office, Notification } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  createNotification,
  notifyApprovalUsers,
  createTimelineEvent,
  getUserOfficeId,
  isApprovalRole,
} = require('../utils/helpers');
const { canSendDocument } = require('../utils/documentRouting');
const { sendHandoffs, receiveHandoff, cancelHandoff } = require('../utils/documentHandoffs');
const { queueSenderNotifications } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');
const {
  getScopedDocumentQueryWithTransmissions,
  getScopedTransmissionQuery,
} = require('../utils/documentScope');

const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const approvalRoles = allowRoles('Admin', 'Mayor');
const updateOptions = { new: true, runValidators: true };
const runSideEffect = async (work) => {
  try { await work(); }
  catch (err) { console.error('Post-save transmission side effect failed:', err.message); }
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

const getOfficeLabel = async (officeId) => {
  const { Office } = require('../models');
  const office = await Office.findOne({ id: officeId }).lean();
  return office?.name || officeId || 'Unknown office';
};

const findMayorsOfficeId = async () => {
  const offices = await Office.find({}).lean();
  const mayorOffice = (offices || []).find((office) => /mayor/i.test(office.name || ''));
  return mayorOffice?.id || 'OFF-001';
};

const transmittableStatuses = ['Received', 'For Signing', 'For Filing', 'Signed', 'Acknowledged'];
const finalWorkflowStatuses = ['Signed', 'Acknowledged'];

const storedWorkflowStatuses = ['Received', 'In Transit', 'Processing', 'For Signature', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived'];
const normalizeWorkflowStatus = (value, fallback = 'Received') => {
  const { normalizeText } = require('../utils/helpers');
  const status = normalizeText(value);
  if (!status) return fallback;
  if (status === 'For Signature') return 'For Signing';
  if (status === 'Acknoweledged') return 'Acknowledged';
  return storedWorkflowStatuses.includes(status) ? status : fallback;
};
const normalizeWorkflowStatusValue = (status, fallback = 'Received') => {
  return normalizeWorkflowStatus(status, fallback);
};

router.use(protect);

router.get('/', allRoles, asyncHandler(async (req, res) => {
  const trans = await Transmission.find(getScopedTransmissionQuery(req)).sort({ createdAt: -1, transmissionDate: -1, _id: -1 }).lean();
  res.json(trans);
}));

router.post('/', allRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['documentId', 'fromOfficeId']);
  const toOfficeIds = [...new Set(
    (Array.isArray(req.body.toOfficeIds) ? req.body.toOfficeIds : [req.body.toOfficeId])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )];
  if (!toOfficeIds.length) {
    return res.status(400).json({ message: 'Select at least one destination office' });
  }
  if (toOfficeIds.includes(req.body.fromOfficeId)) {
    return res.status(400).json({ message: 'A document cannot be routed to the same office' });
  }

  const doc = await assertCanAccessDocument(req, req.body.documentId);
  const docType = doc.documentTypeId
    ? await DocumentType.findOne({ id: doc.documentTypeId }).lean()
    : null;
  const requiresMayorApproval = Boolean(docType?.requiresMayorApproval);
  const mayorsOfficeId = requiresMayorApproval ? await findMayorsOfficeId() : '';
  const isMayorApprovalHandoff = requiresMayorApproval
    && !doc.mayorApprovalCleared
    && req.body.fromOfficeId !== mayorsOfficeId
    && toOfficeIds.length === 1
    && toOfficeIds[0] === mayorsOfficeId;
  if (!canSendDocument({ requiresMayorApproval, mayorApprovalCleared: doc.mayorApprovalCleared }) && !isMayorApprovalHandoff) {
    return res.status(400).json({ message: 'Mayor approval must be recorded before routing this document onward' });
  }
  const currentStatus = normalizeWorkflowStatusValue(doc.status, doc.status);
  if (!transmittableStatuses.includes(currentStatus)) {
    return res.status(400).json({ message: `Only approved Received, For Signing, For Filing, Signed, or Acknowledged documents can be transmitted. Current status: ${doc.status}` });
  }
  if (doc.intakeStatus === 'Pending Review') {
    return res.status(400).json({ message: 'Document must be approved before routing' });
  }
  if (doc.intakeStatus === 'Rejected') {
    return res.status(400).json({ message: 'Rejected documents cannot be routed' });
  }
  if (req.body.fromOfficeId !== doc.currentOfficeId) {
    return res.status(400).json({ message: 'Route source must match the document current office' });
  }
  const pendingTransmission = await Transmission.findOne({ documentId: doc.id, receivedBy: null }).lean();
  if (pendingTransmission) {
    return res.status(409).json({ message: 'This document already has a pending transmission that must be received first' });
  }
  if (!isApprovalRole(req)) {
    if (finalWorkflowStatuses.includes(currentStatus)) {
      return res.status(403).json({ message: 'Only Admin or Mayor users can route Signed or Acknowledged documents' });
    }
    const userOfficeId = getUserOfficeId(req);
    if (req.body.fromOfficeId !== userOfficeId || doc.currentOfficeId !== userOfficeId) {
      return res.status(403).json({ message: 'You can only route approved documents from your assigned office' });
    }
  }

  const offices = await Office.find({}).lean();
  const knownOfficeIds = new Set((offices || []).map((office) => office.id));
  const invalidOfficeIds = toOfficeIds.filter((id) => !knownOfficeIds.has(id));
  if (invalidOfficeIds.length) {
    return res.status(400).json({ message: `Unknown office id(s): ${invalidOfficeIds.join(', ')}` });
  }

  const fromOffice = await getOfficeLabel(doc.currentOfficeId);
  const officeLabels = new Map(offices.map((office) => [office.id, office.name]));
  const result = await sendHandoffs({
    documentId: doc.id,
    fromOfficeId: req.body.fromOfficeId,
    toOfficeIds,
    sentBy: req.user.id,
    sentAt: new Date().toISOString(),
    transmissionType: req.body.transmissionType || 'Internal',
    transmissionDate: req.body.transmissionDate,
    acknowledgementRemarks: req.body.acknowledgementRemarks || '',
    requiresMayorApproval,
    mayorsOfficeId,
    eventFor: (trans) => createTimelineEvent(req, 'document_routed', 'Sent to office',
      `Sent from ${fromOffice} to ${officeLabels.get(trans.toOfficeId) || trans.toOfficeId}`, trans.fromOfficeId, trans.id),
  });
  for (const trans of result.transmissions) {
    const toOffice = officeLabels.get(trans.toOfficeId) || trans.toOfficeId;
    await runSideEffect(() => createLogEntry(req, 'transmission_created', `Routed "${doc.subject}" from ${fromOffice} to ${toOffice}`, trans.id));
    await runSideEffect(() => createNotification({
      officeId: trans.toOfficeId,
      title: 'Incoming document route',
      message: `${doc.trackingNumber} was routed from ${fromOffice}.`,
      type: doc.priorityLevel === 'urgent' ? 'danger' : 'warning',
      referenceType: 'transmission',
      referenceId: trans.id,
      page: 'transmissions',
    }));
    await runSideEffect(() => queueSenderNotifications(req, result.document, 'document_routed', {
      message: `Your document ${doc.trackingNumber} was routed from ${fromOffice} to ${toOffice}.`,
      metadata: { transmissionId: trans.id },
    }));
  }
  broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications', 'senderNotifications']);
  // Preserve the single-transmission response contract for existing callers.
  res.json(result.transmission);
}));

router.put('/:id', allRoles, asyncHandler(async (req, res) => {
  const existingTrans = await Transmission.findOne({ id: req.params.id, ...getScopedTransmissionQuery(req) });
  if (!existingTrans) return res.status(404).json({ message: 'Transmission not found' });

  const isReceiveAction = Boolean(req.body.receivedBy) || req.body.confirmReceipt === true;
  let trans;
  if (isReceiveAction) {
    const toOffice = await getOfficeLabel(existingTrans.toOfficeId);
    const result = await receiveHandoff({
      transmissionId: existingTrans.id,
      officeId: getUserOfficeId(req),
      receivedBy: req.user.id,
      confirmed: req.body.confirmReceipt,
      acknowledgementRemarks: req.body.acknowledgementRemarks,
      eventFor: (item) => createTimelineEvent(req, 'transmission_received', 'Received at office',
        `Received at ${toOffice}`, item.toOfficeId, item.id),
    });
    trans = result.transmission;
    const doc = result.document;
    await runSideEffect(() => createLogEntry(req, 'transmission_received', `Received transmission for "${doc.subject}" at ${toOffice}`, trans.id));
    await runSideEffect(() => createNotification({
      officeId: trans.fromOfficeId, title: 'Route acknowledged',
      message: `${doc.trackingNumber} was received by ${toOffice}.`, type: 'success',
      referenceType: 'transmission', referenceId: trans.id, page: 'transmissions',
    }));
    await runSideEffect(() => notifyApprovalUsers({
      title: 'Transmission received', message: `${doc.trackingNumber} was acknowledged at ${toOffice}.`,
      type: 'success', referenceType: 'transmission', referenceId: trans.id, page: 'transmissions',
    }));
    await runSideEffect(() => queueSenderNotifications(req, doc, 'transmission_received', {
      message: `Your document ${doc.trackingNumber} was received at ${toOffice}.`,
      metadata: { transmissionId: trans.id },
    }));
  } else {
    if (!isApprovalRole(req)) return res.status(403).json({ message: 'Only approval users can edit transmission records directly' });
    // Receipt and route identity can only change through the workflow operations.
    const updates = { updatedAt: new Date().toISOString() };
    for (const field of ['transmissionDate', 'transmissionType', 'acknowledgementRemarks']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    trans = await Transmission.findOneAndUpdate({ id: existingTrans.id }, updates, updateOptions);
    if (!trans) return res.status(404).json({ message: 'Transmission not found' });
    await runSideEffect(() => createLogEntry(req, 'transmission_updated', `Updated transmission ${trans.id}`, trans.id));
  }
  broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(trans);
}));

router.delete('/:id', approvalRoles, asyncHandler(async (req, res) => {
  const trans = await cancelHandoff({
    transmissionId: req.params.id,
    eventFor: (item) => createTimelineEvent(req, 'transmission_cancelled', 'Transmission cancelled',
      'Delivery to this office was cancelled; other office deliveries are retained', item.fromOfficeId, item.id),
  });
  await runSideEffect(() => Notification.deleteMany({ referenceId: trans.id }));
  await runSideEffect(() => createLogEntry(req, 'transmission_deleted', `Deleted transmission ${trans.id}`, trans.id));
  broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications']);
  res.json({ success: true });
}));

module.exports = router;
