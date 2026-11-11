// @test quick shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCohorts, drive, consumeStream } from '../scripts/perf/capacity/driver.mjs';
import { planFixture, catalogue, syntheticWorld } from '../scripts/perf/capacity/model.mjs';
import { sustainedArrivals, sustainedAction, sustainedPhase, sustainedBrowserAction, validateSustained } from '../scripts/perf/capacity/sustained.mjs';
import { evaluateSustained, everydayActions, heavyActions } from '../scripts/perf/capacity/sustained-report.mjs';
import { retryRead } from '../scripts/perf/capacity/client.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { SERVER_ID_HEADER, readinessProof } from '../scripts/perf/capacity/evidence.mjs';
import { observation, createSampleInbox, createSampleCollector } from '../scripts/perf/capacity/sampling.mjs';
import { evaluate } from '../scripts/perf/capacity/report.mjs';

const profile = JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained.json',import.meta.url)));
function fixture(settings=profile) {
  return {groups:planFixture(settings).map(group=>({...group,members:group.members.map(member=>({memberId:member.id,cookie:`synthetic-${group.index}-${member.id}`}))}))};
}
test('sustained contract keeps a nested 100-group active set, calibrated catalogue and real plugin rates',()=>{
  validateSustained(profile);
  const cohorts=prepareCohorts(profile,fixture()),events=sustainedArrivals(profile,cohorts);
  assert.equal(profile.catalogue.tasks,23939);
  assert.equal(fixture().groups.length,500);
  assert.deepEqual(cohorts.get('0:0'),cohorts.get('1:0'));
  assert.equal(cohorts.get('1:0').length,200);
  assert.equal(new Set(cohorts.get('1:0').map(client=>client.group)).size,100);
  const count=kind=>events.filter(event=>event.kind===kind).length;
  assert.equal(count('heavy'),3000);
  assert.equal(count('pluginReport'),72000); // 200 clients, each once per 5 s for 30 min.
  assert.equal(count('pluginStatus'),72000);
  assert.equal(count('pluginTasks'),36000);
  assert.equal(count('switch'),1800);
  assert.equal(count('cold-open'),100);
  assert.equal(count('restart'),1);
  assert.equal(events.find(event=>event.kind==='restart').atMs,1020000);
  assert.equal(events.at(-1).atMs,1920000);
  const heavy=events.filter(event=>event.kind==='heavy');
  assert.equal(new Set(heavy.slice(0,100).map(event=>event.ordinal%100)).size,100);
  assert.ok(heavy.every((event,i)=>i===0||event.atMs>heavy[i-1].atMs));
  assert.deepEqual([...new Set(heavy.map(sustainedAction))].sort(),[...heavyActions].sort());
  // Each group eventually exercises every heavy action; ordinal % 100 alone
  // would permanently assign it the same one of the ten action variants.
  for(let group=0;group<100;group++)assert.deepEqual([...new Set(heavy.filter(event=>event.ordinal%100===group).map(sustainedAction))].sort(),[...heavyActions].sort());
  const recoveries=events.filter(event=>event.kind==='recovery-open');
  assert.equal(recoveries.length,6000);
  assert.equal(new Set(recoveries.map(event=>event.clientIndex)).size,100);
  assert.ok(recoveries.every(event=>event.atMs>=1020000&&event.atMs<1320000));
});
test('format 2 refuses activation and invalid restart windows fail before fixture setup',()=>{
  assert.throws(()=>validateSustained(profile,'format2'),/slice 7c/);
  assert.throws(()=>validateSustained(profile,'other'),/format1 or format2/);
  assert.throws(()=>validateSustained({...profile,rotationSeconds:300}),/fixed/);
  assert.throws(()=>validateSustained({...profile,sustained:{...profile.sustained,restartAtSeconds:1900}}),/recovery window/);
  assert.equal(sustainedPhase(profile,0),'cold-open');
  assert.equal(sustainedPhase(profile,1000000),'before-restart');
  assert.equal(sustainedPhase(profile,1020000),'restart-recovery');
  assert.equal(sustainedPhase(profile,1320000),'after-recovery');
});
test('safe read retries honor Retry-After; writes and revision conflicts remain single dispatch',async()=>{
  let now=0,attempts=0;const waits=[];
  const sleep=async ms=>{waits.push(ms);now+=ms;};
  const result=await retryRead(async()=>{if(++attempts<3)throw Object.assign(new Error('busy'),{status:503,retryAfterMs:1000});return 'ready';},
    {safe:true,deadlineMs:10000,now:()=>now,sleep,rng:()=>0});
  assert.equal(result,'ready');assert.equal(attempts,3);assert.deepEqual(waits,[1000,1000]);
  for(const [safe,status] of [[false,503],[true,409]]) {
    attempts=0;
    await assert.rejects(retryRead(async()=>{attempts++;throw Object.assign(new Error('refused'),{status});},{safe,deadlineMs:10000,now:()=>now,sleep}),/refused/);
    assert.equal(attempts,1);
  }
  attempts=0;
  await assert.rejects(retryRead(async()=>{attempts++;throw Object.assign(new Error('long refusal'),{status:429,retryAfterMs:50000});},
    {safe:true,deadlineMs:10000,now:()=>now,sleep}),/long refusal/);
  assert.equal(attempts,1);
});
test('tick is a real completion edit, miss invalidates calculation input, switches stay explicitly unsupported',async()=>{
  const calls=[],client={memberId:'owner',peers:['owner','other'],taskIds:['synthetic-task']};
  const call=async(client,route,body)=>{calls.push({route,body});return {state:{revision:5,rules:{'access.shared':true},members:[{id:'owner',completedTasks:[]}]}};};
  const run=event=>sustainedBrowserAction({call,client,event:{...event,activeGroups:100},chunks:['100']});
  await run({kind:'edit',ordinal:1,id:1});
  assert.deepEqual(calls.at(-1).body,{expectedRevision:5,command:{type:'complete-task',memberId:'owner',taskId:'synthetic-task',completed:true}});
  calls.length=0;await run({kind:'heavy',ordinal:0,id:2});
  assert.deepEqual(calls[1].body.command,{type:'set-skill-levels',memberId:'owner',skill:'Attack',passiveLevel:2});assert.match(calls[2].route,/api\/tasks/);
  calls.length=0;await run({kind:'heavy',ordinal:100,actionIndex:0,id:4});
  assert.equal(calls[1].body.command.passiveLevel,3);
  calls.length=0;await assert.rejects(run({kind:'switch',id:3}),error=>error.status==='unsupported');assert.equal(calls.length,0);
});
test('fresh-map Undo offers valid durable work and restores the note through real commands',async()=>{
  let state=createGroupState([{id:'owner',name:'Synthetic owner'}]);
  const initialNotes=state.members[0].notes;
  const data=catalogue({chunks:2,tasks:1,dependencyDepth:1,crossLinks:1}),world=syntheticWorld(data,buildWorld);
  const commands=[],client={memberId:'owner'};
  const call=async(client,route,body)=>{
    if(body){assert.equal(body.expectedRevision,state.revision);commands.push(body.command.type);state=applyCommand(state,body.command,{world});}
    return {state};
  };
  await sustainedBrowserAction({call,client,event:{kind:'undo',id:1},chunks:Object.keys(data.chunks)});
  assert.deepEqual(commands,['set-note','undo']);assert.deepEqual(state.members[0].notes,initialNotes);
});
function reportFixture() {
  const row=(action,n=10)=>({stage:1,phase:'before-restart',action,latency:{count:n,p50Ms:10,p95Ms:20,p99Ms:30},statuses:{200:n},
    httpRequests:n,httpRejects:0,httpStatuses:{200:n},retryAfterValues:{},rejectsWithoutRetryAfter:0,
    cacheMisses:action==='task-miss'?n:0,successfulTaskMisses:action==='task-miss'?n:0});
  const ready=(group,serverId,elapsedMs)=>({group,serverId,stateServerId:serverId,tasksServerId:serverId,stateRevision:1,tasksRevision:1,elapsedMs,
    stateReceivedAt:(serverId==='old-process'?0:1020000)+elapsedMs-1,tasksReceivedAt:(serverId==='old-process'?0:1020000)+elapsedMs});
  const operations=[...everydayActions,...heavyActions,'pluginReport','pluginStatus','pluginTasks','sync'].map(action=>row(action));
  operations.push({...row('cold-open',2),stage:0,phase:'cold-open'},{...row('restart',1),phase:'restart-recovery'},{...row('workload-end',1),phase:'after-recovery'});
  const offeredOperations=operations.map(({stage,phase,action,latency})=>({stage,phase,action,count:latency.count}));
  const clients=[1,2].flatMap(group=>['owner','member2'].map(memberId=>({group,clientId:`${group}:${memberId}`})));
  const sample=(generation,elapsedMs)=>{
    const receipt=observation(profile,0,elapsedMs),serverId=generation?'new-process':'old-process';
    return {generation,...receipt,collectionPhase:elapsedMs>=1920000?'after':null,server:{serverId,...receipt,window:{...receipt},memory:{rss:1,heapUsed:1,external:0},
      healthObservation:{...receipt,generation,serverId},diagnosticsObservation:{...receipt,generation,serverId},
      eventLoop:{p99Ms:1},diagnostics:{queue:{depth:0}},health:{ready:true,savesReady:true,worker:{ready:true},service:{registry:'ready',openContexts:3}}}};
  };
  const shutdown={forced:false,exitCode:0,signal:null};
  const offered=offeredOperations.reduce((n,row)=>n+row.count,0);
  return {profile:{...profile,stages:[profile.stages[0],{...profile.stages[1],activeGroups:2,users:4}]},format:'format1',
    load:{stats:{clientDrops:0,offered,completed:offered,recoveryProbesSkipped:0},operations,offeredOperations,initialServerId:'old-process',
      cohort:{groups:[1,2],coldGroups:[1,2],clients},coldOpens:[ready(1,'old-process',100),ready(2,'old-process',200)],
      stageStreams:[{attempted:0,handshakes:0,statuses:{},retryAfterValues:{},rejectsWithoutRetryAfter:0},{attempted:4,handshakes:4,statuses:{200:4},retryAfterValues:{},rejectsWithoutRetryAfter:0}],
      tailStreams:{attempted:0,handshakes:0,statuses:{},retryAfterValues:{},rejectsWithoutRetryAfter:0},
      workloadStart:0,workloadCompletedAt:1920000,streamShutdownAt:1920000,completedAt:1920100,restarts:[{startedAt:1020000,serverReadyMs:10,generation:1,serverId:'new-process',shutdown:{...shutdown}}],
      recovery:{groups:[ready(1,'new-process',100),ready(2,'new-process',200)],
        streams:clients.map(client=>({...client,serverId:'new-process',openedAt:1020300,closedAt:1920000,closeReason:'workload-end'}))}},
    samples:[sample(0,100000),sample(1,1020300),sample(1,1321000),
      ...Array.from({length:384},(_,i)=>(i+1)*5000+1500).map(at=>sample(at>=1020010?1:0,at))],telemetryErrors:0,shutdown};
}
test('speed verdicts cannot pass fast refusals, missing classes, dropped work or incomplete recovery',()=>{
  const result=reportFixture(),gates=evaluateSustained(result);
  assert.equal(gates.everyday.status,'pass');assert.equal(gates.heavy.status,'pass');assert.equal(gates.coldOpen.status,'pass');
  assert.equal(gates.restartRecovery.status,'pass');assert.equal(gates.format2Serving.status,'blocked');assert.equal(gates.characterSwitch.status,'blocked');
  result.samples.filter(row=>row.generation===1).forEach(row=>row.server.health.service.openContexts=2);
  assert.equal(evaluateSustained(result).restartRecovery.status,'fail','visiting groups serially cannot stand in for simultaneous readiness');
  result.samples.filter(row=>row.generation===1).forEach(row=>row.server.health.service.openContexts=3);
  result.load.operations.find(row=>row.action==='tick').statuses={503:10};
  assert.equal(evaluateSustained(result).everyday.status,'fail');
  result.load.operations=result.load.operations.filter(row=>row.action!=='preview');
  assert.deepEqual(evaluateSustained(result).heavy.missing,['preview']);
  result.load.recovery.groups.pop();assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
  result.load.stats.clientDrops=1;assert.equal(evaluateSustained(result).generator.status,'fail');
  result.load.operations.find(row=>row.action==='task-miss').successfulTaskMisses=0;assert.equal(evaluateSustained(result).calculationMissCoverage.status,'fail');
});
test('smoke stays tiny, with a full recovery window and one scheduled restart',async()=>{
  const smoke=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  validateSustained(smoke);
  assert.equal(smoke.stages.reduce((n,stage)=>n+stage.seconds,0),120);
  assert.equal(smoke.fixture.groups,2);assert.equal(smoke.port,0);
  const events=sustainedArrivals(smoke,prepareCohorts(smoke,fixture(smoke)));
  assert.equal(events.filter(event=>event.kind==='restart').length,1);
  assert.ok(events.some(event=>event.kind==='reconnect'));
});
test('driver retains its schedule through restart, updates the scratch origin and records group recovery',async t=>{
  const smoke=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  smoke.streamConnectSpreadMs=0;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-driver-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let restarts=0;const origins=[];
  const fetchRequest=async(url,options)=>{
    const parsed=new URL(url);origins.push(parsed.origin);
    if(parsed.pathname==='/api/events') {
      const body=new ReadableStream({start(controller){const close=()=>controller.close();options.signal.addEventListener('abort',close,{once:true});if(options.signal.aborted)close();}});
      return new Response(body,{headers:{'Content-Type':'text/event-stream',[SERVER_ID_HEADER]:parsed.port==='1'?'old-process':'new-process'}});
    }
    return Response.json(parsed.pathname==='/api/state'?{state:{revision:1,members:[{id:'owner'},{id:'member2'}]}}:
      parsed.pathname==='/api/tasks'?{stateRevision:1,tasks:[]}:{},{headers:{[SERVER_ID_HEADER]:parsed.port==='1'?'old-process':'new-process'}});
  };
  const result=await drive({base:'http://127.0.0.1:1',initialServerId:'old-process',profile:smoke,fixture:fixture(smoke),directory,onSample:async()=>{},fetchRequest,
    restartServer:async()=>{restarts++;return {base:'http://127.0.0.1:2',serverId:'new-process',generation:1,shutdown:{forced:false,exitCode:0,signal:null}};},
    schedule:async(events,run)=>{
      for(const event of events.filter(row=>['cold-open','restart','recovery-open','workload-end'].includes(row.kind)))
        await run({...event,scheduledAt:performance.now()});
    }});
  assert.equal(restarts,1);assert.equal(result.restarts.length,1);assert.equal(result.recovery.groups.length,2);
  assert.ok(result.stats.recoveryProbesSkipped>0);assert.ok(origins.includes('http://127.0.0.1:2'));
  const records=(await readFile(path.join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.find(row=>row.action==='restart').scheduledMs,65000);
  assert.deepEqual(new Set(records.filter(row=>row.action==='recovery-open').map(row=>row.status)),new Set([200]));
  assert.ok(records.filter(row=>row.action==='recovery-open').every(row=>row.phase==='restart-recovery'));
});

test('P1: successful probes on the draining process do not recover groups, even when the port is reused',async t=>{
  const settings=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  settings.streamConnectSpreadMs=0;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-generation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let serving='old-process',release;
  const waiting=new Promise(resolve=>release=resolve),base='http://127.0.0.1:1';
  const fetchRequest=async(url,options)=>{
    const route=new URL(url).pathname;
    if(route==='/api/events')return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.close(),{once:true});}}),
      {headers:{'content-type':'text/event-stream',[SERVER_ID_HEADER]:serving}});
    return Response.json(route==='/api/state'?{state:{revision:1,members:[{id:'owner'},{id:'member2'}]}}:route==='/api/tasks'?{stateRevision:1,tasks:[]}:{},
      {headers:{[SERVER_ID_HEADER]:serving}});
  };
  const result=await drive({base,initialServerId:serving,profile:settings,fixture:fixture(settings),directory,onSample:async()=>{},fetchRequest,
    restartServer:async()=>{await waiting;return {base,serverId:'new-process',generation:1,shutdown:{forced:false,exitCode:0,signal:null}};},
    schedule:async(events,run)=>{
      const invoke=event=>run({...event,scheduledAt:performance.now()});
      const restartJob=invoke(events.find(row=>row.kind==='restart'));
      const probes=events.filter(row=>row.kind==='recovery-open');
      await invoke(probes[0]); // Both HTTP responses are 200 while stop waits on telemetry.
      serving='new-process';release();await restartJob;
      await invoke(probes[2]);await invoke(probes[3]);
    }});
  assert.equal(result.recovery.groups.length,2);
  assert.ok(result.recovery.groups.every(row=>row.stateServerId==='new-process'&&row.tasksServerId==='new-process'));
  const records=(await readFile(path.join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const old=records.find(row=>row.action==='recovery-open');assert.equal(old.status,'stale-generation');
  assert.equal(old.requests.filter(row=>['/api/state','/api/tasks'].includes(row.route)&&row.status===200).length,2);
  const readiness={state:{state:{revision:1,members:[{id:'owner'}]}},tasks:{stateRevision:1,tasks:[]},memberId:'owner',expectedServerId:'new-process'};
  for(const [stateServerId,tasksServerId] of [['old-process','new-process'],['new-process','old-process']])
    assert.throws(()=>readinessProof({...readiness,stateServerId,tasksServerId}),error=>error.status==='stale-generation');
});

test('P2: plugin and sync 500s or missing configured classes cannot pass completion gates',()=>{
  const result=reportFixture();
  assert.ok(Object.values(evaluateSustained(result)).every(gate=>['pass','blocked'].includes(gate.status)));
  for(const action of ['pluginReport','pluginStatus','pluginTasks','sync']) {
    const row=result.load.operations.find(row=>row.action===action);row.statuses={500:10};row.httpStatuses={500:10};
  }
  assert.equal(evaluateSustained(result).pluginTraffic.status,'fail');assert.equal(evaluateSustained(result).syncTraffic.status,'fail');
  const missing=reportFixture();missing.load.operations=missing.load.operations.filter(row=>!['pluginTasks','sync'].includes(row.action));
  assert.ok(evaluateSustained(missing).pluginTraffic.missing.includes('pluginTasks'));assert.ok(evaluateSustained(missing).syncTraffic.missing.includes('sync'));
  assert.equal(evaluateSustained(reportFixture()).pluginTraffic.classes[0].p95ByPhaseMs[0].p95Ms,20);
});
test('P2: restart and final shutdown require explicit zero exit codes without signals',()=>{
  for(const receipt of [{forced:false,exitCode:null,signal:'SIGTERM'},{forced:false,exitCode:0,signal:'SIGTERM'},{forced:false},{forced:true,exitCode:0,signal:null},undefined]) {
    for(const target of ['restart','final']) {
      const result=reportFixture();if(target==='restart')result.load.restarts[0].shutdown=receipt;else result.shutdown=receipt;
      assert.equal(evaluateSustained(result).generator.status,'fail');
    }
  }
});
test('P2: immediately closed 200 SSE handshakes do not recover clients; planned reconnects may recover with live replacements',()=>{
  const result=reportFixture();result.load.recovery.streams.forEach(row=>{row.closedAt=row.openedAt+1;row.closeReason='unexpected';});
  assert.equal(evaluateSustained(result).streamRecovery.status,'fail');
  const planned=reportFixture();planned.load.recovery.streams.unshift({...planned.load.recovery.streams[0],closedAt:1020500,closeReason:'reconnect'});
  assert.equal(evaluateSustained(planned).streamRecovery.status,'pass');
  const handoff=reportFixture(),before=handoff.load.recovery.streams[0];
  handoff.load.recovery.streams.push({...before,openedAt:1320500});before.closedAt=1319990;before.closeReason='reconnect';
  assert.equal(evaluateSustained(handoff).streamRecovery.status,'pass','a planned handoff across the deadline needs a live replacement at confirmation');
  before.closeReason='unexpected';assert.equal(evaluateSustained(handoff).streamRecovery.status,'fail');
  before.closeReason='reconnect';handoff.load.recovery.streams.pop();assert.equal(evaluateSustained(handoff).streamRecovery.status,'fail');
});
test('sweep: absent or malformed latency and terminal completion evidence cannot pass speed bars',()=>{
  for(const change of [row=>row.latency.p95Ms=null,row=>delete row.latency,row=>row.statuses={},row=>row.statuses={200:9},
    row=>row.httpRequests=0,row=>{row.httpRequests=1;row.httpStatuses={200:1};},row=>row.httpStatuses={500:10}]) {
    const result=reportFixture();change(result.load.operations.find(row=>row.action==='state'));
    assert.equal(evaluateSustained(result).everyday.status,'fail');
  }
});
test('sweep: session completions require successful HTTP or confirmed coalesced checks',async t=>{
  const result=reportFixture(),session=result.load.operations.find(row=>row.action==='session');
  session.httpRequests=0;session.httpStatuses={};
  assert.equal(evaluateSustained(result).everyday.status,'fail');
  session.coalescedSessionChecks=10;assert.equal(evaluateSustained(result).everyday.status,'pass');
  const settings=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  settings.streamConnectSpreadMs=0;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-session-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let release;const pending=new Promise(resolve=>release=resolve);
  const load=await drive({base:'http://127.0.0.1:1',initialServerId:'old-process',profile:settings,fixture:fixture(settings),directory,onSample:async()=>{},
    fetchRequest:async(url,options)=>{
      if(new URL(url).pathname==='/api/events')return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.close(),{once:true});}}),
        {headers:{'content-type':'text/event-stream',[SERVER_ID_HEADER]:'old-process'}});
      await pending;return Response.json({},{headers:{[SERVER_ID_HEADER]:'old-process'}});
    },schedule:async(events,run)=>{
      const sessions=events.filter(row=>row.kind==='session').slice(0,2);
      const jobs=sessions.map(event=>run({...event,clientIndex:0,scheduledAt:performance.now()}));release();await Promise.all(jobs);
    }});
  const observed=load.operations.find(row=>row.action==='session');
  assert.equal(observed.latency.count,2);assert.equal(observed.httpRequests,1);assert.equal(observed.coalescedSessionChecks,1);
});
test('sweep: partial phases and duplicate cold/recovery identities cannot replace the planned cohort',()=>{
  const partial=reportFixture();partial.load.offeredOperations.push({stage:1,phase:'after-recovery',action:'state',count:10});
  assert.equal(evaluateSustained(partial).everyday.status,'fail');
  for(const evidence of ['coldOpens','groups']) {
    const result=reportFixture(),rows=evidence==='coldOpens'?result.load.coldOpens:result.load.recovery.groups;
    rows[1]={...rows[0]};assert.equal(evaluateSustained(result)[evidence==='coldOpens'?'coldOpen':'restartRecovery'].status,'fail');
  }
});
test('sweep: missing or mismatched cohort identities cannot certify cold, HTTP or stream recovery',()=>{
  for(const change of [result=>delete result.load.cohort.clients[0].clientId,
    result=>result.load.cohort.clients[0].clientId='other-group:owner',result=>result.load.cohort.groups[0]=undefined,
    result=>result.load.cohort.clients.forEach((row,index)=>{row.group=1;row.clientId=`1:member${index}`;})]) {
    const result=reportFixture();change(result);const gates=evaluateSustained(result);
    for(const gate of ['coldOpen','restartRecovery','streamRecovery'])assert.equal(gates[gate].status,'fail');
  }
});
test('sweep: missing stream closure records and impossible lifetimes cannot prove a live cohort',()=>{
  for(const change of [row=>delete row.closedAt,row=>row.closedAt=2000000,row=>row.closeReason='unknown',row=>row.serverId='old-process']) {
    const result=reportFixture();change(result.load.recovery.streams[0]);assert.equal(evaluateSustained(result).streamRecovery.status,'fail');
  }
});
test('sweep: stale task readiness cannot confirm a newer state revision',()=>{
  assert.throws(()=>readinessProof({state:{state:{revision:5,members:[{id:'owner'}]}},tasks:{stateRevision:4,tasks:[]},
    memberId:'owner',expectedServerId:'new-process',stateServerId:'new-process',tasksServerId:'new-process'}),error=>error.status==='stale-readiness');
  const result=reportFixture();result.load.recovery.groups[0].tasksRevision=0;
  assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
});
test('sweep: an unhealthy, stale-generation or transient residency sample cannot prove sustained recovery',()=>{
  for(const change of [sample=>sample.server.health.ready=false,sample=>sample.server.health.savesReady=false,
    sample=>sample.server.serverId='old-process',sample=>sample.server.health.service.openContexts=2]) {
    const result=reportFixture();change(result.samples[2]);assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
  }
  const transient=reportFixture(),bad=structuredClone(transient.samples[1]);
  for(const receipt of [bad,bad.server,bad.server.healthObservation,bad.server.diagnosticsObservation]){receipt.receivedAt=1319999;receipt.elapsedMs=1319999;}
  bad.server.health.ready=false;
  transient.samples.splice(2,0,bad);assert.equal(evaluateSustained(transient).restartRecovery.status,'fail');
});
test('sweep: failed or repeated cache-miss attempts cannot compensate for an intended action that hit cache',()=>{
  const result=reportFixture(),row=result.load.operations.find(row=>row.action==='task-miss');
  row.cacheMisses=100;row.successfulTaskMisses=9;
  assert.equal(evaluateSustained(result).calculationMissCoverage.status,'fail');
  row.successfulTaskMisses=10;row.statuses={200:9,500:1};assert.equal(evaluateSustained(result).calculationMissCoverage.status,'fail');
});
test('sweep: missing telemetry, missing scheduled work and a truncated run fail the generator gate',()=>{
  for(const change of [result=>result.samples=[],result=>result.load.stats.completed--,result=>result.load.completedAt=1900000,
    result=>delete result.telemetryErrors,result=>result.load.offeredOperations=[],result=>result.samples[1].server.memory.rss=null]) {
    const result=reportFixture();change(result);assert.equal(evaluateSustained(result).generator.status,'fail');
  }
});
test('sweep: isolated telemetry snapshots cannot prove recovery or the full run time series',()=>{
  const result=reportFixture();result.samples=result.samples.slice(0,3);
  const gates=evaluateSustained(result);assert.equal(gates.generator.status,'fail');assert.equal(gates.restartRecovery.status,'fail');
  const restarting=reportFixture();restarting.samples[0].restarting=true;
  assert.equal(evaluateSustained(restarting).generator.status,'fail','restart placeholders cannot mask telemetry loss outside the restart');
});
test('sweep: missing or invalid Retry-After evidence in cold opens or SSE cannot hide behind zero counters',()=>{
  const result=reportFixture(),cold=result.load.operations.find(row=>row.action==='cold-open');
  cold.httpRequests++;cold.httpRejects=1;cold.httpStatuses[503]=1;
  assert.equal(evaluateSustained(result).refusalHeaders.status,'fail');
  cold.retryAfterValues={bananas:1};assert.equal(evaluateSustained(result).refusalHeaders.status,'fail');
  const stream=reportFixture();stream.load.stageStreams[1].attempted++;stream.load.stageStreams[1].handshakes++;stream.load.stageStreams[1].statuses[503]=1;
  assert.equal(evaluateSustained(stream).refusalHeaders.status,'fail');
});
test('sweep: a successful non-SSE HTTP response cannot establish a live event stream',async()=>{
  const counters={attempted:0,opened:0,unexpectedFailures:0,statuses:{}},stats={streamOpened:0,httpBytes:0};let opened=false,closed;
  const result=await consumeStream({base:'http://127.0.0.1:1',client:{cookie:'synthetic'},controller:new AbortController(),counters,stats,
    planned:()=>false,requireEventStream:true,onOpened:()=>opened=true,onClosed:row=>closed=row,
    fetchRequest:async()=>Response.json({ready:true},{headers:{[SERVER_ID_HEADER]:'new-process'}})});
  assert.equal(result.opened,false);assert.equal(opened,false);assert.equal(closed.opened,false);assert.equal(counters.unexpectedFailures,1);
});

// Every clock below is logical; no wall-time performance assertions or sleeps.
function sampleTransport({now,server,onPart=()=>{}}) {
  const inbox=createSampleInbox({now});let id=0;
  return generation=>{
    const request=++id,pending=inbox.expect(request,generation);
    for(const [part,value] of [['health',server.health],['diagnostics',server.diagnostics],['snapshot',server]]) {
      onPart(part);
      inbox.receive({type:part==='snapshot'?'sample':`sample-${part}`,id:request,...(part==='snapshot'?value:{serverId:server.serverId,[part]:value})},generation);
    }
    return pending;
  };
}
test('P2: a pre-deadline healthy receipt delayed by tree/disk collection cannot confirm recovery',async()=>{
  const result=reportFixture(),server=structuredClone(result.samples[2].server);
  for(const row of result.samples)if(row.server.healthObservation.elapsedMs>1320000)row.server.health.ready=false;
  let clock=1319999;
  const collector=createSampleCollector({profile:result.profile,directory:'synthetic',now:()=>clock,
    requestSnapshot:sampleTransport({now:()=>clock,server}),
    readTree:async()=>{clock=1320000;return {supported:false,cpuSeconds:null};},
    readDisk:async()=>{clock=1320001;return {bytes:0,files:0};}});
  const {row,errors}=await collector.collect({start:0,generation:1,pid:0,client:{}});
  assert.equal(errors,0);assert.equal(row.collectedAt,1320001);
  assert.equal(row.elapsedMs,1319999);assert.equal(row.server.healthObservation.elapsedMs,1319999);
  result.samples.push(row);
  const gates=evaluateSustained(result);
  assert.equal(gates.restartRecovery.status,'fail');
  assert.equal(gates.generator.status,'pass','a correctly timed unhealthy run is valid measurement, with failed recovery');
});
test('receipt sweep: health and residency cannot inherit the later heap/IPC snapshot receipt',async()=>{
  const result=reportFixture(),server=result.samples[2].server;let clock=1319999;
  const collector=createSampleCollector({profile:result.profile,directory:'synthetic',now:()=>clock,
    requestSnapshot:sampleTransport({now:()=>clock,server,onPart:part=>{if(part==='diagnostics')clock=1320001;if(part==='snapshot')clock=1320002;}}),
    readTree:async()=>({supported:false,cpuSeconds:null}),readDisk:async()=>({bytes:0,files:0})});
  const {row}=await collector.collect({start:0,generation:1,pid:0,client:{receivedAt:1319998}});
  assert.equal(row.server.healthObservation.receivedAt,1319999);
  assert.equal(row.server.diagnosticsObservation.receivedAt,1320001);
  assert.equal(row.receivedAt,1320002);assert.equal(row.client.observation.receivedAt,1319998);
  for(const sample of result.samples)if(sample.server.healthObservation.elapsedMs>1320000)sample.server.health.ready=false;
  result.samples.push(row);assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
});
test('receipt sweep: later unhealthy health receipts invalidate an earlier successful confirmation',()=>{
  for(const field of ['ready','savesReady','residency']) {
    const result=reportFixture(),later=result.samples.find(row=>row.elapsedMs===1601500);
    if(field==='residency')later.server.health.service.openContexts=2;else later.server.health[field]=false;
    assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
  }
  const noFinal=reportFixture();noFinal.samples.forEach(row=>row.collectionPhase=null);
  assert.equal(evaluateSustained(noFinal).restartRecovery.status,'fail');
});
test('receipt sweep: telemetry coverage rejects missing or inconsistent observation receipt times',()=>{
  for(const change of [row=>delete row.server.healthObservation,row=>row.server.healthObservation.receivedAt--,
    row=>row.elapsedMs+=1000,row=>delete row.server.diagnosticsObservation]) {
    const result=reportFixture();change(result.samples[1]);assert.equal(evaluateSustained(result).generator.status,'fail');
  }
  const boundary=reportFixture();
  // A receipt exactly at the deadline does not provide post-deadline confirmation.
  boundary.samples[2].server.healthObservation={...boundary.samples[2].server.healthObservation,elapsedMs:1320000,receivedAt:1320000};
  boundary.samples.find(row=>row.elapsedMs===1321500).server.health.ready=false;
  assert.equal(evaluateSustained(boundary).restartRecovery.status,'fail');
  const stale=reportFixture();
  for(const row of stale.samples)if(row.elapsedMs>1300000&&row.elapsedMs<1600000)
    Object.assign(row.server.diagnosticsObservation,{receivedAt:1300000,elapsedMs:1300000});
  assert.equal(evaluateSustained(stale).generator.status,'fail','fresh memory receipts cannot conceal missing queue observations');
});
test('receipt sweep: resource windows, CPU deltas and cached disk use their own receipts and phases',async()=>{
  const stages=[{seconds:1,measured:false,classification:'nominal'},{seconds:1,measured:true,classification:'nominal'},
    {seconds:1,measured:true,classification:'overload'}];
  const settings={stages,diskSampleSeconds:60,osReserveBytes:0},server=reportFixture().samples[0].server;
  server.memory.rss=50;server.eventLoop.p99Ms=999;
  let clock=900,cpu=0,reads=0;
  const collector=createSampleCollector({profile:settings,directory:'synthetic',now:()=>clock,logicalCpus:1,
    requestSnapshot:sampleTransport({now:()=>clock,server}),
    readTree:async()=>{clock=reads++?1900:1100;cpu+=.8;return {supported:true,processes:1,cpuSeconds:cpu,rssBytes:900};},
    readDisk:async()=>{clock=1500;return {bytes:123,files:1};}});
  const first=(await collector.collect({start:0,generation:0,pid:0,client:{receivedAt:899}})).row;
  clock=1600;
  const second=(await collector.collect({start:0,generation:0,pid:0,client:{receivedAt:1599}})).row;
  assert.equal(first.server.stage,0);assert.equal(first.server.window.measured,false);
  assert.equal(first.tree.stage,1);assert.equal(first.tree.window.measured,false);
  assert.equal(second.tree.window.windowStartElapsedMs,1100);assert.equal(second.tree.elapsedMs,1900);
  assert.equal(second.tree.cpuPercent,100);assert.equal(second.tree.window.measured,true);
  assert.equal(second.disk.receivedAt,1500);assert.equal(second.disk.stage,1);assert.equal(second.disk.bytes,123);
  const result=reportFixture();Object.assign(result,{profile:settings,samples:[first,second],hardware:{ramBytes:1000}});
  const gates=evaluate(result);assert.equal(gates.cpu.status,'fail');assert.equal(gates.cpu.averagePercent,100);
  assert.equal(gates.eventLoop.status,'not-measured');assert.equal(gates.memory.status,'fail');
});
test('receipt sweep: SSE handshake, open and closure retain receipt times despite later callback work',async()=>{
  let clock=999,handshake,opened,closed;
  const stages=[{attempted:0,opened:0,statuses:{},unexpectedEnds:0},{attempted:0,opened:0,statuses:{},unexpectedEnds:0}];
  await consumeStream({base:'http://synthetic.invalid',client:{cookie:'synthetic'},controller:new AbortController(),now:()=>clock,
    counters:at=>stages[at<1000?0:1],stats:{httpBytes:0,streamOpened:0,streamUnexpectedEnds:0},planned:()=>false,
    timer:()=>1,cancelTimer:()=>{clock+=1000;},requireEventStream:true,
    onHandshake:row=>{handshake=row;clock+=1000;},onOpened:row=>opened=row,onClosed:row=>closed=row,
    fetchRequest:async()=>({ok:true,status:200,headers:new Headers({'content-type':'text/event-stream',[SERVER_ID_HEADER]:'new-process'}),
      body:{async *[Symbol.asyncIterator](){clock=7000;}}})});
  assert.equal(handshake.receivedAt,999);assert.equal(opened.receivedAt,999);assert.equal(closed.receivedAt,7000);
  assert.equal(stages[0].opened,1);assert.equal(stages[1].opened,0);assert.equal(stages[1].unexpectedEnds,1);
});
test('receipt sweep: SSE starts and handshake receipts on opposite stage boundaries reconcile independently',async t=>{
  let clock=999;
  const stages=[{attempted:0,handshakes:0,opened:0,statuses:{}},{attempted:0,handshakes:0,opened:0,statuses:{}}];
  await consumeStream({base:'http://synthetic.invalid',client:{cookie:'synthetic'},controller:new AbortController(),now:()=>clock,
    counters:at=>stages[at<1000?0:1],stats:{httpBytes:0,streamOpened:0},planned:()=>true,requireEventStream:true,
    fetchRequest:async()=>{clock=1001;return new Response('',{headers:{'content-type':'text/event-stream'}});}});
  assert.equal(stages[0].attempted,1);assert.equal(stages[0].handshakes,0);
  assert.equal(stages[1].attempted,0);assert.equal(stages[1].handshakes,1);
  const result=reportFixture();result.load.stageStreams[0].attempted=1;result.load.stageStreams[1].attempted=3;
  assert.equal(evaluateSustained(result).refusalHeaders.status,'pass');
  result.load.stageStreams[1].handshakes--;assert.equal(evaluateSustained(result).refusalHeaders.status,'fail');
  const settings=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  settings.streamConnectSpreadMs=0;clock=120001;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-tail-receipt-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const load=await drive({base:'http://127.0.0.1:1',initialServerId:'old-process',profile:settings,fixture:fixture(settings),directory,now:()=>clock,startWorkload:()=>0,onSample:async()=>{},
    fetchRequest:async()=>new Response('',{headers:{'content-type':'text/event-stream'}}),
    schedule:async(events,run)=>run({...events.find(row=>row.kind==='workload-end'),scheduledAt:clock})});
  assert.equal(load.stageStreams.reduce((n,row)=>n+row.handshakes,0),0);
  assert.equal(load.tailStreams.handshakes,4,'receipts beyond the final stage cannot contaminate its measured counters');
});
test('receipt sweep: unexpected SSE ends after confirmation invalidate recovery, planned handoffs stay live',()=>{
  const result=reportFixture(),first=result.load.recovery.streams[0];
  result.load.recovery.streams.push({...first,openedAt:1500500});first.closedAt=1500000;first.closeReason='unexpected';
  assert.equal(evaluateSustained(result).streamRecovery.status,'fail');
  first.closeReason='reconnect';assert.equal(evaluateSustained(result).streamRecovery.status,'pass');
});
test('receipt sweep: readiness and restart evidence uses HTTP/ready receipts before later processing',async t=>{
  const settings=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  settings.streamConnectSpreadMs=60000;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-receipts-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=0,serverId='old-process';
  const load=await drive({base:'http://127.0.0.1:1',initialServerId:serverId,profile:settings,fixture:fixture(settings),directory,now:()=>clock,onSample:async()=>{},
    fetchRequest:async(url)=>{
      const route=new URL(url).pathname;assert.notEqual(route,'/api/events');clock+=10;
      const value=route==='/api/state'?{state:{revision:1,members:[{id:'owner'},{id:'member2'}]}}:route==='/api/tasks'?{stateRevision:1,tasks:[]}:{};
      return {ok:true,status:200,text:async()=>JSON.stringify(value),headers:{get:name=>{if(name===SERVER_ID_HEADER){clock+=1000;return serverId;}return null;}}};
    },restartServer:async()=>{const readyReceivedAt=clock+10;clock+=1000;serverId='new-process';return {base:'http://127.0.0.1:1',serverId,readyReceivedAt,generation:1,shutdown:{forced:false,exitCode:0,signal:null}};},
    schedule:async(events,run)=>{
      for(const kind of ['cold-open','restart','recovery-open']) {
        const event=events.find(row=>row.kind===kind);clock=Math.max(clock,event.atMs);await run({...event,scheduledAt:event.atMs});
      }
    }});
  assert.equal(load.restarts[0].serverReadyMs,10);
  const records=(await readFile(path.join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  for(const evidence of [load.coldOpens[0],load.recovery.groups[0]]) {
    const action=evidence.serverId==='old-process'?'cold-open':'recovery-open',record=records.find(row=>row.action===action);
    const origin=action==='cold-open'?load.workloadStart:load.restarts[0].startedAt;
    assert.equal(evidence.tasksReceivedAt,record.requests.findLast(row=>row.route==='/api/tasks').receivedAt);
    assert.equal(evidence.elapsedMs,evidence.tasksReceivedAt-origin);
    assert.ok(evidence.tasksReceivedAt<record.scheduledMs+record.latencyMs+load.workloadStart,'processing time is retained in action latency, outside receipt evidence');
  }
});
test('receipt sweep: SSE teardown cannot extend the offered workload duration',async t=>{
  const settings=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json',import.meta.url)));
  settings.streamConnectSpreadMs=0;
  const directory=await mkdtemp(path.join(tmpdir(),'rs3-sustained-end-receipt-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=0;
  const load=await drive({base:'http://127.0.0.1:1',initialServerId:'old-process',profile:settings,fixture:fixture(settings),directory,now:()=>clock,onSample:async()=>{},
    fetchRequest:async(_url,options)=>({ok:true,status:200,headers:new Headers({'content-type':'text/event-stream',[SERVER_ID_HEADER]:'old-process'}),
      body:{async *[Symbol.asyncIterator](){await new Promise(resolve=>{options.signal.addEventListener('abort',resolve,{once:true});if(options.signal.aborted)resolve();});clock+=200000;}}}),
    schedule:async(events,run)=>{await run({...events.find(row=>row.kind==='workload-end'),scheduledAt:clock});clock=1000;}});
  assert.equal(load.workloadCompletedAt,1000);assert.equal(load.streamShutdownAt,1000);assert.ok(load.completedAt>=201000);
  const result=reportFixture();result.load.workloadCompletedAt=1000;result.load.completedAt=2010000;
  assert.equal(evaluateSustained(result).generator.status,'fail');
});
