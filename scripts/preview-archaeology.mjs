#!/usr/bin/env node
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { buildEquipmentCatalogue, evaluateEquipment } from '../app/tasks/equipment.mjs';
import { cacheArchaeologyCatalogue } from '../app/data/cache-archaeology.mjs';
import { cacheResourceContentsEnabled } from '../app/data/cache-resources.mjs';
import { readStateCopy, buildObjectCanonicalMap, flattenChunkContents, diffChunkContents, summarizeTask,
  diffTasks, findSourceChunkRegressions } from './preview-resource-contents.mjs';

const unique = values => [...new Set(values)].sort();
function evaluator(definitions, options) {
  const engine = createTaskEngine(definitions, { dataset: selectedDataset, ...options }), collection = createCollectionEngine(definitions, { dataset: selectedDataset });
  const names = Object.keys(definitions.equipment ?? {});
  const equipmentIds = new Map(buildEquipmentCatalogue(definitions).map((row,index)=>[row.id,names[index]]));
  return (state,memberId) => {
    const member=state.members.find(row=>row.id===memberId);
    const saved=unique([...Object.keys(member.taskStatus??{}),...member.completedTasks??[]]);
    const result=engine.evaluate(state,memberId,{ownItemQueries:saved.filter(id=>equipmentIds.has(id)).map(id=>equipmentIds.get(id))});
    result.tasks.push(...collection.evaluate(state,memberId,result,{obligationQueries:saved}).tasks);
    result.tasks=[...new Map([...result.tasks,...evaluateEquipment(result,state,memberId,definitions).catalogue].map(row=>[row.id,row])).values()];
    return result;
  };
}

/** No store hydration, writes, network, selected access or hypothetical rolls. */
export function buildArchaeologyPreview(definitions, state, { archaeologyCatalogue = cacheArchaeologyCatalogue,
  cacheWalking = true, cacheResources = cacheResourceContentsEnabled(), metadataCorrections = true, lodestones, resourceCatalogue, resourceSelectors, reviewedOverlays } = {}) {
  const original=JSON.stringify(state);
  const shared={cacheWalking,cacheResources,metadataCorrections,lodestones,archaeologyCatalogue,resourceCatalogue,resourceSelectors,
    ...(reviewedOverlays === undefined ? {} : { reviewedOverlays })};
  const beforeWorld=buildWorld(definitions,{ dataset: selectedDataset,...shared,cacheArchaeology:false});
  const afterWorld=buildWorld(definitions,{ dataset: selectedDataset,...shared,cacheArchaeology:true});
  const topology=world=>JSON.stringify([...world.sectionTopology].map(([id,sections])=>[id,[...sections]]));
  if(topology(beforeWorld)!==topology(afterWorld))throw new Error('Archaeology switch changed walking topology.');
  const names=buildObjectCanonicalMap(archaeologyCatalogue,{mappings:archaeologyCatalogue.mappings??[]});
  const beforeEvaluate=evaluator(definitions,{...shared,cacheArchaeology:false}),afterEvaluate=evaluator(definitions,{...shared,cacheArchaeology:true});
  const members=[...state.members].sort((a,b)=>a.id.localeCompare(b.id)).map(member=>{
    const before=beforeEvaluate(state,member.id),after=afterEvaluate(state,member.id);
    const summarize=row=>({...summarizeTask(row,state.identityRegistry),level:row.level??null});
    const prior=before.tasks.map(summarize),current=after.tasks.map(summarize);
    const tasks=diffTasks(prior,current),sourceChunkLosses=findSourceChunkRegressions(prior,current,member.unlocked);
    const priorById=new Map(prior.map(row=>[row.id,row]));
    for(const row of current){
      const old=priorById.get(row.id);
      if(!old||old.level===row.level)continue;
      let change=tasks.find(task=>task.id===row.id);
      if(!change){change={id:row.id,label:row.label,becameAvailable:false,becameUnavailable:false,sourcesChanged:false,
        before:old,after:row,addedSourceChunks:[],removedSourceChunks:[]};tasks.push(change);}
      change.metadataChanges=[{field:'level',before:old.level,after:row.level}];
    }
    tasks.sort((a,b)=>a.id.localeCompare(b.id));
    const ids=unique([...member.unlocked,...member.selected,...member.pendingRoll]);
    const chunks=ids.map(id=>({id,scopes:['unlocked','selected','pendingRoll'].filter(scope=>member[scope].includes(id)),
      ...diffChunkContents(flattenChunkContents(beforeWorld.resourceContents.get(id),id,names),flattenChunkContents(afterWorld.resourceContents.get(id),id,names))}));
    return {id:member.id,chunks,tasks,regressions:{sourceChunkLosses},counts:{beforeAvailable:prior.filter(row=>row.available).length,
      afterAvailable:current.filter(row=>row.available).length,availabilityGains:tasks.filter(row=>row.becameAvailable).length,
      availabilityLosses:tasks.filter(row=>row.becameUnavailable).length,lostSourceTasks:sourceChunkLosses.length,
      taskMetadataChanges:tasks.filter(row=>row.metadataChanges?.length).length,
      lostSourceChunks:sourceChunkLosses.reduce((sum,row)=>sum+row.lostSourceChunks.length,0)}};
  });
  if(original!==JSON.stringify(state))throw new Error('Archaeology preview mutated its supplied state.');
  return {schemaVersion:1,beforeCacheArchaeology:false,afterCacheArchaeology:true,cacheWalking,cacheResources,metadataCorrections,
    taskCoverage:'Task engine, collection goals and equipment; current unlocked chunks only. Selected/pending rows show contents only.',
    catalogueSummary:archaeologyCatalogue.summary,members};
}

export function renderArchaeologyPreview(report){
  const lines=['Archaeology contents preview','Before: retained. After: cache Archaeology. Walking topology is identical.',report.taskCoverage];
  for(const member of report.members){lines.push('',`Member ${member.id}: available ${member.counts.beforeAvailable} -> ${member.counts.afterAvailable}`,
    `Availability gains/losses: ${member.counts.availabilityGains}/${member.counts.availabilityLosses}; owned source task/chunk losses: ${member.counts.lostSourceTasks}/${member.counts.lostSourceChunks}`);
    for(const chunk of member.chunks){lines.push(`${chunk.id} (${chunk.scopes.join(', ')})`);
      for(const kind of ['added','removed','reclassified','changed'])for(const row of chunk[kind])lines.push(`  ${kind}: ${row.label} ${JSON.stringify(row)}`);
    }
    for(const row of member.tasks)lines.push(`  Task ${row.label}: ${row.becameAvailable?'became available':row.becameUnavailable?'became unavailable':row.sourcesChanged?'sources changed':'metadata changed'}; ${JSON.stringify(row.before?.sources)} -> ${JSON.stringify(row.after?.sources)}${row.metadataChanges?.length?`; metadata ${JSON.stringify(row.metadataChanges)}`:''}`);
  }return lines.join('\n');
}
export async function main(args=process.argv.slice(2)){
  let statePath,json=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--state'&&args[i+1]&&!statePath)statePath=args[++i];else if(args[i]==='--json'&&!json)json=true;
    else throw new Error('Use node scripts/preview-archaeology.mjs --state <state.json copy> [--json]');}
  if(!statePath)throw new Error('An explicit --state copy path is required.');
  const loaded=await readStateCopy(statePath),referenceURL=new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url);
  const referenceBytes=await readFile(referenceURL),definitions=JSON.parse(referenceBytes);
  const report={...buildArchaeologyPreview(definitions,loaded.state),sourceSha256:loaded.sourceSha256};await loaded.verifyUnchanged();
  if(!referenceBytes.equals(await readFile(referenceURL)))throw new Error('Definitions changed during archaeology preview.');
  process.stdout.write(`${json?JSON.stringify(report,null,2):renderArchaeologyPreview(report)}\n`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
