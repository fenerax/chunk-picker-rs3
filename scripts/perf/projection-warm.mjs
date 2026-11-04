// Fixed-size warm-path experiment. Fresh process calculators per adjacent pair;
// all preparation and measured requests run serially. Only numeric/hash output.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { calculatorInput, sha, sharedJSON } from './calculator-input.mjs';
import { pairedComparison } from './final-projection-ab.mjs';
import { canonical } from '../../tools/calc-check/compare.mjs';
export const warmPlan = Object.freeze({ preview: 48, mixed: 48, member1: 48, shared: 48 });
export function plannedPairs(previous, margin) {
  const [low,high] = previous.pairedBootstrap95;
  return Math.max(40, Math.ceil(previous.reference.n * (((high-low)/2)/margin)**2 / 16)*16);
}
export function rss(pid) {
  const status=readFileSync('/proc/'+pid+'/status','utf8');
  return Object.fromEntries(['VmRSS','VmHWM'].map(k=>[k,Number(new RegExp('^'+k+':\\s+(\\d+)','m').exec(status)?.[1])*1024]));
}
const zip=promisify(gzip);
registerHooks({load(url,context,next){
  if(['/app/server.mjs','/app/storage/store.mjs','/app/picker-context.mjs'].some(p=>url.endsWith(p)))throw Error('ForbiddenImport');
  return next(url,context);
}});
export async function calculator(input,mode,population,{diagnostic=false}={}) {
  const {ProcessWorker}=await import('../../app/tasks/process-worker.mjs');
  const previous=process.env.RS3_FINAL_PROJECTION;process.env.RS3_FINAL_PROJECTION=String(mode);
  let worker;
  try {worker=new ProcessWorker({...input.workerData,omitReadyCatalogue:population==='preview'},
    {probeImport:diagnostic?new URL('./projection-gc-probe.mjs',import.meta.url).href:population==='preview'?new URL('./preview-probe.mjs',import.meta.url).href:undefined});}
  finally {if(previous===undefined)delete process.env.RS3_FINAL_PROJECTION;else process.env.RS3_FINAL_PROJECTION=previous;}
  let failure;worker.on('error',error=>{failure=error;});
  try {await new Promise((resolve,reject)=>{worker.once('message',m=>m.type==='ready'?resolve():reject(Error('ReadyError')));worker.once('error',reject);});}
  catch(error){await worker.terminate();throw error;}
  let sequence=0,sent=false;
  const state=input.state,inputKey=input.hashes.state,snapshotKey=JSON.stringify([state.revision,inputKey]);
  const stateJSON=sharedJSON(state);
  const evaluate=member=>({type:'evaluate',memberId:state.members[member].id,resultTransport:'json-shared-v1',resultView:'play-v1',duoProjection:true});
  const pool=member=>({type:'roll-pool',memberId:state.members[member].id});
  let prediction, sequenceStart;
  const preparation = [];
  const request=message=>new Promise((resolve,reject)=>{
    if(failure){reject(Error('WorkerError'));return;}
    const id=++sequence;
    const transfer=sent?{}:message.type==='evaluate'?{stateTransport:'json-shared-v1',stateJSON,stateJSONBytes:stateJSON.byteLength,stateRevision:state.revision,stateMemberIds:state.members.map(m=>m.id)}:{state};
    const start=performance.now(),timer=setTimeout(()=>{clean();reject(Error('TimeoutError'));},120000);
    function clean(){clearTimeout(timer);worker.off('message',receive);worker.off('error',fail);worker.off('exit',fail);}
    function fail(){clean();reject(Error('WorkerError'));}
    function receive(reply){
      if(reply.id!==id||['progress','prediction-prepared'].includes(reply.type))return;
      const wallMs=performance.now()-start;clean();
      if(reply.error){reject(Error('RequestError'));return;}
      sent=true;resolve({reply,measurement:{id,wallMs,timingMs:reply.timingMs}});
    }
    worker.on('message',receive);worker.once('error',fail);worker.once('exit',fail);
    worker.postMessage({id,input:inputKey,snapshotKey,reportProgress:true,...transfer,...message});
  });
  const encode=async reply=>{const bytes=Buffer.from(reply.duoJSON??reply.playJSON);const sync=gzipSync(bytes,{level:1});const asyncBytes=await zip(bytes,{level:1});if(!sync.equals(asyncBytes))throw Error('EncodingDifference');};
  const prepare=async()=>{
    if(population==='member1')return;
    if(population==='preview'){
      const p=await request(pool(0)),chunkId=p.reply.result.pool.eligible[0]?.id;if(!chunkId)throw Error('CandidateError');
      prediction={type:'predict',memberId:state.members[0].id,chunkId,predictionProgress:true,previewProgress:true};
      sequenceStart=performance.now();
      const cold=await request(prediction); preparation.push(cold.measurement); return;
    }
    if(population==='shared'){
      sequenceStart=performance.now();
      const cold=await request(evaluate(0)); preparation.push(cold.measurement); return;
    }
    for(let member=0;member<2;member++){
      const cold=await request(evaluate(member));await request(evaluate(member));await encode(cold.reply);
    }
    let chosen;
    for(let member=0;member<2;member++){
      const p=await request(pool(member));await request(pool(member));if(member===0)chosen=p.reply.result.pool.eligible[0]?.id;
    }
    if(!chosen)throw Error('CandidateError');
    prediction={type:'predict',memberId:state.members[0].id,chunkId:chosen,predictionProgress:true};
    await request(prediction);
  };
  return {worker,prepare,preparation,target:async()=>{
    const response=await request(['shared','member1'].includes(population)?evaluate(1):prediction);
    if(sequenceStart!==undefined) response.measurement.sequenceWallMs=performance.now()-sequenceStart;
    return response;
  }};
}
export function replyHash(reply){
  const decode=value=>{
    if(value instanceof SharedArrayBuffer||value instanceof ArrayBuffer||Buffer.isBuffer(value))return JSON.parse(Buffer.from(value));
    if(Array.isArray(value))return value.map(decode);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
    return value;
  };
  const fields=['result','resultJSON','playJSON','duoJSON','duoSidebarJSON','unlockReuse','partnerUnlockReuse'];
  return sha(JSON.stringify(canonical(Object.fromEntries(fields.filter(k=>reply[k]!==undefined).map(k=>[k,decode(reply[k])])))));
}
async function main(){
  const {values:args}=parseArgs({options:{'data-dir':{type:'string'},out:{type:'string'},smoke:{type:'boolean'},diagnostic:{type:'boolean'},populations:{type:'string'},evidence:{type:'string'}}});
  if(!args.out?.startsWith('/tmp/')||!args['data-dir']?.startsWith('/tmp/'))throw Error('OptionsError');
  const input=await calculatorInput(args['data-dir']);
  await mkdir(args.out,{recursive:true});
  const sourceHashes={};for(const name of ['engine','obligation-cache','worker','process-worker'])sourceHashes[name]=sha(await readFile(new URL('../../app/tasks/'+name+'.mjs',import.meta.url)));
  const selected=args.diagnostic?{mixed:10,preview:10}:args.smoke?{mixed:1,preview:1,member1:1,shared:1}:warmPlan;
  const populations=args.populations?Object.fromEntries(args.populations.split(',').map(p=>{if(!Object.hasOwn(selected,p))throw Error('PopulationError');return[p,selected[p]];})):selected;
  if(args.evidence && !args.evidence.endsWith('/docs/perf/incremental-engine-phase4-2026-11.json'))throw Error('EvidenceLocationError');
  const file=args.out+'/measurements.json';let report;
  try{report=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const signature={node:process.version,sourceHashes,inputs:input.hashes,plan:populations,diagnostic:!!args.diagnostic,toolHash:sha(await readFile(fileURLToPath(import.meta.url))),probeHash:sha(await readFile(new URL(args.diagnostic?'./projection-gc-probe.mjs':'./preview-probe.mjs',import.meta.url))),inputReaderHash:sha(await readFile(new URL('./calculator-input.mjs',import.meta.url)))};
  if(report&&JSON.stringify(report.signature)!==JSON.stringify(signature))throw Error('ResumeSignatureError');
  report??={format:'projection-warm-v1',signature,complete:false,differences:0,trials:[],memoryAdmission:[]};
  const save=async()=>{
    const text=JSON.stringify(report,null,2)+'\n';
    await writeFile(file+'.tmp',text);await rename(file+'.tmp',file);
    if(args.evidence){await writeFile(args.evidence+'.tmp',text);await rename(args.evidence+'.tmp',args.evidence);}
  };
  await save();
  for(const [population,n]of Object.entries(populations))for(let block=0;block<n;block++){
    if(block>=n)continue;
    const order=block%2?[1,0]:[0,1];
    if(order.every(mode=>report.trials.some(t=>t.population===population&&t.block===block&&t.mode===mode)))continue;
    const limit=Number((await readFile('/sys/fs/cgroup/memory.max','utf8')).trim()),used=Number(await readFile('/sys/fs/cgroup/memory.current','utf8'));
    if(!(limit-used>=5*1024**3))throw Error('MemoryAdmissionError');
    report.memoryAdmission.push({population,block,spareBytes:limit-used});
    for(const mode of order){
      if(report.trials.some(t=>t.population===population&&t.block===block&&t.mode===mode))continue;
      const calc=await calculator(input,mode,population,{diagnostic:!!args.diagnostic});
      try{
        await calc.prepare();
        const before=args.diagnostic?await calc.worker.getMemoryUsage():undefined;
        const response=await calc.target();
        const after=args.diagnostic?await calc.worker.getMemoryUsage():undefined;
        report.trials.push({population,block,mode,preparation:calc.preparation,measurement:response.measurement,resultHash:replyHash(response.reply),workerMemory:rss(calc.worker.pid),...(args.diagnostic?{before,after}:{})});
        const pair=report.trials.filter(t=>t.population===population&&t.block===block);
        if(pair.length===2&&pair[0].resultHash!==pair[1].resultHash){report.differences++;await save();throw Error('ResultDifference');}
        await save();
      }finally{await calc.worker.terminate();}
    }
    if(block===n-1){
      const pairs=key=>Array.from({length:n},(_,b)=>[0,1].map(mode=>report.trials.find(t=>t.population===population&&t.block===b&&t.mode===mode).measurement[key]));
      (report.metrics??={})[population]=pairedComparison(pairs('wallMs'));
      if(['preview','shared'].includes(population))(report.sequences??={})[population]=pairedComparison(pairs('sequenceWallMs'));
      await save();
    }
    console.error(JSON.stringify({population,block,completed:report.trials.length}));
  }
  report.metrics={};
  for(const population of Object.keys(populations)){
    const pairs=[];for(let block=0;block<populations[population];block++)pairs.push([0,1].map(mode=>report.trials.find(t=>t.population===population&&t.block===block&&t.mode===mode).measurement.wallMs));
    report.metrics[population]=pairedComparison(pairs);
  }
  report.complete=true;await save();console.log(JSON.stringify({complete:true,trials:report.trials.length,differences:report.differences}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error.name,site:[...(error.stack??'').matchAll(/projection-warm.mjs:(\d+):(\d+)/g)].slice(0,2).map(m=>m.slice(1))}));process.exitCode=1;});
