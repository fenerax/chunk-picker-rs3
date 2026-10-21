#!/usr/bin/env node
// Private offline inventory. Nothing in app/ consumes this module or its outputs.
import { readFileSync, existsSync, createWriteStream, createReadStream, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, createGzip, createGunzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { buildSurfaceLayout, sourceToSurface, mapsquareId, inCrop, unpackCoord } from './surface.mjs';
import { plainLabel, morphInfo } from './pins.mjs';
import { sha256, fileSha256 } from './cache-reader.mjs';

const validId = id => Number.isInteger(id) && id >= 0 && ![32767,65535,16777215].includes(id);
const actionsOf = d => Object.entries(d ?? {}).filter(([k]) => /^actions_[0-4]$/.test(k)).map(([,v]) => plainLabel(v)).filter(v => v && !/^hidden$/i.test(v));
const memberActionsOf = d => Object.entries(d ?? {}).filter(([k]) => /^members_action_[1-5]$/.test(k)).map(([,v]) => plainLabel(v)).filter(Boolean);
const normalizedName = n => plainLabel(n).replace(/~\|([^|]+)\|~/g, '$1').replaceAll('*','').toLowerCase();
const effectiveDisplayPlane = p => p.source?.effectivePlane == null ? p.plane : p.source.effectivePlane + p.transform.translation.plane;

/** Stream arrays one row at a time to avoid V8's single-string limit. */
export async function writeObjectDataset(output,name,data) {
  if(!name.endsWith('.gz'))return writeDataset(output,name,data);
  const path=resolve(output,name);mkdirSync(resolve(path,'..'),{recursive:true});
  if(existsSync(path))throw new Error('Object dataset already exists; use a new output');
  const gzip=createGzip(),destination=createWriteStream(path,{flags:'wx'}),done=pipeline(gzip,destination);
  done.catch(()=>{});
  const write=async s=>{if(!gzip.write(s))await once(gzip,'drain');};
  try {
    await write('{');let field=0;
    for(const [key,value]of Object.entries(data)){if(field++)await write(',');await write(`${JSON.stringify(key)}:`);
      if(Array.isArray(value)){await write('[');for(let i=0;i<value.length;i++){if(i)await write(',');await write(JSON.stringify(value[i]));}await write(']');}
      else await write(JSON.stringify(value));
    }
    await write('}');gzip.end();await done;
  }catch(e){gzip.destroy(e);await done.catch(()=>{});throw e;}
  return {path:path.replaceAll('\\','/'),bytes:statSync(path).size,sha256:await fileSha256(path)};
}

/** Read a top-level array without allocating one enormous JSON string. */
export async function* readObjectRecords(path,field) {
  const stream=createReadStream(path).pipe(createGunzip());stream.setEncoding('utf8');
  let prefix='',started=false,depth=0,quoted=false,escaped=false,row='',done=false;
  const token=`${JSON.stringify(field)}:[`;
  for await(const chunk of stream){let value=chunk;
    if(!started){prefix+=value;const at=prefix.indexOf(token);if(at<0){if(prefix.length>4*1024*1024)throw new Error('Object array header not found');continue;}value=prefix.slice(at+token.length);prefix='';started=true;}
    for(const c of value){if(done)break;
      if(!depth){if(c===']'){done=true;break;}if(/[\s,]/.test(c))continue;if(c!=='{')throw new Error('Expected object record');depth=1;row='{';continue;}
      row+=c;if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
      else if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(!depth){yield JSON.parse(row);row='';}}
    }
  }
  if(!started||!done||depth)throw new Error('Truncated object dataset');
}

/** Labels/actions establish review categories, never skill levels, products or routes. */
export function classifyObject(d) {
  const name = plainLabel(d?.name), actions = [...actionsOf(d), ...memberActionsOf(d)], out = [];
  if (/\b(tree|oak|willow|yew|maple|acadia|teak|mahogany|bamboo)\b/i.test(name) && actions.some(a => /cut|chop/i.test(a))) out.push('tree');
  if (actions.some(a => /^mine(?:$|\b)/i.test(a))) out.push('mining-resource');
  if (describeObject(d).facilityTypes.length) out.push('facility-candidate');
  if (/\b(door|gate|portcullis|stair(?:s|case)?|ladder|trapdoor|cave|entrance|exit|portal|tunnel|passage|gangplank|bridge|hatch|rope|lift|elevator|shortcut)\b/i.test(name)
      || actions.some(a => /^(open|close|enter|exit|climb|cross|crawl|descend|ascend|travel|teleport|jump|squeeze)(?:$|[- ]|through)/i.test(a))) out.push('transition-candidate');
  return out;
}

/** Type names use definition text/action evidence; generic scenery stays unknown. */
export function describeObject(d) {
  const name=plainLabel(d?.name),actions=[...actionsOf(d),...memberActionsOf(d)],treeCandidate=/\b(tree|oak|willow|yew|maple|acadia|teak|mahogany|bamboo)\b/i.test(name)&&actions.some(a=>/cut|chop/i.test(a)),oreCandidate=actions.some(a=>/^mine(?:$|\b)/i.test(a));
  const treeType=treeCandidate?name.match(/\b(acadia|oak|willow|yew|maple|teak|mahogany|elder|magic|arctic pine|pine|eucalyptus|bamboo|bloodwood|crystal|blisterwood)\b/i)?.[1]?.toLowerCase()??null:null;
  const oreType=oreCandidate?name.match(/\b(pure essence|rune essence|luminite|clay|red sandstone|crystal-flecked sandstone|sandstone|granite|limestone|gem|copper|tin|iron|coal|silver|gold|mithril|adamantite|runite|orichalcite|drakolith|necrite|phasmatite|banite|light animica|dark animica|novite|bathus|marmaros|kratonium|fractite|zephyrium|argonite|katagon|gorgonite|promethium|primal)\b/i)?.[1]?.toLowerCase()??null:null;
  const patterns={bank:/\bbank\b/i,altar:/\baltar\b/i,furnace:/\bfurnace\b/i,anvil:/\banvil\b/i,forge:/\bforge\b/i,'cooking-range':/^(?:range|cooking range)$|\bstove\b/i,'spinning-wheel':/\bspinning wheel\b/i,loom:/\bloom\b/i,'farming-patch':/\b(patch|allotment)\b/i,'hunter-spot':/\b(hunter|hunting|tracking|trapping|butterfly|bird snare|box trap)\b/i,obelisk:/\bobelisk\b/i,'water-source':/\b(water source|well|sink|fountain|water pump)\b/i,workbench:/\bworkbench\b/i,pottery:/\b(pottery|potter|kiln)\b/i,sawmill:/\bsawmill\b/i,tanning:/\btanning\b/i};
  const facilityTypes=Object.entries(patterns).filter(([,pattern])=>pattern.test(name)).map(([type])=>type);
  if(/\b(fire|bonfire|campfire)\b/i.test(name)&&actions.some(a=>/cook/i.test(a)))facilityTypes.push('cooking-fire');
  return {evidence:'decoded definition name/actions; semantic review categories',name,tree:{candidate:treeCandidate,type:treeType,typeStatus:treeCandidate?(treeType?'named-type':'unknown-generic-tree'):'not-classified'},ore:{candidate:oreCandidate,type:oreType,typeStatus:oreCandidate?(oreType?'named-type':'unknown-mining-resource-type'):'not-classified'},facilityTypes,facilityStatus:facilityTypes.length?'name-action-candidate':'not-classified',membership:{classification:d?.is_members||d?.isMembers?'cache-flagged-members':'unknown-without-geographic-and-server-evidence',is_members:d?.is_members??null,isMembers:d?.isMembers??null},requirements:null};
}

export function classificationCounts(placements) {
  const counts={treeTypes:{},oreTypes:{},facilityTypes:{},membersFlagged:0};
  for(const p of placements){const branches=[p.classification,...(p.alternatives??[]).map(a=>a.classification)].filter(Boolean);
    for(const type of new Set(branches.filter(c=>c.tree.candidate).map(c=>c.tree.type??'unknown-generic')))counts.treeTypes[type]=(counts.treeTypes[type]??0)+1;
    for(const type of new Set(branches.filter(c=>c.ore.candidate).map(c=>c.ore.type??'unknown-generic')))counts.oreTypes[type]=(counts.oreTypes[type]??0)+1;
    for(const type of new Set(branches.flatMap(c=>c.facilityTypes)))counts.facilityTypes[type]=(counts.facilityTypes[type]??0)+1;
    if(branches.some(c=>c.membership.classification==='cache-flagged-members'))counts.membersFlagged++;
  }
  return counts;
}

export function inventoryObjectParams(definitions,params,readStruct) {
  const records=[],errors=[];
  const coordinates=extra=>(extra??[]).filter(row=>params.get(row.prop)?.type?.vartype===22&&Number.isInteger(row.intvalue)&&row.intvalue!==-1).map(row=>({param:row.prop,packed:row.intvalue,...unpackCoord(row.intvalue),meaning:'typed coordgrid; not proven destination'}));
  for(const [objectId,d]of definitions){const coordinateHints=coordinates(d.extra),structReferences=[];
    for(const row of d.extra??[])if(params.get(row.prop)?.type?.vartype===73&&validId(row.intvalue)){
      try{const raw=readStruct(row.intvalue);structReferences.push({param:row.prop,structId:row.intvalue,present:!!raw,coordinateHints:coordinates(raw?.extra),rawParams:raw?.extra??null,meaning:'typed struct reference; semantics unknown'});}catch(e){errors.push({objectId,param:row.prop,structId:row.intvalue,message:e.message});}
    }
    if(coordinateHints.length||structReferences.length)records.push({objectId,name:plainLabel(d.name),transitionDefinition:classifyObject(d).includes('transition-candidate'),coordinateHints,structReferences});
  }
  return {counts:{objectDefinitionsWithHints:records.length,directCoordinateHints:records.reduce((n,r)=>n+r.coordinateHints.length,0),structReferences:records.reduce((n,r)=>n+r.structReferences.length,0),referencedStructCoordinateHints:records.reduce((n,r)=>n+r.structReferences.reduce((s,t)=>s+t.coordinateHints.length,0),0),transitionDefinitionsWithHints:records.filter(r=>r.transitionDefinition).length,certifiedDestinations:0},records,errors};
}

function attachObjectParamHints(cache,definitions,transitions) {
  const params=loadTable(cache,{major:2,minor:11,kind:'param'}),structCache=new Map();
  const paramHints=inventoryObjectParams(definitions,params.definitions,id=>{if(!structCache.has(id))structCache.set(id,cache.object(22,id,'struct',32));return structCache.get(id);});
  const hintsByObject=new Map(paramHints.records.map(r=>[r.objectId,r]));
  for(const p of transitions)p.encodedCoordinateHints=[...new Set([p.objectId,...p.alternatives.map(a=>a.objectId)])].map(id=>hintsByObject.get(id)).filter(Boolean);
  return {params,paramHints};
}

/** All encoded branches, including absent-state sentinels. No active branch selected. */
export function morphAlternatives(id, definitions, path = []) {
  const d = definitions.get(id);
  if (!d) return [{ objectId:id, path, problem:'missing-definition' }];
  if (path.some(s => s.objectId === id)) return [{ objectId:id, path, problem:'cycle' }];
  const m = morphInfo(d);
  if (!m) return [{objectId:id, name:plainLabel(d.name), actions:actionsOf(d), memberActions:memberActionsOf(d), classes:classifyObject(d), classification:describeObject(d),path}];
  const options = [...m.options.map((child,option) => ({child,option})), {child:m.default,option:'encoded-tail'}, ...(m.kind==='morphs_2'?[{child:m.unk2,option:'fallback'}]:[])];
  return options.flatMap(({child,option}) => {
    const next = [...path,{objectId:id,kind:m.kind,varbit:m.varbit,varp:m.varp,option,selectedObjectId:child}];
    return validId(child) ? morphAlternatives(child,definitions,next) : [{objectId:child,path:next,absentState:true}];
  });
}

export function compareRetainedObjects(placements, definitions, reference, coveredChunks) {
  const current = new Map(), retained = new Map(), rows = [], nonComparable = [];
  for (const p of placements) {
    if (p.mapId!==28 || effectiveDisplayPlane(p)!==0 || !inCrop(p.x,p.y)) continue;
    const chunk=p.chunkId, names=new Set([definitions.get(p.objectId)?.name,...(p.alternatives ?? []).map(a=>a.name)].map(normalizedName).filter(Boolean));
    if(!current.has(chunk))current.set(chunk,new Map());
    for(const name of names){const v=current.get(chunk).get(name)??{placements:0,objectIds:new Set(),conditional:false};v.placements+=p.multiplicity??1;v.objectIds.add(p.objectId);v.conditional ||= !!p.alternatives?.length;current.get(chunk).set(name,v);}
  }
  for(const [chunk,record] of Object.entries(reference.chunks??{})) {
    const inspect=(node,location)=>{
      for(const [name,count] of Object.entries(node.Object??{})){if(!retained.has(chunk))retained.set(chunk,new Map());const key=normalizedName(name),v=retained.get(chunk).get(key)??{name,count:0,locations:[]};v.count+=Number(count)||0;v.locations.push(location);retained.get(chunk).set(key,v);}
      for(const kind of ['Shop','Spawn'])for(const [name,count]of Object.entries(node[kind]??{}))nonComparable.push({chunk,location,kind,name,count,reason:kind==='Shop'?'Object placements do not certify shop proprietor or stock':'Object locations do not encode server item ground spawns'});
    };
    inspect(record,chunk);for(const [section,node]of Object.entries(record.Sections??{}))inspect(node,`${chunk}-${section}`);
  }
  for(const chunk of [...new Set([...current.keys(),...retained.keys(),...coveredChunks])].sort((a,b)=>Number(a)-Number(b))){
    const coverage=coveredChunks.has(chunk)?'decoded-layout-source':'not-covered';
    for(const name of new Set([...(current.get(chunk)?.keys()??[]),...(retained.get(chunk)?.keys()??[])])){
      const c=current.get(chunk)?.get(name),r=retained.get(chunk)?.get(name);
      rows.push({chunk,name,coverage,retainedCount:r?.count??0,currentPossiblePlacements:c?.placements??0,objectIds:[...(c?.objectIds??[])],conditional:c?.conditional??false,locations:r?.locations??[],classification:c&&r?'same-name-present':c?'cache-only-candidate':coverage==='not-covered'?'unknown-coverage':'retained-only-candidate',verifiedAddition:false,verifiedRemoval:false});
    }
  }
  const chunkCounts=new Map();for(const row of rows){if(!chunkCounts.has(row.chunk))chunkCounts.set(row.chunk,{chunk:row.chunk,coverage:row.coverage,counts:Object.fromEntries(['same-name-present','cache-only-candidate','retained-only-candidate','unknown-coverage'].map(k=>[k,0]))});chunkCounts.get(row.chunk).counts[row.classification]++;}
  // Include empty and unmapped crop addresses, not just chunks with named resources.
  for(let rx=29;rx<76;rx++)for(let ry=22;ry<72;ry++){const chunk=String(rx*256+ry);if(!chunkCounts.has(chunk))chunkCounts.set(chunk,{chunk,coverage:coveredChunks.has(chunk)?'decoded-layout-source':'not-covered',counts:Object.fromEntries(['same-name-present','cache-only-candidate','retained-only-candidate','unknown-coverage'].map(k=>[k,0]))});}
  const byChunk=[...chunkCounts.values()];
  return {method:'Exact normalized names per displayed surface effective plane0 chunk with decoded bridge rule; section counts aggregated without guessed geometry. Alternatives are possible, not simultaneous.',counts:Object.fromEntries(['same-name-present','cache-only-candidate','retained-only-candidate','unknown-coverage'].map(k=>[k,rows.filter(r=>r.classification===k).length])),byChunk,rows,nonComparable,renameCandidates:[],renameLimit:'No old numeric object IDs or tile positions: no defensible rename pairing. Count differences are advisory.'};
}

export function joinDoorDiagnostics(doors, sourcePlacements, definitions) {
  const key=p=>[p.objectId,p.x,p.y,p.type,p.rotation].join(':'), bySource=new Map();
  for(const p of sourcePlacements){const k=key(p);if(!bySource.has(k))bySource.set(k,[]);bySource.get(k).push(p);}
  const rows=doors.map(d=>{
    const candidates=bySource.get(key({objectId:d.locId,x:d.sourceX??d.x,y:d.sourceZ??d.z,type:d.type,rotation:d.rotation}))??[];
    const matches=d.plane==null?candidates:candidates.filter(p=>p.plane===d.plane);
    const ambiguous=d.plane==null&&new Set(matches.map(p=>p.plane)).size>1;
    const def=definitions.get(d.locId),actions=actionsOf(def),alternatives=morphInfo(def??{})?morphAlternatives(d.locId,definitions):[];
    return {diagnostic:d,matches:matches.map(p=>p.id),name:plainLabel(def?.name),actions,alternatives,
      resolution:!matches.length?'unmatched-source-anchor':ambiguous?'ambiguous-source-plane':matches.length>1?'ambiguous-source-ordinal':alternatives.length?'conditional-state-review':actions.some(a=>/^(open|close)$/i.test(a))?'open-close-action-needs-passability-evidence':'destination-or-server-rule-review',
      passableWhenOpen:null,destination:null,requirements:null,apply:false};
  });
  return {counts:{diagnostics:rows.length,matched:rows.filter(r=>r.matches.length).length,uniquelyMatched:rows.filter(r=>r.matches.length===1).length,...Object.fromEntries([...new Set(rows.map(r=>r.resolution))].map(k=>[k,rows.filter(r=>r.resolution===k).length])),certifiedOpenable:0},rows,proposal:'Join succeeds without granting access. Inspect branch clipping and server/quest constraints; obtain independent passability evidence before any openable-evidence input.'};
}

/** Deliberately narrow Wiki field extraction; raw API responses stay in scratch. */
export function validateWikiObjects(apiResponses, definitions, placements) {
  const pages=apiResponses.flatMap(r=>Object.values(r.query?.pages??{})),results=[];
  for(const page of pages){
    const rev=page.revisions?.[0],text=rev?.slots?.main?.['*'];if(!text)continue;
    const fields=Object.fromEntries([...text.matchAll(/^\|\s*(name|members\d*|options\d*|actions\d*|id\d*)\s*=\s*(.*)$/gm)].filter(m=>/^(name|members\d*|options\d*|actions\d*|id\d*)$/.test(m[1])).map(m=>[m[1],m[2].trim()]));
    const ids=[...new Set(Object.entries(fields).filter(([k])=>/^id\d*$/.test(k)).flatMap(([,v])=>v.split(',').map(s=>Number(s.trim())).filter(Number.isInteger)))];
    const coordinates=[];
    for(const block of text.matchAll(/\{\{(?:ObjectLocLine|RockLocLine)([\s\S]*?)\}\}/g)) {
      const mapId=Number(block[1].match(/\|mapID\s*=\s*(\d+)/)?.[1]??28),plane=Number(block[1].match(/\|plane\s*=\s*(\d+)/)?.[1]??0);
      for(const m of block[1].matchAll(/objectid:(\d+),x:(\d+),y:(\d+)/g))coordinates.push({objectId:Number(m[1]),x:Number(m[2]),y:Number(m[3]),mapId,plane});
    }
    for(const m of text.matchAll(/\{\{Object map\|[^}]*?objectid=(\d+)\|x:(\d+),y:(\d+)/g))coordinates.push({objectId:Number(m[1]),x:Number(m[2]),y:Number(m[3]),mapId:28,plane:0});
    const checkedCoordinates=coordinates.slice(0,6).map(c=>({...c,cacheMatches:placements.filter(p=>p.objectId===c.objectId&&p.mapId===c.mapId&&p.plane===c.plane&&p.x===c.x&&p.y===c.y).map(p=>p.id)}));
    results.push({title:page.title,url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}`,revision:rev.revid,revisionTimestamp:rev.timestamp,revisionUrl:`https://runescape.wiki/w/Special:Redirect/revision/${rev.revid}`,fields,
      definitions:ids.map(objectId=>{const d=definitions.get(objectId);return {objectId,present:!!d,name:plainLabel(d?.name),actions:actionsOf(d),memberActions:memberActionsOf(d),membersFlags:{is_members:d?.is_members??null,isMembers:d?.isMembers??null}};}),coordinates:checkedCoordinates,
      checks:{sampleCoordinates:checkedCoordinates.length,matchedCoordinates:checkedCoordinates.filter(c=>c.cacheMatches.length).length},
      limits:['Wiki membership describes versions/locations. Missing cache flags do not prove free geographical access.','Examine is often an implicit client menu action absent from cache actions. No server destination added from label matching.']});
  }
  return {method:'Direct RS3 MediaWiki API revision content; selected infobox fields and first six explicit map coordinates per page. No OSRS source used.',pages:results};
}

export async function openArrayDataset(output,name,field,header) {
  const path=resolve(output,name);mkdirSync(resolve(path,'..'),{recursive:true});if(existsSync(path))throw new Error('Use new filenames');
  const gzip=createGzip(),destination=createWriteStream(path,{flags:'wx'}),done=pipeline(gzip,destination);let failure=null,parts=[],partBytes=0;
  const remember=e=>{failure??=e;};gzip.on('error',remember);destination.on('error',remember);done.catch(remember);
  const assertWritable=()=>{if(failure)throw failure;if(gzip.destroyed||gzip.writableEnded)throw new Error('Object output stream already closed');};
  const failedDone=done.then(()=>{throw new Error('Object output stream ended before write finished');});failedDone.catch(()=>{});
  const drainBuffer=async()=>{assertWritable();if(!partBytes)return;const text=parts.join('');parts=[];partBytes=0;if(!gzip.write(text))await Promise.race([once(gzip,'drain'),failedDone]);if(failure)throw failure;};
  const write=async text=>{assertWritable();parts.push(text);partBytes+=Buffer.byteLength(text);if(partBytes>=256*1024)await drainBuffer();};
  const encoded=JSON.stringify(header);await write(`${encoded.slice(0,-1)},${JSON.stringify(field)}:[`);let count=0;
  return {append:async row=>{if(count++)await write(',');await write(JSON.stringify(row));},flush:async()=>{await drainBuffer();assertWritable();await Promise.race([new Promise((r,j)=>gzip.flush(e=>e?j(e):r())),failedDone]);if(failure)throw failure;},
    finish:async extra=>{await write(']');for(const [key,value]of Object.entries(extra??{}))await write(`,${JSON.stringify(key)}:${JSON.stringify(value)}`);await write('}');await drainBuffer();gzip.end();await done;return {path:path.replaceAll('\\','/'),bytes:statSync(path).size,sha256:await fileSha256(path)};},abort:e=>{remember(e);destination.destroy(e);gzip.destroy(e);}};
}

/** Stream full placement inventories; keep only compact review indexes in memory. */
export async function exportGameObjects(options={}) {
  const output=resolve(options.output??'');if(!options.output||existsSync(output))throw new Error('Supply a NEW --output directory');
  const {cache,context}=await openGameCache({workspace:options.workspace,build:Number(options.build??950)});let sourceWriter,placementWriter;
  try {
    let definitions,mapRows,coverage=[],errors=[],layouts=[];
    if(options.input){const input=resolve(options.input);context.inputs=await Promise.all(['objects.definitions.v1.json.gz','objects.layouts.v1.json.gz'].map(async name=>({path:join(input,name),sha256:await fileSha256(join(input,name))})));definitions=new Map();for await(const row of readObjectRecords(join(input,'objects.definitions.v1.json.gz'),'definitions'))definitions.set(row.objectId,row.raw);const data=JSON.parse(gunzipSync(readFileSync(join(input,'objects.layouts.v1.json.gz'))));mapRows=data.maps;errors=data.errors??[];}
    else{const locs=loadTable(cache,{major:16,kind:'loc'}),zones=loadTable(cache,{major:23,minor:0,kind:'zones'}),pastes=loadTable(cache,{major:23,minor:1,kind:'pastes'});definitions=locs.definitions;errors=[...locs.errors,...zones.errors,...pastes.errors];mapRows=[];
      for(const [mapId,zone]of zones.definitions){const paste=pastes.definitions.get(mapId);if(!paste){mapRows.push({mapId,zone,status:'missing-layout'});continue;}const planes=[...new Set([...paste.squares,...paste.chunks].flatMap(r=>Array.from({length:r.n_planes},(_,i)=>r.new_plane+i)))];mapRows.push({mapId,zone,pastes:paste,planes,status:planes.length?'decoded':'no-enabled-pastes',layouts:[]});}}
    const needed=new Set(),byRegion=new Map(),surfaceRegionChunks=new Map();
    for(const map of mapRows){const old=map.layouts;map.layouts=[];for(const plane of map.planes??[]){try{const l=buildSurfaceLayout(map.zone,map.pastes,{mapId:map.mapId,plane});layouts.push(l);map.layouts.push({plane,blocks:l.blocks.size,sourceBlocks:l.sourceBlocks.size});for(const mappings of l.sourceBlocks.values())for(const b of mappings){const region=mapsquareId(Math.floor(b.source.x/64),Math.floor(b.source.y/64));needed.add(region);if(!byRegion.has(region))byRegion.set(region,new Set());byRegion.get(region).add(l);if(l.mapId===28&&l.plane===0&&inCrop(b.destination.x,b.destination.y)){if(!surfaceRegionChunks.has(region))surfaceRegionChunks.set(region,new Set());surfaceRegionChunks.get(region).add(String(Math.floor(b.destination.x/64)*256+Math.floor(b.destination.y/64)));}}}catch(e){errors.push({mapId:map.mapId,plane,message:e.message});map.layouts.push({plane,error:e.message});}}}
    const diagnosticsPath=resolve(options.diagnostics??join(context.workspace,'outputs/cache-audit-2026-10-07-v4/walkability.v1.json.gz')),diagnostics=JSON.parse(gunzipSync(readFileSync(diagnosticsPath))),doorKeys=new Set(diagnostics.doors.map(d=>[d.locId,d.sourceX??d.x,d.sourceZ??d.z,d.plane,d.type,d.rotation].join(':')));
    const layoutRegions=needed.size;for(const d of diagnostics.doors)needed.add(mapsquareId(Math.floor((d.sourceX??d.x)/64),Math.floor((d.sourceZ??d.z)/64)));
    const {params,paramHints}=attachObjectParamHints(cache,definitions,[]);errors.push(...params.errors,...paramHints.errors);const hintMap=new Map(paramHints.records.map(r=>[r.objectId,r]));
    const wikiPaths=(options['wiki-source']??[join(context.workspace,'objects-wiki-2026-10-08.json'),join(context.workspace,'objects-wiki-door-2026-10-08.json')].filter(existsSync).join(';')).split(';').filter(Boolean),wikiResponses=wikiPaths.map(path=>JSON.parse(readFileSync(path))),wikiIds=new Set();
    for(const r of wikiResponses)for(const page of Object.values(r.query?.pages??{}))for(const m of (page.revisions?.[0]?.slots?.main?.['*']??'').matchAll(/(?:objectid[:=]|^\|id\d*\s*=\s*)(\d+)/gm))wikiIds.add(Number(m[1]));
    const provenance={generatedAt:context.generatedAt,decoder:context.decoder,reference:context.reference,manifest:'objects.manifest.v1.json',diagnostic:{path:diagnosticsPath.replaceAll('\\','/'),sha256:sha256(readFileSync(diagnosticsPath))},inputs:context.inputs??[],method:'Placement arrays streamed while scanning copied archives; per-object metadata shared in memory.'};
    sourceWriter=await openArrayDataset(output,'objects.source-placements.v1.json.gz','placements',{schemaVersion:1,provenance});placementWriter=await openArrayDataset(output,'objects.placements.v1.json.gz','placements',{schemaVersion:1,provenance});
    const metadata=new Map(),comparisonGroups=new Map(),doorSources=[],transitions=[],wikiPlacements=[],samples=[],coveredChunks=new Set();
    const summary={definitions:definitions.size,definitionErrors:errors.filter(e=>e.major===16).length,maps:mapRows.length,layouts:layouts.length,layoutSourceRegions:layoutRegions,sourceRegions:needed.size,decodedRegions:0,errors:0,sourcePlacements:0,mappedPlacements:0,surfaceRawPlane0:0,surfaceEffectivePlane0:0,conditionalPlacements:0,classCounts:{tree:0,'mining-resource':0,'facility-candidate':0,'transition-candidate':0},classificationCounts:{treeTypes:{},oreTypes:{},facilityTypes:{},membersFlagged:0},encodedParamHints:paramHints.counts,encodedDestinations:0};
    const mergeCounts=counts=>{for(const kind of ['treeTypes','oreTypes','facilityTypes'])for(const [key,value]of Object.entries(counts[kind]))summary.classificationCounts[kind][key]=(summary.classificationCounts[kind][key]??0)+value;summary.classificationCounts.membersFlagged+=counts.membersFlagged;};
    let n=0;console.log(`Streaming ${definitions.size} definitions; ${layouts.length} layouts; ${needed.size} sources`);
    for(const region of needed){let count=0;try{const archive=cache.archive(5,region);if(!archive)throw new Error('Declared source archive missing');const locs=archive.has(0)?cache.decoders.decode('locations',archive.get(0)):{locations:[]},tiles=archive.has(3)?cache.decoders.decode('tiles',archive.get(3)):null,nxt=archive.has(5)?cache.decoders.decode('nxt',archive.get(5)):null,seen=new Map();
      for(const loc of locs.locations)for(const use of loc.uses){const x=(region%128)*64+use.x,y=Math.floor(region/128)*64+use.y,identity=[region,loc.id,use.plane,use.x,use.y,use.type,use.rotation],key=identity.join(':'),ordinal=seen.get(key)??0;seen.set(key,ordinal+1);const id=`object-${sha256(JSON.stringify([...identity,ordinal])).slice(0,24)}`,bridge=nxt?.level1?.[(use.x+1)*66+use.y+1],bridgeFlag=bridge?!!(bridge.flags&4):!!((tiles?.tiles?.[4096+use.x*64+use.y]?.settings??0)&2),effectivePlane=use.plane-(bridgeFlag?1:0);
        const source={id,objectId:loc.id,x,y,plane:use.plane,effectivePlane,bridgeFlag,type:use.type,rotation:use.rotation,ordinal,major:5,minor:region,subid:0,rawUse:use};await sourceWriter.append(source);count++;summary.sourcePlacements++;
        if(doorKeys.has([loc.id,x,y,use.plane,use.type,use.rotation].join(':')))doorSources.push(source);
        if(!metadata.has(loc.id)){const d=definitions.get(loc.id);if(!d){errors.push({code:'missing-placed-definition',objectId:loc.id,region});continue;}const alternatives=morphInfo(d)?morphAlternatives(loc.id,definitions):[];metadata.set(loc.id,{name:plainLabel(d.name),actions:actionsOf(d),memberActions:memberActionsOf(d),membersFlags:{is_members:d.is_members??null,isMembers:d.isMembers??null},classes:[...new Set([...classifyObject(d),...alternatives.flatMap(a=>a.classes??[])])],classification:describeObject(d),alternatives,activeState:'unknown'});}
        const meta=metadata.get(loc.id);
        for(const layout of byRegion.get(region)??[])for(const dest of sourceToSurface(layout,x,y,use.plane)){const p={id:`${id}@${dest.mapId}:${dest.plane}:${dest.x}:${dest.y}`,sourceId:id,objectId:loc.id,...meta,x:dest.x,y:dest.y,plane:dest.plane,mapId:dest.mapId,chunkId:String(Math.floor(dest.x/64)*256+Math.floor(dest.y/64)),type:use.type,rotation:use.rotation,source:{x,y,plane:use.plane,effectivePlane,bridgeFlag,major:5,minor:region,subid:0},transform:{translation:dest.mapping.translation,pasteKind:dest.mapping.paste.kind,pasteIndex:dest.mapping.paste.index},destination:null,requirements:null};
          if(p.classes.includes('transition-candidate')){p.encodedCoordinateHints=[...new Set([p.objectId,...p.alternatives.map(a=>a.objectId)])].map(i=>hintMap.get(i)).filter(Boolean);transitions.push(p);}await placementWriter.append(p);summary.mappedPlacements++;if(p.alternatives.length)summary.conditionalPlacements++;for(const k of p.classes)summary.classCounts[k]++;mergeCounts(classificationCounts([p]));
          if(p.mapId===28&&inCrop(p.x,p.y)){if(p.plane===0)summary.surfaceRawPlane0++;if(effectiveDisplayPlane(p)===0){summary.surfaceEffectivePlane0++;const groupKey=`${p.chunkId}:${p.objectId}`,group=comparisonGroups.get(groupKey);if(group)group.multiplicity++;else comparisonGroups.set(groupKey,{objectId:p.objectId,mapId:28,plane:0,x:p.x,y:p.y,chunkId:p.chunkId,alternatives:p.alternatives,multiplicity:1});}}
          if(wikiIds.has(p.objectId))wikiPlacements.push(p);if(samples.length<30&&p.mapId===28&&p.plane===0&&[109001,109003,109005,36687,113038,1805,134267,134268].includes(p.objectId))samples.push(p);
        }
      }
      for(const chunk of surfaceRegionChunks.get(region)??[])coveredChunks.add(chunk);coverage.push({major:5,minor:region,status:'decoded',locationSubfile:archive.has(0),tileSubfile:archive.has(3),nxtSubfile:archive.has(5),placements:count,diagnosticHalo:!byRegion.has(region)});summary.decodedRegions++;
    }catch(e){errors.push({major:5,minor:region,message:e.message});coverage.push({major:5,minor:region,status:'error',message:e.message,placementsBeforeError:count});}
      if(++n%100===0){await sourceWriter.flush();await placementWriter.flush();console.log(`Streamed source regions ${n}/${needed.size}; ${summary.sourcePlacements} source, ${summary.mappedPlacements} mapped`);}
    }
    const comparison=compareRetainedObjects([...comparisonGroups.values()],definitions,JSON.parse(readFileSync(context.reference.path)),coveredChunks),doors=joinDoorDiagnostics(diagnostics.doors,doorSources,definitions);summary.errors=errors.length;summary.comparison=comparison.counts;summary.doors=doors.counts;summary.coveredChunks=coveredChunks.size;
    context.outputs.push(await sourceWriter.finish({summary:{placements:summary.sourcePlacements}}));sourceWriter=null;context.outputs.push(await placementWriter.finish({summary}));placementWriter=null;
    const save=async(name,data)=>context.outputs.push(await writeObjectDataset(output,name,{schemaVersion:1,provenance,...data}));
    await save('objects.definitions.v1.json.gz',{definitions:[...definitions].map(([objectId,raw])=>({objectId,name:plainLabel(raw.name),actions:actionsOf(raw),memberActions:memberActionsOf(raw),classes:classifyObject(raw),classification:describeObject(raw),raw})),errors:errors.filter(e=>e.major===16)});
    await save('objects.layouts.v1.json.gz',{maps:mapRows,coverage,errors});await save('objects.transitions.v1.json.gz',{transitions,limits:['Typed coordinates and struct references are hints, not proven destinations.','No current-player state or complete server requirements available.']});await save('objects.retained-comparison.v1.json.gz',comparison);await save('objects.door-review.v1.json.gz',doors);await save('objects.encoded-param-hints.v1.json',{params:params.definitions.size,paramErrors:params.errors,...paramHints});
    if(wikiPaths.length)await save('objects.wiki-validation.v1.json',{inputHashes:wikiPaths.map(path=>({path,sha256:sha256(readFileSync(path))})),...validateWikiObjects(wikiResponses,definitions,wikiPlacements)});
    await save('objects.summary.v1.json',{summary,samples});if(options.input){for(const major of[16,23])for(const minor of cache.table(major).entries.keys())cache.file(major,minor);}
    await finishManifest(cache,context,output,{name:'objects.manifest.v1.json',summary});console.log(JSON.stringify({output,summary},null,2));return {output,summary};
  }catch(e){sourceWriter?.abort(e);placementWriter?.abort(e);throw e;}finally{cache.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)exportGameObjects(cliOptions()).catch(e=>{console.error(e.message);process.exitCode=1;});
