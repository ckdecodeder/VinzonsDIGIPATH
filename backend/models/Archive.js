const mongoose = require('mongoose');

const archiveSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  documentId: { type: String, required: true },
  userId: { type: String, required: true },
  date: { type: String, required: true },
  statusBeforeArchive: { type: String },
  createdAt: { type: String },
  updatedAt: { type: String },
});

const Archive = mongoose.model('Archive', archiveSchema);
module.exports = Archive;
