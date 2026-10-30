const express = require('express');
const { Op } = require('sequelize');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, createLogEntry } = require('../utils/helpers');
const { getScopedDocumentQueryWithTransmissions, isGlobalDocumentViewer } = require('../utils/documentScope');
const { parsePagination } = require('../utils/listing');
const { serializeSms } = require('../services/smsOutbox');
const { getSmsConfig } = require('../services/httpSms');

const createSmsRouter = ({ models = require('../models'), authenticate = protect, config = getSmsConfig, logEntry = createLogEntry } = {}) => {
  const router = express.Router();
  const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist', 'Office');
  const { Document, smsService } = models;
  const { DocumentModel, SmsNotificationModel } = models._sequelizeModels;
  const canAccess = async (req, id, transaction) => Boolean(await DocumentModel.findOne({
    where: Document._buildWhere({ id, ...(await getScopedDocumentQueryWithTransmissions(req)) }), transaction,
  }));
  router.use(authenticate);
  router.get('/sms/status', allRoles, (req, res) => {
    const cfg = config();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enabled: cfg.enabled, ready: cfg.ready, provider: 'httpsms',
      message: cfg.ready ? 'SMS delivery is enabled.' : 'SMS delivery is paused. Messages require configuration and intentional queueing.' });
  });
  const list = asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = {};
    if (req.params.id) {
      if (!await canAccess(req, req.params.id)) return res.status(404).json({ message: 'Document not found.' });
      where.documentId = req.params.id;
    } else if (!isGlobalDocumentViewer(req)) {
      const visible = await DocumentModel.findAll({
        where: Document._buildWhere(await getScopedDocumentQueryWithTransmissions(req)), attributes: ['id'], raw: true,
      });
      where.documentId = { [Op.in]: visible.map(doc => doc.id) };
    }
    const { rows, count } = await SmsNotificationModel.findAndCountAll({ where,
      order: [['createdAt', 'DESC'], ['id', 'DESC']], limit, offset });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: rows.map(serializeSms), total: count, page, limit });
  });
  router.get('/sender-notifications', allRoles, list);
  router.get('/documents/:id/sender-notifications', allRoles, list);
  router.post('/sender-notifications/:id/resend', allowRoles('Admin', 'Receptionist'), asyncHandler(async (req, res) => {
    const result = await smsService.requeue(req.params.id, (id, transaction) => canAccess(req, id, transaction));
    try { await logEntry(req, 'sender_sms_queued', 'Queued a sender SMS for background delivery.', result.id); }
    catch { console.error('SMS queue audit log could not be saved.'); }
    res.status(202).json(serializeSms(result));
  }));
  return router;
};
module.exports = { createSmsRouter };
