const { normalizeText } = require('./helpers');

const scannerBridgeTimeoutMs = Number(process.env.SCANNER_BRIDGE_TIMEOUT_MS || 4000);
const scannerBridgePort = String(process.env.SCANNER_BRIDGE_PORT || '8080');

const getDeviceApiKey = () => process.env.DEVICE_API_KEY || 'dev-device-key-change-me';

const requireDeviceApiKey = (req, res, next) => {
  const providedKey = req.get('x-device-key');
  if (!providedKey || providedKey !== getDeviceApiKey()) {
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
  if (requestedBase) return requestedBase;

  const streamBase = normalizeBridgeBaseUrl(device?.streamUrl || device?.payload?.streamUrl);
  if (streamBase) return streamBase;

  if (device?.ip && device.ip !== 'Not reported') {
    return normalizeBridgeBaseUrl(`http://${device.ip}:${scannerBridgePort}`);
  }

  return '';
};

const fetchBridgeEndpoint = async (bridgeBaseUrl, endpoint, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), scannerBridgeTimeoutMs);
  try {
    return await fetch(`${bridgeBaseUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
    });
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

module.exports = {
  getDeviceApiKey,
  requireDeviceApiKey,
  normalizeBridgeBaseUrl,
  getBridgeBaseUrl,
  fetchBridgeEndpoint,
  cleanBridgeErrorText,
};
