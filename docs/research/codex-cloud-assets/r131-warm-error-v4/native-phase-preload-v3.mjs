// Read-only observer. No delay, cache reset, synthetic phase or injected yield.
import {parentPort,workerData} from 'node:worker_threads';
import {qualifies} from './protocol.mjs';
const sourceURL=new URL('./chunk-planning-index.mjs',workerData.r131WorkerURL).href;
let request,phase,seen=new Set();
const emit=(type,caller)=>parentPort.postMessage({type,id:request?.id,phase,sourceURL,caller,armed:Boolean(request)});
parentPort.on('message',m=>{if(m.type==='idle-planning'){request=m;phase=undefined;seen=new Set();}if(m.type==='cancel'&&m.id===request?.id)request=undefined;});
const chunks=workerData.world?.chunks;
if(chunks){const keys=chunks.keys;chunks.keys=function(){const caller=new Error().stack;if(qualifies(caller,sourceURL,'declaration')){phase='declaration';if(!seen.has(phase)){seen.add(phase);emit('r131-phase',caller);}}return keys.call(this);};}
const iterator=Array.prototype[Symbol.iterator];
Array.prototype[Symbol.iterator]=function(){if(this[0]?.record&&typeof this[0]?.id==='string'){const caller=new Error().stack;if(qualifies(caller,sourceURL,'task')){phase='task';if(!seen.has(phase)){seen.add(phase);emit('r131-phase',caller);}}}return iterator.call(this);};
const immediate=globalThis.setImmediate;
globalThis.setImmediate=function(callback,...args){const caller=new Error().stack;if(request&&phase&&caller.split('\n').some(l=>l.includes(sourceURL+':')&&l.includes('buildChunkPlanningIndexIncremental')))emit('r131-yield',caller);return immediate(callback,...args);};
