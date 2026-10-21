import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { resourceClasses, resolveResourceDefinition, componentMasks, resourceWitness, buildSelectors, placementColumns, effectiveDisplayPlane, recoverSourceOrdinal } from '../scripts/cache/resource-catalogue.mjs';
import { readPlacementChunks, resourceMaskDefaults, loadResourceMasks, verifyResourceMaskManifest, validateResourceMaskCoverage } from '../scripts/build-resource-catalogue.mjs';

const loadJson=path=>JSON.parse(readFileSync(path));
const corrections=loadJson(new URL('../app/data/cache-surface-corrections.2026-10-08.v1.json',import.meta.url));
let pinnedMasks;
// The builder's authorized game-data root; absent without the local game cache, so the mask tests skip.
const gameDataRoot=resourceMaskDefaults.path.slice(0,resourceMaskDefaults.path.indexOf('/walkability-masks'));
const maskContext=()=>({objectManifest:loadJson(`${gameDataRoot}/objects-2026-10-08-v3/objects.manifest.v1.json`),walk:loadJson(new URL('../app/data/cache-walkability.2026-10-07.v1.json',import.meta.url)),evidence:loadJson(new URL('../app/data/cache-selector-evidence.2026-10-07.v1.json',import.meta.url)),corrections});
const fullMasks=()=>pinnedMasks??=loadResourceMasks(maskContext());

test('classification needs relevant actions and keeps generic materials untyped',()=>{
  assert.deepEqual(resourceClasses({name:'Tree',actions_0:'Chop down'}),['tree:unknown:tree']);
  assert.deepEqual(resourceClasses({name:'Rocks',actions_0:'Mine'}),['ore:unknown:rocks']);
  assert.deepEqual(resourceClasses({name:'Acadia tree',actions_0:'Cut down'}),['tree:acadia']);
  assert.deepEqual(resourceClasses({name:'Iron rock',actions_0:'Mine'}),['ore:iron']);
  for(const name of ['Bank booth','Furnace','Anvil','Altar','Fire','Sink','Workbench'])assert.deepEqual(resourceClasses({name}),[]);
  assert.deepEqual(resourceClasses({name:'Furnace',actions_0:'Search'}),[]);
  assert.deepEqual(resourceClasses({name:'Broken furnace',actions_0:'Search'}),[]);
  assert.deepEqual(resourceClasses({name:'Archery range',actions_0:'Shoot'}),[]);
  assert.deepEqual(resourceClasses({name:'Harmony pillar (Hunter)',actions_0:'Inspect'}),[]);
  assert.deepEqual(resourceClasses({name:'Divine light animica rock',actions_0:'Mine'}),[]);
  assert.deepEqual(resourceClasses({name:'Portable bank deposit box',actions_0:'Deposit'}),[]);
  assert.equal(resolveResourceDefinition(3,new Map([[3,{name:'Temporary bank chest',actions_0:'Bank'}]])).policy,'dynamic-template-review');
});

test('facility semantics separate bank types, deposits, altars and static fishing',()=>{
  assert.deepEqual(resourceClasses({name:'Bank booth',actions_0:'Bank'}),['facility:bank-booth']);
  assert.deepEqual(resourceClasses({name:'Bank chest',actions_0:'Use'}),['facility:bank-chest']);
  assert.deepEqual(resourceClasses({name:'Bank deposit box',actions_0:'Deposit'}),['facility:deposit-box']);
  assert.deepEqual(resourceClasses({name:'Air altar',actions_0:'Craft runes'}),['runecrafting:air']);
  assert.deepEqual(resourceClasses({name:'Altar',actions_0:'Pray-at'}),['facility:altar']);
  assert.deepEqual(resourceClasses({name:'Fishing spot',actions_0:'Net'}),['facility:static-fishing:fishing-spot']);
  assert.deepEqual(resourceClasses({name:'Fishing spot'}),[]);
});

test('morph resources require all present leaves of same class and footprint',()=>{
  const defs=new Map([[1,{morphs_1:{varbit:7,varp:65535,options:[2],default:3}}],[2,{name:'Oak',actions_0:'Chop down',width:2}],[3,{name:'Oak tree',actions_0:'Cut down',width:2}]]);
  const same=resolveResourceDefinition(1,defs);
  assert.equal(same.policy,'all-present-leaves-same-resource-and-footprint');assert.deepEqual(same.classKeys,['tree:oak']);
  defs.get(1).morphs_1.default=65535;
  assert.equal(resolveResourceDefinition(1,defs).policy,'conditional-review');
  defs.get(1).morphs_1.default=3;defs.get(3).width=3;
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  defs.get(3).width=2;defs.get(3).name='Willow';
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
});

test('exact masks use source plane and complete rotated cardinal perimeter',()=>{
  const labels=Buffer.alloc(8192),planes=Buffer.alloc(4096);
  const set=(x,y,label,plane=0)=>{labels.writeUInt16LE(label,(x*64+y)*2);planes[x*64+y]=plane;};
  // Object at 2,2 with rotated size 1x2. Both sides remain distinct evidence.
  set(1,2,1);set(3,2,2);set(2,4,2);set(2,1,3,1);
  const regions=componentMasks({regions:[{id:'0',provenance:{sourcePlane:0,destinationPlane:0},masks:{components:labels.toString('base64'),planes:planes.toString('base64')}}]});
  const p={x:2,y:2,chunkId:'0',rotation:1,plane:0,source:{plane:0}};
  const witness=resourceWitness(regions,p,[2,1]);
  assert.deepEqual(witness.components,['0:1','0:2']);assert.equal(witness.method,'decoded-footprint-perimeter');
  assert.ok(!witness.tiles.some(t=>t[1]===1));
  set(2,2,4);const direct=componentMasks({regions:[{id:'0',masks:{components:labels.toString('base64'),planes:planes.toString('base64')}}]});
  assert.deepEqual(resourceWitness(direct,p,[2,1]).components,['0:4']);
  assert.deepEqual(resourceWitness(new Map(),p,[2,1]).components,[]);
});

test('bridge effective plane is distinct from source/raw floor',()=>{
  assert.equal(effectiveDisplayPlane({plane:1,source:{effectivePlane:0},transform:{translation:{plane:0}}}),0);
  assert.equal(effectiveDisplayPlane({plane:0,source:{effectivePlane:1},transform:{translation:{plane:-1}}}),0);
});

test('mandatory full masks retain pinned manifest, membership and decoder identities',{skip:!existsSync(resourceMaskDefaults.path)&&'Pinned copied resource-mask bundle is unavailable at the builder source root'},()=>{
  const {provenance,regions}=fullMasks();
  assert.equal(provenance.sha256,resourceMaskDefaults.walkabilitySha256);
  assert.equal(provenance.manifest.sha256,resourceMaskDefaults.manifestSha256);
  assert.equal(provenance.membership.sha256,resourceMaskDefaults.membershipSha256);
  assert.equal(provenance.decoder.commit,'a92b8920b9b9842adde78822646ecad1a6f4fc15');
  assert.equal(regions.size,2350);
  assert.throws(()=>loadResourceMasks({path:resourceMaskDefaults.path+'.missing'}),/ENOENT/);
  assert.throws(()=>loadResourceMasks({path:new URL('../app/data/cache-selector-evidence.2026-10-07.v1.json',import.meta.url).pathname}),/authorized/);
  assert.throws(()=>verifyResourceMaskManifest({manifestBytes:Buffer.from('{}')}),/manifest hash mismatch/);
  const dir=resourceMaskDefaults.path.slice(0,resourceMaskDefaults.path.lastIndexOf('/')+1);
  const bytes={manifestBytes:readFileSync(dir+'manifest.v1.json'),walkBytes:Buffer.from('corrupt'),membershipBytes:readFileSync(dir+'membership.v1.json')};
  assert.throws(()=>verifyResourceMaskManifest(bytes),/input\/manifest hash mismatch/);
  bytes.walkBytes=readFileSync(resourceMaskDefaults.path);
  const inputs={...bytes,...maskContext()};
  const altered=structuredClone(inputs.objectManifest);altered.decoder.commit='wrong';
  assert.throws(()=>verifyResourceMaskManifest({...inputs,objectManifest:altered}),/decoder identity mismatch/);
  altered.decoder.commit=inputs.objectManifest.decoder.commit;altered.sources.find(s=>s.major===5).sha256='wrong';
  assert.throws(()=>verifyResourceMaskManifest({...inputs,objectManifest:altered}),/source identity mismatch/);
  assert.throws(()=>verifyResourceMaskManifest({...inputs,corrections:{provenance:{walkabilitySha256:'wrong'}}}),/corrections mask hash mismatch/);
  const compact=structuredClone(inputs.walk);compact.provenance.referenceSha256='wrong';
  assert.throws(()=>verifyResourceMaskManifest({...inputs,walk:compact}),/reference identity mismatch/);
});

test('exclusions, translated planes, chunk boundaries and absent masks never invent witnesses',()=>{
  const labels=Buffer.alloc(8192),planes=Buffer.alloc(4096),set=(x,y,label,plane=0)=>{labels.writeUInt16LE(label,(x*64+y)*2);planes[x*64+y]=plane;};
  set(2,2,1);set(1,2,2);set(3,2,3);set(10,10,4);set(4,3,5);
  const make=(id='0',provenance={sourcePlane:2,destinationPlane:0})=>({id,provenance,masks:{components:labels.toString('base64'),planes:planes.toString('base64')}});
  const p={id:'fixture',x:2,y:2,chunkId:'0',rotation:0,plane:0,source:{plane:2}};
  const filtered=componentMasks({regions:[make()]},{nonWalkingComponentIds:['0:1','0:2']});
  const witness=resourceWitness(filtered,p,[1,1]);
  assert.deepEqual(witness.components,['0:3']);assert.deepEqual(witness.excludedComponents,['0:1','0:2']);
  const invalid=componentMasks({regions:[make()]},{invalidRegionIds:['0']});
  assert.deepEqual(resourceWitness(invalid,p,[1,1]).components,[]);
  assert.deepEqual(resourceWitness(filtered,{...p,source:{plane:0}},[1,1]).components,[]);
  // A faraway single component and a diagonal tile are never a perimeter witness.
  assert.deepEqual(resourceWitness(filtered,{...p,x:3,y:3},[1,1]).components,['0:3','0:5']);
  assert.deepEqual(resourceWitness(filtered,{...p,x:8,y:8},[1,1]).components,[]);
  assert.deepEqual(resourceWitness(filtered,{...p,x:5,y:4},[1,1]).components,[]);
  const empty=componentMasks({regions:[]});
  assert.deepEqual(resourceWitness(empty,p,[1,1],new Map([['ignored',{components:['0:1']}]] )).components,[]);
  assert.throws(()=>componentMasks({regions:[{id:'0',masks:{components:labels.toString('base64')}}]}),/Incomplete/);
  assert.throws(()=>resourceWitness(filtered,p,[0,1]),/Invalid decoded/);
  const edge=resourceWitness(filtered,{...p,x:63,y:2},[1,1]);
  assert.equal(edge.outsideBaseTiles,1);assert.deepEqual(edge.components,[]);
  const encoded={...make(),masks:{...make().masks,encoding:'base64',order:'x*64+z',componentType:'uint16-le'},status:'decoded',components:[{label:1,tiles:1}]};
  assert.throws(()=>validateResourceMaskCoverage({regions:[encoded],summary:{crop:{}}},{regions:[['0','decoded',1,[[1,1]]]],summary:{crop:{}}},filtered),/label\/count mismatch/);
});

test('raw source ordinal is recovered by exact identity verification',()=>{
  const prefix=[7,1281,0,2,3,10,1],id=`object-${createHash('sha256').update(JSON.stringify([...prefix,2])).digest('hex').slice(0,24)}`;
  const placement={id:`${id}@28:0:2:3`,objectId:1281,source:{minor:7,plane:0,x:2,y:3},type:10,rotation:1};
  assert.equal(recoverSourceOrdinal(placement),2);
  assert.throws(()=>recoverSourceOrdinal({...placement,rotation:0},3),/cannot be reconstructed/);
});

test('selector aliases keep unmatched children and ambiguous names for review',()=>{
  const reference={chunks:{123:{Object:{'Bank booth':2,'Obelisk':1},Sections:{1:{Object:{'Tree':3}}}}},codeItems:{objectsPlus:{'Bank[+]':['Bank booth','Bank chest','Banker']}},challenges:{Mining:{T:{Objects:['Bank[+]','Rocks']}}}};
  const definitions=[{objectId:1,name:'Bank booth',classKeys:['facility:bank-booth']},{objectId:2,name:'Bank chest',classKeys:['facility:bank-chest']},{objectId:3,name:'Obelisk',classKeys:['facility:teleport-obelisk']},{objectId:4,name:'Obelisk',classKeys:['facility:summoning-obelisk']},{objectId:5,name:'Tree',classKeys:['tree:unknown:tree']}];
  const result=buildSelectors(reference,definitions),alias=result.mappings.find(r=>r.name==='Bank[+]');
  assert.deepEqual(alias.classKeys,['facility:bank-booth','facility:bank-chest']);assert.deepEqual(alias.unmatchedChildren,['Banker']);
  assert.equal(result.unmatched.find(r=>r.name==='Obelisk').reason,'ambiguous-exact-name-classes');
  assert.equal(result.retainedLocations.length,2);
  assert.equal(result.unmatched.find(r=>r.name==='Tree').reason,'generic-resource-type-needs-explicit-evidence');
  assert.deepEqual(buildSelectors(reference,definitions),result);
});

test('reviewed named-material aliases require action-backed typed evidence',()=>{
  const reference={chunks:{1:{Object:{'Yew tree':1,'Iron rocks':2,'Dead tree':2}}}},definitions=[{objectId:1309,name:'Yew',classKeys:['tree:yew']},{objectId:113038,name:'Iron rock',classKeys:['ore:iron']},{objectId:1282,name:'Dead tree',classKeys:['tree:unknown:dead-tree']}];
  const {mappings,unmatched}=buildSelectors(reference,definitions);
  assert.equal(mappings.find(r=>r.name==='Yew tree').method,'reviewed-named-tree-type-alias');
  assert.deepEqual(mappings.find(r=>r.name==='Iron rocks').classKeys,['ore:iron']);
  assert.equal(unmatched.find(r=>r.name==='Dead tree').reason,'generic-resource-type-needs-explicit-evidence');
});

test('bounded placement reader handles split Unicode and escaped delimiter strings',async()=>{
  const rows=[{id:'object-1',name:'Érable',note:'},{"id":"object-in-string',nested:[{objectId:2}]},{id:'object-2',mapId:28}];
  const text=JSON.stringify({schemaVersion:1,placements:rows,summary:{mappedPlacements:2}}),chunks=Array.from({length:Math.ceil(text.length/7)},(_,i)=>text.slice(i*7,i*7+7)),actual=[];
  for await(const row of readPlacementChunks(chunks))actual.push(JSON.parse(row));
  assert.deepEqual(actual,rows);
  const consume=async value=>{for await(const row of readPlacementChunks([value]))JSON.parse(row);};
  await assert.rejects(consume(text.slice(0,-5)),/Truncated/);
  await assert.rejects(consume(text.replace('mappedPlacements":2','mappedPlacements":3')),/count differs/);
});

test('committed catalogue retains provenance, tuple schema and exact witness identity',()=>{
  const bytes=readFileSync(new URL('../app/data/cache-resources.2026-10-08.v1.json',import.meta.url)),data=JSON.parse(bytes);
  const selectors=JSON.parse(readFileSync(new URL('../app/data/cache-resource-selectors.2026-10-08.v1.json',import.meta.url)));
  assert.deepEqual(data.schema.placementColumns,placementColumns);
  assert.equal(selectors.provenance.catalogueSha256,sha256RepositoryText(bytes));
  assert.equal(data.provenance.manifest.sha256,'641043bf628f3d0ef1d9434d9acbe76688a7628015d17e866530ffd435bad99e');
  assert.equal(data.provenance.decoder.commit,'a92b8920b9b9842adde78822646ecad1a6f4fc15');
  assert.equal(data.provenance.decoder.buildSchema,950);
  assert.equal(data.provenance.walkability.masks.sha256,resourceMaskDefaults.walkabilitySha256);
  assert.equal(data.provenance.walkability.masks.manifest.sha256,resourceMaskDefaults.manifestSha256);
  assert.equal(data.provenance.walkability.masks.membership.sha256,resourceMaskDefaults.membershipSha256);
  assert.equal(data.provenance.surfaceCorrections.sha256,sha256RepositoryText(readFileSync(new URL('../app/data/cache-surface-corrections.2026-10-08.v1.json',import.meta.url))));
  for(const [source,key] of [['../scripts/build-resource-catalogue.mjs','generatorSha256'],['../scripts/cache/resource-catalogue.mjs','classificationSha256']])assert.equal(data.provenance[key],sha256RepositoryText(readFileSync(new URL(source,import.meta.url))));
  const ids=new Set(data.definitions.map(d=>d.objectId)),classes=new Set(data.classes.map(c=>c.key)),coverage=new Map(data.coverage);
  assert.equal(data.summary.effectiveSurfacePlacements,629291);
  assert.equal(new Set(data.coverage.map(r=>r[0])).size,2350);
  assert.equal(data.coverage.filter(r=>r[1]==='decoded').length,1211);
  const identity=new Set();
  for(const p of data.placements){assert.equal(p.length,placementColumns.length);assert.ok(ids.has(p[1]));assert.ok(classes.has(p[2]));assert.equal(p[7],0);assert.ok(coverage.has(p[3]));const id=`${p[0]}:${p[2]}`;assert.ok(!identity.has(id));identity.add(id);for(const component of p[9])assert.ok(p[11].some(tile=>tile[2]===component));assert.equal(p[0].split('@')[0],`object-${createHash('sha256').update(JSON.stringify([p[12],p[1],p[15],p[13]%64,p[14]%64,p[16],p[8],p[17]])).digest('hex').slice(0,24)}`);}
  assert.ok(data.review.every(r=>['conditional-review','dynamic-template-review','no-exact-walkable-component','multiple-perimeter-components','excluded-surface-component'].includes(r[5])));
  const regions=existsSync(resourceMaskDefaults.path)?fullMasks().regions:null,definitions=new Map(data.definitions.map(d=>[d.objectId,d])),excluded=new Set(corrections.nonWalkingComponentIds),invalid=new Set(corrections.invalidRegionIds);
  for(const row of data.placements){
    if(regions){const witness=resourceWitness(regions,{id:row[0],chunkId:row[3],x:row[4],y:row[5],plane:row[6],rotation:row[8],source:{plane:row[15]}},definitions.get(row[1]).footprint);
      assert.deepEqual(row[9],witness.components);assert.equal(row[10],witness.method);assert.deepEqual(row[11],witness.tiles);}
    for(const c of row[9]){assert.ok(!excluded.has(c));assert.ok(!invalid.has(c.split(':')[0]));assert.equal(c.split(':')[0],row[3]);}
  }
  assert.equal(data.summary.witnessedPlacements,new Set(data.placements.filter(p=>p[9].length).map(p=>p[0])).size);
  assert.equal(data.summary.witnessedChunks,new Set(data.placements.filter(p=>p[9].length).map(p=>p[3])).size);
  assert.equal(data.summary.excludedReviewPlacements,data.review.filter(p=>p[5]==='excluded-surface-component').length);
  assert.equal(data.summary.unwitnessedPlacements,data.review.filter(p=>p[5]==='no-exact-walkable-component').length);
  assert.equal(data.classes.find(c=>c.key==='ore:light-animica').name,'Light animica rock');
  assert.equal(data.classes.find(c=>c.key==='tree:yew').name,'Yew tree');
  assert.ok(selectors.mappings.find(r=>r.name==='Yew tree').evidenceObjectIds.includes(1309));
  const groups=new Set();let previous=null;
  for(const row of data.placements){const group=`${row[3]}/${row[2]}`;if(previous&&group===`${previous[3]}/${previous[2]}`)assert.ok(row[4]>previous[4]||row[4]===previous[4]&&row[5]>=previous[5]);else{assert.ok(!groups.has(group));groups.add(group);}previous=row;}
});
