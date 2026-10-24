// Future container entry only. Preparation may syntax-check but must never import/run this module locally.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createLedger } from './ledger.mjs';
import { CASES, WINDOW_MS, SOURCE_PIN, RESPONSE_TEXT, PINS, OPS, GUARD_CODES, emptyCases, terminalAt, acceptPayload, observationComplete } from './contract.mjs';

const packet = path.dirname(new URL(import.meta.url).pathname), started = performance.now(), now = () => performance.now() - started;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
let operation = 'entry-admit', failure, browser, server, traceFd, ledger, closing = false, cutoff = null, chain = Promise.resolve();
let traceRows = 0, traceBytes = 0, queued = 0, detached = 0, closedPages = 0, browserClosed = 0, serverClosed = 0;
let expectedManifest = null, manifestSha = null, nodeSha = null, chromiumVersion = null;
const states = [], sockets = new Set(), records = new Map(), wireAliases = new Map();
const evidence = emptyCases(), metrics = {}, serverFacts = Object.fromEntries(CASES.map(name => [name, { accepted: 0, events: 0 }]));
const stage = name => fs.writeSync(3, JSON.stringify({ stage: name }) + '\n');
function fail(op, error) {
  if (failure) return;
  const names = ['Error','TypeError','RangeError','AssertionError','TimeoutError'];
  const codes = ['ENOENT','EACCES','EPERM','EADDRINUSE','ERR_ASSERTION','ERR_MODULE_NOT_FOUND',...GUARD_CODES];
  failure = { operation: OPS.includes(op) ? op : 'entry-admit', name: names.includes(error?.name) ? error.name : 'unknown',
    code: codes.includes(error?.code) ? error.code : 'unknown', stack: hash(String(error?.stack ?? error)) };
}
async function bounded(promise, ms, op) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(op),{code:op})), ms); })]); }
  finally { clearTimeout(timer); }
}
function persist(row) {
  const data = Buffer.from(JSON.stringify(row) + '\n');
  ensure(++traceRows <= 1024 && (traceBytes += data.length) <= 262144 && queued < 256, 'trace-cap');
  queued++;
  const task = chain.then(() => new Promise((resolve, reject) => {
    let offset = 0;
    const write = () => fs.write(traceFd, data, offset, data.length - offset, null, (error, n) => {
      if (error || !n) return reject(error ?? new Error('trace-write'));
      offset += n; if (offset < data.length) write(); else fs.fdatasync(traceFd, e => e ? reject(e) : resolve(true));
    }); write();
  }));
  chain = task; return task.finally(() => queued--);
}
const guardCallback = (op, callback) => (...args) => { try { callback(...args); } catch (error) { fail(op, error); } };
function verifyPacket() {
  const args = process.argv.slice(2);
  ensure(args.length === 2 && args[0] === '--expected-harness-manifest-sha' && /^[a-f0-9]{64}$/.test(args[1]), 'manifest-argument');
  expectedManifest = args[1]; operation = 'manifest-verify';
  const raw = fs.readFileSync(path.join(packet, 'manifest.json')); manifestSha = hash(raw); ensure(manifestSha === expectedManifest, 'manifest-sha');
  const manifest = JSON.parse(raw);
  ensure(manifest.schema === 'r139-required-runtime-assets-v1' && manifest.entry === 'entry.mjs' && manifest.sourcePin === SOURCE_PIN, 'manifest-shape');
  const seen = new Set();
  for (const row of manifest.files) {
    ensure(typeof row.path === 'string' && !row.path.startsWith('/') && !row.path.includes('\\') && row.path.split('/').every(x => x && x !== '.' && x !== '..') && !seen.has(row.path), 'manifest-member');
    seen.add(row.path); const file = path.join(packet, row.path), stat = fs.lstatSync(file);
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size === row.bytes && hash(fs.readFileSync(file)) === row.sha256, 'manifest-member-sha');
  }
  ensure(seen.size === 8 && ['entry.mjs','contract.mjs','ledger.mjs','baseline-client.mjs','candidate-client.mjs','usage-catalogue.mjs','product.patch','source-proof.json'].every(x => seen.has(x)), 'manifest-closure');
  operation = 'runtime-verify';
  const pins = JSON.parse(fs.readFileSync('/runner/pins.json', 'utf8'));
  ensure(process.version === PINS.node && process.platform === 'linux' && process.arch === 'x64' && pins.sourceCommit === SOURCE_PIN && pins.image === PINS.image, 'runtime-pin');
  ensure(fs.realpathSync(process.execPath) === '/runtime/node', 'runtime-executable');
  nodeSha = hash(fs.readFileSync('/runtime/node')); ensure(nodeSha === PINS.nodeSha256, 'node-sha');
  const pw = JSON.parse(fs.readFileSync('/deps/node_modules/playwright/package.json', 'utf8'));
  const browsers = JSON.parse(fs.readFileSync('/deps/node_modules/playwright-core/browsers.json', 'utf8'));
  ensure(pw.version === PINS.playwright && browsers.browsers.some(x => x.name === 'chromium' && String(x.revision) === PINS.revision && x.browserVersion === PINS.chromium), 'package-browser-pin');
  operation = 'source-verify';
  for (const [name, sha] of [['baseline-client.mjs',PINS.baseline],['candidate-client.mjs',PINS.candidate],['usage-catalogue.mjs',PINS.catalogue],['ledger.mjs',PINS.ledger],['product.patch',PINS.patch]]) ensure(hash(fs.readFileSync(path.join(packet,name))) === sha, 'pinned-module-sha');
  ensure(hash(fs.readFileSync('/source/app/web/usage-client.mjs')) === PINS.baseline && hash(fs.readFileSync('/source/app/web/usage-catalogue.mjs')) === PINS.catalogue, 'source-module-sha');
}
function snapshotResult() {
  return { schema: 'r139-body-lifecycle-v1', mode: 'r139-five-case-component-v1', status: failure ? 'failed' : 'correct',
    code: failure ? 'r139-operation-failed' : 'r139-observation-complete', passed: false, acceptance: false, cleanupPassed: false,
    sourcePin: SOURCE_PIN, r139HarnessManifestSha256: manifestSha, r139BaselineClientSha256: PINS.baseline,
    r139CandidateClientSha256: PINS.candidate, r139LedgerSha256: PINS.ledger, nodeSha256: nodeSha,
    nodeVersion: process.version, playwrightVersion: PINS.playwright, chromiumVersion,
    r139Cases: evidence, metrics: { ...metrics, r139ElapsedMs: now(), r139TraceRows: traceRows, r139TraceBytes: traceBytes },
    ...(failure ? { r139FailureOperation: failure.operation, r139ErrorName: failure.name, r139ErrorCode: failure.code, r139ErrorStackSha256: failure.stack } : {}) };
}
function writeFinal() {
  const result = snapshotResult();
  result.cleanupPassed = detached === 5 && closedPages === 5 && browserClosed === 1 && serverClosed === 1 && sockets.size === 0;
  Object.assign(result.metrics, { r139ClosedPages: closedPages, r139DetachedSessions: detached, r139BrowserCloseCompleted: browserClosed,
    r139ServerCloseCompleted: serverClosed, r139OpenFixtureSockets: sockets.size });
  result.passed = !failure && observationComplete(result);
  if (!result.passed) { result.status = 'failed'; result.code = 'r139-operation-failed'; }
  const bytes = Buffer.from(JSON.stringify(result)); ensure(bytes.length <= 32768, 'result-cap');
  fs.writeFileSync('/scratch/case-result.json', bytes, { mode: 0o600 });
  return result;
}
const watchdog = setTimeout(() => { fail('deadline', Object.assign(new Error('r139-deadline'),{code:'r139-deadline'})); try { writeFinal(); stage('error'); stage('result'); } catch {} process.exit(1); }, 90000);
watchdog.unref();
try {
  stage('start'); verifyPacket();
  ensure(!fs.existsSync('/scratch/r139'), 'fresh-output'); fs.mkdirSync('/scratch/r139', { mode: 0o700 });
  fs.mkdirSync('/scratch/r139/home', { mode: 0o700 }); traceFd = fs.openSync('/scratch/r139/trace.ndjson', 'wx', 0o600);
  const moduleBodies = { '/baseline/usage-client.mjs': fs.readFileSync(path.join(packet,'baseline-client.mjs')),
    '/candidate/usage-client.mjs': fs.readFileSync(path.join(packet,'candidate-client.mjs')),
    '/baseline/usage-catalogue.mjs': fs.readFileSync(path.join(packet,'usage-catalogue.mjs')),
    '/candidate/usage-catalogue.mjs': fs.readFileSync(path.join(packet,'usage-catalogue.mjs')) };
  operation = 'fixture-listen'; let origin;
  server = http.createServer(guardCallback('http-request', (req,res) => {
    const url = new URL(req.url, origin);
    res.setHeader('Cache-Control','no-store');
    if (req.method === 'GET' && url.pathname === '/__measure37_probe' && CASES.includes(url.searchParams.get('case'))) {
      res.setHeader('Content-Type','text/html'); res.setHeader('Referrer-Policy','same-origin');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; img-src data:");
      res.end('<!doctype html><title>R139 fixture</title><link rel="icon" href="data:,">'); return;
    }
    if (req.method === 'GET' && Object.hasOwn(moduleBodies,url.pathname)) { res.setHeader('Content-Type','text/javascript'); res.end(moduleBodies[url.pathname]); return; }
    ensure(req.method === 'POST' && url.pathname === '/api/usage' && !url.search, 'unexpected-http');
    const ref = new URL(req.headers.referer); const name = ref.searchParams.get('case');
    ensure(ref.origin === origin && ref.pathname === '/__measure37_probe' && CASES.includes(name), 'server-case-identity');
    const facts = serverFacts[name]; let bytes = 0, chunks = [];
    req.on('error', error => fail('http-request',error)); res.on('error', error => fail('http-request',error));
    req.on('data', guardCallback('http-request', b => { bytes += b.length; ensure(bytes <= 1024,'payload-cap'); chunks.push(b); }));
    res.on('finish', () => { facts.finishedAt = now(); }); res.on('close', () => { facts.closedAt = now(); });
    req.on('end', guardCallback('http-request', () => {
      ensure(facts.accepted === 0 && acceptPayload(name,Buffer.concat(chunks).toString('utf8')),'payload-identity');
      facts.accepted++; facts.events = name === 'baseline' || name === 'candidate' ? 1 : 0; facts.acceptedAt = now(); facts.payloadBytes = bytes;
      res.setHeader('Content-Type','application/json'); res.setHeader('Content-Length',Buffer.byteLength(RESPONSE_TEXT));
      facts.responseBytes = Buffer.byteLength(RESPONSE_TEXT); res.end(RESPONSE_TEXT);
    }));
  }));
  server.on('connection', socket => { sockets.add(socket); if (sockets.size > 32) { fail('http-request',new Error('socket-cap')); socket.destroy(); } socket.on('close',()=>sockets.delete(socket)); socket.on('error',error=>fail('http-request',error)); });
  await bounded(new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); }),3000,'fixture-listen');
  origin = `http://127.0.0.1:${server.address().port}`;
  ledger = createLedger({ ownedOrigin: origin, expectedTargets: 5, maxEvents: 512, maxActive: 64, maxRecent: 64, maxSessions: 5,
    maxWrites: 256, maxDocumentsPerSession: 2, expectedSseRoutes: [], maxExpectedSsePerTarget: 0,
    sink: line => { const row=JSON.parse(line); if(row.event==='request') wireAliases.set(row.request,row); return persist(row); } });
  operation = 'browser-launch'; const { chromium } = await import(pathToFileURL('/deps/node_modules/playwright/index.mjs').href);
  browser = await chromium.launch({ executablePath: PINS.executable, headless: true, timeout: 15000,
    env: { PATH:'/usr/bin:/bin',HOME:'/scratch/r139/home',TMPDIR:'/scratch',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PLAYWRIGHT_BROWSERS_PATH:'/ms-playwright' },
    args:['--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  browser.on('disconnected',()=>{if(!closing)fail('browser-disconnected',new Error('browser-disconnected'));});
  operation='browser-version'; chromiumVersion=browser.version(); ensure(chromiumVersion===PINS.chromium,'browser-version'); stage('browser-ready');
  const context=await browser.newContext({serviceWorkers:'block'}); context.setDefaultTimeout(8000);
  operation='cdp-attach';
  for(const [index,name] of CASES.entries()) {
    const page=await context.newPage(), cdp=await context.newCDPSession(page);
    const s={name,page,cdp,index,docs:new Map(),wires:new Map(),posts:[],closed:false}; states.push(s);
    const ingest=e=>ledger.ingest({target:`case-${index+1}`,session:`session-${index+1}`,at:now(),...e});
    page.on('close',()=>{if(!s.closed){s.closed=true;closedPages++;if(!closing)fail('page-error',new Error('unexpected-page-close'));}});
    page.on('crash',()=>fail('page-crash',new Error('page-crash')));page.on('pageerror',e=>fail('page-error',e));ingest({event:'attach'});
    cdp.on('Network.requestWillBeSent',guardCallback('network-event',e=>{
      ensure(e.loaderId && !e.redirectResponse && s.wires.size<16,'request-epoch');
      if(!s.docs.has(e.loaderId))s.docs.set(e.loaderId,`document-${s.docs.size+1}`);
      const at=now(),alias=ingest({at,event:'request',requestId:e.requestId,document:s.docs.get(e.loaderId),url:e.request.url,method:e.request.method,type:e.type,redirect:false});
      const r={alias,wire:e.requestId,requestedAt:at,method:e.request.method,pathname:new URL(e.request.url).pathname};s.wires.set(e.requestId,r);records.set(`${index}:${e.requestId}`,r);
      if(e.request.method==='POST'){ensure(r.pathname==='/api/usage','post-path');s.posts.push(r);}
    }));
    cdp.on('Network.responseReceived',guardCallback('network-event',e=>{const r=s.wires.get(e.requestId),at=now();ensure(r,'response-request-identity');r.headersAt=at;r.status=e.response.status;ingest({at,event:'response',requestId:e.requestId,status:e.response.status,mime:e.response.mimeType,type:e.type});}));
    cdp.on('Network.loadingFinished',guardCallback('network-event',e=>{const r=s.wires.get(e.requestId),at=now();ensure(r,'terminal-request-identity');r.finishedAt=at;ingest({at,event:'finished',requestId:e.requestId});}));
    cdp.on('Network.loadingFailed',guardCallback('network-event',e=>{const r=s.wires.get(e.requestId),at=now();ensure(r,'terminal-request-identity');r.failedAt=at;r.canceled=e.canceled===true;ingest({at,event:'failed',requestId:e.requestId,canceled:e.canceled});}));
    await cdp.send('Network.enable');ingest({event:'enabled'});
  }
  ensure(ledger.snapshot().counts.requests===0,'pre-navigation-coverage');
  operation='navigation';for(const s of states)await s.page.goto(`${origin}/__measure37_probe?case=${s.name}`,{waitUntil:'load',timeout:8000});
  operation='module-load';
  for(const s of states)await s.page.evaluate(async name=>{
    const state={name,weak:null,status:null,usedHeaders:null,usedFlush:null,bytes:null,flushReturned:0,cancelComplete:0,action:'unknown',consent:'not-applicable'};
    const remember=r=>{state.weak=new WeakRef(r);state.status=r.status;state.usedHeaders=r.bodyUsed?1:0;state.urlMatched=r.url===new URL('/api/usage',location.origin).href&&!r.redirected;return r;};
    const naturalFetch=(...args)=>fetch(...args).then(remember);
    let counter;
    if(name==='baseline'||name==='candidate'){
      const mod=await import(`/${name}/usage-client.mjs`);const pref=localStorage.getItem(mod.USAGE_STORAGE_KEY);
      state.consent=pref===null?'default':pref==='false'?'disabled':'enabled';
      counter=mod.createUsageCounter({storage:localStorage,actor:()=> 'r139-author',width:()=>1024,now:()=>new Date('2026-10-01T12:00:00Z'),fetch:naturalFetch});
      if(!counter.enabled)throw new Error('fixture-consent');
    }
    state.start=async()=>{
      if(counter){state.action='module';counter.count('search');await counter.flush();state.flushReturned=1;const r=state.weak?.deref();state.usedFlush=r?r.bodyUsed?1:0:null;return;}
      const r=remember(await fetch('/api/usage',{method:'POST',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{"events":[]}'}));
      state.flushReturned=1;
      if(name==='ignore'){state.action='none';state.usedFlush=r.bodyUsed?1:0;return;}
      state.action='pending';
      if(name==='consume')r.arrayBuffer().then(b=>{state.bytes=b.byteLength;state.action='complete';},()=>{state.action='failed';});
      else r.body.cancel().then(()=>{state.cancelComplete=1;state.action='complete';},()=>{state.action='failed';});
      state.usedFlush=r.bodyUsed?1:0;
    };
    state.survey=()=>{const r=state.weak?.deref();return {status:state.status,urlMatched:state.urlMatched===true?1:0,usedHeaders:state.usedHeaders,
      usedFlush:state.usedFlush,usedSurvey:r?r.bodyUsed?1:0:null,bytes:state.bytes,flushReturned:state.flushReturned,
      cancelComplete:state.cancelComplete,action:state.action,visibility:document.visibilityState==='visible'?'visible':'hidden',consent:state.consent};};
    globalThis.__r139=state;
  },s.name);
  operation='setup-drain';const setupDeadline=now()+2000;
  while([...records.values()].some(r=>r.finishedAt===undefined)&&now()<setupDeadline)await sleep(20);
  ensure([...records.values()].every(r=>r.finishedAt!==undefined)&&!failure,'setup-network');
  operation='policy-issue';const windowStart=now();cutoff=windowStart+WINDOW_MS;
  Object.assign(metrics,{r139WindowStartMs:windowStart,r139CutoffMs:cutoff});
  void persist({schema:'r139-window-v1',at:windowStart,windowStartMs:windowStart,cutoffMs:cutoff,windowMs:WINDOW_MS}).catch(e=>fail('write-result',e));
  stage('episode-start');
  // start() awaits only headers/flush return; explicit read/cancel controls remain detached.
  // The single cutoff above is never moved if any call is slow or fails.
  await Promise.all(states.map(s=>s.page.evaluate(async()=>{await globalThis.__r139.start();return true;})));
  operation='checkpoint';while(now()<cutoff)await sleep(Math.max(1,cutoff-now()));const capturedAt=now();
  Object.assign(metrics,{r139CheckpointCapturedMs:capturedAt,r139CutoffObservedLateUs:Math.max(0,Math.floor((capturedAt-cutoff)*1000))});
  // Receipt timestamps define the immutable network cutoff. Later cleanup cannot repair these outcomes.
  for(const s of states){const row=evidence[s.name],post=s.posts.length===1?s.posts[0]:null,f=serverFacts[s.name];row.observedPostCount=s.posts.length;
    if(post){const alias=wireAliases.get(post.alias);row.requestOrdinal=Number(post.alias.slice(1));row.targetOrdinal=s.index+1;row.sessionOrdinal=Number(alias?.session?.slice(1))||null;row.documentOrdinal=Number(alias?.document?.slice(1))||null;
      row.requestIdentityMatched=alias&&alias.method==='POST'&&alias.path==='/api/usage'&&alias.owned?1:0;row.responseIdentityMatched=post.headersAt!==undefined&&post.headersAt<=cutoff?1:0;
      row.responseStatus=post.headersAt!==undefined&&post.headersAt<=cutoff?post.status:null;row.terminal=terminalAt(post,cutoff);}
    row.serverAcceptedRequests=f.acceptedAt!==undefined&&f.acceptedAt<=cutoff?f.accepted:0;row.serverAcceptedEvents=f.acceptedAt!==undefined&&f.acceptedAt<=cutoff?f.events:0;
    row.serverPayloadBytes=f.payloadBytes??null;row.serverResponseBytes=f.responseBytes??null;row.serverFinishedByCutoff=f.finishedAt!==undefined&&f.finishedAt<=cutoff?1:0;row.serverClosedByCutoff=f.closedAt!==undefined&&f.closedAt<=cutoff?1:0;}
  operation='body-survey';for(const s of states){const fact=await s.page.evaluate(()=>globalThis.__r139.survey());const row=evidence[s.name];
    row.bodyUsedOnHeaders=fact.usedHeaders;row.bodyUsedAfterFlush=fact.usedFlush;row.bodyUsedAtSurvey=fact.usedSurvey;row.bodyReadBytes=fact.bytes;
    row.flushReturned=fact.flushReturned;row.cancelComplete=fact.cancelComplete;row.action=fact.action;row.visibility=fact.visibility;row.consent=fact.consent;
    row.surveyAfterCutoffUs=Math.max(0,Math.floor((now()-cutoff)*1000));ensure(fact.urlMatched===1,'response-url-identity');
    row.responseIdentityMatched=row.responseIdentityMatched===1&&fact.status===row.responseStatus?1:0;ensure(row.responseIdentityMatched===1,'response-status-identity');}
  await ledger.flush();await chain;const snap=ledger.snapshot();
  Object.assign(metrics,{r139WindowMs:WINDOW_MS,r139CaseCount:5,r139CoverageTargets:snap.readyTargets,r139LedgerFaultCount:snap.faults.length,
    r139LedgerDropped:snap.counts.dropped,r139LedgerPendingWrites:snap.pendingWrites,r139PreClosePersisted:1,
    r139FinitePendingAtCutoff:[...records.values()].filter(r=>r.requestedAt<=cutoff&&terminalAt(r,cutoff)==='unobserved').length,
    r139UnknownBodyUsedAtSurvey:CASES.filter(name=>evidence[name].bodyUsedAtSurvey===null).length});
  stage('episode-end');operation='validate';ensure(!failure&&snap.faults.length===0,'observational-coverage');
} catch(error) { fail(operation,error);try{stage('error');}catch{} }
finally {
  closing=true;try{stage('cleanup-start');}catch{}
  operation='cleanup-cdp';for(const s of states)try{await bounded(s.cdp.detach(),1500,'cdp-detach');detached++;}catch(e){fail(operation,e);}
  operation='cleanup-browser';if(browser)try{await bounded(browser.close(),8000,'browser-close');browserClosed=1;}catch(e){fail(operation,e);}
  operation='cleanup-http';if(server)try{server.closeAllConnections();if(server.listening)await bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),2000,'http-close');
    const socketsDeadline=now()+1000;while(sockets.size&&now()<socketsDeadline)await sleep(5);ensure(sockets.size===0,'http-close');serverClosed=1;}catch(e){fail(operation,e);}
  try{await chain;if(traceFd!==undefined){fs.fdatasyncSync(traceFd);fs.closeSync(traceFd);}}catch(e){fail('write-result',e);}
  try{stage('cleanup-end');const result=writeFinal();stage('result');process.exitCode=result.passed?0:1;}catch{process.exitCode=1;}
  clearTimeout(watchdog);
}
