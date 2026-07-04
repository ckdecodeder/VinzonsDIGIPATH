const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  model: { type: String },
  type: { type: String },
  status: { type: String, enum: ['Online', 'Offline', 'Maintenance'], default: 'Offline' },
  ip: { type: String },
  location: { type: String },
  lastActive: { type: String },
  firmware: { type: String },
  serialNumber: { type: String },
  resolution: { type: String },
  scanCount: { type: Number, default: 0 },
  assignedTo: { type: String },
});

const Device = mongoose.model('Device', deviceSchema);
module.exports = Device;
