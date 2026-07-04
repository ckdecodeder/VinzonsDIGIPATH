/**
 * backend/models/index.js
 *
 * Defines all Sequelize table schemas and wraps each one with ModelWrapper
 * so the existing route handlers can call Mongoose-style methods unchanged.
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const { ModelWrapper } = require('./ModelWrapper');
const bcrypt = require('bcryptjs');

// ─── Schema definitions ────────────────────────────────────────────────────────

const OfficeModel = sequelize
  ? sequelize.define('Office', {
      id:        { type: DataTypes.STRING, primaryKey: true },
      name:      { type: DataTypes.STRING, allowNull: false },
      acronym:   { type: DataTypes.STRING },
      type:      { type: DataTypes.TEXT },
      headName:  { type: DataTypes.STRING },
      headTitle: { type: DataTypes.STRING },
      contact:   { type: DataTypes.STRING },
      email:     { type: DataTypes.TEXT },
      createdAt: { type: DataTypes.STRING },
      updatedAt: { type: DataTypes.STRING },
    }, { tableName: 'offices', timestamps: false })
  : null;

const UserModel = sequelize
  ? sequelize.define('User', {
      id:        { type: DataTypes.STRING, primaryKey: true },
      username:  { type: DataTypes.STRING, allowNull: false, unique: true },
      password:  { type: DataTypes.STRING, allowNull: false },
      fname:     { type: DataTypes.STRING, allowNull: false },
      lname:     { type: DataTypes.STRING, allowNull: false },
      mname:     { type: DataTypes.TEXT },
      role:      { type: DataTypes.STRING, defaultValue: 'Receptionist' },
      officeId:  { type: DataTypes.STRING },
      contact:   { type: DataTypes.STRING },
      email:     { type: DataTypes.TEXT },
    }, { tableName: 'users', timestamps: false })
  : null;

const DocumentTypeModel = sequelize
  ? sequelize.define('DocumentType', {
      id:        { type: DataTypes.STRING, primaryKey: true },
      name:      { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.STRING },
      updatedAt: { type: DataTypes.STRING },
    }, { tableName: 'document_types', timestamps: false })
  : null;

const DocumentModel = sequelize
  ? sequelize.define('Document', {
      id:                           { type: DataTypes.STRING, primaryKey: true },
      trackingNumber:               { type: DataTypes.STRING, allowNull: false, unique: true },
      subject:                      { type: DataTypes.STRING, allowNull: false },
      documentDirection:            { type: DataTypes.TEXT },
      status:                       { type: DataTypes.TEXT },
      preTransitStatus:             { type: DataTypes.TEXT },
      intakeStatus:                 { type: DataTypes.STRING, defaultValue: 'Approved' },
      verifiedBy:                   { type: DataTypes.TEXT },
      verifiedAt:                   { type: DataTypes.TEXT },
      rejectionReason:              { type: DataTypes.TEXT },
      priorityLevel:                { type: DataTypes.TEXT },
      dateReceived:                 { type: DataTypes.TEXT },
      documentTypeId:               { type: DataTypes.TEXT },
      documentTypeOther:            { type: DataTypes.TEXT },
      originOfficeId:               { type: DataTypes.TEXT },
      originOfficeOther:            { type: DataTypes.TEXT },
      currentOfficeId:              { type: DataTypes.TEXT },
      destinationOfficeId:          { type: DataTypes.TEXT },
      destinationOfficeOther:       { type: DataTypes.TEXT },
      rfidTag:                      { type: DataTypes.TEXT },
      lastDetectedOfficeId:         { type: DataTypes.TEXT },
      lastDetectedAt:               { type: DataTypes.TEXT },
      lastRoutedAt:                 { type: DataTypes.TEXT },
      completedAt:                  { type: DataTypes.TEXT },
      archivedAt:                   { type: DataTypes.TEXT },
      senderName:                   { type: DataTypes.TEXT },
      senderContact:                { type: DataTypes.TEXT },
      senderEmail:                  { type: DataTypes.TEXT },
      notifySender:                 { type: DataTypes.BOOLEAN, defaultValue: true },
      senderNotificationConsent:    { type: DataTypes.BOOLEAN, defaultValue: true },
      senderNotificationChannels:   { type: DataTypes.JSONB, defaultValue: [] },
      remarks:                      { type: DataTypes.TEXT },
      scannedText:                  { type: DataTypes.TEXT },
      scannedImageUrl:              { type: DataTypes.TEXT },
      scannedFiles:                 { type: DataTypes.JSONB, defaultValue: [] },
      timeline:                     { type: DataTypes.JSONB, defaultValue: [] },
      createdAt:                    { type: DataTypes.TEXT },
      updatedAt:                    { type: DataTypes.TEXT },
    }, { tableName: 'documents', timestamps: false })
  : null;

const TransmissionModel = sequelize
  ? sequelize.define('Transmission', {
      id:                    { type: DataTypes.STRING, primaryKey: true },
      documentId:            { type: DataTypes.TEXT },
      fromOfficeId:          { type: DataTypes.TEXT },
      toOfficeId:            { type: DataTypes.TEXT },
      sentBy:                { type: DataTypes.TEXT },
      receivedBy:            { type: DataTypes.TEXT },
      receivedAt:            { type: DataTypes.TEXT },
      transmissionDate:      { type: DataTypes.TEXT },
      transmissionType:      { type: DataTypes.TEXT },
      acknowledgementRemarks:{ type: DataTypes.TEXT },
      createdAt:             { type: DataTypes.TEXT },
      updatedAt:             { type: DataTypes.TEXT },
    }, { tableName: 'transmissions', timestamps: false })
  : null;

const ArchiveModel = sequelize
  ? sequelize.define('Archive', {
      id:                  { type: DataTypes.STRING, primaryKey: true },
      documentId:          { type: DataTypes.TEXT },
      userId:              { type: DataTypes.TEXT },
      date:                { type: DataTypes.TEXT },
      statusBeforeArchive: { type: DataTypes.STRING },
      createdAt:           { type: DataTypes.TEXT },
      updatedAt:           { type: DataTypes.TEXT },
    }, { tableName: 'archives', timestamps: false })
  : null;

const DeviceModel = sequelize
  ? sequelize.define('Device', {
      id:           { type: DataTypes.STRING, primaryKey: true },
      name:         { type: DataTypes.TEXT },
      model:        { type: DataTypes.TEXT },
      type:         { type: DataTypes.TEXT },
      status:       { type: DataTypes.TEXT },
      ip:           { type: DataTypes.TEXT },
      location:     { type: DataTypes.TEXT },
      lastActive:   { type: DataTypes.STRING },
      firmware:     { type: DataTypes.TEXT },
      serialNumber: { type: DataTypes.STRING },
      resolution:   { type: DataTypes.STRING },
      assignedTo:   { type: DataTypes.STRING },
      scanCount:    { type: DataTypes.INTEGER, defaultValue: 0 },
      createdAt:    { type: DataTypes.TEXT },
      updatedAt:    { type: DataTypes.TEXT },
    }, { tableName: 'devices', timestamps: false })
  : null;

const DeviceEventModel = sequelize
  ? sequelize.define('DeviceEvent', {
      id:          { type: DataTypes.STRING, primaryKey: true },
      deviceId:    { type: DataTypes.TEXT },
      eventType:   { type: DataTypes.STRING },
      documentId:  { type: DataTypes.STRING },
      officeId:    { type: DataTypes.TEXT },
      rfidTag:     { type: DataTypes.TEXT },
      status:      { type: DataTypes.TEXT },
      signalStrength: { type: DataTypes.STRING },
      details:     { type: DataTypes.TEXT },
      payload:     { type: DataTypes.JSONB, defaultValue: {} },
      recordedBy:  { type: DataTypes.STRING },
      timestamp:   { type: DataTypes.STRING },
    }, { tableName: 'device_events', timestamps: false })
  : null;

const CommandModel = sequelize
  ? sequelize.define('Command', {
      id:               { type: DataTypes.STRING, primaryKey: true },
      deviceId:         { type: DataTypes.TEXT },
      command:          { type: DataTypes.TEXT },
      status:           { type: DataTypes.STRING, defaultValue: 'Pending' },
      payload:          { type: DataTypes.JSONB, defaultValue: {} },
      requestedBy:      { type: DataTypes.TEXT },
      resultDocumentId: { type: DataTypes.STRING },
      errorMessage:     { type: DataTypes.TEXT },
      executedAt:       { type: DataTypes.TEXT },
      createdAt:        { type: DataTypes.TEXT },
    }, { tableName: 'commands', timestamps: false })
  : null;

const NotificationModel = sequelize
  ? sequelize.define('Notification', {
      id:            { type: DataTypes.STRING, primaryKey: true },
      userId:        { type: DataTypes.TEXT },
      officeId:      { type: DataTypes.TEXT },
      role:          { type: DataTypes.TEXT },
      title:         { type: DataTypes.TEXT },
      message:       { type: DataTypes.TEXT },
      type:          { type: DataTypes.STRING, defaultValue: 'info' },
      referenceType: { type: DataTypes.STRING },
      referenceId:   { type: DataTypes.STRING },
      page:          { type: DataTypes.TEXT },
      readBy:        { type: DataTypes.JSONB, defaultValue: [] },
      createdAt:     { type: DataTypes.TEXT },
    }, { tableName: 'notifications', timestamps: false })
  : null;

const SenderNotificationModel = sequelize
  ? sequelize.define('SenderNotification', {
      id:          { type: DataTypes.STRING, primaryKey: true },
      documentId:  { type: DataTypes.STRING },
      channel:     { type: DataTypes.TEXT },
      recipient:   { type: DataTypes.STRING },
      subject:     { type: DataTypes.TEXT },
      message:     { type: DataTypes.TEXT },
      status:      { type: DataTypes.STRING, defaultValue: 'pending' },
      error:       { type: DataTypes.TEXT },
      metadata:    { type: DataTypes.JSONB, defaultValue: {} },
      createdAt:   { type: DataTypes.STRING },
      sentAt:      { type: DataTypes.TEXT },
    }, { tableName: 'sender_notifications', timestamps: false })
  : null;

const LogModel = sequelize
  ? sequelize.define('Log', {
      id:          { type: DataTypes.STRING, primaryKey: true },
      action:      { type: DataTypes.TEXT },
      userId:      { type: DataTypes.TEXT },
      details:     { type: DataTypes.TEXT },
      referenceId: { type: DataTypes.STRING },
      timestamp:   { type: DataTypes.STRING },
    }, { tableName: 'logs', timestamps: false })
  : null;

// ─── Sync all tables to database ──────────────────────────────────────────────
const syncModels = async () => {
  if (!sequelize) return;
  // Use sync() without alter — tables were already created correctly by migrate-pg.js
  // alter:true would try to downgrade TEXT → VARCHAR(255), breaking existing data
  await sequelize.sync();
  console.log('All PostgreSQL tables verified.');
};

// ─── Build compatibility wrappers ─────────────────────────────────────────────
const makeModel = (SeqModel) => {
  if (!SeqModel) {
    // Return a stub that throws a helpful error if DB is not connected
    const stub = new Proxy({}, {
      get: () => () => Promise.reject(new Error('Database is not connected')),
    });
    return stub;
  }
  const wrapper = new ModelWrapper(SeqModel);
  return ModelWrapper.makeConstructable(wrapper);
};

const Office             = makeModel(OfficeModel);
const User               = makeModel(UserModel);
const DocumentType       = makeModel(DocumentTypeModel);
const Document           = makeModel(DocumentModel);
const Transmission       = makeModel(TransmissionModel);
const Archive            = makeModel(ArchiveModel);
const Device             = makeModel(DeviceModel);
const DeviceEvent        = makeModel(DeviceEventModel);
const Command            = makeModel(CommandModel);
const Notification       = makeModel(NotificationModel);
const SenderNotification = makeModel(SenderNotificationModel);
const Log                = makeModel(LogModel);

module.exports = {
  // Raw Sequelize models (used by migration script)
  _sequelizeModels: {
    OfficeModel,
    UserModel,
    DocumentTypeModel,
    DocumentModel,
    TransmissionModel,
    ArchiveModel,
    DeviceModel,
    DeviceEventModel,
    CommandModel,
    NotificationModel,
    SenderNotificationModel,
    LogModel,
  },
  syncModels,
  // Wrapped models (used by all route handlers)
  Office,
  User,
  DocumentType,
  Document,
  Transmission,
  Archive,
  Device,
  DeviceEvent,
  Command,
  Notification,
  SenderNotification,
  Log,
};
