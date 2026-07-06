const express = require('express');
const router = express.Router();
const { Notification, SenderNotification } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, generateId, createLogEntry } = require('../utils/helpers');
const { deliverSenderNotification } = require('../utils/senderNotifications');
const { broadcastDataInvalidate } = require('../utils/realtime');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');
const updateOptions = { new: true, runValidators: true };

// Document scoping helper (used for sender notifications)
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

const getSenderNotificationVisibilityQuery = async (req, documentId = null) => {
  const { Document } = require('../models');
  const { isGlobalRole } = require('../utils/helpers');
  if (isGlobalRole(req)) return documentId ? { documentId } : {};

  const visibleDocs = await Document.find(await getScopedDocumentQueryWithTransmissions(req)).select('id').lean();
  const visibleIds = visibleDocs.map((doc) => doc.id);
  if (documentId) {
    return { documentId: visibleIds.includes(documentId) ? documentId : '__not_visible__' };
  }
  return { documentId: { $in: visibleIds } };
};

const getNotificationVisibilityQuery = (req) => {
  const { getUserOfficeId } = require('../utils/helpers');
  if (req.user.role === 'Admin') return {};

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

router.post('/sender-notifications/:id/resend', allRoles, asyncHandler(async (req, res) => {
  const original = await SenderNotification.findOne({ id: req.params.id }).lean();
  if (!original) return res.status(404).json({ message: 'Sender notification not found' });
  await assertCanAccessDocument(req, original.documentId);

  const copy = new SenderNotification({
    ...original,
    _id: undefined,
    __v: undefined,
    id: generateId('SNOTIF'),
    status: 'Queued',
    errorMessage: '',
    createdAt: new Date().toISOString(),
    sentAt: '',
    createdBy: req.user.id,
    metadata: {
      ...(original.metadata || {}),
      resendOf: original.id,
    },
  });
  await copy.save();
  const delivered = await deliverSenderNotification(copy);
  await createLogEntry(req, 'sender_notification_resent', `Queued sender notification resend for ${original.trackingNumber}`, copy.id);
  broadcastDataInvalidate(['senderNotifications', 'logs']);
  res.status(201).json(delivered || copy);
}));

module.exports = router;
