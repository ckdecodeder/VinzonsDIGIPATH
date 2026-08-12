const { getDatabaseStatus } = require('../config/db');

// ─── ID & Tracking ─────────────────────────────────────────────────────────────
const generateId = (prefix) => `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

const generateTrackingNumber = () => {
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1679616).toString(36).toUpperCase().padStart(4, '0');
  return `TRK-${year}-${timestamp}-${random}`;
};

// ─── Express helpers ───────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const requireDatabase = (req, res, next) => {
  if (getDatabaseStatus() !== 'connected') {
    return res.status(503).json({ message: 'Database is not connected' });
  }
  next();
};

const requireFields = (body, fields) => {
  const source = body || {};
  const missing = fields.filter(field => source[field] === undefined || source[field] === null || source[field] === '');
  if (missing.length) {
    const err = new Error(`Missing required field(s): ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
};

const createHttpError = (message, status = 400) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

// ─── Text helpers ──────────────────────────────────────────────────────────────
const normalizeText = (value) => typeof value === 'string' ? value.trim() : value;
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeFileName = (name = 'file') => {
  const cleaned = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (cleaned || 'file').slice(0, 120);
};

const buildReportFileName = (categoryLabel, date = new Date()) => {
  const slug = String(categoryLabel || 'Summary').replace(/\s+/g, '-');
  const stamp = date.toISOString().slice(0, 10);
  return sanitizeFileName(`DigiPath-${slug}-${stamp}.docx`);
};

// ─── Workflow helpers ──────────────────────────────────────────────────────────
const workflowStatuses = ['Received', 'In Transit', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived'];
const legacyWorkflowStatuses = ['Processing', 'For Signature'];
const storedWorkflowStatuses = [...workflowStatuses, ...legacyWorkflowStatuses];

const normalizeWorkflowStatus = (value, fallback = 'Received') => {
  const status = normalizeText(value);
  if (!status) return fallback;
  if (status === 'For Signature') return 'For Signing';
  if (status === 'Acknoweledged') return 'Acknowledged';
  return storedWorkflowStatuses.includes(status) ? status : fallback;
};

// ─── Auth helpers ──────────────────────────────────────────────────────────────
const getUserOfficeId = (req) => req.user?.officeId;
const isGlobalRole = (req) => req.user?.role === 'Admin' || req.user?.role === 'Mayor';
const isApprovalRole = (req) => req.user?.role === 'Admin' || req.user?.role === 'Mayor';

// ─── Timeline & Logging ────────────────────────────────────────────────────────
const createTimelineEvent = (req, action, label, details, officeId = null, referenceId = null) => ({
  id: generateId('TL'),
  action,
  label,
  details,
  officeId,
  userId: req.user?.id || null,
  referenceId,
  timestamp: new Date().toISOString(),
});

const appendDocumentTimeline = async (documentId, event, updates = {}) => {
  const { Document } = require('../models');
  const now = new Date().toISOString();
  return Document.findOneAndUpdate(
    { id: documentId },
    {
      $set: { ...updates, updatedAt: updates.updatedAt || now },
      $push: { timeline: event },
    },
    { new: true, runValidators: true }
  );
};

const createLogEntry = async (req, action, details, referenceId = null, userId = null) => {
  const { Log } = require('../models');
  const log = new Log({
    id: generateId('LOG'),
    action,
    userId: userId || req.user?.id || 'system',
    details,
    referenceId,
    timestamp: new Date().toISOString(),
  });
  await log.save();
  return log;
};

const createNotification = async ({
  userId = null,
  officeId = null,
  role = null,
  title,
  message,
  type = 'info',
  referenceType = '',
  referenceId = '',
  page = '',
}) => {
  if (!title || !message) return null;
  const { Notification } = require('../models');
  const notification = new Notification({
    id: generateId('NOTIF'),
    userId,
    officeId,
    role,
    title,
    message,
    type,
    referenceType,
    referenceId,
    page,
    readBy: [],
    createdAt: new Date().toISOString(),
  });
  await notification.save();
  return notification;
};

const notifyApprovalUsers = async (payload) => {
  await Promise.all([
    createNotification({ ...payload, role: 'Admin' }),
    createNotification({ ...payload, role: 'Mayor' }),
  ]);
};

module.exports = {
  generateId,
  generateTrackingNumber,
  asyncHandler,
  requireDatabase,
  requireFields,
  createHttpError,
  normalizeText,
  escapeRegExp,
  sanitizeFileName,
  buildReportFileName,
  workflowStatuses,
  legacyWorkflowStatuses,
  storedWorkflowStatuses,
  normalizeWorkflowStatus,
  getUserOfficeId,
  isGlobalRole,
  isApprovalRole,
  createTimelineEvent,
  appendDocumentTimeline,
  createLogEntry,
  createNotification,
  notifyApprovalUsers,
};
