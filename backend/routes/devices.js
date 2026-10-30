const express = require('express');
const { validateSmsPreferences } = require('../utils/sms');
const router = express.Router();
const { Device, DeviceEvent, Command, Document } = require('../models');
const { protect, allowRoles } = require('../middleware/auth');
const { deviceLimiter, streamFrameLimiter } = require('../utils/rateLimit');
const { requireDeviceApiKey, getBridgeBaseUrl, fetchBridgeEndpoint, cleanBridgeErrorText, normalizeBridgeBaseUrl, isPrivateBridgeHost } = require('../utils/bridge');
const { toUserFacingError } = require('../utils/userFacingError');
const { withDeviceCommandLock } = require('../utils/transactionContext');
const {
  asyncHandler,
  requireFields,
  createLogEntry,
  generateId,
  generateTrackingNumber,
  notifyApprovalUsers,
  appendDocumentTimeline,
  createTimelineEvent,
  normalizeWorkflowStatus,
  isGlobalRole,
  getUserOfficeId,
} = require('../utils/helpers');
const {
  maxAttachmentsPerDocument,
  persistAttachments,
  buildScanPdfAttachment,
  getScannerPages,
  isScannerPdf,
  removeOrphanedAttachments,
} = require('../utils/attachments');
const {
  getDeviceSnapshot,
  recordHardwareDeviceEvent,
  applyHardwareEvent,
  hardwarePresenceEvents,
} = require('../services/devicePresence');
const {
  broadcastDeviceUpdated,
  broadcastCommandUpdated,
  broadcastDataInvalidate,
  pushCommandToDevice,
  getLatestStreamFrame,
  relayStreamFrame,
  isDeviceWsConnected,
} = require('../utils/realtime');

const adminOnly = allowRoles('Admin');
const allRoles = allowRoles('Admin', 'Mayor', 'Receptionist');
const scannerCommandRoles = allowRoles('Admin', 'Receptionist');
const updateOptions = { new: true, runValidators: true };

const scannerCommandStaleMs = Number(process.env.SCANNER_COMMAND_STALE_MS || 60000);
// The Pi marks commands Executing right after it receives them, so a Pending one this old never arrived.
const scannerCommandUnackedMs = Number(process.env.SCANNER_COMMAND_UNACKED_MS || 30000);
const motorTestStaleMs = Number(process.env.MOTOR_TEST_STALE_MS || 90000);
const bridgeSnapshotWsFallbackMaxAgeMs = Number(process.env.BRIDGE_SNAPSHOT_WS_FALLBACK_MAX_AGE_MS || 60000);

const deviceUsesWsJpegStream = (device) => (
  device?.payload?.streamMode === 'jpeg-ws'
  || device?.payload?.bridgeVersion === 'ws-jpeg-1.0'
  || Boolean(device?.streamWsConnected)
);

const registrationStatuses = ['Received', 'For Signing', 'For Filing'];

// ─── HARDWARE / IOT ENDPOINTS ──────────────────────────────────────────────────
router.post('/devices/connect', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const result = await recordHardwareDeviceEvent(req, 'device_connected');
  broadcastDeviceUpdated(result.device);
  res.status(201).json(result);
}));

router.post('/devices/heartbeat', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  // Lightweight when WS is already alive — avoids Mongo write storms from dual keepalive.
  // Full persist when WS is down so heartbeatFresh keeps the device Online.
  const result = await applyHardwareEvent(
    req.body,
    'device_heartbeat',
    { deviceId: req.body.deviceId || req.body.id, ip: req.ip },
    { lightweight: true },
  );
  if (result?.device) {
    broadcastDeviceUpdated(result.device);
  }
  // Backup delivery for commands queued while the Pi's WebSocket was down.
  const heartbeatDeviceId = req.body.deviceId || req.body.id || 'DEV-001';
  const pendingCommands = await Command.find({ deviceId: heartbeatDeviceId, status: 'Pending' })
    .sort({ createdAt: 1 })
    .limit(5)
    .lean();
  // Lets the Pi detect a half-open WS (e.g. backend restarted behind a tunnel) and reconnect.
  const wsLive = isDeviceWsConnected(heartbeatDeviceId);
  res.status(201).json({ ...result, pendingCommands, wsLive });
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
      errorMessage: toUserFacingError(req.body.errorMessage?.trim(), 'Scan could not be completed. Please try again.'),
      executedAt: status === 'Executed' || status === 'Failed' || status === 'Cancelled'
        ? new Date().toISOString()
        : undefined,
    },
    { ...updateOptions, validate: current => {
      if (status === current.status) return false;
      const allowed = { Pending: ['Executing', 'Executed', 'Failed', 'Cancelled'], Executing: ['Executed', 'Failed', 'Cancelled'] };
      if (status !== current.status && !(allowed[current.status] || []).includes(status)) {
        const error = new Error('This command is no longer active. Preserve its recorded outcome.'); error.status = 409; throw error;
      }
    } },
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
  validateSmsPreferences(req.body);
  const now = new Date().toISOString();
  const deviceId = req.body.deviceId?.trim() || 'DEV-001';
  const command = req.body.commandId ? await Command.findOne({ id: req.body.commandId }).lean() : null;
  const device = await Device.findOne({ id: deviceId }).lean();
  const officeId = req.body.officeId?.trim() || command?.payload?.officeId || device?.assignedTo || 'OFF-001';
  const continuationDocumentId = req.body.documentId?.trim();
  let existingDocument = null;
  if (continuationDocumentId) {
    if (
      !command
      || command.command !== 'SCAN'
      || command.deviceId !== deviceId
      || command.payload?.documentId !== continuationDocumentId
    ) {
      return res.status(403).json({ message: 'This scan command cannot add a page to that document.' });
    }
    existingDocument = await Document.findOne({ id: continuationDocumentId });
    if (!existingDocument) {
      return res.status(404).json({ message: 'Document for this scan session was not found.' });
    }
    if (existingDocument.intakeStatus !== 'Pending Review') {
      return res.status(409).json({ message: 'This document scan session is no longer open for additional pages.' });
    }
  }
  const attachmentSource = req.body.attachment || req.body.scannedFile;
  if (!attachmentSource?.dataUrl && !attachmentSource?.url) {
    return res.status(400).json({ message: 'A scanned page image is required.' });
  }
  const existingScanPages = getScannerPages(existingDocument?.scannedFiles || []);
  if (existingDocument && existingScanPages.length >= maxAttachmentsPerDocument) {
    return res.status(400).json({ message: `A document can have at most ${maxAttachmentsPerDocument} scanned pages.` });
  }
  const newScanPages = attachmentSource
    ? await persistAttachments(req, [{
        id: attachmentSource.id || (command?.id ? `SCANPAGE_${command.id}` : undefined),
        name: attachmentSource.name || `${deviceId}-scan.jpg`,
        type: attachmentSource.type || 'image/jpeg',
        size: attachmentSource.size,
        dataUrl: attachmentSource.dataUrl,
        uploadedAt: now,
        uploadedBy: 'hardware',
        source: 'scanner',
      }])
    : [];

  const trackingNumber = existingDocument?.trackingNumber || req.body.trackingNumber || generateTrackingNumber();
  const existingPageIds = new Set(existingScanPages.map((page) => page.id).filter(Boolean));
  const scanPages = [
    ...existingScanPages,
    ...newScanPages.filter((page) => !page.id || !existingPageIds.has(page.id)),
  ];
  const previousScanFiles = (existingDocument?.scannedFiles || []).filter((file) => (
    isScannerPdf(file) || getScannerPages([file]).length
  ));
  const otherFiles = (existingDocument?.scannedFiles || []).filter((file) => !previousScanFiles.includes(file));
  let scanPdf = null;
  try {
    scanPdf = await buildScanPdfAttachment(req, scanPages, { baseName: trackingNumber, uploadedAt: now });
  } catch (err) {
    console.warn(`Unable to build scan PDF for ${trackingNumber}:`, err.message);
  }
  const scannedFiles = scanPdf ? [scanPdf, ...otherFiles] : [...otherFiles, ...scanPages];

  const subject = req.body.extractedTitle?.trim()
    || (typeof req.body.subject === 'string' ? req.body.subject.trim() : '')
    || 'Scanned Document';
  const requestedScanStatus = req.body.status || command?.payload?.status;
  const registrationStatus = registrationStatuses.includes(normalizeWorkflowStatus(requestedScanStatus))
    ? normalizeWorkflowStatus(requestedScanStatus)
    : 'Received';
  let doc = existingDocument;
  if (doc) {
    doc.scannedFiles = scannedFiles;
    doc.scannedImageUrl = scannedFiles[0]?.url || scannedFiles[0]?.dataUrl || '';
    doc.updatedAt = now;
    await doc.save();
    if (scanPdf) await removeOrphanedAttachments(previousScanFiles, scannedFiles);
  } else {
    doc = new Document({
      id: req.body.documentId || generateId('DOC'),
      trackingNumber,
      subject,
      documentDirection: req.body.documentDirection || 'Incoming',
      status: registrationStatus,
      intakeStatus: 'Pending Review',
      priorityLevel: req.body.priorityLevel || 'normal',
      dateReceived: req.body.dateReceived || req.body.extractedDate?.trim() || now.split('T')[0],
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
      senderNotificationChannels: Array.isArray(req.body.senderNotificationChannels) ? req.body.senderNotificationChannels : [],
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
  }

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
    const commandSet = {
      status: 'Executed',
      resultDocumentId: doc.id,
      executedAt: now,
    };
    if (req.body.aiExtractPending) {
      commandSet['payload.aiExtractPending'] = true;
    }
    await Command.findOneAndUpdate(
      { id: req.body.commandId },
      { $set: commandSet },
      updateOptions,
    );
  }

  if (!existingDocument) {
    await createLogEntry(req, 'document_scanned', `Physical scanner uploaded document: ${doc.subject}`, doc.id, 'hardware');
    await notifyApprovalUsers({
      title: 'Physical scanner upload',
      message: `${doc.trackingNumber} was captured by ${deviceId} and needs intake review.`,
      type: 'warning',
      referenceType: 'document',
      referenceId: doc.id,
      page: 'documents',
    });
  } else {
    await createLogEntry(req, 'document_scan_page_added', `Added a scanned page to document ${doc.subject}`, doc.id, 'hardware');
  }

  const deviceSnapshot = await getDeviceSnapshot(deviceId);
  if (req.body.commandId) {
    const updatedCommand = await Command.findOne({ id: req.body.commandId }).lean();
    if (updatedCommand) {
      broadcastCommandUpdated(updatedCommand, doc.toObject?.() || doc);
    }
  }
  broadcastDeviceUpdated(deviceSnapshot);
  broadcastDataInvalidate(['documents', 'notifications', 'logs', 'device']);

  res.status(201).json({ documentId: doc.id, document: doc, device: deviceSnapshot });
}));

// Enrich an already-uploaded scan with AI-extracted fields (runs after the Pi
// has uploaded the image, so the dashboard can proceed instantly then refresh).
router.put('/devices/scans/:documentId', deviceLimiter, requireDeviceApiKey, asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ id: req.params.documentId });
  if (!doc) return res.status(404).json({ message: 'Document not found' });

  // Title and fields come from the first page only; added pages never overwrite them.
  if (req.body.commandId) {
    const sourceCommand = await Command.findOne({ id: req.body.commandId }).lean();
    if (sourceCommand?.payload?.documentId) {
      return res.json({ documentId: doc.id, document: doc.toObject?.() || doc, skipped: 'not-first-page' });
    }
  }

  const now = new Date().toISOString();
  const set = { updatedAt: now };

  const aiTitle = req.body.extractedTitle?.trim() || req.body.subject?.trim();
  if (aiTitle && !/^scanned document$/i.test(aiTitle) && !/^untitled document$/i.test(aiTitle)) {
    set.subject = aiTitle;
  }

  const aiText = req.body.scannedText || req.body.extractedText;
  if (aiText && String(aiText).trim()) set.scannedText = String(aiText).trim();

  const aiSender = req.body.extractedSender?.trim();
  if (aiSender && aiSender.toLowerCase() !== 'scanner device') set.senderName = aiSender;

  // Apply extracted date if provided (AI often reads this more reliably than OCR regex).
  const aiDate = req.body.extractedDate?.trim();
  if (aiDate) set.dateReceived = aiDate;

  // Apply document type if the Pi mapped it to a known type ID.
  const aiDocTypeId = req.body.documentTypeId?.trim();
  if (aiDocTypeId) set.documentTypeId = aiDocTypeId;

  const updated = await Document.findOneAndUpdate(
    { id: req.params.documentId },
    { $set: set },
    updateOptions,
  );

  await createLogEntry(req, 'document_ai_enriched', `AI enriched scanned document: ${updated.subject}`, updated.id, 'hardware');

  const resultDoc = updated.toObject?.() || updated;
  if (req.body.commandId) {
    const command = await Command.findOne({ id: req.body.commandId }).lean();
    if (command) broadcastCommandUpdated(command, resultDoc);
  }
  broadcastDataInvalidate(['documents']);

  res.json({ documentId: updated.id, document: resultDoc });
}));

// Pi uploads preview JPEG over HTTPS when dev-tunnel binary WS is unreliable.
router.post(
  '/devices/stream/frame',
  requireDeviceApiKey,
  (req, res, next) => {
    const deviceId = String(req.query.deviceId || 'DEV-001').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) return res.status(400).json({ message: 'Invalid device identifier' });
    req.streamDeviceId = deviceId;
    next();
  },
  streamFrameLimiter,
  asyncHandler(async (req, res) => {
    const deviceId = req.streamDeviceId;
    const frame = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!frame.length || frame.length < 64) {
      return res.status(400).json({ message: 'Empty preview frame' });
    }
    if (frame[0] !== 0xff || frame[1] !== 0xd8) {
      return res.status(400).json({ message: 'Preview frame must be JPEG' });
    }
    relayStreamFrame(deviceId, frame);
    res.json({ ok: true, bytes: frame.length });
  }),
);

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

  const deviceId = req.body.id || 'DEV-001';
  const updates = {
    name: req.body.name || 'Physical Document Scanner',
    model: req.body.model,
    type: req.body.type,
    ip: req.body.ip,
    bridgeUrl: req.body.bridgeUrl,
    location: req.body.location,
    firmware: req.body.firmware,
    serialNumber: req.body.serialNumber,
    resolution: req.body.resolution,
    assignedTo: req.body.assignedTo,
  };

  Object.keys(updates).forEach((key) => {
    if (updates[key] === undefined) delete updates[key];
  });

  const device = await Device.findOneAndUpdate(
    { id: deviceId },
    { $set: { ...updates, id: deviceId } },
    { ...updateOptions, upsert: true }
  );

  await createLogEntry(req, 'device_config_updated', `Updated scanner configuration for ${device.id}`, device.id);
  const snapshot = await getDeviceSnapshot(device.id);
  broadcastDeviceUpdated(snapshot);
  res.json(snapshot);
}));

router.get('/device/bridge/probe', allRoles, asyncHandler(async (req, res) => {
  const deviceId = req.query.deviceId || 'DEV-001';
  const registeredDevice = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, registeredDevice);
  if (!bridgeUrl) {
    return res.status(400).json({ ok: false, message: 'A valid private LAN bridgeUrl is required.' });
  }

  let hostname = '';
  try {
    hostname = new URL(bridgeUrl).hostname;
  } catch {
    return res.status(400).json({ ok: false, message: 'Invalid bridgeUrl format.' });
  }

  if (!isPrivateBridgeHost(hostname)) {
    return res.status(400).json({ ok: false, message: 'bridgeUrl must be a private LAN address.' });
  }

  try {
    const response = await fetchBridgeEndpoint(bridgeUrl, '/status', { method: 'GET' });
    const text = await response.text();
    if (!response.ok) {
      return res.json({
        ok: false,
        bridgeUrl,
        message: `Bridge probe failed with HTTP ${response.status}`,
        errorMessage: cleanBridgeErrorText(text),
      });
    }

    let status = null;
    try {
      status = text ? JSON.parse(text) : {};
    } catch {
      status = { raw: text };
    }

    const resolvedBridgeUrl = normalizeBridgeBaseUrl(status?.bridgeUrl) || bridgeUrl;
    res.json({
      ok: true,
      bridgeUrl,
      resolvedBridgeUrl,
      status,
      mjpegEnabled: Boolean(status?.mjpegEnabled),
      device: await getDeviceSnapshot(deviceId),
    });
  } catch (err) {
    res.json({
      ok: false,
      bridgeUrl,
      message: 'Bridge probe could not reach the Pi scanner on LAN.',
      errorMessage: err.message,
    });
  }
}));

router.get('/device/bridge/status', allRoles, asyncHandler(async (req, res) => {
  const deviceId = req.query.deviceId || 'DEV-001';
  const device = await getDeviceSnapshot(deviceId);
  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available yet. Wait for the Pi to send a heartbeat.' });
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

  const getWsFallbackState = () => {
    const cached = getLatestStreamFrame(deviceId);
    if (!cached?.frame?.length) return { ok: false, reason: 'no_cached_ws_frame', ageMs: null };
    const ageMs = Date.now() - cached.at;
    if (bridgeSnapshotWsFallbackMaxAgeMs > 0 && ageMs > bridgeSnapshotWsFallbackMaxAgeMs) {
      return { ok: false, reason: 'stale_cached_ws_frame', ageMs };
    }
    return { ok: true, reason: 'ok', ageMs, frame: cached.frame };
  };

  const sendWsSnapshotFallback = (reason = '') => {
    const state = getWsFallbackState();
    if (!state.ok) return false;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Scanner-Snapshot-Source', reason ? `ws-fallback:${reason}` : 'ws-fallback');
    res.setHeader('X-Scanner-Snapshot-Age-Ms', String(state.ageMs || 0));
    res.send(state.frame);
    return true;
  };

  // Pi WS scanner has no HTTP bridge — never block on unreachable LAN :8080.
  if (deviceUsesWsJpegStream(device)) {
    if (sendWsSnapshotFallback('ws-primary')) {
      return;
    }
    const wsState = getWsFallbackState();
    return res.status(503).json({
      message: 'Camera preview buffer is empty. Wait for Pi stream frames.',
      reason: wsState.reason,
      ageMs: wsState.ageMs,
      deviceStreamWsConnected: Boolean(device?.streamWsConnected),
    });
  }

  const bridgeUrl = getBridgeBaseUrl(req, device);
  if (!bridgeUrl) {
    return res.status(400).json({ message: 'Scanner bridge URL is not available yet. Wait for the Pi to send a heartbeat.' });
  }

  let response;
  try {
    response = await fetchBridgeEndpoint(bridgeUrl, '/snapshot.jpg', {
      method: 'GET',
      headers: { Accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.5' },
    });
  } catch (err) {
    const wsState = getWsFallbackState();
    if (sendWsSnapshotFallback('bridge-unreachable')) return;
    return res.status(502).json({
      message: `Scanner preview is not reachable through ${bridgeUrl}: ${err.message}`,
      wsFallback: {
        available: wsState.ok,
        reason: wsState.reason,
        ageMs: wsState.ageMs,
        deviceStreamWsConnected: Boolean(device?.streamWsConnected),
      },
    });
  }

  if (!response.ok) {
    const wsState = getWsFallbackState();
    if (sendWsSnapshotFallback(`bridge-${response.status}`)) return;
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
    return res.status(502).json({
      message: `Scanner preview is not ready (${response.status}). ${cleanDetails}`.trim(),
      wsFallback: {
        available: wsState.ok,
        reason: wsState.reason,
        ageMs: wsState.ageMs,
        deviceStreamWsConnected: Boolean(device?.streamWsConnected),
      },
    });
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
    return res.status(400).json({ message: 'Scanner bridge URL is not available yet. Wait for the Pi to send a heartbeat.' });
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
    return res.status(400).json({ message: 'Scanner bridge URL is not available yet. Wait for the Pi to send a heartbeat.' });
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

  res.json({
    ...command,
    errorMessage: command.errorMessage
      ? toUserFacingError(command.errorMessage, 'Scan could not be completed. Please try again.')
      : command.errorMessage,
    resultDocument,
  });
}));

router.post('/commands/cancel', scannerCommandRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['deviceId']);
  if (typeof req.body.deviceId !== 'string') return res.status(400).json({ message: 'Invalid device ID.' });
  const deviceId = req.body.deviceId.trim();
  const reason = typeof req.body.reason === 'string' && req.body.reason.trim() || 'Cancelled by dashboard user.';
  const executedAt = new Date().toISOString(), deferred = [];
  const count = await withDeviceCommandLock(deviceId, async () => {
    const pending = await Command.find({ deviceId, status: { $in: ['Pending', 'Executing'] } }).forUpdate().lean();
    if (!pending.length) return 0;
    await Command.updateMany({ id: { $in: pending.map(command => command.id) } }, { $set: { status: 'Cancelled', errorMessage: reason, executedAt } });
    for (const command of pending) {
      await createLogEntry(req, 'device_command_cancelled', `Cancelled ${command.command} command for ${deviceId}`, command.id);
      deferred.push(() => broadcastCommandUpdated({ ...command, status: 'Cancelled', errorMessage: reason, executedAt }));
    }
    return pending.length;
  });
  for (const effect of deferred) effect();
  res.json({ ok: true, cancelled: count });
}));

router.post('/commands', scannerCommandRoles, asyncHandler(async (req, res) => {
  requireFields(req.body, ['deviceId', 'command']);
  if (typeof req.body.deviceId !== 'string' || typeof req.body.command !== 'string') return res.status(400).json({ message: 'Invalid command request.' });
  const deferred = [];
  let outcome;
  const respond = (status, body) => { outcome = { status, body }; };
  await withDeviceCommandLock(req.body.deviceId, async () => {
    const commandName = req.body.command?.trim().toUpperCase();
    if (!['SCAN', 'SORT', 'MOTOR_TEST', 'CAMERA_LIGHT', 'RESTART', 'SHUTDOWN'].includes(commandName)) {
      return respond(400, { message: 'Invalid device command' });
    }
    if (req.user.role !== 'Admin' && !['SCAN', 'SORT', 'MOTOR_TEST', 'CAMERA_LIGHT'].includes(commandName)) {
      return respond(403, { message: 'Receptionists can only request scan/sort/motor test/camera light commands' });
    }

    const snapshot = await getDeviceSnapshot(req.body.deviceId);
    if (!snapshot.connected) {
      return respond(409, { message: 'Physical scanner is not connected. Wait for a hardware heartbeat before sending commands.' });
    }

    // Instant camera setting: never queue behind (or block) a scan/sort.
    if (commandName === 'CAMERA_LIGHT') {
      const lightCommand = new Command({
        id: generateId('CMD'),
        deviceId: req.body.deviceId,
        command: commandName,
        status: 'Pending',
        payload: req.body.payload,
        requestedBy: req.user.id,
        createdAt: new Date().toISOString(),
      });
      await lightCommand.save();
      const lightPayload = lightCommand.toObject?.() || lightCommand;
      deferred.push(() => { broadcastCommandUpdated(lightPayload); const delivered = pushCommandToDevice(lightCommand.deviceId, lightPayload); res.status(201).json({ ...lightPayload, delivered }); });
      return;
    }

    const cutoff = (ms) => new Date(Date.now() - ms).toISOString();
    const staleFilter = {
      deviceId: req.body.deviceId,
      $or: [
        { status: { $in: ['Pending', 'Executing'] }, createdAt: { $lt: cutoff(scannerCommandStaleMs) } },
        { status: 'Pending', createdAt: { $lt: cutoff(scannerCommandUnackedMs) } },
        { command: 'MOTOR_TEST', status: { $in: ['Pending', 'Executing'] }, createdAt: { $lt: cutoff(motorTestStaleMs) } },
      ],
    };
    if (commandName === 'MOTOR_TEST') {
      // Test Motors is a diagnostic — it must not be blocked by a stuck scan/command.
      // Only a SORT that is actually moving the motors (or another motor test) is kept.
      staleFilter.$or.push({
        status: { $in: ['Pending', 'Executing'] },
        command: { $ne: 'MOTOR_TEST' },
        $nor: [{ command: 'SORT', status: 'Executing' }],
      });
    }
    const staleCommands = await Command.find(staleFilter).forUpdate().lean();
    if (staleCommands.length) {
      const executedAt = new Date().toISOString();
      const errorMessage = 'Cancelled stale scanner command before starting a new one.';
      await Command.updateMany(
        { id: { $in: staleCommands.map((c) => c.id) } },
        { $set: { status: 'Cancelled', errorMessage, executedAt } },
      );
      for (const stale of staleCommands) {
        deferred.push(() => broadcastCommandUpdated({ ...stale, status: 'Cancelled', errorMessage, executedAt }));
      }
    }

    const pendingCommand = await Command.findOne({
      deviceId: req.body.deviceId,
      status: { $in: ['Pending', 'Executing'] },
      command: { $ne: 'CAMERA_LIGHT' },
    }).lean();
    if (pendingCommand) {
      if (commandName === 'MOTOR_TEST' && pendingCommand.command === 'MOTOR_TEST') {
        return respond(200, pendingCommand);
      }
      return respond(409, {
        message: `The scanner already has a pending ${pendingCommand.command} command.`,
        pendingCommand: { id: pendingCommand.id, command: pendingCommand.command, status: pendingCommand.status },
      });
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
    deferred.push(() => { broadcastCommandUpdated(commandPayload); const delivered = pushCommandToDevice(command.deviceId, commandPayload); res.status(201).json({ ...commandPayload, delivered }); });
  });
  for (const effect of deferred) await effect();
  if (outcome) res.status(outcome.status).json(outcome.body);
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
