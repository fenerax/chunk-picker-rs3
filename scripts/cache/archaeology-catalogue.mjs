import { parameterMap, extractRecipes } from './game-data-recipes.mjs';
import { definitionActions } from './resource-catalogue.mjs';
import { morphInfo, plainLabel } from './pins.mjs';
import { morphAlternatives } from './game-data-objects.mjs';

export const ARCH_TABLES = Object.freeze({ collectors: 82, collectorLogs: 83, collections: 84,
  sites: 86, resources: 88, artefacts: 89, research: 90, researchers: 91, mysteries: 92, qualifications: 93 });
const normalized = value => plainLabel(value).replace(/~\|([^|]+)\|~/g, '$1').replaceAll('*','').normalize('NFC').toLowerCase();
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const dbColumn = (row, column) => row?.rows?.columndata?.find(value => value.columnid === column);

/** Preserve DB tuple types and table defaults; never substitute a falsy 0. */
export function columnRows(row, column, tables) {
  const explicit = dbColumn(row, column);
  if (explicit) return explicit.rows;
  const schema = tables.get(row?.table)?.columndata?.find(value => value.id === column)?.columns;
  return schema?.every(value => value.hasdefault) ? [schema.map(value => value.default)] : [];
}
const first = (row, column, tables) => columnRows(row,column,tables)[0]?.[0] ?? null;
const source = id => ({ major:2, minor:41, subid:id });

export function extractArchaeology({ items, structs, enums, params, dbrows, dbtables, achievements = new Map() }) {
  if(params.get(6659)?.type?.vartype!==74)throw new Error('Archaeology param6659 must be typed DBROW (74), never a struct.');
  const table = id => [...dbrows].filter(([,row])=>row.table===id);
  const item = id => ({id,name:items.get(id)?.name??null,membersMarked:items.get(id)?.members===true,
    definitionPresent:items.has(id),source:{major:19,minor:Math.floor(id/256),subid:id%256}});
  const artifactRows = table(89), artifactByRow = new Map();
  const artefacts=artifactRows.map(([id,row])=>{
    const damaged=item(first(row,5,dbtables)),restored=item(first(row,6,dbtables));
    const value={rowId:id,source:source(id),damaged,restored,level:first(row,4,dbtables),description:first(row,3,dbtables),
      raw:row,missing:['Activity membership and provenance depend on excavatable resource and site, not item opcode.']};
    artifactByRow.set(id,value);return value;
  });
  const hotspots=table(88).map(([id,row])=>{
    const materialYields=columnRows(row,15,dbtables).map(([itemId,weight])=>({item:item(itemId),encodedWeight:weight}));
    const kind=first(row,1,dbtables)===2?'material-cache':'excavation-hotspot';
    const name=first(row,2,dbtables)|| (kind==='material-cache'&&materialYields.length===1?`Material cache (${materialYields[0].item.name})`:null);
    const members=first(row,3,dbtables);
    return {rowId:id,source:source(id),name,kind,level:first(row,4,dbtables),members:members===0?false:members===1?true:null,
      membershipEvidence:'DB table88 col3 boolean candidate with typed default. Centurion tutorial and Tunnels barricade conflict with simple membership interpretation; runtime F2P needs independent Wiki checks and skill cap.',
      soil:first(row,14,dbtables)==null?null:item(first(row,14,dbtables)),materialYields,
      additionalItemYields:columnRows(row,16,dbtables).map(([itemId,weight])=>({item:item(itemId),encodedWeight:weight})),
      artefactYields:columnRows(row,17,dbtables).map(([rowId,weight])=>({rowId,encodedWeight:weight,
        damaged:artifactByRow.get(rowId)?.damaged??null,restored:artifactByRow.get(rowId)?.restored??null})),
      yieldInterpretation:'Typed item/DBROW references and encoded weights. Rates, roll timing, success probability and time per material remain unverified.',raw:row};
  });
  const areas=table(86).map(([id,row])=>({rowId:id,source:source(id),code:first(row,0,dbtables),kindCode:first(row,1,dbtables),
    name:first(row,2,dbtables),description:first(row,3,dbtables),level:first(row,6,dbtables),
    members:first(row,4,dbtables)===0?false:first(row,4,dbtables)===1?true:null,
    qualificationCode:first(row,7,dbtables),requirementStructId:first(row,9,dbtables),
    siteManagerNpcId:first(row,12,dbtables),areaRowIds:columnRows(row,16,dbtables).map(([value])=>value),
    hotspotRowIds:columnRows(row,17,dbtables).map(([value])=>value),raw:row}));
  const sites=areas.filter(row=>row.kindCode===1);
  for(const hotspot of hotspots){
    hotspot.areaRowIds=areas.filter(row=>row.hotspotRowIds.includes(hotspot.rowId)).map(row=>row.rowId);
    hotspot.siteRowIds=sites.filter(site=>site.areaRowIds.some(id=>hotspot.areaRowIds.includes(id))).map(row=>row.rowId);
  }
  const materialIds=new Set(hotspots.flatMap(row=>row.materialYields.map(y=>y.item.id)));
  const materials=[...materialIds].sort((a,b)=>a-b).map(id=>({...item(id),hotspotRowIds:hotspots.filter(row=>row.materialYields.some(y=>y.item.id===id)).map(row=>row.rowId)}));
  const recipeResult=extractRecipes({items,structs,enums,params});
  const productionCandidates=recipeResult.recipes.filter(row=>row.requirements.some(req=>req.skill==='Archaeology')).map(row=>({...row,
    restoredArtefactRowIds:artefacts.filter(artifact=>artifact.restored.id===row.product.id).map(artifact=>artifact.rowId)}));
  const restorations=productionCandidates.filter(row=>row.restoredArtefactRowIds.length||row.directInputs.some(input=>/\(damaged\)$/i.test(input.item.name??'')));
  const restorationByItem=new Map(productionCandidates.map(row=>[row.product.id,row]));
  const collectors=table(82).map(([id,row])=>({rowId:id,source:source(id),name:first(row,1,dbtables),npcId:first(row,2,dbtables),
    location:first(row,5,dbtables),description:first(row,4,dbtables),logRowId:first(row,7,dbtables),members:null,
    membershipStatus:'Unknown: table82 has no verified activity membership field; NPC existence does not certify collection eligibility.',raw:row}));
  const collectionToCollectors=new Map();
  for(const collector of collectors){collector.collectionRowIds=columnRows(dbrows.get(collector.logRowId),7,dbtables).map(([value])=>value);
    for(const id of collector.collectionRowIds){if(!collectionToCollectors.has(id))collectionToCollectors.set(id,[]);collectionToCollectors.get(id).push(collector.rowId);}}
  const collections=[...collectionToCollectors].sort((a,b)=>a[0]-b[0]).map(([id,collectorRowIds])=>{
    const row=dbrows.get(id),artefactItems=columnRows(row,13,dbtables).map(([value])=>item(value));
    const levels=artefactItems.map(entry=>restorationByItem.get(entry.id)?.requirements.find(req=>req.skill==='Archaeology')?.level??null);
    return {rowId:id,source:source(id),name:first(row,4,dbtables),collectorRowIds,artefactItems,
      minimumRestorationLevel:levels.every(Number.isInteger)?Math.max(...levels):null,
      members:null,membershipStatus:'Unknown: collection DB flag semantics not established.',
      f2pCompletion:levels.every(Number.isInteger)&&Math.max(...levels)>20?'Excluded by maximum restoration level exceeding verified F2P skill cap20':'Unverified; individual donations and collection reset rules are separate.',
      levelInterpretation:'Maximum explicit Archaeology restoration requirement across all collection items; access/progression gates remain separate.',
      achievementId:first(row,9,dbtables),requirementStructId:first(row,11,dbtables),
      firstRewardText:first(row,6,dbtables),repeatRewardText:first(row,7,dbtables),raw:row};});
  const achievementNames=new Map();for(const [id,row] of achievements){const key=normalized(row.name);if(!achievementNames.has(key))achievementNames.set(key,[]);achievementNames.get(key).push([id,row]);}
  const mysteries=table(92).map(([id,row])=>{
    const name=first(row,1,dbtables),matches=achievementNames.get(normalized(name))??[];
    const achievementEvidence=matches.map(([achievementId,raw])=>({achievementId,source:{major:57,minor:Math.floor(achievementId/128),subid:achievementId%128},
      f2p:raw.f2p===true,skillRequirements:[...raw.subach_skills??[],...raw.skill_reqs_2??[]],raw}));
    const levels=[...new Set(achievementEvidence.flatMap(entry=>entry.skillRequirements.filter(req=>req.skill===27).map(req=>req.level)))];
    return {rowId:id,source:source(id),name,siteRowId:first(row,3,dbtables),
      loreRowIds:columnRows(row,4,dbtables).map(([value])=>value),relatedRowIds:columnRows(row,5,dbtables).map(([value])=>value),
      level:levels.length===1?levels[0]:null,members:achievementEvidence.length===1?!achievementEvidence[0].f2p:null,
      achievementEvidence,requirementStatus:levels.length===1?'exact-name achievement requirement candidate':'level unavailable in DB row or exact-name achievement requirements',raw:row};
  });
  return {sites,areas,hotspots,materials,artefacts,restorations,productionCandidates,collectors,collections,mysteries,
    research:table(90).map(([rowId,raw])=>({rowId,source:source(rowId),raw})),researchers:table(91).map(([rowId,raw])=>({rowId,source:source(rowId),raw})),
    qualifications:table(93).map(([rowId,raw])=>({rowId,source:source(rowId),raw})),
    tableDefinitions:[...dbtables].filter(([id])=>Object.values(ARCH_TABLES).includes(id)),
    loreRows:table(81).map(([rowId,raw])=>({rowId,source:source(rowId),raw})),
    requirementStructs:[...structs].filter(([id])=>new Set([...areas.map(row=>row.requirementStructId),...collections.map(row=>row.requirementStructId)]).has(id))};
}

/** Each encoded morph branch must share the typed resource row and rectangle. */
export function resolveArchaeologyDefinition(id, definitions, resources) {
  const raw=definitions.get(id);if(!raw)return {policy:'missing-definition',classKeys:[],leaves:[]};
  const classify=definition=>{
    if(!definitionActions(definition).some(action=>/^excavate$/i.test(action)))return null;
    const rowId=parameterMap(definition).values.get(6659);
    return resources.has(rowId)?rowId:null;
  };
  const branch=morphInfo(raw)?morphAlternatives(id,definitions):[{objectId:id}];
  const leaves=[...new Set(branch.filter(row=>!row.absentState&&!row.problem).map(row=>row.objectId))];
  const rows=leaves.map(value=>classify(definitions.get(value)));
  const footprints=leaves.map(value=>[definitions.get(value)?.width??1,definitions.get(value)?.length??1]);
  const safe=branch.length>0&&branch.every(row=>!row.absentState&&!row.problem)&&rows.every(value=>value!=null&&value===rows[0])
    && footprints.every(value=>JSON.stringify(value)===JSON.stringify(footprints[0]));
  const possibleRowIds=[...new Set(rows.filter(value=>value!=null))];
  return {policy:safe?(morphInfo(raw)?'all-present-equivalent-leaves':'unconditional'):'conditional-or-untyped-review',
    classKeys:safe?[`archaeology:resource:${rows[0]}`]:[],possibleRowIds,leaves,footprint:safe?footprints[0]:null,
    branches:branch.map(({objectId,absentState,problem,path})=>({objectId,absentState:!!absentState,problem:problem??null,path:path??[]}))};
}

export function compareArchaeology(reference, result, definitions, placements) {
  const bucket=(rows,name)=>{const map=new Map();for(const row of rows){const key=normalized(name(row));if(!map.has(key))map.set(key,[]);map.get(key).push(row);}return map;};
  const resourcesByName=bucket(result.hotspots.filter(row=>row.name),row=>row.name);
  const productsByName=bucket(result.productionCandidates??result.restorations,row=>row.product.name);
  const taskRows=Object.entries(reference.challenges?.Archaeology??{}).map(([label,raw])=>{
    const resourceMatches=array(raw.Objects).flatMap(name=>resourcesByName.get(normalized(name))??[]);
    const productMatches=array(raw.Output).flatMap(name=>productsByName.get(normalized(name))??[]);
    const levels=[...resourceMatches.map(row=>row.level),...productMatches.flatMap(row=>row.requirements.filter(req=>req.skill==='Archaeology').map(req=>req.level))];
    return {label,retained:raw,resourceRowIds:resourceMatches.map(row=>row.rowId),restorationItemIds:productMatches.map(row=>row.product.id),
      levelStatus:/^Excavate with /i.test(label)?'tool-method-facility-only':!levels.length?'unmapped':levels.every(level=>level===raw.Level)?'agree':levels.some(level=>level===raw.Level)?'mixed':'disagree',
      cacheLevels:[...new Set(levels)],interpretation:'Exact object/output names; mismatches are review candidates, never automatic task replacement.'};
  });
  const objectById=new Map(definitions.map(row=>[row.objectId,row]));
  const contents=[];
  const visit=(node,location)=>{for(const [name,count] of Object.entries(node?.Object??{})){
    const matches=resourcesByName.get(normalized(name));if(!matches)continue;
    for(const match of matches){
    const hits=placements.filter(row=>row.chunkId===location.split('-')[0]&&row.classKey===`archaeology:resource:${match.rowId}`);
    contents.push({location,name,retainedQuantity:count,rowId:match.rowId,cachePlacementCount:hits.length,
      witnessedCount:hits.filter(row=>row.components.length).length,objectIds:[...new Set(hits.map(row=>row.objectId))],
      status:!hits.length?'no-static-placement-in-surface-coverage':hits.length===count?'quantity-agree':'quantity-review',
      nameJoinStatus:matches.length>1?'ambiguous-all-candidates-preserved':'unique',
      missing:'Retained section correspondence and underground/upper-plane entrance reachability are not replaced by a same-base name join.'});}
  }for(const [suffix,child] of Object.entries(node?.Sections??{}))visit(child,`${location}-${suffix}`);};
  for(const [base,node] of Object.entries(reference.chunks??{}))visit(node,base);
  const matchedRows=new Set(contents.map(row=>row.rowId)),matchedTasks=new Set(taskRows.flatMap(row=>row.resourceRowIds));
  const hotspotGaps=result.hotspots.filter(row=>!matchedTasks.has(row.rowId)).map(row=>({rowId:row.rowId,name:row.name,kind:row.kind,
    placements:placements.filter(p=>p.classKey===`archaeology:resource:${row.rowId}`).length}));
  const newContents=placements.filter(row=>!contents.some(old=>old.location.split('-')[0]===row.chunkId&&old.rowId===Number(row.classKey.split(':').at(-1))))
    .map(row=>({id:row.id,chunkId:row.chunkId,objectId:row.objectId,name:objectById.get(row.objectId)?.name??null,witnessed:row.components.length>0}));
  const allTasks=Object.entries(reference.challenges??{}).flatMap(([category,rows])=>Object.entries(rows).map(([label,raw])=>({category,label,raw})));
  const setKey=values=>[...new Set(values.map(normalized))].sort().join('\u0000');
  const collectionComparisons=(result.collections??[]).map(collection=>{
    const expected=collection.artefactItems.map(row=>row.name),key=setKey(expected);
    const matches=allTasks.filter(task=>/collection|Skills achievements#Archaeology/i.test(task.label)
      && setKey(array(task.raw.Items))===key&&normalized(task.label).includes(normalized(collection.name)));
    return {rowId:collection.rowId,name:collection.name,cacheArtefacts:expected,retainedTasks:matches,
      status:matches.length?'exact-item-set-and-name':'no-exact-item-set-and-name-match',
      interpretation:'Exact collection names and complete restored item-name sets; raw NPC selectors, gates and restrictions retained separately.'};
  });
  const mysteryComparisons=(result.mysteries??[]).map(mystery=>{
    const matches=allTasks.filter(task=>normalized(task.raw.BaseQuest)===normalized(mystery.name)
      || normalized(task.label.replace(/^~\|[^|]+\|~\s*/,''))===normalized(mystery.name));
    return {rowId:mystery.rowId,name:mystery.name,cacheLevel:mystery.level,retainedTasks:matches,
      status:matches.length?'exact-basequest-or-achievement-name':'no-exact-name-match',
      interpretation:'Authored Quest steps and Diary achievement tasks remain intact; DB mystery rows do not encode their full execution.'};
  });
  return {taskCount:taskRows.length,mappedTasks:taskRows.filter(row=>row.resourceRowIds.length||row.restorationItemIds.length).length,
    levelAgreements:taskRows.filter(row=>row.levelStatus==='agree').length,levelReviews:taskRows.filter(row=>row.levelStatus==='disagree'||row.levelStatus==='mixed').length,
    retainedContentRows:contents.length,matchedResourceRows:matchedRows.size,newPlacementContentRows:newContents.length,hotspotGaps,taskRows,contents,newContents,
    collectionComparisons,mysteryComparisons,matchedCollections:collectionComparisons.filter(row=>row.retainedTasks.length).length,
    matchedMysteries:mysteryComparisons.filter(row=>row.retainedTasks.length).length};
}
