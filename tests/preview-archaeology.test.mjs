import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGroupState } from '../app/core/state.mjs';
import { buildArchaeologyPreview } from '../scripts/preview-archaeology.mjs';

const base='12339',name='Synthetic remains',key='archaeology:resource:7',inside=`${base}-1000002`;
function fixture({retained=true}={}){
  const definitions={chunks:{[base]:{Nickname:'Synthetic archaeology fixture',Object:retained?{[name]:9}:{}}},
    sections:{[base]:{0:[]}},walkableChunks:[base],walkableChunksF2P:[base],
    challenges:{Archaeology:{'Excavate synthetic remains':{Level:1,Objects:[name]}}}};
  const state=createGroupState([{id:'synthetic',name:'Synthetic',unlocked:[base]}]);state.rules['content.f2p']=false;
  const archaeologyCatalogue={coverage:[[base,'decoded']],classes:[{key,name,members:false,level:1}],mappings:[{name,classKeys:[key]}],
    placements:[{id:'synthetic:remains',objectId:7,classKey:key,chunkId:base,components:[inside]}],summary:{kind:'synthetic'}};
  return {definitions,state,options:{archaeologyCatalogue,cacheResources:false,metadataCorrections:false,reviewedOverlays:false,lodestones:[]}};
}

test('retained confirmation preview preserves task sources behind a door and reports quantity reclassification',()=>{
  const {definitions,state,options}=fixture(),bytes=JSON.stringify(state);
  const report=buildArchaeologyPreview(definitions,state,options),member=report.members[0];
  assert.equal(JSON.stringify(state),bytes);assert.equal(member.counts.lostSourceChunks,0);assert.equal(member.counts.availabilityLosses,0);
  assert.equal(member.counts.beforeAvailable,member.counts.afterAvailable);
  assert(member.chunks[0].reclassified.some(row=>row.label===name));assert(member.chunks[0].changed.some(row=>row.label===name));
});

test('cache-only closed-door contents and selected/pending declarations grant no task access',()=>{
  const {definitions,state,options}=fixture({retained:false});
  let report=buildArchaeologyPreview(definitions,state,options);assert.equal(report.members[0].counts.availabilityGains,0);
  assert(report.members[0].chunks[0].added.some(row=>row.label===name));
  state.members[0].unlocked=[];state.members[0].selected=[base];state.members[0].pendingRoll=['13365'];
  state.members[0].sectionOverrides={[inside]:true};
  report=buildArchaeologyPreview(definitions,state,options);assert.equal(report.members[0].counts.availabilityGains,0);
  assert.deepEqual(report.members[0].chunks.find(row=>row.id===base).scopes,['selected']);
});

test('disabling walking in a synthetic fixture makes archaeology preview a reversible no-op',()=>{
  const {definitions,state,options}=fixture();const report=buildArchaeologyPreview(definitions,state,{...options,cacheWalking:false});
  assert.equal(report.members[0].tasks.length,0);for(const field of ['added','removed','changed','reclassified'])assert.equal(report.members[0].chunks[0][field].length,0);
});

test('explicit copied-state CLI holds normal resource/metadata settings and leaves synthetic input inventory unchanged',async t=>{
  const parent=resolve(import.meta.dirname,'../.local/archaeology-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(join(parent,'fixture-'));assert(directory.startsWith(parent));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const state=createGroupState([{id:'synthetic',name:'Synthetic',unlocked:['13365'],selected:['13361'],pendingRoll:['13362']}]);
  const file=join(directory,'state.json'),bytes=Buffer.from(JSON.stringify(state));await writeFile(file,bytes);
  const inventory=await readdir(directory),run=spawnSync(process.execPath,['scripts/preview-archaeology.mjs','--state',file,'--json'],
    {cwd:resolve(import.meta.dirname,'..'),encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,RS3_ARCHAEOLOGY_CONTENTS:'retained',RS3_RESOURCE_CONTENTS:'game-data'}});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);
  assert.equal(report.cacheResources,true);assert.equal(report.metadataCorrections,true);
  assert.equal(report.beforeCacheArchaeology,false);assert.equal(report.afterCacheArchaeology,true);
  assert.deepEqual(await readFile(file),bytes);assert.deepEqual(await readdir(directory),inventory);
});
