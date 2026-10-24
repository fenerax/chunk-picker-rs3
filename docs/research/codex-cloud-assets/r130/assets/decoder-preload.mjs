// Conformance observation only; preserves every actual decode and startup step.
import {parentPort,workerData} from 'node:worker_threads';
import v8 from 'node:v8';
import {syncBuiltinESMExports} from 'node:module';
const describe=v=>v===null||typeof v!=='object'?{type:typeof v,value:v}:{tag:Object.prototype.toString.call(v),descriptors:Reflect.ownKeys(v).map(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return [String(k),{enumerable:d.enumerable,writable:d.writable,configurable:d.configurable,value:describe(d.value)}];})};
let observed=false;
function note(value,codec){if(observed||!value?.codecProbe)return;observed=true;const probe=describe(value.codecProbe);setImmediate(()=>parentPort.postMessage({type:'r92-decoder',codec,probe,datasetDigest:workerData.datasetDigest,remaining:['definitions','definitionBytes','definitionV8Bytes'].filter(k=>Object.hasOwn(workerData,k))}));}
const parse=JSON.parse;JSON.parse=function(...args){const value=Reflect.apply(parse,JSON,args);note(value,'JSON');return value;};
const deserialize=v8.deserialize;v8.deserialize=function(...args){const value=Reflect.apply(deserialize,v8,args);note(value,'V8');return value;};syncBuiltinESMExports();
// Object custom-factory contracts have no codec call. Observe their cloned
// input separately without claiming that this is a decoder observation.
if(workerData.definitions?.codecProbe)note(workerData.definitions,'object-input');
