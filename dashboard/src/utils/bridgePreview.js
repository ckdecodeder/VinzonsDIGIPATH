import { bridgeService } from '../api/documentService';

const LAN_PROBE_TIMEOUT_MS = 2000;

export const isPrivateLanHost = (hostname = '') => (
  /^(localhost|127\.0\.0\.1)$/i.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^10\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
);

const normalizeBridgeBase = (raw) => {
  if (!raw) return null;
  const value = String(raw).trim().replace(/\/$/, '');
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!isPrivateLanHost(parsed.hostname)) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    const normalized = value.replace(/\/stream\.mjpg.*$/i, '').replace(/\/$/, '');
    const host = normalized.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    if (!isPrivateLanHost(host)) return null;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }
    return `http://${normalized}`;
  }
};

export const collectLanBridgeCandidates = (device) => {
  const seen = new Set();
  const candidates = [];

  const add = (raw) => {
    const base = normalizeBridgeBase(raw);
    if (!base || seen.has(base)) return;
    seen.add(base);
    candidates.push(base);
  };

  if (device?.ip && device.ip !== 'Not reported') {
    add(`http://${device.ip}:8080`);
  }

  if (device?.payload?.ip && device.payload.ip !== 'Not reported') {
    add(`http://${device.payload.ip}:8080`);
  }

  const envUrl = (import.meta.env.VITE_SCANNER_BRIDGE_URL || '').trim();
  if (envUrl) add(envUrl);

  add(device?.bridgeUrl);
  add(device?.payload?.bridgeUrl);

  return candidates;
};

/** Probe Pi bridge via backend proxy (avoids browser CORS to Pi). */
export const probeLanBridge = async (base, deviceId = 'DEV-001') => {
  if (!base) return null;
  try {
    const result = await Promise.race([
      bridgeService.probe({ bridgeUrl: base, deviceId }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('LAN probe timeout')), LAN_PROBE_TIMEOUT_MS);
      }),
    ]);
    if (!result?.ok) return null;
    return normalizeBridgeBase(result.resolvedBridgeUrl) || normalizeBridgeBase(result.bridgeUrl) || base;
  } catch {
    return null;
  }
};

export const resolveReachableLanBridge = async (device) => {
  const deviceId = device?.id || 'DEV-001';
  const candidates = collectLanBridgeCandidates(device);
  for (const candidate of candidates) {
    const resolved = await probeLanBridge(candidate, deviceId);
    if (resolved) return resolved;
  }
  return null;
};
