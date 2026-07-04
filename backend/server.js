require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB, getDatabaseStatus } = require('./config/db');
const { syncModels } = require('./models');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

// Allow devtunnel subdomains (eg. https://*.devtunnels.ms)
const devTunnelPattern = /\.devtunnels\.ms$/;

console.log('CORS allowed origins:', allowedOrigins);
console.log('DevTunnel pattern:', devTunnelPattern);

const isLocalDevOrigin = (origin = '') => {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (['localhost', '127.0.0.1', '::1'].includes(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
};

const isOriginAllowed = (origin = '') => {
  if (!origin) return true;
  // exact match from env list
  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);

    // allow localhost/127.0.0.1 (any port) during development
    if (!isProduction && isLocalDevOrigin(origin)) return true;

    // allow devtunnel subdomains by hostname
    if (devTunnelPattern.test(url.hostname)) return true;

    // allow if any configured allowed origin matches hostname
    for (const a of allowedOrigins) {
      try {
        const au = new URL(a);
        if (au.hostname === url.hostname) return true;
      } catch {
        // allowed origin might be a bare hostname
        if (a === url.hostname) return true;
      }
    }
  } catch (e) {
    // ignore
  }

  return false;
};

if (isProduction) {
  const weakJwtSecret = !process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-change-this-secret';
  const weakDeviceKey = !process.env.DEVICE_API_KEY || process.env.DEVICE_API_KEY === 'dev-device-key-change-me';

  if (weakJwtSecret || weakDeviceKey) {
    throw new Error('Production requires strong JWT_SECRET and DEVICE_API_KEY values.');
  }
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);

    console.warn('Blocked CORS origin:', origin);
    return callback(new Error('CORS origin is not allowed'));
  },
}));
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes (will create these next)
const apiRoutes = require('./routes/index');

connectDB().then(() => syncModels());

// Test route
app.get('/api/status', (req, res) => {
  res.json({
    status: 'API is running',
    database: getDatabaseStatus(),
    timestamp: new Date(),
  });
});

app.use('/api', apiRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
