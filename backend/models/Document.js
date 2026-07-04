const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String },
  size: { type: Number },
  dataUrl: { type: String },
  url: { type: String },
  storagePath: { type: String },
  uploadedAt: { type: String },
  uploadedBy: { type: String },
  source: { type: String, enum: ['camera', 'upload', 'scanner'], default: 'upload' },
}, { _id: false });

const timelineEventSchema = new mongoose.Schema({
  id: { type: String, required: true },
  action: { type: String, required: true },
  label: { type: String, required: true },
  details: { type: String },
  officeId: { type: String },
  userId: { type: String },
  referenceId: { type: String },
  timestamp: { type: String, required: true },
}, { _id: false });

const documentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  trackingNumber: { type: String, required: true, unique: true },
  subject: { type: String, required: true },
  documentDirection: { type: String, enum: ['Incoming', 'Outgoing'] },
  status: { type: String, enum: ['Received', 'In Transit', 'Processing', 'For Signature', 'For Signing', 'For Filing', 'Signed', 'Acknowledged', 'Archived'] },
  preTransitStatus: { type: String },
  intakeStatus: { type: String, enum: ['Pending Review', 'Approved', 'Rejected'], default: 'Approved' },
  verifiedBy: { type: String },
  verifiedAt: { type: String },
  rejectionReason: { type: String },
  priorityLevel: { type: String, enum: ['urgent', 'high', 'normal', 'low'] },
  dateReceived: { type: String },
  documentTypeId: { type: String },
  documentTypeOther: { type: String },
  originOfficeId: { type: String },
  originOfficeOther: { type: String },
  currentOfficeId: { type: String },
  destinationOfficeId: { type: String },
  destinationOfficeOther: { type: String },
  rfidTag: { type: String },
  lastDetectedOfficeId: { type: String },
  lastDetectedAt: { type: String },
  lastRoutedAt: { type: String },
  completedAt: { type: String },
  archivedAt: { type: String },
  senderName: { type: String },
  senderContact: { type: String },
  senderEmail: { type: String },
  notifySender: { type: Boolean, default: true },
  senderNotificationConsent: { type: Boolean, default: true },
  senderNotificationChannels: [{ type: String, enum: ['sms', 'email'] }],
  remarks: { type: String },
  scannedText: { type: String },
  scannedImageUrl: { type: String },
  scannedFiles: { type: [attachmentSchema], default: [] },
  timeline: { type: [timelineEventSchema], default: [] },
  createdAt: { type: String },
  updatedAt: { type: String },
});

const Document = mongoose.model('Document', documentSchema);
module.exports = Document;
