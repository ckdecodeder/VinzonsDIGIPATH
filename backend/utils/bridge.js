const { normalizeText } = require('./helpers');

const scannerBridgeTimeoutMs = Number(process.env.SCANNER_BRIDGE_TIMEOUT_MS || 4000);
const scannerBridgePort = String(process.env.SCANNER_BRIDGE_PORT || '8080');

const getDeviceApiKey = () => {
  const key = process.env.DEVICE_API_KEY || '';
  return require('../config/runtime').weakSecret(key) ? null : key;
};

const requireDeviceApiKey = (req, res, next) => {
  const providedKey = req.get('x-device-key');
  const configuredKey = getDeviceApiKey();
  if (!configuredKey) return res.status(503).json({ message: 'Scanner credentials require configuration by an administrator.' });
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({ message: 'Valid device API key required' });
  }
  next();
};

const normalizeBridgeBaseUrl = (value) => {
  let text = normalizeText(value || '');
  if (!text) return '';

  text = text.replace(/^(https?:\/\/):+/i, '$1');
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text.replace(/^:+/, '')}`;
  }

  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';

    const numericPath = parsed.pathname.match(/^\/(\d+)\/?$/);
    if (!parsed.port) {
      parsed.port = numericPath ? (numericPath[1] === '5000' ? scannerBridgePort : numericPath[1]) : scannerBridgePort;
    }
    if (numericPath || parsed.pathname === '/') parsed.pathname = '';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return '';
  }
};

const getBridgeBaseUrl = (req, device) => {
  const requestedUrl = req.body?.bridgeUrl || req.query?.bridgeUrl;
  const requestedBase = normalizeBridgeBaseUrl(requestedUrl);
  const registered = [process.env.SCANNER_BRIDGE_URL, device?.bridgeUrl, device?.payload?.bridgeUrl,
    device?.ip && device.ip !== 'Not reported' ? `http://${device.ip}:${scannerBridgePort}` : '']
    .map(normalizeBridgeBaseUrl).filter(Boolean);
  if (requestedUrl && (!requestedBase || !registered.includes(requestedBase))) {
    const error = new Error('Bridge address must match the registered scanner. Ask an administrator to update its configuration.'); error.status = 400; throw error;
  }
  const selected = requestedBase || registered[0] || '';
  if (selected) assertBridgeDestination(selected);
  return selected;
};

const assertBridgeDestination = (value) => {
  const parsed = new URL(value);
  // Numeric LAN addresses avoid DNS rebinding; loopback requires an explicit server setting.
  const privateIp = require('node:net').isIP(parsed.hostname) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);
  const explicitLoopback = process.env.SCANNER_BRIDGE_ALLOW_LOOPBACK === '1' && /^(127\.0\.0\.1|localhost)$/.test(parsed.hostname);
  if ((!privateIp && !explicitLoopback) || (parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) !== scannerBridgePort) {
    const error = new Error('Scanner bridge must use its configured LAN address and port.'); error.status = 400; throw error;
  }
  return value;
};

const fetchBridgeEndpoint = async (bridgeBaseUrl, endpoint, options = {}) => {
  assertBridgeDestination(bridgeBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), scannerBridgeTimeoutMs);
  try {
    const response = await fetch(`${bridgeBaseUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
      redirect: 'error',
    });
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status, headers: response.headers });
  } finally {
    clearTimeout(timeout);
  }
};

const cleanBridgeErrorText = (value = '') => {
  const text = String(value || '');
  const messageMatch = text.match(/Message:\s*([^<\n\r]+)/i);
  if (messageMatch?.[1]) return messageMatch[1].trim();

  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const isPrivateBridgeHost = (hostname = '') => (
  /^(localhost|127\.0\.0\.1)$/i.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^10\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
);

module.exports = {
  getDeviceApiKey,
  requireDeviceApiKey,
  normalizeBridgeBaseUrl,
  getBridgeBaseUrl,
  fetchBridgeEndpoint,
  cleanBridgeErrorText,
  isPrivateBridgeHost,
  assertBridgeDestination,
};
