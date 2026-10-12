const { isIP } = require('node:net');

/**
 * Shared CORS policy for every Express HTTP route, including API and uploads.
 * Supports localhost, tunnels, and frontends opened through any IP address.
 */

const STATIC_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost',
  'http://localhost',
  'https://digipath-zeta.vercel.app',
]);

function isIpOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    const address = hostname.replace(/^\[|\]$/g, '');
    return (protocol === 'http:' || protocol === 'https:') && isIP(address) !== 0;
  } catch {
    return false;
  }
}

function extraOriginsFromEnv() {
  const raw = process.env.CORS_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim();
  if (!raw) return [];
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;

  if (STATIC_ORIGINS.has(origin)) return true;

  // Browsers may access the dashboard through any LAN or public IP address.
  if (isIpOrigin(origin)) return true;

  for (const extra of extraOriginsFromEnv()) {
    if (origin === extra) return true;
  }

  // Local dev — any localhost port
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;

  // Private LAN (office / store WiFi)
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin)) return true;

  // Public tunnels — dev tunnel, ngrok, cloudflare
  if (/^https?:\/\/[a-z0-9-]+\.asse\.devtunnels\.ms$/i.test(origin)) return true;
  if (/^https?:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/i.test(origin)) return true;
  if (/^https?:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)) return true;

  // Vercel frontend (production + preview deployments)
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;

  // Permissive override for staging only
  if (process.env.CORS_ALLOW_ALL === '1') return true;

  // Development fallback
  if (process.env.NODE_ENV !== 'production') return true;

  return false;
}

function corsOriginCallback(origin, callback) {
  if (isAllowedCorsOrigin(origin)) {
    callback(null, origin || true);
    return;
  }

  console.warn(`CORS blocked for origin: ${origin}`);
  callback(null, false);
}

module.exports = {
  isAllowedCorsOrigin,
  corsOriginCallback,
};
