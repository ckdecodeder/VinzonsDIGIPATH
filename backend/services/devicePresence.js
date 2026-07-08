const { Device, DeviceEvent, Command, Document } = require('../models');
const {
  createLogEntry,
  generateId,
  appendDocumentTimeline,
  createTimelineEvent,
} = require('../utils/helpers');
const { isDeviceWsConnected } = require('../utils/realtime');

const deviceHeartbeatTimeoutMs = Number(process.env.DEVICE_HEARTBEAT_TIMEOUT_MS || 12000);
const scannerBridgePort = String(process.env.SCANNER_BRIDGE_PORT || '8080');

const resolveBridgeUrl = (device, latestHardwareEvent) => {
  const eventBridge = latestHardwareEvent?.payload?.bridgeUrl;
  const eventIp = latestHardwareEvent?.payload?.ip;
  const deviceIp = (eventIp && eventIp !== 'Not reported')
    ? eventIp
    : (device?.ip && device.ip !== 'Not reported' ? device.ip : null);
  const storedBridge = device?.bridgeUrl;

  if (deviceIp) {
    const ipBridge = `http://${deviceIp}:${scannerBridgePort}`;
    if (eventBridge) {
      try {
        if (new URL(eventBridge).hostname === deviceIp) {
          return eventBridge;
        }
      } catch {
        // ignore invalid event URL
      }
    }
    if (storedBridge) {
      try {
        if (new URL(storedBridge).hostname === deviceIp) {
          return storedBridge;
        }
      } catch {
        // ignore invalid stored URL
      }
    }
    return ipBridge;
  }

  return eventBridge || storedBridge || null;
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
  const disconnectedByDevice = latestHardwareEvent?.eventType === 'device_disconnected' || latestHardwareEvent?.status === 'Offline';
  const connected = hasHardwareSignal && !disconnectedByDevice && isFreshHardwareSignal(latestHardwareEvent);
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
    streamWsConnected: isDeviceWsConnected(deviceId),
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
    payload: req.body.payload,
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

  return { event, device: snapshot };
};

const applyHardwareEvent = async (body, eventType, meta = {}) => {
  return recordHardwareDeviceEvent(buildHardwareReq(body, meta), eventType);
};

module.exports = {
  getDeviceSnapshot,
  recordHardwareDeviceEvent,
  applyHardwareEvent,
  hardwarePresenceEvents,
};
