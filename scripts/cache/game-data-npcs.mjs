// Offline NPC definitions. Client metadata never establishes server spawns or drops.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeLegacyText } from '../../app/tasks/migration.mjs';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

export const NPC_LIMITS = [
  'NPC spawns, counts, respawn times and locations are server-side and unavailable in these client definitions.',
  'NPC definitions do not establish drop tables, drop rates, shop inventories or shop prices.',
  'Pinned NPC schema has no membership flag; member-only options do not establish NPC membership.',
  'Morph options are conditional alternatives; no player varbit/varp state or active variant is inferred.',
  'Name matches and suggested spellings are review candidates; retained names are never automatically mutated.',
];
const normalizedName = value => decodeLegacyText(String(value)).normalize('NFC');
// NPC morph targets are unsigned shorts. 32767 is a real NPC ID in this snapshot.
const validTarget = id => Number.isInteger(id) && id >= 0 && id < 65535;
const option = value => typeof value === 'string' && value && !/^hidden$/i.test(value) ? value : null;

export function projectNpc(id, raw, source = {}) {
  const params = raw.extra ?? [];
  const duplicateParams = [...new Set(params.filter((p,i)=>params.findIndex(q=>q.prop===p.prop)!==i).map(p=>p.prop))];
  const conflictingParams = duplicateParams.filter(prop=>new Set(params.filter(p=>p.prop===prop).map(p=>JSON.stringify(p.intvalue??p.stringvalue))).size>1);
  const morphs = ['morphs_1','morphs_2','morphs_1_v2','morphs_2_v2'].filter(key=>raw[key]).map(key=>({
    opcodeField:key, ...raw[key], targetIds:[...new Set([...(raw[key].options??[]),raw[key].default,raw[key].unk2].filter(validTarget))],
    status:'conditional alternatives; unk2 retained as possible target; no active state selected',
  }));
  return { id, name:raw.name??null, normalizedName:raw.name?normalizedName(raw.name):null,
    combatLevel:raw.combat??null, combatLevelStatus:raw.combat===undefined?'absent opcode; unknown':'explicit opcode 0x5f',
    size:raw.boundSize??null, sizeStatus:raw.boundSize===undefined?'absent opcode; no default inferred':'explicit opcode 0x0c',
    options:Array.from({length:5},(_,i)=>option(raw[`actions_${i}`])),
    memberOptions:Array.from({length:5},(_,i)=>option(raw[`members_actions_${i}`])),
    members:null, membershipStatus:'unavailable in pinned NPC schema',
    quests:raw.quests??[], morphs, morphTargetIds:[...new Set(morphs.flatMap(m=>m.targetIds))],
    modelMorphs:raw.unknown_BA??raw.unknown_BA_v2??null,
    params, duplicateParams, conflictingParams,
    combatParams:params.filter(p=>[3,4,14,26,29,50,641,643,965,2836,2848,2849,2850,2851,2852,2865,8881].includes(p.prop)),
    combatParamStatus:'numeric research candidates only; all params retained; not calibrated stats', stats:{}, lifePoints:null,
    source:{major:18,minor:Math.floor(id/128),subid:id%128,...source}, definitionSha256:sha256(JSON.stringify(raw)),
  };
}

/** Promote a numeric interpretation only with independently sourced, matching samples.
 * Calibration supports a bounded mapping; it does not certify every NPC variant.
 */
export function calibrateNpcStats(rows,evidence) {
  const byId=new Map(rows.map(r=>[r.id,r])),semantics=[];
  const value=(row,param)=>row&&!row.conflictingParams.includes(param)?row.params.find(p=>p.prop===param)?.intvalue:null;
  for(const mapping of evidence.mappings??[]){
    const {field,param,divisor,samples}=mapping;
    if(!/^[A-Za-z][A-Za-z0-9]*$/.test(field)||field==='lifePoints'||!Number.isInteger(param)||!Number.isFinite(divisor)||divisor<=0||!Array.isArray(samples)||samples.length<2)
      throw new Error(`Invalid or insufficient NPC calibration: ${field}`);
    if(new Set(samples.map(s=>s.id)).size<2||new Set(samples.map(s=>s.source?.url)).size<2)throw new Error(`NPC calibration needs independent source samples: ${field}`);
    for(const sample of samples){const raw=value(byId.get(sample.id),param);if(!sample.source?.url||!Number.isInteger(sample.source.revid)||!Number.isFinite(sample.expectedValue)||!Number.isFinite(raw)||Math.abs(raw/divisor-sample.expectedValue)>0.00001)
      throw new Error(`NPC calibration sample does not match: ${field} NPC ${sample.id}`);}
    semantics.push({...mapping,status:'inferred-and-sample-calibrated; numeric params retained; unvalidated variants may differ'});
    for(const row of rows){const raw=value(row,param);if(Number.isFinite(raw))row.stats[field]=raw/divisor;}
  }
  for(const row of rows)if(Object.keys(row.stats).length)row.combatParamStatus='inferred-and-sample-calibrated numeric mappings; see manifest calibration receipts';
  return {mappings:semantics,lifePoints:'unavailable; tested params do not encode independently observed sample life points',scope:'client combat metadata; no kill time, damage formula, XP, active state or drop semantics'};
}

/** Retain every authored selector and location; counts remain source claims. */
export function collectPickerNpcNames(definitions) {
  const found=new Map();
  const add=(name,origin,details={})=>{
    if(typeof name!=='string'||!name)return;
    const row=found.get(name)??{name,normalizedName:normalizedName(name),origins:[],locations:[],metadata:[]};
    if(!row.origins.includes(origin))row.origins.push(origin);
    if(details.location)row.locations.push(details.location);
    if(details.metadata)row.metadata.push(details.metadata);
    found.set(name,row);
  };
  const walk=(node,location)=>{
    for(const kind of ['NPC','Monster'])for(const [name,count]of Object.entries(node?.[kind]??{}))add(name,`chunks.${kind}`,{location:{key:location,kind,count}});
    for(const [key,section]of Object.entries(node?.Sections??{}))walk(section,`${location}-${key}`);
  };
  for(const [key,node]of Object.entries(definitions.chunks??{}))walk(node,key);
  for(const name of Object.keys(definitions.drops??{}))add(name,'drops',{metadata:{field:'dropItemEntries',value:Object.keys(definitions.drops[name]??{}).length,scope:'retained drop table; no cache verification'}});
  for(const [name,level]of Object.entries(definitions.slayerMonsters??{}))add(name,'slayerMonsters',{metadata:{field:'slayerLevel',value:level,scope:'retained metadata; not calibrated cache field'}});
  for(const table of ['npcsPlus','monstersPlus','mixPlus'])for(const [alias,names]of Object.entries(definitions.codeItems?.[table]??{}))for(const name of Array.isArray(names)?names:[])add(name,`${table}:${alias}`);
  for(const name of Object.keys(definitions.codeItems?.bossMonsters??{}))add(name,'bossMonsters');
  return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

const variantBase = name => name.replace(/#.*$/,'').replace(/\s*\([^)]*\)\s*$/,'').trim().toLocaleLowerCase('en');
function editDistance(a,b,max=2) {
  if(Math.abs(a.length-b.length)>max)return max+1;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const current=[i];for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));if(Math.min(...current)>max)return max+1;previous=current;}
  return previous[b.length];
}
export function compareNpcs(definitions,rows) {
  const exact=new Map(),bases=new Map();
  for(const row of rows)if(row.normalizedName){for(const [index,key]of [[exact,row.normalizedName],[bases,variantBase(row.normalizedName)]]){const group=index.get(key)??[];group.push(row);index.set(key,group);}}
  const baseLengths=new Map();for(const name of bases.keys()){const group=baseLengths.get(name.length)??[];group.push(name);baseLengths.set(name.length,group);}
  const byId=new Map(rows.map(r=>[r.id,r]));
  const records=collectPickerNpcNames(definitions).map(reference=>{
    const candidates=exact.get(reference.normalizedName)??[],base=variantBase(reference.normalizedName);
    let suggestions=[];
    if(!candidates.length){
      const variants=bases.get(base)??[];
      if(variants.length)suggestions=variants.map(row=>({id:row.id,name:row.name,reason:row.normalizedName.toLocaleLowerCase('en')===reference.normalizedName.toLocaleLowerCase('en')?'case-only candidate':'qualifier/base-name candidate'}));
      else if(base.length>=7){const max=Math.min(2,Math.floor(base.length/6));for(let length=base.length-max;length<=base.length+max;length++)for(const name of baseLengths.get(length)??[]){const distance=editDistance(base,name,max);if(distance<=max)for(const row of bases.get(name))suggestions.push({id:row.id,name:row.name,reason:'near-spelling candidate',editDistance:distance});}}
    }
    return {...reference,status:candidates.length===0?'unmatched':candidates.length===1?'unique':'ambiguous',candidateIds:candidates.map(r=>r.id),
      candidates:candidates.map(row=>({id:row.id,name:row.name,combatLevel:row.combatLevel,size:row.size,members:row.members,options:row.options,memberOptions:row.memberOptions,stats:row.stats,
        morphTargetIds:row.morphTargetIds,variants:row.morphTargetIds.map(id=>({id,name:byId.get(id)?.name??null,combatLevel:byId.get(id)?.combatLevel??null,status:byId.has(id)?'decoded':'missing-definition'})),source:row.source})),
      candidateCombatLevels:[...new Set(candidates.map(r=>r.combatLevel))],candidateSizes:[...new Set(candidates.map(r=>r.size))],
      renameCandidates:suggestions,mutationAllowed:false,placementStatus:'retained locations only; no NPC spawn verification',dropStatus:'retained drops only; client definitions cannot verify drops'};
  });
  const cohort=origin=>{const r=records.filter(r=>r.origins.some(o=>o===origin));return {names:r.length,unique:r.filter(r=>r.status==='unique').length,ambiguous:r.filter(r=>r.status==='ambiguous').length,unmatched:r.filter(r=>r.status==='unmatched').length,matched:r.filter(r=>r.candidateIds.length).length};};
  return {summary:{names:records.length,unique:records.filter(r=>r.status==='unique').length,ambiguous:records.filter(r=>r.status==='ambiguous').length,unmatched:records.filter(r=>r.status==='unmatched').length,
    renameCandidateRows:records.filter(r=>r.renameCandidates.length).length,cohorts:Object.fromEntries(['chunks.NPC','chunks.Monster','drops','slayerMonsters','bossMonsters'].map(o=>[o,cohort(o)])),
    verifiedSpawnLocations:0,verifiedDropTables:0,verifiedMembershipFlags:0},records};
}

export async function extractNpcs({workspace,output,calibration}={}) {
  if(!output||existsSync(resolve(output)))throw new Error('Use a NEW versioned output directory.');
  const {cache,context}=await openGameCache({workspace});
  try {
    const rawRecords=[],rows=[],errors=[],archiveInventory=[];
    let declaredDefinitions=0;
    for(const [minor,entry]of cache.table(18).entries){
      declaredDefinitions+=entry.subindices.length;
      let archive;
      try{archive=cache.archive(18,minor);if(!archive)throw new Error('Declared archive missing from copied snapshot');}
      catch(error){for(const subid of entry.subindices)errors.push({id:minor*128+subid,major:18,minor,subid,message:error.message});archiveInventory.push({major:18,minor,declared:entry.subindices.length,decoded:0,errors:entry.subindices.length});continue;}
      let decoded=0;
      for(const subid of entry.subindices){const id=minor*128+subid,bytes=archive.get(subid),source={rawSha256:bytes?sha256(bytes):null,rawBytes:bytes?.length??null,archiveSha256:context.archives.get(`18:${minor}`)?.sha256??null};
        try{if(!bytes)throw new Error('Declared subfile absent from archive');const definition=cache.decoders.decode('npc',bytes);rawRecords.push({id,source:{major:18,minor,subid,...source},definition});rows.push(projectNpc(id,definition,source));decoded++;}
        catch(error){errors.push({id,major:18,minor,subid,...source,message:error.message});}}
      archiveInventory.push({major:18,minor,declared:entry.subindices.length,decoded,errors:entry.subindices.length-decoded});
    }
    const calibrationBytes=calibration?readFileSync(calibration):null;
    const semantics=calibrationBytes?calibrateNpcStats(rows,JSON.parse(calibrationBytes)):{mappings:[],status:'uncalibrated; numeric params only'};
    if(calibrationBytes)context.calibration={sha256:sha256(calibrationBytes),hashScope:'raw external calibration JSON bytes',...semantics};
    const params=loadTable(cache,{major:2,minor:11,kind:'params'});
    const definitions=JSON.parse(readFileSync(context.reference.path,'utf8')),comparison=compareNpcs(definitions,rows);
    const fields={};for(const {definition}of rawRecords)for(const key of Object.keys(definition))fields[key]=(fields[key]??0)+1;
    const summary={...comparison.summary,declaredDefinitions,decodedNpcs:rows.length,decodeErrors:errors.length,completeAccounting:declaredDefinitions===rows.length+errors.length,
      named:rows.filter(r=>r.name&&r.name!=='null').length,explicitCombatLevel:rows.filter(r=>r.combatLevel!==null).length,explicitSize:rows.filter(r=>r.size!==null).length,
      ordinaryOptions:rows.filter(r=>r.options.some(Boolean)).length,memberOptions:rows.filter(r=>r.memberOptions.some(Boolean)).length,morphRows:rows.filter(r=>r.morphs.length).length,
      morphTargetIds:new Set(rows.flatMap(r=>r.morphTargetIds)).size,paramsRows:rows.filter(r=>r.params.length).length,conflictingParamRows:rows.filter(r=>r.conflictingParams.length).length,
      paramDefinitions:params.definitions.size,paramErrors:params.errors.length,rawFieldCounts:fields,
      calibratedStats:Object.fromEntries(semantics.mappings.map(m=>[m.field,rows.filter(r=>m.field in r.stats).length])),lifePointsDecoded:0};
    context.limits.push(...NPC_LIMITS);
    context.extractor={files:Object.fromEntries(['scripts/cache/game-data-npcs.mjs','scripts/cache/game-data-common.mjs','scripts/cache/cache-reader.mjs','scripts/lib/provenance-hash.mjs','app/tasks/migration.mjs'].map(path=>[path,{sha256:sha256RepositoryText(readFileSync(resolve(import.meta.dirname,'../..',path))),hashScope:'repository text; CRLF normalized to LF'}])),groupSize:128,major:18};
    const provenance={schemaVersion:1,generatedAt:context.generatedAt,decoder:context.decoder,extractor:context.extractor,reference:context.reference,manifest:'npcs.manifest.v1.json'};
    context.outputs.push(writeDataset(output,'npcs.raw.v1.json',{...provenance,records:rawRecords,errors,archiveInventory}));
    context.outputs.push(writeDataset(output,'npcs.v1.json',{...provenance,summary,semantics,limits:NPC_LIMITS,records:rows}));
    context.outputs.push(writeDataset(output,'npcs.params.v1.json',{...provenance,records:[...params.definitions].map(([id,definition])=>({id,definition})),errors:params.errors}));
    context.outputs.push(writeDataset(output,'npcs.comparison.v1.json',{...provenance,summary:comparison.summary,limits:NPC_LIMITS,records:comparison.records}));
    if(calibrationBytes)context.outputs.push(writeDataset(output,'npcs.calibration.v1.json',calibrationBytes));
    const manifest=await finishManifest(cache,context,output,{name:'npcs.manifest.v1.json',summary,semantics,archiveInventory});
    return {summary,rows,comparison,manifest:manifest.manifest,manifestFile:manifest.file};
  }finally{cache.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options=cliOptions();const result=await extractNpcs(options);console.log(JSON.stringify({summary:result.summary,manifest:result.manifestFile},null,2));}
