import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeLegacyText } from '../../app/tasks/migration.mjs';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';

// These interpretations are calibrated against independently fetched Wiki item
// facts, not declared authoritative names for numeric parameters. Keep raw data.
export const ITEM_SEMANTICS = {
  status: 'inferred-and-sample-calibrated; review before runtime replacement',
  stats: { armour: [2870, 10], prayer: [2946, 1], melee_damage: [641, 10],
    ranged_damage: [643, 10], magic_damage: [965, 10], necromancy_damage: [8881, 10] },
  weaponAccuracy: { melee: 3267, ranged: 4, magic: 3 },
  requirements: { firstSkillParam: 749, firstLevelParam: 750, pairs: 10 },
  weights: 'No weight field in pinned item schema; no decoded numeric param is promoted to weight.',
};
const SKILLS = ['Attack','Defence','Strength','Constitution','Ranged','Prayer','Magic','Cooking','Woodcutting',
  'Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer',
  'Farming','Runecrafting','Hunter','Construction','Summoning','Dungeoneering','Divination','Invention','Archaeology','Necromancy'];
const SLOTS = { 0:'head',1:'back',2:'neck',3:'main hand weapon',4:'torso',5:'off-hand',7:'legs',9:'hands',10:'feet',12:'ring',13:'ammo',14:'aura',17:'pocket' };
const normalizeName = name => decodeLegacyText(String(name)).normalize('NFC');
const links = ['noteData','noteTemplate','noteData_old','noteTemplate_old','noteDataIcon','loanId','loanTemplate',
  'loanId_old','loanTemplate_old','bindLink','bindTemplate','bindLink_old','bindTemplate_old','combine_info','combine_template'];

export function projectItem(id, raw, paramDefinitions = new Map()) {
  const params = new Map((raw.extra ?? []).map(p => [p.prop, p.intvalue ?? p.stringvalue]));
  const duplicateParams = [...new Set((raw.extra ?? []).filter((p,i,a)=>a.findIndex(q=>q.prop===p.prop)!==i).map(p=>p.prop))];
  const conflictingParams = duplicateParams.filter(prop=>new Set(raw.extra.filter(p=>p.prop===prop).map(p=>JSON.stringify(p.intvalue??p.stringvalue))).size>1);
  for(const prop of conflictingParams)params.delete(prop);
  const requirements = {}, unresolvedRequirements = [];
  for (let skillParam = 749; skillParam < 769; skillParam += 2) {
    if (!params.has(skillParam) && !params.has(skillParam + 1)) continue;
    const skillId = params.get(skillParam), level = params.get(skillParam + 1);
    // Param metadata validates the pair's types when supplied. Missing names do
    // not justify extending this mapping to quest or server equipability gates.
    const meta = paramDefinitions.get(skillParam);
    if (!SKILLS[skillId] || !Number.isInteger(level) || level < 1 || (meta && meta.type?.vartype !== 17))
      unresolvedRequirements.push({ skillParam, levelParam:skillParam+1, skillId, level });
    else requirements[SKILLS[skillId]] = Math.max(requirements[SKILLS[skillId]] ?? 0, level);
  }
  const slot = raw.equipSlotId === 3 && raw.equipId === 5 ? '2h weapon' : SLOTS[raw.equipSlotId] ?? null;
  const stats = {};
  for (const [field,[param,divisor]] of Object.entries(ITEM_SEMANTICS.stats))
    if (typeof params.get(param) === 'number') stats[field] = params.get(param) / divisor;
  const weapon = [3,5].includes(raw.equipSlotId);
  if (weapon) {
    const accuracyParams = Object.values(ITEM_SEMANTICS.weaponAccuracy).filter(p=>params.has(p));
    if (accuracyParams.length === 1) stats.accuracy = params.get(accuracyParams[0]);
  }
  // Damage params mean a bonus on armour/accessories and auto damage on weapons
  // or ammo. Do not compare them with the picker's derived ability damage.
  if (weapon || raw.equipSlotId === 13) {
    const damage = [641,643,965,8881].filter(p=>params.has(p));
    // Off-hand and ammunition displayed damage use extra game formulae. Their
    // raw damage params remain retained but are not a like-for-like comparison.
    if (raw.equipSlotId === 3 && damage.length === 1) stats.auto_damage = params.get(damage[0]) / 10;
    for (const field of ['melee_damage','ranged_damage','magic_damage','necromancy_damage']) delete stats[field];
  }
  const variants = Object.fromEntries(links.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
  const template = ['noteTemplate','noteTemplate_old','loanTemplate','loanTemplate_old','bindTemplate','bindTemplate_old','combine_template'].some(k=>raw[k]!==undefined);
  return { id, name:raw.name ?? null, normalizedName: raw.name ? normalizeName(raw.name) : null,
    members:!!raw.members, equipSlotId:raw.equipSlotId ?? null, secondaryEquipSlot:raw.equipId ?? null,
    slot, equipmentCandidate:raw.equipSlotId!==undefined && !template, template,
    stackable:!!raw.stackable_1, neverStackable:!!raw.neverStackable,
    value:raw.value ?? null, bigValueParts:raw.big_value ?? null,
    weight:null, variants, stats, requirements, unresolvedRequirements,
    requirementScope:'decoded skill pairs only; absence is not proof of no other equipability requirements',
    params:raw.extra ?? [], duplicateParams, conflictingParams,
    source:{major:19,minor:Math.floor(id/256),subid:id%256}, semanticStatus:ITEM_SEMANTICS.status };
}

export function compareEquipment(equipment, rows) {
  const index = new Map();
  for (const row of rows) if (row.normalizedName && row.equipmentCandidate) {
    const found=index.get(row.normalizedName)??[];found.push(row);index.set(row.normalizedName,found);
  }
  const records = Object.entries(equipment).map(([name,reference])=>{
    const normalizedName=normalizeName(name), candidates=index.get(normalizedName)??[];
    const comparisons=candidates.map(row=>{
      const differences=[];
      const pickerSlot=reference.slot==='off-hand weapon'?'off-hand':reference.slot;
      if (row.slot && row.slot!==pickerSlot) differences.push({field:'slot',picker:reference.slot,cache:row.slot});
      for(const [field,value] of Object.entries(row.stats)) if(reference[field]!==undefined && Math.abs(Number(reference[field])-value)>0.051)
        differences.push({field,picker:reference[field],cache:value});
      // Missing cache pairs may hide gates; a declared skill pair absent in the
      // picker is evidence, but missing cache declarations remain unknown.
      for(const [skill,level] of Object.entries(row.requirements)) if(Number(reference.requirements?.[skill]??1)!==level)
        differences.push({field:`requirements.${skill}`,picker:reference.requirements?.[skill]??null,cache:level});
      return {id:row.id,differences,comparableFields:['slot',...Object.keys(row.stats),...Object.keys(row.requirements).map(k=>`requirements.${k}`)],
        unresolvedRequirements:row.unresolvedRequirements};
    });
    const fields=[...new Set(comparisons.flatMap(c=>c.differences.map(d=>d.field)))];
    const consensusDifferences=fields.flatMap(field=>{
      const all=comparisons.map(c=>c.differences.find(d=>d.field===field));
      return all.length && all.every(d=>d && JSON.stringify(d)===JSON.stringify(all[0])) ? [all[0]] : [];
    });
    return {name,normalizedName,normalizationChanged:name!==normalizedName,status:candidates.length===0?'unmatched':candidates.length===1?'unique':'ambiguous',
      candidateIds:candidates.map(c=>c.id),pickerWeight:reference.weight??null,cacheWeight:null,
      candidates:comparisons,consensusDifferences,uncomparablePickerFields:Object.keys(reference).filter(k=>!['slot','requirements',...candidates.flatMap(c=>Object.keys(c.stats))].includes(k))};
  });
  const summary={equipmentRows:records.length,unique:records.filter(r=>r.status==='unique').length,ambiguous:records.filter(r=>r.status==='ambiguous').length,
    unmatched:records.filter(r=>r.status==='unmatched').length,missingPickerWeights:records.filter(r=>r.pickerWeight===null).length,
    replaceableWeights:0,consensusMismatchRows:records.filter(r=>r.consensusDifferences.length).length,
    candidateMismatchRows:records.filter(r=>r.candidates.some(c=>c.differences.length)).length,
    normalizationChanged:records.filter(r=>r.normalizationChanged).length};
  return {summary,records};
}

export function collectPickerItemNames(definitions) {
  const names=new Map();
  const add=(name,origin)=>{if(typeof name!=='string')return;const found=names.get(name)??new Set();found.add(origin);names.set(name,found);};
  Object.keys(definitions.equipment??{}).forEach(n=>add(n,'equipment'));
  for(const table of ['shopItems','drops','objectItems']) for(const [source,items] of Object.entries(definitions[table]??{}))
    Object.keys(items).forEach(n=>add(n,`${table}:${source}`));
  for(const [skill,sources] of Object.entries(definitions.skillItems??{})) for(const [source,items] of Object.entries(sources))
    Object.keys(items).forEach(n=>add(n,`skillItems:${skill}:${source}`));
  for(const [alias,items] of Object.entries(definitions.codeItems?.itemsPlus??{})) for(const n of Array.isArray(items)?items:[items])add(n,`itemsPlus:${alias}`);
  return [...names].map(([name,origins])=>({name,normalizedName:normalizeName(name),origins:[...origins]}));
}

export async function fetchWikiSamples() {
  const titles=['Bronze platebody','Rune platebody','Mystic wand','Bronze dagger','Bronze 2h sword','Amulet of glory','Torva platebody','Boots of lightness'];
  const url=new URL('https://runescape.wiki/api.php');
  url.search=new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main',titles:titles.join('|'),format:'json',formatversion:'2'});
  const response=await fetch(url);if(!response.ok)throw new Error(`Wiki API ${response.status}`);
  const payload=await response.json();
  return {retrievedAt:new Date().toISOString(),url:String(url),payload};
}

/** Validate only explicit Wiki IDs/fields; multi-version names stay distinct. */
export function validateWikiSamples(evidence,rows) {
  const byId=new Map(rows.map(row=>[row.id,row]));
  return evidence.payload.query.pages.map(page=>{
    const revision=page.revisions?.[0];if(!revision)throw new Error(`Wiki sample missing: ${page.title}`);
    const text=revision.slots.main.content;
    const field=(key,source=text)=>new RegExp(`^\\|${key}\\s*=\\s*([^\\n]*)`,'mi').exec(source)?.[1]?.trim()??null;
    const ids=[...text.matchAll(/^\|id\d*\s*=\s*(\d+)\s*$/gm)].map(match=>Number(match[1]));
    const start=text.indexOf('{{Infobox Bonuses'),bonuses=start<0?'':text.slice(start).split('\n==')[0];
    const fields={};
    for(const [wiki,cache]of Object.entries({armour:'armour',accuracy:'accuracy',prayer:'prayer',strength:'melee_damage',ranged:'ranged_damage',magic:'magic_damage',necromancy:'necromancy_damage'})){
      const value=field(wiki,bonuses);if(value && Number.isFinite(Number(value)))fields[cache]=Number(value);
    }
    const requirements={};for(const match of bonuses.matchAll(/\{\{sc\|([^|}]+)\|(\d+)\}\}/g)){
      const skill=SKILLS.find(skill=>skill.toLowerCase()===match[1].toLowerCase());if(skill)requirements[skill]=Number(match[2]);
    }
    const checks=[];
    for(const id of ids){const row=byId.get(id);if(!row){checks.push({id,field:'id',status:'missing-cache-id'});continue;}
      checks.push({id,field:'name',status:row.name===page.title?'match':'variant-name',cache:row.name});
      for(const [key,value]of Object.entries(fields))checks.push({id,field:key,wiki:value,cache:row.stats[key]??null,
        status:row.stats[key]===undefined?'unavailable-cache-field':Math.abs(value-row.stats[key])<0.051?'match':'difference'});
      const damage=field('damage',bonuses);if(damage && Number.isFinite(Number(damage)))checks.push({id,field:'auto_damage',wiki:Number(damage),cache:row.stats.auto_damage??null,
        status:row.stats.auto_damage===undefined?'unavailable-cache-field':Math.abs(Number(damage)-row.stats.auto_damage)<0.051?'match':'difference'});
      for(const [skill,level]of Object.entries(requirements))checks.push({id,field:`requirements.${skill}`,wiki:level,cache:row.requirements[skill]??null,
        status:row.requirements[skill]===undefined?'unavailable-cache-field':level===row.requirements[skill]?'match':'difference'});
    }
    const weights=Object.fromEntries([...text.matchAll(/^\|(weight\d*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/gm)].map(m=>[m[1],Number(m[2])]));
    return {title:page.title,revid:revision.revid,timestamp:revision.timestamp,
      url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`,
      ids,fields,requirements,wikiWeights:weights,weightStatus:'external Wiki facts; cache weight remains unknown',checks};
  });
}

export async function extractItems({workspace,output,wikiEvidence}={}) {
  if(!output)throw new Error('Use a NEW output directory under the authorized local game-data destination.');
  if(existsSync(resolve(output,'items.manifest.v1.json')))throw new Error('Use a new versioned output directory.');
  const {cache,context}=await openGameCache({workspace});
  try {
    const decoded=loadTable(cache,{major:19,kind:'items'}),params=loadTable(cache,{major:2,minor:11,kind:'params'});
    const rows=[...decoded.definitions].map(([id,raw])=>projectItem(id,raw,params.definitions));
    const definitions=JSON.parse(readFileSync(context.reference.path,'utf8'));
    const comparison=compareEquipment(definitions.equipment,rows);
    const byName=new Map();for(const row of rows)if(row.normalizedName){const ids=byName.get(row.normalizedName)??[];ids.push(row.id);byName.set(row.normalizedName,ids);}
    const itemNames=collectPickerItemNames(definitions).map(row=>({...row,candidateIds:byName.get(row.normalizedName)??[]}));
    const summary={...comparison.summary,decodedItems:rows.length,decodeErrors:decoded.errors.length,paramDefinitions:params.definitions.size,paramErrors:params.errors.length,
      equipmentCandidates:rows.filter(r=>r.equipmentCandidate).length,unnamed:rows.filter(r=>!r.name).length,
      linkedVariants:rows.filter(r=>Object.keys(r.variants).length).length,templates:rows.filter(r=>r.template).length,
      itemNames:itemNames.length,itemNamesUnique:itemNames.filter(r=>r.candidateIds.length===1).length,
      itemNamesAmbiguous:itemNames.filter(r=>r.candidateIds.length>1).length,itemNamesUnmatched:itemNames.filter(r=>!r.candidateIds.length).length,
      sparseStats: Object.fromEntries([...new Set(rows.flatMap(r=>Object.keys(r.stats)))].map(field=>[field,rows.filter(r=>field in r.stats).length])),
      unresolvedRequirementRows:rows.filter(r=>r.unresolvedRequirements.length).length};
    const provenance={schemaVersion:1,generatedAt:context.generatedAt,decoder:context.decoder,reference:context.reference,manifest:'items.manifest.v1.json'};
    context.outputs.push(writeDataset(output,'items.raw.v1.json',{...provenance,records:[...decoded.definitions].map(([id,definition])=>({id,definition})),errors:decoded.errors}));
    context.outputs.push(writeDataset(output,'items.v1.json',{...provenance,semantics:ITEM_SEMANTICS,summary,records:rows}));
    context.outputs.push(writeDataset(output,'items.params.v1.json',{...provenance,records:[...params.definitions].map(([id,definition])=>({id,definition})),errors:params.errors}));
    context.outputs.push(writeDataset(output,'items.comparison.v1.json',{...provenance,summary,equipment:comparison.records,itemNames}));
    if(wikiEvidence)context.outputs.push(writeDataset(output,'items.wiki-samples.v1.json',JSON.parse(readFileSync(wikiEvidence,'utf8'))));
    const result=await finishManifest(cache,context,output,{name:'items.manifest.v1.json',summary,semantics:ITEM_SEMANTICS});
    return {summary,comparison,rows,manifest:result.manifest,manifestFile:result.file};
  }finally{cache.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options=cliOptions();
  const result=await extractItems({workspace:options.workspace,output:options.output,wikiEvidence:options['wiki-evidence']});
  console.log(JSON.stringify({summary:result.summary,manifest:result.manifestFile},null,2));
}
