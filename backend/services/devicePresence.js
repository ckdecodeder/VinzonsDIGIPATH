const { Device, DeviceEvent, Command, Document } = require('../models');
const {
  createLogEntry,
  generateId,
  appendDocumentTimeline,
  createTimelineEvent,
} = require('../utils/helpers');
const { isDeviceWsConnected, broadcastDataInvalidate } = require('../utils/realtime');

const deviceHeartbeatTimeoutMs = Number(process.env.DEVICE_HEARTBEAT_TIMEOUT_MS || 90000);
const heartbeatPersistMs = Number(process.env.DEVICE_HEARTBEAT_PERSIST_MS || 45000);
const scannerBridgePort = String(process.env.SCANNER_BRIDGE_PORT || '8080');
const lastHeartbeatPersistAt = new Map();

const resolveBridgeUrl = (device, latestHardwareEvent) => {
  const eventPayload = latestHardwareEvent?.payload || {};
  const reportedBridge = eventPayload.bridgeUrl || device?.bridgeUrl;
  if (reportedBridge) return reportedBridge;

  const ip = (eventPayload.ip && eventPayload.ip !== 'Not reported')
    ? eventPayload.ip
    : (device?.ip && device.ip !== 'Not reported' ? device.ip : null);
  if (ip) return `http://${ip}:${scannerBridgePort}`;

  return null;
};

const hardwarePresenceEvents = [
  'device_connected',
  'device_disconnected',
  'device_heartbeat',
  'scan_started',
  'scan_completed',
  'rfid_detected',
];

const isFreshHardwareSignal = (event) => {
  if (!event?.timestamp) return false;
  const timestamp = new Date(event.timestamp).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= deviceHeartbeatTimeoutMs;
};

const getDeviceSnapshot = async (deviceId = 'DEV-001') => {
  const device = await Device.findOne({ id: deviceId }).lean();
  const latestHardwareEvent = await DeviceEvent.findOne({
    deviceId,
    recordedBy: 'hardware',
    eventType: { $in: hardwarePresenceEvents },
  }).sort({ timestamp: -1, _id: -1 }).lean();

  const hardwareScanCount = await DeviceEvent.countDocuments({
    deviceId,
    recordedBy: 'hardware',
    eventType: 'scan_completed',
  });

  const hasHardwareSignal = Boolean(latestHardwareEvent);
  const streamWsConnected = isDeviceWsConnected(deviceId);
  const heartbeatFresh = hasHardwareSignal
    && latestHardwareEvent?.eventType !== 'device_disconnected'
    && isFreshHardwareSignal(latestHardwareEvent);
  // Prefer heartbeat freshness over a momentary WS drop so the UI does not
  // flicker Offline while the Pi auto-reconnects (HTTP keepalive still flowing).
  const connected = heartbeatFresh || streamWsConnected;
  const status = connected ? 'Online' : 'Offline';

  if (!device || !hasHardwareSignal) {
    return {
      id: deviceId,
      name: 'No physical scanner connected',
      model: 'Not reported',
      type: 'Scanner',
      status: 'Offline',
      connected: false,
      configured: false,
      connectionState: 'waiting_for_device',
      heartbeatTimeoutMs: deviceHeartbeatTimeoutMs,
      lastActive: null,
      lastSignalAt: null,
      scanCount: 0,
    };
  }

  return {
    ...device,
    status,
    connected,
    configured: true,
    connectionState: connected ? 'connected' : 'stale_or_disconnected',
    streamWsConnected,
    heartbeatTimeoutMs: deviceHeartbeatTimeoutMs,
    lastActive: latestHardwareEvent.timestamp,
    lastSignalAt: latestHardwareEvent.timestamp,
    lastEventType: latestHardwareEvent.eventType,
    payload: latestHardwareEvent.payload,
    streamUrl: latestHardwareEvent.payload?.streamUrl,
    bridgeUrl: resolveBridgeUrl(device, latestHardwareEvent),
    scanCount: hardwareScanCount,
  };
};

const buildHardwareReq = (body, meta = {}) => ({
  body: { ...body, deviceId: body.deviceId || body.id || meta.deviceId || 'DEV-001' },
  ip: meta.ip || body.ip,
  user: null,
  get: () => null,
});

const recordHardwareDeviceEvent = async (req, eventType) => {
  const now = new Date().toISOString();
  const deviceId = req.body.deviceId || req.body.id || 'DEV-001';
  const reportedStatus = ['Online', 'Offline', 'Maintenance'].includes(req.body.status) ? req.body.status : null;
  const status = eventType === 'device_disconnected' || eventType === 'error' ? 'Offline' : (reportedStatus || 'Online');

  const event = new DeviceEvent({
    id: req.body.eventId || generateId('EVT'),
    deviceId,
    eventType,
    documentId: req.body.documentId,
    officeId: req.body.officeId,
    rfidTag: req.body.rfidTag,
    status,
    signalStrength: req.body.signalStrength,
    details: req.body.details || `Hardware reported ${eventType}`,
    payload: {
      ...(req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {}),
      ...(req.body.ip ? { ip: req.body.ip } : {}),
      ...(req.body.bridgeUrl ? { bridgeUrl: req.body.bridgeUrl } : {}),
    },
    recordedBy: 'hardware',
    timestamp: req.body.timestamp || now,
  });
  await event.save();

  if (event.eventType === 'rfid_detected' && event.documentId) {
    const detectedDoc = await Document.findOne({ id: event.documentId }).lean();
    const detectionUpdates = {
      ...(event.rfidTag ? { rfidTag: event.rfidTag } : {}),
      ...(event.officeId ? { lastDetectedOfficeId: event.officeId, lastDetectedAt: event.timestamp } : {}),
      ...(event.officeId && detectedDoc?.status !== 'Archived' ? { currentOfficeId: event.officeId } : {}),
    };

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
      detectionUpdates,
    );
  }

  await Device.findOneAndUpdate(
    { id: deviceId },
    {
      $set: {
        id: deviceId,
        name: req.body.name || req.body.deviceName || 'Physical Document Scanner',
        model: req.body.model,
        type: req.body.type || 'Scanner',
        status,
        ip: req.body.ip || req.ip,
        bridgeUrl: req.body.bridgeUrl || req.body.payload?.bridgeUrl,
        location: req.body.location,
        lastActive: event.timestamp,
        firmware: req.body.firmware,
        serialNumber: req.body.serialNumber,
        resolution: req.body.resolution,
        assignedTo: req.body.assignedTo,
      },
      ...(eventType === 'scan_completed' ? { $inc: { scanCount: 1 } } : {}),
    },
    { upsert: true, runValidators: true, new: true },
  );

  const snapshot = await getDeviceSnapshot(deviceId);
  await createLogEntry(req, 'device_event', `Hardware event: ${eventType}`, event.id, 'hardware');
  broadcastDataInvalidate(['device-events']);

  return { event, device: snapshot };
};

const shouldSkipHeavyHeartbeat = (deviceId) => {
  if (!isDeviceWsConnected(deviceId)) return false;
  const now = Date.now();
  const last = lastHeartbeatPersistAt.get(deviceId) || 0;
  return now - last < heartbeatPersistMs;
};

const applyHardwareEvent = async (body, eventType, meta = {}, options = {}) => {
  const deviceId = body.deviceId || body.id || meta.deviceId || 'DEV-001';

  if (eventType === 'device_heartbeat' && options.lightweight && shouldSkipHeavyHeartbeat(deviceId)) {
    const snapshot = await getDeviceSnapshot(deviceId);
    if (!snapshot?.configured) {
      return { skipped: true, device: null };
    }
    const incomingPayload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    return {
      skipped: true,
      device: {
        ...snapshot,
        payload: {
          ...(snapshot.payload || {}),
          ...incomingPayload,
        },
        resolution: body.resolution || snapshot.resolution,
        lastActive: body.timestamp || snapshot.lastActive,
        lastSignalAt: body.timestamp || snapshot.lastSignalAt,
      },
    };
  }

  if (eventType === 'device_heartbeat') {
    lastHeartbeatPersistAt.set(deviceId, Date.now());
  }

  return recordHardwareDeviceEvent(buildHardwareReq(body, meta), eventType);
};

module.exports = {
  getDeviceSnapshot,
  recordHardwareDeviceEvent,
  applyHardwareEvent,
  hardwarePresenceEvents,
};
