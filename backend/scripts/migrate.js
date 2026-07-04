require('dotenv').config();
const mongoose = require('mongoose');
const {
  Document,
  Transmission,
  Archive,
  User,
} = require('../models');

const sortByDate = (items, dateSelector) => {
  return [...items].sort((a, b) => {
    const aTime = new Date(dateSelector(a) || 0).getTime();
    const bTime = new Date(dateSelector(b) || 0).getTime();
    return aTime - bTime;
  });
};

const timelineEvent = (id, label, details, officeId, userId, timestamp, referenceId) => ({
  id,
  action: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
  label,
  details,
  officeId,
  userId,
  referenceId,
  timestamp,
});

const buildTimeline = (doc, transmissions, archive) => {
  if (doc.timeline?.length) return doc.timeline;

  const events = [];
  const registeredAt = doc.dateReceived || new Date().toISOString();

  events.push(timelineEvent(
    `${doc.id}-registered`,
    'Registered',
    `Document registered with tracking number ${doc.trackingNumber}`,
    doc.originOfficeId || doc.currentOfficeId,
    null,
    registeredAt,
    doc.id,
  ));

  sortByDate(transmissions, item => item.transmissionDate).forEach((transmission) => {
    events.push(timelineEvent(
      `${transmission.id}-sent`,
      'Routed to office',
      `Sent from ${transmission.fromOfficeId || 'unknown'} to ${transmission.toOfficeId || 'unknown'}`,
      transmission.fromOfficeId,
      transmission.sentBy,
      transmission.transmissionDate || registeredAt,
      transmission.id,
    ));

    if (transmission.receivedBy) {
      events.push(timelineEvent(
        `${transmission.id}-received`,
        'Received and acknowledged',
        `Received at ${transmission.toOfficeId || 'destination office'}`,
        transmission.toOfficeId,
        transmission.receivedBy,
        transmission.receivedAt || transmission.transmissionDate || registeredAt,
        transmission.id,
      ));
    }
  });

  if (archive) {
    events.push(timelineEvent(
      `${archive.id}-archived`,
      'Archived',
      'Document moved to archive records',
      doc.currentOfficeId || doc.destinationOfficeId || doc.originOfficeId,
      archive.userId,
      archive.date || doc.archivedAt || registeredAt,
      archive.id,
    ));
  }

  return sortByDate(events, item => item.timestamp);
};

const migrate = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Add it to backend/.env before running migrations.');
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  let mayorAccountCreated = false;
  let mayorAccountUpdated = false;
  const existingMayor = await User.findOne({ username: 'mayor' }).lean();
  if (!existingMayor) {
    await new User({
      id: 'USR-MAYOR',
      username: 'mayor',
      password: 'mayor123',
      fname: 'Ana',
      lname: 'Cruz',
      mname: 'B.',
      role: 'Mayor',
      officeId: 'OFF-001',
    }).save();
    mayorAccountCreated = true;
  } else if (existingMayor.role !== 'Mayor' || !existingMayor.officeId) {
    await User.findOneAndUpdate(
      { username: 'mayor' },
      {
        role: 'Mayor',
        officeId: existingMayor.officeId || 'OFF-001',
        fname: existingMayor.fname || 'Ana',
        lname: existingMayor.lname || 'Cruz',
        mname: existingMayor.mname || 'B.',
      },
      { runValidators: true }
    );
    mayorAccountUpdated = true;
  }

  const documents = await Document.find();
  let migratedDocuments = 0;
  let migratedTransmissions = 0;

  for (const doc of documents) {
    const transmissions = await Transmission.find({ documentId: doc.id }).lean();
    const archive = await Archive.findOne({ documentId: doc.id }).lean();
    const orderedTransmissions = sortByDate(transmissions, item => item.receivedAt || item.transmissionDate);
    const latestTransmission = orderedTransmissions[orderedTransmissions.length - 1];

    const originOfficeId = doc.originOfficeId || orderedTransmissions[0]?.fromOfficeId || doc.currentOfficeId || 'OFF-001';
    const destinationOfficeId = doc.destinationOfficeId || latestTransmission?.toOfficeId || '';
    const currentOfficeId = latestTransmission
      ? (latestTransmission.receivedBy ? latestTransmission.toOfficeId : latestTransmission.fromOfficeId)
      : (doc.currentOfficeId || originOfficeId);

    let status = doc.status || 'Received';
    if (archive) {
      status = 'Archived';
    } else if (latestTransmission && !latestTransmission.receivedBy && status === 'Received') {
      status = 'In Transit';
    }

    const updates = {
      originOfficeId,
      currentOfficeId,
      destinationOfficeId,
      status,
      intakeStatus: doc.intakeStatus || 'Approved',
      scannedFiles: doc.scannedFiles || [],
      timeline: buildTimeline(doc, orderedTransmissions, archive),
    };

    if (latestTransmission) {
      updates.lastRoutedAt = latestTransmission.transmissionDate || latestTransmission.receivedAt;
    }

    if (archive) {
      updates.archivedAt = doc.archivedAt || archive.date;
    }

    await Document.updateOne({ id: doc.id }, { $set: updates }, { runValidators: true });
    migratedDocuments += 1;
  }

  const transmissions = await Transmission.find({
    receivedBy: { $ne: null },
    $or: [{ receivedAt: { $exists: false } }, { receivedAt: null }, { receivedAt: '' }],
  });

  for (const transmission of transmissions) {
    transmission.receivedAt = transmission.transmissionDate || new Date().toISOString();
    await transmission.save();
    migratedTransmissions += 1;
  }

  console.log(`Migration complete. Documents checked: ${migratedDocuments}. Transmissions backfilled: ${migratedTransmissions}. Mayor account created: ${mayorAccountCreated}. Mayor account updated: ${mayorAccountUpdated}.`);
};

migrate()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
