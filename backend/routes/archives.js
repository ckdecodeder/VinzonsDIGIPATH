const express = require('express');
const router = express.Router();
const { Archive, Document, Notification } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  createNotification,
  createTimelineEvent,
} = require('../utils/helpers');
const { queueSenderNotifications } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');
const { getScopedDocumentQueryWithTransmissions, isGlobalDocumentViewer } = require('../utils/documentScope');

const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const approvalRoles = allowRoles('Admin', 'Mayor');
const updateOptions = { new: true, runValidators: true };

router.use(protect);

router.get('/', allRoles, asyncHandler(async (req, res) => {
  if (isGlobalDocumentViewer(req)) {
    const archives = await Archive.find().sort({ createdAt: -1, date: -1, _id: -1 }).lean();
    return res.json(archives);
  }

  const visibleDocs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).select('id').lean();
  const documentIds = visibleDocs.map((doc) => doc.id);
  const archives = await Archive.find({ documentId: { $in: documentIds } }).sort({ createdAt: -1, date: -1, _id: -1 }).lean();
  res.json(archives);
}));

const { archiveDocument, restoreArchive } = require('../utils/archiveWorkflow');
const sideEffect = async (work) => { try { await work(); } catch (error) { console.error('Archive side effect failed:', error.name); } };
const validDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;

router.post('/', approvalRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['documentId']);
  if (req.body.date !== undefined && !validDate(req.body.date)) return res.status(400).json({ message: 'Use a valid archive date (YYYY-MM-DD).' });
  const result = await archiveDocument({
    documentId: req.body.documentId, userId: req.user.id, date: req.body.date,
    eventFor: (archive, doc) => createTimelineEvent(req, 'document_archived', 'Archived', `Archived by ${req.user.fname || req.user.username}`, doc.currentOfficeId, archive.id),
  });
  const { archive, document: doc } = result;
  await sideEffect(() => createLogEntry(req, 'document_archived', `Archived document: ${doc.subject}`, archive.id));
  await sideEffect(() => createNotification({ officeId: doc.originOfficeId || doc.currentOfficeId, title: 'Document archived', message: `${doc.trackingNumber} was archived as a completed record.`, type: 'success', referenceType: 'archive', referenceId: archive.id, page: 'archives' }));
  await sideEffect(() => queueSenderNotifications(req, doc, 'document_archived', { message: `Your document ${doc.trackingNumber} was archived as a completed record.`, metadata: { archiveId: archive.id } }));
  broadcastDataInvalidate(['archives', 'documents', 'logs', 'notifications', 'senderNotifications']);
  res.json(archive);
}));

router.put('/:id', approvalRoles, asyncHandler(async (req, res) => {
  if (Object.keys(req.body || {}).some(key => key !== 'date')) return res.status(400).json({ message: 'Only the archive date may be edited; document linkage and workflow history are immutable.' });
  if (!validDate(req.body.date)) return res.status(400).json({ message: 'Use a valid archive date (YYYY-MM-DD).' });
  const archive = await Archive.findOneAndUpdate({ id: req.params.id }, { date: req.body.date, updatedAt: new Date().toISOString() }, updateOptions);
  if (!archive) return res.status(404).json({ message: 'Archive not found' });
  await sideEffect(() => createLogEntry(req, 'archive_updated', `Updated archive ${archive.id}`, archive.id));
  broadcastDataInvalidate(['archives', 'logs']);
  res.json(archive);
}));

router.delete('/:id', approvalRoles, asyncHandler(async (req, res) => {
  const { archive } = await restoreArchive({ archiveId: req.params.id,
    eventFor: item => createTimelineEvent(req, 'archive_removed', 'Archive record removed', 'Archive record removed and document returned to completed status', null, item.id),
  });
  await sideEffect(() => Notification.deleteMany({ referenceId: archive.id }));
  await sideEffect(() => createLogEntry(req, 'archive_deleted', `Deleted archive ${archive.id}`, archive.id));
  broadcastDataInvalidate(['archives', 'documents', 'logs']);
  res.json({ success: true });
}));
module.exports = router;
