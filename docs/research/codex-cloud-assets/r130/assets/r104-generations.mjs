import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const codecKeys=['definitions','definitionBytes','definitionV8Bytes'];
export const retainedHash=data=>{
 const bytes=data.definitionV8Bytes??data.definitionBytes;
 return bytes===undefined?null:createHash('sha256').update(Buffer.from(bytes)).digest('hex');
};
export function constructorRecord(generation,data){
 assert.ok(Number.isSafeInteger(generation)&&generation>0);assert.ok(data&&typeof data==='object');
 return Object.freeze({generation,data,inputKeys:Object.freeze(codecKeys.filter(k=>Object.hasOwn(data,k))),retainedHash:retainedHash(data),datasetDigest:data.datasetDigest});
}
export function assertGenerationWindow(records,decoders,ready,digest,label='generation window'){
 assert.ok(records.length>0,label+': fresh constructor required');assert.ok(decoders.length>0,label+': fresh decoder required');assert.ok(ready.length>0,label+': fresh READY required');
 const byGeneration=new Map();
 for(const record of records){assert.ok(Number.isSafeInteger(record.generation)&&record.generation>0);assert.equal(byGeneration.has(record.generation),false,label+': duplicate constructor generation');byGeneration.set(record.generation,record);assert.equal(record.datasetDigest,digest);}
 for(const [kind,rows] of [['decoder',decoders],['READY',ready]]){
  for(const row of rows){assert.ok(byGeneration.has(row.generation),label+': stale/unknown '+kind+' generation');assert.equal(row.datasetDigest,digest);}
  for(const record of records)assert.ok(rows.some(row=>row.generation===record.generation),label+': missing matching-generation '+kind);
 }
 return records.map(record=>record.generation);
}
