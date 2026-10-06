/**
 * migrate-pg.js — PostgreSQL Migration & Data Import Script
 *
 * Run with: npm run migrate
 *
 * This script will:
 *  1. Initialize and start the local user-space PostgreSQL cluster (backend/pgdata) if needed
 *  2. Connect to PostgreSQL and create/sync all tables
 *  3. Import all records from dbcollections/*.json into the corresponding tables
 *  4. Report a summary of imported records per collection
 */
require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const bcrypt = require('bcryptjs');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const COLLECTIONS_DIR = path.resolve(__dirname, '../../dbcollections');

/** Strip MongoDB-specific metadata keys and return a clean plain object. */
function cleanRecord(raw) {
  const obj = { ...raw };
  delete obj._id;    // MongoDB ObjectId wrapper
  delete obj.__v;    // Mongoose version key
  return obj;
}

/** Read a JSON dump file and return an array of cleaned records. */
function readCollection(filename) {
  const filepath = path.join(COLLECTIONS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`  ⚠  Collection file not found: ${filename}`);
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const records = Array.isArray(raw) ? raw : [raw];
  return records.map(cleanRecord);
}

/** Bulk-upsert records into a Sequelize model, ignoring duplicates. */
async function importCollection(SeqModel, records, label) {
  if (!records.length) {
    console.log(`  ↳  ${label}: (empty, skipped)`);
    return;
  }
  try {
    await SeqModel.bulkCreate(records, {
      updateOnDuplicate: Object.keys(SeqModel.rawAttributes),
    });
    console.log(`  ✓  ${label}: ${records.length} records imported`);
  } catch (err) {
    console.error(`  ✗  ${label}: import failed — ${err.message}`);
    throw err;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Dynamically import Sequelize and models after env is loaded
  const { Sequelize, DataTypes } = require('sequelize');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Check backend/.env');
  }

  // ─── Step 1: Connect to default `postgres` DB and create vinzons_digipath ──
  const dbUrl     = new URL(process.env.DATABASE_URL);
  const targetDb  = dbUrl.pathname.replace('/', '');
  const adminUrl  = `${dbUrl.protocol}//${dbUrl.username}:${dbUrl.password}@${dbUrl.host}/postgres`;

  const adminSeq = new Sequelize(adminUrl, { dialect: 'postgres', logging: false });
  await adminSeq.authenticate();
  console.log('✓ Connected to PostgreSQL (admin)');

  // Create target database if it doesn't exist
  const [rows] = await adminSeq.query(
    `SELECT 1 FROM pg_database WHERE datname = '${targetDb}'`
  );
  if (rows.length === 0) {
    await adminSeq.query(`CREATE DATABASE "${targetDb}"`);
    console.log(`✓ Created database: ${targetDb}`);
  } else {
    console.log(`✓ Database already exists: ${targetDb}`);
  }
  await adminSeq.close();

  // ─── Step 2: Connect to vinzons_digipath ──────────────────────────────────
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
  });
  await sequelize.authenticate();
  console.log(`✓ Connected to database: ${targetDb}\n`);

  // ─── Helper — all freetext string cols use TEXT to avoid VARCHAR(255) limits ─
  const S = DataTypes.TEXT;   // safe "string"
  const PK = DataTypes.TEXT;  // primary key (short IDs, TEXT is fine)

  const Office = sequelize.define('Office', {
    id:        { type: PK, primaryKey: true },
    name:      { type: S },
    acronym:   { type: S },
    type:      { type: S },
    headName:  { type: S },
    headTitle: { type: S },
    contact:   { type: S },
    email:     { type: S },
    createdAt: { type: S },
    updatedAt: { type: S },
  }, { tableName: 'offices', timestamps: false });

  const User = sequelize.define('User', {
    id:        { type: PK, primaryKey: true },
    username:  { type: S, unique: true },
    password:  { type: S },
    fname:     { type: S },
    lname:     { type: S },
    mname:     { type: S },
    role:      { type: S, defaultValue: 'Receptionist' },
    officeId:  { type: S },
    contact:   { type: S },
    email:     { type: S },
  }, { tableName: 'users', timestamps: false });

  const DocumentType = sequelize.define('DocumentType', {
    id:        { type: PK, primaryKey: true },
    category:  { type: S },
    createdAt: { type: S },
    updatedAt: { type: S },
  }, { tableName: 'document_types', timestamps: false });

  const Document = sequelize.define('Document', {
    id:                        { type: PK, primaryKey: true },
    trackingNumber:            { type: S, unique: true },
    subject:                   { type: S },
    documentDirection:         { type: S },
    status:                    { type: S },
    preTransitStatus:          { type: S },
    intakeStatus:              { type: S },
    verifiedBy:                { type: S },
    verifiedAt:                { type: S },
    rejectionReason:           { type: S },
    priorityLevel:             { type: S },
    dateReceived:              { type: S },
    documentTypeId:            { type: S },
    documentTypeOther:         { type: S },
    originOfficeId:            { type: S },
    originOfficeOther:         { type: S },
    currentOfficeId:           { type: S },
    destinationOfficeId:       { type: S },
    destinationOfficeOther:    { type: S },
    rfidTag:                   { type: S },
    lastDetectedOfficeId:      { type: S },
    lastDetectedAt:            { type: S },
    lastRoutedAt:              { type: S },
    completedAt:               { type: S },
    archivedAt:                { type: S },
    senderName:                { type: S },
    senderContact:             { type: S },
    senderEmail:               { type: S },
    notifySender:              { type: DataTypes.BOOLEAN, defaultValue: true },
    senderNotificationConsent: { type: DataTypes.BOOLEAN, defaultValue: true },
    senderNotificationChannels:{ type: DataTypes.JSONB, defaultValue: [] },
    remarks:                   { type: S },
    scannedText:               { type: S },
    scannedImageUrl:           { type: S },
    scannedFiles:              { type: DataTypes.JSONB, defaultValue: [] },
    timeline:                  { type: DataTypes.JSONB, defaultValue: [] },
    createdAt:                 { type: S },
    updatedAt:                 { type: S },
  }, { tableName: 'documents', timestamps: false });

  const Transmission = sequelize.define('Transmission', {
    id:                     { type: PK, primaryKey: true },
    documentId:             { type: S },
    fromOfficeId:           { type: S },
    toOfficeId:             { type: S },
    sentBy:                 { type: S },
    receivedBy:             { type: S },
    receivedAt:             { type: S },
    transmissionDate:       { type: S },
    transmissionType:       { type: S },
    acknowledgementRemarks: { type: S },
    createdAt:              { type: S },
    updatedAt:              { type: S },
  }, { tableName: 'transmissions', timestamps: false });

  const Archive = sequelize.define('Archive', {
    id:                  { type: PK, primaryKey: true },
    documentId:          { type: S },
    userId:              { type: S },
    date:                { type: S },
    statusBeforeArchive: { type: S },
    createdAt:           { type: S },
    updatedAt:           { type: S },
  }, { tableName: 'archives', timestamps: false });

  const Device = sequelize.define('Device', {
    id:           { type: PK, primaryKey: true },
    name:         { type: S },
    model:        { type: S },
    type:         { type: S },
    status:       { type: S },
    ip:           { type: S },
    bridgeUrl:    { type: S },
    location:     { type: S },
    lastActive:   { type: S },
    firmware:     { type: S },
    serialNumber: { type: S },
    resolution:   { type: S },
    assignedTo:   { type: S },
    scanCount:    { type: DataTypes.INTEGER, defaultValue: 0 },
    createdAt:    { type: S },
    updatedAt:    { type: S },
  }, { tableName: 'devices', timestamps: false });

  const DeviceEvent = sequelize.define('DeviceEvent', {
    id:             { type: PK, primaryKey: true },
    deviceId:       { type: S },
    eventType:      { type: S },
    documentId:     { type: S },
    officeId:       { type: S },
    rfidTag:        { type: S },
    status:         { type: S },
    signalStrength: { type: S },
    details:        { type: S },
    payload:        { type: DataTypes.JSONB, defaultValue: {} },
    recordedBy:     { type: S },
    timestamp:      { type: S },
  }, { tableName: 'device_events', timestamps: false });

  const Command = sequelize.define('Command', {
    id:               { type: PK, primaryKey: true },
    deviceId:         { type: S },
    command:          { type: S },
    status:           { type: S, defaultValue: 'Pending' },
    payload:          { type: DataTypes.JSONB, defaultValue: {} },
    requestedBy:      { type: S },
    resultDocumentId: { type: S },
    errorMessage:     { type: S },
    executedAt:       { type: S },
    createdAt:        { type: S },
  }, { tableName: 'commands', timestamps: false });

  const Notification = sequelize.define('Notification', {
    id:            { type: PK, primaryKey: true },
    userId:        { type: S },
    officeId:      { type: S },
    role:          { type: S },
    title:         { type: S },
    message:       { type: S },
    type:          { type: S },
    referenceType: { type: S },
    referenceId:   { type: S },
    page:          { type: S },
    readBy:        { type: DataTypes.JSONB, defaultValue: [] },
    createdAt:     { type: S },
  }, { tableName: 'notifications', timestamps: false });

  const SenderNotification = sequelize.define('SenderNotification', {
    id:         { type: PK, primaryKey: true },
    documentId: { type: S },
    channel:    { type: S },
    recipient:  { type: S },
    subject:    { type: S },
    message:    { type: S },
    status:     { type: S, defaultValue: 'pending' },
    error:      { type: S },
    metadata:   { type: DataTypes.JSONB, defaultValue: {} },
    createdAt:  { type: S },
    sentAt:     { type: S },
  }, { tableName: 'sender_notifications', timestamps: false });

  const Log = sequelize.define('Log', {
    id:          { type: PK, primaryKey: true },
    action:      { type: S },
    userId:      { type: S },
    details:     { type: S },
    referenceId: { type: S },
    timestamp:   { type: S },
  }, { tableName: 'logs', timestamps: false });


  // ─── Sync (create tables if they don't exist) ────────────────────────────
  console.log('\n⏳ Syncing database tables...');
  await sequelize.sync({ force: true });
  console.log('✓ All tables created/updated\n');

  // ─── Import data from dbcollections/ ─────────────────────────────────────
  console.log('📦 Importing data from dbcollections/...\n');

  // Offices
  await importCollection(Office,
    readCollection('vinzons_digipath.offices.json'),
    'offices');

  // Document Types
  await importCollection(DocumentType,
    readCollection('vinzons_digipath.documenttypes.json'),
    'document_types');

  // Users — ensure passwords are hashed
  const rawUsers = readCollection('vinzons_digipath.users.json');
  const users = await Promise.all(rawUsers.map(async (u) => ({
    ...u,
    password: u.password && u.password.startsWith('$2')
      ? u.password
      : await bcrypt.hash(u.password || 'changeme', 10),
  })));
  await importCollection(User, users, 'users');

  // Documents (large — shows individual progress)
  const documents = readCollection('vinzons_digipath.documents.json');
  // Normalize JSONB fields
  const cleanedDocs = documents.map(d => ({
    ...d,
    senderNotificationChannels: Array.isArray(d.senderNotificationChannels) ? d.senderNotificationChannels : [],
    scannedFiles: Array.isArray(d.scannedFiles) ? d.scannedFiles : [],
    timeline: Array.isArray(d.timeline) ? d.timeline : [],
  }));
  await importCollection(Document, cleanedDocs, `documents (${cleanedDocs.length} records)`);

  // Transmissions
  await importCollection(Transmission,
    readCollection('vinzons_digipath.transmissions.json'),
    'transmissions');

  // Archives
  await importCollection(Archive,
    readCollection('vinzons_digipath.archives.json'),
    'archives');

  // Devices
  await importCollection(Device,
    readCollection('vinzons_digipath.devices.json'),
    'devices');

  // Device Events (large collection)
  const deviceEvents = readCollection('vinzons_digipath.deviceevents.json');
  const cleanedEvents = deviceEvents.map(e => ({
    ...e,
    payload: e.payload && typeof e.payload === 'object' ? e.payload : {},
  }));
  await importCollection(DeviceEvent, cleanedEvents, `device_events (${cleanedEvents.length} records)`);

  // Notifications
  const notifications = readCollection('vinzons_digipath.notifications.json');
  const cleanedNotifs = notifications.map(n => ({
    ...n,
    readBy: Array.isArray(n.readBy) ? n.readBy : [],
  }));
  await importCollection(Notification, cleanedNotifs, `notifications (${cleanedNotifs.length} records)`);

  // Sender Notifications
  const senderNotifs = readCollection('vinzons_digipath.sendernotifications.json');
  const cleanedSenderNotifs = senderNotifs.map(s => ({
    ...s,
    metadata: s.metadata && typeof s.metadata === 'object' ? s.metadata : {},
  }));
  await importCollection(SenderNotification, cleanedSenderNotifs, `sender_notifications (${cleanedSenderNotifs.length} records)`);

  // Logs (large collection)
  const logs = readCollection('vinzons_digipath.logs.json');
  await importCollection(Log, logs, `logs (${logs.length} records)`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n✅ Migration complete! All data has been imported into PostgreSQL.');
  console.log('\nTo view your data visually, open pgAdmin:');
  console.log('  Start Menu → pgAdmin 4');
  console.log('  Connect to: localhost:5433  (or the system port 5432 if using the system PostgreSQL)');
  console.log('  Database: vinzons_digipath\n');

  await sequelize.close();
}

main().catch((err) => {
  console.error('\n✗ Migration failed:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});
