import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateRecord} from './trace-contract.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const one=(records,event)=>{const a=records.filter(x=>x.event===event);assert.equal(a.length,1,event);return a[0];};
const number=(x)=>typeof x==='boolean'?Number(x):x;
export function reduceTrace(files,proof){
 assert.ok(['A','C'].includes(proof.arm));assert.equal(Object.keys(files).length,5,'root and two relay/thread isolate pairs');
 const byClock={},proofRecords=[],all=[];
 for(const [clock,records]of Object.entries(files)){
  assert.ok(Array.isArray(records)&&records.length>0&&records.length<=96);let previous;
  for(const [i,record]of records.entries()){
   validateRecord(record);assert.equal(record.clock,clock);assert.equal(record.seq,i+1);
   if(previous){assert.ok(record.atMs>=previous.atMs);assert.ok(record.priorObserverMs>=previous.priorObserverMs);assert.ok(record.spanClockReads>=previous.spanClockReads);}
   previous=record;all.push(record);
  }
  const self=one(records,'self-proof');assert.equal(self.observerSha,proof.observerSha);assert.equal(self.contractSha,proof.contractSha);
  for(const p of records.filter(x=>x.event==='module-proof')){assert.equal(p.sha,proof.modules[p.moduleCode].sha256);proofRecords.push({clock,module:p.moduleCode,sha:p.sha});}
  byClock[clock]=records;
 }
 const main=byClock['root-main'];assert.ok(main);
 assert.deepEqual(main.filter(x=>x.event==='module-proof').map(x=>x.moduleCode).sort(),['process-worker','scheduler','server']);
 const ready=main.filter(x=>x.event==='scheduler-ready');assert.equal(ready.length,2);
 assert.deepEqual(ready.map(x=>x.lane).sort(),['foreground','prediction']);
 const foreground=ready.find(x=>x.lane==='foreground'),prediction=ready.find(x=>x.lane==='prediction');
 assert.equal(foreground.endpoint,0);assert.equal(prediction.endpoint,1);
 assert.notEqual(foreground.endpoint,prediction.endpoint);assert.equal(foreground.generation,1);assert.equal(prediction.generation,1);
 const expectedClocks=['root-main',...ready.flatMap(x=>['endpoint-'+x.endpoint+'-host','endpoint-'+x.endpoint+'-worker'])].sort();
 assert.deepEqual(Object.keys(byClock).sort(),expectedClocks);
 const metrics={},put=(key,value)=>{assert.ok(typeof number(value)==='number'&&Number.isFinite(number(value))&&number(value)>=0);metrics[key]=number(value);};
 const laneRecords={};
 for(const lane of [foreground,prediction]){
  const host=byClock['endpoint-'+lane.endpoint+'-host'],worker=byClock['endpoint-'+lane.endpoint+'-worker'];
  assert.deepEqual(host.filter(x=>x.event==='module-proof').map(x=>x.moduleCode),['process-worker-host']);
  assert.deepEqual(worker.filter(x=>x.event==='module-proof').map(x=>x.moduleCode),['worker']);
  const emitted=one(worker,'worker-ready'),relayed=one(host,'host-ready'),parent=one(main.filter(x=>x.endpoint===lane.endpoint),'parent-ready');
  for(const key of ['cataloguePresent','catalogueRows','dynamicPresent','dynamicBytes'])assert.equal(emitted[key],lane[key],key),assert.equal(relayed[key],lane[key],key),assert.equal(parent[key],lane[key],key);
  const omit=proof.arm==='C'&&lane.lane==='prediction';assert.equal(emitted.omitFlag,omit);assert.equal(emitted.serializationObserved,!omit);
  assert.equal(lane.cataloguePresent,!omit);assert.equal(lane.dynamicPresent,!omit);
  if(omit){assert.equal(lane.catalogueRows,0);assert.equal(lane.dynamicBytes,0);assert.equal(emitted.serializationMs,0);}
  else {assert.ok(lane.catalogueRows>0&&lane.dynamicBytes>0);}
  const catalogues=one(worker,'worker-catalogues');assert.ok(catalogues.engineRows>0);
  if(!omit)assert.equal(lane.catalogueRows,catalogues.engineRows-catalogues.houseRows+catalogues.equipmentRows);
  const label=lane.lane==='foreground'?'Foreground':'Prediction';
  for(const key of ['cataloguePresent','catalogueRows','dynamicPresent','dynamicBytes'])put(label+key[0].toUpperCase()+key.slice(1),lane[key]);
  laneRecords[lane.lane]={lane,host,worker,emitted,catalogues,parent};
 }
 const p=laneRecords.prediction,d=one(main,'scheduler-dispatch'),transport=one(main,'dispatch-transport');
 assert.equal(d.endpoint,prediction.endpoint);assert.equal(d.lane,'prediction');assert.equal(d.generation,1);assert.ok(d.resident&&d.predictionReady&&d.predictionResident);
 assert.equal(transport.endpoint,prediction.endpoint);assert.equal(one(main,'dispatch-post').endpoint,prediction.endpoint);
 for(const event of ['parent-spawn','parent-first-native'])put(event==='parent-spawn'?'ParentForkToSpawnMs':'ParentForkToFirstNativeMs',one(main.filter(x=>x.endpoint===prediction.endpoint),event).spanMs);
 put('ParentForkToReadyMs',p.parent.spanMs);put('RelayLaunchToWorkerReadyMs',one(p.host,'host-ready').spanMs);
 put('RelayReadySendCallbackMs',one(p.host,'host-ready-callback').spanMs);put('RelayPlanningSendCallbackMs',one(p.host,'host-planning-callback').spanMs);
 put('SchedulerQueueMs',d.queueMs);put('SchedulerPostReturnMs',one(main,'dispatch-post').spanMs);
 for(const key of ['generation','queueDepth','warmDepth','cacheEntries','resident','retiring','foregroundReady','foregroundResident','foregroundRetiring','predictionReady','predictionResident','predictionRetiring'])put('Dispatch'+key[0].toUpperCase()+key.slice(1),d[key]);
 for(const key of ['fresh','serialized','sharedBody','stateObject','referenceOnly'])put('Transport'+key[0].toUpperCase()+key.slice(1),transport[key]);
 for(const [event,key]of [['server-list','ServerListGateMs'],['server-evaluate','ServerEvaluationAwaitMs'],['server-send','ServerJsonSendMs']])put(key,one(main,event).spanMs);
 put('ServerRouteEnclosingMs',one(main,'server-send').routeMs);
 for(const [event,key]of [['worker-definitions','WorkerDefinitionsMs'],['worker-catalogues','WorkerEngineAndCataloguesMs'],['worker-input','WorkerInputMaterializationMs'],['worker-index','WorkerIndexLookupOrBuildMs'],['worker-projection','WorkerRowProjectionMs'],['worker-post','WorkerPostReturnMs']])put(key,one(p.worker,event).spanMs);
 put('WorkerRequestEnclosingMs',one(p.worker,'worker-post').totalMs);put('WorkerReadyBuildMs',p.emitted.buildMs);
 if(p.emitted.serializationObserved)put('WorkerReadySerializationMs',p.emitted.serializationMs);
 const baseline=one(p.worker,'worker-baseline'),index=one(p.worker,'worker-index'),projection=one(p.worker,'worker-projection');
 assert.equal(index.hit,baseline.indexPresent);assert.ok(!index.hit||baseline.hit);assert.ok(!baseline.hit||baseline.snapshotCount>0);
 assert.equal(projection.rows,772);put('WorkerBaselineHit',baseline.hit);put('WorkerIndexPresentAtBaselineLookup',baseline.indexPresent);put('WorkerBaselineSnapshotCount',baseline.snapshotCount);put('WorkerIndexHit',index.hit);put('WorkerProjectedRows',projection.rows);
 const evaluations=p.worker.filter(x=>x.event==='worker-evaluate');assert.equal(evaluations.length,baseline.hit?0:1);if(evaluations.length)put('WorkerEvaluateFullMs',evaluations[0].spanMs);
 for(const key of ['engineRows','equipmentRows','collectionRows','houseRows','generatedRows'])put('WorkerLocal'+key[0].toUpperCase()+key.slice(1),p.catalogues[key]);
 for(const key of ['engineRows','equipmentRows','collectionRows','houseRows','generatedRows'])assert.equal(p.catalogues[key],laneRecords.foreground.catalogues[key],'same local catalogue source');
 const last=Object.values(byClock).map(x=>x.at(-1));put('ObserverWriterCompletedPrefixMs',last.reduce((sum,x)=>sum+x.priorObserverMs,0));
 put('ObserverModuleProofMs',all.filter(x=>['self-proof','module-proof'].includes(x.event)).reduce((sum,x)=>sum+x.proofMs,0));
 put('ObserverExplicitSpanClockReads',last.reduce((sum,x)=>sum+x.spanClockReads,0));put('ObserverWriterClockReads',3*all.length);put('ObserverRecords',all.length);
 const fields={transport:one(p.worker,'worker-input').transport,baselineState:baseline.hit?'hit':'miss',indexState:index.hit?'hit':'miss',readyOmissionObserved:p.emitted.omitFlag,
   observedModuleProofSha256:sha(JSON.stringify(proofRecords.sort((a,b)=>(a.clock+a.module).localeCompare(b.clock+b.module,'en')))),traceSha256:sha(JSON.stringify(Object.entries(byClock).sort(([a],[b])=>a.localeCompare(b,'en'))))};
 return {fields,metrics};
}
