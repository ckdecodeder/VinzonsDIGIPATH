import { ApiError, requestWithDeadline } from './httpClient.mjs';
export const normalizeApiBase = (raw = '/api') => {
  const value = raw.trim().replace(/\/+$/, '');
  return value.endsWith('/api') ? value : `${value}/api`;
};
export const apiBaseToWsUrl = (base, origin) => new URL(normalizeApiBase(base).replace(/\/api$/, '/ws'), origin)
  .href.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

export function createEndpointDiscovery({ candidates, origin, fetch, onVerified = () => {}, probeTimeoutMs = 4000, failureCooldownMs = 1500 }) {
  let verified = null;
  let pending = null;
  let failedAt = 0;
  let generation = 0;
  const invalidate = () => { verified = null; generation += 1; };
  const bootstrap = async ({ force = false } = {}) => {
    if (pending) return pending;
    if (force) { invalidate(); failedAt = 0; }
    if (verified) return verified;
    if (failedAt && Date.now() - failedAt < failureCooldownMs) {
      throw new ApiError('API unavailable. Check the backend connection and retry.', { code: 'API_UNAVAILABLE' });
    }
    const version = generation;
    pending = (async () => {
      const seen = new Set();
      for (const raw of candidates()) {
        if (!raw) continue;
        const base = normalizeApiBase(raw);
        let identity;
        try {
          const url = new URL(base, origin);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
          identity = url.href;
        } catch { continue; }
        if (seen.has(identity)) continue;
        seen.add(identity);
        try {
          const health = await requestWithDeadline(`${base}/status`, { timeoutMs: probeTimeoutMs, retries: 0, cache: 'no-store' }, { fetch });
          if (health?.status !== 'API is running' || !['connected', 'disconnected'].includes(health.database)) continue;
          if (generation !== version) throw new ApiError('Connection changed. Please retry.', { code: 'API_UNAVAILABLE' });
          verified = new URL(base, origin).origin === origin ? new URL(base, origin).pathname : base;
          failedAt = 0;
          onVerified(verified);
          return verified;
        } catch { /* Only a validated response can select/cache a destination. */ }
      }
      failedAt = Date.now();
      throw new ApiError('API unavailable. Check the backend connection and retry.', { code: 'API_UNAVAILABLE' });
    })();
    try { return await pending; } finally { pending = null; }
  };
  return { bootstrap, invalidate, getVerified: () => verified };
}
