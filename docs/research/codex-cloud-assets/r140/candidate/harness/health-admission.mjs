import {createHash} from 'node:crypto';

const internals=new WeakMap();
const keys=['schema','initialCount','initialValid','finalCount','finalValid','failure','failureStatus','versionSha256'];
const failures=['none','http-status','schema-invalid','not-ready','version-change','invalid-observation'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const error=()=>Error('r140-health-admission');
const require=value=>{if(!value)throw error();};
const http=value=>Number.isSafeInteger(value)&&value>=100&&value<=599;
const sha=value=>createHash('sha256').update(value).digest('hex');

export function createHealthTracker(){
 const tracker={schema:1,initialCount:0,initialValid:0,finalCount:0,finalValid:0,failure:'none',failureStatus:null,versionSha256:null};
 internals.set(tracker,{version:null});return tracker;
}

export function observeHealth(tracker,status,text,phase){
 const state=internals.get(tracker);require(state);
 const fail=reason=>{if(tracker.failure==='none'){tracker.failure=reason;tracker.failureStatus=http(status)?status:null;}throw error();};
 if(phase!=='initial'&&phase!=='final')return fail('invalid-observation');
 const count=phase+'Count',valid=phase+'Valid',limit=phase==='initial'?40:10;
 if(tracker[count]>=limit)return fail('invalid-observation');
 tracker[count]++;
 if(tracker.failure!=='none')throw error();
 if(!http(status)||typeof text!=='string')return fail('invalid-observation');
 if(status!==200)return fail('http-status');
 let body;try{body=JSON.parse(text);}catch{return fail('schema-invalid');}
 if(!plain(body)||body.schemaVersion!==1||body.local!==true||typeof body.ready!=='boolean'||typeof body.savesReady!=='boolean'||typeof body.standby!=='boolean'||typeof body.status!=='string'||typeof body.version!=='string'||! /^[a-f0-9]{12}$/.test(body.version))return fail('schema-invalid');
 if(body.ready!==true||body.savesReady!==true||body.standby!==false||!['ready','warming'].includes(body.status))return fail('not-ready');
 if(state.version!==null&&state.version!==body.version)return fail('version-change');
 if(state.version===null){state.version=body.version;tracker.versionSha256=sha(body.version);}
 tracker[valid]++;return projectHealthSummary(tracker);
}

export function projectHealthSummary(value){
 require(plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&value.schema===1);
 for(const [count,valid,max]of [['initialCount','initialValid',40],['finalCount','finalValid',10]])require(Number.isSafeInteger(value[count])&&value[count]>=0&&value[count]<=max&&Number.isSafeInteger(value[valid])&&value[valid]>=0&&value[valid]<=value[count]);
 require(failures.includes(value.failure));
 require(value.failureStatus===null||http(value.failureStatus));
 require(value.versionSha256===null||(typeof value.versionSha256==='string'&&/^[a-f0-9]{64}$/.test(value.versionSha256)));
 const valid=value.initialValid+value.finalValid;
 require(valid===0?value.versionSha256===null:value.versionSha256!==null);
 if(value.failure==='none')require(value.failureStatus===null&&value.initialCount===value.initialValid&&value.finalCount===value.finalValid);
 if(value.failure==='http-status')require(http(value.failureStatus)&&value.failureStatus!==200);
 if(['schema-invalid','not-ready','version-change'].includes(value.failure))require(value.failureStatus===200);
 if(value.failure==='version-change')require(valid>0);
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}

export function completeInitialHealth(value){const safe=projectHealthSummary(value);return safe.failure==='none'&&safe.initialCount===40&&safe.initialValid===40;}
export function completeHealth(value){const safe=projectHealthSummary(value);return completeInitialHealth(safe)&&safe.finalCount===10&&safe.finalValid===10;}
