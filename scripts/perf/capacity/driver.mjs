import { openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { arrivals, dispatch } from './scheduler.mjs';
import { loopback, random } from './model.mjs';
import { createBrowserClient, createSessionChecks, reconnectStream, pause, retryAfterMs, retryRead } from './client.mjs';
import { errorReceipt, failureOutcome } from './failures.mjs';
import { REQUEST_ID_HEADER, ADMISSION_ID_HEADER } from './admission-correlation.mjs';
import { sustainedArrivals, sustainedAction, sustainedBrowserAction, sustainedPhase } from './sustained.mjs';
import { SERVER_ID_HEADER, clientIdentity, plannedOperations, readinessProof } from './evidence.mjs';
import { observation } from './sampling.mjs';
import { memoryProfile as selectMemoryProfile } from './memory-profile.mjs';
import { residency as selectResidency } from './residency.mjs';

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
const streamCounters=()=>({attempted:0,handshakes:0,opened:0,rejected:0,unexpectedEnds:0,unexpectedFailures:0,
  rejectsWithoutRetryAfter:0,establishmentFailures:0,statuses:{},retryAfterValues:{}});
export async function consumeStream({base,client,controller,counters,stats,planned,onOpened=()=>{},onClosed=()=>{},onHandshake=()=>{},requireEventStream=false,headerDeadlineMs=5000,fetchRequest=fetch,timer=setTimeout,cancelTimer=clearTimeout,now=()=>performance.now()}) {
  const currentCounters=at=>typeof counters==='function'?counters(at):counters;
  let headersReceived=false,headerExpired=false,opened=false,closedAt;
  currentCounters(now()).attempted++;
  const deadline=timer(()=>{headerExpired=true;controller.abort(new Error('SSE header deadline expired.'));},headerDeadlineMs);
  try {
    const response=await fetchRequest(base+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal,redirect:'error'});
    const receivedAt=now(),count=currentCounters(receivedAt);
    headersReceived=true;cancelTimer(deadline);
    const retryAfter=response.headers?.get?.('retry-after')??null,serverId=response.headers?.get?.(SERVER_ID_HEADER)??null;
    onHandshake({status:response.status,retryAfter,serverId,receivedAt});
    count.handshakes=(count.handshakes??0)+1;
    count.statuses[response.status]=(count.statuses[response.status]??0)+1;
    if(!response.ok){
      stats.streamRejected++;count.rejected++;
      if([429,503].includes(response.status)){
        if(!retryAfter)count.rejectsWithoutRetryAfter++;
        const values=count.retryAfterValues??={};values[retryAfter??'(missing)']=(values[retryAfter??'(missing)']??0)+1;
      }
      else count.unexpectedFailures++;
      await response.body?.cancel();
      return {opened:false,retryAfterMs:retryAfterMs(response)};
    }
    if(requireEventStream&&!/^text\/event-stream(?:;|$)/i.test(response.headers?.get?.('content-type')??'')) {
      count.unexpectedFailures++;await response.body?.cancel();return {opened:false};
    }
    opened=true;stats.streamOpened++;count.opened++;onOpened({serverId,receivedAt});
    for await(const bytes of response.body)stats.httpBytes+=bytes.length;
    closedAt=now();
    if(!planned()){stats.streamUnexpectedEnds++;currentCounters(closedAt).unexpectedEnds++;}
    return {opened:true};
  } catch {
    closedAt=now();
    if(!headersReceived&&(headerExpired||!planned())){stats.streamEstablishmentFailures++;currentCounters(closedAt).establishmentFailures++;}
    else if(headersReceived&&!planned()){stats.streamUnexpectedEnds++;currentCounters(closedAt).unexpectedEnds++;}
    return {opened};
  } finally {closedAt??=now();cancelTimer(deadline);onClosed({opened,planned:planned(),receivedAt:closedAt});}
}
export async function drive({base,initialServerId,profile,fixture,directory,onSample,restartServer,now=()=>performance.now(),startWorkload=()=>now(),fetchRequest=fetch,schedule=dispatch}) {
  const memoryProfile=selectMemoryProfile(profile.memoryProfile);
  const residency=selectResidency(profile.residency);
  const profiledStreamCounters=()=>({...streamCounters(),memoryProfile,residency});
  base=loopback(base,{assigned:profile.port===0});
  const cohorts=prepareCohorts(profile,fixture),chunks=Object.keys((await import('./model.mjs')).catalogue(profile.catalogue).chunks);
  const workloadEvents=profile.sustained?sustainedArrivals(profile,cohorts):arrivals(profile.stages,profile.seed,stage=>({browser:stage.browserPerSecond,pluginReport:stage.pluginPerSecond*.4,
    pluginStatus:stage.pluginPerSecond*.4,pluginTasks:stage.pluginPerSecond*.2,sync:stage.syncPerMinute/60}));
  const events=[...workloadEvents,...sessionArrivals(profile,cohorts).filter(event=>!profile.sustained||event.stage>0)]
    .sort((a,b)=>a.atMs-b.atMs).map((event,i)=>({...event,id:i+1}));
  const log=openSync(path.join(directory,'events.jsonl'),'wx',0o600), records={}, stats={offered:events.length,completed:0,httpRequests:0,httpBytes:0,httpErrors:0,
    rejects:0,timeouts:0,conflicts:0,intentionalConflicts:0,unsupported:0,clientDrops:0,recoveryProbesSkipped:0,streamOpened:0,streamRejected:0,streamUnexpectedEnds:0,streamEstablishmentFailures:0},
    streams=new Map(),streamJobs=new Set(),stageStreams=profile.stages.map(profiledStreamCounters),tailStreams=profiledStreamCounters(),seq=new Map(),readers=new Map(),sessions=createSessionChecks(),commands=new Map();
  const streamAttempts=new Map(),recovered=new Map(),restarts=[],streamHandshakes=[],streamLifetimes=[],coldOpens=[];
  let streamShutdown=false, active=0, maxActive=0,restart,workloadCompletedAt,streamShutdownAt;
  const request=async(client,route,body,extra={})=>{
    stats.httpRequests++;
    const requestStart=now();
    const requestId=`action:${client.actionId}:request:${client.observations.length+1}`;
    const observation={requestId,actionId:client.actionId,memoryProfile,residency,route:route.split('?')[0],status:'pending',...(route.startsWith('/api/command')?{command:body?.command?.type}: {})};client.observations?.push(observation);
    let res;
    try {res=await fetchRequest(base+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(profile.requestDeadlineMs),
      headers:{[REQUEST_ID_HEADER]:requestId,...(extra.plugin?{Authorization:'Bearer '+client.key}:{Cookie:client.cookie}),
        ...(!extra.plugin&&route!=='/api/session'&&client.pickerId?{'X-Picker-Id':client.pickerId}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    } catch(error) {observation.status=failureOutcome(error).status;observation.error=errorReceipt(error);error.requestId=requestId;observation.receivedAt=now();observation.wallMs=observation.receivedAt-requestStart;stats.httpErrors++;throw error;}
    Object.assign(observation,{responseStatus:res.status,serverId:res.headers.get(SERVER_ID_HEADER),admissionId:res.headers.get(ADMISSION_ID_HEADER),retryAfter:res.headers.get('retry-after')});
    let text;
    try {text=await res.text();}catch(error){observation.status=failureOutcome(error).status;observation.error=errorReceipt(error);error.requestId=requestId;observation.receivedAt=now();observation.wallMs=observation.receivedAt-requestStart;stats.httpErrors++;throw error;}
    const receivedAt=now();
    stats.httpBytes+=Buffer.byteLength(text);
    let value;try{value=JSON.parse(text);}catch{value=null;}
    Object.assign(observation,{receivedAt,status:res.status,serverId:res.headers.get(SERVER_ID_HEADER),admissionId:res.headers.get(ADMISSION_ID_HEADER),retryAfter:res.headers.get('retry-after'),wallMs:receivedAt-requestStart,
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
    return {requestId,ok:res.ok,status:res.status,headers:res.headers,json:async()=>value};
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
      const {value:session,coalesced}=await sessions(identity,client,()=>reader('/api/session',undefined,options));
      if(route==='/api/session') {
        if(coalesced)
          client.coalescedSessionChecks=(client.coalescedSessionChecks??0)+1;
        return session;
      }
    }
    return reader(route,body,options);
  };
  const retryRng=random(`${profile.seed}-read-backoff`);
  const call=(client,route,body,extra={})=>profile.sustained?
    retryRead(()=>callOnce(client,route,body,extra),{safe:body===undefined,deadlineMs:profile.requestDeadlineMs,rng:retryRng}):callOnce(client,route,body,extra);
  function openStreams(pool) {
    // Retained streams cross stage boundaries. Attribute reconnect failures and
    // disconnects when they happen, rather than to the original warm-up stage.
    const counters=at=>{const stage=observation(profile,workloadStart,at).stage;return stage===null?tailStreams:stageStreams[stage];};
    const wanted=new Set(pool.map(client=>client.cookie));
    for(const [key,controller] of streams)if(!wanted.has(key)){controller.abort();streams.delete(key);}
    for(const client of pool) {
      if(streams.has(client.cookie))continue;
      const controller=new AbortController(); streams.set(client.cookie,controller);
      const rng=random(`${profile.seed}-stream-${client.group}-${client.memberId}`);
      const job=reconnectStream({signal:controller.signal,sleep:pause,rng,spreadMs:profile.streamConnectSpreadMs??1000,
        connect:async()=>{
          const attemptController=new AbortController(),attempt={controller:attemptController,planned:false},abort=()=>attemptController.abort();
          const startedAt=now();
          let connection;
          streamAttempts.set(client.cookie,attempt);
          controller.signal.addEventListener('abort',abort,{once:true});
          if(controller.signal.aborted)abort();
          try {return await consumeStream({base,client,controller:attemptController,counters,stats,fetchRequest,now,requireEventStream:!!profile.sustained,headerDeadlineMs:profile.streamHeaderDeadlineMs??5000,
            onOpened:({serverId,receivedAt})=>{if(profile.sustained){connection={memoryProfile,residency,clientId:clientIdentity(client),group:client.group,serverId,openedAt:receivedAt,closedAt:null,closeReason:null};streamLifetimes.push(connection);}},
            onClosed:({planned,receivedAt})=>{if(connection){connection.closedAt=receivedAt;connection.closeReason=planned||'unexpected';}},
            onHandshake:receipt=>{if(profile.sustained)streamHandshakes.push({...receipt,...observation(profile,workloadStart,receipt.receivedAt),latencyMs:receipt.receivedAt-startedAt});},
            planned:()=>streamShutdown?'workload-end':controller.signal.aborted?'cohort-change':attempt.planned?'reconnect':profile.sustained&&restart&&restart.serverReadyMs==null?'server-restart':false});}
          finally {if(streamAttempts.get(client.cookie)===attempt)streamAttempts.delete(client.cookie);controller.signal.removeEventListener('abort',abort);}
        }});
      streamJobs.add(job);job.finally(()=>streamJobs.delete(job));
    }
  }
  const timing=[];
  const record=(action,event,start,end,outcome)=>{
    for(const observation of outcome.requests??[])if(observation.command) {
      const key=`${observation.command}:${observation.status}`,row=commands.get(key)??{memoryProfile,residency,command:observation.command,status:observation.status,values:[]};
      row.values.push(observation.wallMs);commands.set(key,row);
    }
    const phase=sustainedPhase(profile,event.atMs);
    const row={memoryProfile,residency,id:event.id,stage:event.stage,...(phase?{phase}:{}),action,scheduledMs:event.atMs,startLagMs:start-event.scheduledAt,latencyMs:end-event.scheduledAt,httpWallMs:end-start,...outcome};
    const group=records[`${event.stage}:${phase??''}:${action}`]??={memoryProfile,residency,stage:event.stage,...(phase?{phase}:{}),action,all:[],valid:[],success:[],lag:[],statuses:{},httpRequests:0,httpRejects:0,timeouts:0,
      rejectsWithoutRetryAfter:0,unexpectedFailures:0,intentionalConflicts:0,unsupported:0,cacheHits:0,cacheMisses:0,successfulTaskMisses:0,coalescedSessionChecks:0,httpStatuses:{},retryAfterValues:{}};
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
    group.coalescedSessionChecks+=outcome.coalescedSessionChecks??0;
    const taskResponse=(outcome.requests??[]).findLast(row=>row.route==='/api/tasks');
    if(action==='task-miss'&&outcome.status===200&&taskResponse?.status===200&&taskResponse.cacheHit===false)group.successfulTaskMisses++;
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
    const client={...pool[clientIndex],actionId:event.id,observations:[]},start=now();
    if(event.kind==='recovery-open'&&recovered.has(client.group)){stats.recoveryProbesSkipped=(stats.recoveryProbesSkipped??0)+1;return;}
    let action=profile.sustained?sustainedAction(event):event.kind,intentional=false;active++;maxActive=Math.max(maxActive,active);
    try {
      if(event.kind==='workload-end') {
        // Keep the full advertised duration even when the last jittered arrival is early.
      } else if(event.kind==='restart') {
        if(!restartServer)throw new Error('Sustained driver requires a restart callback.');
        restart={memoryProfile,residency,scheduledAt:event.scheduledAt,startedAt:start,scheduledMs:event.atMs};restarts.push(restart);
        const result=await restartServer(),readyReceivedAt=result.readyReceivedAt??now();base=loopback(result.base,{assigned:profile.port===0});
        Object.assign(restart,{...result,readyReceivedAt,serverReadyMs:readyReceivedAt-start});
      } else if(event.kind==='reconnect') {
        const attempt=streamAttempts.get(client.cookie);
        if(attempt){attempt.planned=true;attempt.controller.abort();}
      } else if(event.kind==='cold-open'||event.kind==='recovery-open') {
        const state=await call(client,'/api/state?view=play-v1');
        const stateResponse=client.observations.findLast(row=>row.route==='/api/state');
        const tasks=await call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
        const tasksResponse=client.observations.findLast(row=>row.route==='/api/tasks');
        const expectedServerId=event.kind==='cold-open'?initialServerId:restart?.serverReadyMs!=null&&restart.serverId!==initialServerId?restart.serverId:null;
        const proof=readinessProof({state,tasks,stateServerId:stateResponse?.serverId,tasksServerId:tasksResponse?.serverId,expectedServerId,memberId:client.memberId});
        const evidence={memoryProfile,residency,group:client.group,...proof,stateReceivedAt:stateResponse.receivedAt,tasksReceivedAt:tasksResponse.receivedAt,
          elapsedMs:Math.max(stateResponse.receivedAt,tasksResponse.receivedAt)-(event.kind==='cold-open'?workloadStart:restart.startedAt)};
        if(event.kind==='cold-open')coldOpens.push(evidence);
        else if(!recovered.has(client.group))recovered.set(client.group,evidence);
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
      record(action,event,start,now(),{status:200,requests:client.observations,sharedPreflights:client.sharedPreflights??[],coalescedSessionChecks:client.coalescedSessionChecks??0});
    } catch(error) {
      const failure=failureOutcome(error),status=failure.status;
      if(status==='timeout')stats.timeouts++;if(status==='unsupported')stats.unsupported++;
      const intentionalConflict=status===409&&client.observations.at(-1)?.intentionalConflict===true;
      if(intentionalConflict)stats.intentionalConflicts++;
      record(action,event,start,now(),{...failure,intentionalConflict,retryAfter:error.retryAfter??null,requests:client.observations,sharedPreflights:client.sharedPreflights??[]});
      if(['memory-profile-unverified','residency-unverified'].includes(error.code))throw error;
    } finally { active--; }
  };
  const workloadStart=startWorkload();
  const sampleTimer=setInterval(()=>{const client={active,maxActive,completed:stats.completed,clientMemory:process.memoryUsage(),clientCpu:process.cpuUsage(),receivedAt:now()};void onSample(client).catch(()=>{});},profile.sampleSeconds*1000);
  try {
    await schedule(events,run,{startAt:workloadStart,maxInFlight:profile.maxClientInFlight,onDrop:event=>{stats.clientDrops++;const at=now();record('client-drop',event,at,at,{status:'client-drop'});}});
    workloadCompletedAt=now();
    timing.push({maxActive});
  } finally {clearInterval(sampleTimer);streamShutdownAt=now();streamShutdown=true;for(const controller of streams.values())controller.abort();await Promise.allSettled(streamJobs);closeSync(log);}
  const selected=profile.sustained?cohorts.get(`${profile.stages.length-1}:0`):[];
  return {memoryProfile,residency,workloadStart,workloadCompletedAt,streamShutdownAt,completedAt:now(),initialServerId,stats,stageStreams,tailStreams,streamHandshakes,restarts,
    offeredOperations:profile.sustained?plannedOperations(events,profile).map(row=>({...row,memoryProfile,residency})):undefined,coldOpens,
    cohort:{groups:[...new Set(selected.map(row=>row.group))],clients:selected.map(row=>({clientId:clientIdentity(row),group:row.group})),coldGroups:[...new Set(cohorts.get('0:0').map(row=>row.group))]},
    recovery:{groups:[...recovered.values()],streams:streamLifetimes},
    commands:[...commands.values()].map(({values,...row})=>({...row,latency:distribution(values)})),operations:Object.values(records).map(({all,valid,success,lag,...rest})=>({...rest,latency:distribution(all),validLatency:distribution(valid),successfulLatency:distribution(success),clientDispatchLag:distribution(lag)})),timing};
}
