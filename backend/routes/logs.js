const express = require('express');
const router = express.Router();
const { Log } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, requireFields, generateId } = require('../utils/helpers');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');

router.use(protect);

router.get('/', allRoles, asyncHandler(async (req, res) => {
  const query = req.user.role === 'Receptionist' ? { userId: req.user.id } : {};
  const logs = await Log.find(query).sort({ timestamp: -1, _id: -1 }).lean();
  res.json(logs);
}));

router.post('/', adminOnly, asyncHandler(async (req, res) => {
  requireFields(req.body, ['action']);
  const log = new Log({ ...req.body, userId: req.user.id, id: req.body.id || generateId('LOG') });
  await log.save();
  res.json(log);
}));

module.exports = router;
