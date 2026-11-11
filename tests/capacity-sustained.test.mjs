// @test quick shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCohorts, drive } from '../scripts/perf/capacity/driver.mjs';
import { planFixture, catalogue, syntheticWorld } from '../scripts/perf/capacity/model.mjs';
import { sustainedArrivals, sustainedAction, sustainedPhase, sustainedBrowserAction, validateSustained } from '../scripts/perf/capacity/sustained.mjs';
import { evaluateSustained, everydayActions, heavyActions } from '../scripts/perf/capacity/sustained-report.mjs';
import { retryRead } from '../scripts/perf/capacity/client.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';

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
  const row=action=>({stage:1,action,latency:{count:10,p50Ms:10,p95Ms:20,p99Ms:30},statuses:{200:10},cacheMisses:action==='task-miss'?10:0});
  return {profile:{...profile,stages:[profile.stages[0],{...profile.stages[1],activeGroups:2,users:4}]},format:'format1',
    load:{stats:{clientDrops:0},operations:[...everydayActions,...heavyActions].map(row).concat([{...row('cold-open'),stage:0,latency:{count:2,p95Ms:10},statuses:{200:2}}]),
      workloadStart:0,restarts:[{startedAt:1000,serverReadyMs:10,shutdown:{forced:false}}],recovery:{groups:[{group:1,elapsedMs:100},{group:2,elapsedMs:200}],streams:[1,2,3,4].map(group=>({group,elapsedMs:300}))}},
    samples:[{generation:1,elapsedMs:1300,server:{health:{service:{openContexts:3}}}}],telemetryErrors:0,shutdown:{forced:false}};
}
test('speed verdicts cannot pass fast refusals, missing classes, dropped work or incomplete recovery',()=>{
  const result=reportFixture(),gates=evaluateSustained(result);
  assert.equal(gates.everyday.status,'pass');assert.equal(gates.heavy.status,'pass');assert.equal(gates.coldOpen.status,'pass');
  assert.equal(gates.restartRecovery.status,'pass');assert.equal(gates.format2Serving.status,'blocked');assert.equal(gates.characterSwitch.status,'blocked');
  result.samples[0].server.health.service.openContexts=2;
  assert.equal(evaluateSustained(result).restartRecovery.status,'fail','visiting groups serially cannot stand in for simultaneous readiness');
  result.samples[0].server.health.service.openContexts=3;
  result.load.operations.find(row=>row.action==='tick').statuses={503:10};
  assert.equal(evaluateSustained(result).everyday.status,'fail');
  result.load.operations=result.load.operations.filter(row=>row.action!=='preview');
  assert.deepEqual(evaluateSustained(result).heavy.missing,['preview']);
  result.load.recovery.groups.pop();assert.equal(evaluateSustained(result).restartRecovery.status,'fail');
  result.load.stats.clientDrops=1;assert.equal(evaluateSustained(result).generator.status,'fail');
  result.load.operations.find(row=>row.action==='task-miss').cacheMisses=0;assert.equal(evaluateSustained(result).calculationMissCoverage.status,'fail');
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
      return new Response(body);
    }
    return Response.json(parsed.pathname==='/api/state'?{state:{revision:1,members:[{id:'owner'},{id:'member2'}]}}:
      parsed.pathname==='/api/tasks'?{stateRevision:1,tasks:[]}:{});
  };
  const result=await drive({base:'http://127.0.0.1:1',profile:smoke,fixture:fixture(smoke),directory,onSample:async()=>{},fetchRequest,
    restartServer:async()=>{restarts++;return {base:'http://127.0.0.1:2',shutdown:{forced:false,exitCode:0}};},
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
