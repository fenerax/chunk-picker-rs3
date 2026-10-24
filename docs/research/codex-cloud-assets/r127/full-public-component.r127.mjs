// Portable Docker protocol baseline; native04 executed zero cells and is not pooled.
import assert from 'node:assert/strict';
import { readFile,writeFile,appendFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deserialize } from 'node:v8';
import { parseContext,isolatePublic,SOURCE_COMMIT } from './portable-context.mjs';
import { sha256,stage,publicCase,writeCase } from './component-protocol.mjs';
const context=parseContext(process.argv.slice(2)),sourceURL=context.sourceURL;
const progress={runs:[],complete:false},phaseStarted=performance.now();
let expired=false;
const deadline=setTimeout(()=>{expired=true;stage('error');process.exit(124);},200000);
async function main(){
const isolation=isolatePublic(context);
const outputDirectory=join(context.scratch,'r127-component'),outputPath=name=>join(outputDirectory,name);
await mkdir(outputDirectory,{recursive:false});
await writeFile(outputPath('run-owner.json'),JSON.stringify({pid:process.pid,node:process.version,driver:'r127-four-mode-docker',native04MeasuredCells:0})+'\n',{flag:'wx'});
const sourceLock=JSON.parse(await readFile(context.sourceLock));
assert.equal(sourceLock.sourceCommit,SOURCE_COMMIT,'unchanged public source commit');
assert.match(sourceLock.manifestSha256,/^[0-9a-f]{64}$/);assert.ok(Array.isArray(sourceLock.files));
const sourceFiles=[
 ["timedOriginal","./r119-original-index.mjs",6739,"9e388742608443a4affb493120b2045edcc02004a7f412f2c6bd2dc962f356df"],
 ["prototype","./r119-prototype-index.mjs",7816,"f5d058741cd19b926bba2636d37c6cc2d3f30420497874f741d7b2841e622c1a"],
 ["budgeted","./r119-budgeted-index.mjs",8009,"b5f9ad2750b0a42a637784d16c09ebbf42fb5aa54ca3dd1d866d0f7041e0711d"],
 ["independentReference","./reference-original-index-6f22.mjs",6739,"9e388742608443a4affb493120b2045edcc02004a7f412f2c6bd2dc962f356df"],
 ['app/tasks/chunk-planning-index.mjs',sourceURL('app/tasks/chunk-planning-index.mjs'),6739,'9e388742608443a4affb493120b2045edcc02004a7f412f2c6bd2dc962f356df'],
 ['app/tasks/worker.mjs',sourceURL('app/tasks/worker.mjs'),30716,'f0deaa35cb61e864a4e162afa00b8afa7926911b471ea463383bf315e186170e'],
 ['app/dataset-pipeline.mjs',sourceURL('app/dataset-pipeline.mjs'),5071,'a84b3bea39ce5198ae55855a79da5085fa389870c05a5fe44a835850092daa2f'],
 ['app/core/state.mjs',sourceURL('app/core/state.mjs'),154677,'52252d48d0b15b524bffe629f14e876131a0ad55bf0e61f6c42560c5dc2d2c69'],
 ['app/data/world.mjs',sourceURL('app/data/world.mjs'),8537,'45c7b8a9831ba485d8b06b3956da285a47b588d8aa2496260b005217d454b5c8'],
 ['app/tasks/migration.mjs',sourceURL('app/tasks/migration.mjs'),62934,'2b164bb3e19644aae61f22a01ddaa1a8665582239159258cd957cd074148d44b'],
];
const sourcePins=[];
for(const [name,path,bytes,expectedSHA256]of sourceFiles){const raw=await readFile(new URL(path,import.meta.url));const actual={name,path,bytes:raw.byteLength,sha256:sha256(raw)};sourcePins.push(actual);assert.equal(actual.bytes,bytes,`${name} bytes`);assert.equal(actual.sha256,expectedSHA256,`${name} SHA256`);}
const driverBytes=await readFile(new URL(import.meta.url));progress.sourcePin=sha256(driverBytes);
await writeFile(outputPath('sources.json'),JSON.stringify({driver:{bytes:driverBytes.byteLength,sha256:sha256(driverBytes)},sourcePins},null,2)+'\n');
const [runtime,bootstrap,pipeline,worldModule,stateModule,threads,originalIndex,prototypeIndex,budgetedIndex,reference,view,projection,migrationModule]=await Promise.all([
 import(sourceURL('app/dataset-runtime.mjs')),import(sourceURL('app/dataset-bootstrap.mjs')),import(sourceURL('app/dataset-pipeline.mjs')),import(sourceURL('app/data/world.mjs')),import(sourceURL('app/core/state.mjs')),import('node:worker_threads'),import('./r119-original-index.mjs'),import('./r119-prototype-index.mjs'),import('./r119-budgeted-index.mjs'),import('./reference-original-index-6f22.mjs'),import(sourceURL('app/play-view.mjs')),import('./planning-projection.mjs'),import(sourceURL('app/tasks/migration.mjs'))]);
const fixtureBytes=await readFile(new URL('./fixtures/public-fixture.json',import.meta.url)),fixture=JSON.parse(fixtureBytes);
const defaultsBytes=await readFile(isolation.defaults);
assert.equal(fixtureBytes.byteLength,822,'frozen fixture bytes');assert.equal(sha256(fixtureBytes),'afc4dd775a78452a1e8d87efc579269f9f3dfa477674243f6e482a5503445584','frozen fixture SHA256');
assert.equal(defaultsBytes.byteLength,145,'frozen defaults bytes');assert.equal(sha256(defaultsBytes),'9e67a7976c240c5c0f687b9fd4a6f9ceead717c3741ff47006550665dc0ad615','frozen defaults SHA256');
const inputs=await bootstrap.loadDatasetInputs(runtime.selectedDataset);
// Match the ordinary public server boundary before worker compilation/migration.
// These setup operations are outside every index interval.
const setupStarted=performance.now(),dataset=runtime.selectedDataset,datasetOptions={reviewedOverlays:true};
let serverDefinitions=pipeline.prepareServerDefinitions(JSON.parse(inputs.definitionBytes.toString('utf8')),dataset,datasetOptions);
const preparedDatasetStages=pipeline.preparedDefinitionStages(serverDefinitions);
const definitions=pipeline.prepareWorkerDefinitions(structuredClone(serverDefinitions),dataset,preparedDatasetStages,datasetOptions);
const world=worldModule.buildWorld(serverDefinitions,{dataset,...datasetOptions});
const imported=stateModule.importLegacyMaps(fixture.document,{members:fixture.members,capturedAt:'2026-01-01T00:00:00.000Z'});
let state=imported.state;Object.assign(state.rules,fixture.rules);
const rawImport={savedTasks:state.tasks.length,identityRegistryPresent:state.identityRegistry!==undefined,migration:state.legacy?.gameplayMigration?.schemaVersion??null};
const taskMapSHA256=sha256(inputs.taskBytes),historyPath='app/data/legacy-task-history.json';
let historyBytes=dataset.capabilities.legacyHistory===false?Buffer.from('{}'):await dataset.bytes(historyPath);
const historySHA256=sha256(historyBytes);
let preflight,baseline;
stage('reference-start');
const worker=new threads.Worker(sourceURL('app/tasks/worker.mjs'),{resourceLimits:{maxOldGenerationSizeMb:768,maxYoungGenerationSizeMb:32},workerData:{definitions:serverDefinitions,preparedDatasetStages,datasetOptions,datasetSelection:dataset.workerSelection(),datasetDigest:dataset.digest,world:{chunks:world.chunks,areas:world.areas,surface:world.surface}}});
const wait=predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error('Baseline worker wait timeout')),60000);const cleanup=()=>{clearTimeout(timer);worker.off('message',message);worker.off('error',fail);worker.off('exit',exit);};const fail=e=>{cleanup();reject(e);};const exit=code=>fail(new Error(`Baseline worker exited ${code}`));const message=m=>{if(predicate(m)){cleanup();resolve(m);}};worker.on('message',message);worker.on('error',fail);worker.on('exit',exit);});
try{
 // Scheduler decodes this exact V8 readiness payload; do not derive a substitute catalogue.
 const ready=await wait(m=>m.type==='ready');stage('reference-ready');
 assert.equal(ready.datasetDigest,dataset.digest,'baseline worker public dataset');
 assert.ok(Array.isArray(ready.catalogue),'ordinary readiness catalogue required');
 let dynamicCatalogueBytes=ready.dynamicCatalogueBytes;delete ready.dynamicCatalogueBytes;
 let dynamicCatalogue=dynamicCatalogueBytes===undefined?ready.dynamicCatalogue??[]:deserialize(dynamicCatalogueBytes);
 dynamicCatalogueBytes=undefined;delete ready.dynamicCatalogue;
 assert.ok(Array.isArray(dynamicCatalogue),'dynamic readiness catalogue required');
 const migrated=migrationModule.migrateOwnedGameplay(state,{definitions:serverDefinitions,taskMap:JSON.parse(inputs.taskBytes.toString('utf8')),taskMapHistory:JSON.parse(Buffer.from(historyBytes).toString('utf8')),catalogue:ready.catalogue,dynamicCatalogue});
 if(migrated.state.legacy?.gameplayMigration){migrated.state.legacy.gameplayMigration.warnings=migrated.warnings;migrated.state.legacy.gameplayMigration.report=migrated.report;}
 state=stateModule.validateOwnedState(migrated.state);
 dynamicCatalogue=undefined;delete ready.catalogue;historyBytes=undefined;serverDefinitions=undefined;
 preflight={savedTasks:state.tasks.length,identityRegistrySchema:state.identityRegistry?.schemaVersion??null,aliases:state.identityRegistry?.aliases?Object.keys(state.identityRegistry.aliases).length:null,worldChunks:world.chunks.size,migration:state.legacy?.gameplayMigration?.schemaVersion??null,owners:state.members.map(m=>[m.id,m.sourceMapId,m.unlocked]),revision:state.revision,datasetDigest:dataset.digest,providerFiles:dataset.files.length};
 // Preserve observed dimensions even if a strict frozen assertion fails.
 await writeFile(outputPath('preflight.json'),JSON.stringify({rawImport,preflight,fixtureSHA256:sha256(fixtureBytes),defaultsSHA256:sha256(defaultsBytes),taskMapSHA256,historySHA256,datasetOptions,preparedDatasetStages},null,2)+'\n');
 assert.equal(preflight.identityRegistrySchema,1);assert.equal(preflight.savedTasks,23935);assert.equal(preflight.aliases,91471);assert.equal(preflight.worldChunks,2594);assert.equal(state.members.length,2);assert.equal(state.revision,0);assert.equal(preflight.datasetDigest,'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9');assert.equal(preflight.providerFiles,94);
 assert.deepEqual(state.members.map(m=>[m.id,m.sourceMapId,m.unlocked]),[['alpha','r38-alpha',['12849','12850']],['beta','r38-beta',['12341','12342']]]);
 assert.equal(preflight.migration,2,'fixed public migration schema');
 const response=wait(m=>m.id===1&&m.type!=='progress');worker.postMessage({id:1,type:'evaluate',state,memberId:'alpha',resultTransport:'json-shared-v1',resultView:'full'});const m=await response;if(m.error)throw new Error(m.error.message);baseline=JSON.parse(Buffer.from(m.resultJSON).toString());
}finally{stage('cleanup-start');await worker.terminate();stage('cleanup-end');stage('reference-close');}
const setupMs=performance.now()-setupStarted,stateSHA256=sha256(JSON.stringify(state));
stage('reference-result');
const expected=reference.buildChunkPlanningIndex(definitions,baseline,world);
const expectedPlanning=projection.planningResult({baseline,planningIndex:expected},'12849',view.projectPlayTask);
const fixtureHash=sha256(Buffer.concat([fixtureBytes,defaultsBytes,Buffer.from(inputs.selection.definitions.sha256),Buffer.from(JSON.stringify({dataset:runtime.selectedDataset.digest,options:runtime.selectedDataset.environment,datasetOptions,preparedDatasetStages,taskMapSHA256,historySHA256,owner:'alpha',chunk:'12849'}))]));
function equalAndHash(actual){
 assert.deepEqual([...actual.byLocation.keys()],[...expected.byLocation.keys()]);assert.deepEqual([...actual.clueLocations.keys()],[...expected.clueLocations.keys()]);
 const hash=createHash('sha256');const emit=x=>hash.update(JSON.stringify(x)+'\n');
 for(const [key,rows]of expected.byLocation){const found=actual.byLocation.get(key);assert.deepEqual([...found.keys()],[...rows.keys()]);emit(key);for(const [id,row]of rows){const value=found.get(id);assert.equal(value.task,row.task);assert.deepEqual(value.evidence,row.evidence);emit([id,view.projectPlayTask(value.task,{retainHiddenDisplay:true}),value.evidence]);}}
 for(const [key,clues]of expected.clueLocations){assert.deepEqual(actual.clueLocations.get(key),clues);emit([key,clues]);}
 for(const id of Object.keys(definitions.chunks)){assert.equal(actual.canonical(id),expected.canonical(id));emit([id,actual.canonical(id)]);}
 for(const owner of Object.keys(fixture.planning))for(const chunk of fixture.planning[owner]){const a=projection.planningResult({baseline,planningIndex:actual},chunk,view.projectPlayTask),b=projection.planningResult({baseline,planningIndex:expected},chunk,view.projectPlayTask);assert.deepEqual(a,b);assert.equal(a.access,baseline.access);}
 return hash.digest('hex');
}

// Frozen oracle gates execute before any measured index cell. Preserve exact serialization.
const historicalRowsJSON=JSON.stringify(expectedPlanning.rows);
const oracleObserved={stateSHA256,logicalPlanningRows:expectedPlanning.rows.length,rowBytes:Buffer.byteLength(historicalRowsJSON),rowSHA256:sha256(historicalRowsJSON),orderedIndexSHA256:equalAndHash(expected)};
const oracleExpected={stateSHA256:'fa89db91597b583cf033e89d972a62bed6c856d787cf897496a3bcde9b64cbc7',logicalPlanningRows:772,rowBytes:408272,rowSHA256:'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519',orderedIndexSHA256:'bd2f94e96f82fcb8c09f0a9829d06728f377b8278d4632b8364e869062c0bef0'};
await writeFile(outputPath('oracle-preflight.json'),JSON.stringify({fixtureHash,observed:oracleObserved,expected:oracleExpected},null,2)+'\n');
progress.oracle=oracleObserved;progress.fixtureSha256=sha256(fixtureBytes);progress.datasetDigest=preflight.datasetDigest;
for(const key of Object.keys(oracleExpected))assert.equal(oracleObserved[key],oracleExpected[key],`frozen ${key}; stop before timing on mismatch`);

// BEGIN PURE CELL PLAN
function componentCells(){
 const modes=['original-sync','prototype-sync','old-cooperative','new-budgeted'],cells=[];
 for(let repetition=0;repetition<3;repetition++){
  const order=repetition%2?[...modes].reverse():modes;
  const temperatures=repetition%2?['warm','cold']:['cold','warm'];
  for(const cache of temperatures)for(const mode of order)cells.push({repetition,cache,mode});
 }
 return cells;
}
// END PURE CELL PLAN
const modes={
 'original-sync':{module:originalIndex,incremental:false},
 'prototype-sync':{module:prototypeIndex,incremental:false},
 'old-cooperative':{module:prototypeIndex,incremental:true},
 'new-budgeted':{module:budgetedIndex,incremental:true},
};
assert.notEqual(originalIndex,reference,'timed original must have its own module/cache');
assert.notEqual(prototypeIndex,budgetedIndex,'candidate must have its own module/cache');
stage('measured-start');stage('measured-ready');
const definitionsSHA256=sha256(JSON.stringify(definitions));
const runs=progress.runs;
await writeFile(outputPath('cells.jsonl'),'');
async function runCell(cell){
 // One fresh clone per cell. Clone, hash, priming and validation are outside timing.
 let def=structuredClone(definitions),built;
 assert.equal(sha256(JSON.stringify(def)),definitionsSHA256,'per-cell definition clone');
 const implementation=modes[cell.mode];
 if(cell.cache==='warm'){
  // Use the same full synchronous priming shape for every implementation.
  implementation.module.buildChunkPlanningIndex(def,baseline,world);
 }
 const heapBefore=process.memoryUsage();
 const started=performance.now();
 if(implementation.incremental)built=await implementation.module.buildChunkPlanningIndexIncremental(def,baseline,world);
 else built=implementation.module.buildChunkPlanningIndex(def,baseline,world);
 const totalMs=performance.now()-started;
 const heapAfter=process.memoryUsage();
 const outputSHA256=equalAndHash(built);
 assert.equal(outputSHA256,oracleExpected.orderedIndexSHA256,'fixed ordered full index after timed cell');
 const planningRows=projection.planningResult({baseline,planningIndex:built},'12849',view.projectPlayTask).rows;
 const rowsJSON=JSON.stringify(planningRows),rowBytes=Buffer.byteLength(rowsJSON),rowSHA256=sha256(rowsJSON);
 assert.equal(planningRows.length,oracleExpected.logicalPlanningRows);assert.equal(rowBytes,oracleExpected.rowBytes);assert.equal(rowSHA256,oracleExpected.rowSHA256);
 const result={...cell,totalMs,heapBefore,heapAfter,outputSHA256,rowBytes,rowSHA256};
 built=undefined;def=undefined;
 return result;
}
for(const cell of componentCells()){
 stage('episode-start');
 console.log(JSON.stringify({status:'cell-start',...cell}));
 const result=await runCell(cell);
 runs.push(result);stage('episode-end');
 await appendFile(outputPath('cells.jsonl'),JSON.stringify(result)+'\n');
 console.log(JSON.stringify({status:'cell-pass',...cell,totalMs:result.totalMs,outputSHA256:result.outputSHA256}));
}
assert.equal(runs.length,24);
assert.equal(new Set(runs.map(run=>`${run.repetition}/${run.cache}/${run.mode}`)).size,24);
const vectors={};
for(const mode of Object.keys(modes))for(const cache of ['cold','warm'])vectors[`${mode}/${cache}`]=runs.filter(run=>run.mode===mode&&run.cache===cache).map(run=>run.totalMs);
progress.setupMs=setupMs;
const result={driver:'r127-four-mode-docker',native04MeasuredCells:0,node:process.version,fixtureHash,stateSHA256,definitionsSHA256,rawImport,preflight,setupMs,migrationInputs:{taskMapSHA256,historySHA256,datasetOptions,preparedDatasetStages},sourcePins,oracle:oracleObserved,referenceEquality:true,cellCount:runs.length,vectors,runs,limits:['index component only; no HTTP/residency/SLO acceptance','three repetitions do not establish stable throughput','cold/warm describes declaration cache, not process/JIT/GC state','cooperative operations have no hard 8ms bound','heap/RSS approximate; no forced GC; whole-tree guard ledger remains required','native IPC cancellation and browser fairness are separate runtime gates']};
await writeFile(outputPath('component-results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'all-cells-pass',fixtureHash,referenceEquality:true,cellCount:runs.length,vectors}));

progress.complete=true;

}
let failure;
try{await main();}catch(error){failure=error;stage('error');}finally{clearTimeout(deadline);}
const summary=publicCase({...progress,count:progress.runs.length,elapsedMs:performance.now()-phaseStarted,failureCode:expired?'controller-deadline':failure?.code==='ERR_ASSERTION'?'fixture-hash-mismatch':'runtime-error'});
await writeCase(summary);stage('result');
process.exitCode=summary.passed&&!failure?0:1;
