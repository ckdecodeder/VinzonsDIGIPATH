const express = require('express');
const { getDatabaseStatus } = require('../config/db');
const router = express.Router();

const requireDatabase = (req, res, next) => {
  if (getDatabaseStatus() !== 'connected') {
    return res.status(503).json({ message: 'Database is not connected' });
  }
  next();
};

router.use(requireDatabase);

// Import feature-based sub-routers
const authRouter = require('./auth');
const usersRouter = require('./users');
const officesRouter = require('./offices');
const documentTypesRouter = require('./documentTypes');
const reportsRouter = require('./reports');
const archivesRouter = require('./archives');
const transmissionsRouter = require('./transmissions');
const logsRouter = require('./logs');

const trackingRouter = require('./tracking');
const notificationsRouter = require('./notifications');
const devicesRouter = require('./devices');
const documentsRouter = require('./documents');

// Mount domain-scoped routers
router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/offices', officesRouter);
router.use('/document-types', documentTypesRouter);
router.use('/reports', reportsRouter);
router.use('/archives', archivesRouter);
router.use('/transmissions', transmissionsRouter);
router.use('/logs', logsRouter);
router.use('/documents', documentsRouter);

// Mount root-scoped routers in specific order so exact paths are matched.
// Public tracking first, then hardware device routes, then notifications.
// Do not mount the tracking catch-all before named API routes like /notifications.
router.use('/', trackingRouter);
router.use('/', devicesRouter);
router.use('/', notificationsRouter);

// Universal error handling middleware
router.use((err, req, res, next) => {
  console.error(err);

  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern || {}).join(', ');
    return res.status(409).json({ message: `Duplicate value for unique field(s): ${fields}` });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  res.status(500).json({ message: err.message || 'Server error' });
});

module.exports = router;
