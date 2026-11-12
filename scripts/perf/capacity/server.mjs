// Runs only as the scratch runner's IPC child. Never consumes inherited secrets/config.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { catalogue, random, loopback, syntheticWorld } from './model.mjs';
import { observeServerIdentity } from './evidence.mjs';
import { configureMemoryProfile, verifyServerMemoryProfile } from './memory-profile.mjs';
if(!process.send) throw new Error('Use run.mjs.');
const [directory,profileFile,mode,workers,fixtureFrom]=process.argv.slice(2);
const profile=JSON.parse(await readFile(profileFile,'utf8'));
const memoryProfile=configureMemoryProfile(profile.requestedMemoryProfile ?? profile.memoryProfile);
process.env.RS3_DATASET='duo-legacy'; process.env.RS3_TASK_WORKER_MODE='process';
process.env.RS3_PACKS_DIR=path.join(directory,'no-packs');
process.env.RS3_GAME_DATA_DIR=path.join(directory,'no-game-data');
process.env.RS3_MAP_ASSETS_DIR=path.join(directory,'no-assets');
process.env.RS3_WORKER_MEMORY_PROBE_IMPORT=new URL('./heap-probe.mjs',import.meta.url).href;
if(mode==='fixture') {
  const lostParent=()=>process.exit(1);
  process.once('disconnect',lostParent);
  try {
    if(fixtureFrom) {
      const {selectedDataset}=await import('../../../app/dataset-runtime.mjs');
      await (await import('./fixture-cache.mjs')).copyFixture(fixtureFrom,directory,profile,selectedDataset.digest);
    } else await (await import('./fixture.mjs')).generate(profile,directory,{workers:Number(workers)});
    process.send({type:'generated'});
  }
  catch(error) { process.stderr.write(`${error?.stack ?? error}\n`); process.send({type:'failure',name:error.name,message:error.message}); process.exitCode=1; }
  process.off('disconnect',lostParent); process.disconnect();
} else {
  let app, stopping=false, calls=0;
  const upstreamCounts={};
  // Injected at the Platform client's transport boundary: no DNS/network request can escape.
  const fake=async(url,{signal}={})=>{
    const parsed=new URL(url), name=parsed.searchParams.get('player')??decodeURIComponent(parsed.pathname.split('/').at(-1));
    if(!/^S\d+M\d+$/.test(name)) throw new Error('Non-synthetic upstream name refused.');
    const scenario=profile.upstreamScenarios[Math.floor(calls++/2)%profile.upstreamScenarios.length];
    upstreamCounts[scenario]=(upstreamCounts[scenario]??0)+1;
    if(scenario==='timeout') return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Synthetic abort')); if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
    if(scenario==='429') return new Response('',{status:429,headers:{'Retry-After':'1'}});
    if(scenario==='private') return new Response('',{status:403});
    if(scenario==='unknown') return new Response('',{status:404});
    if(scenario==='malformed') return new Response('{');
    if(scenario==='oversized') return new Response(' '.repeat(3*1024*1024));
    return Response.json(parsed.searchParams.has('player') ? {name,skills:[{id:1,name:'Attack',level:20,xp:4470}]} : {name,qp:0,qp_max:1,quests:{}});
  };
  const loop=monitorEventLoopDelay({resolution:10}); loop.enable();
  let lastUtilization=performance.eventLoopUtilization();
  const admission={},workers=new Set();let coldQueue={};
  const stop=async()=>{if(stopping)return;stopping=true;loop.disable();await app?.close();process.disconnect();};
  try {
    const {createServer}=await import('../../../app/server.mjs');
    const data=catalogue(profile.catalogue);
    const {buildWorld}=await import('../../../app/data/world.mjs');
    const {createGroupState}=await import('../../../app/core/state.mjs');
    const ownedFormat2=profile.storageFormat==='format2'?await (await import('./owned-release.mjs')).loadCapacityOwnedRelease(directory):false;
    app=await createServer({dataDir:path.join(directory,'legacy'),host:'127.0.0.1',port:profile.port,
      ownedFormat2,
      loopbackPort:undefined,publicOrigin:undefined,definitions:data,world:syntheticWorld(data,buildWorld),taskMap:{},
      initialState:createGroupState([{id:'legacy1',name:'Synthetic legacy 1'},{id:'legacy2',name:'Synthetic legacy 2'}]),
      packsDir:path.join(directory,'no-packs'),packSelection:undefined,gameDataDir:path.join(directory,'no-game-data'),mapAssetsDir:path.join(directory,'no-assets'),
      signIn:'off',random:random(profile.seed),runeMetrics:{fetchImpl:fake},
      progressSources:{hiscores:{snapshot:async()=>({available:false}),close(){}}},
      originalSync:{fetchImpl:async()=>{throw new Error('Disabled synthetic upstream');}},
      taskWorkerOptions:{onWorker(worker){workers.add(worker);worker.once('exit',()=>workers.delete(worker));}},
      multiPicker:{registryDir:path.join(directory,'registry'),pickerRoot:path.join(directory,'pickers'),tombstoneDir:path.join(directory,'tombstones'),
        caps:profile.entityCaps,
        onContextOpen:event=>process.send({type:'context-open',atMs:performance.now(),...event}),
        onAdmission:event=>{const kind=event.kind??event.type??event.event??'event';admission[kind]=(admission[kind]??0)+1;
          process.send({type:'admission',atMs:performance.now(),...event});
          coldQueue={pending:event.pending,active:event.active,accounts:event.accounts,waitMs:event.waitMs,serviceMs:event.serviceMs};}},
    });
    const serverId=observeServerIdentity(app.server);
    await app.listen();
    const base=loopback(`http://127.0.0.1:${app.address().port}`,{assigned:profile.port===0});
    const headers={Authorization:'Bearer '+app.store.getAccessToken()};
    const get=async route=>{const res=await fetch(base+route,{headers,signal:AbortSignal.timeout(5000),redirect:'error'});if(!res.ok)throw new Error('Telemetry HTTP failure');return res.json();};
    // Verify the running app before announcing ready, on every process generation.
    const memoryProfileVerification=await verifyServerMemoryProfile(memoryProfile,get);
    process.send({type:'ready',base,serverId,memoryProfile,memoryProfileVerification});
    process.on('message',async message=>{
      try {
        if(message.type==='stop') return await stop();
        if(message.type==='sample') {
          // Send each HTTP observation immediately; calculator heap probes must
          // not make an earlier health/residency result look fresh.
          await Promise.all([['health','/api/health'],['diagnostics','/api/diagnostics']].map(async([part,route])=>{
            const value=await get(route);process.send({type:`sample-${part}`,id:message.id,serverId,memoryProfile,[part]:value});
          }));
          const calculatorHeaps=await Promise.all([...workers].filter(worker=>typeof worker.getMemoryUsage==='function').map(async worker=>{
            try {const value=await worker.getMemoryUsage();return {pid:value.pid,hostHeapUsed:value.main?.heapUsed,threadHeapUsed:value.workers?.length?value.workers.reduce((n,w)=>n+(w.memoryUsage?.heapUsed??0),0):null};}catch{return null;}
          }));
          const currentUtilization=performance.eventLoopUtilization(), utilization=performance.eventLoopUtilization(currentUtilization,lastUtilization);
          lastUtilization=currentUtilization;
          process.send({type:'sample',id:message.id,serverId,memoryProfile,memory:process.memoryUsage(),cpu:process.cpuUsage(),
            eventLoop:{p50Ms:loop.percentile(50)/1e6,p95Ms:loop.percentile(95)/1e6,p99Ms:loop.percentile(99)/1e6,maxMs:loop.max/1e6,
              utilization:utilization.utilization,activeMs:utilization.active,idleMs:utilization.idle},calculatorHeaps,coldQueue,admission:{...admission},upstreamCounts:{...upstreamCounts}});
          loop.reset();
        }
      } catch { process.send({type:'sample-error',id:message.id}); }
    });
    process.once('disconnect',()=>{void stop();});
    process.once('SIGTERM',()=>{void stop();});
  } catch(error) { process.stderr.write(`${error?.stack ?? error}\n`); process.send({type:'failure',name:error.name,message:error.message,code:error.code,verification:error.verification}); await app?.close(); process.disconnect();process.exitCode=1; }
}
