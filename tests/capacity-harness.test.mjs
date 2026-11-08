// @test quick shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFixture, catalogue, loopback, digest } from '../scripts/perf/capacity/model.mjs';
import { arrivals, dispatch, stageWindow } from '../scripts/perf/capacity/scheduler.mjs';
import { outcomeCounts, drive, prepareCohorts, consumeStream } from '../scripts/perf/capacity/driver.mjs';
import { processTree } from '../scripts/perf/capacity/telemetry.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const result={profile:{stages:[{measured:false,classification:'nominal'},{measured:true,classification:'nominal'}],osReserveBytes:0},load:{stats:{rejects:1,timeouts:0,httpRequests:2},
    operations:[{stage:0,action:'session',httpRequests:1,httpRejects:1,timeouts:0},{stage:1,action:'session',httpRequests:1,httpRejects:0,timeouts:0,latency:{count:1,p95Ms:1,p99Ms:1}}],
    stageStreams:[{opened:0,rejected:1,unexpectedEnds:0},{opened:1,rejected:0,unexpectedEnds:0}]},samples:[],hardware:{ramBytes:1024},telemetryErrors:0};
  assert.equal(evaluate(result).nominalAdmission.status,'pass');
  result.load.operations[1].httpRejects=1;
  assert.equal(evaluate(result).nominalAdmission.status,'fail');
});

function fakeResult(stages,operations) {
  return {profile:{stages,osReserveBytes:0},load:{stats:{},operations,
    stageStreams:stages.map(()=>({opened:1,rejected:0,unexpectedEnds:0,unexpectedFailures:0,rejectsWithoutRetryAfter:0}))},
    samples:[],hardware:{ramBytes:1024},telemetryErrors:0,shutdown:{forced:false,exitCode:0,signal:null}};
}
const operation=(stage,action,status,extra={})=>({stage,action,...outcomeCounts({status,requests:[{status}],...extra}),
  latency:{count:1,p95Ms:1,p99Ms:1}});

test('fast unexpected HTTP and network failures fail measured latency and admission gates',()=>{
  for(const status of [500,502,504,'network-error']) {
    const row=operation(1,'session',status);row.httpRequests*=100;row.unexpectedFailures*=100;row.latency.count=100;
    const result=fakeResult([{measured:false,classification:'nominal'},{measured:true,classification:'nominal'}],[row]);
    const gates=evaluate(result);
    assert.equal(gates.cheapWarm.status,'fail');assert.equal(gates.nominalAdmission.status,'fail');
    assert.equal(gates.nominalAdmission.unexpectedFailures,100);
    row.action='preview';assert.equal(evaluate(result).expensiveWarm.status,'fail');
    row.stage=0;assert.equal(evaluate(result).nominalAdmission.unexpectedFailures,0);
  }
  const conflict=operation(0,'edit',409,{intentionalConflict:true});
  conflict.latency={count:1,p95Ms:99999,p99Ms:99999};conflict.validLatency={count:0,p95Ms:null,p99Ms:null};
  const unsupported={stage:0,action:'switch',...outcomeCounts({status:'unsupported'}),latency:{count:1,p95Ms:1,p99Ms:1}};
  const result=fakeResult([{measured:true,classification:'nominal'}],[operation(0,'session',200),conflict,unsupported]);
  const gates=evaluate(result);
  assert.equal(gates.cheapWarm.status,'pass');assert.equal(gates.nominalAdmission.status,'pass');
  assert.equal(gates.nominalAdmission.intentionalConflicts,1);assert.equal(gates.nominalAdmission.unsupported,1);
  assert.equal(gates.nominalAdmission.validHttpRequests,1);
  assert.equal(outcomeCounts({status:409,requests:[{status:409}]}).unexpectedFailures,1);
});

test('arrivals and telemetry share the post-sample start and exclude boundary-spanning resource windows',async()=>{
  const stages=[{seconds:1,measured:false,classification:'nominal'},{seconds:1,measured:true,classification:'nominal'},
    {seconds:1,measured:true,classification:'overload'}];
  // Simulate slow initial telemetry, then driver preparation after the shared start.
  let now=90000;const workloadStart=now;now+=50;
  const seen=[];
  await dispatch([{atMs:0},{atMs:1000},{atMs:1500},{atMs:2000}],event=>{
    seen.push({scheduledAt:event.scheduledAt,...stageWindow(stages,workloadStart,now)});
  },{startAt:workloadStart,now:()=>now,timer:(fn,ms)=>{now+=ms;fn();}});
  assert.deepEqual(seen.map(row=>row.scheduledAt),[90000,91000,91500,92000]);
  assert.deepEqual(seen.map(row=>row.stage),[0,1,1,2]);
  assert.deepEqual(seen.map(row=>row.measured),[false,true,true,true]);
  assert.equal(stageWindow(stages,workloadStart,90999,91001).measured,false);
  assert.equal(stageWindow(stages,workloadStart,91001,91500).measured,true);
  assert.equal(stageWindow(stages,workloadStart,91999,92001).measured,false);
  assert.equal(stageWindow(stages,workloadStart,89999,90001).measured,false);
  assert.equal(stageWindow(stages,workloadStart,93000).stage,null);
  const result=fakeResult(stages,[operation(1,'session',200)]);
  result.samples=[{...stageWindow(stages,workloadStart,90999,91001),treeCpuPercent:99,tree:{rssBytes:0},server:{eventLoop:{p99Ms:999}}},
    {...stageWindow(stages,workloadStart,91001,91500),treeCpuPercent:10,tree:{rssBytes:0},server:{eventLoop:{p99Ms:1}}}];
  assert.equal(evaluate(result).cpu.averagePercent,10);assert.equal(evaluate(result).eventLoop.worstWindowP99Ms,1);
});

test('overload rejection stays visible without contaminating nominal gates; recovery has its own verdict',()=>{
  const stages=['nominal','overload','recovery'].map(classification=>({measured:true,classification}));
  const rejected=operation(1,'session',429,{requests:[{status:429,retryAfter:'1'}]});
  rejected.latency={count:1,p95Ms:10000,p99Ms:10000};
  const result=fakeResult(stages,[operation(0,'session',200),rejected,operation(2,'session',200),operation(2,'preview',200)]);
  result.load.stageStreams[1]={opened:0,rejected:1,unexpectedEnds:0,unexpectedFailures:0,rejectsWithoutRetryAfter:0};
  result.samples=[{stage:1,measured:true,treeCpuPercent:99,tree:{rssBytes:99999},server:{eventLoop:{p99Ms:999}}}];
  let gates=evaluate(result);
  assert.equal(gates.cheapWarm.status,'pass');assert.equal(gates.nominalAdmission.status,'pass');
  assert.equal(gates.nominalAdmission.httpRequests,1);assert.equal(gates.cpu.status,'not-measured');
  assert.equal(gates.overloadObservations.status,'pass');assert.equal(gates.overloadObservations.httpRejects,1);
  assert.equal(gates.overloadObservations.streams[0].rejected,1);assert.equal(gates.recoveryHTTP.status,'pass');
  rejected.rejectsWithoutRetryAfter=1;assert.equal(evaluate(result).overloadObservations.status,'fail');rejected.rejectsWithoutRetryAfter=0;
  result.load.operations.push(operation(1,'session',500));
  gates=evaluate(result);assert.equal(gates.overloadObservations.status,'fail');assert.equal(gates.nominalAdmission.status,'pass');
  result.load.operations.push(operation(2,'session',500));
  gates=evaluate(result);assert.equal(gates.recoveryHTTP.status,'fail');assert.equal(gates.cheapWarm.status,'pass');
  assert.equal(gates.overloadRecovery.status,'not-measured');
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

test('missing Linux children discovery preserves root readings and makes tree gates unavailable',async()=>{
  const fields=Array(22).fill('0');fields[11]='100';fields[12]='200';fields[19]='1';
  const files={'/proc/7/stat':`7 (synthetic) ${fields.join(' ')}`,'/proc/7/status':'VmRSS: 4096 kB\nVmSwap: 0 kB',
    '/proc/7/io':'read_bytes: 100\nwrite_bytes: 200'};
  const tree=await processTree(7,{platform:'linux',ticksPerSecond:100,read:async filename=>{
    if(filename in files)return files[filename];
    throw Object.assign(new Error('Synthetic missing proc file'),{code:'ENOENT'});
  }});
  assert.equal(tree.availability,'unavailable');assert.equal(tree.processes,null);
  assert.equal(tree.rssBytes,null);assert.equal(tree.cpuSeconds,null);assert.equal(tree.observedProcesses,1);
  assert.equal(tree.root.rssBytes,4096*1024);assert.equal(tree.root.cpuSeconds,3);assert.equal(tree.root.writeBytes,200);
  const result=fakeResult([{measured:true,classification:'nominal'}],[operation(0,'session',200)]);
  result.samples=[{stage:0,measured:true,tree,treeCpuPercent:0}];
  assert.equal(evaluate(result).cpu.status,'unavailable');assert.equal(evaluate(result).cpu.averagePercent,null);
  assert.equal(evaluate(result).memory.status,'unavailable');
});

test('oversized stage and rotated cohorts refuse before workload start, and initialization errors propagate',async()=>{
  const fixture={groups:[{index:0,members:[{memberId:'owner'}],taskIds:['synthetic-task']}]};
  const profile={port:8955,stages:[{name:'fits',seconds:1,users:1,activeGroups:1},{name:'oversized',seconds:1,users:2,activeGroups:1}]};
  let started=false;
  await assert.rejects(drive({base:'http://127.0.0.1:8955',profile,fixture,startWorkload:()=>{started=true;}}),
    /Stage 1 \(oversized\).*requested 2 users.*provide 1 synthetic logins/);
  assert.equal(started,false);
  const mixed={groups:[{index:0,members:[{},{}]},{index:1,members:[{}]}]};
  assert.throws(()=>prepareCohorts({rotationSeconds:1,stages:[{seconds:2,users:2,activeGroups:1}]},mixed),/cohort 1.*requested 2 users/);
  await assert.rejects(dispatch([{atMs:0}],async()=>{throw new Error('Synthetic initialization failure');}),/Synthetic initialization failure/);
});

test('the same seed offers identical actions and clients with fast and slow fake responses',async t=>{
  const scratch=new URL('../.local/',import.meta.url);await mkdir(scratch,{recursive:true});
  const directory=await mkdtemp(new URL('capacity-unit-',scratch));
  // Only remove this test's newly created directory, inside the checkout's ignored scratch area.
  assert.equal(path.dirname(directory),path.resolve(fileURLToPath(scratch)));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const profile={seed:'synthetic-response-order',port:8955,catalogue:{chunks:8,tasks:12,dependencyDepth:4,crossLinks:2},
    requestDeadlineMs:30000,sampleSeconds:60,maxClientInFlight:1000,stages:[{seconds:1,users:2,activeGroups:1,browserPerSecond:100,pluginPerSecond:0,syncPerMinute:0}]};
  const fixture={groups:[{index:0,taskIds:['synthetic-task'],members:[{memberId:'owner',cookie:'synthetic-one'},
    {memberId:'member2',cookie:'synthetic-two'}]}]};
  const snapshot={state:{revision:10,rules:{'access.shared':false}},pools:{owner:{eligible:[{id:'1'},{id:'2'}]},member2:{eligible:[{id:'1'},{id:'2'}]}}};
  const experiment=async slow=>{
    const output=directory+(slow?'/slow':'/fast');await mkdir(output);const requests=[];
    const load=await drive({base:'http://127.0.0.1:8955',profile,fixture,directory:output,onSample:async()=>{},
      fetchRequest:async(url,options)=>{
        if(url.endsWith('/api/events'))return {ok:false,status:429,headers:{get:()=> '1'}};
        requests.push(JSON.stringify({route:url,cookie:options.headers.Cookie,body:options.body}));
        if(slow)await Promise.resolve();
        return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(snapshot)};
      },schedule:async(events,run)=>{
        const offer=event=>run({...event,scheduledAt:performance.now()});
        if(slow)await Promise.all(events.map(offer));else for(const event of events)await offer(event);
      }});
    const offered=(await readFile(output+'/events.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line))
      .sort((a,b)=>a.id-b.id).map(row=>({id:row.id,action:row.action,intentionalConflict:row.intentionalConflict,requests:row.requests.map(r=>r.route)}));
    assert.equal(load.stats.completed,100);
    return {offered,requests:requests.sort()};
  };
  const fast=await experiment(false),slow=await experiment(true);
  assert.deepEqual(slow,fast);
  assert.ok(fast.offered.some(row=>row.action==='edit'));
});

test('a stream that never returns headers fails admission even when aborted as planned',async()=>{
  const result=fakeResult([{measured:true,classification:'nominal'}],[operation(0,'session',200)]);
  const counters={attempted:0,opened:0,rejected:0,unexpectedEnds:0,unexpectedFailures:0,rejectsWithoutRetryAfter:0,establishmentFailures:0,statuses:{}};
  result.load.stageStreams=[counters];
  const stats={streamOpened:0,streamRejected:0,streamUnexpectedEnds:0,streamEstablishmentFailures:0,httpBytes:0};
  let expire;
  const controller=new AbortController();
  const job=consumeStream({base:'http://127.0.0.1:8955',client:{cookie:'synthetic-stream'},controller,counters,stats,
    planned:()=>controller.signal.aborted,headerDeadlineMs:5000,timer:fn=>{expire=fn;return 1;},cancelTimer:()=>{},
    fetchRequest:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  expire();await job;
  assert.equal(counters.attempted,1);assert.equal(counters.opened,0);assert.equal(counters.establishmentFailures,1);
  assert.equal(stats.streamEstablishmentFailures,1);assert.equal(evaluate(result).nominalAdmission.status,'fail');
});
