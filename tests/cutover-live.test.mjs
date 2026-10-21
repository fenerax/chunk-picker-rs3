import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { assertHosted, assertIdle, assertOrder, digest, forwardSteps, rollbackSteps, inventory, readPlan, runStep, SystemBackend } from '../scripts/private-companion/cutover-runbook.mjs';
import { verifyAcceptance } from '../scripts/private-companion/cutover-acceptance.mjs';
import { runChild } from '../scripts/private-companion/cutover-child.mjs';
import { mockAcceptanceHTTP } from './helpers/cutover-http.mjs';
import { pathToFileURL } from 'node:url';

async function fixture(t,{base=tmpdir()}={}) {
  const root = await mkdtemp(path.join(base,'m7-runbook-test-'));
  const snapshotRoot = path.join(process.env.LOCALAPPDATA,'RS3ChunkPicker','Snapshots',path.basename(root));
  t.after(async()=>{ await rm(root,{recursive:true,force:true}); await rm(snapshotRoot,{recursive:true,force:true}); });
  const coreRoot=path.join(root,'core'), previousRoot=path.join(root,'previous'), companionRoot=path.join(root,'companion'), dataDir=path.join(root,'local','duo');
  for (const dir of [path.join(coreRoot,'app'),path.join(previousRoot,'scripts'),path.join(companionRoot,'.local'),dataDir,path.join(root,'packs'),path.join(root,'mock')]) await mkdir(dir,{recursive:true});
  const put = async (name,value) => { const file=path.join(root,name); await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,typeof value==='string'?value:JSON.stringify(value)); return {path:file,sha256:digest(await readFile(file))}; };
  await put('core/app/server.mjs','throw new Error("sentinel")');
  await put('core/app/private-addon.mjs','throw new Error("sentinel")');
  await put('core/scripts/test.mjs','throw new Error("sentinel")');
  for (const args of [['init','--quiet'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture']]) execFileSync('git',['-C',coreRoot,...args],{windowsHide:true});
  const coreRevision=execFileSync('git',['-C',coreRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  const token='Z'.repeat(43),origin='https://private-synthetic-origin.invalid';
  await put('local/duo/access-token',token); await put('local/public-origin',origin);
  await put('local/duo/state.json',{state:{revision:1,history:[{at:'2026-01-01T00:00:00Z',command:{private:token}}]}});
  await put('local/server-runtime.json',{private:token}); await put('local/duo/store.lock','owned');
  const profile=await put('profile.json','{}'),addons=await put('addons.json','{}'),selection=await put('packs/selection.json','{}'),packs={};
  for (const kind of ['data','rulesText','art']) packs[kind]=await put(`packs/${kind}/pack.json`,{files:[]});
  // Mock records only: no fixture executes a server or binds a listener.
  const c={schemaVersion:1,coreRoot,dataDir,nodePath:process.execPath,host:'127.0.0.1',port:randomInt(8900,9000),loopbackPort:null,publicOriginFile:path.join(root,'local','public-origin'),packsDir:path.join(root,'packs'),selection,packs,profile,addons,runtimeOptions:{taskWorkerMode:'process',workerIdleMs:600000,backupDays:null,historyEntries:null}};
  const candidateConfig=await put('candidate.json',c),previousConfig=await put('previous.json',{...c,coreRoot:previousRoot});
  const oldHelpers={}; for (const [key,leaf] of Object.entries({start:'Start-Picker.ps1',stop:'Stop-Picker.ps1',process:'Picker-Process.ps1'})) oldHelpers[key]=await put('previous/scripts/'+leaf,'throw "sentinel"');
  const watchdogXml=await put('watchdog.xml','<synthetic/>'),backupXml=await put('backup.xml','<synthetic/>');
  const taskPlan=await put('tasks.json',{schemaVersion:1,config:candidateConfig,mockDirectory:path.join(root,'mock'),watchdog:{xml:watchdogXml},backup:{xml:backupXml}});
  const companion={schemaVersion:1,coreRoot,profile,addons,packs:Object.fromEntries(Object.entries(packs).map(([k,p])=>[k,{sha256:p.sha256}]))};
  await put('companion/companion.json',companion);
  const log=await put('gate.log','Synthetic rehearsal sentinel, not a full-suite result.');
  const gates=await put('gates.json',{schemaVersion:1,mode:'rehearsal',coreRevision,companionSha256:digest(JSON.stringify(companion)),candidateSha256:candidateConfig.sha256,previousSha256:previousConfig.sha256,checks:Object.fromEntries(['publicFull','privateFull','galleryPlain','galleryFramed'].map(k=>[k,{passed:true,coreRevision,log}]))});
  const inspection=await put('inspection.json',{schemaVersion:1,mode:'rehearsal',previousSha256:previousConfig.sha256,verified:Object.fromEntries(['launcher','runtimeOwnership','environment','startupAndWatchdog','backupSchedule','funnelProxy','cookieOrigin','retention','artOverrides','previousStorageCompatibility'].map(k=>[k,true]))});
  const bindingCli=await put('bind.mjs','throw new Error("sentinel")');
  const plan={schemaVersion:1,mode:'rehearsal',candidateConfig,previousConfig,companionRoot,oldHelpers,bindingCli,taskPlan,snapshotRoot,receiptDir:path.join(companionRoot,'.local','run'),idleMinutes:5,gates,inspection,hostedAcceptance:null};
  const filename=(await put('plan.json',plan)).path,calls=[];
  let failed=false;
  const backendFactory=context=>({
    withWriterLock:async operation=>{calls.push('writer-lock');return operation();},
    process:async (op)=>{ calls.push(op); const runtime=path.join(root,'local','server-runtime.json'),pause=path.join(root,'local','picker-paused'); if(op==='pause')await writeFile(pause,'paused'); if(op==='unpause')await rm(pause,{force:true}); if(op==='stop-old'||op==='stop-new'){await rm(runtime,{force:true});await rm(path.join(dataDir,'store.lock'),{force:true});} if(op==='start-new'||op==='start-old')await writeFile(runtime,'{}'); },
    tasks:async (restore,dry)=>{calls.push(restore?'restore-tasks':'register-tasks');return JSON.stringify({tasks:[{name:'M7 rehearsal watchdog',current:{actions:'safe',triggers:'safe'},desired:{actions:'safe',triggers:'safe'}}],dryRun:dry});},
    install:async()=>calls.push('install'),
    bind:async()=>{calls.push('bind');await writeFile(dataDir+'.dataset.json','{}');},
    compatibility:async()=>calls.push('compatibility'),
    acceptance:async()=>{calls.push('acceptance');if(failed)throw Object.assign(new Error('REFUSED'),{code:'MOCK_REFUSAL'});return {health:true,scratchCredentialsRevoked:true};}
  });
  return {root,snapshotRoot,plan,filename,put,c,token,origin,calls,backendFactory,setFailure:value=>{failed=value;}};
}

test('idle gate reads all command timestamps, rejects recent, missing, future and malformed metadata',()=>{
  const now=Date.now(),old=new Date(now-600001).toISOString(),recent=new Date(now-1000).toISOString();
  assert.doesNotThrow(()=>assertIdle({state:{revision:2,history:[{at:old}]}},5,now));
  for(const history of [[{at:recent},{at:old}],[{at:'invalid'}],[],[{at:new Date(now+1000).toISOString()}]]) assert.throws(()=>assertIdle({state:{revision:2,history}},5,now));
});
test('step ordering refuses skips, duplicate success, continuation after rollback and implicit retry',()=>{
  const state={forward:[],rollback:[]}; assert.throws(()=>assertOrder(state,'bind'));
  state.forward.push({step:'preflight',status:'complete'});assert.throws(()=>assertOrder(state,'preflight'));
  state.forward.push({step:'pause',status:'failed'});assert.throws(()=>assertOrder(state,'pause'));assert.doesNotThrow(()=>assertOrder(state,'pause',false,true));
  state.rollbackStarted=true;assert.throws(()=>assertOrder(state,'pause'));assert.doesNotThrow(()=>assertOrder(state,'pause',true));
});
test('hosted acceptance requires Player 2 after startup and pins evidence; fresh role probes cover other sessions',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-hosted-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const filename=path.join(root,'acceptance.json'),candidateSha256='a'.repeat(64),started=Date.now()-10000;
  const context={p:{mode:'live',hostedAcceptance:filename,candidateConfig:{sha256:candidateSha256}},state:{forward:[{step:'start-new',status:'complete',endedAt:started}]}};
  const receipt={schemaVersion:1,candidateSha256,checkedAt:new Date(started+1000).toISOString(),existingPlayer2HostedSession:true};
  for(const changed of [{existingPlayer2HostedSession:false},{candidateSha256:'b'.repeat(64)},{checkedAt:new Date(started-1).toISOString()},{checkedAt:new Date(Date.now()+60000).toISOString()}]){
    await writeFile(filename,JSON.stringify({...receipt,...changed}));
    await assert.rejects(assertHosted(context),{code:'EXISTING_HOSTED_ACCEPTANCE_REQUIRED'});
  }
  await writeFile(filename,JSON.stringify(receipt));await assertHosted(context);await assertHosted(context);
  await writeFile(filename,JSON.stringify({...receipt,checkedAt:new Date(started+2000).toISOString()}));
  await assert.rejects(assertHosted(context),{code:'HOSTED_ACCEPTANCE_CHANGED'});
});
test('dry run is immutable and redacted; changed pins refuse',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),before=await inventory(f.root);
  const result=await runStep({plan:f.filename,step:'preflight',dryRun:true,backendFactory:f.backendFactory});
  assert.equal(result.dryRun,true);assert.deepEqual(await inventory(f.root),before);
  assert.ok(!JSON.stringify(result).includes(f.token));assert.ok(!JSON.stringify(result).includes(f.origin));
  const candidateText=await readFile(f.plan.candidateConfig.path);
  await writeFile(f.plan.candidateConfig.path,'{}');await assert.rejects(readPlan(f.filename),{code:'PIN_CHANGED'});
  await writeFile(f.plan.candidateConfig.path,candidateText);
  const previous=JSON.parse(await readFile(f.plan.previousConfig.path));previous.runtimeOptions.workerIdleMs++;
  f.plan.previousConfig=await f.put('previous.json',previous);await writeFile(f.filename,JSON.stringify(f.plan));
  await assert.rejects(readPlan(f.filename),{code:'TRANSITION_RUNTIME_CHANGED'});
});
test('all forward receipts and rollback retain gameplay, credentials and secured snapshot; no save restore',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),before=await readFile(path.join(f.c.dataDir,'state.json'));
  for(const step of forwardSteps){const r=await runStep({plan:f.filename,step,backendFactory:f.backendFactory});assert.equal(r.status,'complete');assert.equal(r.step,step);assert.ok(r.elapsedMs>=0);assert.ok(!JSON.stringify(r).includes(f.token));}
  const saved=await inventory(path.join(f.snapshotRoot,'operational'));assert.ok(saved.some(r=>r.path==='data/access-token'));assert.ok(saved.some(r=>r.path==='pre-stop-runtime.json'));
  // Accepted progress after cutover must survive rollback.
  await writeFile(path.join(f.c.dataDir,'state.json'),Buffer.concat([before,Buffer.from(' ')]));
  const progress=await readFile(path.join(f.c.dataDir,'state.json'));
  for(const step of rollbackSteps){const r=await runStep({plan:f.filename,step,rollback:true,backendFactory:f.backendFactory});assert.equal(r.status,'complete');assert.equal(r.summary.saveRestored,false);}
  assert.deepEqual(await readFile(path.join(f.c.dataDir,'state.json')),progress);assert.equal(await readFile(path.join(f.c.dataDir,'access-token'),'utf8'),f.token);
  assert.deepEqual(await inventory(path.join(f.snapshotRoot,'operational')),saved);
  await assert.rejects(runStep({plan:f.filename,step:'preflight',backendFactory:f.backendFactory}),{code:'RUN_ALREADY_ROLLED_BACK'});
});
test('failed acceptance records failure, blocks registration and needs explicit retry',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);
  for(const step of forwardSteps.slice(0,6))await runStep({plan:f.filename,step,backendFactory:f.backendFactory});
  f.setFailure(true);await assert.rejects(runStep({plan:f.filename,step:'verify',backendFactory:f.backendFactory}),{code:'MOCK_REFUSAL'});
  const state=JSON.parse(await readFile(path.join(f.plan.receiptDir,'state.json')));assert.equal(state.forward.at(-1).status,'failed');
  await assert.rejects(runStep({plan:f.filename,step:'register-tasks',backendFactory:f.backendFactory}),{code:'STEP_ORDER'});
  await assert.rejects(runStep({plan:f.filename,step:'verify',backendFactory:f.backendFactory}),{code:'EXPLICIT_RETRY_REQUIRED'});
  f.setFailure(false);assert.equal((await runStep({plan:f.filename,step:'verify',retry:true,backendFactory:f.backendFactory})).status,'complete');
});
test('plan changes during a run refuse before operator actions',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await runStep({plan:f.filename,step:'preflight',backendFactory:f.backendFactory});
  await writeFile(f.filename,JSON.stringify({...f.plan,idleMinutes:6}));
  const count=f.calls.length;await assert.rejects(runStep({plan:f.filename,step:'pause',backendFactory:f.backendFactory}),{code:'RUN_INPUTS_CHANGED'});assert.equal(f.calls.length,count);
});
test('damaged snapshot prevents binding, and candidate corruption cannot prevent rollback pause',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);
  for(const step of forwardSteps.slice(0,4))await runStep({plan:f.filename,step,backendFactory:f.backendFactory});
  await writeFile(path.join(f.snapshotRoot,'operational','data','state.json'),'damaged');
  await assert.rejects(runStep({plan:f.filename,step:'bind',backendFactory:f.backendFactory}),{code:'SECURED_SNAPSHOT_REQUIRED'});
  // Candidate-only addon is damaged; previous has its own retained pin.
  // Set up a separate run rather than mutating immutable configs mid-run.
  const g=await fixture(t),previous=JSON.parse(await readFile(g.plan.previousConfig.path));
  previous.addons=await g.put('retained-addon.json','{}');g.plan.previousConfig=await g.put('previous.json',previous);
  const gates=JSON.parse(await readFile(g.plan.gates.path));gates.previousSha256=g.plan.previousConfig.sha256;g.plan.gates=await g.put('gates.json',gates);
  const inspection=JSON.parse(await readFile(g.plan.inspection.path));inspection.previousSha256=g.plan.previousConfig.sha256;g.plan.inspection=await g.put('inspection.json',inspection);await writeFile(g.filename,JSON.stringify(g.plan));
  await runStep({plan:g.filename,step:'preflight',backendFactory:g.backendFactory});
  await writeFile(g.c.addons.path,'damaged');
  assert.equal((await runStep({plan:g.filename,step:'pause',rollback:true,backendFactory:g.backendFactory})).status,'complete');
});
test('PowerShell 7 retains exact runtime timestamps and bounded integer schema; legacy timeout cannot Kill',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),tools=path.resolve('scripts/private-companion');
  const runtime=await f.put('timestamp.json',{pid:12345,processStartedAt:'2026-10-15T01:02:03.1234567Z'});
  const sentinel=await f.put('old-stop.ps1','$p=Get-Process -Id $PID; $p.Kill(); throw "Kill returned unexpectedly"');
  const command=`. '${path.join(tools,'Operator-Common.ps1').replaceAll("'","''")}'; . '${path.join(tools,'Legacy-Stop.ps1').replaceAll("'","''")}'; $ErrorActionPreference='Stop'; $v=Read-OperatorJson '${runtime.path.replaceAll("'","''")}'; if($v.pid -isnot [int] -or $v.processStartedAt -cne '2026-10-15T01:02:03.1234567Z'){exit 2}; $blocked=$false;try{Invoke-LegacyGracefulStop '${sentinel.path.replaceAll("'","''")}' 1}catch{$blocked=$_.Exception.Message -match 'Forced termination is disabled'};if(-not $blocked){exit 3};exit 0`;
  const result=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

test('acceptance follows real local-origin policy, uses fresh roles and verifies every revocation',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),probe=mockAcceptanceHTTP(f.token,{origin:f.origin,artDigest:f.c.packs.art.sha256});
  t.after(probe.restore);
  await mkdir(path.join(f.snapshotRoot,'operational','data'),{recursive:true});
  await writeFile(path.join(f.snapshotRoot,'operational','data','state.json'),JSON.stringify({state:{revision:1}}));
  let ownerChecks=0;
  const result=await verifyAcceptance({candidate:f.c,p:f.plan},async()=>{ownerChecks++;});
  assert.equal(probe.counts.masterProbes,0);assert.ok(ownerChecks>20);assert.ok(probe.counts.originChecks>5);
  assert.equal(result.members.length,2);assert.equal(result.scratchCredentialsRevoked,true);
  assert.ok([...probe.identities.values()].every(row=>row.revoked));assert.equal(probe.counts.overlayRevoked,true);
  assert.ok(!JSON.stringify(result).includes(f.token));assert.ok(!JSON.stringify(result).includes(f.origin));
});

test('stopped-writer lease blocks other helpers, releases on failure and reasserts pause',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),marker=path.join(f.root,'local','picker-paused'),helper=path.join(f.root,'local','helper.lock');
  await writeFile(marker,'paused');
  const backend=new SystemBackend(await readPlan(f.filename));
  const probe=()=>{
    const command=`try{$s=[IO.File]::Open('${helper.replaceAll("'","''")}','Open','ReadWrite','None');$s.Dispose();exit 0}catch{exit 2}`;
    return spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000}).status;
  };
  await assert.rejects(backend.withWriterLock(async()=>{assert.equal(probe(),2);await rm(marker);throw new Error('injected lease failure');}),/injected lease failure/);
  assert.equal(probe(),0);assert.equal(await readFile(marker,'utf8'),'M7 operator pause');
});

test('foreground completion does not wait for inherited background pipe handles',{skip:process.platform!=='win32'},async()=>{
  const script="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:'inherit',detached:true,windowsHide:true});console.log(child.pid);process.exit(0);";
  let holder;
  try {
    const result=await runChild(process.execPath,['-e',script],{timeout:10000});
    holder=Number(result.stdout.trim());assert.ok(Number.isSafeInteger(holder)&&holder>0);
    let alive=false;try{process.kill(holder,0);alive=true;}catch{}
    assert.equal(alive,true,'Foreground helper must return before the inherited pipe holder exits');
  } finally {
    // The inert pipe-holder has a fixed self-exit; leave no test process behind.
    await new Promise(resolve=>setTimeout(resolve,1800));
    if(holder){let alive=false;try{process.kill(holder,0);alive=true;}catch{}assert.equal(alive,false);}
  }
});

test('receipt and snapshot ACL setup is repeatable after protected files are written',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),backend=new SystemBackend(await readPlan(f.filename));
  await mkdir(f.plan.receiptDir,{recursive:true});
  await backend.process('secure','-Folder',f.plan.receiptDir);
  await writeFile(path.join(f.plan.receiptDir,'state.json'),'{}',{mode:0o600});
  await backend.process('secure','-Folder',f.plan.receiptDir);
});

test('real worktree ACL protection supports every runbook receipt and rollback step',{skip:process.platform!=='win32'},async t=>{
  const base=path.resolve('.local','m7kit');await mkdir(base,{recursive:true});
  const f=await fixture(t,{base});
  const factory=context=>{
    const fake=f.backendFactory(context),system=new SystemBackend(context),process=fake.process;
    fake.process=(operation,...args)=>['secure','verify-security','pause','unpause'].includes(operation)?system.process(operation,...args):process(operation,...args);
    return fake;
  };
  for(const step of forwardSteps)assert.equal((await runStep({plan:f.filename,step,backendFactory:factory})).status,'complete');
  for(const step of rollbackSteps)assert.equal((await runStep({plan:f.filename,step,rollback:true,backendFactory:factory})).status,'complete');
});

test('CLI verification finishes its dynamic import and saves a receipt with mocked process and HTTP records',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),operator=path.resolve('scripts/private-companion');
  await mkdir(f.plan.receiptDir,{recursive:true});await mkdir(path.join(f.snapshotRoot,'operational','data'),{recursive:true});
  await writeFile(path.join(f.snapshotRoot,'operational','data','state.json'),JSON.stringify({state:{revision:1}}));
  await writeFile(path.join(f.plan.receiptDir,'state.json'),JSON.stringify({schemaVersion:1,planHash:digest(await readFile(f.filename)),kitHash:digest(JSON.stringify((await inventory(operator)).filter(row=>/\.(?:ps1|mjs)$/.test(row.path)))),originSha256:digest(await readFile(f.c.publicOriginFile)),initiallyPaused:true,forward:forwardSteps.slice(0,6).map(step=>({step,status:'complete',startedAt:1,endedAt:2,elapsedMs:1})),rollback:[],rollbackStarted:false,rolledBack:false}));
  const preload=await f.put('cli-preload.mjs',`
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mockAcceptanceHTTP} from ${JSON.stringify(pathToFileURL(path.resolve('tests/helpers/cutover-http.mjs')).href)};
mockAcceptanceHTTP(${JSON.stringify(f.token)},${JSON.stringify({origin:f.origin,artDigest:f.c.packs.art.sha256})});
const original=cp.spawn;
cp.spawn=(exe,args,options)=>{
  if(exe!=='pwsh.exe')return original(exe,args,options);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
  child.kill=()=>{};
  setImmediate(()=>{child.exitCode=0;child.emit('exit',0);child.stdout.end();child.stderr.end();child.emit('close',0);});
  return child;
};
syncBuiltinESMExports();
`);
  const result=await runChild(process.execPath,['--import',pathToFileURL(preload.path).href,path.join(operator,'cutover-runbook.mjs'),'--plan',f.filename,'--step','verify'],{timeout:20000});
  const receipt=JSON.parse(result.stdout);assert.equal(receipt.step,'verify');assert.equal(receipt.status,'complete');assert.equal(receipt.summary.scratchCredentialsRevoked,true);
  const state=JSON.parse(await readFile(path.join(f.plan.receiptDir,'state.json')));assert.equal(state.forward.at(-1).status,'complete');
});
