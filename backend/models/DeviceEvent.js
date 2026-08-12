const mongoose = require('mongoose');

const deviceEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  deviceId: { type: String, required: true },
  eventType: {
    type: String,
    enum: ['device_connected', 'device_disconnected', 'scan_started', 'scan_completed', 'rfid_detected', 'device_heartbeat', 'status_changed', 'error'],
    required: true,
  },
  documentId: { type: String },
  officeId: { type: String },
  rfidTag: { type: String },
  status: { type: String },
  signalStrength: { type: Number },
  details: { type: String },
  payload: { type: mongoose.Schema.Types.Mixed },
  recordedBy: { type: String },
  timestamp: { type: String, required: true },
});

const DeviceEvent = mongoose.model('DeviceEvent', deviceEventSchema);
module.exports = DeviceEvent;
