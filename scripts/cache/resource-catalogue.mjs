import { morphInfo, plainLabel } from './pins.mjs';
import { morphAlternatives } from './game-data-objects.mjs';
import { createHash } from 'node:crypto';

export const placementColumns = ['id','objectId','classKey','chunkId','x','y','rawPlane','effectivePlane','rotation','components','witnessMethod','witnessTiles','sourceMinor','sourceX','sourceY','sourcePlane','sourceType','sourceOrdinal'];
export const normalizeSelector = value => plainLabel(value).replace(/~\|([^|]+)\|~/g, '$1').replaceAll('*','').toLowerCase();
const keyType = text => text.toLowerCase().replaceAll(' ', '-');
const nameKey = text => normalizeSelector(text).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const namedTreeTypes = ['achey','acadia','oak','willow','yew','maple','teak','mahogany','elder','magic','arctic pine','eucalyptus','golden bamboo','bamboo','bloodwood','crystal','blisterwood','fir','tangle gum','seeping elm','blood spindle','utuku','spinebeam','bovistrangler','thigat','corpsethorn','entgallow','grave creeper'];
const namedOreTypes = ['pure essence','rune essence','luminite','clay','red sandstone','crystal-flecked sandstone','sandstone','granite','limestone','common gem','precious gem','gem','copper','tin','iron','coal','silver','gold','mithril','adamantite','runite','orichalcite','drakolith','necrite','phasmatite','banite','light animica','dark animica','shadow animica','novite','bathus','marmaros','kratonium','kratonite','fractite','zephyrium','argonite','katagon','gorgonite','promethium','primal','blurite','platinum','havensilver','daeyalt','rubium'];
// Prefer the whole named material over an embedded family (Golden Bamboo).
const typePattern = types => new RegExp(`\\b(${[...types].sort((a,b)=>b.length-a.length).join('|')})\\b`, 'i');
const treePattern = typePattern(namedTreeTypes), orePattern = typePattern(namedOreTypes);
function materialClassKey(category, type, name) {
  const label=normalizeSelector(name),material=type.toLowerCase();
  const ordinary=category==='tree'?[material,`${material} tree`]:[material,`${material} ore`,`${material} rock`,`${material} rocks`,`${material} vein`];
  const base=`${category}:${keyType(type)}`;
  return ordinary.includes(label)?base:`${base}:${nameKey(name)}`;
}
// These decoded names denote another actionable activity as well as a resource
// facility. The retained name alone cannot select the resource definition.
const selectorIdentityReviews = [
  ['Chest', [2079,12309]], ['Counter', [2012,2792]],
  ['Treasure chest', [93017,93019]], ['Rowboat', [104020,104071]],
  ['Boulder', [19205,114341]], ['Pit', [2609,19227]],
  ['Young tree', [11394,19652]], ['Old fishing rod', [43482,43483]],
];
export function definitionActions(raw) {
  return Object.entries(raw ?? {}).filter(([k]) => /^actions_[0-4]$/.test(k)).map(([,v]) => plainLabel(v)).filter(v => v && !/^hidden$/i.test(v));
}
export function memberActions(raw) {
  return Object.entries(raw ?? {}).filter(([k]) => /^members_action_[1-5]$/.test(k)).map(([,v]) => plainLabel(v)).filter(Boolean);
}

/** Semantic classes require BOTH the definition label and a relevant action.
 * Unknown types deliberately do not certify normal logs, a named ore or fish. */
export function resourceClasses(raw, { allowDynamic = false } = {}) {
  const name = plainLabel(raw?.name), actions = [...definitionActions(raw), ...memberActions(raw)], out = [];
  if (!allowDynamic && /^(?:divine|portable|temporary|player)(?:\b|[- ])/i.test(name)) return [];
  const has = regex => actions.some(a => regex.test(a));
  const tree = name.match(treePattern)?.[1];
  if ((tree || /\b(tree|evergreen)\b/i.test(name)) && has(/^(?:cut|chop)(?:[- ]down)?$/i)) out.push(tree ? materialClassKey('tree',tree,name) : `tree:unknown:${nameKey(name)}`);
  const ore = name.match(orePattern)?.[1];
  if ((ore || /\b(?:rock|rocks|ore|vein|deposit|essence|clay|sandstone|granite|limestone)\b/i.test(name)) && has(/^mine(?:$|[- ])/i)) out.push(ore ? materialClassKey('ore',ore,name) : `ore:unknown:${nameKey(name)}`);
  const checks = [
    ['deposit-box', /\bdeposit box\b/i, /^deposit(?:$|[- ])/i],
    ['altar', /\baltar\b/i, /^(?:pray|recharge|quick recharge|offer)(?:$|[- ])/i],
    ['furnace', /\bfurnace\b/i, /^(?:smelt|craft)(?:$|[- ])/i],
    ['anvil', /\banvil\b/i, /^smith(?:$|[- ])/i],
    ['forge', /\bforge\b/i, /^(?:heat|smelt)(?:$|[- ])/i],
    ['cooking-range', /^(?:cooking range|range|stove|clay oven|grill)(?:$| \()|\brange$/i, /^cook(?:$|[- ])/i],
    ['cooking-oven', /^(?:oven|large oven|small oven)(?:$| \()/i, /^cook(?:$|[- ])/i],
    ['cooking-pot', /^cooking pot$/i, /^cook(?:$|[- ])/i],
    ['cooking-pit', /^sulphur pit$/i, /^cook(?:$|[- ])/i],
    ['cooking-station', /^(?:cooking station|gnome cooker|spit roast|barbecue|steam vent)$/i, /^cook(?:$|[- ])/i],
    ['cooking-fire', /\b(?:fire|bonfire|campfire|fireplace)\b/i, /^cook(?:$|[- ])/i],
    ['spinning-wheel', /\bspinning wheel\b/i, /^spin(?:$|[- ])/i],
    ['loom', /\bloom\b/i, /^(?:weave|use)(?:$|[- ])/i],
    ['pottery-wheel', /\b(?:potter'?s|pottery) wheel\b/i, /^form(?:$|[- ])/i],
    ['pottery-oven', /\bpottery oven\b/i, /^fire(?:$|[- ])/i],
    ['water-source', /\b(?:water source|well|sink|fountain|water ?pump|water barrel|water trough|geyser)\b/i, /^fill(?:$|[- ])/i],
    ['workbench', /\bworkbench\b/i, /^(?:operate|work|craft|carve|smith|invent|manufacture)(?:$|[- ])/i],
    ['sawmill', /\bsawmill\b/i, /^(?:buy|saw|use|operate)(?:$|[- ])/i],
    ['tanning', /\btanning\b/i, /^(?:tan|use)(?:$|[- ])/i],
    ['hunter-spot', /^(?:(?:hunter|hunting|tracking|trapping) (?:spot|area|tunnel)|(?:bird snare|box trap|log trap|boulder|pit|young tree|rockodile|old fishing rod))$/i, /^(?:track|trap|set|catch)(?:$|[- ])/i],
    ['hunter-burrow', /^(?:rabbit|jackalope) burrow$/i, /^flush$/i],
    ['static-fishing', /\b(?:fishing spot|fishing hole|bubbling water)\b/i, /^(?:fish|net|lure|bait|cage|harpoon)(?:$|[- ])/i],
    ['summoning-obelisk', /\bobelisk\b/i, /^(?:summon|infuse|renew)(?:$|[- ])/i],
    ['teleport-obelisk', /\bobelisk\b/i, /^activate(?:$|[- ])/i],
  ];
  if ((/\bbank(?:er|ing)?\b/i.test(name) && has(/^(?:bank|use|collect|load last preset from)$/i)) || (name && has(/^bank$/i))) {
    const kind=/\bbooth\b/i.test(name)?'bank-booth':/\bchest\b/i.test(name)?'bank-chest':/\bboat\b/i.test(name)?'bank-boat':/^banker$/i.test(name)?'banker':'bank-other';
    const standard={ 'bank-booth':['bank booth'],'bank-chest':['bank chest'],'bank-boat':['bank boat'],banker:['banker'],'bank-other':['bank'] };
    out.push(`facility:${standard[kind].includes(name.toLowerCase()) ? kind : `${kind}:${nameKey(name)}`}`);
  }
  const sharedNames={'cooking-range':['range','cooking range','stove'],'spinning-wheel':['spinning wheel'],loom:['loom'],'pottery-wheel':["potter's wheel",'pottery wheel'],'pottery-oven':['pottery oven'],'deposit-box':['deposit box','bank deposit box']};
  for (const [key,label,action] of checks) if (label.test(name) && has(action)) {
    // A family label does not make specialized facilities synonymous. Their
    // exact definition names retain separate selectors and task gates.
    const standard=sharedNames[key]??[key.replaceAll('-',' ')];
    out.push(`facility:${standard.includes(name.toLowerCase()) ? key : `${key}:${nameKey(name)}`}`);
  }
  if (/\baltar\b/i.test(name) && has(/^craft[- ]runes$/i)) out.push(`runecrafting:${keyType(name.replace(/ altar$/i, ''))}`);
  if (/\b(?:patch|allotment)\b/i.test(name) && has(/^(?:rake|guide|harvest|pick|plant|cure)(?:$|[- ])/i)) {
    const type = name.toLowerCase().replace(/ patch.*$/i,'').replace(/^(?:weedy|diseased|dead) /,'');
    out.push(`farming:${keyType(type || 'unknown')}`);
  }
  return [...new Set(out)].sort();
}

/** A renderer's default is not proof of current player state. Every encoded
 * leaf must be present and have the same classes AND rectangle. */
export function resolveResourceDefinition(objectId, definitions) {
  const raw = definitions.get(objectId);
  if (!raw) return { classKeys: [], policy: 'missing-definition', leaves: [] };
  if (/^(?:divine|portable|temporary|player)(?:\b|[- ])/i.test(plainLabel(raw.name))) return {classKeys:[],possibleClassKeys:resourceClasses(raw,{allowDynamic:true}),policy:'dynamic-template-review',leaves:[objectId],footprint:null};
  if (!morphInfo(raw)) return { classKeys: resourceClasses(raw), policy: 'unconditional', leaves: [objectId], footprint: [raw.width ?? 1,raw.length ?? 1] };
  const branches = morphAlternatives(objectId, definitions);
  const leaves = [...new Set(branches.filter(b => !b.absentState && !b.problem).map(b=>b.objectId))].sort((a,b)=>a-b);
  const classes = leaves.map(id => resourceClasses(definitions.get(id)));
  const footprint = leaves.map(id => [definitions.get(id).width ?? 1, definitions.get(id).length ?? 1]);
  const allPresent = branches.length && branches.every(b=>!b.absentState && !b.problem);
  const same = allPresent && classes.length && classes[0].length && classes.every(c=>JSON.stringify(c)===JSON.stringify(classes[0])) && footprint.every(f=>JSON.stringify(f)===JSON.stringify(footprint[0]));
  return { classKeys: same ? classes[0] : [], possibleClassKeys: [...new Set(classes.flat())].sort(), policy: same ? 'all-present-leaves-same-resource-and-footprint' : 'conditional-review', leaves, footprint: same ? footprint[0] : null,
    branches: branches.map(b=>({objectId:b.objectId,absentState:!!b.absentState,problem:b.problem??null,path:b.path})) };
}

export function effectiveDisplayPlane(p) {
  return p.source?.effectivePlane == null ? p.plane : p.source.effectivePlane + p.transform.translation.plane;
}
export const anchorKey = p => [p.objectId,p.x,p.y,p.source?.plane ?? p.plane,p.source?.type ?? p.type,p.source?.rotation ?? p.rotation].join(':');
/** The exporter hashes its exact raw identity including duplicate ordinal.
 * Recover that ordinal by verifying the hash, never by assigning a default. */
export function recoverSourceOrdinal(p, maximum = 65535) {
  const expected=p.sourceId??p.id.split('@')[0],prefix=[p.source.minor,p.objectId,p.source.plane,p.source.x%64,p.source.y%64,p.type,p.source.rotation??p.rotation];
  for(let ordinal=0;ordinal<=maximum;ordinal++)if(`object-${createHash('sha256').update(JSON.stringify([...prefix,ordinal])).digest('hex').slice(0,24)}`===expected)return ordinal;
  throw new Error(`Source placement identity cannot be reconstructed: ${p.id}`);
}

/** Decode point labels once. Plane checks include the exact source/display
 * paste translation; a ground object cannot witness an overlying bridge. */
export function componentMasks(walk, corrections = {}) {
  const invalidRegions = new Set((corrections.invalidRegionIds ?? []).map(String));
  const excludedComponents = new Set(corrections.nonWalkingComponentIds ?? []);
  return new Map((walk?.regions??[]).filter(r=>r.masks?.components).map(r=>{
    const labels=Buffer.from(r.masks.components,'base64'), planes=r.masks.planes ? Buffer.from(r.masks.planes,'base64') : null;
    if(labels.length!==8192 || !planes || planes.length!==4096)throw new Error(`Incomplete component/plane masks: ${r.id}`);
    return [String(r.id),{...r,labels,planes,invalidRegion:invalidRegions.has(String(r.id)),excludedComponents}];
  }));
}
export function resourceWitness(regions, p, footprint) {
  if (!regions.size) return {method:'no-permitted-component-mask',components:[],tiles:[]};
  if(!Array.isArray(footprint)||footprint.length!==2||footprint.some(n=>!Number.isInteger(n)||n<1||n>255))throw new Error(`Invalid decoded resource footprint: ${p.id}`);
  const [w,l] = footprint, [width,length] = p.rotation & 1 ? [l,w] : [w,l];
  const base = String(p.chunkId), sourcePlane = p.source?.plane ?? p.plane, excludedTiles=[];let outsideBaseTiles=0;
  const point = (x,y) => {
    const chunk = String(Math.floor(x/64)*256+Math.floor(y/64)), r = regions.get(chunk);
    if(chunk !== base){outsideBaseTiles++;return null;}
    if (!r) return null;
    const index=(x%64)*64+y%64;
    // Full walkability records retain region-level source-plane translation.
    const sourceShift=(r.provenance?.sourcePlane ?? 0)-(r.provenance?.destinationPlane ?? 0);
    if (r.planes[index] + sourceShift !== sourcePlane) return null;
    const label=r.labels.readUInt16LE(index*2);
    if(!label)return null;
    const component=`${chunk}:${label}`;
    if(r.invalidRegion || r.excludedComponents.has(component)){excludedTiles.push([x,y,component]);return null;}
    return component;
  };
  const direct=point(p.x,p.y);
  if (direct) return {method:'exact-placement-tile',components:[direct],tiles:[[p.x,p.y,direct]]};
  const tiles=[];
  for(let dx=0;dx<width;dx++) for(const y of [p.y-1,p.y+length]) { const x=p.x+dx,c=point(x,y); if(c)tiles.push([x,y,c]); }
  for(let dy=0;dy<length;dy++) for(const x of [p.x-1,p.x+width]) { const y=p.y+dy,c=point(x,y); if(c)tiles.push([x,y,c]); }
  return {method:'decoded-footprint-perimeter',components:[...new Set(tiles.map(t=>t[2]))].sort(),tiles,
    ...(excludedTiles.length?{excludedComponents:[...new Set(excludedTiles.map(t=>t[2]))].sort(),excludedTiles}:{} ),
    ...(outsideBaseTiles?{outsideBaseTiles}:{} )};
}

export function buildSelectors(reference, definitions) {
  const names=new Set(),retainedLocations=[];
  for(const [base,chunk] of Object.entries(reference.chunks??{})) for(const [location,node] of [[base,chunk],...Object.entries(chunk.Sections??{}).map(([s,n])=>[`${base}-${s}`,n])]) {
    const objects=Object.entries(node.Object??{}).map(([name,count])=>[name,Number(count)||0]);
    if(objects.length)retainedLocations.push({location,objects});
    for(const [name] of objects)names.add(name);
  }
  const aliases=reference.codeItems?.objectsPlus ?? reference.codeItems?.objectPlus ?? {};
  const values=v=>v==null?[]:Array.isArray(v)?v:[v];
  for(const group of Object.values(reference.challenges??{})) for(const task of Object.values(group)) for(const [field,value] of Object.entries(task)) if(/^(?:objects?|objects?Plus)$/i.test(field)) for(const name of values(value))names.add(String(name));
  for(const name of Object.keys(reference.objectItems??{}))names.add(name);
  for(const [name,children] of Object.entries(aliases)){names.add(name);for(const child of values(children))names.add(String(child));}
  const index=new Map();
  const genericNames=new Set(definitions.filter(d=>d.classKeys.some(k=>/^(?:tree|ore):unknown:/.test(k))).flatMap(d=>[d.name,...(d.leafNames??[])]).map(normalizeSelector));
  for(const d of definitions) if(d.classKeys.length && !d.classKeys.some(k=>/^(?:tree|ore):unknown:/.test(k))) for(const name of [d.name,...(d.leafNames??[])]) {
    const n=normalizeSelector(name), item=index.get(n)??{keys:new Set(),ids:new Set()};
    d.classKeys.forEach(k=>item.keys.add(k));item.ids.add(d.objectId);index.set(n,item);
  }
  const mappings=[],unmatched=[],byName=new Map();
  const reviewedAmbiguities=selectorIdentityReviews.map(([name,evidenceObjectIds])=>({name,evidenceObjectIds,reason:'same-name-scenery-needs-identity-review'}));
  // Reviewed spelling alternatives for named materials, never generic scenery.
  // Each table entry still requires an action-backed definition of that type.
  const reviewedAliases=[];
  for(const [category,types,suffix] of [['tree',namedTreeTypes,'tree'],['ore',namedOreTypes,'rock']])for(const type of types){
    const classKey=`${category}:${keyType(type)}`,evidenceObjectIds=definitions.filter(d=>d.classKeys.includes(classKey)).map(d=>d.objectId).sort((a,b)=>a-b);
    if(evidenceObjectIds.length)reviewedAliases.push({classKey,names:[type,`${type} ${suffix}`,`${type} (${suffix})`,...(category==='ore'?[`${type} rocks`]:[])],method:`reviewed-named-${category}-type-alias`,evidenceObjectIds});
  }
  for(const name of [...names].sort()) {
    if(Object.hasOwn(aliases,name))continue;
    const identityReview=reviewedAmbiguities.find(row=>normalizeSelector(row.name)===normalizeSelector(name));
    if(identityReview){unmatched.push({name,reason:identityReview.reason,objectIds:identityReview.evidenceObjectIds});continue;}
    const hit=index.get(normalizeSelector(name));
    if(!hit){
      const alias=reviewedAliases.find(row=>row.names.includes(normalizeSelector(name)));
      if(alias){const row={name,classKeys:[alias.classKey],method:alias.method,evidenceObjectIds:alias.evidenceObjectIds};mappings.push(row);byName.set(name,row);continue;}
      unmatched.push({name,reason:genericNames.has(normalizeSelector(name))?'generic-resource-type-needs-explicit-evidence':'no-action-supported-definition-class'});continue;
    }
    const classKeys=[...hit.keys].sort();
    if(classKeys.length!==1){unmatched.push({name,reason:'ambiguous-exact-name-classes',classKeys,objectIds:[...hit.ids].sort((a,b)=>a-b)});continue;}
    const alias=reviewedAliases.find(row=>row.classKey===classKeys[0]&&row.names.includes(normalizeSelector(name)));
    const row={name,classKeys,method:alias?`exact-name-plus-${alias.method}`:'exact-normalized-definition-name-and-action',evidenceObjectIds:[...new Set([...hit.ids,...(alias?.evidenceObjectIds??[])])].sort((a,b)=>a-b)};
    mappings.push(row);byName.set(name,row);
  }
  const active=new Set();
  const resolve = name => {
    if(byName.has(name))return byName.get(name);
    if(!Object.hasOwn(aliases,name)||active.has(name))return null;
    active.add(name);const children=values(aliases[name]),mapped=children.map(c=>resolve(String(c)));active.delete(name);
    // Partial aliases cannot silently grant a missing member (Banker or a dynamic fire).
    const row={name,classKeys:[...new Set(mapped.filter(Boolean).flatMap(r=>r.classKeys))].sort(),method:'retained-explicit-alias-expansion',evidenceObjectIds:[...new Set(mapped.filter(Boolean).flatMap(r=>r.evidenceObjectIds))].sort((a,b)=>a-b),children,unmatchedChildren:children.filter((_,i)=>!mapped[i] || mapped[i].unmatchedChildren?.length)};
    if(!row.classKeys.length){unmatched.push({name,reason:'alias-has-no-mapped-members',children});return null;}
    mappings.push(row);byName.set(name,row);return row;
  };
  for(const name of Object.keys(aliases).sort())resolve(name);
  return {reviewedAliases,reviewedAmbiguities,mappings:mappings.sort((a,b)=>a.name.localeCompare(b.name,'en')),unmatched:unmatched.sort((a,b)=>a.name.localeCompare(b.name,'en')),retainedLocations};
}
