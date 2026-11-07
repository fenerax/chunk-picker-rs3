// Owned releases/stores; acknowledged native startup and controlled stage faults.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { bindingBytes, checkPackTransition, assertStableIdentities, assertPreserved, saveIdentity, runProbe } from '../scripts/private-companion/release-pack-check.mjs';
import { digestValue, writeSuccessReceipt } from '../scripts/private-companion/release-identity.mjs';
import { gateContract, lookupEvidence, verifyLocalEvidence } from '../scripts/private-companion/release-evidence.mjs';
import { packedFixture, fixture, put, hash } from './helpers/release-pack-fixture.mjs';
import { stageCases, assertStageRecovery } from './helpers/release-pack-stages.mjs';
import { assertNativePackedStartup } from './helpers/release-pack-native.mjs';

// Register the owner join before any fixture cleanup. Even a failed test
// deadline cannot remove a store while its startup/probe operation is alive.
const owned = body => async t => {
  let finish;
  const closed = new Promise(resolve => { finish=resolve; });
  t.after(()=>closed);
  try { return await body(t); } finally { finish(); }
};

for(const rollback of [false,true]) for(const {point,crash} of stageCases) {
  if(point.startsWith('pending-')&&!rollback) continue;
  test(`${rollback?'rollback':'upgrade'} ${crash?'process-exit':'interruption'} ${point}: reconcile under ownership, preserve current save`,
    {skip:process.platform!=='win32',timeout:30000},owned(t=>assertStageRecovery(t,{rollback,point,crash})));
}

test('compatibility uses separate packed startup processes, checks latest save both ways and refuses changed identity/binding', {timeout:30000},owned(async t=>{
  const forward=await packedFixture(t);
  const output=path.join(forward.root,'compatibility.json');
  const check=async(f,extra={})=>{
    const binding=await readFile(f.data+'.dataset.json');
    try { return await checkPackTransition({fromConfig:f.configs[0],toConfig:f.configs[1],transition:f.plan,...extra}); }
    finally { assert.deepEqual(await readFile(f.data+'.dataset.json'),binding,'compatibility changed the source binding'); }
  };
  const result=await check(forward,{output});
  assert.equal(result.bothDirections,true);
  assert.equal(result.forwardAfterRollback,true);
  assert.equal(result.progressPreserved,true);
  assert.equal(result.tasksServed,true);
  assert.equal(result.probes.length,4); // old → new → old → new
  assert.deepEqual([result.old,result.new],forward.descriptors);
  assert.equal(result.saveDigest,digestValue(await saveIdentity(forward.data)));
  const startup=(await readFile(path.join(forward.root,'startups.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const spawned=startup.filter(row=>row.phase==='spawned');
  assert.deepEqual(spawned.map(row=>row.pack),['old','new','old','new']);
  assert.equal(new Set(spawned.map(row=>row.pid)).size,4);
  for(const {pid,revision} of spawned){
    assert.equal(revision,9);
    assert.deepEqual(startup.filter(row=>row.pid===pid).map(row=>row.phase),['spawned','ready','probe','closed']);
  }
  const receipt=await readFile(output);
  // Never accept/overwrite a previous observation at an output evidence path.
  await assert.rejects(check(forward,{output}),{code:'EEXIST'});
  assert.deepEqual(await readFile(output),receipt);
  // Timestamp freshness is a separate gate from immutable output ownership.
  // Author a valid, exact-key success receipt with a deliberately old timestamp.
  const evidenceRoot=await fixture(t),contract=gateContract('public',{pack:forward.descriptors[0].digest},{digest:'a'.repeat(64)});
  const filename=path.join(evidenceRoot,contract.lane+'-'+contract.key+'.json');
  const record=await writeSuccessReceipt(filename,{key:contract.key,inputDigest:contract.inputDigest,executionDigest:contract.executionDigest,
    startedAt:'2000-01-01T00:00:00.000Z',completedAt:'2000-01-01T00:00:01.000Z',exitCode:0,cleanupVerified:true});
  await put(filename+'.identity.json',contract);
  assert.equal(await lookupEvidence(evidenceRoot,contract),null,'stale success cannot authorize an upgrade');
  await assert.rejects(verifyLocalEvidence({filename,record,contract},contract),/stale/);

  const rollback=await packedFixture(t,{failNew:true});
  const reverse=await check(rollback,{fromConfig:rollback.configs[1],toConfig:rollback.configs[0]});
  assert.equal(reverse.rollbackTargetOpened,true);
  assert.equal(reverse.probes.length,1); // retained old opens latest save even if new cannot start

  const mismatch=await packedFixture(t);
  const foreign={...mismatch.plan.new,digest:'3'.repeat(64)},foreignBytes=bindingBytes(foreign);
  foreign.bindingSha256=hash(foreignBytes);
  await assert.rejects(check(mismatch,{transition:{...mismatch.plan,new:foreign,newBindingBase64:foreignBytes.toString('base64')}}),/descriptor/);
  const binding=await packedFixture(t);
  await put(binding.data+'.dataset.json','unknown binding');
  await assert.rejects(check(binding),/binding differs/);
  const identities=await packedFixture(t,{changedIdentity:true});
  await assert.rejects(check(identities),/identities/);

  const latest=await packedFixture(t,{incompatible:true});
  await assert.rejects(check(latest),error=>{
    assert.match(error.message,/incompatible latest save revision 10/);
    assert.match(error.message,/INCOMPATIBLE_SAVE/);
    assert.match(error.message,/"exitCode":1/);
    assert.match(error.message,/"signal":null/);
    assert.match(error.message,/stderrTail/);
    return true;
  });
  // A second direction must also open the actual latest source, not a cached
  // forward observation. New code is deliberately unable to start here.
  const latestReverse=await packedFixture(t,{incompatible:true,failNew:true});
  await assert.rejects(check(latestReverse,{fromConfig:latestReverse.configs[1],toConfig:latestReverse.configs[0]}),/INCOMPATIBLE_SAVE/);
  assert.throws(()=>assertStableIdentities({authored:{id:1},saved:{}},{authored:{id:2},saved:{}}),/identities/);
}));

for(const target of ['old','new']) test(`owned synthetic ${target} pack opens the latest save through the actual server, store and process workers`,
  {timeout:30000},owned(t=>assertNativePackedStartup(t,target)));

test('packed child completion joins stream close and retains original failures after exit', owned(async t=>{
  const root=await fixture(t),output=path.join(root,'probe.json');
  await put(output,{synthetic:'report'});
  const config={nodePath:process.execPath,packsDir:root,coreRoot:root,selection:{path:'synthetic'},profile:{path:'synthetic',sha256:'synthetic'},addons:{path:'',sha256:''}};
  const child=()=>Object.assign(new EventEmitter(),{stderr:new PassThrough(),send(message,callback){assert.deepEqual(message,{type:'probe'});callback();},kill(){throw Error('unexpected kill')}});
  const success=child();
  let readStarted=false;
  const pending=runProbe(config,root,output,{spawnImpl:()=>success,readReport:()=>{readStarted=true;return {synthetic:'report'};}});
  success.emit('message',{type:'ready'});success.emit('message',{type:'probe'});success.emit('message',{type:'closed'});
  success.emit('exit',0,null);
  await setImmediate(); // controlled event ordering, not an assertion-condition wait
  assert.equal(readStarted,false,'exit must not release the store or read the report');
  success.emit('close',0,null);
  assert.deepEqual(await pending,{synthetic:'report'});
  for(const [code,signal,original]of [[7,null,undefined],[null,'SIGTERM',undefined],[-2,null,Object.assign(Error('original spawn refusal'),{code:'ENOENT'})]]){
    const failure=child();
    const refused=assert.rejects(runProbe(config,root,output,{spawnImpl:()=>failure}),error=>{
      assert.ok(error.message.includes('"exitCode":'+JSON.stringify(code)));
      assert.ok(error.message.includes('"signal":'+JSON.stringify(signal)));
      assert.match(error.message,/before exit; original stderr after exit/);
      if(original){assert.equal(error.cause,original);assert.match(error.message,/original spawn refusal/);assert.match(error.message,/ENOENT/);}
      return true;
    });
    failure.stderr.write('before exit; ');
    if(original)failure.emit('error',original);
    failure.emit('exit',code,signal);
    failure.stderr.end('original stderr after exit');
    failure.emit('close',code,signal);
    await refused;
  }
}));

test('declared saved identity additions are exact and newly dataset-authored', () => {
  const resolution = id => ({status:'resolved',id,candidates:[id]});
  const a = {authored:{ids:['old'],aliases:{}}, saved:{old:resolution('old')}, datasetAuthored:{old:'old'}};
  const b = {...a,saved:{...a.saved,new:resolution('new'),alias:resolution('new')},datasetAuthored:{old:'old',new:'new',alias:'new'}};
  const additions = [{key:'new',target:'new'},{key:'alias',target:'new'}];
  assert.doesNotThrow(()=>assertStableIdentities(a,b,additions));
  assert.throws(()=>assertStableIdentities(a,b),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,extra:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{old:a.saved.old,new:b.saved.new}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,old:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{new:b.saved.new,alias:b.saved.alias}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,authored:{ids:['changed'],aliases:{}}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,b,[...additions,additions[0]]),/addition/);
  assert.throws(()=>assertStableIdentities(a,{...b,datasetAuthored:a.datasetAuthored},additions),/addition/);
  assert.throws(()=>assertStableIdentities({...a,datasetAuthored:b.datasetAuthored},b,additions),/addition/);
  const authored={ids:['old','new'],aliases:{}};
  assert.throws(()=>assertStableIdentities({...a,authored},{...b,authored},additions),/addition/);
});

test('saved progress preservation allows only appended catalogue bookkeeping and retains every existing event', () => {
  const a={taskIds:['kept'],progressDigest:'same',progressFields:{members:'same'},historyEvents:['old'],historyTypes:['command'],migrationArchives:['archive'],migrationConversions:[],migrationConflicts:[]};
  const b={...a,taskIds:['kept','new'],historyEvents:['old','refresh'],historyTypes:['command','catalogue-refresh'],migrationArchives:['archive','new-archive']};
  assert.doesNotThrow(()=>assertPreserved(a,b));
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['changed','refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyTypes:['command','command']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,migrationArchives:[]}),/archive/);
  assert.throws(()=>assertPreserved(a,{...b,taskIds:['new']}),/progress/);
  assert.throws(()=>assertPreserved(a,{...b,progressDigest:'changed',progressFields:{members:'changed'}}),/progress/);
});

test('daily progress counts may recount only the latest day or start a new one; past days and real progress stay exact', () => {
  const history={historyEvents:[],historyTypes:[],migrationArchives:[],migrationConversions:[],migrationConflicts:[],taskIds:['kept']};
  const report=(rows,{members='same',meta='meta'}={})=>({...history,progressSnapshotRows:rows,progressSnapshotMeta:meta,
    progressDigest:'whole-'+JSON.stringify(rows)+members,progressFields:{members,progressSnapshots:'days-'+JSON.stringify(rows)}});
  const a=report([[100,'d100'],[101,'d101']]);
  assert.doesNotThrow(()=>assertPreserved(a,report([[100,'d100'],[101,'recounted']])));
  assert.doesNotThrow(()=>assertPreserved(a,report([[100,'d100'],[101,'d101'],[102,'d102']])));
  assert.doesNotThrow(()=>assertPreserved(report([],{meta:null}),report([[101,'d101']])));
  assert.throws(()=>assertPreserved(a,report([[100,'changed'],[101,'d101']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[101,'d101']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'d101'],[99,'d99']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'d101']],{meta:'other roster'})),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'recounted']],{members:'changed'})),/fields=members/);
  // Older reports without day rows keep the whole-progress comparison.
  const {progressSnapshotRows,progressSnapshotMeta,...legacy}=a;
  assert.throws(()=>assertPreserved(legacy,{...legacy,progressDigest:'changed',progressFields:{...legacy.progressFields,progressSnapshots:'changed'}}),/progressSnapshots/);
});
