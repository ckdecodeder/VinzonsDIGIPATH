// Follow-up audit: aggregate queries in READ ONLY and GET/HEAD only; secrets and private rows never printed.
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'backend/package.json'));
const env=req('dotenv').parse(fs.readFileSync(path.join(root,'backend/.env')));
const origin=value=>{try{return new URL(value).origin.replace(/^ws/,'http');}catch{return null;}};
const result={observedAt:new Date().toISOString()};
(async()=>{
  const client=new (req('pg').Client)({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000});
  let sample,roles=[];
  try{
    await client.connect();await client.query('BEGIN READ ONLY');
    const q=async sql=>(await client.query(sql)).rows;
    result.missingCustodyGroups=await q(`SELECT status,count(*)::int AS count FROM documents d LEFT JOIN offices o ON o.id=d."currentOfficeId" WHERE o.id IS NULL GROUP BY status ORDER BY status`);
    result.receiptMismatchGroups=await q(`SELECT (COALESCE("receivedBy",'')='') AS receiverMissing,(COALESCE("receivedAt",'')='') AS timestampMissing,count(*)::int AS count FROM transmissions WHERE (COALESCE("receivedBy",'')='')<>(COALESCE("receivedAt",'')='') GROUP BY 1,2`);
    result.mismatchedReceiptsBlockingDocuments=(await q(`SELECT count(DISTINCT d.id)::int AS count FROM documents d JOIN transmissions t ON t."documentId"=d.id WHERE COALESCE(t."receivedBy",'')='' AND COALESCE(t."receivedAt",'')<>''`))[0].count;
    result.legacyQueueGroups=await q(`SELECT status,count(*)::int AS count FROM documents WHERE jsonb_array_length(COALESCE("sendQueue",'[]'::jsonb))>0 GROUP BY status ORDER BY status`);
    const docs=await q(`SELECT id,"scannedFiles","scannedImageUrl" FROM documents`);
    const storageRoot=env.UPLOADS_ROOT?path.resolve(root,env.UPLOADS_ROOT):path.join(root,'backend/uploads');
    process.env.UPLOADS_ROOT=storageRoot;
    const {resolveScanPath}=req('./config/storage');
    const existence=file=>{const p=resolveScanPath(file);return p?fs.existsSync(p):null;};
    const counts={documentsWithMissingTopLevelAttachments:0,missingTopLevelAttachments:0,documentsWithNoExistingTopLevelAttachment:0,documentsWithMissingScannerPages:0,missingScannerPages:0,missingCovers:0,missingCoverButExistingAttachment:0};
    for(const d of docs){
      const files=d.scannedFiles||[];let topMissing=0,topExisting=0,pagesMissing=0;
      for(const f of files){const e=existence(f);if(e===false){topMissing++;counts.missingTopLevelAttachments++;}if(e===true){topExisting++;sample||=f;}
        for(const p of f.pages||[])if(existence(p)===false){pagesMissing++;counts.missingScannerPages++;}}
      if(topMissing)counts.documentsWithMissingTopLevelAttachments++;
      if(files.length&&!topExisting)counts.documentsWithNoExistingTopLevelAttachment++;
      if(pagesMissing)counts.documentsWithMissingScannerPages++;
      if(d.scannedImageUrl&&!/^data:/.test(d.scannedImageUrl)&&existence({url:d.scannedImageUrl})===false){counts.missingCovers++;if(topExisting)counts.missingCoverButExistingAttachment++;}
    }
    result.storage=counts;
    roles=await q(`SELECT DISTINCT ON (role) id,role FROM users WHERE role IN ('Admin','Office') ORDER BY role,id`);
    await client.query('ROLLBACK');
  }finally{await client.end();}
  const base=origin(env.PUBLIC_API_URL);
  result.publicHttp=[];
  const get=async(label,url,token,range)=>{
    const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(range?{Range:'bytes=0-15'}:{})}});
    const body=range?await r.arrayBuffer():await r.text();let json;if(!range)try{json=JSON.parse(body);}catch{}
    result.publicHttp.push({label,status:r.status,bytes:range?body.byteLength:Buffer.byteLength(body),total:json?.total,contentType:r.headers.get('content-type'),contentEncoding:r.headers.get('content-encoding')});return {body,json};
  };
  if(base&&sample){const p=new URL(sample.url||'/'+sample.storagePath,base).pathname;await get('unauthenticated-scan-range',base+p,null,true);}
  if(base)for(const user of roles){const token=req('jsonwebtoken').sign({id:user.id,role:user.role},env.JWT_SECRET,{expiresIn:'60s'});
    const r=await get(`${user.role}-public-logs`,base+'/api/logs?limit=20',token);
    if(user.role==='Office')result.officeLogPageIncludesOtherUsers=r.json?.items?.some(item=>item.userId!==user.id);
    await get(`${user.role}-public-document-list`,base+'/api/documents?limit=20',token);
  }
  const {body:html}=await get('published-home','https://vinzons-digipath.vercel.app');
  const asset=html.match(/src="([^\"]*\/assets\/[^\"]+\.js)"/)?.[1];
  if(asset){const {body:bundle}=await get('published-main-bundle',new URL(asset,'https://vinzons-digipath.vercel.app'));
    const pages=[...new Set(bundle.match(/(?:DocumentList|ReportsPage)-[a-z0-9]+\.js/g)||[])];
    result.publication={entryAsset:asset,pages:[],frontendEmbedsConfiguredBackend:base?bundle.includes(base):null};
    for(const page of pages){const {body}=await get('published-'+page.split('-')[0],new URL('/assets/'+page,'https://vinzons-digipath.vercel.app'));
      result.publication.pages.push({page,hasReceiptConfirmation:/Confirm receipt|confirmReceipt|Confirm Receipt/.test(body),hasReportWorker:/reportPdf\.worker|reportPdf\.worker-|reportPdf\.worker/.test(body),matchesLocalArtifact:fs.existsSync(path.join(root,'dashboard/dist/assets',page))});}
  }
  const {loadEnv}=req('../dashboard/node_modules/vite');const effective=loadEnv('production',path.join(root,'dashboard'),'');
  result.effectiveBuildConfiguration={apiMatchesConfiguredBackend:origin(effective.VITE_API_BASE_URL)===base,wsMatchesConfiguredBackend:origin(effective.VITE_WS_URL)===base};
  // Tracked database exports: report only counts and whether password material exists.
  const exports=fs.readdirSync(path.join(root,'dbcollections')).filter(n=>n.endsWith('.json'));
  result.trackedExports={files:exports.length,rows:0,usersWithPasswordMaterial:0};
  for(const name of exports){const rows=JSON.parse(fs.readFileSync(path.join(root,'dbcollections',name)));if(Array.isArray(rows)){result.trackedExports.rows+=rows.length;if(name.endsWith('.users.json'))result.trackedExports.usersWithPasswordMaterial=rows.filter(r=>r.password).length;}}
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.log(JSON.stringify({fatal:error.code||error.name}));process.exitCode=1;});
