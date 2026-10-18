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
  appendDocumentTimeline,
  createTimelineEvent,
  getUserOfficeId,
  isApprovalRole,
} = require('../utils/helpers');
const { canSendDocument, buildSendTransition, buildReceiveTransition } = require('../utils/documentRouting');
const { queueSenderNotifications } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');
const {
  getScopedDocumentQueryWithTransmissions,
  getScopedTransmissionQuery,
} = require('../utils/documentScope');

const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const approvalRoles = allowRoles('Admin', 'Mayor');
const updateOptions = { new: true, runValidators: true };

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

  const sentAt = new Date().toISOString();
  let transition;
  try {
    transition = buildSendTransition({
      document: doc,
      toOfficeIds,
      sentBy: req.user.id,
      sentAt,
      transmissionType: req.body.transmissionType || 'Internal',
      transmissionDate: req.body.transmissionDate,
      acknowledgementRemarks: req.body.acknowledgementRemarks || '',
    });
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  const trans = new Transmission(transition.transmission);
  await trans.save();
  let routedDoc;
  let fromOffice;
  let toOffice;
  try {
    fromOffice = await getOfficeLabel(trans.fromOfficeId);
    toOffice = await getOfficeLabel(trans.toOfficeId);
    routedDoc = await appendDocumentTimeline(
      doc.id,
      createTimelineEvent(
        req,
        'document_routed',
        'Sent to office',
        `Sent from ${fromOffice} to ${toOffice}`,
        trans.fromOfficeId,
        trans.id,
      ),
      transition.documentUpdates,
    );
  } catch (err) {
    await Transmission.deleteMany({ id: trans.id });
    throw err;
  }
  await createLogEntry(req, 'transmission_created', `Routed "${doc.subject}" from ${fromOffice} to ${toOffice}`, trans.id);
  await createNotification({
    officeId: trans.toOfficeId,
    title: 'Incoming document route',
    message: `${doc.trackingNumber} was routed from ${fromOffice}.`,
    type: doc.priorityLevel === 'urgent' ? 'danger' : 'warning',
    referenceType: 'transmission',
    referenceId: trans.id,
    page: 'transmissions',
  });
  await queueSenderNotifications(req, routedDoc, 'document_routed', {
    message: `Your document ${doc.trackingNumber} was routed from ${fromOffice} to ${toOffice}.`,
    metadata: { transmissionId: trans.id },
  });
  broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(trans);
}));

router.put('/:id', allRoles, asyncHandler(async (req, res) => {
  const existingTrans = await Transmission.findOne({ id: req.params.id, ...getScopedTransmissionQuery(req) });
  if (!existingTrans) return res.status(404).json({ message: 'Transmission not found' });

  const isReceiveAction = Boolean(req.body.receivedBy);
  if (isReceiveAction && existingTrans.receivedBy) {
    return res.status(400).json({ message: 'This transmission has already been received' });
  }

  if (isReceiveAction && existingTrans.toOfficeId !== getUserOfficeId(req)) {
    return res.status(403).json({ message: 'Only the destination office can receive this transmission' });
  }
  if (!isReceiveAction && !isApprovalRole(req)) {
    return res.status(403).json({ message: 'Only approval users can edit transmission records directly' });
  }

  let receivingDoc = null;
  if (isReceiveAction) {
    receivingDoc = await Document.findOne({ id: existingTrans.documentId });
    if (!receivingDoc) {
      return res.status(404).json({ message: 'Transmission document was not found' });
    }
    if (receivingDoc.status !== 'In Transit') {
      return res.status(400).json({ message: `Only in-transit documents can be received. Current document status: ${receivingDoc.status}` });
    }
    if (receivingDoc.currentOfficeId !== existingTrans.fromOfficeId) {
      return res.status(409).json({ message: 'Transmission source no longer matches the document custody office' });
    }
    if (receivingDoc.destinationOfficeId && receivingDoc.destinationOfficeId !== existingTrans.toOfficeId) {
      return res.status(409).json({ message: 'Transmission destination no longer matches the document destination' });
    }
  }

  const updates = isReceiveAction
    ? {
        receivedBy: req.user.id,
        receivedAt: new Date().toISOString(),
        ...(req.body.acknowledgementRemarks ? { acknowledgementRemarks: req.body.acknowledgementRemarks } : {}),
      }
    : { ...req.body };
  delete updates._id;
  delete updates.__v;
  updates.updatedAt = new Date().toISOString();

  const trans = await Transmission.findOneAndUpdate({ id: req.params.id }, updates, updateOptions);
  if (!trans) return res.status(404).json({ message: 'Transmission not found' });

  if (isReceiveAction) {
    const doc = receivingDoc || await Document.findOne({ id: trans.documentId });
    if (doc) {
      const toOffice = await getOfficeLabel(trans.toOfficeId);
      const receiveUpdates = buildReceiveTransition({
        document: doc,
        toOfficeId: trans.toOfficeId,
        transmissionId: trans.id,
        receivedBy: req.user.id,
        receivedAt: trans.receivedAt,
      });
      let updatedDoc;
      try {
        updatedDoc = await appendDocumentTimeline(
          doc.id,
          createTimelineEvent(
            req,
            'transmission_received',
            'Received and acknowledged',
            `Received at ${toOffice}`,
            trans.toOfficeId,
            trans.id,
          ),
          receiveUpdates,
        );
      } catch (err) {
        await Transmission.findOneAndUpdate(
          { id: trans.id },
          { $set: { receivedBy: null, receivedAt: null, updatedAt: new Date().toISOString() } },
          updateOptions,
        );
        throw err;
      }
          await createLogEntry(req, 'transmission_received', `Received transmission for "${doc.subject}" at ${toOffice}`, trans.id);
          await createNotification({
            officeId: trans.fromOfficeId,
            title: 'Route acknowledged',
            message: `${doc.trackingNumber} was received by ${toOffice}.`,
            type: 'success',
            referenceType: 'transmission',
            referenceId: trans.id,
            page: 'transmissions',
          });
          await notifyApprovalUsers({
            title: 'Transmission received',
            message: `${doc.trackingNumber} was acknowledged at ${toOffice}.`,
            type: 'success',
            referenceType: 'transmission',
            referenceId: trans.id,
            page: 'transmissions',
          });
          await queueSenderNotifications(req, updatedDoc, 'transmission_received', {
            message: `Your document ${doc.trackingNumber} was received at ${toOffice}.`,
            metadata: { transmissionId: trans.id },
          });
        }
      } else {
        await createLogEntry(req, 'transmission_updated', `Updated transmission ${trans.id}`, trans.id);
      }

      broadcastDataInvalidate(['transmissions', 'documents', 'logs', 'notifications', 'senderNotifications']);
      res.json(trans);
    }));

    router.delete('/:id', approvalRoles, asyncHandler(async (req, res) => {
      const trans = await Transmission.findOne({ id: req.params.id }).lean();
      if (!trans) return res.status(404).json({ message: 'Transmission not found' });
      const routedDoc = !trans.receivedBy ? await Document.findOne({ id: trans.documentId }).lean() : null;

      await Transmission.findOneAndDelete({ id: req.params.id });
      await Notification.deleteMany({ referenceId: trans.id });
      if (!trans.receivedBy) {
        await appendDocumentTimeline(
          trans.documentId,
          createTimelineEvent(
            req,
            'transmission_cancelled',
            'Transmission cancelled',
            'Pending route was cancelled and document returned to source office',
            trans.fromOfficeId,
            trans.id,
          ),
          {
            status: routedDoc?.preTransitStatus || 'Received',
            preTransitStatus: '',
            currentOfficeId: trans.fromOfficeId,
            destinationOfficeId: trans.fromOfficeId,
          }
        );
      }
      await createLogEntry(req, 'transmission_deleted', `Deleted transmission ${trans.id}`, req.params.id);
      broadcastDataInvalidate(['transmissions', 'documents', 'logs']);
      res.json({ success: true });
    }));

    module.exports = router;
