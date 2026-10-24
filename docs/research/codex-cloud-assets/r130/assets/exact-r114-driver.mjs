import test from 'node:test';
import {admit,inputIntegrity,generationChannel,wireParentData,digest} from './r114-modes.mjs';
import {constructorRecord,assertGenerationWindow} from './r104-generations.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readlink,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import threads from 'node:worker_threads';
import children from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const root=new URL('../',import.meta.url).pathname;
// R114 removes only optional application/test inheritance, retaining proxy,
// CA and mandatory security variables. Launcher clears these before Node starts.
for(const key of Object.keys(process.env))if(key.startsWith('RS3_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'].includes(key)||key.startsWith('NODE_TEST_')||key.startsWith('NODE_CHANNEL_'))delete process.env[key];
const ownStat=await readFile('/proc/self/stat','utf8');
const status=await readFile('/proc/self/status','utf8');
console.log(JSON.stringify({phase:'R114-execution-context',pid:process.pid,procSelfPidMatch:Number(ownStat.split(' ',1)[0])===process.pid,namespace:await readlink('/proc/self/ns/pid'),allowedCPUList:status.split('\n').find(line=>line.startsWith('Cpus_allowed_list:')).split(':')[1].trim(),kernel:(await import('node:os')).release(),caps:await Promise.all(['cpu.max','memory.max','cpuset.cpus.effective'].map(async name=>[name,await readFile('/sys/fs/cgroup/'+name,'utf8').catch(()=> 'missing')])),bootIdSha256:createHash('sha256').update(await readFile('/proc/sys/kernel/random/boot_id')).digest('hex')}));
assert.equal(Number(ownStat.split(' ',1)[0]),process.pid);

if(process.env.R92_NATIVE_GO!=='root-reviewed-functional')throw Error('UNRUN: exact ready command still requires root GO');
const guard=await readFile(root+'sdk/guard-candidate.py');assert.equal(createHash('sha256').update(guard).digest('hex'),'e97cbbe394ef0d50a90b988a0f9f52eccf05651f4f6334188c63c65c020b452e');
const [arm,mode,maskText,flavour='authored']=process.argv.slice(2),mask=Number(maskText);
assert.ok(['B','C'].includes(arm));assert.ok(['thread','process'].includes(mode));assert.ok(Number.isInteger(mask)&&mask>=0&&mask<16);assert.ok(['authored','normal-http'].includes(flavour));
const expected=admit(arm,mode,mask,flavour);
process.env.RS3_DATASET='open-f2p';process.env.RS3_TASK_WORKER_MODE=mode;
const originalWorker=threads.Worker,originalFork=children.fork,preload=root+'prep/decoder-preload.mjs';
const payloads=[],observations=[],readyRecords=[],customRecords=[];let generationSequence=0,transport,activeLifetime=-1;
const observe=(phase,rows)=>value=>{rows.push(value);console.log(JSON.stringify({phase,...value}));};
function recordConstructor(data,details={}){const base=constructorRecord(++generationSequence,data);const record=Object.freeze({...base,lifetime:activeLifetime,inputIntegrity:inputIntegrity(data,expected),...details});payloads.push(record);console.log(JSON.stringify({phase:'R114-constructor',generation:record.generation,lifetime:record.lifetime,inputKeys:record.inputKeys,retainedHash:record.retainedHash,inputIntegrity:record.inputIntegrity,datasetDigest:record.datasetDigest,inputClass:Object.prototype.toString.call(data[expected]),...details}));return record;}
process.env.RS3_WORKER_MEMORY_PROBE_IMPORT=preload;
threads.Worker=class extends originalWorker{constructor(url,options){assert.equal(mode,'thread');const record=recordConstructor(options.workerData,{transport:'native-thread'});super(url,{...options,execArgv:['--import',preload]});const receive=generationChannel(record,observe('R114-decoder',observations),observe('R114-READY',readyRecords));this.on('message',receive);}};
children.fork=function(...args){assert.equal(mode,'process');assert.equal(args[0],root+arm+'/app/tasks/process-worker-host.mjs');assert.equal(args[2].serialization,'advanced');console.log(JSON.stringify({phase:'R114-real-fork',module:args[0],serialization:args[2].serialization,execArgv:args[2].execArgv}));const child=Reflect.apply(originalFork,this,args),send=child.send.bind(child);let record,receive;child.send=function(m,...rest){if(m?.kind==='init'){assert.equal(record,undefined,'one init per fork');const parentData=wireParentData(m.data,transport.decodeProcessMessage);record=recordConstructor(parentData,{transport:'native-process-IPC',childPid:child.pid,parentBytesSource:'IPC Buffer view of actual parent SharedArrayBuffer'});receive=generationChannel(record,observe('R114-decoder',observations),observe('R114-READY',readyRecords));}return send(m,...rest);};child.on('message',m=>{if(m?.kind==='message'){assert.ok(receive,'IPC init before worker message');receive(transport.decodeProcessMessage(m.payload));}});child.once('exit',(code,signal)=>console.log(JSON.stringify({phase:'R114-process-exit',generation:record?.generation,lifetime:record?.lifetime,pid:child.pid,code,signal})));return child;};syncBuiltinESMExports();
const load=f=>import(pathToFileURL(root+arm+'/app/'+f));
const {selectedDataset}=await load('dataset-runtime.mjs');assert.equal(selectedDataset.datasetId,'open-f2p');assert.deepEqual(Object.keys(process.env).filter(k=>k.startsWith('RS3_')).sort(),['RS3_DATASET','RS3_TASK_WORKER_MODE','RS3_WORKER_MEMORY_PROBE_IMPORT']);
transport=await load('tasks/process-worker-transport.mjs');
const {createServer}=await load('server.mjs'),{ProcessWorker}=await load('tasks/process-worker.mjs');
const {specimen}=await import('./extract.mjs'); // only creates public synthetic values; no VM extraction in native driver.
const describe=v=>v===null||typeof v!=='object'?{type:typeof v,value:v}:{tag:Object.prototype.toString.call(v),descriptors:Reflect.ownKeys(v).map(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return [String(k),{enumerable:d.enumerable,writable:d.writable,configurable:d.configurable,value:describe(d.value)}];})};
function logical(v){const copy=structuredClone(v);delete copy.cache;if(copy.metrics)delete copy.metrics.elapsedMs;return copy;}
const factories=['workerFactory','deathWorkerFactory','duoWorkerFactory','predictionWorkerFactory'];
const keys=['definitions','definitionBytes','definitionV8Bytes'];
const definitions=specimen();console.log(JSON.stringify({phase:'R114-fixture',sha256:digest(JSON.stringify(definitions)),chunks:Object.keys(definitions.chunks).length,questTasks:Object.keys(definitions.challenges.Quest).length,datasetId:selectedDataset.datasetId,datasetDigest:selectedDataset.digest}));let prior;
test(`${arm} real SERVER encoder + ${mode} WORKER: mask=${mask}, ${flavour}, readiness/lifecycle`,async()=>{
 for(let restart=0;restart<2;restart++){
  activeLifetime=restart;
  const dataDir=await mkdtemp(root+'unarchived-owned-store-');let app;
  try{
   const options={dataDir,host:'127.0.0.1',port:0};
   if(flavour==='authored'){
    options.definitions=definitions;options.taskMap={};options.predictionPrewarm=false;options.taskWorkerOptions={idleMs:150};
    for(let i=0;i<4;i++)if(mask&(1<<i))options.taskWorkerOptions[factories[i]]=data=>{
      assert.deepEqual(keys.filter(k=>Object.hasOwn(data,k)),['definitions']);customRecords.push({lifetime:restart,data});console.log(JSON.stringify({phase:'R114-custom-factory',lifetime:restart,inputKeys:keys.filter(k=>Object.hasOwn(data,k))}));return mode==='thread'?new threads.Worker(pathToFileURL(root+arm+'/app/tasks/worker.mjs'),{workerData:data}):new ProcessWorker(data);
    };
   }else assert.equal(mask,0,'Normal HTTP uses wholly native production constructors');
   const payloadStart=payloads.length,observeStart=observations.length,readyStart=readyRecords.length;
   app=await createServer(options);await app.listen();
   const u=new URL(app.inviteUrl),memberId=app.store.getCalculationSnapshot().members[0].id;
   const get=async route=>{const response=await fetch(u.origin+route,{headers:{Authorization:'Bearer '+u.pathname.slice('/join/'.length)}});assert.equal(response.status,200);return response.json();};
   const value=await get('/api/tasks?memberId='+encodeURIComponent(memberId)+'&view=play-v1');
   assert.equal(value.memberId,memberId);assert.equal(value.stateRevision,app.store.getInfo().revision);assert.ok(value.tasks.length>0);
   if(prior)assert.deepEqual(logical(value),prior);else prior=logical(value);
   if(flavour==='normal-http')assert.equal(value.tasks.length,772,'Current public normal HTTP row oracle');
   else{
    if(mode==='thread')assert.ok(customRecords.some(row=>row.lifetime===restart),'foreground custom factory invoked');
    function validateGeneration(newPayloads,newObservations,newReady,label){
     const generations=assertGenerationWindow(newPayloads,newObservations,newReady,selectedDataset.digest,label);for(const ready of newReady)assert.equal(ready.lifetime,restart);
     for(const record of newPayloads){const p=record.data;assert.deepEqual(record.inputKeys,[expected]);assert.deepEqual(keys.filter(k=>Object.hasOwn(p,k)),[expected]);assert.equal(p.datasetDigest,selectedDataset.digest);assert.deepEqual(p.datasetSelection,selectedDataset.workerSelection());assert.equal(record.lifetime,restart);assert.equal(inputIntegrity(p,expected),record.inputIntegrity);if(expected==='definitionV8Bytes')assert.equal(digest(Buffer.from(p.definitionV8Bytes)),record.retainedHash);else {assert.ok(customRecords.some(row=>row.lifetime===restart&&row.data===p),'actual custom input identity');assert.deepEqual(describe(p.definitions.codecProbe),describe(JSON.parse(JSON.stringify(definitions)).codecProbe));}}
     for(const o of newObservations){assert.deepEqual(o.remaining,[]);assert.equal(o.datasetDigest,selectedDataset.digest);assert.deepEqual(o.probe,describe(JSON.parse(JSON.stringify(definitions)).codecProbe));assert.equal(o.lifetime,restart);assert.equal(o.codec,mode==='process'?'V8':'object-input');}
     console.log(JSON.stringify({phase:'R114-native-proof',restart,label,generations:[...generations],constructors:newPayloads.length,decoders:newObservations.length,ready:newReady.length,datasetDigest:selectedDataset.digest}));
    }
    validateGeneration(payloads.slice(payloadStart),observations.slice(observeStart),readyRecords.slice(readyStart),'initial');
    const deadline=Date.now()+5000;let d;
    do{d=await get('/api/diagnostics');if(d.worker.status==='sleeping'&&!d.worker.retiring)break;await delay(25);}while(Date.now()<deadline);
    assert.equal(d.worker.status,'sleeping');assert.equal(d.worker.resident,false);assert.equal(d.worker.retiring,0);
    // Full details cannot use a retained compact saved-result shortcut; this
    // request must wake a real calculator with retained definition input.
    const retained=payloads.slice(payloadStart);
    const retainedBefore=retained.map(p=>inputIntegrity(p.data,expected));
    const wakePayloadStart=payloads.length,wakeObserveStart=observations.length,wakeReadyStart=readyRecords.length;
    const full=await get('/api/tasks?memberId='+encodeURIComponent(memberId));assert.equal(full.memberId,memberId);assert.equal(full.stateRevision,value.stateRevision);
    validateGeneration(payloads.slice(wakePayloadStart),observations.slice(wakeObserveStart),readyRecords.slice(wakeReadyStart),'wake');
    const retainedAfter=retained.map(p=>inputIntegrity(p.data,expected));assert.deepEqual(retainedAfter,retainedBefore,'Actual retained parent input unchanged across wake');
    for(const record of payloads.slice(wakePayloadStart))assert.ok(retainedBefore.includes(inputIntegrity(record.data,expected)));
    console.log(JSON.stringify({phase:'R114-retained-input',kind:expected==='definitions'?'canonical parent object JSON hash':'actual parent shared bytes hash',restart,generations:retained.map(p=>p.generation),before:retainedBefore,after:retainedAfter}));
    assert.ok(full.tasks.length>0);assert.equal(definitions.codecProbe.left.nested.number,7);
   }
   console.log(JSON.stringify({arm,mode,mask,flavour,restart,rows:value.tasks.length,cache:value.cache,decoderObservations:observations.length-observeStart}));
  }finally{console.log(JSON.stringify({phase:'R114-cleanup-start',restart,dataDir}));await app?.close();console.log(JSON.stringify({phase:'R114-app-close-awaited',restart}));await rm(dataDir,{recursive:true,force:true});await rm(dataDir+'.dataset.json',{force:true});await assert.rejects(access(dataDir),{code:'ENOENT'});await assert.rejects(access(dataDir+'.dataset.json'),{code:'ENOENT'});console.log(JSON.stringify({phase:'R114-store-removed',restart,dataDir,storeAbsent:true,bindingAbsent:true}));}
 }
});
