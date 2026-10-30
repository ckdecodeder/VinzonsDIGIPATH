const mongoose = require('mongoose');

const senderNotificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  documentId: { type: String, required: true },
  trackingNumber: { type: String },
  eventType: { type: String, required: true },
  channel: { type: String, enum: ['sms', 'email'], required: true },
  recipient: { type: String, required: true },
  recipientName: { type: String },
  subject: { type: String },
  message: { type: String, required: true },
  status: { type: String, enum: ['Queued', 'Sending', 'Sent', 'Failed', 'Skipped'], default: 'Queued' },
  provider: { type: String, default: 'outbox' },
  errorMessage: { type: String },
  createdAt: { type: String, required: true },
  sentAt: { type: String },
  createdBy: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
});

const SenderNotification = mongoose.model('SenderNotification', senderNotificationSchema);
module.exports = SenderNotification;
