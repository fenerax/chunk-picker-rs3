import { openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { arrivals, dispatch } from './scheduler.mjs';
import { loopback, random } from './model.mjs';

export function percentile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b); return sorted.length ? sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] : null;
}
const distribution=values=>({count:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),p99Ms:percentile(values,.99),maxMs:values.length?values.reduce((a,b)=>Math.max(a,b),0):null});
export async function drive({base,profile,fixture,directory,onSample}) {
  base=loopback(base,{assigned:profile.port===0});
  const rng=random(profile.seed+'-actions'), chunks=Object.keys((await import('./model.mjs')).catalogue(profile.catalogue).chunks);
  const events=arrivals(profile.stages,profile.seed,stage=>({browser:stage.browserPerSecond,pluginReport:stage.pluginPerSecond*.4,
    pluginStatus:stage.pluginPerSecond*.4,pluginTasks:stage.pluginPerSecond*.2,sync:stage.syncPerMinute/60,session:stage.users/5}));
  const log=openSync(path.join(directory,'events.jsonl'),'wx',0o600), records={}, stats={offered:events.length,completed:0,httpRequests:0,httpBytes:0,httpErrors:0,
    rejects:0,timeouts:0,conflicts:0,intentionalConflicts:0,unsupported:0,clientDrops:0,streamOpened:0,streamRejected:0,streamUnexpectedEnds:0},
    streams=[],streamJobs=new Set(),stageStreams=profile.stages.map(()=>({opened:0,rejected:0,unexpectedEnds:0})),seq=new Map();
  let streamShutdown=false, active=0, maxActive=0, eventId=0;
  const clients=(stage,rotation=0)=>{
    const groups=Array.from({length:stage.activeGroups},(_,i)=>fixture.groups[(i+rotation*stage.activeGroups)%fixture.groups.length]), list=[];
    for(let slot=0;slot<5;slot++) for(const group of groups) if(group.members[slot]) list.push({...group.members[slot],group:group.index,taskIds:group.taskIds,peers:group.members.map(m=>m.memberId)});
    if(list.length<stage.users) throw new Error('Profile needs more distinct synthetic logins in active groups.');
    return list.slice(0,stage.users);
  };
  const call=async(client,route,body,extra={})=>{
    stats.httpRequests++;
    const requestStart=performance.now();
    const observation={route:route.split('?')[0],status:'pending'};client.observations?.push(observation);
    let res;
    try {res=await fetch(base+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(profile.requestDeadlineMs),
      headers:{...(extra.plugin?{Authorization:'Bearer '+client.key}:{Cookie:client.cookie}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    } catch(error) {observation.status=error.name==='TimeoutError'?'timeout':'network-error';observation.wallMs=performance.now()-requestStart;stats.httpErrors++;throw error;}
    let text;
    try {text=await res.text();}catch(error){observation.status=error.name==='TimeoutError'?'timeout':'network-error';observation.wallMs=performance.now()-requestStart;stats.httpErrors++;throw error;}
    stats.httpBytes+=Buffer.byteLength(text);
    let value;try{value=JSON.parse(text);}catch{value=null;}
    Object.assign(observation,{status:res.status,wallMs:performance.now()-requestStart,
      cacheHit:typeof value?.cache?.hit==='boolean'?value.cache.hit:null,evaluationMs:value?.cache?.evaluationMs??null,timingMs:value?.cache?.timingMs??null});
    if(!res.ok) {
      stats.httpErrors++; if([429,503].includes(res.status)) stats.rejects++;if(res.status===409)stats.conflicts++;
      throw Object.assign(new Error('HTTP'),{status:res.status,retryAfter:res.headers.get('retry-after')});
    }
    return value;
  };
  function openStreams(stage,pool) {
    const counters=stageStreams[stage];
    for(const client of pool) {
      const controller=new AbortController(); streams.push(controller);
      // Do not wait for one group's stream before offering the next connection.
      const job=(async()=>{
        try {
          const response=await fetch(base+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal,redirect:'error'});
          if(!response.ok){stats.streamRejected++;counters.rejected++;return;}
          stats.streamOpened++;counters.opened++;
          for await(const bytes of response.body) { stats.httpBytes+=bytes.length; }
          if(!streamShutdown && !controller.signal.aborted){stats.streamUnexpectedEnds++;counters.unexpectedEnds++;}
        } catch {if(!streamShutdown && !controller.signal.aborted){stats.streamUnexpectedEnds++;counters.unexpectedEnds++;}}
      })();
      streamJobs.add(job);job.finally(()=>streamJobs.delete(job));
    }
  }
  const timing=[], sampleTimer=setInterval(()=>{void onSample({active,maxActive,completed:stats.completed,clientMemory:process.memoryUsage(),clientCpu:process.cpuUsage()}).catch(()=>{});},profile.sampleSeconds*1000);
  const record=(action,event,start,end,outcome)=>{
    const row={id:event.id,stage:event.stage,action,scheduledMs:event.atMs,startLagMs:start-event.scheduledAt,latencyMs:end-event.scheduledAt,httpWallMs:end-start,...outcome};
    const group=records[`${event.stage}:${action}`]??={stage:event.stage,action,all:[],success:[],lag:[],statuses:{},httpRequests:0,httpRejects:0,timeouts:0,cacheHits:0,cacheMisses:0};
    group.all.push(row.latencyMs);group.lag.push(row.startLagMs);if(outcome.status===200)group.success.push(row.latencyMs);
    group.statuses[outcome.status]=(group.statuses[outcome.status]??0)+1;
    group.httpRequests+=(outcome.requests??[]).length;group.httpRejects+=(outcome.requests??[]).filter(r=>[429,503].includes(r.status)).length;
    group.timeouts+=(outcome.requests??[]).filter(r=>r.status==='timeout').length;
    group.cacheHits+=(outcome.requests??[]).filter(r=>r.cacheHit===true).length;group.cacheMisses+=(outcome.requests??[]).filter(r=>r.cacheHit===false).length;
    writeSync(log,JSON.stringify(row)+'\n');stats.completed++;
  };
  let currentStage=-1,currentRotation=-1,pool=[];
  const run=async event=>{
    event.id=++eventId;
    const rotation=Math.floor(event.atMs/((profile.rotationSeconds??300)*1000));
    if(event.stage!==currentStage||rotation!==currentRotation) {
      currentStage=event.stage;
      currentRotation=rotation;pool=clients(profile.stages[event.stage],rotation);
      for(const controller of streams)controller.abort();streams.length=0;
      openStreams(currentStage,pool);
    }
    const client={...pool[event.kind==='browser'?Math.floor(rng()*pool.length):event.ordinal%pool.length],observations:[]},start=performance.now();
    let action=event.kind,intentional=false;active++;maxActive=Math.max(maxActive,active);
    try {
      if(event.kind==='session') await call(client,'/api/session');
      else if(event.kind==='sync') await call(client,'/api/runemetrics/preview',{memberId:client.memberId});
      else if(event.kind.startsWith('plugin')) {
        if(!client.key)throw Object.assign(new Error('NoKey'),{status:'unsupported'});
        if(event.kind==='pluginReport') {
          const n=(seq.get(client.key)??0)+1;seq.set(client.key,n);
          await call(client,'/api/plugin/v1/report',{v:1,seq:n,sentAt:new Date().toISOString(),world:{id:1,beta:false},position:{x:20,z:20,floor:0},skills:{MINING:{level:20,xp:4470}}},{plugin:true});
        } else await call(client,event.kind==='pluginStatus'?'/api/plugin/v1/status':'/api/plugin/v1/tasks',undefined,{plugin:true});
      } else {
        const pick=rng();
        if(pick<.5) { action=rng()<.4?'history':'state'; await call(client,action==='history'?'/api/history?limit=20':'/api/state?view=play-v1'); }
        else if(pick<.7) {
          const variant=rng(),taskId=client.taskIds[event.id%client.taskIds.length];
          action=variant<.5?'task-view':variant<.7?'group-task-view':variant<.85?'how':'why';
          if(action==='task-view')await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
          else {
            const state=(await call(client,'/api/state?view=play-v1')).state;
            const peer=client.peers.find(id=>id!==client.memberId);
            if(action==='group-task-view'&&peer)await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1&lane=duo-v1&peerFor=${peer}&revision=${state.revision}`);
            else if(action==='group-task-view')await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
            else await call(client,`/api/task-${action}?memberId=${client.memberId}&taskId=${encodeURIComponent(taskId)}&revision=${state.revision}${action==='why'?'&view=display-v1':''}`);
          }
        }
        else if(pick<.85) {
          action='edit';const state=(await call(client,'/api/state?view=play-v1')).state;
          intentional=rng()<.1 && state.revision>0;
          const variant=rng();
          const command=variant<.5?{type:'set-note',memberId:client.memberId,chunkId:chunks[event.id%chunks.length],note:`Synthetic live ${event.id}`}:
            variant<.8?{type:'set-task-status',memberId:client.memberId,taskId:client.taskIds[event.id%client.taskIds.length],favorite:event.id%2===0}:
              {type:'set-skill-levels',memberId:client.memberId,skill:'Mining',passiveLevel:1+event.id%90};
          await call(client,'/api/command?view=play-v1',{expectedRevision:state.revision-(intentional?1:0),command});
        } else if(pick<.9) {action='switch';throw Object.assign(new Error('Unsupported'),{status:'unsupported'});}
        else if(pick<59/60) {
          const op=rng();action=op<.4?'task-miss':op<.7?'preview':op<.9?'roll-accept':'pool-undo';
          const snapshot=await call(client,'/api/state?view=play-v1'),state=snapshot.state;
          if(op<.4) {
            action='task-miss';
            await call(client,'/api/command?view=play-v1',{expectedRevision:state.revision,command:{type:'set-rule',ruleId:'access.shared',value:state.rules['access.shared']===false}});
            await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
          } else {
            const pool=snapshot.pools?.[client.memberId]?.eligible??[];
            const candidate=pool[event.id%Math.max(1,pool.length)]?.id;
            if(op<.7) {action='preview';if(!candidate)throw Object.assign(new Error('EmptyPool'),{status:'empty-pool'}); await call(client,`/api/predict?memberId=${client.memberId}&chunkId=${candidate}`);}
            else {
              action=op<.9?'roll-accept':'pool-undo';
              if(!candidate)throw Object.assign(new Error('EmptyPool'),{status:'empty-pool'});
              const count=op<.9&&pool.length>=2?2:1;
              let result=await call(client,'/api/command?view=play-v1',{expectedRevision:state.revision,command:{type:'roll',memberId:client.memberId,count}});
              if(count===2)result=await call(client,'/api/command?view=play-v1',{expectedRevision:result.state.revision,command:{type:'pick-for-me',memberId:client.memberId}});
              if(op>=.9)await call(client,'/api/command?view=play-v1',{expectedRevision:result.state.revision,command:{type:'undo'}});
            }
          }
        } else {action='lifecycle';throw Object.assign(new Error('Unsupported'),{status:'unsupported'});}
      }
      record(action,event,start,performance.now(),{status:200,requests:client.observations});
    } catch(error) {
      const status=error.status??(error.name==='TimeoutError'?'timeout':'network-error');
      if(status==='timeout')stats.timeouts++;if(status==='unsupported')stats.unsupported++;
      if(status===409 && intentional)stats.intentionalConflicts++;
      record(action,event,start,performance.now(),{status,intentionalConflict:status===409&&intentional,retryAfter:error.retryAfter??null,requests:client.observations});
    } finally { active--; }
  };
  try {
    await dispatch(events,run,{maxInFlight:profile.maxClientInFlight,onDrop:event=>{event.id=++eventId;stats.clientDrops++;record('client-drop',event,performance.now(),performance.now(),{status:'client-drop'});}});
    timing.push({maxActive});
  } finally {clearInterval(sampleTimer);streamShutdown=true;for(const controller of streams)controller.abort();await Promise.allSettled(streamJobs);closeSync(log);}
  return {stats,stageStreams,operations:Object.values(records).map(({all,success,lag,...rest})=>({...rest,latency:distribution(all),successfulLatency:distribution(success),clientDispatchLag:distribution(lag)})),timing};
}
