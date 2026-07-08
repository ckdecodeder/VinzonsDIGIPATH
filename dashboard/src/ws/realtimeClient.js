import { getApiBase } from '../api/apiBase';

const getAuthToken = () => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('dp_authToken');
};

const isLocalViteDev = () => {
  if (typeof window === 'undefined') return false;
  const { hostname, port } = window.location;
  const onDevServer = port === '5173' || port === '4173';
  const onLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
  const onLan = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  return onDevServer && (onLoopback || onLan);
};

const isLocalApiBase = (apiBase = '') => (
  apiBase.startsWith('/')
  || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(apiBase)
);

const apiBaseToWsUrl = (apiBase) => {
  if (apiBase.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  const root = apiBase.replace(/\/api\/?$/, '');
  if (root.startsWith('https://')) {
    return `wss://${root.slice('https://'.length)}/ws`;
  }
  if (root.startsWith('http://')) {
    return `ws://${root.slice('http://'.length)}/ws`;
  }
  return `ws://${root}/ws`;
};

export const getWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:5000/ws';

  const explicit = import.meta.env.VITE_WS_URL?.trim();
  if (explicit) {
    const normalized = explicit.replace(/\/$/, '');
    return normalized.endsWith('/ws') ? normalized : `${normalized}/ws`;
  }

  const apiBase = getApiBase();

  // Local Vite + local API: proxy WS to laptop backend.
  if (isLocalViteDev() && isLocalApiBase(apiBase)) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  // Remote/tunnel API: use the SAME public WS host as the Pi (required for camera relay).
  return apiBaseToWsUrl(apiBase);
};

export class RealtimeClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.shouldConnect = false;
    this.connected = false;
    this.authenticated = false;
    this.activeChannels = new Set();
  }

  connect() {
    const token = getAuthToken();
    if (!token) return;

    this.shouldConnect = true;
    this.clearReconnect();

    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const ws = new WebSocket(getWsUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.emit('scanner:frame', { frame: new Uint8Array(event.data) });
        return;
      }

      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'auth:ok') {
        this.connected = true;
        this.authenticated = true;
        this.activeChannels.forEach((channel) => {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        });
        this.emit('connection:open', message);
        return;
      }

      if (message.type === 'auth:error') {
        this.emit('connection:error', message);
        ws.close();
        return;
      }

      this.emit(message.type, message);
      if (message.type && message.channel) {
        this.emit(`${message.type}:${message.channel}`, message);
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.authenticated = false;
      this.ws = null;
      this.emit('connection:close');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      this.emit('connection:error', { message: 'WebSocket connection failed' });
    };
  }

  disconnect() {
    this.shouldConnect = false;
    this.clearReconnect();
    this.connected = false;
    this.authenticated = false;

    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    ws.onclose = null;
    ws.onerror = null;

    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Client disconnect');
      return;
    }

    if (ws.readyState === WebSocket.CONNECTING) {
      ws.onopen = () => ws.close(1000, 'Client disconnect');
    }
  }

  scheduleReconnect() {
    if (!this.shouldConnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  subscribe(channel) {
    this.activeChannels.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }

  unsubscribe(channel) {
    this.activeChannels.delete(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    this.listeners.get(eventName)?.delete(handler);
  }

  emit(eventName, payload) {
    const handlers = this.listeners.get(eventName);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error('[Realtime]', err);
      }
    });
  }
}

export const realtimeClient = new RealtimeClient();
