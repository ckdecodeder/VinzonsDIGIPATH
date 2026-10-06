const mongoose = require('mongoose');

const officeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
});

const Office = mongoose.model('Office', officeSchema);
module.exports = Office;
