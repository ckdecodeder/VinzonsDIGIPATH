const express = require('express');
const router = express.Router();
const { Log, User } = require('../models');
const { parsePagination, contains, andFilters } = require('../utils/listing');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, requireFields, generateId } = require('../utils/helpers');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');

router.use(protect);

router.get('/', allRoles, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const scope = req.user.role === 'Receptionist' ? { userId: req.user.id } : {};
  const filter = {};
  if (req.query.action && req.query.action !== 'All') filter.action = String(req.query.action);
  if (req.query.userId) filter.userId = String(req.query.userId);
  if (req.query.reference) filter.referenceId = contains(req.query.reference);
  if (req.query.dateFrom || req.query.dateTo) {
    filter.timestamp = {};
    if (req.query.dateFrom) filter.timestamp.$gte = String(req.query.dateFrom);
    if (req.query.dateTo) filter.timestamp.$lt = `${String(req.query.dateTo)}\uffff`;
  }
  if (req.query.search) {
    const term = String(req.query.search);
    const users = await User.find({ $or: ['fname', 'mname', 'lname'].map((field) => ({ [field]: contains(term) })) }).select('id').lean();
    filter.$or = ['details', 'referenceId', 'action'].map((field) => ({ [field]: contains(term) }));
    if (users.length) filter.$or.push({ userId: { $in: users.map((user) => user.id) } });
    if (req.query.searchActions) filter.$or.push({ action: { $in: String(req.query.searchActions).split(',').slice(0, 100) } });
  }
  const query = andFilters(scope, filter);
  const [items, total] = await Promise.all([
    Log.find(query).sort({ timestamp: -1, id: -1 }).skip(offset).limit(limit).lean(),
    Log.countDocuments(query),
  ]);
  res.json({ items, total, page, limit });
}));

router.post('/', adminOnly, asyncHandler(async (req, res) => {
  requireFields(req.body, ['action']);
  const log = new Log({ ...req.body, userId: req.user.id, id: req.body.id || generateId('LOG') });
  await log.save();
  res.json(log);
}));

module.exports = router;
