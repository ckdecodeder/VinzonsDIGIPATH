require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { connectDB, getDatabaseStatus } = require('./config/db');
const { syncModels } = require('./models');
const { corsOriginCallback } = require('./utils/cors');
const { formatServerUrls } = require('./utils/lanIp');
const { getPublicApiUrl } = require('./utils/publicApiUrl');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

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
  origin: corsOriginCallback,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const apiRoutes = require('./routes/index');
const { initRealtimeHub } = require('./ws/realtimeHub');
require('./routes/registerRealtime');

const startServer = async () => {
  await connectDB();
  await syncModels();

  app.get('/api/status', (req, res) => {
    res.json({
      status: 'API is running',
      database: getDatabaseStatus(),
      timestamp: new Date(),
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      ok: true,
      apiUrl: getPublicApiUrl(req),
    });
  });

  app.use('/api', apiRoutes);

  const PORT = process.env.PORT || 5000;
  const HOST = process.env.HOST || '0.0.0.0';
  const server = http.createServer(app);

  initRealtimeHub(server);

  server.listen(PORT, HOST, () => {
    console.log(formatServerUrls(PORT, 'DigiPath API running:'));
    console.log(`  WebSocket: ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ws`);
    console.log(`  Database: ${getDatabaseStatus()}`);
    const publicApiUrl = getPublicApiUrl();
    if (process.env.PUBLIC_API_URL) {
      console.log(`  Public:  ${publicApiUrl}`);
    }
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
