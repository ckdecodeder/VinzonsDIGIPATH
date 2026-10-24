const mongoose = require('mongoose');

const documentTypeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  category: { type: String, required: true, unique: true },
  requiresMayorApproval: { type: Boolean, default: false },
  requiresMayorReception: { type: Boolean, default: false },
  routingTrack: { type: String, default: 'direct' },
});

const DocumentType = mongoose.model('DocumentType', documentTypeSchema);
module.exports = DocumentType;
