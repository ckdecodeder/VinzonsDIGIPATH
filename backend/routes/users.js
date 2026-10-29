const express = require('express');
const router = express.Router();
const { User, Office } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { stripPassword } = require('../utils/sanitize');
const { asyncHandler, requireFields, createLogEntry, generateId, normalizeText } = require('../utils/helpers');
const { broadcastDataInvalidate } = require('../utils/realtime');
const { validateRoleAssignment } = require('../utils/userRoles');
const revokeUserSession = (id) => require('../ws/realtimeHub').getRealtimeHub()?.revokeUser(id);

const adminOnly = allowRoles('Admin');
const approvalRoles = allowRoles('Admin', 'Mayor');

const normalizeUserPayload = (body, { isUpdate = false } = {}) => {
  const payload = {
    ...body,
    username: normalizeText(body.username),
    password: normalizeText(body.password),
    fname: normalizeText(body.fname),
    lname: normalizeText(body.lname),
    mname: normalizeText(body.mname),
    role: normalizeText(body.role),
    officeId: normalizeText(body.officeId),
  };

  if (isUpdate && !payload.password) {
    delete payload.password;
  }

  return payload;
};

const updateOptions = { new: true, runValidators: true };

router.use(protect);

router.get('/', approvalRoles, asyncHandler(async (req, res) => {
  const users = await User.find().sort({ id: 1 }).lean();
  res.json(users);
}));

router.put('/me/profile', asyncHandler(async (req, res) => {
  const allowedFields = ['username', 'fname', 'lname', 'mname', 'password'];
  const body = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key)),
  );
  const payload = normalizeUserPayload(body, { isUpdate: true });

  if (!payload.fname || !payload.lname || !payload.username) {
    return res.status(400).json({ message: 'First name, last name, and username are required.' });
  }

  if (payload.password && payload.password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  const existingUser = await User.findOne({
    username: payload.username,
    id: { $ne: req.user.id },
  }).lean();
  if (existingUser) {
    return res.status(409).json({ message: 'Username is already taken' });
  }

  const user = await User.findOneAndUpdate({ id: req.user.id }, payload, updateOptions);
  if (!user) return res.status(404).json({ message: 'User not found' });
  await createLogEntry(req, 'profile_updated', `Updated profile: ${user.username}`, user.id);
  broadcastDataInvalidate(['users', 'logs']);
  res.json(stripPassword(user));
}));

router.post('/', adminOnly, asyncHandler(async (req, res) => {
  const payload = normalizeUserPayload(req.body);
  requireFields(payload, ['username', 'password', 'fname', 'lname', 'role']);

  if (payload.password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  const existingUser = await User.findOne({ username: payload.username }).lean();
  if (existingUser) {
    return res.status(409).json({ message: 'Username is already taken' });
  }

  const [offices, existingUsers] = await Promise.all([
    Office.find().lean(),
    User.find().lean(),
  ]);
  const roleError = validateRoleAssignment({
    role: payload.role,
    officeId: payload.officeId,
    offices,
    users: existingUsers,
  });
  if (roleError) {
    return res.status(400).json({ message: roleError });
  }

  const user = new User({ ...payload, id: payload.id || generateId('USR') });
  await user.save();
  await createLogEntry(req, 'user_created', `Created user account: ${user.username}`, user.id);
  broadcastDataInvalidate(['users', 'logs']);
  res.json(stripPassword(user));
}));

router.put('/:id', adminOnly, asyncHandler(async (req, res) => {
  const payload = normalizeUserPayload(req.body, { isUpdate: true });

  if (payload.password && payload.password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  if (payload.username) {
    const existingUser = await User.findOne({ username: payload.username, id: { $ne: req.params.id } }).lean();
    if (existingUser) {
      return res.status(409).json({ message: 'Username is already taken' });
    }
  }

  if (payload.role || payload.officeId) {
    const currentUser = await User.findOne({ id: req.params.id }).lean();
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const [offices, existingUsers] = await Promise.all([
      Office.find().lean(),
      User.find().lean(),
    ]);
    const roleError = validateRoleAssignment({
      role: payload.role || currentUser.role,
      officeId: payload.officeId || currentUser.officeId,
      offices,
      users: existingUsers,
      excludeUserId: req.params.id,
    });
    if (roleError) {
      return res.status(400).json({ message: roleError });
    }
  }

  const user = await User.findOneAndUpdate({ id: req.params.id }, payload, updateOptions);
  if (!user) return res.status(404).json({ message: 'User not found' });
  revokeUserSession(user.id);
  await createLogEntry(req, 'user_updated', `Updated user account: ${user.username}`, user.id);
  broadcastDataInvalidate(['users', 'logs']);
  res.json(stripPassword(user));
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const user = await User.findOne({ id: req.params.id }).lean();
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete the account you are currently using' });
  }

  // Historical receipt and audit identities must survive account removal.
  // Clearing receivedBy would turn a completed delivery back into a pending one.
  await User.findOneAndDelete({ id: req.params.id });
  revokeUserSession(req.params.id);
  await createLogEntry(req, 'user_deleted', `Deleted user account: ${user.username}`, req.params.id);
  broadcastDataInvalidate(['users', 'logs', 'documents', 'transmissions', 'archives']);
  res.json({ success: true });
}));

module.exports = router;
