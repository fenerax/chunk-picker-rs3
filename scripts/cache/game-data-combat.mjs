#!/usr/bin/env node
// Offline action definitions; presence is never treated as proof of availability.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { decodeGuideScript } from './game-data-skill-guides.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

const arrayEntries = definition => definition?.intArrayValue1 ?? definition?.intArrayValue2?.values ?? definition?.stringArrayValue1 ?? definition?.stringArrayValue2?.values ?? [];
const clean = value => String(value ?? '').replace(/<nbsp>/g, ' ').toLowerCase();
export const COMBAT_PARAMS = Object.freeze({ name: 2794, description: 2795, cooldown: 2796, skill: 2806, level: 2807, icon: 2802, unlockText: 4650 });
export function deriveRuneParameters(script) {
  const decoded = decodeGuideScript(script), switchIndex = decoded.ops.findIndex(op=>op.name==='switch');
  if (switchIndex < 0 || decoded.switches.length !== 1) throw new Error('Unexpected rune helper switch shape');
  return decoded.switches[0].map(({value:itemId,jump})=>{
    const block=decoded.ops.slice(switchIndex+1+jump,switchIndex+1+jump+5);
    if(block[0]?.name!=='iload'||block[0].arg!==0||block[1]?.name!=='push'||!Number.isInteger(block[1].arg)||block[2]?.name!=='struct_param'||block[3]?.name!=='istore'||block[3].arg!==2||block[4]?.name!=='jump') throw new Error('Unexpected rune parameter branch');
    return {itemId,param:block[1].arg,script:18436,switchKey:itemId};
  });
}
const combatSkills = new Set(['Attack', 'Strength', 'Ranged', 'Magic', 'Defence', 'Constitution', 'Prayer', 'Necromancy']);
const aliases = Object.freeze({ 'Dragon Slayer (ability)': 'Dragon Slayer', 'Demon Slayer (ability)': 'Demon Slayer', 'Undead Slayer (ability)': 'Undead Slayer' });
export function extractCombat({ structs, enums, params, items = new Map(), runeParameters = [] }) {
  const skills = new Map(arrayEntries(enums.get(108))), actions = [], guides = [];
  const enumReferences = new Map();
  for (const [enumId, definition] of enums) if (definition.value_type2 === 73) for (const [key, id] of arrayEntries(definition)) {
    if (!enumReferences.has(id)) enumReferences.set(id, []);
    enumReferences.get(id).push({ enumId, key, value: id, valueType: 73 });
  }
  for (const [id, definition] of structs) {
    const p = new Map((definition.extra ?? []).map(row => [row.prop, row.stringvalue ?? row.intvalue]));
    const source = { major: 22, minor: Math.floor(id / 32), subid: id % 32 };
    if (p.has(2210) && p.has(2212)) guides.push({ id, name: p.get(2210), skill: skills.get(p.get(2215)) ?? null, level: p.get(2212), source,
      actionPointer: p.get(8877) ?? null, requirementText: p.get(2211) ?? null, levelUpText:p.get(2216) ?? null, rawParams: definition.extra });
    if (!p.has(2794) || !p.has(2806) || !combatSkills.has(skills.get(p.get(2806)))) continue;
    const name = p.get(2794), skill = skills.get(p.get(2806)), get = prop=>p.has(prop)?p.get(prop):params.get(prop)?.type?.defaultint ?? null;
    const memberBranch=(get(2793)>0||get(2799)===6), type=skill==='Prayer'?(get(2947)===1?'curse':'prayer'):skill==='Magic'&&get(2880)!==5?'spell':'ability-or-action';
    const runeCosts = runeParameters.filter(r=>get(r.param)>0).map(r=>({...r,item:{id:r.itemId,name:items.get(r.itemId)?.name??null},quantity:get(r.param),origin:p.has(r.param)?'explicit param':'parameter default'}));
    const typedReferences=(definition.extra??[]).filter(r=>[3,33,73].includes(params.get(r.prop)?.type?.vartype)).map(r=>({param:r.prop,type:params.get(r.prop).type.vartype,id:r.intvalue,
      kind:params.get(r.prop).type.vartype===33?'item':params.get(r.prop).type.vartype===3?'quest':'struct',
      name:params.get(r.prop).type.vartype===33?items.get(r.intvalue)?.name??null:null,interpretation:'typed reference only; no consumption or requirement semantics inferred'}));
    actions.push({ id, source, name, skill, skillId: p.get(2806), level: p.get(2807) ?? null,
      levelOrigin: p.has(2807) ? 'explicit param 2807' : 'absent; param default is not promoted to a requirement',
      family: type, classification: { script:3108, skillParam:2806, magicModeParam:2880, curseParam:2947,
        meaning:'Client tooltip spell/prayer/curse branch; other actions include removed, passive and internal entries' },
      magicCategoryRaw: p.get(2871) ?? null,
      book: skill==='Prayer'?(type==='curse'?'Curses':'Standard prayers'):type==='spell'&&p.has(2871)?({0:'Normal',1:'Ancient',2:'Lunar',3:'Mixed abilities and teleports',4:'Dungeoneering'}[get(2871)]??null):null,
      bookInterpretation:'Magic category2871 joined by named Wiki samples for Normal/Ancient/Lunar; category3 remains mixed and category4 observed Dungeoneering. Prayer book follows helper3108 curse branch.',
      description: p.get(2795) ?? null, iconSprite: p.get(2802) ?? null,
      cooldownRaw: p.get(2796) ?? null,
      cooldownUnit: 'ticks only corroborated for Air Strike, Confuse, Slice, Devotion and reviewed Constitution samples; absence is unknown',
      membershipRaw: p.get(2809) ?? null, members:memberBranch&&get(2809)!==null?get(2809)>=1:null,
      membershipInterpretation: 'Client guide branch2553 delegates action2809 to helper734: >=1 members. Not proof of server or quest eligibility.',
      membershipSource:{scripts:[2553,734],guardParams:[2793,2799],param:2809,origin:p.has(2809)?'explicit':'parameter default'},
      runeCosts, runeCostMeaning:'Encoded base rune quantity via helper18436 switch. Runtime helper18435 checks player state; substitutions, equipment, free casts, scaling and consumption are not inferred.',
      typedReferences,
      unlockText: p.get(4650) ?? null, enumReferences: enumReferences.get(id) ?? [], rawParams: definition.extra,
      questRequirementText: /quest/i.test(p.get(4650)??'')?p.get(4650):null,
      missing: ['active server availability', 'complete unlock and equipment requirements', 'runtime rune consumption and non-rune item costs', 'damage scaling and XP units'] });
  }
  const usedParams = new Set(actions.flatMap(a => a.rawParams.map(p => p.prop)));
  return { actions, guides, skills: { enumId: 108, source: { major: 17, minor: 0, subid: 108 }, values: [...skills] },
    parameters: [...params].filter(([id]) => usedParams.has(id)),
    fieldSemantics: { 2794: 'action display name; string type36', 2795: 'tooltip text; string type36',
      2806: 'skill ID joined through enum108; integer type0', 2807: 'action requirement level; integer type0; explicit only',
      2802: 'sprite reference; type23', 2796: 'cooldown integer; ticks in named Wiki samples, not universal',
      2210: 'separate skillguide row name; may preserve stale historical text', 2212: 'skillguide display level; differs from current action level in Confuse',
      4650: 'human-readable unlock text; incomplete rather than executable unlock rule',
      2809:'Client membership flag >=1 through helper734 and guide2553 guarded action branch; default0',
      2947:'Client tooltip curse flag1 through helper3108; default0 means prayer',
      2880:'Magic tooltip branch5 is an ability; other values enter spell branch in helper3108',
      runeParameters,
      2871: 'Magic category integer; observed 0 normal, 1 ancient, 2 lunar, 3 mixed abilities/teleports, 4 Dungeoneering; not a spell classifier',
      remaining: 'raw typed parameters retained; no effect, damage, adrenaline, rune, membership or XP interpretation inferred' } };
}
export function compareCombat(actions, reference) {
  const comparisons = [];
  for (const skill of combatSkills) for (const [label, record] of Object.entries(reference.challenges?.[skill] ?? {})) {
    if (!/^(Cast|Unlock|Activate|Use)/i.test(label)) continue;
    const retainedName = label.match(/~\|([^|]+)\|~/)?.[1];
    if (!retainedName) continue;
    const joinedName = aliases[retainedName] ?? retainedName;
    const candidates = actions.filter(a => a.skill === skill && clean(a.name) === clean(joinedName));
    const levels = candidates.map(a => a.level);
    const membershipFlags=['Not F2P','NotF2P'].filter(key=>Object.hasOwn(record,key)).map(key=>({key,value:record[key]}));
    const flagConflict=membershipFlags.some(f=>typeof f.value!=='boolean')||new Set(membershipFlags.map(f=>f.value)).size>1;
    const retainedMembers=flagConflict?null:membershipFlags.some(f=>f.value===true);
    const membershipStatus=flagConflict||!candidates.length?'unknown':candidates.length>1?'ambiguous':typeof candidates[0].members!=='boolean'?'unknown':candidates[0].members===retainedMembers?'agrees':'disagrees';
    const runeInputComparisons=candidates.map(action=>({id:action.id,costs:action.runeCosts??[],tokens:(record.Items??[]).map(token=>{
      const name=String(token).replace(/\*/g,'').replace(/\[\+\]$/,'');
      const expanded=reference.codeItems?.itemsPlus?.[name]??[name];
      const matching=(action.runeCosts??[]).filter(r=>expanded.some(n=>clean(n)===clean(r.item.name)));
      return {token,runeCostItemIds:matching.map(r=>r.item.id),substitutionAlias:String(token).includes('[+]'),consumableMarker:String(token).includes('*'),quantityComparison:'not performed',status:matching.length?'encoded rune name overlap':'no encoded rune name overlap; may be equipment/unlock or unrelated item'};
    }),meaning:'Name overlap only; no equivalence of wildcard, quantity, equipment substitution or consumption'}));
    const plainRuneTokens=(record.Items??[]).filter(t=>!String(t).includes('[+]')&&/ rune\*?$/i.test(String(t))).map(t=>({token:t,name:String(t).replace(/\*$/,'')}));
    const substitutionRuneTokens=(record.Items??[]).filter(t=>/rune/i.test(String(t))&&String(t).includes('[+]'));
    const runeNameComparison=candidates.length!==1?{status:candidates.length?'ambiguous':'unknown'}:(()=>{
      const encoded=candidates[0].runeCosts??[], plainNames=new Set(plainRuneTokens.map(t=>clean(t.name)));
      const plainRetainedNotEncoded=plainRuneTokens.filter(t=>!encoded.some(r=>clean(r.item.name)===clean(t.name)));
      const encodedNotPlainRetained=encoded.filter(r=>!plainNames.has(clean(r.item.name))).map(r=>({id:r.item.id,name:r.item.name}));
      const status=!plainRuneTokens.length&&!encoded.length&&!substitutionRuneTokens.length?'not-applicable':substitutionRuneTokens.length?'substitution-unresolved':plainRetainedNotEncoded.length||encodedNotPlainRetained.length?'plain-name-difference':'plain-names-agree';
      return {status,plainRuneTokens,substitutionRuneTokens,plainRetainedNotEncoded,encodedNotPlainRetained,quantityComparison:'not performed',interpretation:'Authored item gates versus encoded base rune names only; differences do not certify cost, consumption, equipment substitutes or task eligibility'};
    })();
    comparisons.push({ skill, label, retainedName, join: retainedName === joinedName ? 'exact case-insensitive name plus skill' : 'explicit reviewed disambiguation alias plus skill',
      retainedLevel: record.Level ?? null, retainedItems: record.Items ?? [], retainedSkills: record.Skills ?? {},
      retainedTasks: record.Tasks ?? {}, equipmentAssumptions: record.Items ?? [],
      retainedMembership:{members:retainedMembers,flagPresent:membershipFlags.length>0,flags:membershipFlags,aliasPresent:Object.hasOwn(record,'NotF2P'),conflict:flagConflict,
        meaning:'Explicit authored task flags only; absence means no explicit member flag, not proven F2P eligibility'},
      membershipStatus,membershipDecision:'retain authored flags and item/quest/equipment gates; client action membership alone cannot establish full task eligibility',
      candidates: candidates.map(a => ({ id: a.id, level: a.level, members:a.members??null, source: a.source })),
      runeInputComparisons,runeNameComparison,
      status: !candidates.length ? 'unmatched' : levels.some(l => l === null) ? 'missing-level' : candidates.length > 1 ? 'ambiguous' : levels[0] === record.Level ? 'agrees' : 'disagrees',
      inputStatus: 'authored item/task/equipment gates retained; raw client action params do not establish equivalence' });
  }
  return { taskCount: comparisons.length, statuses: Object.fromEntries(['unmatched', 'missing-level', 'ambiguous', 'agrees', 'disagrees'].map(s => [s, comparisons.filter(c => c.status === s).length])),
    membershipStatuses:Object.fromEntries(['agrees','disagrees','unknown','ambiguous'].map(s=>[s,comparisons.filter(c=>c.membershipStatus===s).length])),
    membershipFlags:{present:comparisons.filter(c=>c.retainedMembership.flagPresent).length,aliasPresent:comparisons.filter(c=>c.retainedMembership.aliasPresent).length,conflicts:comparisons.filter(c=>c.retainedMembership.conflict).length},
    runeNameStatuses:Object.fromEntries(['plain-names-agree','plain-name-difference','substitution-unresolved','not-applicable','unknown','ambiguous'].map(s=>[s,comparisons.filter(c=>c.runeNameComparison.status===s).length])),comparisons };
}
export async function exportCombat({ cache, context, output, reference }) {
  const tables = {};
  context.combatExtractor = { sha256:sha256RepositoryText(readFileSync(import.meta.filename)),
    helperDecoderSha256:sha256RepositoryText(readFileSync(resolve(import.meta.dirname,'game-data-skill-guides.mjs'))),hashScope:'repository text CRLF normalized to LF' };
  for (const [name, options] of Object.entries({ structs: { major: 22, kind: 'struct', groupSize: 32 }, enums: { major: 17, kind: 'enum' }, params: { major: 2, minor: 11, kind: 'param' }, items:{major:19,kind:'item'} })) tables[name] = loadTable(cache, options);
  const tracedScripts = new Map(), traceErrors=[];
  for(const id of [3108,18436,18435,18411,2553,734])try{const bytes=cache.archive(12,id)?.get(0);const decoded=decodeGuideScript(cache.decoders.decode('clientscriptdata',bytes));tracedScripts.set(id,{...decoded,source:{major:12,minor:id,subid:0},sha256:sha256(bytes)});}catch(error){traceErrors.push({id,error:error.message});}
  if(!tracedScripts.has(18436)||!tracedScripts.has(3108)||!tracedScripts.has(734))throw Error('Required combat semantic helper could not be completely decoded');
  const runeParameters=deriveRuneParameters(tracedScripts.get(18436));
  const result = extractCombat({...Object.fromEntries(Object.entries(tables).map(([n,t]) => [n,t.definitions])),runeParameters}), comparison = compareCombat(result.actions, reference);
  for(const action of result.actions)action.guideReferences=result.guides.filter(g=>g.actionPointer===action.id).map(({id,source,requirementText,levelUpText})=>({id,source,requirementText,levelUpText}));
  const interfaceTables = [1422, 1460, 1461, 1502].map(minor => ({ minor, ...loadTable(cache, { major: 3, minor, kind: 'interface' }) }));
  const interfaces = interfaceTables.flatMap(t => [...t.definitions].filter(([, d]) => Object.values(d.scripts ?? {}).some(s => s?.length)).map(([id,d]) => ({ source: { major: 3, minor: t.minor, subid: id }, text: d.textdata?.text ?? null, scripts: d.scripts })));
  const scriptIds = [...new Set(interfaces.flatMap(i => Object.values(i.scripts).filter(Array.isArray).filter(s => s.length).map(s => s[0])))];
  const headers = [], scriptErrors = [];
  for (const minor of scriptIds) try { for (const [subid, bytes] of cache.archive(12, minor) ?? []) { const { opcodedata, ...header } = cache.decoders.decode('clientscriptdata', bytes); headers.push({ minor, subid, ...header, opcodeBytes: opcodedata.length }); } } catch(error) { scriptErrors.push({ minor, message: error.message }); }
  let scriptProbe;
  try { cache.decoders.decode('clientscript', cache.archive(12, scriptIds[0])?.get(0)); scriptProbe = { status: 'decoded' }; } catch(error) { scriptProbe = { status: 'unavailable', reason: error.message }; }
  const provenance = { decoder: context.decoder, reference: context.reference, manifest: 'combat-manifest.v1.json' };
  const summary = { actions: result.actions.length, families: Object.fromEntries(Object.entries(Object.groupBy(result.actions,a=>a.family)).map(([k,v])=>[k,v.length])),
    perSkill: Object.fromEntries(Object.entries(Object.groupBy(result.actions,a=>a.skill)).map(([k,v])=>[k,v.length])), guides: result.guides.length,
    fieldCounts:{knownMembership:result.actions.filter(a=>a.members!==null).length,membersMarked:result.actions.filter(a=>a.members===true).length,
      runePayload:result.actions.filter(a=>a.runeCosts.length).length,runeCostRows:result.actions.reduce((n,a)=>n+a.runeCosts.length,0),
      questUnlockText:result.actions.filter(a=>a.questRequirementText).length,typedItemReferences:result.actions.reduce((n,a)=>n+a.typedReferences.filter(r=>r.kind==='item').length,0),
      typedQuestReferences:result.actions.reduce((n,a)=>n+a.typedReferences.filter(r=>r.kind==='quest').length,0)},
    comparison: { taskCount: comparison.taskCount, statuses: comparison.statuses,membershipStatuses:comparison.membershipStatuses,membershipFlags:comparison.membershipFlags,runeNameStatuses:comparison.runeNameStatuses } };
  const dataset = { schemaVersion: 1, kind: 'advisory-combat-action-definitions', provenance, ...result, summary,
    inspection: { tables: Object.fromEntries(Object.entries(tables).map(([n,t])=>[n,{decoded:t.definitions.size,errors:t.errors}])), interfaces, interfaceErrors: interfaceTables.flatMap(t=>t.errors),
      clientscripts: { declared: cache.table(12).entries.size, associatedHeaders: headers, errors: scriptErrors, probe: scriptProbe,
        boundedTraces:[...tracedScripts].map(([id,d])=>({id,source:d.source,sha256:d.sha256,instructioncount:d.instructioncount,ops:d.ops,switches:d.switches})),traceErrors,
        limit: 'Six targeted helper instruction bodies fully decoded/count-validated. Remaining obfuscated instruction semantics unavailable. Rune runtime helper18411 reads player varbit14067200; runtime cost gate stays unknown.' } } };
  const files = [writeDataset(output, 'combat.cache-2026-10-08.v1.json', dataset), writeDataset(output, 'combat-retained-comparison.2026-10-08.v1.json', { schemaVersion: 1, provenance, ...comparison })];
  context.outputs.push(...files);
  return { dataset, comparison, files };
}
async function main() {
  const args = cliOptions(); if (!args.output) throw new Error('Required --output NEW-directory');
  const { cache, context } = await openGameCache({ workspace: args.workspace, build: args.build ? Number(args.build) : 950 });
  try { const result = await exportCombat({ cache, context, output: args.output, reference: JSON.parse(readFileSync(context.reference.path,'utf8')) });
    const manifest = await finishManifest(cache, context, args.output, { name: 'combat-manifest.v1.json', summary: result.dataset.summary });
    console.log(JSON.stringify({ files: [...result.files, manifest.file], summary: result.dataset.summary }, null, 2));
  } finally { cache.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
