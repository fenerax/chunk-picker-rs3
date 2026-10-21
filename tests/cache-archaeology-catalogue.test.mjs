import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { cacheArchaeologyCatalogue as catalogue } from '../app/data/cache-archaeology.mjs';
import { resolveArchaeologyDefinition, columnRows, compareArchaeology } from '../scripts/cache/archaeology-catalogue.mjs';
import { archaeologyCatalogueView } from '../app/core/archaeology.mjs';

test('typed defaults preserve zero and cannot fabricate missing columns',()=>{
  const schemas=new Map([[88,{columndata:[{id:3,columns:[{hasdefault:1,default:0}]}]}]]);
  assert.deepEqual(columnRows({table:88},3,schemas),[[0]]);assert.deepEqual(columnRows({table:88},4,schemas),[]);
});

test('missing/absent and differing morph rows remain reviews, identical present leaves qualify',()=>{
  const definition=(row,name='Synthetic remains')=>({name,actions_0:'Excavate',extra:[{prop:6659,intvalue:row}]});
  const resources=new Map([[7,{}],[8,{}]]),defs=new Map([[1,definition(7)],[2,definition(8)]]);
  assert.deepEqual(resolveArchaeologyDefinition(1,defs,resources).classKeys,['archaeology:resource:7']);
  defs.set(3,{morphs_2:{varbit:1,varp:-1,default:1,unk2:1,options:[1,2]}});
  assert.equal(resolveArchaeologyDefinition(3,defs,resources).classKeys.length,0);
  defs.set(2,definition(7));assert.deepEqual(resolveArchaeologyDefinition(3,defs,resources).classKeys,['archaeology:resource:7']);
  defs.set(2,{...definition(7),width:2});assert.equal(resolveArchaeologyDefinition(3,defs,resources).classKeys.length,0);
  defs.get(3).morphs_2.options=[1,-1];assert.equal(resolveArchaeologyDefinition(3,defs,resources).classKeys.length,0);
  defs.set(4,{name:'Synthetic remains',actions_0:'Excavate'});assert.equal(resolveArchaeologyDefinition(4,defs,resources).classKeys.length,0);
});

test('committed extraction records provenance, complete typed tables and conservative surface membership',()=>{
  assert.equal(catalogue.summary.sites,9);assert.equal(catalogue.summary.resourceRows,149);
  assert.equal(catalogue.summary.artefacts,250);assert.equal(catalogue.summary.archaeologyProductionCandidates,265);
  assert.equal(catalogue.summary.restorations,238);assert.equal(catalogue.summary.collections,78);assert.equal(catalogue.summary.mysteries,52);
  assert.equal(catalogue.summary.distinctDamagedItemIds,248);assert.equal(catalogue.summary.distinctRestoredItemIds,249);
  assert.equal(catalogue.summary.surfacePlacements,87);assert.equal(catalogue.summary.witnessedPlacements,87);
  assert.equal(catalogue.provenance.decoder.commit,'a92b8920b9b9842adde78822646ecad1a6f4fc15');
  assert.equal(catalogue.provenance.builderSha256,sha256RepositoryText(readFileSync(new URL('../scripts/build-archaeology-catalogue.mjs',import.meta.url))));
  assert.equal(catalogue.provenance.extractorSha256,sha256RepositoryText(readFileSync(new URL('../scripts/cache/archaeology-catalogue.mjs',import.meta.url))));
  for(const row of catalogue.placements){assert.equal(row.mapId,28);assert.equal(row.effectivePlane,0);assert(row.components.length);}
  const centurion=catalogue.classes.find(row=>row.name==='Centurion remains');assert.equal(centurion.members,false);
  assert.equal(centurion.cacheMembershipCandidate,true);
  assert.equal(catalogue.classes.find(row=>row.name==='Tunnels barricade').members,true);
  const f2p=archaeologyCatalogueView(catalogue,{f2p:true});assert(f2p.hotspots.every(row=>row.members===false&&row.level<=20));
  assert(!f2p.sites.some(row=>row.name==='Infernal Source'));
});

test('hotspot yields and restoration inputs retain typed identities and encoded quantities',()=>{
  const venator=catalogue.hotspots.find(row=>row.name==='Venator remains');assert.equal(venator.level,5);
  assert.deepEqual(venator.materialYields.map(row=>[row.item.id,row.encodedWeight]),[[49460,5000],[49514,5000]]);
  assert.deepEqual(venator.artefactYields.map(row=>row.damaged.id),[49921,49923]);
  const restoration=catalogue.restorations.find(row=>row.product.id===49922);
  assert.deepEqual(restoration.directInputs.map(row=>[row.item.id,row.encodedQuantity]),[[49921,1],[49460,16],[49514,12]]);
  assert.equal(restoration.xp,null,'Uncalibrated action XP never becomes executable throughput.');
  assert.equal(catalogue.collections.find(row=>row.rowId===2684).minimumRestorationLevel,25);
  assert.equal(catalogue.mysteries.find(row=>row.name==='Breaking the Seal').wikiRequirement.level,12);
});

test('tool method levels do not become false hotspot corrections',()=>{
  const result={hotspots:[{rowId:7,name:'Centurion remains',level:1}],restorations:[]};
  const comparison=compareArchaeology({challenges:{Archaeology:{'Excavate with a synthetic tool':{Objects:['Centurion remains'],Level:31}}}},result,[],[]);
  assert.equal(comparison.levelReviews,0);assert.equal(comparison.taskRows[0].levelStatus,'tool-method-facility-only');
});
