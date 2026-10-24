// Import-safe container controller. No app/provider/browser/child starts on import.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {SOURCE_PIN,FIXTURE_SHA,RESULT_CODES,OPEN_GATES,publicResult} from './container-result.mjs';
import {sameCPUSet} from './session-protocol.mjs';
import {VECTOR_POLICY,parseEvidenceLines} from './evidence-vectors.mjs';
export const STAGES=new Set(['browser-ready','overlay-ready','measured-ready','episode-start','episode-end','cleanup-start','cleanup-end']);
export const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const ensure=(value,code)=>{if(!value)throw Error(code);};
export function resolvePackageRoot(here){const root=path.posix.resolve(here,'../..');ensure(root==='/harness'||root.startsWith('/harness/'),'r111-harness-lock');return root;}
export function readSmallJSON(filename,limit=32768){
 const before=fs.lstatSync(filename);ensure(before.isFile()&&!before.isSymbolicLink()&&before.size<=limit,'r111-result-malformed');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
 try{const info=fs.fstatSync(fd);ensure(info.isFile()&&info.size<=limit&&info.ino===before.ino&&info.dev===before.dev,'r111-result-malformed');const bytes=Buffer.alloc(limit+1),n=fs.readSync(fd,bytes,0,bytes.length,0);ensure(n<=limit,'r111-result-malformed');return JSON.parse(bytes.subarray(0,n).toString('utf8'));}finally{fs.closeSync(fd);}
}
export function readEvidenceFile(filename){
 const before=fs.lstatSync(filename);ensure(before.isFile()&&!before.isSymbolicLink()&&before.size<=16*1024**2,'r111-result-malformed');const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));try{const info=fs.fstatSync(fd);ensure(info.isFile()&&info.ino===before.ino&&info.dev===before.dev&&info.size<=16*1024**2,'r111-result-malformed');const bytes=Buffer.alloc(info.size+1),n=fs.readSync(fd,bytes,0,bytes.length,0);ensure(n<=info.size,'r111-result-malformed');return parseEvidenceLines(bytes.subarray(0,n).toString('utf8'));}finally{fs.closeSync(fd);}
}
export function treeManifest(root){
 const files=[];let total=0;
 function visit(directory,relative=''){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   ensure(entry.name!=='.git'&&entry.name!=='.env'&&!entry.isSymbolicLink(),'r111-source-lock');const name=relative?relative+'/'+entry.name:entry.name,target=path.join(directory,entry.name);
   if(entry.isDirectory())visit(target,name);else{ensure(entry.isFile(),'r111-source-lock');const info=fs.statSync(target);ensure(info.size<=256*1024**2&&files.length<10000&&(total+=info.size)<=1024**3,'r111-source-lock');const digest=crypto.createHash('sha256'),fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));try{const buffer=Buffer.alloc(1024*1024);let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}files.push({path:name,bytes:info.size,sha256:digest.digest('hex')});}
  }
 }
 visit(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));return{files,manifestSha256:sha(JSON.stringify(files))};
}
export function verifySource(root,lock){
 ensure(lock?.schemaVersion===1&&lock.sourceCommit===SOURCE_PIN&&lock.verification==='host-verified-public-git-archive'&&Array.isArray(lock.files)&&lock.criticalFiles&&typeof lock.criticalFiles==='object','r111-source-lock');
 const actual=treeManifest(root);ensure(actual.manifestSha256===lock.manifestSha256&&JSON.stringify(actual.files)===JSON.stringify(lock.files),'r111-source-lock');
 for(const name of ['app/server.mjs','app/storage/store.mjs','app/datasets.mjs','app/dataset-runtime.mjs','app/core/state.mjs','app/private-addon.mjs'])ensure(lock.criticalFiles?.[name]===actual.files.find(x=>x.path===name)?.sha256&&typeof lock.criticalFiles[name]==='string','r111-source-lock');return actual.manifestSha256;
}
export function verifyHarness(packageRoot,expected){
 const manifestPath=path.join(packageRoot,'source-slice-manifest.json'),info=fs.lstatSync(manifestPath);ensure(info.isFile()&&!info.isSymbolicLink()&&info.size<=2*1024**2,'r111-harness-lock');const bytes=fs.readFileSync(manifestPath);ensure(sha(bytes)===expected,'r111-harness-lock');const manifest=JSON.parse(bytes);
 ensure(manifest.sourcePin===SOURCE_PIN&&Array.isArray(manifest.files),'r111-harness-lock');const names=new Set();
 for(const row of manifest.files){ensure(typeof row.path==='string'&&!path.isAbsolute(row.path)&&!row.path.split('/').some(p=>['..','.',''].includes(p))&&!names.has(row.path)&&/^[a-f0-9]{64}$/.test(row.sha256),'r111-harness-lock');names.add(row.path);const target=path.resolve(packageRoot,row.path);ensure(target.startsWith(packageRoot+path.sep)&&fs.realpathSync(target)===target,'r111-harness-lock');const info=fs.lstatSync(target);ensure(info.isFile()&&!info.isSymbolicLink()&&info.size===row.bytes&&sha(fs.readFileSync(target))===row.sha256,'r111-harness-lock');}
 for(const name of ['candidate/harness/container-bridge.mjs','candidate/harness/container-result.mjs','candidate/harness/run-container-session.mjs','candidate/harness/session-protocol.mjs','candidate/harness/evidence-vectors.mjs','candidate/harness/session.mjs','candidate/harness/server.mjs','candidate/harness/network.mjs','candidate/harness/probe.mjs','candidate/harness/navigation-epochs.mjs','candidate/harness/metrics.mjs','candidate/harness/contract.mjs','candidate/harness/delay.mjs','candidate/harness/fixture.json','sources/network-ledger-overlay/ledger.mjs'])ensure(names.has(name),'r111-harness-lock');
 ensure(sha(fs.readFileSync(path.join(packageRoot,'candidate/harness/fixture.json')))===FIXTURE_SHA,'r111-harness-lock');return expected;
}
export function parseBridgeArgs(argv){
 const out={};for(let i=0;i<argv.length;i+=2){ensure(/^--[a-z][a-z0-9-]*$/.test(argv[i]??'')&&argv[i+1]!=null&&!argv[i+1].startsWith('--')&&!Object.hasOwn(out,argv[i].slice(2)),'r111-runtime-identity');out[argv[i].slice(2)]=argv[i+1];}
 const names=['go','source-lock','expected-harness-manifest-sha256','expected-node-sha256','outer-seconds','expected-chromium'];ensure(Object.keys(out).length===names.length&&names.every(k=>Object.hasOwn(out,k)),'r111-runtime-identity');
 ensure(out.go==='R111-container-v3'&&out['source-lock']==='/scratch/source-lock.json'&&out['outer-seconds']==='2000'&&out['expected-chromium']==='151.0.7922.34'&&['expected-node-sha256','expected-harness-manifest-sha256'].every(k=>/^[a-f0-9]{64}$/.test(out[k])),'r111-runtime-identity');return out;
}
export function verifyRuntimeIdentity(value,expectedNodeSHA){
 ensure(value.platform==='linux'&&value.arch==='x64'&&value.version==='v24.19.0'&&value.uid>0&&value.execPath==='/runtime/node'&&value.nodeSha256===expectedNodeSHA&&value.cgroup==='0::/'&&JSON.stringify(value.interfaces)==='["lo"]','r111-runtime-identity');
 const quota=String(value.cpuMax).trim().split(/\s+/).map(Number);ensure(quota.length===2&&quota[0]>0&&quota[1]>0&&quota[0]/quota[1]===2&&sameCPUSet(value.cpuset,value.affinity)&&value.memoryMax==='6442450944'&&value.memorySwapMax==='0'&&value.pidsMax==='512','r111-runtime-identity');
 ensure(value.env.PERF_SOURCE_ROOT==='/source'&&value.env.PERF_HARNESS_ROOT==='/harness'&&value.env.PERF_OUTPUT_ROOT==='/scratch'&&value.env.PERF_CASE_RESULT==='/scratch/case-result.json'&&value.env.PERF_STAGE_FD==='3'&&value.env.PERF_PLAYWRIGHT_MODULE==='file:///deps/node_modules/playwright/index.mjs','r111-runtime-identity');
}
export function initAgeMilliseconds({uptimeSeconds,startTicks,ticksPerSecond,probeElapsedMs}){
 ensure(Number.isFinite(uptimeSeconds)&&uptimeSeconds>0&&Number.isSafeInteger(startTicks)&&startTicks>0&&Number.isSafeInteger(ticksPerSecond)&&ticksPerSecond>0&&ticksPerSecond<=1000000&&Number.isFinite(probeElapsedMs)&&probeElapsedMs>=0,'r111-runtime-identity');
 const age=(uptimeSeconds-startTicks/ticksPerSecond)*1000;ensure(age>=0&&age<3600000,'r111-runtime-identity');return Math.ceil(age+probeElapsedMs+1000+2000/ticksPerSecond);
}
export function planBudget({containerAgeMs,preflightElapsedMs=0}){
 ensure(Number.isFinite(containerAgeMs)&&containerAgeMs>=0&&Number.isFinite(preflightElapsedMs)&&preflightElapsedMs>=0,'r111-budget-insufficient');
 const remainingMs=Math.floor(1980000-containerAgeMs-preflightElapsedMs),timedMs=1800000,finalizationMs=90000,resultReserveMs=15000,setupMs=Math.min(90000,remainingMs-timedMs-finalizationMs-resultReserveMs);
 ensure(setupMs>=30000,'r111-budget-insufficient');return{remainingMs,setupMs,timedMs,finalizationMs,resultReserveMs,controllerMs:remainingMs-resultReserveMs,innerCeilingMs:1980000,outerCeilingMs:2000000};
}
export function verifyResultPolicy(policy){
 ensure(policy?.enums?.schema?.includes('r111-long-session-v2')&&policy.enums.mode?.includes('r111-public-duo-session-v2')&&['blocked','failed'].every(x=>policy.enums.status?.includes(x))&&RESULT_CODES.every(c=>policy.enums.code?.includes(c))&&OPEN_GATES.every(c=>policy.openGates?.includes(c))&&['passed','acceptance','cleanupPassed'].every(x=>policy.scalarKeys?.includes(x))&&['sourcePin','fixtureSha256','sourceManifestSha256','harnessManifestSha256','nodeSha256'].every(x=>policy.hashKeys?.includes(x))&&['targetDurationMs','elapsedMs','timedDurationMs','observedTimedDurationMs','operations','mutations','closedPages','networkPending'].every(x=>policy.metricKeys?.includes(x)),'r111-runtime-identity');
 for(const [key,values]of Object.entries({dataset:['duo-legacy'],fixtureBaseline:['r37-authored-711-v2'],players:[2],overlays:[1],memberUnlockedChunks:[1],taskCoverage:['fixture-member-catalogue'],sessionMinutes:[30]}))ensure(values.every(v=>policy.scope?.[key]?.includes(v)),'r111-runtime-identity');
 ensure(policy.r111NumericVectors&&Object.keys(policy.r111NumericVectors).length===Object.keys(VECTOR_POLICY).length&&Object.entries(VECTOR_POLICY).every(([key,v])=>JSON.stringify(policy.r111NumericVectors[key])===JSON.stringify(v)),'r111-runtime-identity');
}
export function verifyDependencyIdentity(playwright,core){ensure(playwright?.name==='playwright'&&playwright.version==='1.62.1'&&core?.name==='playwright-core'&&core.version==='1.62.1','r111-runtime-identity');}
export async function superviseSession(child,budget,{stage=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,clock=()=>performance.now(),signals=process}={}){
 const stages=[],uniqueStages=new Set(),started=clock();let phase='setup',episode=false,episodes=0,ipcFailure=false,deadline=false,settled=false,killTimer,abandonTimer,measuredReadyAt=null,cleanupStartAt=null;
 const activeTimers=new Set(),timer=(fn,ms)=>{const id=setTimer(fn,ms);activeTimers.add(id);return id;};
 let finish;const result=new Promise(resolve=>{finish=resolve;});
 function stop(){if(deadline)return;deadline=true;try{child.send?.({type:'r111-cancel'});}catch{}try{child.kill?.('SIGTERM');}catch{}killTimer=timer(()=>{try{child.kill?.('SIGKILL');}catch{}},5000);abandonTimer=timer(()=>settle({code:null,signal:null,exitConfirmed:false}),8000);}
 function settle(outcome){if(settled)return;settled=true;for(const id of activeTimers)clearTimer(id);child.off?.('message',message);signals.off?.('SIGTERM',stop);signals.off?.('SIGINT',stop);finish({...outcome,deadline,ipcFailure,stages,measuredReadyAtMs:measuredReadyAt===null?null:measuredReadyAt-started,cleanupStartAtMs:cleanupStartAt===null?null:cleanupStartAt-started,observedTimedMs:measuredReadyAt===null||cleanupStartAt===null?null:cleanupStartAt-measuredReadyAt,elapsedMs:clock()-started});}
 const message=m=>{if(!m||Object.keys(m).length!==2||m.type!=='r111-stage'||!STAGES.has(m.stage)){ipcFailure=true;stop();return;}
  const name=m.stage;if(!['episode-start','episode-end'].includes(name)){if(uniqueStages.has(name)){ipcFailure=true;stop();return;}uniqueStages.add(name);}
  if(name==='measured-ready'){if(phase!=='setup'||!uniqueStages.has('browser-ready')||!uniqueStages.has('overlay-ready')||clock()-started>budget.setupMs){ipcFailure=true;stop();return;}phase='timed';measuredReadyAt=clock();clearTimer(setupTimer);try{child.send({type:'r111-start'});}catch{ipcFailure=true;stop();return;}}
  if(name==='episode-start'){if(phase!=='timed'||episode||episodes>=54){ipcFailure=true;stop();return;}episode=true;}
  if(name==='episode-end'){if(phase!=='timed'||!episode){ipcFailure=true;stop();return;}episode=false;episodes++;}
  if(name==='cleanup-start'){if(phase==='cleanup'){ipcFailure=true;stop();return;}phase='cleanup';cleanupStartAt=clock();timer(stop,budget.finalizationMs??90000);}if(name==='cleanup-end'&&phase!=='cleanup'){ipcFailure=true;stop();return;}
  stages.push(name);if(stages.length>120){ipcFailure=true;stop();return;}try{stage(name);}catch{ipcFailure=true;stop();}
 };
 child.on('message',message);child.once('error',()=>{ipcFailure=true;stop();});child.once('close',(code,signal)=>settle({code,signal,exitConfirmed:true}));
 const setupTimer=timer(stop,budget.setupMs);timer(stop,budget.controllerMs);signals.once?.('SIGTERM',stop);signals.once?.('SIGINT',stop);
 const outcome=await result;if(!outcome.exitConfirmed){child.disconnect?.();child.unref?.();for(const stream of [child.stdout,child.stderr])stream?.destroy?.();}return outcome;
}
export function sessionEnvironment(env,{scratch,playwright,chromium,expectedChromium,cpuset}){
 const out={...env,R111_SOURCE:'/source',R111_SCRATCH:scratch,SOAK_PLAYWRIGHT:playwright,R111_CHROMIUM_EXECUTABLE:chromium,R111_EXPECTED_CHROMIUM:expectedChromium,R111_EXPECTED_CPUSET:cpuset};for(const key of ['NODE_OPTIONS','NODE_PATH','PERF_STAGE_FD'])delete out[key];return out;
}
export function startSession({entry,scratch,env,budget,stage,forkImpl=fork,signals=process}){
 const child=forkImpl(entry,['primary','R111-current30'],{cwd:scratch,env,execArgv:['--max-old-space-size=768'],stdio:['ignore','pipe','pipe','ipc']});
 // Drain arbitrary child output; only fixed stage names and closed final JSON are public.
 let stdoutBytes=0,stderrBytes=0;for(const [name,stream]of [['stdout',child.stdout],['stderr',child.stderr]])stream?.on('data',bytes=>{if(name==='stdout')stdoutBytes+=bytes.length;else stderrBytes+=bytes.length;});
 return superviseSession(child,budget,{stage,signals}).then(outcome=>({...outcome,stdoutBytes,stderrBytes}));
}
export function buildCase({outcome,result,closure,browserClose,identity,elapsedMs,forcedCode,numericEvidence}){
 return publicResult({evidence:{outcome,result,closure,browserClose,stages:outcome?.stages??[]},identity,elapsedMs,numericEvidence,forcedCode:forcedCode??(outcome?.ipcFailure?'r111-child-ipc':undefined)});
}
export function writeCase(filename,value){
 ensure(!fs.existsSync(filename),'r111-result-malformed');const directory=path.dirname(filename),temp=path.join(directory,'.r111-case-result.tmp');const fd=fs.openSync(temp,'wx',0o600);try{const bytes=Buffer.from(JSON.stringify(value)+'\n');let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);ensure(n>0,'r111-result-malformed');offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,filename);const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
