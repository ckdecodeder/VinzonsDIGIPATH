import { getApiBase } from '../api/apiBase';

const getAuthToken = () => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('dp_authToken');
};

export const getWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:5000/ws';

  const apiBase = getApiBase();
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

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
