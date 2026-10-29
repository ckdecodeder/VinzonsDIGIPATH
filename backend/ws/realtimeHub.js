const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { URL } = require('url');
const { getDeviceApiKey } = require('../utils/bridge');

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-only-change-this-secret';

const getStreamMinIntervalMs = () => {
  const configured = Number(process.env.REALTIME_STREAM_MIN_INTERVAL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 0;
};

const getStreamMaxBufferedBytes = () => {
  const configured = Number(process.env.REALTIME_STREAM_MAX_BUFFERED_BYTES);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 680_000;
};

const getStreamMaxClientBufferFrames = () => {
  const configured = Number(process.env.REALTIME_STREAM_MAX_CLIENT_BUFFER_FRAMES);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return 1;
};

const getStreamMaxPayloadBytes = () => {
  const configured = Number(process.env.REALTIME_STREAM_MAX_PAYLOAD_BYTES);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 1_048_576;
};

const WEBRTC_SIGNAL_TYPES = new Set([
  'scanner:webrtc:offer',
  'scanner:webrtc:answer',
  'scanner:webrtc:ice',
]);

const parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sendJson = (ws, payload) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

/** Pre-stringified send for hot WebRTC signaling paths (no compression). */
const sendRaw = (ws, raw) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(raw);
  }
};

class RealtimeHub {
  constructor({ resolveUser = async (id) => require('../models').User.findOne({ id }).lean() } = {}) {
    this.resolveUser = resolveUser;
    this.userClients = new Set();
    this.userClientsById = new Map();
    this.deviceClients = new Map();
    this.presenceHandler = null;
    this.wss = null;
    this.pingTimer = null;
    this.streamThrottle = new Map();
    this.latestStreamFrames = new Map();
    this.streamRelayPending = new Map();
    this.streamRelayStats = new Map();
    this.streamConsumerStats = new Map();
    this.streamReceiveStats = new Map();
    this.streamHintAt = new Map();
  }

  setPresenceHandler(handler) {
    this.presenceHandler = handler;
  }

  attach(server) {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: getStreamMaxPayloadBytes(),
    });

    server.on('upgrade', (request, socket, head) => {
      let pathname = '/';
      try {
        pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
      } catch {
        socket.destroy();
        return;
      }

      if (pathname !== '/ws' && pathname !== '/ws/device') {
        socket.destroy();
        return;
      }

      socket.setNoDelay(true);
      socket.setKeepAlive(true, 15000);

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        ws.isAlive = true;
        ws.subscriptions = new Set();
        ws.auth = null;
        ws.pendingAuthTimer = setTimeout(() => {
          if (!ws.auth) {
            sendJson(ws, { type: 'auth:error', message: 'Authentication timeout' });
            ws.close(4401, 'Authentication timeout');
          }
        }, 15000);

        ws.on('pong', () => {
          ws.isAlive = true;
        });

        if (pathname === '/ws/device') {
          this.handleDeviceSocket(ws, request);
        } else {
          this.handleUserSocket(ws);
        }
      });
    });

    this.pingTimer = setInterval(() => {
      this.revalidateUsers().catch(() => {});
      for (const client of this.userClients) {
        if (!client.isAlive) {
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }

      // Devices get a 2-miss grace (~60s) so a congested tunnel during scan upload
      // does not immediately kill the WebSocket and flash Offline in the UI.
      for (const clients of this.deviceClients.values()) {
        for (const client of clients) {
          if (!client.isAlive) {
            client.missedPongs = (client.missedPongs || 0) + 1;
            if (client.missedPongs >= 2) {
              client.terminate();
              continue;
            }
          } else {
            client.missedPongs = 0;
          }
          client.isAlive = false;
          client.ping();
        }
      }
    }, 30000);

    this.pingTimer.unref?.();
  }

  trackUserClient(ws) {
    this.userClients.add(ws);
    if (!ws.auth?.userId) return;
    const userId = ws.auth.userId;
    if (!this.userClientsById.has(userId)) {
      this.userClientsById.set(userId, new Set());
    }
    this.userClientsById.get(userId).add(ws);
  }

  untrackUserClient(ws) {
    this.userClients.delete(ws);
    if (!ws.auth?.userId) return;
    const clients = this.userClientsById.get(ws.auth.userId);
    if (!clients) return;
    clients.delete(ws);
    if (!clients.size) {
      this.userClientsById.delete(ws.auth.userId);
    }
  }

  handlePresenceAsync(ws, msg) {
    if (!this.presenceHandler || !ws.auth?.deviceId) return;
    const eventType = msg.type === 'heartbeat' ? 'device_heartbeat' : msg.type;
    const isHeartbeat = eventType === 'device_heartbeat';

    // Ack heartbeats immediately so Pi does not wait on MongoDB before next ping.
    if (isHeartbeat) {
      sendJson(ws, { type: 'presence:ok', eventType });
    }

    setImmediate(async () => {
      try {
        const result = await this.presenceHandler(
          msg.payload || {},
          eventType,
          ws.auth.deviceId,
          { lightweight: isHeartbeat },
        );
        if (result?.device) {
          this.broadcastDeviceUpdated(result.device);
        }
        if (!isHeartbeat) {
          sendJson(ws, { type: 'presence:ok', eventType });
        }
      } catch (err) {
        if (!isHeartbeat) {
          sendJson(ws, { type: 'presence:error', message: err.message || 'Presence update failed' });
        }
      }
    });
  }

  clearAuthTimer(ws) {
    if (ws.pendingAuthTimer) {
      clearTimeout(ws.pendingAuthTimer);
      ws.pendingAuthTimer = null;
    }
  }

  handleUserSocket(ws) {
    this.trackUserClient(ws);

    ws.on('message', (data, isBinary) => {
      ws.isAlive = true;
      if (isBinary) return;

      const msg = parseJson(data.toString());
      if (!msg?.type) return;

      if (msg.type === 'auth') {
        this.authenticateUser(ws, msg.token).catch(() => this.revokeSocket(ws));
        return;
      }

      if (!this.isUserLive(ws)) {
        sendJson(ws, { type: 'auth:error', message: 'Authenticate first' });
        return;
      }

      if (WEBRTC_SIGNAL_TYPES.has(msg.type)) {
        if (!this.canViewScanner(ws)) return;
        if (msg.type === 'scanner:webrtc:offer' && msg.channel && msg.sdp) {
          const parts = msg.channel.split(':');
          const deviceId = msg.deviceId || parts[1];
          if (!deviceId) return;
          this.relayWebRtcToDevice(ws.auth.userId, deviceId, {
            type: 'scanner:webrtc:offer',
            channel: msg.channel,
            userId: ws.auth.userId,
            sdp: msg.sdp,
          });
        } else if (msg.type === 'scanner:webrtc:ice' && msg.channel && msg.candidate) {
          const parts = msg.channel.split(':');
          const deviceId = msg.deviceId || parts[1];
          if (!deviceId) return;
          this.relayWebRtcToDevice(ws.auth.userId, deviceId, {
            type: 'scanner:webrtc:ice',
            channel: msg.channel,
            userId: ws.auth.userId,
            candidate: msg.candidate,
          });
        }
        return;
      }

      if (msg.type === 'subscribe' && msg.channel) {
        if (typeof msg.channel !== 'string' || ws.subscriptions.size >= 128) return;
        if (msg.channel.startsWith('scanner:') && !this.canViewScanner(ws)) return;
        ws.subscriptions.add(msg.channel);
        sendJson(ws, { type: 'subscribed', channel: msg.channel });
        const streamMatch = /^scanner:([^:]+):stream$/.exec(msg.channel);
        if (streamMatch) {
          this.pushLatestStreamFrameToClient(ws, streamMatch[1]);
        }
        return;
      }

      if (msg.type === 'unsubscribe' && msg.channel) {
        ws.subscriptions.delete(msg.channel);
        sendJson(ws, { type: 'unsubscribed', channel: msg.channel });
        return;
      }

      if (msg.type === 'stream:consumer' && msg.deviceId) {
        if (!this.canViewScanner(ws)) return;
        const paintFps = Number(msg.paintFps);
        if (Number.isFinite(paintFps) && paintFps >= 0) {
          this.streamConsumerStats.set(msg.deviceId, {
            paintFps,
            at: Date.now(),
          });
        }
        return;
      }
    });

    ws.on('close', () => {
      this.clearAuthTimer(ws);
      clearTimeout(ws.sessionTimer);
      this.untrackUserClient(ws);
    });
  }

  isUserLive(ws) {
    return Boolean(ws.auth?.kind === 'user' && ['Admin', 'Mayor', 'Receptionist', 'Office'].includes(ws.auth.role)
      && ws.auth.expiresAt > Date.now());
  }

  canViewScanner(ws) {
    return this.isUserLive(ws) && ['Admin', 'Mayor', 'Receptionist'].includes(ws.auth.role);
  }

  revokeSocket(ws) {
    this.untrackUserClient(ws);
    ws.auth = null;
    clearTimeout(ws.sessionTimer);
    ws.close(4401, 'Session expired or account changed');
  }

  revokeUser(userId) {
    for (const ws of [...(this.userClientsById.get(userId) || [])]) this.revokeSocket(ws);
  }

  async revalidateUsers() {
    if (this.revalidating) return;
    this.revalidating = true;
    try {
      for (const [id, sockets] of this.userClientsById) {
        let user;
        try { user = await this.resolveUser(id); } catch { for (const ws of [...sockets]) this.revokeSocket(ws); continue; }
        for (const ws of [...sockets]) {
          if (!user || !this.isUserLive(ws) || user.role !== ws.auth.role || user.officeId !== ws.auth.officeId) this.revokeSocket(ws);
        }
      }
    } finally { this.revalidating = false; }
  }

  async authenticateUser(ws, token) {
    if (!token) {
      sendJson(ws, { type: 'auth:error', message: 'Missing token' });
      ws.close(4401, 'Missing token');
      return;
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      const attempt = ws.authAttempt = (ws.authAttempt || 0) + 1;
      const user = await this.resolveUser(decoded.id);
      if (attempt !== ws.authAttempt || ws.readyState !== ws.OPEN) return;
      if (!user || !Number.isFinite(decoded.exp) || decoded.exp * 1000 <= Date.now()) throw new Error('Invalid session');
      this.untrackUserClient(ws);
      ws.auth = {
        kind: 'user',
        userId: decoded.id,
        role: user.role,
        officeId: user.officeId,
        expiresAt: decoded.exp * 1000,
      };
      if (!this.isUserLive(ws)) throw new Error('Invalid role');
      this.trackUserClient(ws);
      this.clearAuthTimer(ws);
      clearTimeout(ws.sessionTimer);
      ws.sessionTimer = setTimeout(() => this.revokeSocket(ws), Math.min(2147483647, ws.auth.expiresAt - Date.now()));
      ws.sessionTimer.unref?.();
      sendJson(ws, { type: 'auth:ok', userId: decoded.id, role: user.role });
      this.pushDeviceSnapshotToClient(ws);
    } catch {
      this.untrackUserClient(ws);
      ws.auth = null;
      sendJson(ws, { type: 'auth:error', message: 'Invalid or expired token' });
      ws.close(4401, 'Invalid token');
    }
  }

  handleDeviceSocket(ws, request) {
    const registerDevice = (deviceId) => {
      if (!this.deviceClients.has(deviceId)) {
        this.deviceClients.set(deviceId, new Set());
      }
      this.deviceClients.get(deviceId).add(ws);
      ws.auth = { kind: 'device', deviceId };
      this.clearAuthTimer(ws);
      sendJson(ws, { type: 'auth:ok', deviceId });
      this.recordDeviceConnected(deviceId);
      this.broadcastDevicePresence(deviceId);
      this.resendPendingCommands(ws, deviceId);
    };

    ws.on('message', (data, isBinary) => {
      ws.isAlive = true;
      if (isBinary) {
        if (!ws.auth?.deviceId) return;
        this.relayStreamFrame(ws.auth.deviceId, data);
        // The device keeps at most a couple of frames in flight, so frames never queue up in the tunnel.
        sendJson(ws, { type: 'stream:ack' });
        return;
      }

      const msg = parseJson(data.toString());
      if (!msg?.type) return;

      if (msg.type === 'auth') {
        const deviceId = msg.deviceId?.trim();
        const apiKey = msg.apiKey?.trim();
        if (!deviceId || !apiKey || apiKey !== getDeviceApiKey()) {
          sendJson(ws, { type: 'auth:error', message: 'Invalid device credentials' });
          ws.close(4401, 'Invalid device credentials');
          return;
        }
        registerDevice(deviceId);
        return;
      }

      if (!ws.auth?.deviceId) {
        sendJson(ws, { type: 'auth:error', message: 'Authenticate first' });
        return;
      }

      if (WEBRTC_SIGNAL_TYPES.has(msg.type)) {
        if (msg.type === 'scanner:webrtc:answer' && msg.userId && msg.sdp) {
          this.relayWebRtcToUser(msg.userId, {
            type: 'scanner:webrtc:answer',
            channel: msg.channel,
            sdp: msg.sdp,
          });
        } else if (msg.type === 'scanner:webrtc:ice' && msg.userId && msg.candidate) {
          this.relayWebRtcToUser(msg.userId, {
            type: 'scanner:webrtc:ice',
            channel: msg.channel,
            candidate: msg.candidate,
          });
        }
        return;
      }

      if (msg.type === 'heartbeat' || msg.type === 'device_connected' || msg.type === 'device_disconnected') {
        this.handlePresenceAsync(ws, msg);
        return;
      }

      // Live camera-light state: relayed as-is (no DB write) so the dashboard follows the knob and buttons instantly.
      if (msg.type === 'camera_light') {
        this.broadcastToUsers({
          type: 'camera_light',
          deviceId: ws.auth.deviceId,
          light: msg.payload || {},
          command: msg.command || null,
        });
      }
    });

    ws.on('close', () => {
      this.clearAuthTimer(ws);
      if (ws.auth?.deviceId) {
        const deviceId = ws.auth.deviceId;
        const clients = this.deviceClients.get(deviceId);
        if (clients) {
          clients.delete(ws);
          if (!clients.size) {
            this.deviceClients.delete(deviceId);
            this.broadcastDevicePresence(deviceId);
          }
        }
      }
    });
  }

  broadcastDevicePresence(deviceId) {
    setImmediate(async () => {
      try {
        const { getDeviceSnapshot } = require('../services/devicePresence');
        const device = await getDeviceSnapshot(deviceId);
        this.broadcastDeviceUpdated(device);
      } catch {
        // ignore snapshot errors during socket churn
      }
    });
  }

  recordDeviceConnected(deviceId) {
    if (!this.presenceHandler) return;
    setImmediate(async () => {
      try {
        const result = await this.presenceHandler(
          { deviceId, name: 'Physical Document Scanner', type: 'Scanner', status: 'Online' },
          'device_connected',
          deviceId,
        );
        if (result?.device) {
          this.broadcastDeviceUpdated(result.device);
        }
      } catch (err) {
        console.warn('[Realtime] device_connected presence failed:', err.message || err);
      }
    });
  }

  pushDeviceSnapshotToClient(ws) {
    if (!this.canViewScanner(ws)) return;
    setImmediate(async () => {
      try {
        const { getDeviceSnapshot } = require('../services/devicePresence');
        const device = await getDeviceSnapshot('DEV-001');
        if (this.canViewScanner(ws)) sendJson(ws, { type: 'device:updated', device });
      } catch {
        // ignore snapshot errors for a single client
      }
    });
  }

  pushLatestStreamFrameToClient(ws, deviceId = 'DEV-001') {
    if (!this.canViewScanner(ws)) return false;
    const cached = this.getLatestStreamFrame(deviceId);
    if (!cached?.frame?.length || ws.readyState !== ws.OPEN) return false;
    const maxAgeMs = Number(process.env.BRIDGE_SNAPSHOT_WS_FALLBACK_MAX_AGE_MS || 30000);
    if (maxAgeMs > 0 && Date.now() - cached.at > maxAgeMs) return false;
    try {
      ws.send(cached.frame, { binary: true, compress: false });
      return true;
    } catch {
      return false;
    }
  }

  maybeSendStreamHint(deviceId, { sent = 0, skipped = 0, subscribers = 0, maxBuffered = 0 } = {}) {
    const now = Date.now();
    const lastHint = this.streamHintAt.get(deviceId) || 0;
    const stats = this.streamRelayStats.get(deviceId) || { sent: 0, skipped: 0 };
    stats.sent += sent;
    stats.skipped += skipped;
    this.streamRelayStats.set(deviceId, stats);

    const total = stats.sent + stats.skipped;
    const shouldHint = skipped > 0 || subscribers === 0 || now - lastHint >= 2000;
    if (!shouldHint || total < 1) return;

    const skipRate = total > 0 ? stats.skipped / total : 0;
    stats.sent = 0;
    stats.skipped = 0;

    const frameBudget = getStreamMaxBufferedBytes();
    let pressure = skipRate;
    if (maxBuffered > frameBudget) {
      pressure = 1;
    } else if (maxBuffered > frameBudget * 0.5) {
      pressure = Math.max(pressure, 0.55);
    }

    const consumer = this.streamConsumerStats.get(deviceId);
    const consumerFps = consumer && now - consumer.at < 5000 ? consumer.paintFps : 0;

    const clients = this.deviceClients.get(deviceId);
    if (!clients?.size) return;

    // Frames per second that actually arrived from the device since the last hint.
    let receiveFps = 0;
    const received = this.streamReceiveStats.get(deviceId);
    if (received && now - received.since >= 1000) {
      receiveFps = Math.round((received.frames * 10000) / (now - received.since)) / 10;
      this.streamReceiveStats.set(deviceId, { frames: 0, since: now });
    }

    this.streamHintAt.set(deviceId, now);
    const payload = {
      type: 'stream:hint',
      pressure: Math.max(0, Math.min(1, pressure)),
      skipRate: Math.max(0, Math.min(1, skipRate)),
      consumerFps,
      receiveFps,
      subscribers,
    };
    for (const client of clients) {
      sendJson(client, payload);
    }
  }

  relayStreamFrame(deviceId, frameBuffer) {
    const buf = Buffer.isBuffer(frameBuffer) ? frameBuffer : Buffer.from(frameBuffer);
    const now = Date.now();
    this.latestStreamFrames.set(deviceId, { frame: buf, at: now });
    const received = this.streamReceiveStats.get(deviceId) || { frames: 0, since: now };
    received.frames += 1;
    this.streamReceiveStats.set(deviceId, received);

    let state = this.streamRelayPending.get(deviceId);
    if (!state) {
      state = { latest: buf, flushScheduled: false };
      this.streamRelayPending.set(deviceId, state);
    } else {
      state.latest = buf;
    }
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    setImmediate(() => this.flushStreamRelay(deviceId));
  }

  flushStreamRelay(deviceId) {
    const state = this.streamRelayPending.get(deviceId);
    if (!state) return;
    state.flushScheduled = false;

    const minIntervalMs = getStreamMinIntervalMs();
    const now = Date.now();
    const lastSent = this.streamThrottle.get(deviceId) || 0;
    if (minIntervalMs > 0 && now - lastSent < minIntervalMs) {
      state.flushScheduled = true;
      const waitMs = Math.max(1, minIntervalMs - (now - lastSent));
      setTimeout(() => this.flushStreamRelay(deviceId), waitMs);
      return;
    }
    this.streamThrottle.set(deviceId, now);

    const buf = state.latest;
    const channel = `scanner:${deviceId}:stream`;
    const frameBudget = getStreamMaxBufferedBytes();
    let anySkipped = false;
    let sent = 0;
    let subscribers = 0;
    let maxBuffered = 0;

    for (const client of this.userClients) {
      if (!this.canViewScanner(client) || !client.subscriptions.has(channel)) continue;
      if (client.readyState !== client.OPEN) continue;
      subscribers += 1;
      maxBuffered = Math.max(maxBuffered, client.bufferedAmount || 0);
      // One frame in flight max — skip only when a full JPEG is already queued.
      if (client.bufferedAmount > frameBudget) {
        anySkipped = true;
        continue;
      }
      try {
        client.send(buf, { binary: true, compress: false });
        sent += 1;
      } catch {
        anySkipped = true;
      }
    }

    this.maybeSendStreamHint(deviceId, { sent, skipped: anySkipped ? 1 : 0, subscribers, maxBuffered });

  }

  relayWebRtcToDevice(userId, deviceId, payload) {
    const clients = this.deviceClients.get(deviceId);
    if (!clients?.size) return;
    const message = { ...payload, userId };
    const raw = JSON.stringify(message);
    for (const client of clients) {
      sendRaw(client, raw);
    }
  }

  relayWebRtcToUser(userId, payload) {
    const clients = this.userClientsById.get(userId);
    if (!clients?.size) return;
    const raw = JSON.stringify(payload);
    for (const client of clients) {
      sendRaw(client, raw);
    }
  }

  broadcastToUsers(payload, filterFn = null) {
    for (const client of this.userClients) {
      if (!this.isUserLive(client)) continue;
      if (filterFn && !filterFn(client)) continue;
      sendJson(client, payload);
    }
  }

  broadcastDeviceUpdated(device) {
    this.broadcastToUsers({ type: 'device:updated', device }, client => this.canViewScanner(client));
  }

  broadcastCommandUpdated(command, resultDocument = null) {
    // Full documents always use the scoped HTTP detail/status route, never a global event.
    const payload = { type: 'command:updated', command, resultDocumentId: resultDocument?.id || command?.resultDocumentId || null };
    this.broadcastToUsers(payload, client => this.canViewScanner(client) && (['Admin', 'Mayor'].includes(client.auth.role) || client.auth.userId === command?.requestedBy));
  }

  broadcastDataInvalidate(collections = []) {
    this.broadcastToUsers({ type: 'data:invalidate', collections });
  }

  pushCommandToDevice(deviceId, command) {
    const clients = this.deviceClients.get(deviceId);
    if (!clients?.size) return false;

    const payload = { type: 'command:pending', command };
    for (const client of clients) {
      sendJson(client, payload);
    }
    return true;
  }

  // Commands are only delivered over WS, so anything queued while the Pi was
  // reconnecting would otherwise sit Pending and block new commands.
  resendPendingCommands(ws, deviceId) {
    setImmediate(async () => {
      try {
        const { Command } = require('../models');
        const pending = await Command.find({ deviceId, status: 'Pending' })
          .sort({ createdAt: 1 })
          .lean();
        for (const command of pending) {
          sendJson(ws, { type: 'command:pending', command });
        }
      } catch (err) {
        console.warn(`[RealtimeHub] Pending command resend failed for ${deviceId}: ${err.message}`);
      }
    });
  }

  isDeviceConnected(deviceId) {
    const clients = this.deviceClients.get(deviceId);
    return Boolean(clients?.size);
  }

  getLatestStreamFrame(deviceId = 'DEV-001') {
    return this.latestStreamFrames.get(deviceId) || null;
  }
}

let hubInstance = null;
let pendingPresenceHandler = null;
const registerPresenceHandler = (handler) => {
  pendingPresenceHandler = handler;
  hubInstance?.setPresenceHandler(handler);
};

const initRealtimeHub = (server) => {
  if (!hubInstance) {
    hubInstance = new RealtimeHub();
  }
  if (pendingPresenceHandler) hubInstance.setPresenceHandler(pendingPresenceHandler);
  hubInstance.attach(server);
  return hubInstance;
};

const getRealtimeHub = () => hubInstance;

module.exports = {
  RealtimeHub,
  initRealtimeHub,
  getRealtimeHub,
  registerPresenceHandler,
};
