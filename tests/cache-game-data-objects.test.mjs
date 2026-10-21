import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObject, describeObject, inventoryObjectParams, morphAlternatives, compareRetainedObjects, joinDoorDiagnostics, writeObjectDataset, openArrayDataset, readObjectRecords } from '../scripts/cache/game-data-objects.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
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
  const rows=[{name:'Player 1',extra:{values:['brace }', 'quote "', 'slash \\'],nested:[1,2]}},{id:2,name:'Iron rock'}];
  const file=await writeObjectDataset(dir,'stream.v1.json.gz',{schemaVersion:1,placements:rows,tail:'retained'});
  const read=[];for await(const row of readObjectRecords(join(dir,'stream.v1.json.gz'),'placements'))read.push(row);
  assert.deepEqual(read,rows);assert.equal(file.sha256.length,64);
  await assert.rejects(writeObjectDataset(dir,'stream.v1.json.gz',{placements:[]}),/already exists/);
});

test('incremental writer flushes region batches and rejects writes after destination failure',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'objects-incremental-test-')),writer=await openArrayDataset(dir,'complete.v1.json.gz','placements',{schemaVersion:1});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(let i=0;i<3000;i++)await writer.append({id:i,name:'Player 1',nested:{value:'{} [ ] " \\'}});
  await writer.flush();await writer.finish({count:3000});let count=0;for await(const row of readObjectRecords(join(dir,'complete.v1.json.gz'),'placements')){assert.equal(row.id,count++);assert.equal(row.name,'Player 1');}assert.equal(count,3000);
  const broken=await openArrayDataset(dir,'broken.v1.json.gz','placements',{schemaVersion:1});broken.abort(new Error('destination failure'));
  await new Promise(r=>setImmediate(r));await assert.rejects(broken.append({id:1}),/destination failure/);await assert.rejects(broken.flush(),/destination failure/);
});
