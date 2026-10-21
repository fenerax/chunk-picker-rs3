import test from 'node:test';
import assert from 'node:assert/strict';
import { projectItem, compareEquipment, collectPickerItemNames, validateWikiSamples } from '../scripts/cache/game-data-items.mjs';

const extras = pairs => pairs.map(([prop,intvalue])=>({prop,intvalue,stringvalue:null}));
test('modern equippable identity excludes a conversion stub and note templates without guessing variants',()=>{
  const rows=[projectItem(1127,{name:'Rune platebody'}),projectItem(45543,{name:'Rune platebody',equipSlotId:4,noteData:1128,extra:extras([[2870,1955],[749,1],[750,50]])}),
    projectItem(1128,{name:'Rune platebody',equipSlotId:4,noteTemplate:799,noteData:45543})];
  const result=compareEquipment({'Rune platebody':{slot:'torso',armour:195.5,requirements:{Defence:50}}},rows);
  assert.equal(result.records[0].status,'unique');assert.deepEqual(result.records[0].candidateIds,[45543]);
  assert.deepEqual(result.records[0].consensusDifferences,[]);assert.deepEqual(rows[1].variants,{noteData:1128});
});
test('duplicate names preserve charge-state ambiguity and disagreements by candidate',()=>{
  const rows=[projectItem(20139,{name:'Torva platebody',equipSlotId:4,extra:extras([[2870,3896]])}),projectItem(20141,{name:'Torva platebody',equipSlotId:4,extra:extras([[2870,3000]])})];
  const result=compareEquipment({'Torva platebody':{slot:'torso',armour:400}},rows);
  assert.equal(result.records[0].status,'ambiguous');assert.equal(result.records[0].candidates.length,2);
  assert.deepEqual(result.records[0].consensusDifferences,[]);assert.equal(result.summary.candidateMismatchRows,1);
});
test('absent stats and weights stay unknown; raw off-hand damage is not misreported as displayed auto damage',()=>{
  const row=projectItem(1,{name:'Example',equipSlotId:5,extra:extras([[641,1000]])});
  assert.equal(row.weight,null);assert.deepEqual(row.stats,{});
  const result=compareEquipment({Example:{slot:'off-hand weapon',armour:0,auto_damage:50}},[row]);
  assert.deepEqual(result.records[0].consensusDifferences,[]);assert.equal(result.summary.replaceableWeights,0);
});
test('invalid stat types, incomplete requirement pairs and conflicting params fail closed',()=>{
  const meta=new Map([[749,{type:{vartype:0}}]]);
  const row=projectItem(1,{extra:extras([[749,1],[750,50],[751,3],[2870,300],[2870,400]])},meta);
  assert.deepEqual(row.requirements,{});assert.equal(row.unresolvedRequirements.length,2);
  assert.deepEqual(row.conflictingParams,[2870]);assert.equal(row.stats.armour,undefined);
});
test('paired skill requirements retain multiple skills while missing pairs do not prove absent gates',()=>{
  const row=projectItem(1,{extra:extras([[749,1],[750,80],[751,3],[752,80],[753,99],[754,20]])});
  assert.deepEqual(row.requirements,{Defence:80,Constitution:80});assert.equal(row.unresolvedRequirements.length,1);
  assert.match(row.requirementScope,/absence is not proof/);
});
test('catalogue item names retain explicit source spelling and qualifiers',()=>{
  const names=collectPickerItemNames({equipment:{'Rune platebody':{}},shopItems:{shop:{'Rune platebody + 1':true}},drops:{npc:{'Mystic robe top':{}}},codeItems:{itemsPlus:{alias:['Rune platebody']}}});
  assert.equal(names.length,3);assert.deepEqual(names.find(r=>r.name==='Rune platebody').origins,['equipment','itemsPlus:alias']);
  assert.ok(names.some(r=>r.name==='Rune platebody + 1'));
});
test('Wiki checks explicitly report unavailable cache fields instead of silently counting partial mappings as valid',()=>{
  const evidence={payload:{query:{pages:[{title:'Example',revisions:[{revid:1,timestamp:'2026-10-08',slots:{main:{content:'{{Infobox Item\n|id = 1\n}}\n{{Infobox Bonuses\n|armour = 50\n|damage = 100\n|requirements = {{sc|defence|40}}\n}}'}}}]}]}}};
  const [result]=validateWikiSamples(evidence,[projectItem(1,{name:'Example'})]);
  assert.equal(result.checks.filter(check=>check.status==='unavailable-cache-field').length,3);
  assert.equal(result.checks.filter(check=>check.status==='match').length,1);
});
