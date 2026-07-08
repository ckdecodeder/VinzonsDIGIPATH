const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { URL } = require('url');
const { getDeviceApiKey } = require('../utils/bridge');

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-only-change-this-secret';

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

class RealtimeHub {
  constructor() {
    this.userClients = new Set();
    this.deviceClients = new Map();
    this.presenceHandler = null;
    this.wss = null;
    this.pingTimer = null;
    this.streamThrottle = new Map();
  }

  setPresenceHandler(handler) {
    this.presenceHandler = handler;
  }

  attach(server) {
    this.wss = new WebSocketServer({ noServer: true });

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
      for (const client of this.userClients) {
        if (!client.isAlive) {
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }

      for (const clients of this.deviceClients.values()) {
        for (const client of clients) {
          if (!client.isAlive) {
            client.terminate();
            continue;
          }
          client.isAlive = false;
          client.ping();
        }
      }
    }, 30000);

    this.pingTimer.unref?.();
  }

  clearAuthTimer(ws) {
    if (ws.pendingAuthTimer) {
      clearTimeout(ws.pendingAuthTimer);
      ws.pendingAuthTimer = null;
    }
  }

  handleUserSocket(ws) {
    this.userClients.add(ws);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;

      const msg = parseJson(data.toString());
      if (!msg?.type) return;

      if (msg.type === 'auth') {
        this.authenticateUser(ws, msg.token);
        return;
      }

      if (!ws.auth) {
        sendJson(ws, { type: 'auth:error', message: 'Authenticate first' });
        return;
      }

      if (msg.type === 'subscribe' && msg.channel) {
        ws.subscriptions.add(msg.channel);
        sendJson(ws, { type: 'subscribed', channel: msg.channel });
        return;
      }

      if (msg.type === 'unsubscribe' && msg.channel) {
        ws.subscriptions.delete(msg.channel);
        sendJson(ws, { type: 'unsubscribed', channel: msg.channel });
      }
    });

    ws.on('close', () => {
      this.clearAuthTimer(ws);
      this.userClients.delete(ws);
    });
  }

  authenticateUser(ws, token) {
    if (!token) {
      sendJson(ws, { type: 'auth:error', message: 'Missing token' });
      ws.close(4401, 'Missing token');
      return;
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      ws.auth = {
        kind: 'user',
        userId: decoded.id,
        role: decoded.role,
      };
      this.clearAuthTimer(ws);
      sendJson(ws, { type: 'auth:ok', userId: decoded.id, role: decoded.role });
    } catch {
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
    };

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (!ws.auth?.deviceId) return;
        this.relayStreamFrame(ws.auth.deviceId, data);
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

      if (msg.type === 'heartbeat' || msg.type === 'device_connected' || msg.type === 'device_disconnected') {
        if (!this.presenceHandler) return;
        const eventType = msg.type === 'heartbeat' ? 'device_heartbeat' : msg.type;
        try {
          const result = await this.presenceHandler(msg.payload || {}, eventType, ws.auth.deviceId);
          if (result?.device) {
            this.broadcastDeviceUpdated(result.device);
          }
          sendJson(ws, { type: 'presence:ok', eventType });
        } catch (err) {
          sendJson(ws, { type: 'presence:error', message: err.message || 'Presence update failed' });
        }
      }
    });

    ws.on('close', () => {
      this.clearAuthTimer(ws);
      if (ws.auth?.deviceId) {
        const clients = this.deviceClients.get(ws.auth.deviceId);
        if (clients) {
          clients.delete(ws);
          if (!clients.size) {
            this.deviceClients.delete(ws.auth.deviceId);
          }
        }
      }
    });
  }

  relayStreamFrame(deviceId, frameBuffer) {
    const now = Date.now();
    const lastSent = this.streamThrottle.get(deviceId) || 0;
    if (now - lastSent < 80) return;
    this.streamThrottle.set(deviceId, now);

    const channel = `scanner:${deviceId}:stream`;
    for (const client of this.userClients) {
      if (!client.auth || !client.subscriptions.has(channel)) continue;
      if (client.readyState === client.OPEN) {
        client.send(frameBuffer, { binary: true });
      }
    }
  }

  broadcastToUsers(payload, filterFn = null) {
    for (const client of this.userClients) {
      if (!client.auth) continue;
      if (filterFn && !filterFn(client)) continue;
      sendJson(client, payload);
    }
  }

  broadcastDeviceUpdated(device) {
    this.broadcastToUsers({ type: 'device:updated', device });
  }

  broadcastCommandUpdated(command, resultDocument = null) {
    const payload = { type: 'command:updated', command, resultDocument };
    this.broadcastToUsers(payload);
    if (command?.id) {
      this.broadcastToUsers(payload, (client) => client.subscriptions.has(`command:${command.id}`));
    }
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

  isDeviceConnected(deviceId) {
    const clients = this.deviceClients.get(deviceId);
    return Boolean(clients?.size);
  }
}

let hubInstance = null;

const initRealtimeHub = (server) => {
  if (!hubInstance) {
    hubInstance = new RealtimeHub();
  }
  hubInstance.attach(server);
  return hubInstance;
};

const getRealtimeHub = () => hubInstance;

module.exports = {
  RealtimeHub,
  initRealtimeHub,
  getRealtimeHub,
};
