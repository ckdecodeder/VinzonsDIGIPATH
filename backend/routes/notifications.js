const express = require('express');
const router = express.Router();
const { Notification } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, createLogEntry } = require('../utils/helpers');
const { broadcastDataInvalidate } = require('../utils/realtime');
const { isGlobalDocumentViewer } = require('../utils/documentScope');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
const updateOptions = { new: true, runValidators: true };

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

module.exports = router;
