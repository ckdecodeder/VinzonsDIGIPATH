// Audit only: read-only database transaction and bounded GETs. Never print private rows or secrets.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'backend/package.json'));
const parse = (name) => fs.existsSync(path.join(root, name)) ? req('dotenv').parse(fs.readFileSync(path.join(root, name))) : {};
const env = parse('backend/.env');
const front = parse('dashboard/.env');
const network = parse('network.env');
const pi = parse('pi_ws_scanner.env');
const origin = (value) => { try { return new URL(value).origin.replace(/^ws/, 'http'); } catch { return null; } };
const result = { observedAt: new Date().toISOString(), configuration: {
  productionModeEnabled: env.NODE_ENV === 'production',
  databaseConfigured: Boolean(env.DATABASE_URL),
  jwtConfigured: Boolean(env.JWT_SECRET),
  jwtUsesKnownDefault: !env.JWT_SECRET || env.JWT_SECRET === 'dev-only-change-this-secret',
  deviceKeyUsesKnownDefault: !env.DEVICE_API_KEY || env.DEVICE_API_KEY === 'dev-device-key-change-me',
  piDeviceKeyMatches: Boolean(pi.DIGIPATH_DEVICE_API_KEY && pi.DIGIPATH_DEVICE_API_KEY === env.DEVICE_API_KEY),
  frontendApiMatchesBackend: origin(front.VITE_API_BASE_URL) === origin(env.PUBLIC_API_URL),
  frontendWsMatchesBackend: origin(front.VITE_WS_URL) === origin(env.PUBLIC_API_URL),
  networkMatchesBackend: origin(network.DIGIPATH_PUBLIC_BACKEND_URL) === origin(env.PUBLIC_API_URL),
  piMatchesBackend: origin(pi.DIGIPATH_BACKEND_BASE_URL) === origin(env.PUBLIC_API_URL),
  senderDeliveryIsOutboxOnly: !env.SENDER_NOTIFICATION_PROVIDER || env.SENDER_NOTIFICATION_PROVIDER === 'outbox',
} };
const httpGet = async (label, url, token) => {
  const started = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const b = await r.text();
    let json; try { json = JSON.parse(b); } catch {}
    return { label, status: r.status, bytes: Buffer.byteLength(b), ms: Math.round(performance.now() - started), contentType: r.headers.get('content-type'), contentEncoding: r.headers.get('content-encoding'), xFrameOptions: r.headers.get('x-frame-options'), ...(label.includes('health') ? { ready: json?.ready, databaseConnected: json?.database === 'connected' } : {}), itemCount: Array.isArray(json) ? json.length : json?.items?.length, total: json?.total, _json: json, _body: b };
  } catch (error) { return { label, error: error.cause?.code || error.name, ms: Math.round(performance.now() - started) }; }
};
const sanitized = ({ _json, _body, ...observation }) => observation;
(async () => {
  const { Client } = req('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 7000, query_timeout: 8000, application_name: 'digipath_system_audit_readonly_20261029' });
  let docs = [], users = [];
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const query = async (sql) => (await client.query(sql)).rows;
    result.database = { counts: {}, checks: {} };
    for (const t of ['users','documents','transmissions','archives','offices','document_types','devices','device_events','logs','notifications','sender_notifications','commands']) {
      result.database.counts[t] = Number((await query(`SELECT count(*)::int AS n FROM "${t}"`))[0].n);
    }
    const checks = {
      invalidUserRoles: `SELECT count(*)::int AS n FROM users WHERE role IS NULL OR role NOT IN ('Admin','Mayor','Receptionist','Office')`,
      usersMissingOffice: `SELECT count(*)::int AS n FROM users u LEFT JOIN offices o ON o.id=u."officeId" WHERE u.role IN ('Mayor','Receptionist','Office') AND o.id IS NULL`,
      orphanTransmissions: `SELECT count(*)::int AS n FROM transmissions t LEFT JOIN documents d ON d.id=t."documentId" WHERE d.id IS NULL`,
      orphanArchives: `SELECT count(*)::int AS n FROM archives a LEFT JOIN documents d ON d.id=a."documentId" WHERE d.id IS NULL`,
      duplicateArchives: `SELECT count(*)::int AS n FROM (SELECT "documentId" FROM archives GROUP BY 1 HAVING count(*)>1) s`,
      archiveStatusMismatch: `SELECT count(*)::int AS n FROM archives a JOIN documents d ON d.id=a."documentId" WHERE d.status IS DISTINCT FROM 'Archived'`,
      archivedWithoutArchiveRow: `SELECT count(*)::int AS n FROM documents d WHERE status='Archived' AND NOT EXISTS(SELECT 1 FROM archives a WHERE a."documentId"=d.id)`,
      archivedWithPendingDelivery: `SELECT count(*)::int AS n FROM documents d WHERE d.status='Archived' AND EXISTS(SELECT 1 FROM transmissions t WHERE t."documentId"=d.id AND COALESCE(t."receivedBy",'')='')`,
      multipleActiveCommands: `SELECT count(*)::int AS n FROM (SELECT "deviceId" FROM commands WHERE status IN ('Pending','Executing') AND command<>'CAMERA_LIGHT' GROUP BY 1 HAVING count(*)>1) s`,
      receiptIdentityMismatch: `SELECT count(*)::int AS n FROM transmissions WHERE (COALESCE("receivedBy",'')='') <> (COALESCE("receivedAt",'')='')`,
      missingCustodyOffice: `SELECT count(*)::int AS n FROM documents d LEFT JOIN offices o ON o.id=d."currentOfficeId" WHERE o.id IS NULL`,
      missingDocumentType: `SELECT count(*)::int AS n FROM documents d LEFT JOIN document_types dt ON dt.id=d."documentTypeId" WHERE dt.id IS NULL`,
      invalidDocumentState: `SELECT count(*)::int AS n FROM documents WHERE status IS NULL OR status NOT IN ('Received','In Transit','Processing','For Signature','For Signing','For Filing','Signed','Acknowledged','Archived','Returned to Sender')`,
      transitWithoutPendingTransmission: `SELECT count(*)::int AS n FROM documents d WHERE d.status='In Transit' AND NOT EXISTS(SELECT 1 FROM transmissions t WHERE t."documentId"=d.id AND COALESCE(t."receivedBy",'')='')`,
      inlineCovers: `SELECT count(*)::int AS n FROM documents WHERE "scannedImageUrl" LIKE 'data:%'`,
      legacySendQueues: `SELECT count(*)::int AS n FROM documents WHERE jsonb_array_length(COALESCE("sendQueue",'[]'::jsonb))>0`,
    };
    for (const [name,sql] of Object.entries(checks)) result.database.checks[name]=(await query(sql))[0].n;
    result.database.senderDeliveryStates=await query(`SELECT status,count(*)::int AS count FROM sender_notifications GROUP BY 1 ORDER BY 1`);
    result.database.commandStates=await query(`SELECT status,count(*)::int AS count FROM commands GROUP BY 1 ORDER BY 1`);
    result.database.foreignKeyCount=(await query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`))[0].n;
    result.database.indexes=await query(`SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`);
    docs=await query(`SELECT id,"scannedFiles","scannedImageUrl" FROM documents`);
    users=await query(`SELECT DISTINCT ON (role) id,role,"officeId" FROM users WHERE role IN ('Admin','Mayor','Receptionist','Office') ORDER BY role,id`);
    const names=(await query(`SELECT datname FROM pg_database WHERE datname='vinzons_digipath_perf_test_20261028'`));
    result.database.restoredTestDatabaseAvailable=names.length===1;
    await client.query('ROLLBACK');
  } catch(error) { result.database={...result.database,error:error.code||error.name}; }
  finally { await client.end().catch(()=>{}); }
  // File existence checks inspect references only, never document bodies.
  const storageRoot=path.resolve(root,'backend',env.UPLOADS_ROOT||'uploads');
  const refs=new Set(); let invalid=0,inline=0,external=0;
  const add=(file)=>{
    for(const value of [file?.storagePath,file?.url]) {
      if(!value)continue;
      if(/^data:/i.test(value)){inline++;continue;}
      let p; try{p=new URL(value,'http://local').pathname;}catch{invalid++;continue;}
      if(!p.startsWith('/uploads/scans/')&&!p.startsWith('uploads/scans/')){external++;continue;}
      try{refs.add(decodeURIComponent(p.replace(/^\/?uploads\/scans\//,'')));}catch{invalid++;}
    }
    for(const page of file?.pages||[])add(page);
  };
  for(const doc of docs){for(const file of doc.scannedFiles||[])add(file);if(doc.scannedImageUrl&&!doc.scannedImageUrl.startsWith('data:'))add({url:doc.scannedImageUrl});}
  let existing=0,missing=0,outsideRoot=0; const scanRoot=path.join(storageRoot,'scans'); let sample;
  for(const ref of refs){const absolute=path.resolve(scanRoot,ref);if(!absolute.startsWith(scanRoot+path.sep)){outsideRoot++;continue;}if(fs.existsSync(absolute)){existing++;sample||=ref;}else missing++;}
  result.storage={uniqueStoredReferences:refs.size,existing,missing,outsideRoot,invalid,external,inlineAttachmentReferences:inline};
  const local='http://127.0.0.1:5000'; const publicRoot=origin(env.PUBLIC_API_URL);
  const observations=await Promise.all([httpGet('local-health',local+'/api/status'),...(publicRoot?[httpGet('public-health',publicRoot+'/api/status')]:[]),httpGet('frontend','https://vinzons-digipath.vercel.app')]);
  result.http=observations.map(sanitized);
  const online=observations.find(x=>x.label==='local-health'&&x.status===200)?local:observations.find(x=>x.label==='public-health'&&x.status===200)?publicRoot:null;
  if(online){
    result.http.push(sanitized(await httpGet('unauthenticated-documents',online+'/api/documents?limit=1')));
    if(sample)result.http.push(sanitized(await httpGet('unauthenticated-existing-scan',online+'/uploads/scans/'+encodeURIComponent(sample))));
    const jwt=req('jsonwebtoken');
    for(const user of users){
      const token=jwt.sign({id:user.id,role:user.role},env.JWT_SECRET,{expiresIn:'60s'});
      for(const suffix of ['/documents?limit=20','/logs?limit=1','/users']){
        result.http.push(sanitized(await httpGet(`${user.role}${suffix.split('?')[0]}`,online+'/api'+suffix,token)));
      }
    }
  }
  const frontResponse=observations.find(x=>x.label==='frontend');
  const asset=frontResponse?._body?.match(/src="([^\"]*\/assets\/[^\"]+\.js)"/)?.[1];
  if(asset){
    const bundle=await httpGet('published-entry-bundle',new URL(asset,'https://vinzons-digipath.vercel.app'));
    const html=fs.existsSync(path.join(root,'dashboard/dist/index.html'))?fs.readFileSync(path.join(root,'dashboard/dist/index.html'),'utf8'):'';
    result.publication={servedEntryMatchesLocalBuild:html.includes(asset),entryGetStatus:bundle.status};
  }
  result.database?.indexes && (result.database.indexCount=result.database.indexes.length);
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.log(JSON.stringify({fatal:error.code||error.name}));process.exitCode=1;});
