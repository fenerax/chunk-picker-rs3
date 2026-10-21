import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNpc, collectPickerNpcNames, compareNpcs, calibrateNpcStats } from '../scripts/cache/game-data-npcs.mjs';
import { compactNpcIndex } from '../scripts/cache/report-game-data-npcs.mjs';

test('member-only options never become NPC membership; missing combat and size remain unknown',()=>{
  const row=projectNpc(44,{name:'Banker',members_actions_0:'Bank'});
  assert.equal(row.members,null);assert.equal(row.memberOptions[0],'Bank');assert.equal(row.combatLevel,null);assert.equal(row.size,null);
  assert.deepEqual(row.stats,{});assert.equal(row.source.minor,0);assert.equal(row.source.subid,44);
});
test('all conditional morph targets and raw sentinels survive without selecting active state',()=>{
  const row=projectNpc(129,{morphs_2_v2:{varbit:12,varp:65535,options:[5,65535,6,32767],default:65535,unk2:7,unk5:9}});
  assert.deepEqual(row.morphTargetIds,[5,6,32767,7]);assert.deepEqual(row.morphs[0].options,[5,65535,6,32767]);assert.equal(row.morphs[0].unk5,9);
  assert.equal(row.source.minor,1);assert.equal(row.source.subid,1);
});
test('conflicting numeric params remain explicit research data and never calibrated stats',()=>{
  const row=projectNpc(1,{combat:2,extra:[{prop:29,intvalue:20},{prop:29,intvalue:21},{prop:999,stringvalue:'unknown'}]});
  assert.deepEqual(row.conflictingParams,[29]);assert.equal(row.params.length,3);assert.deepEqual(row.stats,{});
});
test('retained chunk sections, count claims, aliases, drops and Slayer metadata remain distinct',()=>{
  const rows=collectPickerNpcNames({chunks:{1:{NPC:{Bob:2},Sections:{2:{Monster:{Cow:3}}}}},drops:{Cow:{Milk:{}}},slayerMonsters:{Cow:1},codeItems:{npcsPlus:{Alias:['Bob']}}});
  assert.deepEqual(rows.find(r=>r.name==='Cow').locations,[{key:'1-2',kind:'Monster',count:3}]);
  assert.deepEqual(rows.find(r=>r.name==='Cow').origins,['chunks.Monster','drops','slayerMonsters']);
  assert.equal(rows.find(r=>r.name==='Bob').origins.includes('npcsPlus:Alias'),true);
});
test('exact names retain combat variant ambiguity and qualifier suggestions never mutate names',()=>{
  const rows=[projectNpc(1,{name:'Cow',combat:2,boundSize:2}),projectNpc(2,{name:'Cow',combat:0}),projectNpc(3,{name:'Bob',combat:0})];
  const result=compareNpcs({chunks:{1:{Monster:{Cow:1},NPC:{'Bob (Lumbridge)':1}}}},rows);
  const cow=result.records.find(r=>r.name==='Cow'),bob=result.records.find(r=>r.name==='Bob (Lumbridge)');
  assert.equal(cow.status,'ambiguous');assert.deepEqual(cow.candidateCombatLevels,[2,0]);
  assert.equal(bob.status,'unmatched');assert.equal(bob.renameCandidates[0].name,'Bob');assert.equal(bob.mutationAllowed,false);
  const index=compactNpcIndex({...result,reference:{},decoder:{},limits:[]},{sources:[],extractor:{}},'hash');
  assert.equal(index.records.Cow.consensusCombatLevel,null);assert.equal(index.records['Bob (Lumbridge)'].consensusCombatLevel,null);
});
test('safe compact combat consensus needs explicit agreement across every exact candidate',()=>{
  const rows=[projectNpc(1,{name:'Chicken',combat:1}),projectNpc(2,{name:'Chicken',combat:1})];
  const result=compareNpcs({drops:{Chicken:{}}},rows);
  const index=compactNpcIndex({...result,reference:{},decoder:{},limits:[]},{sources:[],extractor:{}},'hash');
  assert.equal(index.records.Chicken.consensusCombatLevel,1);assert.equal(index.records.Chicken.members,null);
});
test('numeric semantics require independently sourced matching samples and never promote life points',()=>{
  const rows=[projectNpc(1,{extra:[{prop:641,intvalue:150}]}),projectNpc(2,{extra:[{prop:641,intvalue:200}]}),projectNpc(3,{})];
  const mapping={field:'maxMeleeHit',param:641,divisor:10,samples:[{id:1,expectedValue:15,source:{url:'https://example.test/a',revid:1}},{id:2,expectedValue:20,source:{url:'https://example.test/b',revid:2}}]};
  calibrateNpcStats(rows,{mappings:[mapping]});assert.equal(rows[0].stats.maxMeleeHit,15);assert.deepEqual(rows[2].stats,{});assert.equal(rows[0].lifePoints,null);
  assert.throws(()=>calibrateNpcStats(rows,{mappings:[{...mapping,field:'lifePoints'}]}));
  assert.throws(()=>calibrateNpcStats(rows,{mappings:[{...mapping,samples:[mapping.samples[0]]}]}));
  assert.throws(()=>calibrateNpcStats(rows,{mappings:[{...mapping,divisor:1}]}));
});
