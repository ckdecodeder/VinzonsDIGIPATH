const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  action: { type: String, required: true },
  userId: { type: String, required: true },
  details: { type: String },
  referenceId: { type: String },
  timestamp: { type: String },
});

const Log = mongoose.model('Log', logSchema);
module.exports = Log;
