const express = require('express');
const router = express.Router();
const { Office, User, Document, Transmission, Device } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { asyncHandler, requireFields, createLogEntry, generateId } = require('../utils/helpers');
const { broadcastDataInvalidate } = require('../utils/realtime');

const adminOnly = allowRoles('Admin');
const updateOptions = { new: true, runValidators: true };

router.use(protect);

router.get('/', asyncHandler(async (req, res) => {
  const offices = await Office.find().sort({ id: 1 }).lean();
  res.json(offices);
}));

router.post('/', adminOnly, asyncHandler(async (req, res) => {
  requireFields(req.body, ['name']);
  const office = new Office({ ...req.body, id: req.body.id || generateId('OFF') });
  await office.save();
  await createLogEntry(req, 'office_created', `Created office: ${office.name}`, office.id);
  broadcastDataInvalidate(['offices', 'logs']);
  res.json(office);
}));

router.put('/:id', adminOnly, asyncHandler(async (req, res) => {
  const office = await Office.findOneAndUpdate({ id: req.params.id }, req.body, updateOptions);
  if (!office) return res.status(404).json({ message: 'Office not found' });
  await createLogEntry(req, 'office_updated', `Updated office: ${office.name}`, office.id);
  broadcastDataInvalidate(['offices', 'logs']);
  res.json(office);
}));

router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const office = await Office.findOne({ id: req.params.id }).lean();
  if (!office) return res.status(404).json({ message: 'Office not found' });

  const [userCount, documentCount, transmissionCount, deviceCount] = await Promise.all([
    User.countDocuments({ officeId: req.params.id }),
    Document.countDocuments({
      $or: [
        { originOfficeId: req.params.id },
        { currentOfficeId: req.params.id },
        { destinationOfficeId: req.params.id },
        { lastDetectedOfficeId: req.params.id },
      ],
    }),
    Transmission.countDocuments({
      $or: [
        { fromOfficeId: req.params.id },
        { toOfficeId: req.params.id },
      ],
    }),
    Device.countDocuments({ assignedTo: req.params.id }),
  ]);

  if (userCount || documentCount || transmissionCount || deviceCount) {
    return res.status(409).json({
      message: 'This office is still used by users, documents, transmissions, or devices. Reassign those records before deleting it.',
    });
  }

  await Office.findOneAndDelete({ id: req.params.id });
  await createLogEntry(req, 'office_deleted', `Deleted office: ${office.name}`, req.params.id);
  broadcastDataInvalidate(['offices', 'logs']);
  res.json({ success: true });
}));

module.exports = router;
