// @test quick shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFixture, catalogue, loopback, digest } from '../scripts/perf/capacity/model.mjs';
import { arrivals, dispatch } from '../scripts/perf/capacity/scheduler.mjs';
import { testRunPolicy, classifyTest } from '../scripts/test-selection.mjs';
import { evaluate } from '../scripts/perf/capacity/report.mjs';

test('capacity shapes reproduce the mixed 2000-slot contract and refuse unsafe targets',()=>{
  const profile={seed:'synthetic-42',fixture:{groups:500,rosterMix:[1,1,1,1,6],freshFraction:.25}};
  const plan=planFixture(profile);
  assert.deepEqual(plan,planFixture(profile));assert.notDeepEqual(plan,planFixture({...profile,seed:'synthetic-43'}));
  assert.deepEqual([1,2,3,4,5].map(n=>plan.filter(g=>g.size===n).length),[50,50,50,50,300]);
  assert.equal(plan.reduce((n,g)=>n+g.size,0),2000);assert.equal(plan.filter(g=>g.grown).length,375);
  const shape={chunks:8,tasks:12,dependencyDepth:4,crossLinks:2},data=catalogue(shape);
  assert.equal(digest(data),digest(catalogue(shape)));assert.equal(Object.keys(data.challenges.Extra).length,12);
  assert.deepEqual(data.challenges.Extra['Synthetic task 3'].Tasks,{'Synthetic task 2':'Extra','Synthetic task 1':'Extra'});
  assert.equal(loopback('http://127.0.0.1:8955'),'http://127.0.0.1:8955');
  for(const url of ['https://localhost:8955','http://example.invalid:8955','http://127.0.0.1:8788','http://127.0.0.1:8789','http://127.0.0.1:9000','http://localhost:8955/join/x']) assert.throws(()=>loopback(url));
  assert.throws(()=>planFixture({...profile,fixture:{...profile.fixture,rosterMix:[0,0,0,0,0]}}));
  assert.equal(testRunPolicy('capacity-harness.test.mjs').env.RS3_DATASET,'open-f2p');
  assert.equal(classifyTest('capacity-harness.test.mjs'),'quick');
  const result={profile:{stages:[{measured:false},{measured:true}],osReserveBytes:0},load:{stats:{rejects:1,timeouts:0,httpRequests:2},
    operations:[{stage:0,action:'session',httpRequests:1,httpRejects:1,timeouts:0},{stage:1,action:'session',httpRequests:1,httpRejects:0,timeouts:0,latency:{count:1,p95Ms:1,p99Ms:1}}],
    stageStreams:[{opened:0,rejected:1,unexpectedEnds:0},{opened:1,rejected:0,unexpectedEnds:0}]},samples:[],hardware:{ramBytes:1024},telemetryErrors:0};
  assert.equal(evaluate(result).nominalAdmission.status,'pass');
  result.load.operations[1].httpRejects=1;
  assert.equal(evaluate(result).nominalAdmission.status,'fail');
});

test('open-loop scheduler dispatches scheduled work while earlier work is unfinished and counts overflow',async()=>{
  const stages=[{seconds:1,rate:4},{seconds:1,rate:2}], streams=s=>({browser:s.rate});
  const events=arrivals(stages,'synthetic-scheduler',streams);
  assert.deepEqual(events,arrivals(stages,'synthetic-scheduler',streams));assert.equal(events.length,6);
  assert.ok(events.every((event,i)=>!i||event.atMs>=events[i-1].atMs));
  let now=0,release;const held=new Promise(resolve=>{release=resolve;}),seen=[],drops=[];
  await dispatch([{atMs:0},{atMs:10},{atMs:20}],async event=>{
    seen.push({scheduledAt:event.scheduledAt,at:now});
    if(seen.length===3)release();
    await held;
  },{now:()=>now,timer:(fn,ms)=>{now+=ms;fn();},maxInFlight:3});
  assert.deepEqual(seen.map(s=>s.scheduledAt),[0,10,20]);
  assert.equal(seen[1].at,10);
  now=0;let finish;const blocked=new Promise(resolve=>{finish=resolve;});
  await dispatch([{atMs:0},{atMs:10},{atMs:20}],()=>blocked,{now:()=>now,timer:(fn,ms)=>{now+=ms;fn();},maxInFlight:1,onDrop:event=>{drops.push(event.atMs);if(event.atMs===20)finish();}});
  assert.deepEqual(drops,[10,20]);
});
