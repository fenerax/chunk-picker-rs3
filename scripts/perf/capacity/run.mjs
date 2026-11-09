import { fork, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { planFixture, integer, digest } from './model.mjs';
import { createHash } from 'node:crypto';
import { processTree, diskBytes } from './telemetry.mjs';
import { drive } from './driver.mjs';
import { evaluate, markdown } from './report.mjs';
import { stageWindow } from './scheduler.mjs';
import { fixtureWorkers } from './fixture-pool.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const {values:args}=parseArgs({options:{profile:{type:'string',default:'smoke'},output:{type:'string'},host:{type:'string',default:'127.0.0.1'},
  'fixture-workers':{type:'string'},'fixture-from':{type:'string'},'fixture-only':{type:'boolean',default:false}}});
if(!['127.0.0.1','localhost','::1'].includes(args.host))throw new Error('Scratch runner refuses every non-loopback hostname.');
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Use Node 24.');
const profilePath=['smoke','nominal','step-up'].includes(args.profile)?new URL(`./profiles/${args.profile}.json`,import.meta.url):path.resolve(args.profile);
const profile=JSON.parse(await readFile(profilePath,'utf8'));
profile.streamHeaderDeadlineMs??=5000;
if(process.platform==='win32' && profile.name!=='smoke')throw new Error('Only smoke is allowed on the shared PC.');
planFixture(profile);
const workers=fixtureWorkers(args['fixture-workers'],{groups:profile.fixture.groups});
const fixtureFrom=args['fixture-from']?path.resolve(args['fixture-from']):'';
integer(profile.catalogue.chunks,2,10000,'chunks');integer(profile.catalogue.tasks,1,200000,'tasks');
integer(profile.catalogue.dependencyDepth,1,32,'dependencyDepth');integer(profile.catalogue.crossLinks,1,8,'crossLinks');
integer(profile.port,0,8999,'port');if(profile.port!==0&&profile.port<8900)throw new Error('Use port 0 or 8900–8999.');
integer(profile.requestDeadlineMs,1,120000,'client deadline'); integer(profile.maxClientInFlight,1,20000,'client in-flight cap');integer(profile.sampleSeconds,1,60,'sampleSeconds');
integer(profile.diskSampleSeconds,1,3600,'diskSampleSeconds');
integer(profile.streamHeaderDeadlineMs,1,120000,'stream header deadline');
if(!Number.isFinite(profile.fixture.unlockFraction)||profile.fixture.unlockFraction<0||profile.fixture.unlockFraction>1)throw new Error('Invalid unlockFraction.');
if(!Array.isArray(profile.upstreamScenarios)||!profile.upstreamScenarios.length||profile.upstreamScenarios.some(s=>!['ok','private','unknown','malformed','oversized','timeout','429'].includes(s)))throw new Error('Invalid fake upstream scenarios.');
for(const stage of profile.stages) {
  if(!['nominal','overload','recovery'].includes(stage.classification))throw new Error('Stage classification must be nominal, overload or recovery.');
  integer(stage.users,1,400,'users');integer(stage.activeGroups,1,profile.fixture.groups,'active groups');
  if(!Number.isFinite(stage.seconds)||stage.seconds<=0||stage.seconds>86400||['browserPerSecond','pluginPerSecond','syncPerMinute'].some(k=>!Number.isFinite(stage[k])||stage[k]<0))throw new Error('Invalid stage.');
}
if(process.platform==='win32' && profile.stages.reduce((n,s)=>n+s.seconds,0)>120)throw new Error('PC smoke must stay under two minutes.');
if(process.platform==='win32' && (profile.fixture.groups>5 || profile.catalogue.tasks>500 || profile.catalogue.chunks>64 || profile.fixture.historyEvents>20 || profile.fixture.snapshots>10 || profile.stages.some(s=>s.users>10||s.pluginPerSecond>10||s.browserPerSecond>10)))throw new Error('PC smoke fixture/rates must remain tiny.');
if(!args.output)throw new Error('Use --output NEW_DIRECTORY (must not exist).');
const directory=path.resolve(args.output);await mkdir(directory,{mode:0o700});
const profileFile=path.join(directory,'profile.json');await writeFile(profileFile,JSON.stringify(profile,null,2),{flag:'wx'});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|COMSPEC|PATHEXT)$/i.test(key)));
const launch=mode=>fork(fileURLToPath(new URL('./server.mjs',import.meta.url)),[directory,profileFile,mode,String(workers),fixtureFrom],{cwd:root,env,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
const childLogs=child=>{
  // Synthetic-only child output, bounded independently of the run length.
  let bytes=0;for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if((bytes+=chunk.length)<=1024*1024)void appendFile(path.join(directory,'server.log'),chunk);});
};
async function until(child,type) {
  return new Promise((resolve,reject)=>{
    const message=m=>{if(m.type===type){cleanup();resolve(m);}else if(m.type==='failure'){cleanup();reject(new Error(`${m.name}: ${m.message}`));}};
    const exit=()=>{cleanup();reject(new Error(`Scratch child exited before ${type}.`));};
    const cleanup=()=>{child.off('message',message);child.off('exit',exit);child.off('error',error);};
    const error=e=>{cleanup();reject(e);};child.on('message',message);child.once('exit',exit);child.once('error',error);
  });
}
async function stop(child) {
  if(child.exitCode!==null||child.signalCode!==null)return {forced:false,exitCode:child.exitCode,signal:child.signalCode};
  return new Promise(resolve=>{
    let forced=false;
    const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},15000);child.once('exit',(exitCode,signal)=>{clearTimeout(timer);resolve({forced,exitCode,signal});});
    if(child.connected)child.send({type:'stop'});else child.kill('SIGTERM');
  });
}
let server,setup;
const sourceHash=createHash('sha256');
for(const subdirectory of ['app','scripts/lib','scripts/perf/capacity']) {
  const base=path.join(root,subdirectory);
  const files=await readdir(base,{recursive:true,withFileTypes:true});
  for(const entry of files.filter(entry=>entry.isFile()).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name),'en'))) {
    const filename=path.join(entry.parentPath,entry.name);sourceHash.update(path.relative(root,filename).replaceAll('\\','/'));sourceHash.update(await readFile(filename));
  }
}
const sourceTreeDigest=sourceHash.digest('hex');
const started=Date.now(),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
try {
  console.log(fixtureFrom?'Verifying and copying completed synthetic fixture.':`Generating synthetic fixture with ${workers} workers; progress is fixture-progress.json.`);
  setup=launch('fixture');childLogs(setup);await until(setup,'generated');await new Promise(resolve=>setup.exitCode!==null?resolve():setup.once('exit',resolve));
  const fixture=JSON.parse(await readFile(path.join(directory,'fixture.json'),'utf8'));
  const setupSeconds=(Date.now()-started)/1000;
  if(args['fixture-only']) {
    await writeFile(path.join(directory,'setup-summary.json'),JSON.stringify({sourceCommit,sourceTreeDigest,setupSeconds,
      fixtureDigest:fixture.fixtureDigest,workers:fixture.workers,reused:Boolean(fixtureFrom)},null,2));
    console.log(`Completed reusable fixture: ${fixture.groups.length} groups, ${setupSeconds.toFixed(1)} s setup.`);
  } else {
  console.log(`Fixture ready: ${fixture.groups.length} groups, ${fixture.characters} slots. Starting measured server.`);
  server=launch('server');childLogs(server);const ready=await until(server,'ready');
  let id=0,busy=false,telemetryErrors=0,lastCpu,lastAt,lastWindowAt,lastDisk=0,disk=null,runStart;
  const samples=[],pending=new Map();
  server.on('message',m=>{if(m.type==='sample'||m.type==='sample-error'){const request=pending.get(m.id);if(request){pending.delete(m.id);request(m);}}});
  const sample=async client=>{
    if(busy)return;busy=true;
    try {
      const request=++id,windowAt=performance.now();
      const data=await new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(request);resolve(null);},5000);pending.set(request,m=>{clearTimeout(timer);resolve(m);});if(server.connected)server.send({type:'sample',id:request});});
      const at=performance.now(),tree=await processTree(server.pid);
      if(tree.supported && !tree.processes)telemetryErrors++;
      if(!disk||at-lastDisk>=profile.diskSampleSeconds*1000){disk=await diskBytes(directory);lastDisk=at;}
      if(!data||data.type==='sample-error')telemetryErrors++;
      const windowEnd=performance.now(),window=stageWindow(profile.stages,runStart,lastWindowAt??windowAt,windowEnd);
      const row={elapsedMs:runStart===undefined?null:windowEnd-runStart,...window,measured:client.phase?false:window.measured,
        windowStartElapsedMs:runStart===undefined?null:(lastWindowAt??windowAt)-runStart,tree,disk,client,server:data?.type==='sample'?data:null,
        treeCpuPercent:lastCpu!==undefined&&tree.cpuSeconds!==null?Math.max(0,(tree.cpuSeconds-lastCpu)/((at-lastAt)/1000)/cpus().length*100):null};
      lastCpu=tree.cpuSeconds??undefined;lastAt=at;if(data?.type==='sample')lastWindowAt=windowAt;
      samples.push(row);await appendFile(path.join(directory,'samples.jsonl'),JSON.stringify(row)+'\n');
    } catch(error) {telemetryErrors++;throw error;} finally {busy=false;}
  };
  await sample({phase:'before'});
  const load=await drive({base:ready.base,profile,fixture,directory,onSample:sample,startWorkload:()=>runStart=performance.now()});
  while(busy)await new Promise(resolve=>setTimeout(resolve,10));
  await sample({phase:'after'});
  const shutdown=await stop(server);server=undefined;
  const result={schemaVersion:1,sourceCommit,sourceTreeDigest,node:process.version,platform:process.platform,hardware:{cpuModel:cpus()[0].model,logicalCpus:cpus().length,ramBytes:totalmem()},
    profile,profileDigest:digest(profile),setupSeconds,elapsedSeconds:(Date.now()-started)/1000,
    fixture:{groups:fixture.groups.length,characters:fixture.characters,logins:fixture.logins,keys:fixture.keys,gaps:fixture.gaps,planDigest:fixture.planDigest,
      catalogueDigest:fixture.catalogueDigest,catalogueBytes:fixture.catalogueBytes,engineCatalogueTasks:fixture.engineCatalogueTasks,
      growthMode:fixture.growthMode,initializationMs:fixture.initializationMs,
      fixtureDigest:fixture.fixtureDigest,workers:fixture.workers,reused:Boolean(fixtureFrom),
      setup:fixture.groups.map(({index,grown,setupMs,growthMs,durableMs,registryMs,capabilitiesMs,growthCommands,stateBytes})=>({index,grown,setupMs,growthMs,durableMs,registryMs,capabilitiesMs,growthCommands,stateBytes})),
      datasetDigest:fixture.datasetDigest,retention:fixture.groups.map(g=>({index:g.index,stateDigest:g.stateDigest,...g.retention,snapshots:g.retainedSnapshots}))},
    load,samples,telemetryErrors,shutdown};
  result.gates=evaluate(result);
  await writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2));await writeFile(path.join(directory,'summary.md'),markdown(result));
  console.log(`Results: ${path.join(directory,'summary.md')}; ${load.stats.offered} arrivals, ${load.stats.rejects} rejects, ${load.stats.timeouts} timeouts.`);
  }
  // Capacity failures are data, not harness execution failures. Inspect gates.
} catch(error) {
  await writeFile(path.join(directory,'failure.json'),JSON.stringify({sourceCommit,profileDigest:digest(profile),name:error.name,message:error.message}));
  throw error;
} finally {if(server)await stop(server);if(setup)await stop(setup);}
