// Real routed-server residency. Gameplay stays in temporary directories.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, cp, copyFile, rm, mkdir, realpath } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { getHeapStatistics } from 'node:v8';
import { cpus } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runFile = promisify(execFile), origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fail(kind, status) { const error = new Error(kind); error.status = status; throw error; }
function stats(values) {
  const sorted = [...values].sort((a,b) => a-b), q = p => sorted[Math.max(0, Math.ceil(sorted.length*p)-1)];
  return { n: sorted.length, median: sorted.length % 2 ? q(.5) : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,
    min: sorted[0], max: sorted.at(-1), p50: q(.5), p95: q(.95) };
}
function usage(pid) {
  const text = readFileSync(`/proc/${pid}/status`, 'utf8');
  return { rss: Number(/^VmRSS:\s+(\d+)/m.exec(text)?.[1] ?? 0)*1024,
    hwm: Number(/^VmHWM:\s+(\d+)/m.exec(text)?.[1] ?? 0)*1024 };
}
function memoryProbe() {
  let pids = [], nextScan = 0, peak = 0, serverPeak = 0, calcPeak = 0, countPeak = 0;
  const sample = () => {
    if (performance.now() >= nextScan) {
      nextScan = performance.now()+250;
      const rows = [];
      for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
        try { rows.push([Number(name), Number(readFileSync(`/proc/${name}/stat`,'utf8').split(') ').at(-1).split(' ')[1])]); } catch {}
      }
      const own = new Set([process.pid]);
      for (let change = true; change;) { change = false; for (const [pid,parent] of rows) if (own.has(parent) && !own.has(pid)) { own.add(pid); change=true; } }
      pids = [...own].filter(pid => pid !== process.pid);
    }
    const server = usage(process.pid), calculators = [];
    for (const pid of pids) { try { const value = usage(pid); if (value.rss) calculators.push(value); } catch {} }
    const calculatorRSS = calculators.reduce((n,v) => n+v.rss,0), combinedRSS = server.rss+calculatorRSS;
    peak = Math.max(peak, combinedRSS); serverPeak = Math.max(serverPeak,server.rss); calcPeak = Math.max(calcPeak,calculatorRSS); countPeak = Math.max(countPeak,calculators.length);
    return { serverHeapUsed: process.memoryUsage().heapUsed, heapLimit: getHeapStatistics().heap_size_limit, serverRSS: server.rss, calculatorRSS, combinedRSS, calculatorCount: calculators.length,
      serverHwm: server.hwm, calculatorHwmSum: calculators.reduce((n,v) => n+v.hwm,0), peakRSS: peak, serverPeakRSS: serverPeak, calculatorPeakRSS: calcPeak, maxCalculators: countPeak };
  };
  return { sample, reset() { peak=serverPeak=calcPeak=countPeak=0; return sample(); } };
}
function request(base, route, headers = {}) {
  return new Promise((resolve,reject) => {
    const start = performance.now(), chunks=[];
    const req = http.get(base+route, { agent:false, headers }, res => {
      res.on('data', value => chunks.push(value)); res.on('error',reject);
      res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, bytes:Buffer.concat(chunks), wallMs:performance.now()-start }));
    });
    req.setTimeout(600000, () => req.destroy(new Error('RequestTimeout'))); req.on('error',reject);
  });
}
async function application(config) {
  process.env.RS3_DATASET='duo-legacy'; process.env.RS3_PACKS_DIR=config.packs;
  process.env.RS3_GAME_DEFAULTS_FILE=config.defaults; process.env.RS3_TASK_WORKER_MODE='process';
  for (const key of ['RS3_PACK_SELECTION','RS3_DATASET_PROFILE','RS3_DATASET_PROFILE_SHA256','RS3_GAME_DATA_DIR','RS3_STARTUP_TIMING_LOG','RS3_PUBLIC_ORIGIN','RS3_LOOPBACK_PORT','RS3_LOOPBACK_ROLE']) delete process.env[key];
  process.env.RS3_DISCORD_CLIENT_ID='synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE=path.join(config.directory,'synthetic-secret');
  for (const key of ['RS3_GOOGLE_CLIENT_ID','RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
  const module = name => import(pathToFileURL(path.join(config.runtime,'app',name)).href);
  const { createServer }=await module('server.mjs');
  const grants=new Map(), access=new Map(); let sequence=0;
  const provider = { async fetch(url,options) {
    if (url.endsWith('/oauth2/token')) {
      const form=new URLSearchParams(options.body), grant=grants.get(form.get('code'));
      if (!grant) fail('ProviderError');
      if (createHash('sha256').update(form.get('code_verifier')).digest('base64url') !== grant.challenge) fail('ProviderError');
      const token='synthetic-'+form.get('code'); access.set(token,grant.subject); return Response.json({access_token:token});
    }
    if (url !== 'https://discord.com/api/users/@me') fail('ProviderError');
    return Response.json({id:access.get(options.headers.Authorization.slice(7))});
  } };
  const app=await createServer({ dataDir:path.join(config.directory,'legacy'), port:0, loopbackPort:0, loopbackRole:'public', publicOrigin:origin,
    signIn:'optional', signInProvider:provider, predictionPrewarm:false, retention:false,
    multiPicker:{registryDir:path.join(config.directory,'registry'),pickerRoot:path.join(config.directory,'pickers'),tombstoneDir:path.join(config.directory,'tombstones'),maxOpenContexts:config.maxContexts,idleCloseMs:3600000},
    taskWorkerOptions:{idleMs:3600000,deadlineMs:600000,firstCalculationDeadlineMs:600000,startupDeadlineMs:120000,maxQueue:64},
    runeMetrics:{fetchImpl:async()=>{throw new Error('Offline');}},originalSync:{fetchImpl:async()=>{throw new Error('Offline');}},
    rateLimits:{unauthenticated:100000,expensivePerIdentity:100000},shutdownDeadlineMs:5000 });
  await app.listen();
  const publicBase=`http://127.0.0.1:${app.loopbackAddress().port}`, privateBase=`http://127.0.0.1:${app.address().port}`;
  const send=(route,cookie)=>request(publicBase,route,{...proxy,...(cookie?{Cookie:cookie}:{})});
  async function login(subject) {
    const begin=await send('/auth/discord'); if (begin.status!==303) fail('LoginBegin',begin.status);
    const auth=new URL(begin.headers.location), code=String(++sequence);
    grants.set(code,{subject,challenge:auth.searchParams.get('code_challenge')});
    const callback=await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,begin.headers['set-cookie'][0].split(';')[0]);
    if (callback.status!==303) fail('LoginCallback',callback.status);
    const cookie=callback.headers['set-cookie'].find(value=>value.startsWith('duo_access='));
    if (!cookie) fail('LoginCookie'); return cookie.split(';')[0];
  }
  return {app,module,send,login,privateSend:route=>request(privateBase,route,{Authorization:'Bearer '+app.store.getAccessToken()})};
}
async function setup(config) {
  await cp(config.source,path.join(config.directory,'legacy'),{recursive:true,dereference:true});
  await copyFile(config.source+'.dataset.json',path.join(config.directory,'legacy.dataset.json'));
  await writeFile(path.join(config.directory,'synthetic-secret'),'synthetic-secret',{mode:0o600,flag:'wx'});
  globalThis.probeStage=1;
  const runtime=await application(config); let grown, members, dataset;
  try {
    for (let i=1;i<config.maxContexts;i++) await runtime.login(String(10000+i));
    grown=runtime.app.store.getState(); members=grown.members.map(member=>member.id);
    dataset=runtime.app.dataset;
  } finally { await runtime.app.close(); }
  const registryFile=path.join(config.directory,'registry/registry.json'), registry=JSON.parse(await readFile(registryFile,'utf8'));
  const { BACKUP_FORMAT }=await runtime.module('core/state.mjs');
  const { openStore }=await runtime.module('storage/store.mjs');
  grown.provenance={...grown.provenance,dataset:{id:dataset.datasetId,contractVersion:dataset.datasetContractVersion,digest:dataset.digest}};
  const grownJSON=JSON.stringify({format:BACKUP_FORMAT,schemaVersion:1,state:grown});
  let compactStateBytes=0;
  if (config.shape==='grown') {
    const seedDirectory=path.join(config.directory,'normalized-seed');
    const seed=await openStore({dataDir:seedDirectory,initialState:grown,retention:false});
    try { if(sha(JSON.stringify(seed.getState()))!==sha(JSON.stringify(grown))) fail('SeedNormalizationMismatch'); } finally { await seed.close(); }
    compactStateBytes=(await readFile(path.join(seedDirectory,'state.json'))).length;
    for (const picker of registry.pickers.filter(p=>p.kind==='default')) {
      picker.memberIds=members;
      const account=registry.accounts.find(a=>a.id===picker.ownerAccountId);
      for (const membership of account.memberships) if (membership.pickerId===picker.id) membership.memberId=members[0];
      const target=path.join(config.directory,'pickers',picker.id);
      for(const name of ['state.json','static','history','backups']) {
        try { await cp(path.join(seedDirectory,name),path.join(target,name),{recursive:true,errorOnExist:true,force:false}); } catch(error) { if(error.code!=='ENOENT')throw error; }
      }
      await copyFile(path.join(config.directory,'legacy.dataset.json'),target+'.dataset.json');
    }
    await writeFile(registryFile,JSON.stringify(registry)+'\n',{mode:0o600});
    await rm(seedDirectory,{recursive:true,force:true});
  }
  return {datasetDigest:dataset.digest,sourceStateHash:sha(await readFile(path.join(config.source,'state.json'))),
    compactStateBytes,shapeHash:sha(grownJSON),shapeBytes:Buffer.byteLength(grownJSON),memberCount:members.length,
    defaultsHash:sha(await readFile(config.defaults)),packHashes:Object.values(dataset.workerSelection().selection??{}).filter(v=>v?.sha256).map(v=>v.sha256).sort()};
}
async function trial(config) {
  const probe=memoryProbe(); let app, timer, last, nextCheckpoint=0;
  const guard=()=>{
    last=probe.sample();
    if (performance.now()>=nextCheckpoint) { nextCheckpoint=performance.now()+1000; writeFileSync(config.result+'.last',JSON.stringify({stage:globalThis.probeStage,openedContexts:globalThis.openedContexts??1,memory:last})); }
    const limit=Number(readFileSync('/sys/fs/cgroup/memory.max','utf8')),current=Number(readFileSync('/sys/fs/cgroup/memory.current','utf8'));
    if (Number.isFinite(limit) && current>limit-1024**3) {
      writeFileSync(config.result,JSON.stringify({aborted:true,count:config.count,shape:config.shape,stage:globalThis.probeStage,memory:last,cgroupBytes:current,limitBytes:limit}));
      process.exit(75);
    }
  };
  timer=setInterval(guard,50); timer.unref();
  try {
    globalThis.probeStage=2; const start=performance.now(), runtime=await application(config); app=runtime.app;
    const startupMs=performance.now()-start;
    const registry=JSON.parse(await readFile(path.join(config.directory,'registry/registry.json'),'utf8'));
    const accounts=registry.accounts.filter(a=>a.defaultPickerId).sort((a,b)=>a.identities[0].subject.localeCompare(b.identities[0].subject));
    const cookies=[]; for (const account of accounts.slice(0,config.count-1)) cookies.push(await runtime.login(account.identities[0].subject));
    const member=app.store.getCalculationSnapshot().members[0].id;
    const ownedMembers=accounts.slice(0,config.count-1).map(a=>registry.pickers.find(p=>p.id===a.defaultPickerId).memberIds[0]);
    probe.reset(); globalThis.probeStage=3; globalThis.openedContexts=1; const opens=[];
    for (const [index,cookie] of cookies.entries()) {
      if (config.directLast && index===cookies.length-1) continue;
      const response=await runtime.send('/api/session',cookie);
      if (response.status!==200) { const error=new Error('OpenContext'); error.status=response.status; error.bodyHash=sha(response.bytes); throw error; }
      opens.push(response.wallMs); globalThis.openedContexts++; guard();
    }
    await pause(250); const idle=probe.sample();
    globalThis.probeStage=4; probe.reset(); const cold=[],warm=[],activation=[];
    async function activateLanes() {
      if ((config.lanes??1)<2) return;
      const saved=await app.store.getStateSnapshot({view:'play-v1'});
      const candidate=saved.pools[member].eligible[0]?.id;
      if(!candidate)fail('CandidateError');
      let response=await runtime.privateSend(`/api/predict?memberId=${encodeURIComponent(member)}&chunkId=${encodeURIComponent(candidate)}`);
      if(response.status!==200)fail('ActivatePrediction',response.status);activation.push(response.wallMs);guard();
      if(config.lanes>=3) {
        const peer=app.store.getCalculationSnapshot().members[1].id;
        response=await runtime.privateSend(`/api/tasks?memberId=${encodeURIComponent(peer)}&view=play-v1&lane=duo-v1&peerFor=${encodeURIComponent(member)}&revision=${app.store.getInfo().revision}`);
        if(response.status!==200)fail('ActivateDuo',response.status);activation.push(response.wallMs);guard();
      }
      if(config.lanes>=4) {
        response=await runtime.privateSend(`/api/death-estimates?memberId=${encodeURIComponent(member)}&chunkId=${encodeURIComponent(candidate)}`);
        if(response.status!==200)fail('ActivateDeath',response.status);activation.push(response.wallMs);guard();
      }
    }
    let response=await runtime.privateSend(`/api/tasks?memberId=${encodeURIComponent(member)}&view=play-v1`);
    if(response.status!==200)fail('LegacyEvaluate',response.status);cold.push(response.wallMs);
    for(let i=0;i<cookies.length;i++) {
      if(config.directLast && i===cookies.length-1) continue;
      response=await runtime.send(`/api/tasks?memberId=${encodeURIComponent(ownedMembers[i])}&view=play-v1`,cookies[i]);
      if(response.status!==200)fail('OwnedEvaluate',response.status);cold.push(response.wallMs);guard();
    }
    await activateLanes();
    const beforeNewcomer=probe.sample();
    let newcomerColdMs;
    if(config.directLast && cookies.length) {
      const i=cookies.length-1;
      response=await runtime.send(`/api/tasks?memberId=${encodeURIComponent(ownedMembers[i])}&view=play-v1`,cookies[i]);
      if(response.status!==200)fail('NewcomerEvaluate',response.status);newcomerColdMs=response.wallMs;cold.push(response.wallMs);globalThis.openedContexts++;guard();
    }
    await pause(250); const evaluated=probe.sample();
    globalThis.probeStage=5;
    for(let i=0;i<cookies.length;i++) {
      response=await runtime.send(`/api/tasks?memberId=${encodeURIComponent(ownedMembers[i])}&view=play-v1`,cookies[i]);
      if(response.status!==200)fail('OwnedRepeat',response.status); warm.push(response.wallMs);
    }
    response=await runtime.privateSend(`/api/tasks?memberId=${encodeURIComponent(member)}&view=play-v1`);
    if(response.status!==200)fail('LegacyRepeat',response.status);warm.push(response.wallMs);
    await pause(250); const repeated=probe.sample();
    const report={directLast:!!config.directLast,newcomerColdMs,activationMs:activation,configuredLanes:config.lanes??1,beforeNewcomer,count:config.count,shape:config.shape,run:config.run,startupMs,idle,evaluated,repeated,openMs:opens,coldMs:cold,warmMs:warm,cold:stats(cold),warm:stats(warm),
      heapMB:config.heapMB??0,runtimeCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:config.runtime,encoding:'utf8'}).trim(),node:process.version,cpuModel:cpus()[0].model,cpuCount:cpus().length,
      workerMode:1,phaseChecks:3};
    await writeFile(config.result,JSON.stringify(report),{mode:0o600,flag:'wx'}); return report;
  } finally { clearInterval(timer); if(app)await app.close(); }
}
async function child(config,mode) {
  const file=path.join(config.directory,'config-'+mode+'.json');await writeFile(file,JSON.stringify(config),{mode:0o600,flag:'wx'});
  try {
    const result=await runFile(process.execPath,[...(config.heapMB?['--max-old-space-size='+config.heapMB]:[]),here,'--child',mode,'--config',file],{cwd:config.directory,timeout:1800000,maxBuffer:1024*1024});
    return mode==='setup'?JSON.parse(result.stdout):JSON.parse(await readFile(config.result,'utf8'));
  } catch(error) {
    try { const result=JSON.parse(await readFile(config.result,'utf8'));if(result.aborted)return result; } catch {}
    const stderr=error.stderr??'',heapLimit=/heap out of memory|Reached heap limit/.test(stderr);
    const diagnostic={aborted:true,reason:heapLimit?'heap-limit':'child-failure',count:config.count,shape:config.shape,run:config.run,signal:error.signal,
      stderrBytes:Buffer.byteLength(stderr),stderrHash:sha(stderr),heapMB:config.heapMB??0};
    try{diagnostic.last=JSON.parse(await readFile(config.result+'.last','utf8'));}catch{}
    process.stderr.write(JSON.stringify(diagnostic)+'\n');
    if(heapLimit){await pause(2000);return diagnostic;}
    for(const line of stderr.split('\n'))try{const value=JSON.parse(line);if(value.error)process.stderr.write(JSON.stringify(value)+'\n');}catch{}
    throw new Error('ChildFailure');
  }
}
async function main() {
  const {values:o}=parseArgs({options:{runtime:{type:'string',default:'/tmp/mp'},packs:{type:'string'},defaults:{type:'string'},source:{type:'string'},output:{type:'string'},
    lanes:{type:'string',default:'1'},'heap-mb':{type:'string'},'direct-last':{type:'boolean'},runs:{type:'string',default:'3'},counts:{type:'string',default:'1,2,4,8,16'},shape:{type:'string',default:'both'},child:{type:'string'},config:{type:'string'},help:{type:'boolean'}}});
  if(o.help){console.log('node scripts/perf/multi-picker-server-capacity.mjs --runtime DIR --packs DIR --defaults FILE --source SAVE --output /tmp/report.json [--counts 1,2,4,8,16] [--shape fresh|grown|both] [--runs 3] [--direct-last] [--heap-mb 8192] [--lanes 1|2|3|4]');return;}
  if(o.child){const config=JSON.parse(await readFile(o.config,'utf8'));const directory=await realpath(config.directory);if(!directory.startsWith('/tmp/')||config.result&&path.dirname(path.resolve(config.result))!==directory)fail('TemporaryLocation');const value=o.child==='setup'?await setup(config):await trial(config);if(o.child==='setup')console.log(JSON.stringify(value));return;}
  if(Number(process.versions.node.split('.')[0])!==24)fail('NodeVersion');
  const counts=o.counts.split(',').map(Number),runs=Number(o.runs),lanes=Number(o.lanes),heapMB=Number(o['heap-mb']??0),shapes=o.shape==='both'?['fresh','grown']:[o.shape];
  if(!Number.isSafeInteger(heapMB)||heapMB<0||heapMB>8192||!Number.isSafeInteger(lanes)||lanes<1||lanes>4||!Number.isSafeInteger(runs)||runs<1||runs>20||counts.some(n=>!Number.isSafeInteger(n)||n<1||n>32)||shapes.some(s=>!['fresh','grown'].includes(s))||!o.packs||!o.defaults||!o.source||!o.output)fail('OptionsError');
  const output=path.resolve(o.output),parent=await realpath(path.dirname(output));if(parent!=='/tmp'&&!parent.startsWith('/tmp/'))fail('OutputLocation');
  await writeFile(output+'.partial','{}',{flag:'wx',mode:0o600});
  const scratch=await mkdtemp('/tmp/multi-picker-server-'),templates=new Map();
  const report={version:1,runs,counts,shapes,trials:[],inputs:{},runtimeCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:o.runtime,encoding:'utf8'}).trim()};
  try{
    for(const shape of shapes){const directory=path.join(scratch,'template-'+shape);await mkdir(directory,{mode:0o700});
      const config={runtime:path.resolve(o.runtime),packs:path.resolve(o.packs),defaults:path.resolve(o.defaults),source:path.resolve(o.source),directory,shape,lanes,heapMB,directLast:!!o['direct-last'],maxContexts:Math.max(...counts)};
      report.inputs[shape]=await child(config,'setup');templates.set(shape,config);
    }
    const failed=new Set();
    const cases=shapes.flatMap(shape=>counts.map(count=>({shape,count})));
    for(let run=0;run<runs;run++){
      const order=[...cases.slice(run%cases.length),...cases.slice(0,run%cases.length)];
      for(const {shape,count} of order){
        process.stderr.write(JSON.stringify({run,count,shape})+'\n');
        const key=shape+':'+count;
        if(failed.has(key)){report.trials.push({aborted:true,reason:'prior-heap-limit',count,shape,run});await writeFile(output+'.partial',JSON.stringify(report,null,2)+'\n',{mode:0o600});continue;}
        const directory=path.join(scratch,`trial-${run}-${shape}-${count}`);await cp(templates.get(shape).directory,directory,{recursive:true});
        await rm(path.join(directory,'config-setup.json'));
        const config={...templates.get(shape),directory,count,run,result:path.join(directory,'result.json')};
        const result=await child(config,'trial');report.trials.push(result);if(result.aborted)failed.add(key);
        await writeFile(output+'.partial',JSON.stringify(report,null,2)+'\n',{mode:0o600});
        await rm(directory,{recursive:true,force:true});
      }
    }
    await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({trials:report.trials.length,aborted:report.trials.filter(t=>t.aborted).length}));
  }finally{await rm(scratch,{recursive:true,force:true});}
}
try{await main();}catch(error){console.error(JSON.stringify({error:error.name,status:error.status,stage:globalThis.probeStage??0,bodyHash:error.bodyHash,frames:error.stack?.split('\n').slice(1).map(line=>/([\w-]+\.mjs):(\d+):(\d+)/.exec(line)?.slice(1)).filter(Boolean)}));process.exitCode=1;}
