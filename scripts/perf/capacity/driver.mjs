import { openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { arrivals, dispatch } from './scheduler.mjs';
import { loopback, random } from './model.mjs';
import { createBrowserClient, reconnectStream, pause, retryAfterMs, retryRead } from './client.mjs';
import { sustainedArrivals, sustainedAction, sustainedBrowserAction, sustainedPhase } from './sustained.mjs';

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
  let population=fixture.groups;
  if(rotationMs===Infinity&&profile.fixture?.freshFraction!==undefined) {
    const fraction=profile.fixture.freshFraction,fresh=population.filter(group=>group.grown===false),grown=population.filter(group=>group.grown===true);
    if(fresh.length!==Math.round(population.length*fraction)||fresh.length+grown.length!==population.length)throw new Error('Fixture fresh/grown inventory does not match the profile.');
    let freshIndex=0,grownIndex=0;
    // Every prefix has the rounded freshFraction, so ramp cohorts are nested
    // and the measured steady cohort cannot get stuck in the fresh-only prefix.
    population=population.map((_,i)=>Math.round((i+1)*fraction)>Math.round(i*fraction)?fresh[freshIndex++]:grown[grownIndex++]);
  }
  for(const [stageIndex,stage] of profile.stages.entries()) {
    const endMs=startMs+stage.seconds*1000;
    for(let rotation=Math.floor(startMs/rotationMs);rotation<Math.max(1,Math.ceil(endMs/rotationMs));rotation++) {
      const groups=Array.from({length:stage.activeGroups},(_,i)=>population[(i+rotation*stage.activeGroups)%population.length]),list=[];
      for(let slot=0;slot<5;slot++)for(const group of groups)if(group.members[slot])list.push({...group.members[slot],group:group.index,pickerId:group.pickerId,taskIds:group.taskIds,peers:group.members.map(m=>m.memberId)});
      if(list.length<stage.users)throw new Error(`Stage ${stageIndex} (${stage.name??'unnamed'}), cohort ${rotation}: requested ${stage.users} users but selected groups provide ${list.length} synthetic logins.`);
      cohorts.set(`${stageIndex}:${rotation}`,list.slice(0,stage.users));
    }
    startMs=endMs;
  }
  return cohorts;
}
export function sessionArrivals(profile,cohorts) {
  const events=[],intervalMs=5000,rotationMs=rotationInterval(profile);let startMs=0;
  for(const [stage,settings] of profile.stages.entries()) {
    const endMs=startMs+settings.seconds*1000;
    for(let rotation=Math.floor(startMs/rotationMs);rotation<Math.max(1,Math.ceil(endMs/rotationMs));rotation++) {
      const from=rotationMs===Infinity?startMs:Math.max(startMs,rotation*rotationMs),to=Math.min(endMs,(rotation+1)*rotationMs);
      for(const [clientIndex,client] of cohorts.get(`${stage}:${rotation}`).entries()) {
        // Anchor each login's stagger to workload time, keeping the same phase
        // across stage changes. Idle logins still check once every five seconds.
        const phase=random(`${profile.seed}-session-${client.group}-${client.memberId}`)()*intervalMs;
        for(let atMs=phase+Math.ceil((from-phase)/intervalMs)*intervalMs;atMs<to;atMs+=intervalMs)events.push({atMs,kind:'session',stage,clientIndex});
      }
    }
    startMs=endMs;
  }
  return events.sort((a,b)=>a.atMs-b.atMs);
}
export async function prepareRollSnapshot(call,client,snapshot,chunks) {
  const member=snapshot.state.members?.find(member=>member.id===client.memberId);
  if(member?.unlocked?.length===0) {
    // Fresh fixtures stay fresh on disk. Model choosing a first chunk through
    // the normal browser command before trying to roll or preview a neighbour.
    await call(client,'/api/command?view=play-v1',{expectedRevision:snapshot.state.revision,
      command:{type:'set-chunk',memberId:client.memberId,chunkId:chunks[0],status:'unlocked'}});
    return call(client,'/api/state?view=play-v1');
  }
  return snapshot;
}
export function rotationInterval(profile) {
  if(profile.rotationSeconds==null)return Infinity;
  if(!Number.isFinite(profile.rotationSeconds)||profile.rotationSeconds<=0)throw new Error('Invalid cohort rotation interval.');
  return profile.rotationSeconds*1000;
}
export async function consumeStream({base,client,controller,counters,stats,planned,onOpened=()=>{},onHandshake=()=>{},headerDeadlineMs=5000,fetchRequest=fetch,timer=setTimeout,cancelTimer=clearTimeout}) {
  const currentCounters=()=>typeof counters==='function'?counters():counters;
  let headersReceived=false,headerExpired=false,opened=false;
  currentCounters().attempted++;
  const deadline=timer(()=>{headerExpired=true;controller.abort(new Error('SSE header deadline expired.'));},headerDeadlineMs);
  try {
    const response=await fetchRequest(base+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal,redirect:'error'});
    headersReceived=true;cancelTimer(deadline);
    onHandshake({status:response.status,retryAfter:response.headers?.get?.('retry-after')??null});
    currentCounters().statuses[response.status]=(currentCounters().statuses[response.status]??0)+1;
    if(!response.ok){
      stats.streamRejected++;currentCounters().rejected++;
      if([429,503].includes(response.status)){if(!response.headers.get('retry-after'))currentCounters().rejectsWithoutRetryAfter++;}
      else currentCounters().unexpectedFailures++;
      await response.body?.cancel();
      return {opened:false,retryAfterMs:retryAfterMs(response)};
    }
    opened=true;stats.streamOpened++;currentCounters().opened++;onOpened();
    for await(const bytes of response.body)stats.httpBytes+=bytes.length;
    if(!planned()){stats.streamUnexpectedEnds++;currentCounters().unexpectedEnds++;}
    return {opened:true};
  } catch {
    if(!headersReceived&&(headerExpired||!planned())){stats.streamEstablishmentFailures++;currentCounters().establishmentFailures++;}
    else if(headersReceived&&!planned()){stats.streamUnexpectedEnds++;currentCounters().unexpectedEnds++;}
    return {opened};
  } finally {cancelTimer(deadline);}
}
export async function drive({base,profile,fixture,directory,onSample,restartServer,startWorkload=()=>performance.now(),fetchRequest=fetch,schedule=dispatch}) {
  base=loopback(base,{assigned:profile.port===0});
  const cohorts=prepareCohorts(profile,fixture),chunks=Object.keys((await import('./model.mjs')).catalogue(profile.catalogue).chunks);
  const workloadEvents=profile.sustained?sustainedArrivals(profile,cohorts):arrivals(profile.stages,profile.seed,stage=>({browser:stage.browserPerSecond,pluginReport:stage.pluginPerSecond*.4,
    pluginStatus:stage.pluginPerSecond*.4,pluginTasks:stage.pluginPerSecond*.2,sync:stage.syncPerMinute/60}));
  const events=[...workloadEvents,...sessionArrivals(profile,cohorts).filter(event=>!profile.sustained||event.stage>0)]
    .sort((a,b)=>a.atMs-b.atMs).map((event,i)=>({...event,id:i+1}));
  const log=openSync(path.join(directory,'events.jsonl'),'wx',0o600), records={}, stats={offered:events.length,completed:0,httpRequests:0,httpBytes:0,httpErrors:0,
    rejects:0,timeouts:0,conflicts:0,intentionalConflicts:0,unsupported:0,clientDrops:0,streamOpened:0,streamRejected:0,streamUnexpectedEnds:0,streamEstablishmentFailures:0},
    streams=new Map(),streamJobs=new Set(),stageStreams=profile.stages.map(()=>({attempted:0,opened:0,rejected:0,unexpectedEnds:0,unexpectedFailures:0,rejectsWithoutRetryAfter:0,establishmentFailures:0,statuses:{}})),seq=new Map(),readers=new Map(),sessions=new Map(),commands=new Map();
  const streamAttempts=new Map(),recovered=new Map(),streamRecovery=new Map(),restarts=[],streamHandshakes=[];
  let streamShutdown=false, active=0, maxActive=0,restart;
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
  const callOnce=async(client,route,body,extra={})=>{
    const identity=extra.plugin?client.key:client.cookie;
    let reader=readers.get(identity);
    if(!reader) {
      reader=createBrowserClient({request:(route,options)=>request(options.extra.client,route,options.body,options.extra),
        ...(profile.sustained?{maxReadAttempts:1}:{})});
      readers.set(identity,reader);
    }
    const options={...extra,client};
    if(!extra.plugin) {
      let check=sessions.get(identity);
      if(!check) {
        check=reader('/api/session',undefined,options).finally(()=>sessions.delete(identity));
        sessions.set(identity,check);
      }
      const session=await check;
      if(route==='/api/session')return session;
    }
    return reader(route,body,options);
  };
  const retryRng=random(`${profile.seed}-read-backoff`);
  const call=(client,route,body,extra={})=>profile.sustained?
    retryRead(()=>callOnce(client,route,body,extra),{safe:body===undefined,deadlineMs:profile.requestDeadlineMs,rng:retryRng}):callOnce(client,route,body,extra);
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
          const attemptController=new AbortController(),attempt={controller:attemptController,planned:false},abort=()=>attemptController.abort();
          const startedAt=performance.now();
          streamAttempts.set(client.cookie,attempt);
          controller.signal.addEventListener('abort',abort,{once:true});
          if(controller.signal.aborted)abort();
          try {return await consumeStream({base,client,controller:attemptController,counters,stats,fetchRequest,headerDeadlineMs:profile.streamHeaderDeadlineMs??5000,
            onOpened:()=>{if(restart?.serverReadyMs!=null&&!streamRecovery.has(client.cookie))streamRecovery.set(client.cookie,{group:client.group,elapsedMs:performance.now()-restart.startedAt});},
            onHandshake:observation=>{if(profile.sustained)streamHandshakes.push({...observation,stage:currentStage,phase:sustainedPhase(profile,performance.now()-workloadStart),latencyMs:performance.now()-startedAt});},
            planned:()=>streamShutdown||controller.signal.aborted||attempt.planned||!!(profile.sustained&&restart&&restart.serverReadyMs==null)});}
          finally {if(streamAttempts.get(client.cookie)===attempt)streamAttempts.delete(client.cookie);controller.signal.removeEventListener('abort',abort);}
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
    const phase=sustainedPhase(profile,event.atMs);
    const row={id:event.id,stage:event.stage,...(phase?{phase}:{}),action,scheduledMs:event.atMs,startLagMs:start-event.scheduledAt,latencyMs:end-event.scheduledAt,httpWallMs:end-start,...outcome};
    const group=records[`${event.stage}:${phase??''}:${action}`]??={stage:event.stage,...(phase?{phase}:{}),action,all:[],valid:[],success:[],lag:[],statuses:{},httpRequests:0,httpRejects:0,timeouts:0,
      rejectsWithoutRetryAfter:0,unexpectedFailures:0,intentionalConflicts:0,unsupported:0,cacheHits:0,cacheMisses:0,httpStatuses:{},retryAfterValues:{}};
    group.all.push(row.latencyMs);group.lag.push(row.startLagMs);if(outcome.status===200)group.success.push(row.latencyMs);
    if(measuredOutcome(outcome))group.valid.push(row.latencyMs);
    group.statuses[outcome.status]=(group.statuses[outcome.status]??0)+1;
    for(const [key,count] of Object.entries(outcomeCounts(outcome)))group[key]+=count;
    for(const request of outcome.requests??[]) {
      group.httpStatuses[request.status]=(group.httpStatuses[request.status]??0)+1;
      if([429,503].includes(request.status)) {
        const value=request.retryAfter??'(missing)';group.retryAfterValues[value]=(group.retryAfterValues[value]??0)+1;
      }
    }
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
      if(!profile.sustained||event.stage>0)openStreams(pool);
    }
    const clientIndex=event.clientIndex??(profile.sustained&&event.kind==='heavy'?(event.ordinal%profile.stages[event.stage].activeGroups):event.kind==='browser'?Math.floor(rng()*pool.length):(event.ordinal??0)%pool.length);
    const client={...pool[clientIndex],observations:[]},start=performance.now();
    if(event.kind==='recovery-open'&&recovered.has(client.group)){stats.recoveryProbesSkipped=(stats.recoveryProbesSkipped??0)+1;return;}
    let action=profile.sustained?sustainedAction(event):event.kind,intentional=false;active++;maxActive=Math.max(maxActive,active);
    try {
      if(event.kind==='workload-end') {
        // Keep the full advertised duration even when the last jittered arrival is early.
      } else if(event.kind==='restart') {
        if(!restartServer)throw new Error('Sustained driver requires a restart callback.');
        restart={scheduledAt:event.scheduledAt,startedAt:start,scheduledMs:event.atMs};restarts.push(restart);
        const result=await restartServer();base=loopback(result.base,{assigned:profile.port===0});
        Object.assign(restart,{...result,serverReadyMs:performance.now()-start});
      } else if(event.kind==='reconnect') {
        const attempt=streamAttempts.get(client.cookie);
        if(attempt){attempt.planned=true;attempt.controller.abort();}
      } else if(event.kind==='cold-open'||event.kind==='recovery-open') {
        const state=await call(client,'/api/state?view=play-v1');
        const tasks=await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
        if(!state.state?.members?.some(row=>row.id===client.memberId)||!Number.isSafeInteger(tasks.stateRevision)||!Array.isArray(tasks.tasks))throw new Error('Readiness response is incomplete.');
        if(event.kind==='recovery-open'&&restart&&!recovered.has(client.group))recovered.set(client.group,{group:client.group,elapsedMs:performance.now()-restart.startedAt});
      } else if(event.kind==='session') await call(client,'/api/session');
      else if(event.kind==='sync') await call(client,'/api/runemetrics/preview',{memberId:client.memberId});
      else if(event.kind.startsWith('plugin')) {
        if(!client.key)throw Object.assign(new Error('NoKey'),{status:'unsupported'});
        if(event.kind==='pluginReport') {
          const n=(seq.get(client.key)??0)+1;seq.set(client.key,n);
          await call(client,'/api/plugin/v1/report',{v:1,seq:n,sentAt:new Date().toISOString(),world:{id:1,beta:false},position:{x:20,z:20,floor:0},skills:{MINING:{level:20,xp:4470}}},{plugin:true});
        } else await call(client,event.kind==='pluginStatus'?'/api/plugin/v1/status':'/api/plugin/v1/tasks',undefined,{plugin:true});
      } else if(profile.sustained) {
        await sustainedBrowserAction({call,client,event:{...event,activeGroups:profile.stages[event.stage].activeGroups},chunks,explainAction,prepareRollSnapshot});
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
          let snapshot=await call(client,'/api/state?view=play-v1');const state=snapshot.state;
          if(op<.4) {
            action='task-miss';
            await call(client,'/api/command?view=play-v1',{expectedRevision:state.revision,command:{type:'set-rule',ruleId:'access.shared',value:state.rules['access.shared']===false}});
            await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
          } else {
            snapshot=await prepareRollSnapshot(call,client,snapshot,chunks);
            const state=snapshot.state;
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
      const lastStatus=client.observations.at(-1)?.status;
      const status=error.status??(error.name==='TimeoutError'||lastStatus==='timeout'?'timeout':'network-error');
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
  return {workloadStart,stats,stageStreams,streamHandshakes,restarts,recovery:{groups:[...recovered.values()],streams:[...streamRecovery.values()]},
    commands:[...commands.values()].map(({values,...row})=>({...row,latency:distribution(values)})),operations:Object.values(records).map(({all,valid,success,lag,...rest})=>({...rest,latency:distribution(all),validLatency:distribution(valid),successfulLatency:distribution(success),clientDispatchLag:distribution(lag)})),timing};
}
