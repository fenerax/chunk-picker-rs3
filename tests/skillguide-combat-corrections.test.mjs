import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applySkillguideCombatCorrections, skillguideCombatCorrections } from '../app/data/skillguide-combat-corrections.mjs';
import { extractCombat, compareCombat, deriveRuneParameters } from '../scripts/cache/game-data-combat.mjs';
import { buildCombatCorrections } from '../scripts/research/skillguide-combat-corrections.mjs';
const label = 'Unlock and use the ~|Example|~ ability';
const fixture = () => ({ challenges: { Constitution: { [label]: { Level: 10, Items: ['Example codex'], Priority: 1 }, unrelated: { Level: 40 } } }, equipment: { codex: { level: 50 } } });
const correction = { skill: 'Constitution', label, changes: [{ field: 'Level', before: 10, after: 1 }] };
test('combat overlay changes reviewed numeric level only and is immutable/idempotent', () => {
  const input = fixture(), output = applySkillguideCombatCorrections(input, { corrections: [correction], strict: true });
  assert.equal(input.challenges.Constitution[label].Level, 10);
  assert.equal(output.challenges.Constitution[label].Level, 1);
  assert.equal(output.equipment, input.equipment);
  assert.equal(output.challenges.Constitution[label].Items, input.challenges.Constitution[label].Items);
  assert.equal(output.challenges.Constitution.unrelated, input.challenges.Constitution.unrelated);
  assert.equal(applySkillguideCombatCorrections(output, { corrections: [correction], strict: true }), output);
});
test('exact identity, level drift and complete record drift fail closed', () => {
  const input = fixture(), hash = createHash('sha256').update(JSON.stringify(input.challenges.Constitution[label])).digest('hex');
  input.challenges.Constitution[label].Items = ['Different codex'];
  assert.equal(applySkillguideCombatCorrections(input,{corrections:[{...correction,beforeRecordSha256:hash}]}),input);
  assert.throws(()=>applySkillguideCombatCorrections(input,{corrections:[{...correction,beforeRecordSha256:hash}],strict:true}),/drift/);
  input.challenges.Constitution[label].Level = 11;
  assert.equal(applySkillguideCombatCorrections(input,{corrections:[correction]}),input);
  assert.throws(()=>applySkillguideCombatCorrections(input,{corrections:[{...correction,label:label.toLowerCase()}],strict:true}),/Missing/);
});
test('unsupported availability/effect/prototype corrections are rejected', () => {
  for (const field of ['Items', 'Not F2P', '__proto__', 'Skills.Magic', 'damage']) assert.throws(()=>applySkillguideCombatCorrections(fixture(),{corrections:[{...correction,changes:[{field,before:10,after:1}]}]}),/Unsupported/);
  assert.throws(()=>applySkillguideCombatCorrections(fixture(),{corrections:[{...correction,changes:[...correction.changes,...correction.changes]}]}),/Duplicate/);
});
test('missing explicit action level stays unknown, stale guide level stays separate', () => {
  const struct = entries => ({extra:entries.map(([prop,value])=>({prop,intvalue:typeof value==='number'?value:null,stringvalue:typeof value==='string'?value:null}))});
  const result = extractCombat({ structs: new Map([[1,struct([[2794,'Confuse'],[2806,4],[2807,1],[2871,0]])],[2,struct([[2210,'Confuse'],[2215,4],[2212,3]])],[3,struct([[2794,'Unknown'],[2806,4]])]]),
    enums:new Map([[108,{stringArrayValue1:[[4,'Magic']]}]]),params:new Map([[2807,{type:{defaultint:0}}]]) });
  assert.equal(result.actions[0].level,1); assert.equal(result.guides[0].level,3); assert.equal(result.actions[1].level,null);
  assert.equal(result.actions[0].family,'spell');
  const comparison=compareCombat(result.actions,{challenges:{Magic:{'Cast ~|Confuse|~':{Level:1},'Cast ~|Unknown|~':{Level:1}}}});
  assert.equal(comparison.statuses.agrees,1); assert.equal(comparison.statuses['missing-level'],1);
});
test('complete rune helper switch derives item-to-quantity params and fails unknown encoding',()=>{
  const immediate=(opcode,arg)=>{const b=Buffer.alloc(6);b.writeUInt16BE(opcode);b.writeInt32BE(arg,2);return b;};
  const push=value=>{const b=Buffer.alloc(7);b.writeUInt16BE(0x334);b.writeInt32BE(value,3);return b;};
  const script={instructioncount:8,switches:[[{value:556,jump:1}]],opcodedata:Buffer.concat([immediate(0x5c3,1),immediate(0x397,0),immediate(0x4ed,5),immediate(0x5c3,0),push(2898),Buffer.from([0,0xce,0]),immediate(0x5f0,2),immediate(0x4ed,0)])};
  assert.deepEqual(deriveRuneParameters(script),[{itemId:556,param:2898,script:18436,switchKey:556}]);
  assert.throws(()=>deriveRuneParameters({...script,instructioncount:7}),/count/);
  assert.throws(()=>deriveRuneParameters({...script,opcodedata:Buffer.from([0xff,0xff,0])}),/Unknown/);
});
test('spell/prayer/curse branches preserve encoded costs and membership origin',()=>{
  const struct=entries=>({extra:entries.map(([prop,value])=>({prop,intvalue:typeof value==='number'?value:null,stringvalue:typeof value==='string'?value:null}))});
  const params=new Map([2793,2799,2809,2880,2947,2898].map(p=>[p,{type:{vartype:0,defaultint:p===2799?1:0}}]));
  const result=extractCombat({structs:new Map([[1,struct([[2794,'Air Strike'],[2806,4],[2793,1],[2898,1],[2880,0],[2871,0]])],[2,struct([[2794,'Ability'],[2806,4],[2793,2],[2809,1],[2880,5]])],[3,struct([[2794,'Soul Split'],[2806,7],[2793,3],[2947,1],[2809,1],[4650,'Unlocked from the quest Example.']])]]),
    enums:new Map([[108,{stringArrayValue1:[[4,'Magic'],[7,'Prayer']]}]]),params,items:new Map([[556,{name:'Air rune'}]]),runeParameters:[{itemId:556,param:2898,script:18436}]});
  assert.deepEqual(result.actions.map(a=>a.family),['spell','ability-or-action','curse']);
  assert.deepEqual(result.actions.map(a=>a.members),[false,true,true]);
  assert.equal(result.actions[0].membershipSource.origin,'parameter default');
  assert.equal(result.actions[0].runeCosts[0].quantity,1);
  assert.equal(result.actions[0].runeCosts[0].item.name,'Air rune');
  assert.equal(result.actions[1].runeCosts.length,0);
  assert.equal(result.actions[2].book,'Curses');
  assert.match(result.actions[2].questRequirementText,/quest Example/);
});
test('membership comparison retains flags, aliases and equipment gates independently of action membership',()=>{
  const actions=[{id:1,name:'A',skill:'Magic',level:10,members:false,runeCosts:[]},{id:2,name:'B',skill:'Magic',level:10,members:true,runeCosts:[]},{id:3,name:'C',skill:'Magic',level:10,members:null,runeCosts:[]},{id:4,name:'D',skill:'Magic',level:10,members:true,runeCosts:[]},{id:5,name:'D',skill:'Magic',level:10,members:true,runeCosts:[]}];
  const reference={challenges:{Magic:{'Cast ~|A|~':{Level:10,'NotF2P':true,Items:['Members-only codex']},'Cast ~|B|~':{Level:10,'Not F2P':true},'Cast ~|C|~':{Level:10},'Cast ~|D|~':{Level:10,'Not F2P':true},'Cast ~|E|~':{Level:10,'Not F2P':false,NotF2P:true}}}};
  const result=compareCombat(actions,reference);
  assert.deepEqual(result.membershipStatuses,{agrees:1,disagrees:1,unknown:2,ambiguous:1});
  const mismatch=result.comparisons[0];assert.equal(mismatch.retainedMembership.aliasPresent,true);assert.equal(mismatch.retainedMembership.members,true);
  assert.deepEqual(mismatch.equipmentAssumptions,['Members-only codex']);assert.match(mismatch.membershipDecision,/retain/);
  assert.equal(reference.challenges.Magic['Cast ~|A|~'].NotF2P,true);
  assert.equal(result.membershipFlags.conflicts,1);
});
test('rune input comparison isolates plain names and unresolved substitution markers without quantity claims',()=>{
  const action={id:1,name:'Example',skill:'Magic',level:1,members:false,runeCosts:[{item:{id:556,name:'Air rune'},quantity:5}]};
  const result=compareCombat([action],{challenges:{Magic:{'Cast ~|Example|~':{Level:1,Items:['Air rune*']},'Cast ~|Example|~ twice':{Level:1,Items:['Air rune[+]*']},'Cast ~|Example|~ on item':{Level:1,Items:['Mind rune*']}}}});
  assert.deepEqual(result.comparisons.map(c=>c.runeNameComparison.status),['plain-names-agree','substitution-unresolved','plain-name-difference']);
  assert.equal(result.comparisons[0].runeNameComparison.quantityComparison,'not performed');
  assert.equal(result.comparisons[1].runeInputComparisons[0].tokens[0].substitutionAlias,true);
  assert.deepEqual(result.comparisons[2].runeNameComparison.encodedNotPlainRetained,[{id:556,name:'Air rune'}]);
});
test('review gate rejects contradictory Wiki prose even when cache and infobox agree',()=>{
  const candidate={skill:'Constitution',label,candidates:[{id:37200}],status:'disagrees'};
  const result=buildCombatCorrections({reference:fixture(),dataset:{actions:[{id:37200,level:1}]},comparison:{comparisons:[candidate]},wikiPages:[{pageid:1,title:'Demon Slayer (ability)',revisions:[{revid:2,slots:{main:{'*':'|id = 37200\n|level = 1\nIt requires level 10 Constitution to use.'}}}]}]});
  assert.equal(result.corrections.length,0); assert.match(result.reviewedCandidates[0].reason,/conflict/);
});
test('versioned evidence covers ten corrections with cache and Wiki agreement',()=>{
  assert.equal(skillguideCombatCorrections.length,10);
  for(const row of skillguideCombatCorrections){assert.equal(row.changes[0].after,row.cache.level);assert.ok(row.wiki.ids.includes(row.cache.id));assert.deepEqual(row.wiki.levels,[row.cache.level]);assert.match(row.beforeRecordSha256,/^[a-f0-9]{64}$/);}
});
