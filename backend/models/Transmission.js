const mongoose = require('mongoose');

const transmissionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  documentId: { type: String, required: true },
  fromOfficeId: { type: String },
  toOfficeId: { type: String },
  sentBy: { type: String },
  receivedBy: { type: String, default: null },
  transmissionDate: { type: String },
  receivedAt: { type: String },
  acknowledgementRemarks: { type: String },
  transmissionType: { type: String, enum: ['Internal', 'External'] },
  createdAt: { type: String },
  updatedAt: { type: String },
});

const Transmission = mongoose.model('Transmission', transmissionSchema);
module.exports = Transmission;
