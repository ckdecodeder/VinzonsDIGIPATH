const API_URL_KEY = 'dp_api_url';

let resolvedApiBase = null;
let resolvedWsUrl = null;
let resolvedIceServers = null;
let bootstrapPromise = null;

const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function parseEnvIceServers() {
  const raw = import.meta.env.VITE_ICE_SERVERS?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function getCachedIceServers() {
  return resolvedIceServers || parseEnvIceServers() || FALLBACK_ICE_SERVERS;
}

export function getStoredApiUrl() {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(API_URL_KEY)?.trim().replace(/\/$/, '');
  return value || null;
}

export function setStoredApiUrl(url) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_URL_KEY, url.trim().replace(/\/$/, ''));
}

function getEnvApiUrl() {
  const envUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');
  return envUrl || null;
}

export function normalizeApiBase(raw) {
  if (!raw) return '/api';

  const url = raw.trim().replace(/\/$/, '');
  if (url.startsWith('/')) {
    return url.endsWith('/api') ? url : `${url}/api`.replace(/\/{2,}/g, '/');
  }

  return url.endsWith('/api') ? url : `${url}/api`;
}

export function getResolvedWsUrl() {
  return resolvedWsUrl;
}

export function getApiBase() {
  if (resolvedApiBase) return resolvedApiBase;

  if (typeof window !== 'undefined') {
    const stored = getStoredApiUrl();
    if (stored) return normalizeApiBase(stored);

    const envUrl = getEnvApiUrl();
    if (envUrl) return normalizeApiBase(envUrl);

    return '/api';
  }

  return normalizeApiBase(getEnvApiUrl() || 'http://127.0.0.1:5000');
}

function collectApiCandidates() {
  const seen = new Set();
  const candidates = [];

  const add = (raw) => {
    const url = raw?.trim().replace(/\/$/, '');
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  };

  add(getStoredApiUrl());
  add(getEnvApiUrl());

  if (typeof window !== 'undefined') {
    add(window.location.origin);
  }

  return candidates;
}

function getProbeRoot(base) {
  if (typeof window !== 'undefined' && base.startsWith('/')) {
    return window.location.origin;
  }

  return base.replace(/\/api\/?$/, '');
}

const PROBE_TIMEOUT_MS = 8000;

function rememberConfigUrls(cfg) {
  const canonical = cfg?.apiUrl?.trim().replace(/\/$/, '');
  if (canonical) {
    resolvedApiBase = normalizeApiBase(canonical);
  }
  const ws = cfg?.wsUrl?.trim().replace(/\/$/, '');
  if (ws) {
    resolvedWsUrl = ws.endsWith('/ws') ? ws : `${ws}/ws`;
  }
  if (Array.isArray(cfg?.iceServers) && cfg.iceServers.length) {
    resolvedIceServers = cfg.iceServers;
  }
}

async function preloadIceServersFromConfig(root, signal) {
  if (resolvedIceServers) return resolvedIceServers;
  const envIce = parseEnvIceServers();
  if (envIce) {
    resolvedIceServers = envIce;
    return resolvedIceServers;
  }
  try {
    const cfgRes = await fetch(`${root}/api/config`, {
      cache: 'default',
      signal,
    });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      rememberConfigUrls(cfg);
      if (resolvedIceServers) {
        return resolvedIceServers;
      }
    }
  } catch {
    // fall through
  }
  resolvedIceServers = FALLBACK_ICE_SERVERS;
  return resolvedIceServers;
}

export async function preloadIceServers() {
  if (resolvedIceServers) return resolvedIceServers;
  const envIce = parseEnvIceServers();
  if (envIce) {
    resolvedIceServers = envIce;
    return resolvedIceServers;
  }
  const apiBase = getApiBase();
  const root = getProbeRoot(apiBase);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await preloadIceServersFromConfig(root, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function probeApiUrl(base) {
  const root = getProbeRoot(base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const status = await fetch(`${root}/api/status`, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!status.ok) return null;

    const usedSameOrigin = typeof window !== 'undefined'
      && (base === window.location.origin || base.startsWith('/'));

    // Keep same-origin proxy when it already works (localhost, LAN, frontend tunnel).
    if (usedSameOrigin) {
      return normalizeApiBase(base);
    }

    try {
      const cfgRes = await fetch(`${root}/api/config`, {
        cache: 'no-store',
        signal: controller.signal,
      });

      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        rememberConfigUrls(cfg);
        if (resolvedApiBase) {
          await preloadIceServersFromConfig(root, controller.signal);
          return resolvedApiBase;
        }
        const canonical = cfg.apiUrl?.trim().replace(/\/$/, '');
        if (canonical) {
          await preloadIceServersFromConfig(root, controller.signal);
          return normalizeApiBase(canonical);
        }
      }
    } catch {
      // status ok is enough
    }

    return normalizeApiBase(base);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function bootstrapApiBase(options = {}) {
  if (options.force) {
    resolvedApiBase = null;
    resolvedWsUrl = null;
    bootstrapPromise = null;
  }

  if (resolvedApiBase) return resolvedApiBase;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const envUrl = getEnvApiUrl();
    if (envUrl) {
      const envBase = normalizeApiBase(envUrl);
      const envWorking = await probeApiUrl(envUrl);
      if (envWorking) {
        resolvedApiBase = envWorking;
        setStoredApiUrl(envWorking);
        return envWorking;
      }
    }

    for (const candidate of collectApiCandidates()) {
      const working = await probeApiUrl(candidate);
      if (working) {
        resolvedApiBase = working;
        setStoredApiUrl(working);
        return working;
      }
    }

    const fallback = getApiBase();
    resolvedApiBase = fallback;
    return fallback;
  })();

  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

export function invalidateApiBaseCache() {
  resolvedApiBase = null;
  resolvedWsUrl = null;
  resolvedIceServers = null;
}
