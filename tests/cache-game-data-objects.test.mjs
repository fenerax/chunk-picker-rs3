import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObject, describeObject, inventoryObjectParams, morphAlternatives, compareRetainedObjects, joinDoorDiagnostics, writeObjectDataset, openArrayDataset, readObjectRecords } from '../scripts/cache/game-data-objects.mjs';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ControlledDatasetDestination, observeClosed, assertPending } from './helpers/controlled-dataset-destination.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('transition categories preserve open/closed ambiguity and do not imply routes',()=>{
  assert.deepEqual(classifyObject({name:'Acadia tree',actions_0:'Cut down'}),['tree']);
  assert.deepEqual(classifyObject({name:'Iron rock',actions_0:'Mine'}),['mining-resource']);
  assert.ok(classifyObject({name:'Door',actions_0:'Open'}).includes('transition-candidate'));
  assert.deepEqual(classifyObject({name:'Staircase ornament'}),['transition-candidate']);
});

test('resource types distinguish named ore/tree from generic names and keep membership unknown',()=>{
  assert.equal(describeObject({name:'Acadia tree',actions_0:'Cut down'}).tree.type,'acadia');
  assert.equal(describeObject({name:'Iron rock',actions_0:'Mine'}).ore.type,'iron');
  assert.equal(describeObject({name:'Rock',actions_0:'Mine'}).ore.type,null);
  assert.equal(describeObject({name:'Clay',actions_0:'Mine'}).ore.type,'clay');
  assert.equal(describeObject({name:'Rune essence',actions_0:'Mine'}).ore.type,'rune essence');
  assert.equal(describeObject({name:'Bamboo',actions_0:'Cut down'}).tree.type,'bamboo');
  assert.equal(describeObject({name:'Tree',actions_0:'Chop down'}).tree.type,null);
  assert.equal(describeObject({name:'Altar'}).membership.classification,'unknown-without-geographic-and-server-evidence');
  assert.ok(describeObject({name:'Obelisk'}).facilityTypes.includes('obelisk'));
  assert.ok(describeObject({name:'Allotment patch'}).facilityTypes.includes('farming-patch'));
  assert.ok(describeObject({name:'Cooking range'}).facilityTypes.includes('cooking-range'));
  assert.ok(!describeObject({name:'Archery range'}).facilityTypes.includes('cooking-range'));
  assert.ok(describeObject({name:'Campfire',actions_0:'Cook'}).facilityTypes.includes('cooking-fire'));
  assert.ok(!describeObject({name:'Campfire',actions_0:'Add logs'}).facilityTypes.includes('cooking-fire'));
});

test('only typed coordinate/struct params become hints and no destination is certified',()=>{
  const packed=(2<<28)|(3191<<14)|3363,params=new Map([[1,{type:{vartype:22}}],[2,{type:{vartype:73}}],[3,{type:{vartype:0}}]]);
  const defs=new Map([[9,{name:'Door',actions_0:'Open',extra:[{prop:1,intvalue:packed},{prop:2,intvalue:42},{prop:3,intvalue:packed}]}]]);
  const result=inventoryObjectParams(defs,params,id=>({extra:[{prop:1,intvalue:packed}]}));
  assert.equal(result.counts.directCoordinateHints,1);assert.equal(result.counts.structReferences,1);assert.equal(result.counts.certifiedDestinations,0);
  assert.deepEqual(result.records[0].coordinateHints.map(c=>[c.x,c.y,c.plane]),[[3191,3363,2]]);
  assert.equal(result.records[0].structReferences[0].structId,42);
});

test('all encoded morph branches include absent state and recursive selector paths',()=>{
  const definitions=new Map([[1,{morphs_2:{varbit:50,varp:65535,options:[2,65535],default:3,unk2:4}}],[2,{name:'Door',actions_0:'Open'}],[3,{name:'Wall'}],[4,{morphs_1:{varbit:51,varp:65535,options:[2],default:65535}}]]);
  const rows=morphAlternatives(1,definitions);
  assert.equal(rows.filter(r=>r.absentState).length,2);
  assert.ok(rows.some(r=>r.objectId===2&&r.path.length===2&&r.path[1].varbit===51));
  assert.ok(rows.some(r=>r.objectId===3&&r.path[0].option==='encoded-tail'));
  definitions.set(2,{morphs_1:{varbit:52,options:[1],default:65535}});
  assert.ok(morphAlternatives(1,definitions).some(r=>r.problem==='cycle'));
});

test('retained comparison aggregates sections but distinguishes missing layout',()=>{
  const defs=new Map([[1,{name:'Iron rock'}],[2,{name:'New rock'}]]);
  const placements=[{objectId:1,mapId:28,plane:0,x:3200,y:3200,chunkId:'12850'},{objectId:2,mapId:28,plane:0,x:3201,y:3200,chunkId:'12850'}];
  const reference={chunks:{'12850':{Sections:{1:{Object:{'Iron rock':1}},2:{Object:{'Iron rock':2,'Old rock':1},Shop:{'A shop':1}}}},'13000':{Object:{Door:1}}}};
  const result=compareRetainedObjects(placements,defs,reference,new Set(['12850']));
  assert.equal(result.rows.find(r=>r.name==='iron rock').retainedCount,3);
  assert.equal(result.rows.find(r=>r.name==='old rock').classification,'retained-only-candidate');
  assert.equal(result.rows.find(r=>r.name==='door').classification,'unknown-coverage');
  assert.equal(result.nonComparable[0].kind,'Shop');
  assert.equal(result.renameCandidates.length,0);
  assert.ok(result.rows.every(r=>r.verifiedRemoval===false&&r.verifiedAddition===false));
});

test('diagnostics join original source anchors across distant paste and never certify Open',()=>{
  const defs=new Map([[9,{name:'Gate',actions_0:'Open'}]]);
  const joined=joinDoorDiagnostics([{locId:9,x:4000,z:2000,sourceX:1000,sourceZ:9000,type:0,rotation:1}], [{id:'source',objectId:9,x:1000,y:9000,type:0,rotation:1}],defs);
  assert.equal(joined.counts.matched,1);
  assert.equal(joined.rows[0].resolution,'open-close-action-needs-passability-evidence');
  assert.equal(joined.rows[0].passableWhenOpen,null);
  assert.equal(joined.rows[0].apply,false);
});

test('raw plane1 bridge projects into plane0 comparison while bridge-underlay does not',()=>{
  const defs=new Map([[1,{name:'Bridge'}],[2,{name:'Underlay'}]]);
  const base={mapId:28,x:3200,y:3200,chunkId:'12850',transform:{translation:{plane:0}}};
  const rows=[{...base,objectId:1,plane:1,source:{effectivePlane:0}},{...base,objectId:2,plane:0,source:{effectivePlane:-1}}];
  const result=compareRetainedObjects(rows,defs,{chunks:{}},new Set(['12850']));
  assert.deepEqual(result.rows.map(r=>r.name),['bridge']);
});

test('source-plane mismatch is excluded from a diagnostic join',()=>{
  const defs=new Map([[9,{name:'Door',actions_0:'Open'}]]);
  const joined=joinDoorDiagnostics([{locId:9,sourceX:10,sourceZ:20,plane:1,type:0,rotation:1}], [{id:'wrong',objectId:9,x:10,y:20,plane:0,type:0,rotation:1},{id:'right',objectId:9,x:10,y:20,plane:1,type:0,rotation:1}],defs);
  assert.deepEqual(joined.rows[0].matches,['right']);
});

test('streamed gzip reader retains Unicode, nested arrays, escapes and refuses overwrite',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'objects-writer-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const rows=[{name:'雪 🌲 é',extra:{values:['brace }', 'quote "', 'slash \\'],nested:[1,2]}},{id:2,name:'Iron rock'}];
  const file=await writeObjectDataset(dir,'stream.v1.json.gz',{schemaVersion:1,placements:rows,tail:'retained'});
  const read=[];for await(const row of readObjectRecords(join(dir,'stream.v1.json.gz'),'placements'))read.push(row);
  assert.deepEqual(read,rows);assert.equal(file.sha256.length,64);
  await assert.rejects(writeObjectDataset(dir,'stream.v1.json.gz',{placements:[]}),/already exists/);
});

async function controlled(t) {
  const dir=mkdtempSync(join(tmpdir(),'objects-incremental-test-'));
  let destination;
  const writer=await openArrayDataset(dir,'rows.json.gz','placements',{schemaVersion:1},{
    createDestination:(...args)=>(destination=new ControlledDatasetDestination(...args)),
  });
  // On an assertion failure, still release owned resources through their protocol.
  t.after(async()=>{
    // Begin the cleanup join before permitting any delayed open/close. This
    // makes deleting before close an observable contract violation on every run.
    const removed=(async()=>{
      await writer.closed;
      destination.removeDirectory(dir);
    })();
    removed.catch(()=>{});
    if(!destination.closed) {
      const aborted=writer.abort(new Error('test ended'));aborted.catch(()=>{});
      if(!destination.openAcknowledged) (destination.acknowledgeOpen??await destination.opening.next())();
      (destination.acknowledgeClose??await destination.closing.next())();
    }
    await removed;
  });
  return {writer,destination,dir};
}

test('incremental real gzip round trip preserves region batches, Unicode, escapes, row order and count',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'objects-incremental-test-'));
  const writer=await openArrayDataset(dir,'complete.json.gz','placements',{schemaVersion:1});
  t.after(async()=>{await writer.abort().catch(()=>{});await writer.closed;rmSync(dir,{recursive:true});assert.equal(existsSync(dir),false);});
  const rows=Array.from({length:3000},(_,id)=>({id,name:'雪 🌲 é',nested:{value:'{} [ ] " \\ \n'}}));
  for(let region=0;region<3;region++) {
    for(const row of rows.slice(region*1000,(region+1)*1000))await writer.append(row);
    await writer.flush();
  }
  const receipt=await writer.finish({count:rows.length});await writer.completion;await writer.closed;
  const bytes=readFileSync(receipt.path);
  assert.equal(receipt.bytes,bytes.length);assert.equal(receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(JSON.parse(gunzipSync(bytes)),{schemaVersion:1,placements:rows,count:3000});
  const read=[];for await(const row of readObjectRecords(receipt.path,'placements'))read.push(row);
  assert.deepEqual(read,rows);
  await writer.abort(new Error('too late'));
  assert.deepEqual(readFileSync(receipt.path),bytes);
  await assert.rejects(writer.append({id:3000}),/already closed/);
});

test('incremental flush waits for open and destination backpressure acknowledgements',async t=>{
  const {writer,destination}=await controlled(t);
  await writer.append({id:1});
  const flushed=writer.flush();
  await assertPending(flushed);
  (await destination.opening.next())();
  // gzip header, compressed region and the zero-byte destination barrier.
  while(true) {
    const ack=await destination.writing.next();
    await assertPending(flushed);
    const barrier=destination.chunks.at(-1).length===0;
    ack();if(barrier)break;
  }
  await flushed;
  assert.equal(destination.closed,false);
  const aborted=observeClosed(writer.abort(new Error('finished region')),destination);
  (await destination.closing.next())();
  await assert.rejects(aborted,/finished region/);
});

test('incremental cleanup joins an aborted destination that has not opened yet',async t=>{
  // Leave the controlled open unacknowledged. The cleanup owner must abort,
  // acknowledge the late open/destruction, and join close before removing it.
  const {writer,destination}=await controlled(t);
  assert.equal(destination.openAcknowledged,undefined);
  await assertPending(writer.closed);
});

for(const phase of ['before open','during write','during flush']) {
  test(`incremental abort ${phase} joins open, destruction and close before rejecting`,async t=>{
    const {writer,destination}=await controlled(t);
    let pending;
    if(phase!=='before open') {
      (await destination.opening.next())();
      if(phase==='during write') {
        // Deterministic incompressible text exceeds both gzip buffers.
        const text=Array.from({length:20000},(_,i)=>createHash('sha256').update(String(i)).digest('base64')).join('');
        pending=observeClosed(writer.append({text}),destination);
      }else pending=observeClosed(writer.flush(),destination);
      pending.catch(()=>{});
      await destination.writing.next(); // Deliberately withhold this write acknowledgement.
    }
    const error=new Error(`abort ${phase}`);
    const aborted=observeClosed(writer.abort(error),destination);aborted.catch(()=>{});
    const completed=observeClosed(writer.completion,destination);completed.catch(()=>{});
    if(phase==='before open') {
      await assertPending(aborted);
      (await destination.opening.next())();
    }
    const close=await destination.closing.next();
    await assertPending(writer.closed);await assertPending(aborted);
    close();await writer.closed;
    await assert.rejects(aborted,e=>e===error);await assert.rejects(completed,e=>e===error);
    if(pending)await assert.rejects(pending,e=>e===error);
    await assert.rejects(writer.append({id:2}),e=>e===error);
    await assert.rejects(writer.flush(),e=>e===error);
    await assert.rejects(writer.finish(),e=>e===error);
  });
}

test('incremental destination failure mid-write rejects pending and subsequent operations only after close',async t=>{
  const {writer,destination}=await controlled(t);
  (await destination.opening.next())();
  await writer.append({id:1});
  const flushed=observeClosed(writer.flush(),destination);flushed.catch(()=>{});
  (await destination.writing.next())(); // Acknowledge the gzip header first.
  const fail=await destination.writing.next(),error=new Error('destination failure');
  fail(error);
  const close=await destination.closing.next();
  const appended=observeClosed(writer.append({id:2}),destination);appended.catch(()=>{});
  await assertPending(flushed);await assertPending(appended);await assertPending(writer.closed);
  close();await writer.closed;
  await assert.rejects(flushed,e=>e===error);await assert.rejects(appended,e=>e===error);
  await assert.rejects(writer.append({id:3}),e=>e===error);
  await assert.rejects(writer.flush(),e=>e===error);await assert.rejects(writer.finish(),e=>e===error);
  await assert.rejects(writer.completion,e=>e===error);
});

test('incremental finish waits for final flush and close; abort after completion preserves output',async t=>{
  const {writer,destination}=await controlled(t);
  (await destination.opening.next())();await writer.append({id:1});
  const finished=observeClosed(writer.finish({count:1}),destination);finished.catch(()=>{});
  const completed=observeClosed(writer.completion,destination);completed.catch(()=>{});
  const final=await destination.drainUntilFinal();
  await assertPending(finished);await assertPending(completed);
  final();const close=await destination.closing.next();
  await assertPending(finished);await assertPending(completed);await assertPending(writer.closed);
  close();await writer.closed;await completed;
  const receipt=await finished,bytes=readFileSync(receipt.path);
  assert.deepEqual(JSON.parse(gunzipSync(bytes)),{schemaVersion:1,placements:[{id:1}],count:1});
  await writer.abort(new Error('after completion'));
  assert.deepEqual(readFileSync(receipt.path),bytes);
});

test('incremental abort during destination final flush rejects finish only after close',async t=>{
  const {writer,destination}=await controlled(t);
  (await destination.opening.next())();await writer.append({id:1});
  const finished=observeClosed(writer.finish(),destination);finished.catch(()=>{});
  await destination.drainUntilFinal(); // Hold _final rather than a data write.
  const error=new Error('abort final flush'),aborted=observeClosed(writer.abort(error),destination);aborted.catch(()=>{});
  const close=await destination.closing.next();await assertPending(finished);await assertPending(aborted);
  close();await writer.closed;
  await assert.rejects(finished,e=>e===error);await assert.rejects(aborted,e=>e===error);
});

test('incremental writer refuses existing output without acquiring it',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'objects-incremental-test-')),path=join(dir,'owned.json.gz');
  t.after(()=>{rmSync(dir,{recursive:true});assert.equal(existsSync(dir),false);});
  writeFileSync(path,'other owner');
  await assert.rejects(openArrayDataset(dir,'owned.json.gz','placements',{}, {
    createDestination:()=>assert.fail('must not acquire existing output'),
  }),/new filenames/);
  assert.equal(readFileSync(path,'utf8'),'other owner');
});

test('incremental exclusive open refuses a competing owner without overwriting its file',async t=>{
  const {writer,destination}=await controlled(t);
  writeFileSync(destination.path,'competing owner');
  const completed=observeClosed(writer.completion,destination);completed.catch(()=>{});
  (await destination.opening.next())();
  const close=await destination.closing.next();await assertPending(completed);close();
  await writer.closed;await assert.rejects(completed,{code:'EEXIST'});
  assert.equal(readFileSync(destination.path,'utf8'),'competing owner');
  await assert.rejects(writer.append({id:1}),{code:'EEXIST'});
});

test('incremental closed permits immediate directory removal without racing receipt reads',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'objects-incremental-test-'));
  const writer=await openArrayDataset(dir,'rows.json.gz','placements',{schemaVersion:1});
  t.after(async()=>{await writer.abort().catch(()=>{});await writer.closed;if(existsSync(dir))rmSync(dir,{recursive:true});});
  await writer.append({id:1});
  const finished=writer.finish();
  await writer.closed;
  const bytes=readFileSync(join(dir,'rows.json.gz'));
  rmSync(dir,{recursive:true});assert.equal(existsSync(dir),false);
  assert.deepEqual(await finished,{path:join(dir,'rows.json.gz').replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
});
