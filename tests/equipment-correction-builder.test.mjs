import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEquipmentCorrections, resolveEquipmentIdentity, selectEquipmentBonuses, parseEquipRequirements } from '../scripts/research/build-equipment-corrections.mjs';
import { parseEquipmentWikiPage } from '../scripts/research/equipment-wiki.mjs';

const page=(title,text)=>({title,revisions:[{revid:987,timestamp:'2026-10-08T00:00:00Z',slots:{main:{content:text}}}]});
function fixture({before={},cache={},text,ids=[7],status='unique',differences=[]}={}) {
  const name='Fixture item';
  return {reference:{equipment:{[name]:before}},items:{records:[{id:7,name,normalizedName:name,equipmentCandidate:true,template:false,members:true,slot:'head',stats:{},requirements:{},params:[],...cache}]},comparison:{equipment:[{name,normalizedName:name,status,candidateIds:ids,consensusDifferences:differences}]},snapshot:{pages:[page(name,text??'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=head}}')],resolutions:{[name]:name}}};
}

test('builder requires current Wiki ID and retains every unresolved unique candidate',()=>{
  const input=fixture({text:'{{Infobox Item|name=Fixture item|id=9|members=Yes}}',differences:[{field:'prayer',picker:1,cache:2}]});
  const result=buildEquipmentCorrections(input);
  assert.equal(result.counts.uniqueUnresolved,1);
  assert.equal(result.identities.length,0);
  assert.equal(result.corrections.length,0);
  assert.equal(result.consensusReview[0].fields[0].decision,'unresolved');
  assert.match(result.identityReview[0].reason,/No current Wiki infobox ID/);
});

test('identity resolves by ID intersection instead of first same-name cache entry',()=>{
  const candidates=[{id:99,equipmentCandidate:true},{id:7,equipmentCandidate:true}];
  const parsed=parseEquipmentWikiPage(page('Fixture item','{{Infobox Item|name=Fixture item|id=7}}'));
  assert.equal(resolveEquipmentIdentity('Fixture item',candidates,parsed).cache.id,7);
  const multi=parseEquipmentWikiPage(page('Fixture item','{{Infobox Item|name1=Fixture item|version1=new|id1=7|name2=Fixture item|version2=used|id2=99}}'));
  assert.equal(resolveEquipmentIdentity('Fixture item',candidates,multi).status,'unresolved');
});

test('bonuses follow explicit bucket versions, not matching suffix positions',()=>{
  const parsed=parseEquipmentWikiPage(page('Fixture item','{{Infobox Item|name1=Fixture item|version1=used|id1=7|name2=Other|version2=new|id2=9}}{{Infobox Bonuses|bucketname1=new|armour1=100|bucketname2=used|armour2=50}}'));
  assert.equal(selectEquipmentBonuses(parsed,parsed.items[0]).fields.armour,'50');
  const shared=parseEquipmentWikiPage(page('Fixture item','{{Infobox Item|name=Fixture item|version=(2)|id=7}}{{Infobox Bonuses|bucketname=(0)¦(1)¦(2)|prayer=2}}'));
  assert.equal(selectEquipmentBonuses(shared,shared.items[0]).fields.prayer,'2');
});

for (const [field,cacheKey,wikiKey] of [['armour','armour','armour'],['prayer','prayer','prayer'],['accuracy','accuracy','accuracy'],['auto_damage','auto_damage','damage'],['melee_damage','melee_damage','strength'],['ranged_damage','ranged_damage','ranged'],['magic_damage','magic_damage','magic'],['necromancy_damage','necromancy_damage','necromancy']]) {
  test(`independent numeric ${field} correction carries matching provenance`,()=>{
    const input=fixture({before:{[field]:1,formatted_name:'Authored label',requirements:{Quest:99}},cache:{stats:{[cacheKey]:3.5}},text:`{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=head|${wikiKey}=3.5}}`});
    const untouched=structuredClone(input);
    const result=buildEquipmentCorrections(input),change=result.corrections[0].changes.find(c=>c.field===field);
    assert.equal(change.before,1);assert.equal(change.after,3.5);
    assert.equal(change.cache.id,7);assert.equal(change.cache.value,change.wiki.value);assert.equal(change.wiki.revisionId,987);
    assert.deepEqual(input,untouched);
    assert.ok(result.identities[0].beforeRecordSha256.match(/^[a-f0-9]{64}$/));
  });
}

test('membership, skill additions and slot corrections preserve absent preconditions',()=>{
  const input=fixture({before:{slot:'feet',requirements:{Quest:99}},cache:{members:false,requirements:{Defence:50,Attack:1}},text:'{{Infobox Item|name=Fixture item|id=7|members=No}}{{Infobox Bonuses|slot=head|requirements={{sc|defence|50}}{{sc|attack|1}}}}',differences:[{field:'requirements.Defence',picker:null,cache:50}]});
  const result=buildEquipmentCorrections(input),changes=result.corrections[0].changes;
  assert.deepEqual(changes.map(c=>c.field),['members','slot','requirements.Defence']);
  assert.equal(changes[0].beforePresent,false);assert.equal(changes[0].after,false);
  assert.equal(changes[2].beforePresent,false);assert.equal(changes[2].after,50);
  assert.equal(result.consensusReview[0].fields[0].decision,'applied');
  assert.deepEqual(input.reference.equipment['Fixture item'].requirements,{Quest:99});
});

test('sparse calibrated params correct only same-item agreement, preserving absent and conflicting params',()=>{
  const params=[{prop:4596,intvalue:50},{prop:1326,intvalue:100},{prop:8879,intvalue:202},{prop:14,intvalue:4},{prop:13,intvalue:6},{prop:2645,intvalue:99}];
  const input=fixture({before:{slot:'head',tier:20,lp:0,accuracy:1,speed:3,attack_range:1},cache:{params},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=head|tier=50|life=100|accuracy=202|speed=4|attack_range=6}}'});
  const result=buildEquipmentCorrections(input);
  assert.deepEqual(result.corrections[0].changes.filter(c=>c.field!=='members').map(c=>[c.field,c.after,c.cache.param]),[['tier',50,4596],['lp',100,1326],['accuracy',202,8879],['attack_speed_ticks',4,14],['attack_range',6,13]]);
  input.items.records[0].conflictingParams=[4596];
  input.items.records[0].params.push({prop:4596,intvalue:90});
  const conflict=buildEquipmentCorrections(input);
  assert.equal(conflict.corrections[0].changes.some(c=>c.field==='tier'),false);
  assert.equal(conflict.corrections[0].changes.some(c=>c.cache.param===2645),false);
});

test('Wiki/cache disagreement, omitted Wiki fields and slot conventions are preserved',()=>{
  const input=fixture({before:{slot:'off-hand weapon',armour:10,prayer:1,tier:90},cache:{slot:'off-hand',stats:{armour:20,prayer:2},params:[{prop:4596,intvalue:80}]},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=off-hand weapon|armour=10|tier=90}}'});
  const result=buildEquipmentCorrections(input);
  assert.deepEqual(result.corrections[0].changes.map(c=>c.field),['members']);
  assert.equal(result.fieldReview.find(c=>c.field==='armour').decision,'preserved');
  assert.equal(result.fieldReview.find(c=>c.field==='prayer').decision,'unresolved');
  assert.equal(result.fieldReview.find(c=>c.field==='slot').decision,'preserved');
});

test('alternative or conflicting skill requirements are not flattened into conjunction',()=>{
  assert.deepEqual(parseEquipRequirements('{{sc|attack|50}} or {{sc|strength|50}}').values,{});
  assert.deepEqual(parseEquipRequirements('{{sc|magic|50}}{{sc|magic|70}}').values,{});
  assert.deepEqual(parseEquipRequirements('{{sc|defence|50}}{{sc|magic|70}}').values,{Defence:50,Magic:70});
});

test('off-hand weapon displayed damage uses calibrated /20 only for explicit weapon variants',()=>{
  const input=fixture({before:{slot:'off-hand weapon',auto_damage:0},cache:{equipSlotId:5,slot:'off-hand',params:[{prop:641,intvalue:1920}]},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=off-hand weapon|damage=96}}'});
  const result=buildEquipmentCorrections(input),change=result.corrections[0].changes.find(c=>c.field==='auto_damage');
  assert.equal(change.after,96);assert.equal(change.cache.formula.divisor,20);assert.equal(change.cache.formula.rawValue,1920);
  assert.equal(change.wiki.value,96);
  input.snapshot.pages[0]=page('Fixture item','{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=shield|damage=96}}');
  assert.equal(buildEquipmentCorrections(input).corrections[0].changes.some(c=>c.field==='auto_damage'),false);
});

test('game-tick enrichment preserves authored speed index and duplicate Wiki fields are withheld',()=>{
  const input=fixture({before:{speed:3},cache:{params:[{prop:14,intvalue:4}]},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=head|speed=4}}'});
  const result=buildEquipmentCorrections(input);
  const tick=result.corrections[0].changes.find(c=>c.field==='attack_speed_ticks');
  assert.equal(tick.after,4);assert.equal(tick.beforePresent,false);
  assert.equal(result.corrections[0].changes.some(c=>c.field==='speed'),false);
  assert.equal(input.reference.equipment['Fixture item'].speed,3);
  input.snapshot.pages[0]=page('Fixture item','{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=head|speed=4|speed=6}}');
  assert.equal(buildEquipmentCorrections(input).corrections[0].changes.some(c=>c.field==='attack_speed_ticks'),false);
});

test('conflicting membership and physical slot cannot corroborate the last declaration',()=>{
  const input=fixture({cache:{members:true,slot:'head'},text:'{{Infobox Item|name=Fixture item|id=7|members=No|members=Yes}}{{Infobox Bonuses|slot=feet|slot=head}}'});
  const result=buildEquipmentCorrections(input);
  assert.equal(result.identities.length,1);
  assert.equal(result.corrections.length,0);
  assert.equal(result.fieldReview.find(row=>row.field==='members').decision,'unresolved');
  assert.equal(result.fieldReview.find(row=>row.field==='slot').decision,'unresolved');
});

test('conflicting bonus version binding cannot select stats from the final bucket name',()=>{
  const input=fixture({before:{armour:1},cache:{stats:{armour:10}},text:'{{Infobox Item|name=Fixture item|version=used|id=7|members=Yes}}{{Infobox Bonuses|bucketname=new|bucketname=used|slot=head|armour=10}}'});
  const result=buildEquipmentCorrections(input);
  assert.equal(result.corrections[0].changes.some(change=>change.field==='armour'),false);
  assert.equal(result.corrections[0].changes.some(change=>change.field==='slot'),false);
});

test('conflicting shield/weapon classification withholds the off-hand damage formula',()=>{
  const input=fixture({cache:{equipSlotId:5,slot:'off-hand',params:[{prop:641,intvalue:1920}]},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=shield|slot=off-hand weapon|damage=96}}'});
  const result=buildEquipmentCorrections(input);
  assert.equal(result.corrections[0].changes.some(change=>change.field==='auto_damage'),false);
  assert.equal(result.corrections[0].changes.some(change=>change.field==='slot'),false);
});

test('off-hand display rounding calibrates the formula but cannot authorize an exact field correction',()=>{
  const input=fixture({before:{auto_damage:24},cache:{equipSlotId:5,slot:'off-hand',params:[{prop:641,intvalue:613}]},text:'{{Infobox Item|name=Fixture item|id=7|members=Yes}}{{Infobox Bonuses|slot=off-hand weapon|damage=30.6}}'});
  const result=buildEquipmentCorrections(input);
  assert.equal(result.corrections[0].changes.some(change=>change.field==='auto_damage'),false);
  const review=result.fieldReview.find(row=>row.field==='auto_damage');
  assert.equal(review.cache,30.65);assert.equal(review.wiki,30.6);
  assert.equal(review.decision,'preserved');assert.match(review.reason,/display rounding; exact agreement required/);
});
