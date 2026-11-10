// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserClient, reconnectStream, reconnectDelay } from '../scripts/perf/capacity/client.mjs';
import { prepareCohorts, consumeStream, distribution } from '../scripts/perf/capacity/driver.mjs';
import { beginOpenDiagnostics } from '../app/open-diagnostics.mjs';
import { createPickerAdmission } from '../app/picker-admission.mjs';
import { diagnosticMarkdown } from '../scripts/perf/capacity/report.mjs';
import { fixtureMigration, calibrateIdentities } from '../scripts/perf/capacity/fixture-migration.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { generate } from '../scripts/perf/capacity/fixture.mjs';
import { createServer } from '../app/server.mjs';
import { catalogue, syntheticWorld } from '../scripts/perf/capacity/model.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

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
  const manifest=await generate(profile,directory,{workers:1}),group=manifest.groups[0],opens=[];
  const definitions=catalogue(profile.catalogue);
  app=await createServer({dataDir:path.join(directory,'legacy'),definitions,taskMap:{},world:syntheticWorld(definitions,buildWorld),port:0,predictionPrewarm:false,
    multiPicker:{registryDir:path.join(directory,'registry'),pickerRoot:path.join(directory,'pickers'),tombstoneDir:path.join(directory,'tombstones'),onContextOpen:row=>opens.push(row)}});
  await app.listen();
  const response=await fetch(`http://127.0.0.1:${app.address().port}/api/state?view=play-v1`,{headers:{Cookie:group.members[0].cookie}});
  assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.state.revision,group.revision,'first serving open must not publish a catalogue refresh');
  assert.equal(opens.length,1);assert.equal(opens[0].status,'completed');
  for(const field of ['datasetVerifyMs','storeHydrateValidateMs','storeMigrateValidateMs','retentionMs','sidecarsMs','fingerprintsMs','rulePrepMs'])assert.equal(typeof opens[0].timingMs[field],'number',field);
  assert.equal(typeof opens[0].memory.after.heapUsed,'number');
});
