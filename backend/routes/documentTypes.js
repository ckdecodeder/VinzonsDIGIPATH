const express = require('express');
const router = express.Router();
const { DocumentType, Document } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, requireFields, createLogEntry, generateId } = require('../utils/helpers');

const adminOnly = allowRoles('Admin');
const updateOptions = { new: true, runValidators: true };

router.use(protect);

router.get('/', asyncHandler(async (req, res) => {
  const documentTypes = await DocumentType.find().sort({ id: 1 }).lean();
  res.json(documentTypes);
}));

router.post('/', adminOnly, asyncHandler(async (req, res) => {
  requireFields(req.body, ['category']);
  
  const payload = {
    ...req.body,
    id: req.body.id || generateId('DT'),
    requiresMayorApproval: Boolean(req.body.requiresMayorApproval),
    requiresMayorReception: Boolean(req.body.requiresMayorReception),
    routingTrack: req.body.routingTrack || 'direct',
  };
  
  const documentType = new DocumentType(payload);
  await documentType.save();
  await createLogEntry(req, 'document_type_created', `Created document type: ${documentType.category}`, documentType.id);
  res.json(documentType);
}));

router.put('/:id', adminOnly, asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  if (req.body.requiresMayorApproval !== undefined) {
    updates.requiresMayorApproval = Boolean(req.body.requiresMayorApproval);
  }
  if (req.body.requiresMayorReception !== undefined) updates.requiresMayorReception = Boolean(req.body.requiresMayorReception);
  if (req.body.routingTrack) {
    updates.routingTrack = req.body.routingTrack;
  }

  const documentType = await DocumentType.findOneAndUpdate({ id: req.params.id }, updates, updateOptions);
  if (!documentType) return res.status(404).json({ message: 'Document type not found' });
  await createLogEntry(req, 'document_type_updated', `Updated document type: ${documentType.category}`, documentType.id);
  res.json(documentType);
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const documentType = await DocumentType.findOne({ id: req.params.id }).lean();
  if (!documentType) return res.status(404).json({ message: 'Document type not found' });
  const documentCount = await Document.countDocuments({ documentTypeId: req.params.id });
  if (documentCount) {
    return res.status(409).json({ message: 'This document type is used by existing documents and cannot be deleted.' });
  }

  await DocumentType.findOneAndDelete({ id: req.params.id });
  await createLogEntry(req, 'document_type_deleted', `Deleted document type: ${documentType.category}`, req.params.id);
  res.json({ success: true });
}));

module.exports = router;
