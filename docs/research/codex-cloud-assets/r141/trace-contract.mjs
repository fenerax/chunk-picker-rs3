import assert from 'node:assert/strict';
const n='number',b='boolean';
export const PAYLOAD={cataloguePresent:b,catalogueRows:n,dynamicPresent:b,dynamicBytes:n};
export const EVENT_FIELDS=Object.freeze({
 'self-proof':{observerSha:'hash',contractSha:'hash',proofMs:n},
 'module-proof':{moduleCode:'module',sha:'hash',proofMs:n},
 'parent-spawn':{endpoint:n,spanMs:n},'parent-first-native':{endpoint:n,spanMs:n},
 'parent-ready':{endpoint:n,spanMs:n,...PAYLOAD,compileMs:n},
 'scheduler-ready':{endpoint:n,lane:'lane',generation:n,...PAYLOAD},
 'scheduler-dispatch':{endpoint:n,lane:'lane',queueMs:n,generation:n,queueDepth:n,warmDepth:n,cacheEntries:n,resident:b,retiring:n,
   foregroundReady:b,foregroundResident:b,foregroundRetiring:n,predictionReady:b,predictionResident:b,predictionRetiring:n},
 'dispatch-transport':{endpoint:n,fresh:b,serialized:b,sharedBody:b,stateObject:b,referenceOnly:b},
 'dispatch-post':{endpoint:n,spanMs:n},
 'host-ready':{spanMs:n,...PAYLOAD},'host-ready-callback':{spanMs:n},'host-planning-callback':{spanMs:n},
 'worker-definitions':{spanMs:n},
 'worker-catalogues':{spanMs:n,engineRows:n,equipmentRows:n,collectionRows:n,houseRows:n,generatedRows:n},
 'worker-ready':{...PAYLOAD,omitFlag:b,serializationObserved:b,serializationMs:n,buildMs:n},
 'worker-input':{spanMs:n,transport:'transport'},
 'worker-baseline':{hit:b,indexPresent:b,snapshotCount:n},'worker-evaluate':{spanMs:n},
 'worker-index':{hit:b,spanMs:n},'worker-projection':{spanMs:n,rows:n,clueLocations:n},
 'worker-post':{spanMs:n,totalMs:n},
 'server-list':{spanMs:n},'server-evaluate':{spanMs:n},'server-send':{spanMs:n,routeMs:n},
});
export const CLOCKS=Object.freeze(['root-main',...Array.from({length:4},(_,i)=>['endpoint-'+i+'-host','endpoint-'+i+'-worker']).flat()]);
const fixed={module:['server','scheduler','worker','process-worker','process-worker-host'],lane:['foreground','prediction'],transport:['json-full','json-reference','object','snapshot-reference']};
export function validateRecord(r){
 assert.ok(r&&typeof r==='object'&&!Array.isArray(r));assert.ok(Object.hasOwn(EVENT_FIELDS,r.event));
 const common=['event','clock','seq','atMs','priorObserverMs','priorWrites','spanClockReads'];
 assert.deepEqual(Object.keys(r).sort(),[...common,...Object.keys(EVENT_FIELDS[r.event])].sort());
 assert.ok(CLOCKS.includes(r.clock));for(const key of ['seq','atMs','priorObserverMs','priorWrites','spanClockReads'])assert.ok(typeof r[key]==='number'&&Number.isFinite(r[key])&&r[key]>=0&&r[key]<=1e9,key);
 assert.ok(Number.isInteger(r.seq)&&r.seq>=1&&r.seq<=96);assert.ok(Number.isInteger(r.priorWrites)&&r.priorWrites===r.seq-1);
 for(const [key,type] of Object.entries(EVENT_FIELDS[r.event])){
  const value=r[key];if(type===n)assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9,key);
  else if(type===b)assert.equal(typeof value,'boolean',key);
  else if(type==='hash')assert.match(value,/^[a-f0-9]{64}$/);
  else assert.ok(fixed[type].includes(value),key);
 }
 return r;
}
export function payloadFacts(message){return {cataloguePresent:Array.isArray(message.catalogue),catalogueRows:Array.isArray(message.catalogue)?message.catalogue.length:0,
 dynamicPresent:message.dynamicCatalogueBytes!==undefined,dynamicBytes:message.dynamicCatalogueBytes?.byteLength??0};}
