const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { createToken, protect } = require('../middleware/auth');
const { stripPassword } = require('../utils/sanitize');
const { asyncHandler, requireFields, createLogEntry } = require('../utils/helpers');
const { loginLimiter } = require('../utils/rateLimit');

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  requireFields(req.body, ['username', 'password']);

  const user = await User.findOne({ username }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  await createLogEntry(req, 'user_login', `${user.fname} ${user.lname} logged in as ${user.role}`, user.id, user.id);

  res.json({
    token: createToken(user),
    user: stripPassword(user),
  });
}));

router.get('/me', protect, asyncHandler(async (req, res) => {
  res.json(stripPassword(req.user));
}));

module.exports = router;
