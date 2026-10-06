const mongoose = require('mongoose');

const documentTypeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  category: { type: String, required: true, unique: true },
});

const DocumentType = mongoose.model('DocumentType', documentTypeSchema);
module.exports = DocumentType;
