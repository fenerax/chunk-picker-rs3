import { datasetSourceEvidence } from './helpers/dataset-source-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { equipmentPermanence, equipmentPermanenceEvidence, getEquipmentPermanence, isNonPermanentEquipment } from '../app/data/equipment-permanence.mjs';
import { classifyEquipmentPermanence, traceDegradation, permanenceKinds } from '../scripts/research/build-equipment-permanence.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const wikiPage = (name, content) => ({title:name,revisions:[{revid:42,timestamp:'2026-10-08T00:00:00Z',slots:{main:{content}}}]});
const cacheItem = (id,name,params=[],equipmentCandidate=true) => ({id,name,equipmentCandidate,params:params.map(([prop,intvalue])=>({prop,intvalue,stringvalue:null}))});

test('versioned permanence evidence covers every equipment identity exactly once', async () => {
  const definitions=JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url)));
  assert.deepEqual(Object.keys(equipmentPermanence),Object.keys(definitions.equipment));
  assert.equal(equipmentPermanenceEvidence.counts.total,3550);
  for(const [name,row] of Object.entries(equipmentPermanence)) {
    assert.equal(typeof row.permanent,'boolean',name);
    assert.equal(row.kind===null,row.permanent,name);
    assert.ok(row.permanent || permanenceKinds.includes(row.kind),name);
    if(row.evidence.wiki) {
      assert.ok(equipmentPermanenceEvidence.sources[row.evidence.wiki.revisionId],name);
      for(const revisionId of row.evidence.wiki.supportingRevisions) assert.ok(equipmentPermanenceEvidence.sources[revisionId],name);
    } else assert.equal(row.ammunitionExcluded,true,name);
    assert.ok(row.permanent || row.evidence.wiki,name);
  }
  const recomputed={permanent:0,dust:0,'charges-vanish':0,temporary:0,'use-destruction':0};
  for(const row of Object.values(equipmentPermanence)) recomputed[row.kind??'permanent']++;
  for(const [key,value] of Object.entries(recomputed)) assert.equal(equipmentPermanenceEvidence.counts[key],value,key);
});

test('loss classifications include cache timed/charge loss and transcluded Wiki exceptions', () => {
  for(const name of ['Corrupt dragon spear','Corrupt dragon helm','Sirenic mask','Tectonic robe top','Dragon slayer gloves','Ring of retribution','Goliath gloves (black)','Swift gloves (yellow)','Spellcaster gloves (red)','Superior scrimshaw of sacrifice']) {
    assert.equal(getEquipmentPermanence(name).kind,'dust',name);
    assert.equal(isNonPermanentEquipment(name),true,name);
  }
  assert.equal(getEquipmentPermanence('Ferocious ring').kind,'charges-vanish');
  assert.equal(getEquipmentPermanence('Hand cannon').kind,'use-destruction');
  for(const name of ['Wooden sword',"War's javelin",'Vial of bile','Smouldering lavender','Academy platebody','Air staff (Dominion Tower)']) assert.equal(getEquipmentPermanence(name).kind,'temporary',name);
  assert.ok(getEquipmentPermanence('Goliath gloves (black)').evidence.wiki.supportingRevisions.includes(37031572));
});

test('retained broken/rechargeable equipment stays permanent despite charge counts and historical dust', () => {
  for(const name of ['Chaotic maul','Crystal bow','Amulet of the forsaken','Amulet of souls','Deathtouch bracelet','Elite sirenic mask','Elite tectonic robe top','Superior leviathan ring','Superior reefwalker\'s cape','Ferocious ring (c)','Refined anima core body of Seren','TokKul-Zo','Sacred clay scimitar','Volatile clay hatchet','Underworld Grimoire 4','Malevolent kiteshield']) {
    assert.equal(isNonPermanentEquipment(name),false,name);
    assert.equal(getEquipmentPermanence(name).permanent,true,name);
  }
  assert.ok(getEquipmentPermanence('Ferocious ring (c)').evidence.wiki.supportingRevisions.includes(36916492));
});

test('ammunition ordinary consumption is excluded but event javelin area restriction is classified', () => {
  for(const name of ['Rune arrow','Deathtouched dart','Superior Morrigan\'s javelin','Black chinchompa','Academy knife','Havensilver bolts + 1']) {
    const row=getEquipmentPermanence(name);
    assert.equal(row.ammunitionExcluded,true,name);
    assert.equal(row.permanent,true,name);
  }
  assert.equal(getEquipmentPermanence("War's javelin").ammunitionExcluded,false);
});

test('identity guard protects custom records without requiring cache ids for retained names', () => {
  const name='Corrupt dragon spear',row=getEquipmentPermanence(name);
  assert.ok(row.cacheIds.length);
  assert.equal(isNonPermanentEquipment(name,{}),true);
  assert.equal(isNonPermanentEquipment(name,{cacheIdentity:{id:row.cacheIds[0]}}),true);
  assert.equal(getEquipmentPermanence(name,{cacheIdentity:{id:-1}}),null);
  assert.equal(isNonPermanentEquipment('Custom temporary-looking corrupt spear',{charges:1}),false);
  assert.equal(getEquipmentPermanence('__proto__'),null);
});

test('cache transitions stop at a broken state before its unused terminal sentinel', () => {
  const rows=[cacheItem(1,'Amulet',[[3382,2],[3385,100000]]),cacheItem(2,'Amulet (broken)',[[3382,-1],[3383,500000],[3385,100000]])];
  const trace=traceDegradation(rows[0],new Map(rows.map(row=>[row.id,row])));
  assert.equal(trace.outcome,'retained-state');
  assert.deepEqual(trace.states.map(state=>state.id),[1,2]);
  const legacy=[cacheItem(10,'Chaotic maul',[[1081,11],[1079,2000000]]),cacheItem(11,'Chaotic maul (broken)',[[1079,2000000]])];
  assert.equal(traceDegradation(legacy[0],new Map(legacy.map(row=>[row.id,row]))).outcome,'retained-state');
  const dust=cacheItem(3,'Vanishing armour',[[3382,-1],[3383,-1],[3385,100000]]);
  assert.equal(traceDegradation(dust,new Map([[3,dust]])).outcome,'vanishes');
  // Repair-cost sentinel -1 alone does not claim a disappearing item.
  assert.equal(traceDegradation(cacheItem(4,'Repairable',[[3383,-1]]),new Map()).outcome,'no-transition');
});

test('unknown disappearing cache behavior cannot silently become permanent', () => {
  const item=cacheItem(1,'Experimental sword',[[3382,-1],[3385,1]]);
  assert.throws(()=>classifyEquipmentPermanence(item.name,{slot:'main hand weapon'},wikiPage(item.name,'An experimental sword.'),[item],new Map([[1,item]])),/Unreviewed disappearing/);
  const page=wikiPage(item.name,'This sword degrades to dust after one hit.');
  assert.equal(classifyEquipmentPermanence(item.name,{slot:'main hand weapon'},page,[item],new Map([[1,item]])).kind,'dust');
});

test('recorded repository implementation and reference provenance use LF text hashes',async()=>{
  for(const source of [equipmentPermanenceEvidence.provenance.reference,...equipmentPermanenceEvidence.provenance.implementation]) {
    const bytes=await readFile(new URL(`../${datasetSourceEvidence(source.path)}`,import.meta.url));
    assert.equal(sha256RepositoryText(bytes),source.sha256,source.path);
  }
});
