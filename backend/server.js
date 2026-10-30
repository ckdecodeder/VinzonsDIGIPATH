require('dotenv').config({ quiet: true });
const http = require('http');
const express = require('express');
const cors = require('cors');
const { connectDB, getDatabaseStatus, checkDatabaseReadiness } = require('./config/db');
const { syncModels, smsService } = require('./models');
const { corsOriginCallback } = require('./utils/cors');
const { formatServerUrls } = require('./utils/lanIp');
const { getPublicApiUrl } = require('./utils/publicApiUrl');
const { parseIceServers } = require('./utils/webrtcConfig');
const { createFileRouter } = require('./routes/files');
const { validateRuntimeConfig } = require('./config/runtime');

const app = express();
validateRuntimeConfig();
const startedAt = new Date().toISOString();
const revision = (() => {
  if (/^[a-f0-9]{7,40}$/i.test(process.env.DIGIPATH_REVISION || '')) return process.env.DIGIPATH_REVISION;
  try { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unversioned'; }
})();

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Allow PDF/image previews in dashboard iframes for uploaded scans.
  res.setHeader('X-Frame-Options', req.path.startsWith('/uploads/') ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

app.use(cors({
  origin: corsOriginCallback,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Range', 'x-device-key', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
}));
app.use('/api/devices/stream/frame', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '2mb' }));
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', createFileRouter());

const apiRoutes = require('./routes/index');
const { initRealtimeHub } = require('./ws/realtimeHub');
require('./routes/registerRealtime');

const startServer = async () => {
  await connectDB();
  await syncModels();

  app.get('/api/status', async (req, res) => {
    const databaseReady = await checkDatabaseReadiness();
    res.setHeader('Cache-Control', 'no-store');
    res.status(databaseReady ? 200 : 503).json({
      status: 'API is running',
      database: getDatabaseStatus(),
      api: 'running',
      ready: databaseReady,
      publicReachability: 'not-probed',
      revision,
      startedAt,
      timestamp: new Date(),
    });
  });

  app.get('/api/config', (req, res) => {
    const publicRoot = getPublicApiUrl(req).replace(/\/$/, '');
    const apiUrl = publicRoot.endsWith('/api') ? publicRoot : `${publicRoot}/api`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      ok: true,
      apiUrl,
      wsUrl: apiUrl.replace(/\/api\/?$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws',
      previewMode: 'jpeg-ws',
      iceServers: parseIceServers(),
    });
  });

  app.use('/api', apiRoutes);

  const PORT = process.env.PORT || 5000;
  const HOST = process.env.HOST || '0.0.0.0';
  const server = http.createServer(app);

  initRealtimeHub(server);

  server.listen(PORT, HOST, () => {
    smsService.start();
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
