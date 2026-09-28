const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  deviceId: { type: String, required: true },
  command: { type: String, enum: ['SCAN', 'SORT', 'MOTOR_TEST', 'RESTART', 'SHUTDOWN'], required: true },
  status: { type: String, enum: ['Pending', 'Executing', 'Executed', 'Failed', 'Cancelled'], default: 'Pending' },
  payload: { type: mongoose.Schema.Types.Mixed },
  requestedBy: { type: String },
  resultDocumentId: { type: String },
  errorMessage: { type: String },
  createdAt: { type: String, required: true },
  executedAt: { type: String },
});

const Command = mongoose.model('Command', commandSchema);
module.exports = Command;
