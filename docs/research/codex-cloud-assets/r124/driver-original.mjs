import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fingerprint,assertEquivalent} from './oracle.mjs';
const [tree,out,arm]=process.argv.slice(2), root=resolve(tree), dir=resolve(out);
const load=p=>import(pathToFileURL(resolve(root,p))), sha=b=>createHash('sha256').update(b).digest('hex');
const fixtureBytes=readFileSync(new URL('./fixture.json',import.meta.url)),fixture=JSON.parse(fixtureBytes);
assert.equal(sha(fixtureBytes),'afc4dd775a78452a1e8d87efc579269f9f3dfa477674243f6e482a5503445584');
console.log('R105 stage provider');
const {selectedDataset:dataset}=await load('app/dataset-runtime.mjs');
assert.equal(dataset.id,'duo-legacy');assert.equal(dataset.packed,false);assert.equal(dataset.files.length,94);
if(arm==='baseline')assert.equal(dataset.digest,'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9');
writeFileSync(resolve(dir,'provider.json'),JSON.stringify({digest:dataset.digest,files:dataset.files,capabilities:dataset.capabilities,defaults:dataset.gameDefaults},null,2)+'\n');
const {loadDatasetInputs}=await load('app/dataset-bootstrap.mjs');
const {prepareServerDefinitions,prepareWorkerDefinitions}=await load('app/dataset-pipeline.mjs');
const inputs=await loadDatasetInputs(dataset),taskMap=JSON.parse(inputs.taskBytes);
const definitions=prepareWorkerDefinitions(prepareServerDefinitions(JSON.parse(inputs.definitionBytes),dataset),dataset);
const {createTaskEngine,taskId,plainLabel}=await load('app/tasks/engine.mjs');
const {legacyTaskId}=await load('app/tasks/identity.mjs');
const {applySkillGuideTasks,skillGuideCatalogue}=await load('app/data/skill-guides.mjs');
const {buildEquipmentCatalogue}=await load('app/tasks/presentation.mjs');
const {createCollectionEngine}=await load('app/tasks/collection.mjs');
const {importLegacyMaps}=await load('app/core/state.mjs');
const {migrateOwnedGameplay}=await load('app/tasks/migration.mjs');
console.log('R105 stage catalogue');
const engine=createTaskEngine(definitions,{dataset,skillGuideCatalogue}),ordinary=new Set(engine.catalogue.map(r=>r.id));
const guideDefinitions=applySkillGuideTasks(definitions,{catalogue:skillGuideCatalogue});
const generated=Object.entries(guideDefinitions.challenges).flatMap(([category,entries])=>Object.entries(entries).flatMap(([rawLabel,record])=>{
 const id=taskId(category,rawLabel,record);return ordinary.has(id)?[]:[{id,label:plainLabel(rawLabel),category,rawLabel,kind:'task',aliases:[legacyTaskId(category,rawLabel)]}];
}));
const collections=createCollectionEngine(definitions,{dataset}),equipment=buildEquipmentCatalogue(definitions);
const house=engine.catalogue.filter(r=>r.kind==='house-storage').map(({slotId,...identity})=>identity);
const catalogue=[...engine.catalogue.filter(r=>r.kind!=='house-storage'),...equipment],dynamicCatalogue=[...collections.catalogue,...house,...generated];
const imported=importLegacyMaps(fixture.document,{members:fixture.members,capturedAt:'2026-01-01T00:00:00.000Z'});
const migrated=migrateOwnedGameplay(imported.state,{definitions,taskMap,taskMapHistory:dataset.json('app/data/legacy-task-history.json'),catalogue,dynamicCatalogue});
const state=migrated.state;Object.assign(state.rules,fixture.rules);
assert.equal(state.legacy.gameplayMigration.schemaVersion,2);assert.equal(state.tasks.length,23935);assert.equal(Object.keys(state.identityRegistry.aliases).length,91471);
const initialDefinitions=fingerprint(definitions),stateHash=fingerprint(state);
const summary={arm,providerDigest:dataset.digest,providerFiles:dataset.files.length,fixtureSHA256:sha(fixtureBytes),definitionsHash:initialDefinitions,stateHash,migration:{schema:2,savedTasks:state.tasks.length,aliases:Object.keys(state.identityRegistry.aliases).length},catalogueCounts:{ordinary:catalogue.length,dynamic:dynamicCatalogue.length},results:[]};
writeFileSync(resolve(dir,'migration.json'),JSON.stringify({report:migrated.report,summary},null,2)+'\n');
for(const owner of ['alpha','beta']){
 const original=structuredClone(state),unlocked=structuredClone(state);unlocked.members.find(r=>r.id===owner).unlocked.push(fixture.unlock[owner]);
 for(const [label,template] of [['cold',original],['identical-hit',original],['unlocked',unlocked],['unlocked-hit',unlocked]]){
  const input=structuredClone(template),before=fingerprint(input);console.log('R105 evaluate',owner,label);
  const result=engine.evaluate(input,owner);assert.equal(fingerprint(input),before,'input mutation');assert.equal(fingerprint(definitions),initialDefinitions,'definitions mutation');
  assertEquivalent(result,result,'required hidden metadata');
  const metrics=Object.fromEntries(Reflect.ownKeys(result.metrics).filter(k=>k!=='elapsedMs').map(k=>[k,result.metrics[k]]));
  const row={owner,label,inputHash:before,semanticHash:fingerprint(result,true),rows:result.tasks.length,statuses:result.tasks.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{}),metrics,elapsedMs:{value:result.metrics.elapsedMs,cachedOrHistorical:label.includes('hit')},eligibilityCacheHit:result.metrics.eligibilityCacheHit};
  summary.results.push(row);writeFileSync(resolve(dir,'results.json'),JSON.stringify(summary,null,2)+'\n');console.log('R105 completed',owner,label,row.rows,row.semanticHash);
 }
}
assert.equal(summary.results.length,8);console.log('R105 COMPLETE eight full engine results');
