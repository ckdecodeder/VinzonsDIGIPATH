const express = require('express');
const router = express.Router();
const { Notification, SenderNotification, Document } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, createLogEntry } = require('../utils/helpers');
const { deliverSenderNotification } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');
const {
  getScopedDocumentQueryWithTransmissions,
  isGlobalDocumentViewer,
} = require('../utils/documentScope');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const senderResendRoles = allowRoles('Admin', 'Receptionist');
const updateOptions = { new: true, runValidators: true };

const getSenderNotificationVisibilityQuery = async (req, documentId = null) => {
  if (isGlobalDocumentViewer(req)) return documentId ? { documentId } : {};

  const visibleDocs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).select('id').lean();
  const visibleIds = visibleDocs.map((doc) => doc.id);
  if (documentId) {
    return { documentId: visibleIds.includes(documentId) ? documentId : '__not_visible__' };
  }
  return { documentId: { $in: visibleIds } };
};

const getNotificationVisibilityQuery = (req) => {
  const { getUserOfficeId } = require('../utils/helpers');
  if (isGlobalDocumentViewer(req)) return {};

  const officeId = getUserOfficeId(req);
  return {
    $or: [
      { userId: req.user.id },
      ...(officeId ? [{ officeId }] : []),
      { role: req.user.role },
      {
        userId: { $in: [null, ''] },
        officeId: { $in: [null, ''] },
        role: { $in: [null, ''] },
      },
    ],
  };
};

const assertCanAccessDocument = async (req, documentId) => {
  const { Document } = require('../models');
  const doc = await Document.findOne({ id: documentId, ...(await getScopedDocumentQueryWithTransmissions(req)) });
  if (!doc) {
    const err = new Error('Document not found or not visible to your office');
    err.status = 404;
    throw err;
  }
  return doc;
};

router.use(protect);

// ================= NOTIFICATIONS =================
router.get('/notifications', allRoles, asyncHandler(async (req, res) => {
  const notifications = await Notification.find(getNotificationVisibilityQuery(req))
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .lean();

  res.json(notifications.map((notification) => ({
    ...notification,
    isRead: (notification.readBy || []).includes(req.user.id),
  })));
}));

router.put('/notifications/:id/read', allRoles, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { id: req.params.id, ...getNotificationVisibilityQuery(req) },
    { $addToSet: { readBy: req.user.id } },
    updateOptions,
  );

  if (!notification) {
    return res.status(404).json({ message: 'Notification not found' });
  }

  broadcastDataInvalidate(['notifications']);
  res.json({ ...notification, isRead: true });
}));

router.put('/notifications/read-all', allRoles, asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    getNotificationVisibilityQuery(req),
    { $addToSet: { readBy: req.user.id } },
  );

  broadcastDataInvalidate(['notifications']);
  res.json({ success: true, modifiedCount: result.modifiedCount || 0 });
}));

router.delete('/notifications/:id', adminOnly, asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ id: req.params.id }).lean();
  await Notification.findOneAndDelete({ id: req.params.id });
  await createLogEntry(req, 'notification_deleted', `Deleted notification ${notification?.title || req.params.id}`, req.params.id);
  broadcastDataInvalidate(['notifications']);
  res.json({ success: true });
}));

// ================= SENDER NOTIFICATION OUTBOX =================
router.get('/sender-notifications', allRoles, asyncHandler(async (req, res) => {
  const query = await getSenderNotificationVisibilityQuery(req);
  const items = await SenderNotification.find(query).sort({ createdAt: -1, _id: -1 }).limit(250).lean();
  res.json(items);
}));

router.get('/documents/:id/sender-notifications', allRoles, asyncHandler(async (req, res) => {
  await assertCanAccessDocument(req, req.params.id);
  const items = await SenderNotification.find({ documentId: req.params.id }).sort({ createdAt: -1, _id: -1 }).lean();
  res.json(items);
}));

router.post('/sender-notifications/:id/resend', senderResendRoles, asyncHandler(async (req, res) => {
  const original = await SenderNotification.findOne({ id: req.params.id }).lean();
  if (!original) return res.status(404).json({ message: 'Sender notification not found' });
  await assertCanAccessDocument(req, original.documentId);
  if (original.channel !== 'sms') return res.status(400).json({ message: 'Only SMS notifications can be requeued here.' });
  if ((process.env.SENDER_NOTIFICATION_PROVIDER || 'outbox').toLowerCase() === 'outbox') {
    return res.status(409).json({ message: 'SMS delivery is still in outbox mode. Configure Twilio before requeuing this message.' });
  }
  if (!['Queued', 'Failed'].includes(original.status)) return res.status(409).json({ message: 'This SMS is already sending or has already been sent.' });
  if ((Number(original.metadata?.deliveryAttempts) || 0) >= 5) return res.status(429).json({ message: 'This SMS has reached the retry limit. Verify the recipient and provider before creating a new update.' });
  const delivered = await deliverSenderNotification(original);
  if (!delivered) return res.status(409).json({ message: 'This SMS is already sending or has already been sent.' });
  await createLogEntry(req, 'sender_notification_resent', `Requeued sender SMS for ${original.trackingNumber}`, original.id);
  broadcastDataInvalidate(['senderNotifications', 'logs']);
  res.json(delivered);
}));

module.exports = router;
