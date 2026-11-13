// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserClient, createSessionChecks, reconnectStream, reconnectDelay } from '../scripts/perf/capacity/client.mjs';
import { failureOutcome } from '../scripts/perf/capacity/failures.mjs';
import { createAdmissionCorrelation, observeAdmissionCorrelation, REQUEST_ID_HEADER, ADMISSION_ID_HEADER } from '../scripts/perf/capacity/admission-correlation.mjs';
import { prepareCohorts, consumeStream, distribution, prepareRollSnapshot, sessionArrivals, drive } from '../scripts/perf/capacity/driver.mjs';
import { beginOpenDiagnostics } from '../app/open-diagnostics.mjs';
import { createPickerAdmission } from '../app/picker-admission.mjs';
import { diagnosticMarkdown } from '../scripts/perf/capacity/report.mjs';
import { fixtureMigration, calibrateIdentities } from '../scripts/perf/capacity/fixture-migration.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool } from '../app/core/rules.mjs';
import { prepareChunkPrediction } from '../app/core/planning.mjs';
import { growthCommands } from '../scripts/perf/capacity/growth.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { generate } from '../scripts/perf/capacity/fixture.mjs';
import { createServer } from '../app/server.mjs';
import { catalogue, syntheticWorld, planFixture } from '../scripts/perf/capacity/model.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { observeServerIdentity, SERVER_ID_HEADER } from '../scripts/perf/capacity/evidence.mjs';

test('admission transitions retain their request identity when another request releases the queue', async () => {
  const correlation = createAdmissionCorrelation(), first = Promise.withResolvers(), second = Promise.withResolvers(), rows = [], headers = [];
  const run = (requestId, admissionId, release) => correlation.handle({ headers: { [REQUEST_ID_HEADER]: requestId } },
    { setHeader: (name, value) => headers.push([requestId, name, value]) }, async () => {
      rows.push(correlation.observe({ admissionId, transition: 'queued' }));
      await release.promise;
      // Completing this request may pump another request's queued admission.
      rows.push(correlation.observe({ admissionId: admissionId === 1 ? 2 : 1, transition: 'started' }));
    });
  const a = run('action:1:request:1', 1, first), b = run('action:2:request:1', 2, second);
  first.resolve(); await a; second.resolve(); await b;
  assert.deepEqual(rows.map(row => row.requestId), ['action:1:request:1', 'action:2:request:1', 'action:2:request:1', 'action:1:request:1']);
  assert.deepEqual(headers.map(row => row.slice(1)), [[ADMISSION_ID_HEADER, '1'], [ADMISSION_ID_HEADER, '2']]);
  assert.equal(correlation.observe({ admissionId: 2, transition: 'released' }).requestId, 'action:2:request:1');
  correlation.handle({ headers: { [REQUEST_ID_HEADER]: 'action:3:request:1' } }, { setHeader() {} }, () => {
    correlation.observe({ admissionId: 3, transition: 'queued' });
    assert.equal(correlation.observe({ admissionId: 3, transition: 'deadline' }).requestId, 'action:3:request:1');
  });
  assert.equal(correlation.observe({ admissionId: 3, transition: 'released' }).requestId, null, 'an unstarted expired admission retains no correlation entry');
});

test('shared preflight followers inherit the originating timeout, refusal or transport cause', async () => {
  for (const cause of [Object.assign(new DOMException('Synthetic timeout', 'TimeoutError'), { requestId: 'r1' }),
    Object.assign(new Error('Synthetic busy'), { status: 503, requestId: 'r1' }),
    Object.assign(new TypeError('Synthetic transport', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }), { requestId: 'r1' })]) {
    const pending = Promise.withResolvers(), checks = createSessionChecks(), owner = { actionId: 1 }, follower = { actionId: 2 };
    const first = checks('login', owner, () => pending.promise), second = checks('login', follower, () => assert.fail('follower dispatched'));
    const results = Promise.allSettled([first, second]); pending.reject(new Error('Recovery guidance', { cause }));
    for (const result of await results) {
      assert.equal(result.status, 'rejected');
      const failure = failureOutcome(result.reason);
      assert.equal(failure.status, cause.status ?? (cause.name === 'TimeoutError' ? 'timeout' : 'network-error'));
      assert.equal(failure.inheritedPreflightId, 'preflight:1'); assert.equal(failure.inheritedRequestId, 'r1');
      assert.equal(failure.error.cause.cause.name, cause.name);
    }
    assert.deepEqual(follower.sharedPreflights, [{ id: 'preflight:1', ownerActionId: 1, coalesced: true }]);
    assert.equal((await checks('login', follower, async () => 'recovered')).value, 'recovered');
  }
});

test('route cooldown followers retain the original refusal request identity without dispatch', async () => {
  for (const retryAfter of ['1', new Date(11000).toUTCString()]) {
  let calls = 0, clock = 10000;
  const client = createBrowserClient({ now: () => clock, maxReadAttempts: 1, request: async () => {
    calls++;
    return { requestId: 'r503', ok: false, status: 503, headers: new Headers({ 'Retry-After': retryAfter }), json: async () => ({}) };
  } });
  await assert.rejects(client('/api/tasks?memberId=a'), { status: 503, requestId: 'r503' });
  await assert.rejects(client('/api/tasks?memberId=b'), error => {
    const failure = failureOutcome(error);
    assert.equal(failure.status, 503); assert.equal(failure.inheritedCooldownId, 'cooldown:r503');
    assert.equal(failure.inheritedRequestId, 'r503'); return true;
  });
  assert.equal(calls, 1);
  clock += 1000;
  await assert.rejects(client('/api/tasks'), { status: 503 }); assert.equal(calls, 2);
  }
});

test('production-sized profiles keep steady cohorts; churn explicitly rotates', async () => {
  const fixture={groups:Array.from({length:4},(_,index)=>({index,members:[{memberId:'owner',cookie:`synthetic-${index}`}]}))};
  const stages=[{seconds:600,users:2,activeGroups:2},{seconds:600,users:2,activeGroups:2}];
  const steady=prepareCohorts({stages,rotationSeconds:null},fixture);
  assert.deepEqual([...steady.keys()],['0:0','1:0']);
  assert.deepEqual(steady.get('0:0'),steady.get('1:0'));
  const churn=prepareCohorts({stages,rotationSeconds:300},fixture);
  assert.deepEqual(churn.get('0:0').map(row=>row.group),[0,1]);
  assert.deepEqual(churn.get('0:1').map(row=>row.group),[2,3]);
  assert.throws(()=>prepareCohorts({stages,rotationSeconds:0},fixture),/rotation/);
  for(const name of ['nominal','step-up','churn']) {
    const profile=JSON.parse(await readFile(new URL(`../scripts/perf/capacity/profiles/${name}.json`,import.meta.url)));
    assert.equal(profile.catalogue.tasks,23939);assert.equal(profile.catalogue.aliases,91000);assert.equal(profile.catalogue.stateBytes,15400000);
    assert.equal(profile.rotationSeconds,name==='churn'?300:null);
  }
});

test('nominal steady cohorts contain the configured fresh/grown mix through every ramp stage', async () => {
  const profile=JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/nominal.json',import.meta.url)));
  const groups=planFixture(profile),cohorts=prepareCohorts(profile,{groups});
  assert.deepEqual([...cohorts], [...prepareCohorts(profile,{groups})]);
  let previous=new Set();
  for(const [stageIndex,stage] of profile.stages.entries()) {
    const selected=new Set(cohorts.get(`${stageIndex}:0`).map(client=>client.group));
    assert.equal(selected.size,stage.activeGroups);
    assert.equal([...selected].filter(index=>!groups[index].grown).length,Math.round(stage.activeGroups*profile.fixture.freshFraction));
    assert.ok([...previous].every(index=>selected.has(index)),'ramp retains earlier groups');
    previous=selected;
  }
  assert.equal([...previous].filter(index=>groups[index].grown).length,75);
  assert.equal([...previous].filter(index=>!groups[index].grown).length,25);
});

test('fresh and grown synthetic players can preview and roll through a real eligible pool', async () => {
  const definitions=catalogue({chunks:8,tasks:2,dependencyDepth:2,crossLinks:1}),chunks=Object.keys(definitions.chunks);
  const world=syntheticWorld(definitions,buildWorld),registry=createRuleRegistry(),engine=createTaskEngine(definitions),client={memberId:'owner'};
  const options={world,registry,now:Date.UTC(2026,9,1),random:()=>0};
  for(const grown of [false,true]) {
    let state=createGroupState([{id:'owner',name:'Synthetic'}],registry);
    state.tasks=engine.catalogue.map(({id,label,category})=>({id,label,category}));
    if(grown)for(const {command} of growthCommands(state,{index:0,variant:0},chunks,{unlockFraction:.5},()=>options.now,registry))state=applyCommand(state,command,options);
    const snapshot=()=>({state,pools:{owner:{eligible:evaluateRollPool(world,state,'owner',registry).eligible}}}),requests=[];
    const ready=await prepareRollSnapshot(async(_,route,body)=>{
      requests.push(route);
      if(body){assert.equal(body.expectedRevision,state.revision);state=applyCommand(state,body.command,options);}
      return snapshot();
    },client,snapshot(),chunks);
    assert.deepEqual(requests,grown?[]:['/api/command?view=play-v1','/api/state?view=play-v1']);
    assert.ok(ready.pools.owner.eligible.length);
    const candidate=ready.pools.owner.eligible[0].id,before=structuredClone(ready.state);
    assert.doesNotThrow(()=>prepareChunkPrediction(ready.state,registry)('owner',candidate,{engine,world}));
    assert.deepEqual(ready.state,before,'preview does not mutate the save');
    const rolled=applyCommand(ready.state,{type:'roll',memberId:'owner',count:1},options);
    assert.ok(rolled.members[0].unlocked.includes(candidate));
  }
});

test('idle logins retain staggered five-second session checks across steady stages', async t => {
  const scratch=new URL('../var/',import.meta.url);await mkdir(scratch,{recursive:true});
  const directory=await mkdtemp(new URL('capacity-session-test-',scratch));
  assert.equal(path.dirname(directory),path.resolve(fileURLToPath(scratch)));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const stages=[0,1].map(()=>({seconds:5,users:200,activeGroups:200,browserPerSecond:0,pluginPerSecond:0,syncPerMinute:0}));
  const profile={seed:'synthetic-idle-sessions',port:0,catalogue:{chunks:2,tasks:1,dependencyDepth:1,crossLinks:1},
    requestDeadlineMs:30000,sampleSeconds:60,maxClientInFlight:1000,stages};
  const fixture={groups:Array.from({length:200},(_,index)=>({index,members:[{memberId:'owner',cookie:`synthetic-${index}`}]}))};
  const events=sessionArrivals(profile,prepareCohorts(profile,fixture));
  assert.deepEqual(events,sessionArrivals(profile,prepareCohorts(profile,fixture)));
  assert.deepEqual(stages.map((_,stage)=>events.filter(event=>event.stage===stage).length),[200,200]);
  assert.equal(new Set(events.filter(event=>event.stage===0).map(event=>event.atMs)).size,200,'checks are staggered');
  for(let clientIndex=0;clientIndex<200;clientIndex++) {
    const planned=events.filter(event=>event.clientIndex===clientIndex);
    assert.equal(planned.length,2);assert.equal(planned[1].atMs-planned[0].atMs,5000);
  }
  const checks=new Map();
  const load=await drive({base:'http://127.0.0.1:8955',profile,fixture,directory,onSample:async()=>{},fetchRequest:async(url,options)=>{
    if(url.endsWith('/api/events'))return {ok:false,status:503,headers:new Headers({'Retry-After':'1'})};
    assert.ok(url.endsWith('/api/session'),'no browser or plugin traffic was offered');
    checks.set(options.headers.Cookie,(checks.get(options.headers.Cookie)??0)+1);
    return {ok:true,status:200,headers:new Headers(),text:async()=>'{}'};
  },schedule:async(offered,run)=>{
    assert.equal(offered.length,400);
    for(const event of offered)await run({...event,scheduledAt:event.atMs});
  }});
  assert.equal(load.stats.httpRequests,400);assert.equal(checks.size,200);assert.ok([...checks.values()].every(count=>count===2));
});

test('browser reads retry warming/updating with Retry-After; POST and busy answers stay single dispatch', async () => {
  let now=0,calls=0;const waits=[];
  const client=createBrowserClient({now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;},request:async()=>{
    calls++;return calls<3?Response.json({code:calls===1?'PICKER_WARMING':'PICKER_UPDATING'},{status:503,headers:{'Retry-After':'1'}}):Response.json({ready:true});
  }});
  assert.deepEqual(await client('/api/state'),{ready:true});assert.equal(calls,3);assert.deepEqual(waits,[1000,1000]);
  for(const [body,code,delay] of [[{command:{}},'PICKER_WARMING','1'],[undefined,'BUSY','1'],[undefined,'PICKER_WARMING','10']]) {
    let count=0;const read=createBrowserClient({now:()=>now,sleep:async()=>assert.fail('unexpected retry'),request:async()=>{
      count++;return Response.json({code},{status:503,headers:{'Retry-After':delay}});
    }});
    await assert.rejects(read('/api/state',body),error=>error.status===503);
    await assert.rejects(read('/api/state',body),error=>error.retryAfterMs===Number(delay)*1000);
    assert.equal(count,1,'cooldown prevents another HTTP request');
  }
});

test('stream retries spread connections and back off; header timeout does not cancel the reconnect lifetime', async () => {
  const lifetime=new AbortController(),waits=[];let connects=0;
  await reconnectStream({signal:lifetime.signal,rng:()=>.5,spreadMs:1000,
    connect:async()=>{if(++connects===4)lifetime.abort();return {opened:false,retryAfterMs:connects===1?3000:0};},
    sleep:async ms=>{waits.push(ms);}});
  assert.equal(connects,4);assert.deepEqual(waits,[500,3000,2250,4250]);
  assert.equal(reconnectDelay(20,()=>0),30000);
  let expire;const attempt=new AbortController(),counters={attempted:0,establishmentFailures:0,statuses:{}},stats={streamEstablishmentFailures:0};
  await consumeStream({base:'http://synthetic.invalid',client:{cookie:'synthetic'},controller:attempt,counters,stats,planned:()=>false,
    timer:callback=>{expire=callback;return 1;},cancelTimer:()=>{},fetchRequest:async(_,options)=>{
      expire();options.signal.throwIfAborted();
    }});
  assert.equal(attempt.signal.aborted,true);assert.equal(counters.establishmentFailures,1);
});

test('successful SSE open resets reconnect backoff even when the response body fails', async () => {
  const lifetime=new AbortController(),waits=[],counters={attempted:0,opened:0,unexpectedEnds:0,establishmentFailures:0,statuses:{}};
  const stats={streamOpened:0,streamUnexpectedEnds:0,streamEstablishmentFailures:0,httpBytes:0};let connects=0;
  await reconnectStream({signal:lifetime.signal,rng:()=>0,sleep:async ms=>{waits.push(ms);},connect:async()=>{
    if(++connects===6){lifetime.abort();return;}
    return consumeStream({base:'http://synthetic.invalid',client:{cookie:'synthetic'},controller:new AbortController(),counters,stats,
      planned:()=>false,timer:()=>1,cancelTimer:()=>{},fetchRequest:async()=>{
        if(connects!==4)throw new Error('Synthetic header failure');
        return {ok:true,status:200,body:{async *[Symbol.asyncIterator](){yield new Uint8Array(1);throw new Error('Synthetic body failure');}}};
      }});
  }});
  assert.deepEqual(waits,[1000,2000,4000,1000,2000]);
  assert.equal(counters.opened,1);assert.equal(counters.unexpectedEnds,1);assert.equal(counters.establishmentFailures,4);
});

test('diagnostics are opt-in, observer failures are isolated, and summary exposes phase/memory/command/admission fields', () => {
  let clock=0;const rows=[];
  assert.equal(beginOpenDiagnostics(undefined,'synthetic',{memory:()=>assert.fail('disabled probe')}),undefined);
  const diagnostic=beginOpenDiagnostics(row=>rows.push(row),'synthetic',{now:()=>clock++,memory:()=>({rss:100,heapUsed:40})});
  diagnostic.timingMs.datasetVerifyMs=7;diagnostic.finish('completed');
  const broken=beginOpenDiagnostics(()=>{throw new Error('synthetic observer');},'synthetic');
  assert.doesNotThrow(()=>broken.finish('failed','SyntheticFailure'));
  assert.equal(rows[0].memory.delta.rss,0);
  const text=diagnosticMarkdown({contextOpens:rows,admissionTransitions:[{transition:'deadline',reason:'deadline'}],samples:[],
    load:{commands:[{command:'set-note',status:200,latency:distribution([1,2,3])}]}});
  for(const field of ['datasetVerifyMs','storeHydrateValidateMs','storeMigrateValidateMs','retentionMs','sidecarsMs','fingerprintsMs','rulePrepMs','Heap used','set-note','deadline / deadline'])assert.ok(text.includes(field),field);
});

test('retained stream disconnects count in the stage where they happen', async () => {
  let stage=0;
  const rows=[0,1].map(()=>({attempted:0,opened:0,unexpectedEnds:0,statuses:{}}));
  const stats={streamOpened:0,streamUnexpectedEnds:0,httpBytes:0};
  await consumeStream({base:'http://synthetic.invalid',client:{cookie:'synthetic'},controller:new AbortController(),
    counters:()=>rows[stage],stats,planned:()=>false,timer:()=>1,cancelTimer:()=>{},
    fetchRequest:async()=>({ok:true,status:200,body:{async *[Symbol.asyncIterator](){stage=1;yield new Uint8Array(1);}}})});
  assert.equal(rows[0].attempted,1);assert.equal(rows[0].opened,1);assert.equal(rows[0].unexpectedEnds,0);
  assert.equal(rows[1].unexpectedEnds,1);assert.equal(stats.httpBytes,1);
});

test('admission correlates queued/started/completed and reports immediate rejection reasons', async () => {
  const events=[],admission=createPickerAdmission({limits:{config:{coldStartsGlobal:1,coldStartsPerAccount:1},coldStart:()=>()=>{}},
    onEvent:event=>events.push(event),bounds:{maxPending:1,perAccount:1,deadlineMs:600000}});
  let release;const work=admission.run({accountId:'synthetic',pickerId:'synthetic-picker'},()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(admission.run({accountId:'synthetic'},()=>{}),/account-full/);
  await assert.rejects(admission.run({accountId:'other'},()=>{}),/queue-full/);
  await Promise.resolve();release();await work;await admission.close();
  assert.deepEqual(events.filter(row=>row.admissionId===1).map(row=>row.transition),['queued','started','completed','released']);
  assert.deepEqual(events.filter(row=>row.transition==='rejected').map(row=>row.reason),['account-full','queue-full']);
  await assert.rejects(admission.run({accountId:'synthetic'},()=>{}),/shutdown/);
  assert.equal(events.at(-1).reason,'shutdown');
});

test('real migration stamps fixtures and identity sizing uses valid synthetic alias records', () => {
  const definitions=catalogue({chunks:4,tasks:4,dependencyDepth:2,crossLinks:1,aliases:100});
  const inputs={definitions,taskMap:{},taskMapHistory:{},catalogue:createTaskEngine(definitions).catalogue,dynamicCatalogue:[]};
  const hook=fixtureMigration(inputs,selectedDataset),state=hook.migrateState(createGroupState([{id:'owner',name:'Synthetic'}]),{});
  assert.equal(hook.migrateState.isCurrent(state),true);
  for(let i=0;i<4;i++)assert.ok(state.identityRegistry.entries[`rs3:task:capacity-${i}`]);
  const aliases=Object.keys(state.identityRegistry.aliases).length+10,target=Buffer.byteLength(JSON.stringify(state))+10000;
  calibrateIdentities(state,{aliases,stateBytes:target});
  assert.equal(Object.keys(state.identityRegistry.aliases).length,aliases);assert.equal(Buffer.byteLength(JSON.stringify(state)),target);
  assert.ok(Object.values(state.identityRegistry.aliases).every(id=>typeof id!=='string'||id.startsWith('rs3:task:')));
  assert.equal(hook.migrateState.isCurrent(state),true);
});

test('tiny fixture first owned server open keeps its revision and emits every phase', async t => {
  const scratch=new URL('../var/',import.meta.url);await mkdir(scratch,{recursive:true});
  const directory=await mkdtemp(new URL('capacity-realism-test-',scratch));
  assert.equal(path.dirname(directory),path.resolve(fileURLToPath(scratch)));
  let app;
  t.after(async()=>{await app?.close();await rm(directory,{recursive:true,force:true});});
  const profile={name:'smoke',seed:'synthetic-realism',catalogue:{chunks:4,tasks:4,dependencyDepth:2,crossLinks:1},
    fixture:{groups:1,rosterMix:[0,1,0,0,0],freshFraction:0,unlockFraction:.5,historyEvents:1,snapshots:1,keysPerMember:0}};
  const manifest=await generate(profile,directory,{workers:1}),group=manifest.groups[0],opens=[],admissions=[],correlation=createAdmissionCorrelation();
  const definitions=catalogue(profile.catalogue);
  app=await createServer({dataDir:path.join(directory,'legacy'),definitions,taskMap:{},world:syntheticWorld(definitions,buildWorld),port:0,predictionPrewarm:false,
    multiPicker:{registryDir:path.join(directory,'registry'),pickerRoot:path.join(directory,'pickers'),tombstoneDir:path.join(directory,'tombstones'),onContextOpen:row=>opens.push(row),onAdmission:row=>admissions.push(correlation.observe(row))}});
  observeAdmissionCorrelation(app.server,correlation);
  const serverId=observeServerIdentity(app.server);
  await app.listen();
  const response=await fetch(`http://127.0.0.1:${app.address().port}/api/state?view=play-v1`,{headers:{Cookie:group.members[0].cookie,[REQUEST_ID_HEADER]:'action:7:request:1'}});
  assert.equal(response.status,200);assert.equal(response.headers.get(SERVER_ID_HEADER),serverId);const value=await response.json();
  assert.equal(value.state.revision,group.revision,'first serving open must not publish a catalogue refresh');
  assert.equal(opens.length,1);assert.equal(opens[0].status,'completed');
  const queued=admissions.find(row=>row.transition==='queued');
  assert.equal(queued.requestId,'action:7:request:1');
  assert.equal(response.headers.get(ADMISSION_ID_HEADER),String(queued.admissionId));
  for(const field of ['datasetVerifyMs','storeHydrateValidateMs','storeMigrateValidateMs','retentionMs','sidecarsMs','fingerprintsMs','rulePrepMs'])assert.equal(typeof opens[0].timingMs[field],'number',field);
  assert.equal(typeof opens[0].memory.after.heapUsed,'number');
});
