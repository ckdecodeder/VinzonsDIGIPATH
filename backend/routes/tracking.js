const express = require('express');
const router = express.Router();
const { Document, DocumentType, Office, Transmission, Archive } = require('../models');
const { asyncHandler, normalizeText, escapeRegExp } = require('../utils/helpers');
const { trackingLimiter } = require('../utils/rateLimit');

const getOfficeMap = (offices) => offices.reduce((map, office) => {
  map[office.id] = office.name;
  return map;
}, {});

router.get('/public/track/:trackingNumber', trackingLimiter, asyncHandler(async (req, res) => {
  const trackingNumber = normalizeText(req.params.trackingNumber);
  const doc = await Document.findOne({
    trackingNumber: new RegExp(`^${escapeRegExp(trackingNumber)}$`, 'i'),
  }).lean();

  if (!doc) {
    return res.status(404).json({ message: 'Tracking number not found' });
  }

  const [documentType, offices, transmissions, archive] = await Promise.all([
    DocumentType.findOne({ id: doc.documentTypeId }).lean(),
    Office.find().lean(),
    Transmission.find({ documentId: doc.id }).sort({ transmissionDate: 1, id: 1 }).lean(),
    Archive.findOne({ documentId: doc.id }).lean(),
  ]);

  const officeMap = getOfficeMap(offices);
  const officeName = (officeId, fallback = '') => fallback || officeMap[officeId] || officeId || 'Not recorded';
  const publicTimeline = (doc.timeline || []).map((event) => ({
    label: event.label,
    office: officeName(event.officeId),
    details: event.details,
    timestamp: event.timestamp,
  }));
  const documentTypeLabel = documentType?.category === 'Others' && doc.documentTypeOther
    ? doc.documentTypeOther
    : documentType?.category || doc.documentTypeOther || 'Not recorded';

  res.json({
    trackingNumber: doc.trackingNumber,
    subject: doc.subject,
    documentDirection: doc.documentDirection,
    documentType: documentTypeLabel,
    status: doc.status,
    intakeStatus: doc.intakeStatus || 'Approved',
    rejectionReason: doc.rejectionReason || '',
    priorityLevel: doc.priorityLevel || 'normal',
    dateReceived: doc.dateReceived,
    currentOffice: officeName(doc.currentOfficeId),
    originOffice: officeName(doc.originOfficeId, doc.originOfficeOther),
    destinationOffice: officeName(doc.destinationOfficeId, doc.destinationOfficeOther),
    lastDetectedAt: doc.lastDetectedAt,
    lastDetectedOffice: officeName(doc.lastDetectedOfficeId),
    senderName: doc.senderName || '',
    archived: Boolean(archive),
    transmissions: transmissions.map((transmission) => ({
      id: transmission.id,
      fromOffice: officeName(transmission.fromOfficeId),
      toOffice: officeName(transmission.toOfficeId),
      transmissionDate: transmission.transmissionDate,
      receivedAt: transmission.receivedAt,
      status: transmission.receivedBy ? 'Received' : 'Pending receipt',
    })),
    timeline: publicTimeline,
    updatedAt:
      publicTimeline[publicTimeline.length - 1]?.timestamp ||
      doc.archivedAt ||
      doc.completedAt ||
      doc.lastRoutedAt ||
      doc.dateReceived,
  });
}));

module.exports = router;
