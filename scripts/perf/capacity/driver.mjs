import { openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { arrivals, dispatch } from './scheduler.mjs';
import { loopback, random } from './model.mjs';
import { createBrowserClient, reconnectStream, pause, retryAfterMs } from './client.mjs';

export function percentile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b); return sorted.length ? sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] : null;
}
export const distribution=values=>({count:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),p99Ms:percentile(values,.99),maxMs:values.length?values.reduce((a,b)=>Math.max(a,b),0):null});
// A missing prerequisite means the measured request was never sent. It must not
// stand in for a measured sample. An empty task list is a fixture/driver failure;
// an empty unlock pool can be legitimate, so it is only excluded from latency.
const failedPrerequisite=status=>status==='empty-task-list';
export const measuredOutcome=outcome=>!outcome.intentionalConflict&&!['unsupported','empty-task-list','empty-pool'].includes(outcome.status);
export function outcomeCounts(outcome) {
  const requests=outcome.requests??[], intentional=r=>r.status===409 &&
    (r.intentionalConflict===true || r.intentionalConflict===undefined && outcome.intentionalConflict && (!r.route || r.route==='/api/command'));
  const unexpected=status=>status==='network-error'||typeof status==='number'&&status>=400&&![429,503].includes(status);
  const unexpectedRequests=requests.filter(r=>unexpected(r.status)&&!intentional(r)).length;
  return {httpRequests:requests.length,httpRejects:requests.filter(r=>[429,503].includes(r.status)).length,
    rejectsWithoutRetryAfter:requests.filter(r=>[429,503].includes(r.status)&&!r.retryAfter).length,
    timeouts:requests.filter(r=>r.status==='timeout').length,
    unexpectedFailures:unexpectedRequests||Number(failedPrerequisite(outcome.status)||unexpected(outcome.status)&&!(outcome.status===409&&(requests.length?requests.some(intentional):outcome.intentionalConflict))),
    intentionalConflicts:requests.filter(intentional).length,unsupported:outcome.status==='unsupported'?1:0};
}
export async function explainAction(call, client, action, ordinal) {
  // Why is a bounded saved-evidence read, not a request to compute an arbitrary
  // catalogue ID. Follow the UI's task-list -> selected row -> explanation flow.
  const list = await call(client, `/api/tasks?memberId=${client.memberId}&view=play-v1`);
  if (!list.tasks?.length) throw Object.assign(new Error('EmptyTasks'), { status: 'empty-task-list' });
  if (!Number.isSafeInteger(list.stateRevision)) throw new Error('Task list is missing its revision.');
  const task = list.tasks[ordinal % list.tasks.length];
  await call(client, `/api/task-${action}?memberId=${client.memberId}&taskId=${encodeURIComponent(task.id)}&revision=${list.stateRevision}${action==='why'?'&view=display-v1':''}`);
}
export function prepareCohorts(profile,fixture) {
  const cohorts=new Map(),rotationMs=rotationInterval(profile);let startMs=0;
  for(const [stageIndex,stage] of profile.stages.entries()) {
    const endMs=startMs+stage.seconds*1000;
    for(let rotation=Math.floor(startMs/rotationMs);rotation<Math.max(1,Math.ceil(endMs/rotationMs));rotation++) {
      const groups=Array.from({length:stage.activeGroups},(_,i)=>fixture.groups[(i+rotation*stage.activeGroups)%fixture.groups.length]),list=[];
      for(let slot=0;slot<5;slot++)for(const group of groups)if(group.members[slot])list.push({...group.members[slot],group:group.index,pickerId:group.pickerId,taskIds:group.taskIds,peers:group.members.map(m=>m.memberId)});
      if(list.length<stage.users)throw new Error(`Stage ${stageIndex} (${stage.name??'unnamed'}), cohort ${rotation}: requested ${stage.users} users but selected groups provide ${list.length} synthetic logins.`);
      cohorts.set(`${stageIndex}:${rotation}`,list.slice(0,stage.users));
    }
    startMs=endMs;
  }
  return cohorts;
}
export function rotationInterval(profile) {
  if(profile.rotationSeconds==null)return Infinity;
  if(!Number.isFinite(profile.rotationSeconds)||profile.rotationSeconds<=0)throw new Error('Invalid cohort rotation interval.');
  return profile.rotationSeconds*1000;
}
export async function consumeStream({base,client,controller,counters,stats,planned,headerDeadlineMs=5000,fetchRequest=fetch,timer=setTimeout,cancelTimer=clearTimeout}) {
  const currentCounters=()=>typeof counters==='function'?counters():counters;
  let headersReceived=false,headerExpired=false;
  currentCounters().attempted++;
  const deadline=timer(()=>{headerExpired=true;controller.abort(new Error('SSE header deadline expired.'));},headerDeadlineMs);
  try {
    const response=await fetchRequest(base+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal,redirect:'error'});
    headersReceived=true;cancelTimer(deadline);
    currentCounters().statuses[response.status]=(currentCounters().statuses[response.status]??0)+1;
    if(!response.ok){
      stats.streamRejected++;currentCounters().rejected++;
      if([429,503].includes(response.status)){if(!response.headers.get('retry-after'))currentCounters().rejectsWithoutRetryAfter++;}
      else currentCounters().unexpectedFailures++;
      await response.body?.cancel();
      return {opened:false,retryAfterMs:retryAfterMs(response)};
    }
    stats.streamOpened++;currentCounters().opened++;
    for await(const bytes of response.body)stats.httpBytes+=bytes.length;
    if(!planned()){stats.streamUnexpectedEnds++;currentCounters().unexpectedEnds++;}
    return {opened:true};
  } catch {
    if(!headersReceived&&(headerExpired||!planned())){stats.streamEstablishmentFailures++;currentCounters().establishmentFailures++;}
    else if(headersReceived&&!planned()){stats.streamUnexpectedEnds++;currentCounters().unexpectedEnds++;}
  } finally {cancelTimer(deadline);}
}
export async function drive({base,profile,fixture,directory,onSample,startWorkload=()=>performance.now(),fetchRequest=fetch,schedule=dispatch}) {
  base=loopback(base,{assigned:profile.port===0});
  const cohorts=prepareCohorts(profile,fixture),chunks=Object.keys((await import('./model.mjs')).catalogue(profile.catalogue).chunks);
  const events=arrivals(profile.stages,profile.seed,stage=>({browser:stage.browserPerSecond,pluginReport:stage.pluginPerSecond*.4,
    pluginStatus:stage.pluginPerSecond*.4,pluginTasks:stage.pluginPerSecond*.2,sync:stage.syncPerMinute/60})).map((event,i)=>({...event,id:i+1}));
  const log=openSync(path.join(directory,'events.jsonl'),'wx',0o600), records={}, stats={offered:events.length,completed:0,httpRequests:0,httpBytes:0,httpErrors:0,
    rejects:0,timeouts:0,conflicts:0,intentionalConflicts:0,unsupported:0,clientDrops:0,streamOpened:0,streamRejected:0,streamUnexpectedEnds:0,streamEstablishmentFailures:0},
    streams=new Map(),streamJobs=new Set(),stageStreams=profile.stages.map(()=>({attempted:0,opened:0,rejected:0,unexpectedEnds:0,unexpectedFailures:0,rejectsWithoutRetryAfter:0,establishmentFailures:0,statuses:{}})),seq=new Map(),readers=new Map(),sessions=new Map(),commands=new Map();
  let streamShutdown=false, active=0, maxActive=0;
  const request=async(client,route,body,extra={})=>{
    stats.httpRequests++;
    const requestStart=performance.now();
    const observation={route:route.split('?')[0],status:'pending',...(route.startsWith('/api/command')?{command:body?.command?.type}: {})};client.observations?.push(observation);
    let res;
    try {res=await fetchRequest(base+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(profile.requestDeadlineMs),
      headers:{...(extra.plugin?{Authorization:'Bearer '+client.key}:{Cookie:client.cookie}),
        ...(!extra.plugin&&route!=='/api/session'&&client.pickerId?{'X-Picker-Id':client.pickerId}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    } catch(error) {observation.status=error.name==='TimeoutError'?'timeout':'network-error';observation.wallMs=performance.now()-requestStart;stats.httpErrors++;throw error;}
    let text;
    try {text=await res.text();}catch(error){observation.status=error.name==='TimeoutError'?'timeout':'network-error';observation.wallMs=performance.now()-requestStart;stats.httpErrors++;throw error;}
    stats.httpBytes+=Buffer.byteLength(text);
    let value;try{value=JSON.parse(text);}catch{value=null;}
    Object.assign(observation,{status:res.status,retryAfter:res.headers.get('retry-after'),wallMs:performance.now()-requestStart,
      cacheHit:typeof value?.cache?.hit==='boolean'?value.cache.hit:null,evaluationMs:value?.cache?.evaluationMs??null,timingMs:value?.cache?.timingMs??null});
    const revision=body?.expectedRevision??new URL(route,base).searchParams.get('revision');
    if(revision!==null&&revision!==undefined&&Number.isSafeInteger(Number(revision)))observation.requestRevision=Number(revision);
    const responseRevision=value?.stateRevision??value?.state?.revision??value?.revision;
    if(Number.isSafeInteger(responseRevision))observation.responseRevision=responseRevision;
    if(!res.ok) {
      if(['TASK_WHY_UNAVAILABLE','TASK_DETAILS_UNAVAILABLE','TASK_RESULTS_UNAVAILABLE','REVISION_CONFLICT','PICKER_WARMING','PICKER_UPDATING'].includes(value?.code))observation.errorCode=value.code;
      observation.intentionalConflict=res.status===409&&extra.intentionalConflict===true&&observation.route==='/api/command';
      stats.httpErrors++; if([429,503].includes(res.status)) stats.rejects++;if(res.status===409)stats.conflicts++;
    }
    return {ok:res.ok,status:res.status,headers:res.headers,json:async()=>value};
  };
  const call=async(client,route,body,extra={})=>{
    const identity=extra.plugin?client.key:client.cookie;
    let reader=readers.get(identity);
    if(!reader) {
      reader=createBrowserClient({request:(route,options)=>request(options.extra.client,route,options.body,options.extra)});
      readers.set(identity,reader);
    }
    const options={...extra,client};
    if(!extra.plugin&&route!=='/api/session') {
      let check=sessions.get(identity);
      if(!check) {
        check=reader('/api/session',undefined,options).finally(()=>sessions.delete(identity));
        sessions.set(identity,check);
      }
      await check;
    }
    return reader(route,body,options);
  };
  function openStreams(pool) {
    // Retained streams cross stage boundaries. Attribute reconnect failures and
    // disconnects when they happen, rather than to the original warm-up stage.
    const counters=()=>stageStreams[currentStage];
    const wanted=new Set(pool.map(client=>client.cookie));
    for(const [key,controller] of streams)if(!wanted.has(key)){controller.abort();streams.delete(key);}
    for(const client of pool) {
      if(streams.has(client.cookie))continue;
      const controller=new AbortController(); streams.set(client.cookie,controller);
      const rng=random(`${profile.seed}-stream-${client.group}-${client.memberId}`);
      const job=reconnectStream({signal:controller.signal,sleep:pause,rng,spreadMs:profile.streamConnectSpreadMs??1000,
        connect:async()=>{
          const attemptController=new AbortController(),abort=()=>attemptController.abort();
          controller.signal.addEventListener('abort',abort,{once:true});
          if(controller.signal.aborted)abort();
          try {return await consumeStream({base,client,controller:attemptController,counters,stats,fetchRequest,headerDeadlineMs:profile.streamHeaderDeadlineMs??5000,
            planned:()=>streamShutdown||controller.signal.aborted});}
          finally {controller.signal.removeEventListener('abort',abort);}
        }});
      streamJobs.add(job);job.finally(()=>streamJobs.delete(job));
    }
  }
  const timing=[];
  const record=(action,event,start,end,outcome)=>{
    for(const observation of outcome.requests??[])if(observation.command) {
      const key=`${observation.command}:${observation.status}`,row=commands.get(key)??{command:observation.command,status:observation.status,values:[]};
      row.values.push(observation.wallMs);commands.set(key,row);
    }
    const row={id:event.id,stage:event.stage,action,scheduledMs:event.atMs,startLagMs:start-event.scheduledAt,latencyMs:end-event.scheduledAt,httpWallMs:end-start,...outcome};
    const group=records[`${event.stage}:${action}`]??={stage:event.stage,action,all:[],valid:[],success:[],lag:[],statuses:{},httpRequests:0,httpRejects:0,timeouts:0,
      rejectsWithoutRetryAfter:0,unexpectedFailures:0,intentionalConflicts:0,unsupported:0,cacheHits:0,cacheMisses:0};
    group.all.push(row.latencyMs);group.lag.push(row.startLagMs);if(outcome.status===200)group.success.push(row.latencyMs);
    if(measuredOutcome(outcome))group.valid.push(row.latencyMs);
    group.statuses[outcome.status]=(group.statuses[outcome.status]??0)+1;
    for(const [key,count] of Object.entries(outcomeCounts(outcome)))group[key]+=count;
    group.cacheHits+=(outcome.requests??[]).filter(r=>r.cacheHit===true).length;group.cacheMisses+=(outcome.requests??[]).filter(r=>r.cacheHit===false).length;
    writeSync(log,JSON.stringify(row)+'\n');stats.completed++;
  };
  let currentStage=-1,currentRotation=-1,pool=[];
  const run=async event=>{
    const rng=random(`${profile.seed}-actions-${event.id}`);
    const rotation=Math.floor(event.atMs/rotationInterval(profile));
    if(event.stage!==currentStage||rotation!==currentRotation) {
      const nextPool=cohorts.get(`${event.stage}:${rotation}`);
      if(!nextPool)throw new Error('Unvalidated workload cohort.');
      currentStage=event.stage;currentRotation=rotation;pool=nextPool;
      openStreams(pool);
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
          const variant=rng();
          action=variant<.5?'task-view':variant<.7?'group-task-view':variant<.85?'how':'why';
          if(action==='task-view')await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
          else if(action==='how'||action==='why')await explainAction(call,client,action,event.id);
          else {
            const state=(await call(client,'/api/state?view=play-v1')).state;
            const peer=client.peers.find(id=>id!==client.memberId);
            if(action==='group-task-view'&&peer)await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1&lane=duo-v1&peerFor=${peer}&revision=${state.revision}`);
            else if(action==='group-task-view')await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
          }
        }
        else if(pick<.85) {
          action='edit';const state=(await call(client,'/api/state?view=play-v1')).state;
          intentional=rng()<.1 && state.revision>0;
          const variant=rng();
          const command=variant<.5?{type:'set-note',memberId:client.memberId,chunkId:chunks[event.id%chunks.length],note:`Synthetic live ${event.id}`}:
            variant<.8?{type:'set-task-status',memberId:client.memberId,taskId:client.taskIds[event.id%client.taskIds.length],favorite:event.id%2===0}:
              {type:'set-skill-levels',memberId:client.memberId,skill:'Mining',passiveLevel:1+event.id%90};
          await call(client,'/api/command?view=play-v1',{expectedRevision:state.revision-(intentional?1:0),command},{intentionalConflict:intentional});
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
      const intentionalConflict=status===409&&client.observations.at(-1)?.intentionalConflict===true;
      if(intentionalConflict)stats.intentionalConflicts++;
      record(action,event,start,performance.now(),{status,intentionalConflict,retryAfter:error.retryAfter??null,requests:client.observations});
    } finally { active--; }
  };
  const workloadStart=startWorkload();
  const sampleTimer=setInterval(()=>{void onSample({active,maxActive,completed:stats.completed,clientMemory:process.memoryUsage(),clientCpu:process.cpuUsage()}).catch(()=>{});},profile.sampleSeconds*1000);
  try {
    await schedule(events,run,{startAt:workloadStart,maxInFlight:profile.maxClientInFlight,onDrop:event=>{stats.clientDrops++;record('client-drop',event,performance.now(),performance.now(),{status:'client-drop'});}});
    timing.push({maxActive});
  } finally {clearInterval(sampleTimer);streamShutdown=true;for(const controller of streams.values())controller.abort();await Promise.allSettled(streamJobs);closeSync(log);}
  return {workloadStart,stats,stageStreams,commands:[...commands.values()].map(({values,...row})=>({...row,latency:distribution(values)})),operations:Object.values(records).map(({all,valid,success,lag,...rest})=>({...rest,latency:distribution(all),validLatency:distribution(valid),successfulLatency:distribution(success),clientDispatchLag:distribution(lag)})),timing};
}
