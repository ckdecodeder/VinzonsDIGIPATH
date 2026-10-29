// Reproductions of audit findings against actual handlers with synthetic, in-memory dependencies.
// Does not load .env, use a real database, send notifications, or connect to hardware.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'backend/package.json'));
const express = req('express');
const helpers = req('./utils/helpers');
const auth = req('./middleware/auth');
const { ModelWrapper } = req('./models/ModelWrapper');
const results = [];
const query = (value) => ({ lean: async () => value, sort() { return this; }, select() { return this; }, limit() { return this; }, skip() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const load = (name, overrides) => {
  const filename = path.join(root, 'backend/routes', `${name}.js`);
  const realRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, process, Buffer, setTimeout, clearTimeout, require: (id) => overrides[id] || realRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
};
(async () => {
  const docs = new Map([['VICTIM', { id: 'VICTIM', subject: 'Synthetic original', trackingNumber: 'SYNTHETIC-ORIGINAL', currentOfficeId: 'OTHER', originOfficeId: 'OTHER', status: 'Received', intakeStatus: 'Approved', documentTypeId: 'TYPE', scannedFiles: [{ id: 'OLD', url: '/synthetic-old.pdf' }] }]]);
  const syntheticSeq = { tableName: 'documents', upsert: async (data) => { const next = { ...docs.get(data.id), ...data }; docs.set(data.id, next); return [{ toJSON: () => next }]; } };
  const Document = ModelWrapper.makeConstructable(new ModelWrapper(syntheticSeq));
  // Route reads remain synthetic; writes above use the real ModelInstance.save() implementation.
  const wrappedDocument = new Proxy(Document, { get(target, prop) {
    if (prop === 'findOne') return ({ id }) => query(docs.get(id) || null);
    if (prop === 'findOneAndUpdate') return async (filter, updates) => {
      if (failDocumentSave) throw new Error('Synthetic database save failure');
      const doc = docs.get(filter.id); Object.assign(doc, updates.$set || updates); return doc;
    };
    return target[prop];
  } });
  let failDocumentSave = false, deletedBeforeSave = false, bridgeTarget;
  let archives = new Map(), commands = [];
  let releaseCommands;
  const commandBarrier = new Promise(resolve => { releaseCommands = resolve; });
  let pendingChecks = 0;
  function Archive(data) { Object.assign(this, data); this.save = async () => { archives.set(this.id, { ...data }); }; }
  let archiveChecks=0,releaseArchives;
  const archiveBarrier=new Promise(resolve=>{releaseArchives=resolve;});
  Archive.findOne = ({ id,documentId }) => ({lean:async()=>{
    const snapshot=id?archives.get(id)||null:[...archives.values()].find(item=>item.documentId===documentId)||null;
    if(documentId==='RACE'){archiveChecks++;if(archiveChecks===2)releaseArchives();await archiveBarrier;}
    return snapshot;
  }});
  Archive.findOneAndUpdate = async ({ id }, updates) => { const row = archives.get(id); Object.assign(row, updates); return row; };
  Archive.findOneAndDelete = async ({ id }) => { const row = archives.get(id); archives.delete(id); return row; };
  function Command(data) { Object.assign(this, data); this.save = async () => { commands.push({ ...data }); }; }
  Command.find = () => query([]);
  Command.findOne = () => ({ lean: async () => { pendingChecks++; if (pendingChecks === 2) releaseCommands(); await commandBarrier; return null; } });
  Command.updateMany = async () => {};
  const offices = [{ id: 'SOURCE', name: 'Reception' }, { id: 'DEST', name: 'Destination' }, { id: 'MAYOR', name: 'Mayor Office' }];
  const models = {
    Document: wrappedDocument, Archive, Command,
    Office: { find: () => query(offices), findOne: ({ id }) => query(offices.find(item => item.id === id)) },
    DocumentType: { findOne: () => query({ id: 'TYPE', requiresMayorApproval: false }) },
    User: { findOne: () => query({ id: 'RECEPTION', officeId: 'SOURCE' }) },
    Transmission: { findOne: () => query(null) },
    SenderNotification: { countDocuments: async () => 0 },
    Notification: { deleteMany: async () => {} },
    Device: {}, DeviceEvent: {},
  };
  const overrides = {
    '../models': models,
    '../middleware/auth': { ...auth, protect: (r,s,n) => n() },
    '../utils/helpers': { ...helpers, createLogEntry: async () => {}, createNotification: async () => {}, notifyApprovalUsers: async () => {}, appendDocumentTimeline: async (id,event,updates) => { const doc=docs.get(id); Object.assign(doc,updates); return doc; } },
    '../utils/attachments': { persistAttachments: async (r,files) => files, removeOrphanedAttachments: async () => { deletedBeforeSave=true; } },
    '../utils/documentHandoffs': { sendHandoffs: async () => { throw new Error('Synthetic handoff unavailable'); } },
    '../utils/senderNotifications': { normalizeSenderNotificationChannels: () => [], queueSenderNotifications: async () => {} },
    '../services/devicePresence': { getDeviceSnapshot: async () => ({ connected: true }), hardwarePresenceEvents: [] },
    '../utils/bridge': { ...req('./utils/bridge'), fetchBridgeEndpoint: async (base,endpoint) => { bridgeTarget=base+endpoint;return {ok:true,text:async()=>'{}'}; } },
    '../utils/realtime': { broadcastDataInvalidate: () => {}, broadcastCommandUpdated: () => {}, pushCommandToDevice: () => false },
  };
  const app=express(); app.use(express.json());
  app.use((r,s,n)=>{r.user={id:'SYNTHETIC-USER',role:r.headers['x-role']||'Admin',officeId:r.headers['x-office']||'SOURCE'};n();});
  for(const name of ['documents','archives'])app.use('/'+name,load(name,overrides));
  app.use('/',load('devices',overrides));
  app.use((err,r,s,n)=>s.status(err.status||500).json({message:err.message}));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(url,method,body,role='Admin',office='SOURCE')=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','x-role':role,'x-office':office},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  try {
    // Registration accepts a supplied id and real .save() upserts an existing out-of-office document.
    const overwrite=await request('/documents','POST',{id:'VICTIM',subject:'Synthetic replacement',senderName:'Synthetic sender',destinationOfficeId:'DEST',scannedFiles:[{id:'NEW',url:'/synthetic-new.pdf'}]},'Office');
    assert.equal(docs.get('VICTIM').subject,'Synthetic replacement');
    assert.equal(docs.get('VICTIM').currentOfficeId,'SOURCE');
    results.push({probe:'create-overwrites-existing-document',confirmed:true,httpStatus:overwrite.status,originalOverwrittenBeforeHandoffFailure:true});
    // Approval user in a different office signs through an API action hidden by the frontend.
    docs.set('ACTION',{id:'ACTION',subject:'Synthetic action',status:'Received',intakeStatus:'Approved',currentOfficeId:'OTHER',timeline:[]});
    const action=await request('/documents/ACTION/process-note','POST',{action:'sign_document'},'Mayor','MAYOR');
    assert.equal(action.status,200);assert.equal(docs.get('ACTION').status,'Signed');
    results.push({probe:'sign-without-current-custody',confirmed:true,httpStatus:action.status});
    // Removed files are deleted before the database accepts the replacement attachment list.
    docs.set('FILES',{id:'FILES',subject:'Synthetic files',status:'Received',intakeStatus:'Approved',currentOfficeId:'SOURCE',scannedFiles:[{id:'OLD',url:'/old.pdf'}]});
    failDocumentSave=true;
    const files=await request('/documents/FILES','PUT',{scannedFiles:[{id:'NEW',url:'/new.pdf'}]});
    assert.equal(files.status,500);assert(deletedBeforeSave);failDocumentSave=false;
    results.push({probe:'attachment-deletion-precedes-failed-database-save',confirmed:true,httpStatus:files.status});
    // Archive metadata can be rebound to a different document; removing it restores that other document.
    archives.set('ARC',{id:'ARC',documentId:'ARCHIVED',statusBeforeArchive:'Signed'});
    docs.set('ARCHIVED',{id:'ARCHIVED',status:'Archived'});docs.set('UNRELATED',{id:'UNRELATED',status:'Received'});
    assert.equal((await request('/archives/ARC','PUT',{documentId:'UNRELATED',statusBeforeArchive:'Signed'})).status,200);
    assert.equal((await request('/archives/ARC','DELETE')).status,200);
    assert.equal(docs.get('UNRELATED').status,'Signed');assert.equal(docs.get('ARCHIVED').status,'Archived');
    results.push({probe:'archive-rebinding-changes-unrelated-document',confirmed:true,originalStillArchived:true,unrelatedBecameSigned:true});
    docs.set('RACE',{id:'RACE',subject:'Synthetic concurrent archive',status:'Signed',intakeStatus:'Approved',currentOfficeId:'SOURCE',sendQueue:[]});
    const simultaneousArchives=await Promise.all([request('/archives','POST',{id:'ARC-A',documentId:'RACE'}),request('/archives','POST',{id:'ARC-B',documentId:'RACE'})]);
    assert(simultaneousArchives.every(item=>item.status===200));
    assert.equal([...archives.values()].filter(item=>item.documentId==='RACE').length,2);
    results.push({probe:'simultaneous-archive-creation',confirmed:true,statuses:simultaneousArchives.map(item=>item.status),duplicateArchiveRows:2});
    // Two real /commands handlers observe no pending command before either is saved.
    const queued=await Promise.all([request('/commands','POST',{id:'CMD-A',deviceId:'SYNTHETIC',command:'SCAN'}),request('/commands','POST',{id:'CMD-B',deviceId:'SYNTHETIC',command:'SORT'})]);
    assert(queued.every(item=>item.status===201));assert.equal(commands.length,2);
    results.push({probe:'simultaneous-scanner-command-check-then-save',confirmed:true,statuses:queued.map(item=>item.status),activeCommands:commands.length});
    const bridge=await request('/device/bridge/status?bridgeUrl=http%3A%2F%2Faudit.invalid%3A8080','GET',null,'Mayor');
    assert.equal(bridge.status,200);assert.equal(bridgeTarget,'http://audit.invalid:8080/status');
    results.push({probe:'bridge-status-accepts-arbitrary-user-supplied-host',confirmed:true,externalRequestIntercepted:true});
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  // Real hub broadcasts a complete result document to an unrelated Office socket.
  const { RealtimeHub }=req('./ws/realtimeHub');const hub=new RealtimeHub();hub.pushDeviceSnapshotToClient=()=>{};const messages=[];
  const socket={OPEN:1,readyState:1,auth:{kind:'user',userId:'UNRELATED',role:'Office'},subscriptions:new Set(),send:value=>messages.push(JSON.parse(value))};
  hub.userClients.add(socket);hub.broadcastCommandUpdated({id:'PRIVATE-COMMAND',requestedBy:'OTHER'},{id:'PRIVATE-DOC',scannedText:'Synthetic private OCR',senderContact:'SYNTHETIC'});
  assert.equal(messages[0].resultDocument.scannedText,'Synthetic private OCR');
  results.push({probe:'websocket-result-document-broadcast-to-unrelated-office',confirmed:true,receivedFullResultDocument:true});
  // A valid signed token for a nonexistent user is accepted without checking user existence.
  const jwt=req('jsonwebtoken');const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='synthetic-audit-secret';
  try{const sent=[];const ws={OPEN:1,readyState:1,subscriptions:new Set(),send:x=>sent.push(JSON.parse(x)),close:()=>{}};
    hub.authenticateUser(ws,jwt.sign({id:'NONEXISTENT',role:'Admin'},process.env.JWT_SECRET,{expiresIn:'1s'}));
    assert.equal(ws.auth.userId,'NONEXISTENT');assert(sent.some(item=>item.type==='auth:ok'));
    results.push({probe:'websocket-accepts-signed-token-without-account-lookup',confirmed:true});
  }finally{if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
  // Real print helper writes an unescaped stored attachment name into a same-origin popup.
  const attachment={id:'SYNTHETIC-ATT',name:'</title><script>window.__syntheticAudit=true</script><title>',type:'image/png',url:'/synthetic.png'};
  const persisted=await req('./utils/attachments').persistAttachment({},attachment);
  const source=fs.readFileSync(path.join(root,'dashboard/src/utils/attachmentDownload.js'),'utf8');
  const fn=source.slice(source.indexOf('export const printImageAsPdf ='),source.indexOf('const downloadRaster =')).replace('export const printImageAsPdf =','module.exports =');
  let popupHtml='';const context={module:{exports:{}},getAttachmentSource:f=>f.url,window:{open:()=>({document:{write:html=>{popupHtml=html;},close:()=>{}},focus:()=>{},print:()=>{}})}};
  vm.runInNewContext(fn,context);context.module.exports(persisted);
  assert(popupHtml.includes('<script>window.__syntheticAudit=true</script>'));
  results.push({probe:'stored-attachment-name-injected-as-active-print-markup',confirmed:true,scriptMarkupUnescaped:true,browserExecutionNotAttempted:true});
  console.log(JSON.stringify({observedAt:new Date().toISOString(),productionWrites:0,hardwareConnections:0,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
