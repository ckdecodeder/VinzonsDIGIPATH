const express = require('express');
const router = express.Router();
const { Device, DeviceEvent, Command, Document } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { deviceLimiter } = require('../utils/rateLimit');
const { requireDeviceApiKey, getBridgeBaseUrl, fetchBridgeEndpoint, cleanBridgeErrorText } = require('../utils/bridge');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  generateId,
  generateTrackingNumber,
  notifyApprovalUsers,
  queueSenderNotifications,
  appendDocumentTimeline,
  createTimelineEvent,
  normalizeWorkflowStatus,
  isGlobalRole,
  getUserOfficeId,
} = require('../utils/helpers');
const { persistAttachments } = require('../utils/attachments');
const { normalizeSenderNotificationChannels } = require('../utils/senderNotifications');
const {
  getDeviceSnapshot,
  recordHardwareDeviceEvent,
  hardwarePresenceEvents,
} = require('../services/devicePresence');
const {
  broadcastDeviceUpdated,
  broadcastCommandUpdated,
  broadcastDataInvalidate,
  pushCommandToDevice,
} = require('../utils/realtime');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');
const scannerCommandRoles = allowRoles('Admin', 'Receptionist');
const updateOptions = { new: true, runValidators: true };

const scannerCommandStaleMs = Number(process.env.SCANNER_COMMAND_STALE_MS || 60000);

const registrationStatuses = ['Received', 'For Signing', 'For Filing'];

// ─── HARDWARE / IOT ENDPOINTS ──────────────────────────────────────────────────
router.post('/devices/connect', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const result = await recordHardwareDeviceEvent(req, 'device_connected');
  broadcastDeviceUpdated(result.device);
  res.status(201).json(result);
}));

router.post('/devices/heartbeat', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const result = await recordHardwareDeviceEvent(req, 'device_heartbeat');
  broadcastDeviceUpdated(result.device);
  res.status(201).json(result);
}));

router.post('/devices/disconnect', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const result = await recordHardwareDeviceEvent(req, 'device_disconnected');
  broadcastDeviceUpdated(result.device);
  res.status(201).json(result);
}));

router.post('/devices/events', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  requireFields(req.body, ['eventType']);
  if (!hardwarePresenceEvents.includes(req.body.eventType)) {
    return res.status(400).json({ message: `Invalid hardware event type: ${req.body.eventType}` });
  }

  const result = await recordHardwareDeviceEvent(req, req.body.eventType);
  broadcastDeviceUpdated(result.device);
  res.status(201).json(result);
}));

router.get('/devices/:deviceId/commands', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const commands = await Command.find({
    deviceId: req.params.deviceId,
    status: 'Pending',
  }).sort({ createdAt: 1, _id: 1 }).limit(10).lean();

  res.json(commands);
}));

router.put('/devices/commands/:id', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const allowedStatuses = ['Executing', 'Executed', 'Failed', 'Cancelled'];
  const status = req.body.status?.trim();
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid command status update' });
  }

  const command = await Command.findOneAndUpdate(
    { id: req.params.id },
    {
      status,
      resultDocumentId: req.body.resultDocumentId?.trim(),
      errorMessage: req.body.errorMessage?.trim(),
      executedAt: status === 'Executed' || status === 'Failed' || status === 'Cancelled'
        ? new Date().toISOString()
        : undefined,
    },
    updateOptions,
  );

  if (!command) return res.status(404).json({ message: 'Command not found' });
  await createLogEntry(req, 'device_command_updated', `Device command ${command.command} marked ${command.status}`, command.id, 'hardware');

  let resultDocument = null;
  if (command.resultDocumentId) {
    resultDocument = await Document.findOne({ id: command.resultDocumentId }).lean();
  }
  broadcastCommandUpdated(command.toObject?.() || command, resultDocument);
  res.json(command);
}));

router.post('/devices/scans', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const deviceId = req.body.deviceId?.trim() || 'DEV-001';
  const command = req.body.commandId ? await Command.findOne({ id: req.body.commandId }).lean() : null;
  const device = await Device.findOne({ id: deviceId }).lean();
  const officeId = req.body.officeId?.trim() || command?.payload?.officeId || device?.assignedTo || 'OFF-001';
  const attachmentSource = req.body.attachment || req.body.scannedFile;
  const scannedFiles = attachmentSource
    ? await persistAttachments(req, [{
        id: attachmentSource.id,
        name: attachmentSource.name || `${deviceId}-scan.jpg`,
        type: attachmentSource.type || 'image/jpeg',
        size: attachmentSource.size,
        dataUrl: attachmentSource.dataUrl,
        uploadedAt: now,
        uploadedBy: 'hardware',
        source: 'scanner',
      }])
    : [];

  const subject = req.body.subject?.trim() || req.body.extractedTitle?.trim() || 'Scanned Document';
  const requestedScanStatus = req.body.status || command?.payload?.status;
  const registrationStatus = registrationStatuses.includes(normalizeWorkflowStatus(requestedScanStatus))
    ? normalizeWorkflowStatus(requestedScanStatus)
    : 'Received';
  const doc = new Document({
    id: req.body.documentId || generateId('DOC'),
    trackingNumber: req.body.trackingNumber || generateTrackingNumber(),
    subject,
    documentDirection: req.body.documentDirection || 'Incoming',
    status: registrationStatus,
    intakeStatus: 'Pending Review',
    priorityLevel: req.body.priorityLevel || 'normal',
    dateReceived: req.body.dateReceived || now.split('T')[0],
    createdAt: now,
    updatedAt: now,
    documentTypeId: req.body.documentTypeId || 'DT-001',
    documentTypeOther: req.body.documentTypeOther?.trim(),
    originOfficeId: officeId,
    originOfficeOther: req.body.originOfficeOther?.trim(),
    currentOfficeId: officeId,
    destinationOfficeOther: req.body.destinationOfficeOther?.trim(),
    senderName: req.body.senderName?.trim() || req.body.extractedSender?.trim() || 'Scanner Device',
    senderContact: req.body.senderContact?.trim(),
    senderEmail: req.body.senderEmail?.trim(),
    notifySender: req.body.notifySender !== undefined ? Boolean(req.body.notifySender) : true,
    senderNotificationConsent: req.body.senderNotificationConsent !== undefined ? Boolean(req.body.senderNotificationConsent) : true,
    senderNotificationChannels: normalizeSenderNotificationChannels(req.body.senderNotificationChannels, req.body),
    remarks: req.body.remarks?.trim() || `Captured by physical scanner ${deviceId}`,
    scannedText: req.body.scannedText || req.body.extractedText || '',
    scannedFiles,
    scannedImageUrl: scannedFiles[0]?.url || scannedFiles[0]?.dataUrl || '',
    timeline: [{
      id: generateId('TL'),
      action: 'hardware_scan',
      label: 'Physical scanner capture',
      details: `Document captured by physical scanner ${deviceId}`,
      officeId,
      userId: 'hardware',
      referenceId: deviceId,
      timestamp: now,
    }],
  });
  await doc.save();

  const event = new DeviceEvent({
    id: req.body.eventId || generateId('EVT'),
    deviceId,
    eventType: 'scan_completed',
    documentId: doc.id,
    officeId,
    details: `Physical scanner uploaded ${doc.trackingNumber}`,
    payload: { commandId: req.body.commandId },
    recordedBy: 'hardware',
    timestamp: now,
  });
  await event.save();

  await Device.findOneAndUpdate(
    { id: deviceId },
    {
      $set: {
        id: deviceId,
        name: req.body.deviceName || device?.name || 'Physical Document Scanner',
        model: req.body.model || device?.model,
        type: 'Scanner',
        status: 'Online',
        ip: req.body.ip || device?.ip || req.ip,
        location: req.body.location || device?.location,
        lastActive: now,
        assignedTo: officeId,
      },
      $inc: { scanCount: 1 },
    },
    { upsert: true, runValidators: true, new: true },
  );

  if (req.body.commandId) {
    await Command.findOneAndUpdate(
      { id: req.body.commandId },
      { status: 'Executed', resultDocumentId: doc.id, executedAt: now },
      updateOptions,
    );
  }

  await createLogEntry(req, 'document_scanned', `Physical scanner uploaded document: ${doc.subject}`, doc.id, 'hardware');
  await notifyApprovalUsers({
    title: 'Physical scanner upload',
    message: `${doc.trackingNumber} was captured by ${deviceId} and needs intake review.`,
    type: 'warning',
    referenceType: 'document',
    referenceId: doc.id,
    page: 'documents',
  });
  await queueSenderNotifications(req, doc, 'document_scanned', {
    message: `Your document was captured by the physical scanner and registered with tracking number ${doc.trackingNumber}.`,
    metadata: { deviceId },
  });

  const deviceSnapshot = await getDeviceSnapshot(deviceId);
  if (req.body.commandId) {
    const updatedCommand = await Command.findOne({ id: req.body.commandId }).lean();
    if (updatedCommand) {
      broadcastCommandUpdated(updatedCommand, doc.toObject?.() || doc);
    }
  }
  broadcastDeviceUpdated(deviceSnapshot);
  broadcastDataInvalidate(['documents', 'notifications', 'senderNotifications', 'logs', 'device']);

  res.status(201).json({ documentId: doc.id, document: doc, device: deviceSnapshot });
}));

// ─── ADMIN / USER FRONTEND ENDPOINTS ───────────────────────────────────────────
router.use(protect);

router.get('/device', allRoles, asyncHandler(async (req, res) => {
  const device = await getDeviceSnapshot(req.query.deviceId || 'DEV-001');
  res.json(device);
}));

router.put('/device', adminOnly, asyncHandler(async (req, res) => {
  if (req.body.status || req.body.lastActive) {
    return res.status(400).json({ message: 'Device connection status is controlled by hardware connect and heartbeat events.' });
  }

  const device = await Device.findOneAndUpdate(
    { id: req.body.id || 'DEV-001' },
    { ...req.body, id: req.body.id || 'DEV-001', name: req.body.name || 'Physical Document Scanner', status: 'Offline' },
    { ...updateOptions, upsert: true }
  );

  await createLogEntry(req, 'device_config_updated', `Updated scanner configuration for ${device.id}`, device.id);
  res.json(await getDeviceSnapshot(device.id));
}));

router.get('/device/bridge/status', allRoles, asyncHandler(async (req, res) => {
  const deviceId = req.query.deviceId || 'DEV-001';
  const device = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available. Wait for a heartbeat or enter the Pi bridge URL.' });
  }

  try {
    const response = await fetchBridgeEndpoint(bridgeUrl, '/status', { method: 'GET' });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Bridge status responded with ${response.status}: ${text}`);
    }

    let status = null;
    try {
      status = text ? JSON.parse(text) : {};
    } catch {
      status = { raw: text };
    }

    res.json({ ok: true, bridgeUrl, status, device: await getDeviceSnapshot(deviceId) });
  } catch (err) {
    res.json({
      ok: false,
      bridgeUrl,
      device,
      message: device.connected
        ? 'Backend is receiving scanner heartbeats, but the bridge status endpoint did not answer. Check the Pi bridge service or firewall.'
        : 'Scanner bridge status endpoint did not answer and no fresh heartbeat is available.',
      errorMessage: err.message,
    });
  }
}));

router.get('/device/bridge/snapshot', allRoles, asyncHandler(async (req, res) => {
  const deviceId = req.query.deviceId || 'DEV-001';
  const device = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available. Wait for a heartbeat or enter the Pi bridge URL.' });
  }

  let response;
  try {
    response = await fetchBridgeEndpoint(bridgeUrl, '/snapshot.jpg', {
      method: 'GET',
      headers: { Accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.5' },
    });
  } catch (err) {
    return res.status(502).json({ message: `Scanner preview is not reachable through ${bridgeUrl}: ${err.message}` });
  }

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    let cleanDetails = cleanBridgeErrorText(details);
    try {
      const statusResponse = await fetchBridgeEndpoint(bridgeUrl, '/status', { method: 'GET' });
      const statusText = await statusResponse.text();
      const status = statusText ? JSON.parse(statusText) : {};
      if (!status.bridgeVersion) {
        cleanDetails = `${cleanDetails} The scanner bridge is running an older script. Redeploy/restart pi_scanner_bridge.py so preview fallback backends are available.`;
      }
      if (status.backendBaseUrl?.includes('127.0.0.1')) {
        cleanDetails = `${cleanDetails} The bridge is configured with backendBaseUrl=${status.backendBaseUrl}; on a real Pi this must be http://YOUR_BACKEND_COMPUTER_IP:5000/api.`;
      }
      if (/windows/i.test(status.platform || '')) {
        cleanDetails = `${cleanDetails} The active bridge is running on Windows (${status.platform}), not on a Raspberry Pi camera host.`;
      }
    } catch {
      // Keep the original preview error when status diagnostics are unavailable.
    }
    return res.status(502).json({ message: `Scanner preview is not ready (${response.status}). ${cleanDetails}`.trim() });
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return res.status(502).json({ message: `Scanner preview returned ${contentType}, not an image.` });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    return res.status(502).json({ message: 'Scanner preview returned an empty image.' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(bytes);
}));

router.post('/device/bridge/connect', scannerCommandRoles, asyncHandler(async (req, res) => {
  const deviceId = req.body.deviceId || 'DEV-001';
  const device = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available. Wait for a heartbeat or enter the Pi bridge URL.' });
  }

  try {
    const response = await fetchBridgeEndpoint(bridgeUrl, '/connect', { method: 'POST' });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Bridge connect responded with ${response.status}: ${text}`);
    }

    let bridge = null;
    try {
      bridge = text ? JSON.parse(text) : {};
    } catch {
      bridge = { raw: text };
    }

    await createLogEntry(req, 'device_bridge_connect', `Triggered scanner bridge connect at ${bridgeUrl}`, deviceId);
    res.json({ ok: true, bridgeUrl, bridge, device: await getDeviceSnapshot(deviceId) });
  } catch (err) {
    const latestDevice = await getDeviceSnapshot(deviceId);
    res.json({
      ok: Boolean(latestDevice.connected),
      bridgeReachable: false,
      bridgeUrl,
      device: latestDevice,
      message: latestDevice.connected
        ? 'Backend is already receiving scanner heartbeats. The manual bridge control endpoint did not answer, but the device is connected.'
        : 'Unable to reach the scanner bridge control endpoint.',
      errorMessage: err.message,
    });
  }
}));

router.post('/device/bridge/disconnect', scannerCommandRoles, asyncHandler(async (req, res) => {
  const deviceId = req.body.deviceId || 'DEV-001';
  const device = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available. Wait for a heartbeat or enter the Pi bridge URL.' });
  }

  try {
    const response = await fetchBridgeEndpoint(bridgeUrl, '/disconnect', { method: 'POST' });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Bridge disconnect responded with ${response.status}: ${text}`);
    }

    let bridge = null;
    try {
      bridge = text ? JSON.parse(text) : {};
    } catch {
      bridge = { raw: text };
    }

    await createLogEntry(req, 'device_bridge_disconnect', `Triggered scanner bridge disconnect at ${bridgeUrl}`, deviceId);
    res.json({ ok: true, bridgeUrl, bridge, device: await getDeviceSnapshot(deviceId) });
  } catch (err) {
    const latestDevice = await getDeviceSnapshot(deviceId);
    res.json({
      ok: false,
      bridgeUrl,
      device: latestDevice,
      message: latestDevice.connected
        ? 'Backend still sees scanner heartbeats. Stop the Pi bridge service if you need it fully offline.'
        : 'Scanner is already offline, and the bridge control endpoint did not answer.',
      errorMessage: err.message,
    });
  }
}));

// ─── COMMANDS ──────────────────────────────────────────────────────────────
router.get('/commands/:id/status', allRoles, asyncHandler(async (req, res) => {
  const command = await Command.findOne({ id: req.params.id }).lean();
  if (!command) return res.status(404).json({ message: 'Command not found' });
  if (!isGlobalRole(req) && command.requestedBy !== req.user.id) {
    return res.status(403).json({ message: 'This command is not visible to your account' });
  }

  let resultDocument = null;
  if (command.resultDocumentId) {
    resultDocument = await Document.findOne({
      id: command.resultDocumentId,
    }).lean();
  }

  res.json({ ...command, resultDocument });
}));

router.post('/commands', scannerCommandRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['deviceId', 'command']);
  const commandName = req.body.command?.trim().toUpperCase();
  if (!['SCAN', 'RESTART', 'SHUTDOWN'].includes(commandName)) {
    return res.status(400).json({ message: 'Invalid device command' });
  }
  if (req.user.role !== 'Admin' && commandName !== 'SCAN') {
    return res.status(403).json({ message: 'Receptionists can only request scan commands' });
  }

  const snapshot = await getDeviceSnapshot(req.body.deviceId);
  if (!snapshot.connected) {
    return res.status(409).json({ message: 'Physical scanner is not connected. Wait for a hardware heartbeat before sending commands.' });
  }

  const staleCommandCutoff = new Date(Date.now() - scannerCommandStaleMs).toISOString();
  await Command.updateMany(
    {
      deviceId: req.body.deviceId,
      status: { $in: ['Pending', 'Executing'] },
      createdAt: { $lt: staleCommandCutoff },
    },
    {
      $set: {
        status: 'Cancelled',
        errorMessage: 'Cancelled stale scanner command before starting a new scan.',
        executedAt: new Date().toISOString(),
      },
    },
  );

  const pendingCommand = await Command.findOne({
    deviceId: req.body.deviceId,
    status: { $in: ['Pending', 'Executing'] },
  }).lean();
  if (pendingCommand) {
    return res.status(409).json({ message: 'The scanner already has a pending command.' });
  }

  const command = new Command({
    id: req.body.id || generateId('CMD'),
    deviceId: req.body.deviceId,
    command: commandName,
    status: 'Pending',
    payload: req.body.payload,
    requestedBy: req.user.id,
    createdAt: new Date().toISOString(),
  });
  await command.save();

  await createLogEntry(req, 'device_command_created', `Queued ${command.command} command for ${command.deviceId}`, command.id);
  const commandPayload = command.toObject?.() || command;
  broadcastCommandUpdated(commandPayload);
  pushCommandToDevice(command.deviceId, commandPayload);
  res.status(201).json(command);
}));

// ─── DEVICE EVENTS ─────────────────────────────────────────────────────────────
router.get('/device-events', allRoles, asyncHandler(async (req, res) => {
  const query = isGlobalRole(req) ? {} : {
    $or: [
      { officeId: req.user.officeId },
      { recordedBy: req.user.id },
    ],
  };
  const events = await DeviceEvent.find(query).sort({ timestamp: -1, _id: -1 }).limit(100).lean();
  res.json(events);
}));

router.post('/device-events', adminOnly, asyncHandler(async (req, res) => {
  requireFields(req.body, ['deviceId', 'eventType']);

  const event = new DeviceEvent({
    ...req.body,
    id: req.body.id || generateId('EVT'),
    officeId: req.body.officeId || getUserOfficeId(req),
    recordedBy: req.user.id,
    timestamp: req.body.timestamp || new Date().toISOString(),
  });
  await event.save();

  if (event.eventType === 'rfid_detected' && event.documentId) {
    const detectedDoc = await Document.findOne({ id: event.documentId }).lean();
    await appendDocumentTimeline(
      event.documentId,
      createTimelineEvent(
        req,
        'rfid_detected',
        'RFID location detected',
        `RFID tag ${event.rfidTag || 'unknown'} detected at ${event.officeId || 'scanner node'}`,
        event.officeId,
        event.id,
      ),
      {
        ...(event.rfidTag ? { rfidTag: event.rfidTag } : {}),
        ...(event.officeId ? { lastDetectedOfficeId: event.officeId, lastDetectedAt: event.timestamp } : {}),
        ...(event.officeId && detectedDoc?.status !== 'Archived' ? { currentOfficeId: event.officeId } : {}),
      },
    );
  }

  await createLogEntry(req, 'device_event', `Device event: ${event.eventType}`, event.id);
  res.status(201).json(event);
}));

module.exports = router;
