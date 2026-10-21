#!/usr/bin/env node
// Offline guide extraction. Only copied cache files are opened.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

export const GUIDE_ROOTS = Object.freeze({ skills:108, entries:5420, tabs:5421, internalSkills:681, interface:1218 });
export const GUIDE_HELPERS = Object.freeze({ name:12095, requirementText:12096, level:12098, category:12100, members:2553,displayItemId:14715 });
export const GUIDE_PARAMS = Object.freeze({ name:2210, requirementText:2211, level:2212, item:2213, graphic:2214,
  skill:2215, levelUpText:2216, members:2217, milestone:2218, flag2219:2219, category:2220,
  dbrow:6569, ability:8877, showIngredients:5442, ingredientMode:5443 });
export const enumEntries = d => d?.stringArrayValue1 ?? d?.stringArrayValue2?.values ?? d?.intArrayValue1 ?? d?.intArrayValue2?.values ?? [];
const paramMap = d => new Map((d?.extra ?? []).map(p=>[p.prop,p.stringvalue ?? p.intvalue]));
const source = (major,id,groupSize) => ({major,minor:Math.floor(id/groupSize),subid:id%groupSize});
const configSource = (minor,id) => ({major:2,minor,subid:id});
const TYPED = new Map([[30,'object'],[32,'npc'],[33,'item'],[73,'struct'],[74,'dbrow'],[23,'graphic'],[3,'quest']]);

// The following scrambled instruction encodings are bounded to this copied
// snapshot. Decode complete bodies and require the footer instruction count.
// Semantics are traced at guide call sites; they are not claimed as official
// Jagex opcode names. Unknown encodings or operations fail the field explicitly.
const INT_OPS = new Map([[0x5c3,'iload'],[0x5f0,'istore'],[0x6ba,'sload'],[0x3e,'sstore'],[0x4ed,'jump'],
  [0x11d,'ne'],[0x195,'eq'],[0x76f,'gt'],[0x7e,'ge'],[0x379,'lt'],[0x755,'le'],[0x397,'switch'],[0x87a,'call'],
  [0x1d8,'join'],[0x61c,'player_varbit']]);
const BYTE_OPS = new Map([[0xce,'struct_param'],[0xc8,'item_param'],[0x77b,'db_get'],[0x36a,'db_count'],
  [0x1c5,'db_table'],[0x54,'strlen'],[0x300,'item_name'],[0x5e3,'item_members'],[0x36e,'enum'],[0x3e4,'return'],
  [0x611,'add'],[0x4b8,'subtract'],[0x80a,'random'],[0x6c2,'multiply'],[0x291,'int_string'],[0x5ea,'format_int'],[0x16f,'item_unnote'],[0x3e8,'db_find'],[0x5af,'db_next']]);

export function decodeGuideScript(definition) {
  const b=Buffer.isBuffer(definition.opcodedata) ? definition.opcodedata : typeof definition.opcodedata==='string'
    ? Buffer.from(definition.opcodedata,'hex') : Buffer.from(definition.opcodedata);
  const ops=[]; let at=0;
  while(at<b.length) {
    if(at+2>b.length)throw Error('Truncated guide opcode');
    const offset=at, opcode=b.readUInt16BE(at);at+=2;let name=INT_OPS.get(opcode)??BYTE_OPS.get(opcode),arg;
    if(opcode===0x334) {
      name='push';const tag=b[at++];
      if(tag===0){arg=b.readInt32BE(at);at+=4;}
      else if(tag===2){const end=b.indexOf(0,at);if(end<0)throw Error('Unterminated guide string');arg=b.subarray(at,end).toString('latin1');at=end+1;}
      else throw Error(`Unsupported push type ${tag}`);
    } else if(INT_OPS.has(opcode)){arg=b.readInt32BE(at);at+=4;}
    else if(BYTE_OPS.has(opcode)){arg=b[at++];}
    else throw Error(`Unknown guide encoding 0x${opcode.toString(16)} at ${offset}`);
    if(at>b.length)throw Error('Truncated guide immediate');
    ops.push({offset,opcode,name,arg});
  }
  if(ops.length!==definition.instructioncount)throw Error(`Guide instruction count ${ops.length} != ${definition.instructioncount}`);
  return {...definition,opcodedata:b.toString('hex'),ops};
}

/** Executes only pure guide helpers. Player-state-dependent branches remain unknown. */
export function createGuideEvaluator({enums,structs,items,params,dbrows,dbtables,scripts}) {
  const decoded=new Map(), pMaps=new WeakMap();
  const getParam=(kind,id,param,trace)=>{
    const d=(kind==='struct'?structs:items).get(id);if(!d&&id!==-1)throw Error(`Missing ${kind} ${id}`);
    let p=d?pMaps.get(d):null;if(d&&!p){p=paramMap(d);pMaps.set(d,p);}
    const type=params.get(param)?.type;if(!type)throw Error(`Missing parameter type ${param}`);
    const value=p?.has(param)?p.get(param):type.vartype===36?type.defaultstring:type.defaultint;
    trace.push({kind,id,param,value,origin:p?.has(param)?'explicit':'parameter default'});return value;
  };
  const dbColumn=(rowId,field)=>{
    const row=dbrows.get(rowId);if(!row)throw Error(`Missing dbrow ${rowId}`);
    const tableId=field>>>12,col=(field>>>4)&255,slot=(field&15)-1;
    if(row.table!==tableId)throw Error(`dbrow ${rowId} table ${row.table} != field table ${tableId}`);
    const column=row.rows?.columndata?.find(x=>x.columnid===col);
    const defaults=dbtables.get(tableId)?.columndata?.find(x=>x.id===col)?.columns;
    return {row,tableId,col,slot,column,defaults};
  };
  const run=(id,intArgs,stringArgs,trace,depth=0)=>{
    if(depth>30)throw Error('Guide helper recursion limit');
    if(!decoded.has(id)){const d=scripts.get(id);if(!d)throw Error(`Missing guide helper ${id}`);decoded.set(id,decodeGuideScript(d));}
    const d=decoded.get(id),ints=[...intArgs],strings=[...stringArgs],stack=[],strStack=[];let pc=0,steps=0,find=[];
    const ipop=()=>{if(!stack.length)throw Error(`Integer stack underflow in ${id}:${pc-1}`);return stack.pop();};
    const spop=()=>{if(!strStack.length)throw Error(`String stack underflow in ${id}:${pc-1}`);return strStack.pop();};
    while(pc<d.ops.length) {
      if(++steps>50000)throw Error(`Guide helper step limit ${id}`);
      const op=d.ops[pc++],a=op.arg;
      if(op.name==='push'){(typeof a==='string'?strStack:stack).push(a);continue;}
      if(op.name==='iload'){stack.push(ints[a]??0);continue;}
      if(op.name==='istore'){ints[a]=ipop();continue;}
      if(op.name==='sload'){strStack.push(strings[a]??'');continue;}
      if(op.name==='sstore'){strings[a]=spop();continue;}
      if(op.name==='jump'){pc+=a;continue;}
      if(['eq','ne','gt','ge','lt','le'].includes(op.name)) {
        const right=ipop(),left=ipop();const yes={eq:left===right,ne:left!==right,gt:left>right,ge:left>=right,lt:left<right,le:left<=right}[op.name];
        if(yes)pc+=a;continue;
      }
      if(op.name==='switch'){const value=ipop(),jump=d.switches?.[a]?.find(x=>x.value===value)?.jump;if(jump!=null)pc+=jump;continue;}
      if(op.name==='struct_param'||op.name==='item_param'){
        const param=ipop(),target=ipop(),value=getParam(op.name==='struct_param'?'struct':'item',target,param,trace);
        (params.get(param).type.vartype===36?strStack:stack).push(value);continue;
      }
      if(op.name==='item_name'){const target=ipop(),value=items.get(target)?.name;if(value==null)throw Error(`Missing item name ${target}`);trace.push({kind:'item',id:target,field:'name',value});strStack.push(value);continue;}
      if(op.name==='item_members'){const target=ipop();if(target!==-1&&!items.has(target))throw Error(`Missing item membership ${target}`);const value=items.get(target)?.members===true?1:0;trace.push({kind:'item',id:target,field:'members',value});stack.push(value);continue;}
      if(op.name==='item_unnote'){const target=ipop(),item=items.get(target);if(!item)throw Error(`Missing unnote item ${target}`);stack.push(item.noteTemplate!=null&&item.noteTemplate!==-1?item.noteData:target);continue;}
      if(op.name==='strlen'){stack.push(spop().length);continue;}
      if(op.name==='join'){if(strStack.length<a)throw Error('Guide join stack underflow');strStack.push(strStack.splice(strStack.length-a).join(''));continue;}
      if(op.name==='enum'){
        const key=ipop(),enumId=ipop(),valueType=ipop(),keyType=ipop(),e=enums.get(enumId);
        if(!e)throw Error(`Missing enum ${enumId}`);
        if((e.key_type2??e.key_type1)!==keyType||(e.value_type2??e.value_type1)!==valueType)throw Error(`Enum ${enumId} type mismatch`);
        const map=new Map(enumEntries(e)),value=map.has(key)?map.get(key):valueType===36?e.stringValue:e.intValue;
        trace.push({kind:'enum',id:enumId,key,value});(valueType===36?strStack:stack).push(value);continue;
      }
      if(op.name==='db_table'){const target=ipop(),row=dbrows.get(target);if(!row)throw Error(`Missing dbrow ${target}`);stack.push(row.table);trace.push({kind:'dbrow',id:target,field:'table',value:row.table});continue;}
      if(op.name==='db_count'){const field=ipop(),target=ipop(),c=dbColumn(target,field);stack.push(c.column?.rows?.length??(c.defaults?.some(x=>x.hasdefault)?1:0));continue;}
      if(op.name==='db_get'){
        const index=ipop(),field=ipop(),target=ipop(),c=dbColumn(target,field);
        const types=c.column?.subtypes??c.defaults?.map(x=>x.type);
        const values=c.column?.rows?.[index]??c.defaults?.map(x=>x.hasdefault?x.default:x.type===36?'':0);
        if(!types||!values)throw Error(`Missing dbrow ${target} field ${field} row ${index}`);
        const slots=c.slot<0?types.map((_,i)=>i):[c.slot];
        for(const slot of slots){const value=values[slot];if(value==null)throw Error(`Missing DB tuple slot ${slot}`);(types[slot]===36?strStack:stack).push(value);trace.push({kind:'dbrow',id:target,table:c.tableId,column:c.col,row:index,slot,type:types[slot],value});}continue;
      }
      if(['add','subtract','multiply'].includes(op.name)){const r=ipop(),l=ipop();stack.push(op.name==='add'?l+r:op.name==='subtract'?l-r:l*r);continue;}
      if(op.name==='random')throw Error(`Random display-item selection in helper ${id}`);
      if(op.name==='int_string'){const radix=ipop(),value=ipop();strStack.push(value.toString(radix));continue;}
      if(op.name==='format_int'){const commas=ipop(),value=ipop();strStack.push(commas===1?value.toLocaleString('en-US'):String(value));continue;}
      if(op.name==='player_varbit')throw Error(`Player-state-dependent varbit ${a} in helper ${id}`);
      if(op.name==='db_find'){
        const type=ipop(),value=type===36?spop():ipop(),field=ipop(),tableId=field>>>12,col=(field>>>4)&255,slot=(field&15)-1;
        find=[...dbrows].filter(([,row])=>row.table===tableId&&row.rows?.columndata?.find(c=>c.columnid===col)?.rows?.some(r=>r[slot<0?0:slot]===value)).map(([id])=>id);
        stack.push(find.length);continue;
      }
      if(op.name==='db_next'){stack.push(find.shift()??-1);continue;}
      if(op.name==='call'){
        const target=scripts.get(a);if(!target)throw Error(`Missing helper ${a}`);
        if(stack.length<target.intargcount||strStack.length<target.stringargcount)throw Error(`Guide call stack underflow ${a}`);
        const result=run(a,stack.splice(stack.length-target.intargcount),strStack.splice(strStack.length-target.stringargcount),trace,depth+1);
        stack.push(...result.ints);strStack.push(...result.strings);continue;
      }
      if(op.name==='return')return {ints:stack,strings:strStack};
      throw Error(`Unsupported guide operation ${op.name}`);
    }
    throw Error(`Guide helper ${id} fell off body`);
  };
  return { evaluate(field,structId,trace=[]) {
    try {const result=run(GUIDE_HELPERS[field],[structId,-1],[],trace);return {value:(field==='name'||field==='requirementText'?result.strings:result.ints).at(-1)??null,trace,error:null};}
    catch(error){return {value:null,trace,error:error.message};}
  },decoded };
}

export function extractSkillGuides(tables) {
  const {enums,structs,items,params,dbrows,dbtables,scripts,interfaces}=tables;
  const skillsEnum=enums.get(108),skillNames=new Map(enumEntries(skillsEnum)),entryRoots=enums.get(5420),tabRoots=enums.get(5421);
  for(const[id,d]of[[5420,entryRoots],[5421,tabRoots]])if((d?.value_type2??d?.value_type1)!==26)throw Error(`Guide root ${id} is not typed enum`);
  const evaluator=createGuideEvaluator(tables),skills=[],entries=[],unresolved=[];
  const tabPointers=new Map(enumEntries(tabRoots)),usedStructs=new Set(),usedDbrows=new Set(),usedItems=new Set(),usedEnums=new Set([108,5420,5421,681]);
  const addTyped=(links,kind,id,origin)=>{if(!Number.isInteger(id)||id<0)return;links.push({kind,id,...origin});if(kind==='item')usedItems.add(id);if(kind==='dbrow')usedDbrows.add(id);if(kind==='struct')usedStructs.add(id);};
  for(const[skillId,entriesEnumId]of enumEntries(entryRoots)) {
    if(!skillNames.has(skillId))throw Error(`Guide skill ${skillId} absent from enum108`);
    const tabsEnumId=tabPointers.get(skillId),list=enums.get(entriesEnumId),tabsDef=enums.get(tabsEnumId);
    if((list?.value_type2??list?.value_type1)!==73)throw Error(`Guide list ${entriesEnumId} is not typed struct`);
    if((tabsDef?.value_type2??tabsDef?.value_type1)!==36)throw Error(`Guide tabs ${tabsEnumId} are not strings`);
    const tabs=enumEntries(tabsDef).map(([id,name])=>({id,name})),tabNames=new Map(tabs.map(t=>[t.id,t.name]));
    usedEnums.add(entriesEnumId);usedEnums.add(tabsEnumId);
    const entryIds=[];
    for(const[order,structId]of enumEntries(list)) {
      usedStructs.add(structId);const definition=structs.get(structId);
      if(!definition)throw Error(`Guide struct ${structId} missing`);
      const p=paramMap(definition),fields={},unknowns=[];
      for(const field of Object.keys(GUIDE_HELPERS)){fields[field]=evaluator.evaluate(field,structId);if(fields[field].error)unknowns.push({field,reason:fields[field].error});}
      // Renderer16268 calls the above pure helpers, then replaces production
      // level/membership for single-primary-skill products before filtering and
      // drawing. Its guarded prefix is preserved in supportScripts.
      const renderItemId=fields.displayItemId.value??p.get(2213)??-1,renderItem=items.get(renderItemId),renderParams=paramMap(renderItem);
      const itemParam=id=>renderParams.has(id)?renderParams.get(id):params.get(id)?.type?.defaultint;
      if(renderItem&&itemParam(2640)>0&&itemParam(2640)!==62&&itemParam(2641)===0&&itemParam(2640)===skillId) {
        fields.level.value=itemParam(2645);
        fields.level.trace.push({kind:'item',id:renderItemId,param:2645,value:fields.level.value,origin:renderParams.has(2645)?'explicit renderer16268 production override':'parameter default renderer16268 production override'});
        const membershipInputs=[renderItemId,itemParam(2655),itemParam(2656),itemParam(2650)].filter(id=>Number.isInteger(id)&&id>=0);
        if(itemParam(2639)===1||membershipInputs.some(id=>items.get(id)?.members===true)) {
          fields.members.value=1;
          fields.members.trace.push({kind:'renderer',id:16268,field:'production members',value:1,productItemId:renderItemId,param2639:itemParam(2639),membershipInputs});
        }
      }
      const links=[];
      for(const row of definition.extra??[]){const kind=TYPED.get(params.get(row.prop)?.type?.vartype);if(kind)addTyped(links,kind,row.intvalue,{param:row.prop,source:source(22,structId,32)});}
      for(const result of Object.values(fields))for(const step of result.trace){
        if(step.kind==='item')usedItems.add(step.id);if(step.kind==='enum')usedEnums.add(step.id);
        if(step.kind==='dbrow')usedDbrows.add(step.id);if(step.kind==='struct')usedStructs.add(step.id);
        if(step.kind==='dbrow'&&TYPED.has(step.type))addTyped(links,TYPED.get(step.type),step.value,{dbrowId:step.id,column:step.column,row:step.row,slot:step.slot,source:configSource(41,step.id)});
        if(step.param!=null&&TYPED.has(params.get(step.param)?.type?.vartype))addTyped(links,TYPED.get(params.get(step.param).type.vartype),step.value,{param:step.param,source:step.kind==='item'?source(19,step.id,256):source(22,step.id,32)});
      }
      const id=`cache:struct:${structId}:skill:${skillId}`,itemId=renderItemId,itemDefinition=items.get(itemId);
      const categoryId=fields.category.value,categoryName=tabNames.get(categoryId)??null;
      if(categoryId!=null&&!categoryName)unknowns.push({field:'category',reason:`Category ${categoryId} absent from tabs enum ${tabsEnumId}`});
      if(fields.name.value==='')unknowns.push({field:'name',reason:'Guide title helper returns empty string'});
      if(fields.level.value===0)unknowns.push({field:'level',reason:'Guide level helper returns zero; preserve sentinel'});
      const normalizedLinks=[...new Map(links.map(x=>[JSON.stringify(x),x])).values()];
      const entry={id,structId,skillId,skill:skillNames.get(skillId),order,level:fields.level.value,name:fields.name.value,
        activity:fields.name.value,rawTitle:p.get(2210)??null,item:itemId<0?null:{id:itemId,name:itemDefinition?.name??null,membersMarked:itemDefinition?.members===true,definitionPresent:items.has(itemId)},
        category:{id:categoryId,name:categoryName},members:fields.members.value==null?null:fields.members.value===1,
        membersOrigin:'guide helper2553 plus renderer16268 production override; parameter zero alone is not F2P proof',
        requirementText:fields.requirementText.value,rawRequirementText:p.get(2211)??null,
        requirementTextScope:'Guide additional display text; not a complete executable requirement gate',
        levelUpText:p.get(2216)??'',milestone:(p.get(2218)??0)===1,flag2219:p.get(2219)??params.get(2219)?.type?.defaultint??null,
        linkedIds:normalizedLinks,source:source(22,structId,32),pointerSource:{...source(17,entriesEnumId,256),key:order},rawParams:definition.extra??[],
        evaluation:Object.fromEntries(Object.entries(fields).map(([field,r])=>[field,{helper:GUIDE_HELPERS[field],trace:r.trace,error:r.error}])),unknowns};
      entries.push(entry);entryIds.push(id);if(unknowns.length)unresolved.push({id,skillId,structId,unknowns});
    }
    skills.push({id:skillId,name:skillNames.get(skillId),entriesEnumId,tabsEnumId,source:source(17,entriesEnumId,256),tabsSource:source(17,tabsEnumId,256),tabs,entryIds,entryCount:entryIds.length});
  }
  const actualSkillIds=new Set(skills.map(s=>s.id));
  const excluded=enumEntries(skillsEnum).filter(([id])=>!actualSkillIds.has(id)).map(([id,name])=>({id,name,reason:'No entry/tab pointer in guide roots; enum108 includes the Quest point pseudo-skill'}));
  if(excluded.some(x=>x.id!==31))throw Error('Real enum108 skill omitted by guide roots');
  const interfaceRows=[...interfaces].filter(([id])=>Math.floor(id/65536)===1218).map(([id,definition])=>({id,source:source(3,id,65536),definition}));
  const selectors=interfaceRows.filter(x=>x.definition.scripts?.triggerop?.[0]===5682).map(x=>({componentId:x.id,skillId:x.definition.scripts.triggerop[1]}));
  if(selectors.length!==skills.length||new Set(selectors.map(x=>x.skillId)).size!==skills.length||selectors.some(x=>!actualSkillIds.has(x.skillId)))throw Error('Guide interface selectors do not cover guide skill roots');
  const coverage={skills:skills.length,entries:entries.length,tabs:skills.reduce((n,s)=>n+s.tabs.length,0),excludedEnum108Entries:excluded,
    uiSelectors:selectors,unresolvedEntries:unresolved.length,fieldUnknownCounts:Object.fromEntries(Object.keys(GUIDE_HELPERS).map(f=>[f,entries.filter(e=>e.unknowns.some(x=>x.field===f)).length])),
    counts:skills.map(s=>({skillId:s.id,skill:s.name,entries:s.entryCount,tabs:s.tabs.length,unresolved:entries.filter(e=>e.skillId===s.id&&e.unknowns.length).length}))};
  const usedParams=new Set(entries.flatMap(e=>[...e.rawParams.map(p=>p.prop),...Object.values(e.evaluation).flatMap(f=>f.trace.map(t=>t.param).filter(x=>x!=null))]));
  return {schemaVersion:1,skills,entries,coverage,unresolved,
    graph:{roots:GUIDE_ROOTS,helpers:GUIDE_HELPERS,params:GUIDE_PARAMS,interpretation:'Typed enum roots and fully consumed client helper bytecode; no string matching joins'},
    definitions:{enums:[...usedEnums].sort((a,b)=>a-b).map(id=>({id,source:source(17,id,256),definition:enums.get(id)})),
      structs:[...usedStructs].sort((a,b)=>a-b).map(id=>({id,source:source(22,id,32),definition:structs.get(id)})),
      dbrows:[...usedDbrows].sort((a,b)=>a-b).map(id=>({id,source:configSource(41,id),definition:dbrows.get(id)})),
      items:[...usedItems].filter(id=>id>=0).sort((a,b)=>a-b).map(id=>({id,source:source(19,id,256),definition:items.get(id)})),
      params:[...params].filter(([id])=>usedParams.has(id)).map(([id,definition])=>({id,source:configSource(11,id),definition})),
      interfaces:interfaceRows,scripts:[...scripts].map(([id,d])=>({id,source:{major:12,minor:id,subid:0},...d,opcodedata:Buffer.from(d.opcodedata).toString('hex'),
        ops:evaluator.decoded.get(id)?.ops??null})),supportScripts:[...(tables.supportScripts??[])].map(([id,d])=>({id,source:{major:12,minor:id,subid:0},...d,opcodedata:Buffer.from(d.opcodedata).toString('hex')}))},
    limits:['Copied snapshot is not guaranteed latest live data.','Guide display is not authoritative server execution, quest completion, inventory, XP, duration or geographic accessibility.',
      'Player-state-dependent helper branches and unsupported operations remain explicit unknowns.','Graphic IDs are icon references, not NPC IDs. Only typed references are linked.']};
}

export async function runExtraction(options={}) {
  const output=resolve(options.output??'C:/Users/User/Projects/rs3-cache-work/skillguide-trace-output-v1');
  const {cache,context}=await openGameCache({workspace:options.workspace});
  try {
    const specs={enums:{major:17,kind:'enum'},structs:{major:22,kind:'struct',groupSize:32},items:{major:19,kind:'item'},
      params:{major:2,minor:11,kind:'param'},dbrows:{major:2,minor:41,kind:'dbrow'},dbtables:{major:2,minor:40,kind:'dbtable'},
      interfaces:{major:3,kind:'interface',groupSize:65536}};
    const tables={},errors={},counts={};
    for(const[name,spec]of Object.entries(specs)){const t=loadTable(cache,spec);tables[name]=t.definitions;errors[name]=t.errors;counts[name]=t.definitions.size;}
    // Obtain only the pure helper closure. Calls are recognized after complete
    // decoding; unsupported helpers are retained raw and evaluated as unknown.
    tables.scripts=new Map();const queue=Object.values(GUIDE_HELPERS),scriptErrors=[];
    while(queue.length){const id=queue.shift();if(tables.scripts.has(id))continue;const bytes=cache.file(12,id);if(!bytes){scriptErrors.push({id,message:'Missing copied helper'});continue;}
      const definition=cache.decoders.decode('clientscriptdata',bytes);tables.scripts.set(id,definition);
      try{const decoded=decodeGuideScript(definition);for(const op of decoded.ops)if(op.name==='call'&&!tables.scripts.has(op.arg))queue.push(op.arg);}
      catch(error){scriptErrors.push({id,message:error.message});}
    }
    tables.supportScripts=new Map();for(const id of[487,5682,5683,5690,5691,16268]){const bytes=cache.file(12,id);if(!bytes)throw Error(`Missing guide UI script ${id}`);tables.supportScripts.set(id,cache.decoders.decode('clientscriptdata',bytes));}
    const dataset=extractSkillGuides(tables);dataset.generatedAt=context.generatedAt;
    const referenceSpecs={item:{major:19,kind:'item',groupSize:256},npc:{major:18,kind:'npc',groupSize:128},object:{major:16,kind:'loc',groupSize:256},struct:{major:22,kind:'struct',groupSize:32},dbrow:{major:2,minor:41,kind:'dbrow'}};
    const targetErrors=[],targetDefinitions=new Map();
    for(const entry of dataset.entries)for(const link of entry.linkedIds){
      const spec=referenceSpecs[link.kind];if(!spec)continue;
      const targetSource=spec.minor!=null?configSource(spec.minor,link.id):source(spec.major,link.id,spec.groupSize),key=`${link.kind}:${link.id}`;
      if(!targetDefinitions.has(key)) {
        let definition=({item:tables.items,struct:tables.structs,dbrow:tables.dbrows}[link.kind])?.get(link.id);
        if(!definition&&['npc','object'].includes(link.kind))try{const bytes=cache.archive(targetSource.major,targetSource.minor)?.get(targetSource.subid);if(bytes)definition=cache.decoders.decode(spec.kind,bytes);}catch(error){targetErrors.push({kind:link.kind,id:link.id,source:targetSource,message:error.message});}
        targetDefinitions.set(key,{kind:link.kind,id:link.id,source:targetSource,definition:definition??null});
      }
      link.targetSource=targetSource;link.targetDefinitionPresent=targetDefinitions.get(key).definition!=null;
      if(!link.targetDefinitionPresent)entry.unknowns.push({field:'linkedIds',reason:`Missing target definition ${key}`});
    }
    dataset.definitions.linkedEntityTargets=[...targetDefinitions.values()].filter(x=>['npc','object'].includes(x.kind));
    dataset.targetReferenceAudit={counts:Object.fromEntries(['item','npc','object','struct','dbrow'].map(kind=>[kind,[...targetDefinitions.values()].filter(x=>x.kind===kind).length])),errors:targetErrors};
    dataset.decodeAudit={counts,errors,scriptErrors,targetErrors};
    dataset.provenance={decoder:context.decoder,reference:context.reference,extractor:{path:'scripts/cache/game-data-skill-guides.mjs',sha256:sha256RepositoryText(readFileSync(import.meta.filename)),hashScope:'repository text normalized to LF'},
      helpers:[...tables.scripts,...tables.supportScripts].map(([id,d])=>({id,source:{major:12,minor:id,subid:0},instructionCount:d.instructioncount,bodySha256:sha256(Buffer.from(d.opcodedata)),footerValidated:true,
        instructionEncodingValidated:tables.scripts.has(id),role:tables.supportScripts.has(id)?'UI routing or renderer evidence':'pure helper closure'}))};
    context.outputs.push(writeDataset(output,'skill-guides.v1.json',dataset));
    context.outputs.push(writeDataset(output,'skill-guides-summary.v1.json',{schemaVersion:1,generatedAt:context.generatedAt,coverage:dataset.coverage,graph:dataset.graph,decodeAudit:dataset.decodeAudit,limits:dataset.limits}));
    const finished=await finishManifest(cache,context,output,{name:'skill-guides-manifest.v1.json',dataset:'skill-guides',extractor:dataset.provenance.extractor,helpers:dataset.provenance.helpers,coverage:dataset.coverage,decodeAudit:dataset.decodeAudit,
      evidenceJoin:'Every normalized source major:minor joins a decompressed archive SHA-256 below; subid identifies the definition within that archive.'});
    return {output,files:[...context.outputs,finished.file],coverage:dataset.coverage,decodeAudit:dataset.decodeAudit};
  } finally {cache.close();}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)console.log(JSON.stringify(await runExtraction(cliOptions())));
