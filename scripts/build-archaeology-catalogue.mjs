#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './cache/game-data-common.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { extractArchaeology, resolveArchaeologyDefinition, compareArchaeology } from './cache/archaeology-catalogue.mjs';
import { readPlacementRows, verifyResourceMaskManifest, validateResourceMaskCoverage } from './build-resource-catalogue.mjs';
import { effectiveDisplayPlane, resourceWitness, definitionActions, componentMasks } from './cache/resource-catalogue.mjs';
import { inCrop } from './cache/surface.mjs';

const scratchRoot='C:/Users/User/Projects/rs3-cache-work/archmaps-archaeology';
const defaultInput=`${scratchRoot}/objects-copy`;
const readJSON=path=>JSON.parse(readFileSync(path));
const root=resolve(import.meta.dirname,'..');
const compact=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['raw','rawParams','rawXp','description','missing','achievementEvidence','membershipEvidence'].includes(key)));

export async function buildArchaeologyCatalogue(options={}) {
  const output=options.output;if(!output)throw new Error('--output must name a new local research directory.');
  const input=resolve(options.input??defaultInput);
  if(!input.replaceAll('\\','/').toLowerCase().startsWith(scratchRoot.toLowerCase()+'/'))throw new Error('Use an authorized export copy inside archmaps-archaeology scratch.');
  const {cache,context}=await openGameCache({workspace:options.workspace,build:Number(options.build??950)});
  const tables={},decodeReport={};
  for(const [name,spec] of Object.entries({items:{major:19,kind:'item'},structs:{major:22,kind:'struct',groupSize:32},enums:{major:17,kind:'enum'},
    params:{major:2,minor:11,kind:'param'},dbrows:{major:2,minor:41,kind:'dbrow'},dbtables:{major:2,minor:40,kind:'dbtable'},
    achievements:{major:57,groupSize:128,kind:'achievement'}})){
    const decoded=loadTable(cache,spec);tables[name]=decoded.definitions;
    decodeReport[name]={decoded:decoded.definitions.size,errors:decoded.errors};
  }
  const result=extractArchaeology(tables);
  const manifestBytes=readFileSync(join(input,'objects.manifest.v1.json')),manifest=JSON.parse(manifestBytes);
  context.generatedAt=manifest.generatedAt;
  context.generatedAtStatus='Inherited source-export timestamp for deterministic provenance; not wall-clock extraction time.';
  const inputHashes=[];
  for(const file of ['objects.definitions.v1.json.gz','objects.placements.v1.json.gz','objects.layouts.v1.json.gz']){
    const bytes=readFileSync(join(input,file)),hash=sha256(bytes),entry=manifest.outputs.find(row=>basename(row.path)===file);
    if(entry?.sha256!==hash)throw new Error(`Copied export hash mismatch: ${file}`);inputHashes.push({file,sha256:hash});
  }
  const rawObjects=JSON.parse(gunzipSync(readFileSync(join(input,'objects.definitions.v1.json.gz')))).definitions;
  const rawDefinitions=new Map(rawObjects.map(row=>[row.objectId,row.raw]));
  const resources=new Map(result.hotspots.map(row=>[row.rowId,row])),resolved=new Map(),definitions=[];
  for(const row of rawObjects){
    const resolution=resolveArchaeologyDefinition(row.objectId,rawDefinitions,resources);
    if(!resolution.classKeys.length&&!resolution.possibleRowIds.length)continue;
    resolved.set(row.objectId,resolution);definitions.push({objectId:row.objectId,name:row.name,actions:definitionActions(row.raw),
      rowIds:resolution.possibleRowIds,classKeys:resolution.classKeys,conditionalPolicy:resolution.policy,leafObjectIds:resolution.leaves,
      footprint:resolution.footprint,branches:resolution.branches,membersFlags:{is_members:row.raw.is_members??null,isMembers:row.raw.isMembers??null},
      definitionSource:{major:16,minor:Math.floor(row.objectId/256),subfile:row.objectId%256}});
  }
  const walkPath=join(root,'app/data/cache-walkability.2026-10-07.v1.json'),walk=readJSON(walkPath);
  const evidence=readJSON(join(root,'app/data/cache-selector-evidence.2026-10-07.v1.json'));
  const corrections=readJSON(join(root,'app/data/cache-surface-corrections.2026-10-08.v1.json'));
  const maskDirectory=resolve(options.masks??`${scratchRoot}/masks-copy`);
  if(!maskDirectory.replaceAll('\\','/').toLowerCase().startsWith(scratchRoot.toLowerCase()+'/'))throw new Error('Use scratch mask copies.');
  const maskBytes=readFileSync(join(maskDirectory,'walkability.v1.json.gz'));
  const maskProvenance=verifyResourceMaskManifest({manifestBytes:readFileSync(join(maskDirectory,'manifest.v1.json')),walkBytes:maskBytes,
    membershipBytes:readFileSync(join(maskDirectory,'membership.v1.json')),objectManifest:manifest,walk,evidence,corrections});
  const fullWalk=JSON.parse(gunzipSync(maskBytes)),regions=componentMasks(fullWalk,corrections);
  validateResourceMaskCoverage(fullWalk,walk,regions);
  const placements=[],allPlacements=[],review=[];let scanned=0;
  for await(const text of readPlacementRows(join(input,'objects.placements.v1.json.gz'))){
    scanned++;const objectId=Number(/"objectId":(\d+)/.exec(text)?.[1]);if(!resolved.has(objectId))continue;
    const p=JSON.parse(text),resolution=resolved.get(objectId),effectivePlane=effectiveDisplayPlane(p);
    allPlacements.push({...p,effectivePlane,classKeys:resolution.classKeys,definitionPolicy:resolution.policy});
    if(p.mapId!==28||!inCrop(p.x,p.y)||effectivePlane!==0){review.push({id:p.id,objectId,reason:'outside-reviewed-surface-scope',mapId:p.mapId,plane:effectivePlane});continue;}
    if(!resolution.classKeys.length){review.push({id:p.id,objectId,reason:resolution.policy});continue;}
    const witness=resourceWitness(regions,p,resolution.footprint);
    for(const classKey of resolution.classKeys)placements.push({...p,classKey,chunkId:String(p.chunkId),effectivePlane,
      components:witness.components,witnessMethod:witness.method,witnessTiles:witness.tiles});
    if(!witness.components.length)review.push({id:p.id,objectId,reason:'no-exact-component-witness'});
    if(witness.excludedComponents?.length)review.push({id:p.id,objectId,reason:'excluded-surface-component',components:witness.excludedComponents});
    if(witness.components.length>1)review.push({id:p.id,objectId,reason:'multiple-footprint-components',components:witness.components});
  }
  placements.sort((a,b)=>a.id.localeCompare(b.id));allPlacements.sort((a,b)=>a.id.localeCompare(b.id));
  const referenceBytes=readFileSync(join(root,'rs3-chunkpicker-chunkinfo-export.json')),reference=JSON.parse(referenceBytes);
  const comparison=compareArchaeology(reference,result,definitions,placements);
  const wiki=options.wiki?readJSON(options.wiki):[];
  for(const mystery of result.mysteries){
    const page=wiki.find(row=>row.title?.toLowerCase()===mystery.name.toLowerCase());
    const levels=[...new Set([...page?.wikitext?.matchAll(/\{\{Skillreq\|Archaeology\|(\d+)/g)??[]].map(match=>Number(match[1])))];
    mystery.wikiRequirement=levels.length===1?{level:levels[0],url:page.url,revision:page.revision,evidence:'Explicit Archaeology Skillreq template in current revision'}:null;
    mystery.retainedTaskRequirements=comparison.mysteryComparisons.find(row=>row.rowId===mystery.rowId)?.retainedTasks??[];
  }
  const wikiEvidence=wiki.map(({wikitext,fields,...row})=>({...row,fields,
    evidenceStatus:row.error?'unavailable':'Current public API revision checked; bounded corroboration, not a Wiki-generated catalogue.'}));
  const research={schemaVersion:1,decodeReport,...result,definitions,placements:allPlacements,comparison,wikiEvidence,
    limits:['Client cache yields retain encoded weights; no gathering rates, server drop probability or player state are inferred.',
      'Every conditional leaf must be present and share row identity and footprint before surface attachment.',
      'Full copied placements cover many maps/planes; runtime admits only map28 effective-plane0 in existing reviewed masks.',
      'Mystery levels are exact-name achievement requirement candidates; missing skill requirements stay unknown.',
      'Restoration inputs preserve grouped alternatives, flags and raw XP. No generalized XP/action conversion.',
      'F2P cap20 is skill scope, not access to every level20 dig site. Infernal Source is members-only.']};
  context.outputs.push(writeDataset(output,'archaeology-extraction.2026-10-08.v1.json',research));
  const extractionFile=context.outputs[0];
  context.outputs=context.outputs.map(row=>({...row,path:basename(row.path)}));
  const finished=await finishManifest(cache,context,output,{name:'archaeology-manifest.v1.json',decodeReport,
    sourceExport:{manifestSha256:sha256(manifestBytes),inputs:inputHashes},scripts:{
      builder:sha256RepositoryText(readFileSync(new URL(import.meta.url))),extractor:sha256RepositoryText(readFileSync(new URL('./cache/archaeology-catalogue.mjs',import.meta.url)))}});
  const wikiMembership=new Map(wiki.filter(row=>!row.error).map(row=>[row.title.toLowerCase(),
    row.fields?.some(field=>/\|members\s*=\s*No\s*$/i.test(field))?false:row.fields?.some(field=>/\|members\s*=\s*Yes\s*$/i.test(field))?true:null]));
  const classes=result.hotspots.filter(row=>row.name).map(row=>({key:`archaeology:resource:${row.rowId}`,name:row.name,
    rowId:row.rowId,kind:row.kind,level:row.level,cacheMembershipCandidate:row.members,
    members:row.level>20?true:wikiMembership.get(row.name.toLowerCase())??null,
    membershipEvidence:row.level>20?'Above verified F2P skill cap20':wikiMembership.has(row.name.toLowerCase())?'Named current Wiki sample':'Unverified; cache boolean candidate alone cannot grant F2P'}));
  const names=new Set(classes.map(row=>row.name.toLowerCase())),mappingNames=new Set(classes.map(row=>row.name));
  for(const node of Object.values(reference.chunks)){
    for(const child of [node,...Object.values(node.Sections??{})])for(const name of Object.keys(child.Object??{}))if(names.has(name.toLowerCase()))mappingNames.add(name);
  }
  for(const name of Object.keys(reference.taskUnlocks?.Objects??{}))if(names.has(name.toLowerCase()))mappingNames.add(name);
  const mappings=[...mappingNames].sort().map(name=>({name,classKeys:classes.filter(row=>row.name.toLowerCase()===name.toLowerCase()).map(row=>row.key)}));
  const usedRows=new Set(definitions.flatMap(row=>row.rowIds));
  const summary={sites:result.sites.length,areas:result.areas.length,resourceRows:result.hotspots.length,excavationHotspots:result.hotspots.filter(row=>row.kind==='excavation-hotspot').length,
    materialCaches:result.hotspots.filter(row=>row.kind==='material-cache').length,materials:result.materials.length,artefacts:result.artefacts.length,
    restorations:result.restorations.length,archaeologyProductionCandidates:result.productionCandidates.length,
    linkedArtefactRestorations:result.restorations.filter(row=>row.restoredArtefactRowIds.length).length,
    distinctDamagedItemIds:new Set(result.artefacts.map(row=>row.damaged.id).filter(Number.isInteger)).size,
    distinctRestoredItemIds:new Set(result.artefacts.map(row=>row.restored.id).filter(Number.isInteger)).size,
    unresolvedArtefactItemReferences:result.artefacts.reduce((sum,row)=>sum+Number(!row.damaged.definitionPresent)+Number(!row.restored.definitionPresent),0),
    collectors:result.collectors.length,collections:result.collections.length,mysteries:result.mysteries.length,
    mysteryLevels:result.mysteries.filter(row=>row.level!==null).length,wikiMysteryLevels:result.mysteries.filter(row=>row.wikiRequirement).length,
    f2pCacheBooleanCandidates:result.hotspots.filter(row=>row.members===false).length,
    f2pValidatedResources:classes.filter(row=>row.members===false).length,
    definitions:definitions.length,resourcesWithDefinitions:usedRows.size,scannedPlacements:scanned,allMapPlacements:allPlacements.length,
    surfacePlacements:placements.length,witnessedPlacements:placements.filter(row=>row.components.length).length,
    witnessedChunks:new Set(placements.filter(row=>row.components.length).map(row=>row.chunkId)).size,
    f2pWitnessedPlacements:placements.filter(row=>row.components.length&&classes.find(value=>value.key===row.classKey)?.members===false).length,
    reviewPlacements:review.length,retainedTaskRows:comparison.taskCount,mappedTaskRows:comparison.mappedTasks,
    retainedLevelReviews:comparison.levelReviews,retainedContentRows:comparison.retainedContentRows,newContentPlacements:comparison.newPlacementContentRows,
    matchedCollections:comparison.matchedCollections,matchedMysteries:comparison.matchedMysteries};
  const runtime={schemaVersion:1,provenance:{decoder:context.decoder,sources:finished.manifest.sources,
    extraction:{file:basename(extractionFile.path),sha256:extractionFile.sha256},manifest:{file:basename(finished.file.path),sha256:finished.file.sha256},
    objectExport:{manifestSha256:sha256(manifestBytes),inputs:inputHashes},walkability:{file:basename(walkPath),sha256:sha256RepositoryText(readFileSync(walkPath)),masks:maskProvenance},
    referenceSha256:sha256RepositoryText(referenceBytes),builderSha256:sha256RepositoryText(readFileSync(new URL(import.meta.url))),
    extractorSha256:sha256RepositoryText(readFileSync(new URL('./cache/archaeology-catalogue.mjs',import.meta.url))),wikiEvidence},
    scope:{mapId:28,effectivePlane:0,crop:walk.summary.crop,f2pSkillCap:20,enabledByDefault:false},summary,
    classes,definitions,placements,coverage:walk.regions.map(row=>[row[0],row[1]]),mappings,review,
    sites:result.sites.map(compact),areas:result.areas.map(compact),hotspots:result.hotspots.map(row=>({...compact(row),cacheMembershipCandidate:row.members,
      members:classes.find(value=>value.rowId===row.rowId)?.members??null})),materials:result.materials,
    artefacts:result.artefacts.map(compact),restorations:result.restorations.map(compact),collectors:result.collectors.map(compact),
    collections:result.collections.map(compact),mysteries:result.mysteries.map(compact),limits:research.limits};
  const cataloguePath=resolve(options.catalogue??join(root,'app/data/cache-archaeology.2026-10-08.v1.json'));
  if(!cataloguePath.replaceAll('\\','/').startsWith(root.replaceAll('\\','/')+'/'))throw new Error('Runtime catalogue must remain in this worktree.');
  writeFileSync(cataloguePath,JSON.stringify(runtime));
  return {summary,catalogueSha256:sha256RepositoryText(readFileSync(cataloguePath)),output};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options=cliOptions();buildArchaeologyCatalogue(options).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.stack);process.exitCode=1;});
}
