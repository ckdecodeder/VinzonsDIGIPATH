import { createEndpointDiscovery, normalizeApiBase, apiBaseToWsUrl } from './endpointDiscovery.mjs';
import { requestWithDeadline } from './httpClient.mjs';
export { normalizeApiBase } from './endpointDiscovery.mjs';

const API_URL_KEY = 'dp_api_url';
const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5000' : window.location.origin;
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let resolvedIceServers = null;
let icePromise = null;
let lastRecovery = 0;

export function getStoredApiUrl() {
  try { return localStorage.getItem(API_URL_KEY)?.trim() || null; } catch { return null; }
}
export function setStoredApiUrl(url) {
  try { localStorage.setItem(API_URL_KEY, normalizeApiBase(url)); } catch { /* Storage may be disabled. */ }
}
const envApi = () => import.meta.env.VITE_API_BASE_URL?.trim();
const discovery = createEndpointDiscovery({
  origin,
  candidates: () => import.meta.env.DEV
    ? ['/api', envApi(), getStoredApiUrl()]
    : [envApi(), getStoredApiUrl(), '/api'],
  onVerified: (base) => { if (!base.startsWith('/')) setStoredApiUrl(base); },
});

export const getApiBase = () => discovery.getVerified() || normalizeApiBase(envApi() || getStoredApiUrl() || '/api');
export const bootstrapApiBase = (options) => discovery.bootstrap(options);
export function invalidateApiBaseCache() { discovery.invalidate(); resolvedIceServers = null; }
export function recoverApiConnection() {
  if (Date.now() - lastRecovery < 15000) return;
  lastRecovery = Date.now();
  invalidateApiBaseCache();
  bootstrapApiBase().catch(() => {});
}

export function getResolvedWsUrl() {
  const base = discovery.getVerified();
  if (!base) return null;
  const derived = apiBaseToWsUrl(base, origin);
  const explicit = import.meta.env.VITE_WS_URL?.trim();
  if (!explicit) return derived;
  try {
    const trimmed = explicit.replace(/\/$/, '');
    const normalized = trimmed.endsWith('/ws') ? trimmed : `${trimmed}/ws`;
    const sameBackend = new URL(normalized).host === new URL(derived).host && new URL(normalized).protocol === new URL(derived).protocol;
    return sameBackend || import.meta.env.VITE_ALLOW_SEPARATE_WS === 'true' ? normalized : derived;
  } catch { return derived; }
}
function envIceServers() {
  try { const value = JSON.parse(import.meta.env.VITE_ICE_SERVERS || 'null'); return Array.isArray(value) && value.length ? value : null; }
  catch { return null; }
}
export const getCachedIceServers = () => resolvedIceServers || envIceServers() || FALLBACK_ICE_SERVERS;
export async function preloadIceServers() {
  if (resolvedIceServers) return resolvedIceServers;
  if (icePromise) return icePromise;
  const configured = envIceServers();
  if (configured) { resolvedIceServers = configured; return configured; }
  icePromise = (async () => {
    try {
      const base = await bootstrapApiBase();
      const cfg = await requestWithDeadline(`${base}/config`, { timeoutMs: 4000, retries: 0 });
      // ICE data is independent of advertised PUBLIC_API_URL/WS destinations.
      if (Array.isArray(cfg?.iceServers) && cfg.iceServers.length) resolvedIceServers = cfg.iceServers;
    } catch { /* Do not poison endpoint discovery or permanently cache failures. */ }
    return getCachedIceServers();
  })();
  try { return await icePromise; } finally { icePromise = null; }
}
if (typeof window !== 'undefined') window.addEventListener('online', () => {
  bootstrapApiBase({ force: true }).then(() => window.dispatchEvent(new CustomEvent('dp_connection_recovered'))).catch(() => {});
});
