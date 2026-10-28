/* Optional, bounded runtime observations. Database work is READ ONLY; HTTP uses GET only. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
const dotenv = backendRequire('dotenv');
const parse = (relative) => {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
};
const backend = parse('backend/.env');
const network = parse('network.env');
const dashboard = parse('dashboard/.env');
const pi = parse('pi_ws_scanner.env');
const publicRoot = (value) => String(value || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
const origin = (value) => { try { return new URL(value).origin; } catch { return value || null; } };

async function database() {
  const { Client } = backendRequire('pg');
  const client = new Client({ connectionString: backend.DATABASE_URL, connectionTimeoutMillis: 4000, statement_timeout: 4000, query_timeout: 5000, application_name: 'digipath_read_only_performance_audit' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const counts = {};
    for (const table of ['users', 'documents', 'transmissions', 'archives', 'offices', 'document_types', 'devices', 'device_events', 'logs', 'notifications', 'sender_notifications', 'commands']) {
      counts[table] = Number((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
    }
    const sizes = {};
    for (const table of ['documents', 'logs', 'transmissions', 'device_events']) {
      sizes[table] = (await client.query(`SELECT count(*)::int AS rows, octet_length(coalesce(json_agg(t)::text,'[]'))::bigint AS all_rows_json_bytes FROM "${table}" t`)).rows[0];
    }
    const documentFields = (await client.query(`SELECT
      count(*) FILTER (WHERE "scannedImageUrl" LIKE 'data:%')::int AS inline_cover_documents,
      coalesce(sum(octet_length(coalesce("scannedImageUrl",''))),0)::bigint AS scanned_image_url_bytes,
      coalesce(sum(octet_length(coalesce("scannedText",''))),0)::bigint AS ocr_text_bytes,
      coalesce(sum(octet_length(coalesce("scannedFiles"::text,''))),0)::bigint AS scanned_files_json_bytes,
      coalesce(sum(octet_length(coalesce(timeline::text,''))),0)::bigint AS timeline_json_bytes
      FROM documents`)).rows[0];
    const attachmentFields = (await client.query(`SELECT
      count(*)::int AS attachment_entries,
      count(*) FILTER (WHERE elem->>'dataUrl' LIKE 'data:%')::int AS inline_data_url_entries,
      coalesce(sum(octet_length(coalesce(elem->>'dataUrl',''))),0)::bigint AS data_url_bytes,
      count(*) FILTER (WHERE elem->>'url' LIKE 'data:%')::int AS inline_url_entries
      FROM documents CROSS JOIN LATERAL jsonb_array_elements(coalesce("scannedFiles",'[]'::jsonb)) elem`)).rows[0];
    // Match the model's selected columns and serialize locally without exposing row contents.
    const modelSource = fs.readFileSync(path.join(root, 'backend/models/index.js'), 'utf8');
    const block = modelSource.split("sequelize.define('Document', {")[1].split("}, { tableName: 'documents'")[0];
    const attributes = [...block.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*\{/gm)].map((match) => match[1]);
    if (attributes.length < 30) throw new Error('Could not identify Document model columns');
    const modelRows = (await client.query(`SELECT ${attributes.map((name) => `"${name}"`).join(',')} FROM documents ORDER BY "createdAt","dateReceived",id`)).rows;
    let started = performance.now();
    const documentJson = JSON.stringify(modelRows);
    const stringifyMs = performance.now() - started;
    started = performance.now();
    JSON.parse(documentJson);
    const parseMs = performance.now() - started;
    const summaryRows = modelRows.map(({ scannedImageUrl, scannedFiles, scannedText, timeline, ...summary }) => summary);
    const documentPayload = {
      modelColumns: attributes.length,
      rows: modelRows.length,
      jsonBytes: Buffer.byteLength(documentJson),
      stringifyMs: Number(stringifyMs.toFixed(2)), parseMs: Number(parseMs.toFixed(2)),
      gzipBytesForComparisonOnly: require('node:zlib').gzipSync(documentJson).length,
      metadataOnlyJsonBytes: Buffer.byteLength(JSON.stringify(summaryRows)),
      ...documentFields, ...attachmentFields,
    };
    const indexRows = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
    const plans = {};
    const statements = {
      documentList: 'SELECT * FROM documents ORDER BY "createdAt", "dateReceived", id',
      logList: 'SELECT * FROM logs ORDER BY "timestamp" DESC, id DESC',
      latestDeviceEvent: `SELECT * FROM device_events WHERE "deviceId"='DEV-001' AND "recordedBy"='hardware' AND "eventType" IN ('device_connected','device_disconnected','device_heartbeat','scan_started','scan_completed','rfid_detected') ORDER BY "timestamp" DESC, id DESC LIMIT 1`,
      hardwareScanCount: `SELECT count(*) FROM device_events WHERE "deviceId"='DEV-001' AND "recordedBy"='hardware' AND "eventType"='scan_completed'`,
    };
    for (const [name, sql] of Object.entries(statements)) {
      const result = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
      plans[name] = { planningMs: result['Planning Time'], executionMs: result['Execution Time'], plan: result.Plan };
    }
    const stats = (await client.query("SELECT relname,n_live_tup,n_dead_tup,seq_scan,idx_scan,last_analyze,last_autoanalyze FROM pg_stat_user_tables ORDER BY relname")).rows;
    const connectionStats = (await client.query("SELECT numbackends,deadlocks,temp_files,temp_bytes FROM pg_stat_database WHERE datname=current_database()")).rows;
    await client.query('ROLLBACK');
    return { counts, sizes, documentPayload, indexes: indexRows, plans, stats, connectionStats };
  } finally { await client.end().catch(() => {}); }
}

async function networkChecks() {
  const frontend = 'https://vinzons-digipath.vercel.app';
  const candidates = [
    ['localApi', 'http://127.0.0.1:5000/api/status'],
    ['backendAdvertisedApi', `${publicRoot(backend.PUBLIC_API_URL)}/api/status`],
    ['networkSourceApi', `${publicRoot(network.DIGIPATH_PUBLIC_BACKEND_URL)}/api/status`],
    ['vercelApiStatus', `${frontend}/api/status`],
    ['vercelApiConfig', `${frontend}/api/config`],
    ['vercelHomepage', frontend],
  ].filter(([, url]) => /^https?:\/\//.test(url));
  const observations = await Promise.all(candidates.map(async ([label, url]) => {
    const started = performance.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6500), headers: { Accept: 'application/json,text/html;q=0.5' } });
      const body = await response.text();
      let json;
      try { json = JSON.parse(body); } catch {}
      return { label, url, status: response.status, ms: Math.round(performance.now() - started), contentType: response.headers.get('content-type'), contentEncoding: response.headers.get('content-encoding'), bytes: Buffer.byteLength(body), validApiStatus: Boolean(json && typeof json.status === 'string' && json.database), validApiConfig: Boolean(json?.apiUrl), asset: label === 'vercelHomepage' ? /src="([^\"]+\/assets\/[^\"]+\.js|\/assets\/[^\"]+\.js)"/.exec(body)?.[1] : undefined };
    } catch (error) {
      return { label, url, ms: Math.round(performance.now() - started), error: error.name, code: error.cause?.code || null };
    }
  }));
  const asset = observations.find((item) => item.label === 'vercelHomepage')?.asset;
  if (asset) {
    const started = performance.now();
    try {
      const response = await fetch(new URL(asset, frontend), { signal: AbortSignal.timeout(6500) });
      const bundle = await response.text();
      observations.push({ label: 'deployedBundle', status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(bundle), tunnelOrigins: [...new Set(bundle.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.devtunnels\.ms/g) || [])] });
    } catch (error) { observations.push({ label: 'deployedBundle', error: error.name }); }
  }
  return observations;
}

(async () => {
  const result = {
    observedAt: new Date().toISOString(),
    configuration: {
      backendOrigin: origin(backend.PUBLIC_API_URL), networkOrigin: origin(network.DIGIPATH_PUBLIC_BACKEND_URL),
      dashboardApi: origin(dashboard.VITE_API_BASE_URL), dashboardWs: origin(dashboard.VITE_WS_URL), piOrigin: origin(pi.DIGIPATH_BACKEND_BASE_URL),
      deviceKeyMatchesBackend: Boolean(pi.DIGIPATH_DEVICE_API_KEY && pi.DIGIPATH_DEVICE_API_KEY === backend.DEVICE_API_KEY),
      senderProvider: backend.SENDER_NOTIFICATION_PROVIDER || 'outbox (default)',
      nodeEnv: backend.NODE_ENV || 'not explicitly set in backend/.env',
      piPreview: { width: pi.DIGIPATH_PREVIEW_WIDTH, height: pi.DIGIPATH_PREVIEW_HEIGHT, maxFps: pi.DIGIPATH_STREAM_ADAPTIVE_MAX_FPS, jpegByteTarget: pi.DIGIPATH_STREAM_JPEG_MAX_BYTES, heartbeatSeconds: pi.DIGIPATH_HEARTBEAT_INTERVAL_SECS },
    },
  };
  if (process.argv.includes('--database')) {
    try { result.database = await database(); } catch (error) { result.database = { error: error.code || error.name, message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]') }; }
  }
  if (process.argv.includes('--network')) result.network = await networkChecks();
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
