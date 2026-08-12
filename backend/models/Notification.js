const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, default: null },
  officeId: { type: String, default: null },
  role: { type: String, enum: ['Admin', 'Mayor', 'Receptionist', null], default: null },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'danger'], default: 'info' },
  referenceType: { type: String },
  referenceId: { type: String },
  page: { type: String },
  readBy: { type: [String], default: [] },
  createdAt: { type: String, required: true },
});

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
