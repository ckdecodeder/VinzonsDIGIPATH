import { bridgeService } from '../api/documentService';

const LAN_PROBE_TIMEOUT_MS = 1500;
const DEFAULT_BRIDGE_PORT = '8080';

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

/** Bridge URL reported by the Pi via backend heartbeat (no subnet scan). */
export const getReportedBridgeUrl = (device) => {
  const fromDevice = normalizeBridgeBase(device?.bridgeUrl);
  if (fromDevice) return fromDevice;

  const fromPayload = normalizeBridgeBase(device?.payload?.bridgeUrl);
  if (fromPayload) return fromPayload;

  const ip = (device?.ip && device.ip !== 'Not reported')
    ? device.ip
    : (device?.payload?.ip && device.payload.ip !== 'Not reported' ? device.payload.ip : null);
  if (ip) return `http://${ip}:${DEFAULT_BRIDGE_PORT}`;

  const envUrl = (import.meta.env.VITE_SCANNER_BRIDGE_URL || '').trim();
  return normalizeBridgeBase(envUrl);
};

const withTimeout = (promise, ms, label = 'timeout') => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms);
  }),
]);

/** Direct browser → Pi (same WiFi). Pi sends Access-Control-Allow-Origin: *. */
export const probeLanBridgeDirect = async (base) => {
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/status`;
  try {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store', mode: 'cors' }),
      LAN_PROBE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const status = await res.json();
    if (status?.status === 'online' || status?.bridgeVersion) {
      return normalizeBridgeBase(status?.bridgeUrl) || base;
    }
    return null;
  } catch {
    return null;
  }
};

/** Probe Pi bridge via backend proxy (when browser cannot reach Pi directly). */
export const probeLanBridge = async (base, deviceId = 'DEV-001') => {
  if (!base) return null;
  try {
    const result = await withTimeout(
      bridgeService.probe({ bridgeUrl: base, deviceId }),
      LAN_PROBE_TIMEOUT_MS,
    );
    if (!result?.ok) return null;
    return normalizeBridgeBase(result.resolvedBridgeUrl) || normalizeBridgeBase(result.bridgeUrl) || base;
  } catch {
    return null;
  }
};

export const probeLanBridgeAny = async (base, deviceId = 'DEV-001') => {
  const direct = await probeLanBridgeDirect(base);
  if (direct) return direct;
  return probeLanBridge(base, deviceId);
};

export const fetchLanSnapshotDirect = async (base) => {
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/snapshot.jpg`;
  try {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store', mode: 'cors' }),
      LAN_PROBE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob?.size ? blob : null;
  } catch {
    return null;
  }
};

/** Use Pi-reported bridge URL; optional direct verify only (no subnet scan). */
export const resolveReachableLanBridge = async (device) => {
  const base = getReportedBridgeUrl(device);
  if (!base) return null;
  const verified = await probeLanBridgeDirect(base);
  return verified || base;
};

export const fetchLanSnapshotAny = async (device) => {
  const base = getReportedBridgeUrl(device);
  if (!base) return null;
  const direct = await fetchLanSnapshotDirect(base);
  if (direct) return direct;
  const resolved = await probeLanBridgeDirect(base);
  if (!resolved) return null;
  return fetchLanSnapshotDirect(resolved);
};
