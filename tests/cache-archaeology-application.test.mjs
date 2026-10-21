import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCacheArchaeology, cacheArchaeologyContentsEnabled } from '../app/data/cache-archaeology.mjs';
import { applyCacheResources } from '../app/data/cache-resources.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { datasetCapabilities } from '../app/datasets.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

const base='12339',outside=`${base}-1000001`,inside=`${base}-1000002`,name='Synthetic remains',key='archaeology:resource:7';
function fixture({retained=true,members=false,component=inside}={}){
  const definitions={chunks:{[base]:{Object:retained?{[name]:9}:{} }},sections:{[base]:{0:[]}},
    walkableChunks:[base],walkableChunksF2P:[base],challenges:{Archaeology:{'Excavate synthetic remains':{Level:1,Objects:[name]}}}};
  const state=createGroupState([{id:'synthetic',name:'Synthetic',unlocked:[base]}]);state.rules['content.f2p']=false;
  const archaeologyCatalogue={coverage:[[base,'decoded']],provenance:{kind:'synthetic'},
    classes:[{key,name,members,level:1,kind:'excavation-hotspot'}],mappings:[{name,classKeys:[key]}],
    placements:[{id:'synthetic:remains',objectId:7,classKey:key,chunkId:base,components:component?[component]:[]}]};
  const options={cacheWalking:true,cacheResources:false,cacheArchaeology:true,archaeologyCatalogue,lodestones:[],metadataCorrections:false};
  return {definitions,state,options,archaeologyCatalogue};
}

test('Archaeology default is off and rollback/no-topology keeps retained counts and grants',()=>{
  assert.equal(datasetCapabilities({}).cacheArchaeology,false);
  assert.equal(datasetCapabilities({RS3_ARCHAEOLOGY_CONTENTS:'game-data'}).cacheArchaeology,true);
  assert.equal(datasetCapabilities({RS3_ARCHAEOLOGY_CONTENTS:'retained'}).cacheArchaeology,false);
  assert.equal(cacheArchaeologyContentsEnabled(),datasetCapabilities(selectedDataset.environment).cacheArchaeology);
  const {definitions,options}=fixture();
  for(const mode of [{cacheArchaeology:false},{cacheWalking:false}]){
    const world=buildWorld(definitions,{...options,...mode});assert.equal(world.cacheArchaeology,undefined);
    assert.equal(world.resourceContents.get(base).Object[name],9);
  }
});

test('closed-door retained source survives confirmation; cache-only indoor source needs exact component',()=>{
  const known=fixture(),index=buildAccessIndex(known.definitions,known.options),access=calculateAccess(index,known.state,'synthetic');
  assert(access.objects.has(name));assert(access.components.has(outside));assert(!access.components.has(inside));
  assert.deepEqual(access.locations.get(`Object:${name}`),[base]);assert.equal(index.world.resourceContents.get(base).Object[name],1);
  const unknown=fixture({retained:false}),other=buildAccessIndex(unknown.definitions,unknown.options);
  assert(!calculateAccess(other,unknown.state,'synthetic').objects.has(name));
  unknown.state.members[0].sectionOverrides={[inside]:true};assert(calculateAccess(other,unknown.state,'synthetic').objects.has(name));
});

test('section alternatives preserve separate gates, source blocking and backlog',()=>{
  const {definitions,state,options}=fixture();
  definitions.chunks[base]={Sections:{1:{Object:{[name]:2}},2:{Object:{[name]:3}}}};
  definitions.sections[base]={1:[],2:[]};definitions.taskUnlocks={Objects:{[name]:{[base+'-1']:false,[base+'-2']:true}}};
  state.members[0].sectionOverrides={[base+'-1']:true,[base+'-2']:true,[inside]:false};
  const index=buildAccessIndex(definitions,options);let access=calculateAccess(index,state,'synthetic');
  assert(access.objects.has(name));assert.deepEqual(access.locations.get(`Object:${name}`),[base+'-2']);
  state.members[0].sourceBacklogs={objects:{[name]:true}};assert(!calculateAccess(index,state,'synthetic').objects.has(name));
  state.members[0].sourceBacklogs={};state.members[0].sectionOverrides[base+'-2']=false;
  assert(!calculateAccess(index,state,'synthetic').objects.has(name));
});

test('F2P component routes require reviewed false membership; members/unknown fail closed',()=>{
  for(const membership of [false,true,null]){
    const {definitions,state,options}=fixture({retained:false,members:membership,component:outside});state.rules['content.f2p']=true;
    assert.equal(calculateAccess(buildAccessIndex(definitions,options),state,'synthetic').objects.has(name),membership===false);
  }
  for(const membership of [false,true,null]){
    const retained=fixture({members:membership});retained.state.rules['content.f2p']=true;
    const index=buildAccessIndex(retained.definitions,retained.options);
    const free=calculateAccess(index,retained.state,'synthetic');
    assert.equal(free.objects.has(name),membership!==true,
      'A retained route preserves unknown/free resources but cannot waive explicit membership.');
    retained.state.members[0].sectionOverrides={[inside]:true};
    assert.equal(calculateAccess(index,retained.state,'synthetic').objects.has(name),membership!==true,
      'A saved component grant cannot waive explicit resource membership.');
    retained.state.rules['content.f2p']=false;
    assert(calculateAccess(index,retained.state,'synthetic').objects.has(name));
  }
});

test('unwitnessed archaeology cannot supersede or add a selector',()=>{
  const {definitions,options}=fixture({component:null}),world=buildWorld(definitions,options);
  assert.equal(world.resourceContents.get(base).Object[name],9);assert.equal(world.cacheArchaeology.summary.attachedPlacements,0);
  assert.equal(world.cacheArchaeology.byChunk.size,0);
});

test('resource projection composes without reviving superseded trees or losing their provenance',()=>{
  const {definitions,archaeologyCatalogue}=fixture();definitions.chunks[base].Object['Yew tree']=8;
  const world={chunks:new Map([[base,{}]]),cacheWalking:{components:new Map([[outside,{}],[inside,{}]]),legacyToComponents:new Map()}};
  const resourceCatalogue={coverage:[[base,'decoded']],classes:[{key:'tree:yew',name:'Yew tree'}],
    placements:[{id:'synthetic:tree',objectId:9,classKey:'tree:yew',chunkId:base,components:[outside]}]};
  applyCacheResources(world,definitions,{enabled:true,resourceCatalogue,resourceSelectors:{mappings:[{name:'Yew tree',classKeys:['tree:yew']}]}});
  applyCacheArchaeology(world,definitions,{enabled:true,archaeologyCatalogue});
  assert.equal(world.resourceContents.get(base).Object['Yew tree'],1);
  assert.equal(world.resourceContents.get(base).ObjectProvenance['Yew tree'].source,'game-data');
  assert.equal(world.cacheArchaeology.retainedNodes.get(base).Object['Yew tree'],undefined);
  assert.equal(world.cacheArchaeology.retainedNodes.get(base).Object[name],undefined);
  assert(world.cacheResources.superseded.get(base).has('Yew tree'));assert(world.cacheArchaeology.superseded.get(base).has(name));
});
