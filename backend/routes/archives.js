const express = require('express');
const router = express.Router();
const { Archive, Document, Notification } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  generateId,
  createNotification,
  queueSenderNotifications,
  appendDocumentTimeline,
  createTimelineEvent,
} = require('../utils/helpers');
const { broadcastDataInvalidate } = require('../utils/realtime');

const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');
const approvalRoles = allowRoles('Admin', 'Mayor');
const updateOptions = { new: true, runValidators: true };

const getScopedDocumentQueryWithTransmissions = async (req) => {
  const { Transmission } = require('../models');
  const { isGlobalRole, getUserOfficeId } = require('../utils/helpers');
  if (isGlobalRole(req)) return {};
  const officeId = getUserOfficeId(req);
  
  let baseQuery;
  if (req.user?.role === 'Receptionist') {
    baseQuery = {
      $or: [
        { 'timeline.userId': req.user.id },
        { verifiedBy: req.user.id },
      ],
    };
  } else {
    baseQuery = {
      $or: [
        { originOfficeId: officeId },
        { currentOfficeId: officeId },
        { destinationOfficeId: officeId },
        { 'timeline.userId': req.user.id },
      ],
    };
  }

  let transmissionQuery;
  if (req.user?.role === 'Receptionist') {
    transmissionQuery = {
      $or: [
        { toOfficeId: officeId, receivedBy: { $in: [null, ''] } },
        { sentBy: req.user.id },
        { receivedBy: req.user.id },
      ],
    };
  } else {
    transmissionQuery = {
      $or: [
        { fromOfficeId: officeId },
        { toOfficeId: officeId },
        { sentBy: req.user.id },
        { receivedBy: req.user.id },
      ],
    };
  }

  const transmissions = await Transmission.find(transmissionQuery).select('documentId').lean();
  const documentIds = transmissions.map((t) => t.documentId);
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
  const { isGlobalRole } = require('../utils/helpers');
  if (isGlobalRole(req)) {
    const archives = await Archive.find().sort({ createdAt: -1, date: -1, _id: -1 }).lean();
    return res.json(archives);
  }

  const visibleDocs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).select('id').lean();
  const documentIds = visibleDocs.map((doc) => doc.id);
  const archives = await Archive.find({ documentId: { $in: documentIds } }).sort({ createdAt: -1, date: -1, _id: -1 }).lean();
  res.json(archives);
}));

router.post('/', approvalRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['documentId']);
  const doc = await assertCanAccessDocument(req, req.body.documentId);
  const currentStatus = normalizeWorkflowStatusValue(doc.status, doc.status);
  if (![...finalWorkflowStatuses, 'For Filing'].includes(currentStatus)) {
    return res.status(400).json({ message: 'Only Signed or Acknowledged documents can be archived' });
  }

  const existingArchive = await Archive.findOne({ documentId: req.body.documentId }).lean();
  if (existingArchive) {
    return res.status(409).json({ message: 'This document is already archived' });
  }

  const now = new Date().toISOString();
  const arc = new Archive({
    id: req.body.id || generateId('ARC'),
    documentId: req.body.documentId,
    userId: req.user.id,
    date: req.body.date || now.split('T')[0],
    statusBeforeArchive: currentStatus,
    createdAt: now,
    updatedAt: now,
  });
  await arc.save();

  const archivedDoc = await appendDocumentTimeline(
    doc.id,
    createTimelineEvent(
      req,
      'document_archived',
      'Archived',
      `Archived by ${req.user.fname || req.user.username}`,
      doc.currentOfficeId,
      arc.id,
    ),
    {
      status: 'Archived',
      archivedAt: new Date().toISOString(),
    }
  );
  await createLogEntry(req, 'document_archived', `Archived document: ${doc.subject}`, arc.id);
  await createNotification({
    officeId: doc.originOfficeId || doc.currentOfficeId,
    title: 'Document archived',
    message: `${doc.trackingNumber} was archived as a completed record.`,
    type: 'success',
    referenceType: 'archive',
    referenceId: arc.id,
    page: 'archives',
  });
  await queueSenderNotifications(req, archivedDoc, 'document_archived', {
    message: `Your document ${doc.trackingNumber} was archived as a completed record.`,
    metadata: { archiveId: arc.id },
  });
  broadcastDataInvalidate(['archives', 'documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(arc);
}));

router.put('/:id', approvalRoles, asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  delete updates._id;
  delete updates.__v;
  updates.updatedAt = new Date().toISOString();
  const archive = await Archive.findOneAndUpdate({ id: req.params.id }, updates, updateOptions);
  if (!archive) return res.status(404).json({ message: 'Archive not found' });
  await createLogEntry(req, 'archive_updated', `Updated archive ${archive.id}`, archive.id);
  broadcastDataInvalidate(['archives', 'documents', 'logs']);
  res.json(archive);
}));

router.delete('/:id', approvalRoles, asyncHandler(async (req, res) => {
  const archive = await Archive.findOne({ id: req.params.id }).lean();
  if (!archive) return res.status(404).json({ message: 'Archive not found' });

  await Archive.findOneAndDelete({ id: req.params.id });
  await appendDocumentTimeline(
    archive.documentId,
    createTimelineEvent(
      req,
      'archive_removed',
      'Archive record removed',
      'Archive record removed and document returned to completed status',
      null,
      archive.id,
    ),
    {
      status: archive.statusBeforeArchive || 'Acknowledged',
      archivedAt: '',
    }
  );
  await Notification.deleteMany({ referenceId: archive.id });
  await createLogEntry(req, 'archive_deleted', `Deleted archive ${archive.id}`, req.params.id);
  broadcastDataInvalidate(['archives', 'documents', 'logs']);
  res.json({ success: true });
}));

module.exports = router;
