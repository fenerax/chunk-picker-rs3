import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decodeGuideScript,createGuideEvaluator,extractSkillGuides} from '../scripts/cache/game-data-skill-guides.mjs';
import {sha256,sha256RepositoryText} from '../scripts/lib/provenance-hash.mjs';

const push=value=>{const b=Buffer.alloc(7);b.writeUInt16BE(0x334);b.writeInt32BE(value,3);return b;};
const op=(opcode,arg=0,int=false)=>{const b=Buffer.alloc(int?6:3);b.writeUInt16BE(opcode);if(int)b.writeInt32BE(arg,2);else b[2]=arg;return b;};
const script=ops=>({opcodedata:Buffer.concat(ops),instructioncount:ops.length,intargcount:1,stringargcount:0,switches:[]});

test('guide parser rejects partial immediates, unknown encodings and incorrect footer counts',()=>{
  assert.equal(decodeGuideScript(script([push(12),op(0x3e4)])).ops[0].arg,12);
  assert.throws(()=>decodeGuideScript({opcodedata:Buffer.from('03340000','hex'),instructioncount:1}));
  assert.throws(()=>decodeGuideScript({opcodedata:Buffer.from('fffe00','hex'),instructioncount:1}),/Unknown guide encoding/);
  assert.throws(()=>decodeGuideScript({...script([push(12),op(0x3e4)]),instructioncount:3}),/instruction count/);
});

test('guide VM preserves parameter default provenance and rejects missing parameter types',()=>{
  const tables={enums:new Map(),structs:new Map([[3,{extra:[]}]]),items:new Map(),params:new Map([[2212,{type:{vartype:0,defaultint:0}}]]),dbrows:new Map(),dbtables:new Map(),
    scripts:new Map([[12098,script([op(0x5c3,0,true),push(2212),op(0xce),op(0x3e4)])]])};
  const result=createGuideEvaluator(tables).evaluate('level',3);
  assert.equal(result.value,0);assert.equal(result.trace[0].origin,'parameter default');
  tables.params.clear();assert.match(createGuideEvaluator(tables).evaluate('level',3).error,/Missing parameter type/);
});

test('guide VM does not invent player-state-dependent values',()=>{
  const tables={enums:new Map(),structs:new Map(),items:new Map(),params:new Map(),dbrows:new Map(),dbtables:new Map(),
    scripts:new Map([[12096,script([op(0x61c,6955008,true),op(0x3e4)])]])};
  const result=createGuideEvaluator(tables).evaluate('requirementText',3);
  assert.equal(result.value,null);assert.match(result.error,/Player-state-dependent varbit 6955008/);
});

test('guide extractor rejects untyped root pointers before attempting data joins',()=>{
  assert.throws(()=>extractSkillGuides({enums:new Map([[108,{stringArrayValue1:[[1,'Attack']]}],[5420,{value_type2:0}],[5421,{value_type2:26}]]),
    structs:new Map(),items:new Map(),params:new Map(),dbrows:new Map(),dbtables:new Map(),scripts:new Map(),interfaces:new Map()}),/not typed enum/);
});

// The copied-cache export lives in the local game data, as the app finds it; the test skips without it.
const exported=process.env.RS3_SKILL_GUIDES_EXPORT??`${process.env.RS3_GAME_DATA_DIR??fileURLToPath(new URL('../.local/game-data',import.meta.url))}/skill-guides-2026-10-08-v1`;
test('copied-cache guide artifact has every real skill, resolved fallbacks, typed references and archive hashes',{skip:!existsSync(`${exported}/skill-guides.v1.json`)},()=>{
  const bytes=readFileSync(`${exported}/skill-guides.v1.json`),data=JSON.parse(bytes),manifest=JSON.parse(readFileSync(`${exported}/skill-guides-manifest.v1.json`));
  assert.equal(data.skills.length,29);assert.equal(data.entries.length,6281);assert.equal(data.coverage.tabs,248);
  assert.deepEqual(data.skills.map(x=>x.id).sort((a,b)=>a-b),Array.from({length:29},(_,i)=>i+1));
  assert.deepEqual(data.coverage.excludedEnum108Entries.map(x=>x.id),[31]);
  assert.equal(new Set(data.entries.map(x=>x.id)).size,6281);
  assert.equal(data.decodeAudit.scriptErrors.length,0);
  assert.equal(data.decodeAudit.targetErrors.length,0);assert.equal(data.targetReferenceAudit.counts.npc,12);
  const yew=data.entries.find(x=>x.structId===46061),hatchet=data.entries.find(x=>x.structId===53325);
  assert.deepEqual([yew.name,yew.level,yew.members],['Yew tree',70,false]);
  assert.deepEqual([hatchet.name,hatchet.level,hatchet.members],["Hawthorn's hatchet",100,true]);
  assert.equal(hatchet.rawTitle,null);assert.ok(hatchet.evaluation.level.trace.some(x=>x.kind==='item'&&x.param===771));
  const bronzeArrow=data.entries.find(x=>x.skillId===19&&x.name==='Bronze arrow');
  assert.ok(bronzeArrow);assert.equal(bronzeArrow.level,1);assert.ok(bronzeArrow.evaluation.level.trace.some(x=>x.param===2645));
  assert.ok(data.entries.some(x=>x.linkedIds.some(l=>l.kind==='npc')));
  assert.equal(data.entries.filter(x=>x.unknowns.some(u=>u.field==='level')).length,3);
  assert.equal(data.entries.filter(x=>x.unknowns.some(u=>u.field==='requirementText')).length,1);
  assert.ok(data.entries.every(x=>typeof x.name==='string'&&typeof x.members==='boolean'&&x.category.name));
  const archives=new Map(manifest.archives.map(x=>[`${x.major}:${x.minor}`,x]));
  for(const entry of data.entries){assert.match(archives.get(`${entry.source.major}:${entry.source.minor}`)?.sha256??'',/^[0-9a-f]{64}$/);
    for(const link of entry.linkedIds){assert.ok(archives.has(`${link.source.major}:${link.source.minor}`));
      if(link.targetSource){assert.equal(link.targetDefinitionPresent,true);assert.ok(archives.has(`${link.targetSource.major}:${link.targetSource.minor}`));}}}
  assert.equal(manifest.outputs.find(x=>x.path.endsWith('/skill-guides.v1.json')).sha256,sha256(bytes));
  assert.equal(manifest.extractor.hashScope,'repository text normalized to LF');
  assert.equal(manifest.extractor.sha256,sha256RepositoryText(readFileSync(new URL('../scripts/cache/game-data-skill-guides.mjs',import.meta.url))));
  assert.ok(manifest.helpers.every(x=>x.footerValidated&&/^[0-9a-f]{64}$/.test(x.bodySha256)));
});
