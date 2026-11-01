// Public synthetic HTTP campaign. No private input or private-server mode.
import assert from 'node:assert/strict';
import { createTrace } from './trace.mjs';
import { fork, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { requireNode, summary, processes, tree } from './runtime.mjs';
requireNode();
const here=fileURLToPath(import.meta.url), repo=path.resolve(path.dirname(here),'../../..');
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const origin='https://picker.example', hash=x=>createHash('sha256').update(x).digest('hex');
const count=(a,key)=>Object.fromEntries([...new Set(a.map(x=>x[key]))].map(k=>[k,a.filter(x=>x[key]===k).length]));
const aggregate=a=>({attempts:a.length, successes:a.filter(x=>x.status===200).length, reasons:count(a,'reason'), successMs:summary(a.filter(x=>x.status===200).map(x=>x.ms)), allMs:summary(a.map(x=>x.ms)), offeredLagMs:summary(a.map(x=>x.lag??0)), retries:a.filter(x=>x.retry).length});
function request(base,route,cookie,body,{token,abortMs,traceId}={}) {
  return new Promise(resolve=>{
    const at=performance.now(), bytes=body===undefined?undefined:JSON.stringify(body); let done=false,abort,timeout,intentional=false;
    const finish=r=>{if(done)return;done=true;clearTimeout(abort);clearTimeout(timeout);resolve({...r,ms:performance.now()-at});};
    const req=http.request(base+route,{method:bytes?'POST':'GET',agent:false,headers:{...(traceId?{'X-Y06-Trace':String(traceId)}:{}),...(token?{Authorization:'Bearer '+token}:{Host:'picker.example','X-Forwarded-For':'203.0.113.7','X-Forwarded-Proto':'https'}),...(cookie?{Cookie:cookie}:{}),...(bytes?{Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)}:{})}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',()=>finish({status:0,reason:'response-error'}));res.on('end',()=>finish({status:res.statusCode,text:Buffer.concat(chunks).toString(),headers:res.headers}));
    });
    req.on('error',()=>finish({status:0,reason:intentional?'disconnect':'transport-error'}));
    timeout=setTimeout(()=>{finish({status:0,reason:'client-deadline'});req.destroy();},5000);
    if(abortMs!==undefined)abort=setTimeout(()=>{intentional=true;req.destroy();},abortMs);
    req.end(bytes);
  });
}
function reason(r){if(r.reason)return r.reason;if(r.status===200)return 'success';if(r.status===409)return 'revision';if(/Pickers are opening/.test(r.text))return 'cold-open';if(/admission/i.test(r.text))return JSON.parse(r.text).message;if(/unavailable/i.test(r.text))return 'residency-or-unavailable';if(/Too many requests/.test(r.text))return 'request-rate-unattributed';if(/budget is full|queue is full|queue full/i.test(r.text))return 'calculator-admission-unattributed';return 'other-'+r.status;}
const json=r=>{assert.equal(r.status,200,r.text);return JSON.parse(r.text);};
async function serverChild(){
  for(const key of Object.keys(process.env))if(key.startsWith('RS3_'))delete process.env[key];
  process.env.RS3_DATASET='open-f2p';process.env.RS3_TASK_WORKER_MODE='process';
  const config=JSON.parse(arg('--child')), root=config.root, temp=await mkdtemp(path.join(os.tmpdir(),'y06-admission-'));
  process.send({kind:'scratch',path:temp});let app;
  const admission=[],factory=[],acquisitions=[],foreground=[],advisory=[];
  const tracing=config.trace?createTrace(root):null;
  const observedAdvisory=new WeakSet();
  globalThis[Symbol.for('y06.advisory')]=(message,entry)=>{if(message.type==='prediction-prepared'||observedAdvisory.has(entry))return;observedAdvisory.add(entry);advisory.push({waitMs:entry.startedAt-entry.queuedAt,serviceMs:performance.now()-entry.startedAt});};
  // Identical timing-only source hook in BOTH revisions; no admission decisions
  // are replaced. Record exact acquisition and factory boundaries without editing START.
  globalThis[Symbol.for('y06.factory')]=async(id,work)=>{const at=performance.now();try{return await (tracing?tracing.measure('factory',work):work());}finally{factory.push(performance.now()-at);}};
  globalThis[Symbol.for('y06.acquire')]=async(work,warm)=>{const at=performance.now();try{return await (tracing?tracing.measure('acquire',work,{warm:!!warm}):work());}finally{acquisitions.push(performance.now()-at);}};
  registerHooks({load(url,context,next){const r=next(url,context);if(url===pathToFileURL(path.join(root,'app/picker-router.mjs')).href){let s=String(r.source??readFileSync(new URL(url),'utf8'));
    assert.ok(s.includes('const context = await openContext(id);'));s=s.replace('const context = await openContext(id);',"const context = await globalThis[Symbol.for('y06.factory')](id, () => openContext(id));");
    const needle='const entry = await acquire(pickerId, pickerLimits?.scope(capability ?? identity, pickerId)';assert.ok(s.includes(needle));
    s=s.replace(/const entry = await acquire\(pickerId, pickerLimits\?\.scope\(capability \?\? identity, pickerId\)([^;]*);/,"const entry = await globalThis[Symbol.for('y06.acquire')](() => acquire(pickerId, pickerLimits?.scope(capability ?? identity, pickerId)$1, entries.has(pickerId));");
    return {...r,source:s};}if(url===pathToFileURL(path.join(root,'app/tasks/scheduler.mjs')).href){
      let s=String(r.source??readFileSync(new URL(url),'utf8'));
      const needle='      onEvaluation(message, entry) {\n        const picker =';assert.ok(s.includes(needle));
      s=s.replace(needle,"      onEvaluation(message, entry) {\n        globalThis[Symbol.for('y06.advisory')](message,entry);\n        const picker =");return {...r,source:s};
    }return r;}});
  try{
    const secret=path.join(temp,'secret');await writeFile(secret,'synthetic-only',{mode:0o600});process.env.RS3_DISCORD_CLIENT_ID='synthetic-client';process.env.RS3_DISCORD_CLIENT_SECRET_FILE=secret;
    const {createServer}=await import(pathToFileURL(path.join(root,'app/server.mjs'))),{createGroupState}=await import(pathToFileURL(path.join(root,'app/core/state.mjs')));
    const grants=new Map(),access=new Map();const provider={async fetch(url,options){if(url.endsWith('/oauth2/token')){const code=new URLSearchParams(options.body).get('code');access.set('synthetic-'+code,grants.get(code));return Response.json({access_token:'synthetic-'+code});}assert.equal(url,'https://discord.com/api/users/@me');return Response.json({id:access.get(options.headers.Authorization.slice(7))});}};
    async function start(setup){app=await createServer({dataDir:path.join(temp,'legacy'),port:0,loopbackPort:0,loopbackRole:'public',publicOrigin:origin,signIn:'optional',signInProvider:provider,predictionPrewarm:false,shutdownDeadlineMs:5000,
      initialState:createGroupState([{id:'one',name:'Player 1'},{id:'two',name:'Player 2'}]),
      multiPicker:{registryDir:path.join(temp,'registry'),pickerRoot:path.join(temp,'pickers'),tombstoneDir:path.join(temp,'tombstones'),onAdmission:e=>admission.push(e),...(setup?{registrationsPerAccount:10000,registrationsGlobal:10000,provisioningGlobal:10000}:{})},
      taskWorkerOptions:{onEvaluation(message,entry){foreground.push({waitMs:entry.startedAt-entry.queuedAt,serviceMs:performance.now()-entry.startedAt});}},rateLimits:{unauthenticated:10000}});await app.listen();return `http://127.0.0.1:${app.loopbackAddress().port}`;}
    let base=await start(true);const chunks=[...app.world.chunks.keys()].map(String).filter(x=>/^\d+$/.test(x)),clients=[];
    for(let i=0;i<20;i++){
      const begin=await request(base,'/auth/discord');assert.equal(begin.status,303);const auth=new URL(begin.headers.location),code=String(i+1);grants.set(code,String(100000+i));
      const login=await request(base,`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,begin.headers['set-cookie'][0].split(';')[0]);assert.equal(login.status,303,login.text);
      const cookie=login.headers['set-cookie'].find(s=>s.startsWith('duo_access=')).split(';')[0];let revision=0;
      for(let k=0;k<=i;k++){const r=json(await request(base,'/api/command?view=play',cookie,{expectedRevision:revision,command:k===0?{type:'set-chunk',memberId:'owner',chunkId:chunks[i%chunks.length],status:'unlocked'}:{type:'set-note',memberId:'owner',chunkId:chunks[i%chunks.length],note:`synthetic-${i}`}}));revision=r.state.revision;}
      clients.push({index:i,cookie,revision,chunk:chunks[i%chunks.length],note:i?`synthetic-${i}`:undefined});
    }
    await app.close();base=await start(false);admission.length=factory.length=acquisitions.length=foreground.length=advisory.length=0;tracing?.reset();
    process.send({kind:'ready',base,privateBase:`http://127.0.0.1:${app.address().port}`,token:app.store.getAccessToken(),clients,chunks,datasetDigest:app.dataset.digest});
    for await(const message of (async function*(){while(true)yield await new Promise(resolve=>process.once('message',resolve));})()){
      if(message.kind==='reset'){admission.length=factory.length=acquisitions.length=foreground.length=advisory.length=0;tracing?.reset();process.send({kind:'reset'});}
      if(message.kind==='metrics')process.send({kind:'metrics',trace:tracing?.metrics(),admission,advisoryWaitMs:summary(advisory.map(x=>x.waitMs)),advisoryServiceMs:summary(advisory.map(x=>x.serviceMs)),factoryMs:summary(factory),acquisitionMs:summary(acquisitions),foregroundWaitMs:summary(foreground.map(x=>x.waitMs)),foregroundServiceMs:summary(foreground.map(x=>x.serviceMs))});
      if(message.kind==='stop')break;
    }
  }finally{try{await app?.close();}finally{await rm(temp,{recursive:true,force:true});}}
}
async function trial(root,mode,seed,pair,seconds){
  const child=fork(here,['--child',JSON.stringify({root,trace:process.argv.includes('--trace')})],{cwd:root,detached:true,stdio:['ignore','ignore','pipe','ipc']});let stderr='',scratch,peak=0,workerPeak=0,known=new Map(),diagnostics=[],guard=false;
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-3000);});const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const inbox=new Map(),listeners=new Map();child.on('message',m=>{if(m.kind==='scratch')scratch=m.path;const listener=listeners.get(m.kind);if(listener){listeners.delete(m.kind);listener(m);}else inbox.set(m.kind,m);});
  const message=kind=>inbox.has(kind)?Promise.resolve(inbox.get(kind)).then(m=>{inbox.delete(kind);return m;}):Promise.race([new Promise(resolve=>listeners.set(kind,resolve)),exited.then(e=>{throw Error(`child exit ${e.code}: ${stderr}`);})]);
  const kill=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};let sampleTail=Promise.resolve();
  const sample=()=>sampleTail=sampleTail.then(async()=>{const rows=tree(await processes(),child.pid);assert.ok(rows.length,'missing server RSS sample');for(const p of rows)known.set(p.key,p);const rss=rows.reduce((s,p)=>s+p.rss,0);peak=Math.max(peak,rss);workerPeak=Math.max(workerPeak,rows.filter(p=>p.calculator).length);if(rss>3072*1024**2){guard=true;kill();}return rss;});
  let sampleError;const timer=setInterval(()=>{void sample().catch(e=>{sampleError=e;kill();});},50),deadline=setTimeout(kill,240000);let poll;
  try{
    const ready=await message('ready'),clients=ready.clients,rows=[];let requestId=0;
    async function send(c,phase,type,body,extra={}){const route=type==='draft'?'/api/sandbox/evaluate':type==='tasks'?'/api/tasks?memberId=owner&view=play-v1':type==='unlock'?'/api/command?view=play':'/api/state?view=play';
      const id=++requestId,r=await request(ready.base,route,c.cookie,body,{...extra,traceId:process.argv.includes('--trace')?id:undefined}),row={id,picker:c.index,phase,type,status:r.status,reason:reason(r),ms:r.ms,retry:!!extra.retry,lag:extra.lag??0};
      if(r.status===200){const v=JSON.parse(r.text);if(type==='state'||type==='unlock'){if(type==='unlock')c.revision++;assert.equal(v.state.revision,c.revision);const m=v.state.members[0];assert.equal(v.state.members.length,1);assert.equal(m.id,'owner');assert.ok(m.unlocked.includes(c.chunk));if(c.note)assert.equal(m.notes[c.chunk],c.note);}else{assert.equal(v.stateRevision,c.revision);assert.equal(v.memberId,'owner');if(type==='draft'){assert.equal(v.format,'sandbox-v1');assert.deepEqual(v.changes,body.changes);}}}
      rows.push(row);return r;}
    const draft=(c,seq)=>({memberId:'owner',baseRevision:c.revision,changes:{unlockChunks:[...new Set([ready.chunks[(seq+c.index*7)%ready.chunks.length],ready.chunks[(Math.floor(seq/ready.chunks.length)+c.index*11+1)%ready.chunks.length]])].sort(),lockChunks:[],doneTasks:[]}});
    for(let i=0;i<20;i+=2)await send(clients[i],'prewarm','state');
    child.send({kind:'reset'});await message('reset');
    await sample(); peak=0; workerPeak=0; const ticksBefore=new Map([...known].map(([key,p])=>[key,p.ticks]));
    const oomBefore=JSON.parse(JSON.stringify(Object.fromEntries((await readFile('/sys/fs/cgroup/memory.events','utf8')).trim().split('\n').map(x=>x.split(' ')))));
    await Promise.all(clients.map(c=>send(c,'storm','state')));await send(clients[0],'warmup','draft',draft(clients[0],0));
    let diagnosticTail=Promise.resolve();const diagnostic=()=>diagnosticTail=diagnosticTail.then(async()=>{const r=await request(ready.privateBase,'/api/diagnostics',undefined,undefined,{token:ready.token});assert.equal(r.status,200);const d=JSON.parse(r.text),lanes=[d,d.predictionLane,d.deathLane,d.duoLane].filter(Boolean);const h=json(await request(ready.privateBase,'/api/health',undefined,undefined,{token:ready.token}));diagnostics.push({queue:lanes.reduce((s,l)=>s+(l.queue?.depth??0),0),active:lanes.reduce((s,l)=>s+(l.queue?.active??0),0),oldestMs:Math.max(...lanes.map(l=>l.queue?.oldestWaitMs??0)),calculators:d.calculators?.resident??0,contexts:h.service?.openContexts??null});});
    poll=setInterval(()=>{void diagnostic().catch(e=>{sampleError=e;kill();});},200);
    const roles=clients.map((c,i)=>i<2?'noisy':i<6?'light':'idle'),start=performance.now(),end=start+seconds*1000,tasks=[];let scheduled=0;
    let random=seed>>>0;const rng=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2**32;};const offsets=clients.map(()=>Math.floor(rng()*1000));
    for(const c of clients.slice(2))tasks.push((async()=>{const pending=new Set();let step=0;for(let due=start+offsets[c.index];due<end;due+=roles[c.index]==='idle'?6000:2000,step++){
      if(due>performance.now())await delay(due-performance.now());scheduled++;const type=roles[c.index]==='idle'||step%4<2?'state':step%4===2?'tasks':'draft';if(pending.size>=2){rows.push({picker:c.index,phase:'steady',type,status:0,reason:'local-shedding',ms:0,lag:performance.now()-due});continue;}
      const p=send(c,'steady',type,type==='draft'?draft(c,step):undefined,{lag:performance.now()-due}).finally(()=>pending.delete(p));pending.add(p);
    }await Promise.all(pending);})());
    for(const c of clients.slice(0,2))for(let stream=0;stream<4;stream++)tasks.push((async()=>{let step=stream;while(performance.now()<end){const body=draft(c,++step*4+stream),abort=step%13===0,r=await send(c,'steady','draft',body,abort?{abortMs:2}:{});if(abort&&r.reason==='disconnect'){await delay(1000);await send(c,'steady','draft',body,{retry:true});}else if(r.status!==200)await delay(Math.min(2000,+(r.headers?.['retry-after']??1)*1000));await delay(150);}})());
    await Promise.all(tasks);const elapsedMs=performance.now()-start;
    for(const c of clients.slice(2,6)){const old=draft(c,701),chunk=ready.chunks.find(x=>x!==c.chunk),r=await send(c,'probe','unlock',{expectedRevision:c.revision,command:{type:'set-chunk',memberId:'owner',chunkId:chunk,status:'unlocked'}});if(r.status===200){assert.equal((await send(c,'probe','draft',old)).status,409);await send(c,'probe','state');}}
    const drainStart=performance.now();let drained=false;while(performance.now()-drainStart<5000){await diagnostic();const d=diagnostics.at(-1);if(!d.active&&!d.queue){drained=true;break;}await delay(100);}const drainMs=performance.now()-drainStart;
    clearInterval(poll);await diagnosticTail;await delay(1000);const afterDrain=[];for(let i=0;i<3;i++){afterDrain.push(await sample());if(i<2)await delay(250);}
    const drainCycles=[{drained,drainMs,afterDrainBytes:afterDrain}];
    const cycleCount=+arg('--drain-cycles','1');assert.ok(Number.isInteger(cycleCount)&&cycleCount>=1&&cycleCount<=3);
    for(let cycle=1;cycle<cycleCount;cycle++){
      const responses=await Promise.all(clients.map(c=>send(c,'drain-cycle','state'))),at=performance.now();let cycleDrained=false;
      while(performance.now()-at<5000){await diagnostic();const d=diagnostics.at(-1);if(!d.active&&!d.queue){cycleDrained=true;break;}await delay(100);}
      const cycleDrainMs=performance.now()-at;await delay(1000);const samples=[];
      for(let i=0;i<3;i++){samples.push(await sample());if(i<2)await delay(250);}
      drainCycles.push({drained:cycleDrained,drainMs:cycleDrainMs,afterDrainBytes:samples,successes:responses.filter(r=>r.status===200).length,attempts:responses.length});
      assert.ok(cycleDrained);
    }
    child.send({kind:'metrics'});const metrics=await message('metrics');delete metrics.kind;
    const events=metrics.admission, released=events.filter(e=>e.event==='released');
    metrics.admission={counts:count(events,'event'),waitMs:summary(released.map(e=>e.waitMs)),serviceMs:summary(released.map(e=>e.serviceMs)),pendingPeak:Math.max(0,...events.map(e=>e.pending)),activePeak:Math.max(0,...events.map(e=>e.active)),finalPending:events.at(-1)?.pending??0};
    assert.ok(metrics.admission.activePeak<=1&&metrics.admission.pendingPeak<=64&&metrics.admission.finalPending===0);
    clearInterval(timer);await sampleTail;if(sampleError)throw sampleError;
    const oomAfter=Object.fromEntries((await readFile('/sys/fs/cgroup/memory.events','utf8')).trim().split('\n').map(x=>x.split(' '))),oom=+oomAfter.oom- +oomBefore.oom,oomKill=+oomAfter.oom_kill- +oomBefore.oom_kill;
    child.send({kind:'stop'});const exit=await exited;assert.equal(exit.code,0,stderr);await delay(100);const descendants=(await processes()).filter(p=>known.has(p.key)&&p.pid!==child.pid);
    const steady=rows.filter(r=>r.phase==='steady'),quiet=steady.filter(r=>r.picker>=2);
    if(metrics.trace){
      const byId=new Map(rows.map(r=>[r.id,r])),quietIds=new Set(quiet.map(r=>r.id)),refusals={};
      for(const r of metrics.trace.requests)for(const failure of r.refusals){const role=(byId.get(r.id)?.picker??0)>=2?'quiet':'noisy',key=[role,failure.kind,failure.budget??'',failure.scope??''].join(':');refusals[key]=(refusals[key]??0)+1;}
      metrics.trace={...metrics.trace,requests:metrics.trace.requests.filter(r=>quietIds.has(r.id)),refusals};
    }
    const result={mode,seed,pair,seconds,elapsedMs,scheduledQuiet:scheduled,rootCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(await Promise.all(['app/picker-router.mjs','app/server.mjs','app/picker-admission.mjs','app/picker-context.mjs','app/tasks/scheduler.mjs','app/tasks/calculator-pool.mjs'].map(async name=>[name,hash(await readFile(path.join(root,name)))]))),datasetDigest:ready.datasetDigest,cpuSeconds:[...known].reduce((sum,[key,p])=>sum+Math.max(0,p.ticks-(ticksBefore.get(key)??0)),0)/100,treePeakBytes:peak,workerPeak,afterDrainBytes:afterDrain,drainCycles,drained,drainMs,guard,oom,oomKill,childrenAfterClose:descendants.length,validationDifferences:0,diagnostics:{samples:diagnostics.length,queue:summary(diagnostics.map(d=>d.queue)),oldestMs:summary(diagnostics.map(d=>d.oldestMs)),contexts:summary(diagnostics.map(d=>d.contexts)),calculators:summary(diagnostics.map(d=>d.calculators))},...metrics,
      rawQuiet:process.argv.includes('--trace')?quiet.map(({id,picker,phase,type,status,reason,ms,retry,lag})=>({id,picker,phase,type,status,reason,ms,retry,lag})):undefined,attempts:aggregate(rows),phases:Object.fromEntries(['storm','steady','probe'].map(p=>[p,aggregate(rows.filter(r=>r.phase===p))])),quiet:aggregate(quiet),quietEndpoints:Object.fromEntries(['state','tasks','draft'].map(t=>[t,aggregate(quiet.filter(r=>r.type===t))])),pickers:clients.map(c=>({index:c.index,role:roles[c.index],...aggregate(steady.filter(r=>r.picker===c.index))}))};
    assert.ok(drained&&!guard&&!oom&&!oomKill&&workerPeak<=2&&descendants.length===0);assert.ok(diagnostics.every(d=>d.contexts<=7));return result;
  }finally{clearInterval(poll);clearInterval(timer);clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null){kill();const force=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);await exited;clearTimeout(force);}await sampleTail.catch(()=>{});for(const p of await processes())if(known.has(p.key)&&p.pid!==child.pid&&p.state!=='Z'){try{process.kill(p.pid,'SIGKILL');}catch{}}if(scratch&&path.dirname(scratch)===os.tmpdir()&&path.basename(scratch).startsWith('y06-admission-'))await rm(scratch,{recursive:true,force:true});}
}
if(process.argv.includes('--child'))await serverChild();else{
  const out=arg('--out');assert.ok(out,'--out required');const baseline=arg('--baseline','/tmp/y06-start'),pairs=+arg('--pairs','5'),seconds=+arg('--seconds','24'),seeds=arg('--seeds','17,73,211').split(',').map(Number),modes=arg('--modes','baseline,candidate').split(',');assert.ok(pairs>=1&&pairs<=5&&seconds>=3&&seconds<=120&&seeds.length<=5&&modes.every(x=>['baseline','candidate'].includes(x)));
  const report={schema:1,node:process.versions.node,traceSha256:process.argv.includes('--trace')?hash(await readFile(new URL('./trace.mjs',import.meta.url))):undefined,harnessSha256:hash(await readFile(here)),runtimeSha256:hash(await readFile(new URL('./runtime.mjs',import.meta.url))),startedAt:new Date().toISOString(),cpuMax:(await readFile('/sys/fs/cgroup/cpu.max','utf8')).trim(),memoryMax:(await readFile('/sys/fs/cgroup/memory.max','utf8')).trim(),trials:[],censored:[]},start=Date.now();
  outer:for(const seed of seeds)for(let pair=1;pair<=pairs;pair++)for(const mode of pair%2?modes:[...modes].reverse()){
    if(Date.now()-start>+arg('--budget-minutes','50')*60000){report.censored.push({seed,pair,mode,reason:'time-budget'});break outer;}
    try{const r=await trial(mode==='baseline'?baseline:repo,mode,seed,pair,seconds);report.trials.push(r);console.log(JSON.stringify({seed,pair,mode,quiet:r.quiet,storm:r.phases.storm,peakMiB:r.treePeakBytes/1024**2}));}
    catch(e){report.censored.push({seed,pair,mode,reason:'trial-failed',error:e.message.slice(0,400)});process.exitCode=1;}
    report.updatedAt=new Date().toISOString();await writeFile(out,JSON.stringify(report,null,2)+'\n');if(report.censored.length)break outer;
  }await writeFile(out,JSON.stringify(report,null,2)+'\n');
}
