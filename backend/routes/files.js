const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Op, literal } = require('sequelize');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { getScopedDocumentQueryWithTransmissions } = require('../utils/documentScope');
const { scansRoot } = require('../config/storage');

// Filename equality inside JSON, never substring matching or trusting a caller's document ID.
const fileOwnerPredicate = (filename, escape) => {
  const name = escape(filename);
  const matches = (item) => `(${item}->>'storagePath' = ${escape('uploads/scans/' + filename)} OR substring(${item}->>'url' from '/uploads/scans/([^?#]+)') = ${name})`;
  const array = expression => `(CASE WHEN jsonb_typeof(${expression}) = 'array' THEN ${expression} ELSE '[]'::jsonb END)`;
  // Skip regex work on large legacy inline covers; these never name a stored file.
  const cover = `(CASE WHEN left(COALESCE("scannedImageUrl", ''), 5) = 'data:' THEN false ELSE ("scannedImageUrl" = ${escape('/uploads/scans/' + filename)} OR substring("scannedImageUrl" from '/uploads/scans/([^?#]+)') = ${name}) END)`;
  return `(${cover} OR EXISTS (SELECT 1 FROM jsonb_array_elements(${array('"scannedFiles"')}) f WHERE ${matches('f')} OR EXISTS (SELECT 1 FROM jsonb_array_elements(${array("f->'pages'")}) p WHERE ${matches('p')})))`;
};
const createFileRouter = ({ Document, DocumentModel, root = scansRoot, authenticate = protect } = {}) => {
  const router = express.Router();
  router.use(authenticate, allowRoles('Admin', 'Mayor', 'Receptionist', 'Office'));
  router.get('/scans/:filename', asyncHandler(async (req, res) => {
    const filename = req.params.filename;
    if (!filename || path.basename(filename) !== filename || /[\\/\x00]/.test(filename) || !/\.(pdf|jpe?g|png|webp)$/i.test(filename)) return res.sendStatus(404);
    const models = DocumentModel ? { Document, DocumentModel } : (() => { const m = require('../models'); return { Document: m.Document, DocumentModel: m._sequelizeModels.DocumentModel }; })();
    const scope = await getScopedDocumentQueryWithTransmissions(req);
    const owner = await models.DocumentModel.findOne({
      attributes: ['id'], where: { [Op.and]: [models.Document._buildWhere(scope), literal(fileOwnerPredicate(filename, value => models.DocumentModel.sequelize.escape(value)))] },
    });
    if (!owner) return res.sendStatus(404);
    const absolute = path.join(root, filename);
    try {
      const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
      if (path.dirname(realFile) !== realRoot) return res.sendStatus(404);
    } catch (error) { if (error.code === 'ENOENT') return res.sendStatus(404); throw error; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(absolute, { dotfiles: 'deny' });
  }));
  return router;
};
module.exports = { createFileRouter, fileOwnerPredicate };
