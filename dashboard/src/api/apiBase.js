const API_URL_KEY = 'dp_api_url';

let resolvedApiBase = null;
let bootstrapPromise = null;

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

async function probeApiUrl(base, timeoutMs = 6000) {
  const root = getProbeRoot(base);

  try {
    const status = await fetch(`${root}/api/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
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
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        const canonical = cfg.apiUrl?.trim().replace(/\/$/, '');
        if (canonical) {
          return normalizeApiBase(canonical);
        }
      }
    } catch {
      // status ok is enough
    }

    return normalizeApiBase(base);
  } catch {
    return null;
  }
}

export async function bootstrapApiBase(options = {}) {
  if (options.force) {
    resolvedApiBase = null;
    bootstrapPromise = null;
  }

  if (resolvedApiBase) return resolvedApiBase;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const probeTimeoutMs = options.probeTimeoutMs ?? Number(import.meta.env.VITE_API_TIMEOUT_MS || 6000);

    for (const candidate of collectApiCandidates()) {
      const working = await probeApiUrl(candidate, probeTimeoutMs);
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
}
