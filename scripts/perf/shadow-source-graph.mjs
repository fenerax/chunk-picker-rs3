// Unwired measurement: every candidate is still evaluated in full.
import { readFileSync } from 'node:fs';
import { realpath,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { calculatorInput,sha } from './calculator-input.mjs';
import { canonical } from '../../tools/calc-check/compare.mjs';
registerHooks({load(url,context,next){if(['/app/server.mjs','/app/storage/store.mjs','/app/picker-context.mjs'].some(p=>url.endsWith(p)))throw Error('ForbiddenImport');return next(url,context);}});
const {values:args}=parseArgs({options:{'data-dir':{type:'string'},out:{type:'string'}}});
const report={format:'source-access-shadow-v1',complete:false};let output,worker;
const saveReport=async()=>{const temp=output+'.tmp';await writeFile(temp,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await rename(temp,output);};
const memory=pid=>{const status=readFileSync(`/proc/${pid}/status`,'utf8');return Object.fromEntries(['VmRSS','VmHWM'].map(key=>[key,Number(new RegExp(`^${key}:\\s+(\\d+)`,'m').exec(status)?.[1]??0)*1024]));};
try{
  const target=path.resolve(args.out),parent=await realpath(path.dirname(target));
  if(parent!=='/tmp'&&!parent.startsWith('/tmp/'))throw Error('OutputLocationError');
  await writeFile(target,JSON.stringify(report),{flag:'wx'});output=target;
  const started=performance.now(),input=await calculatorInput(args['data-dir']);
  const [{ProcessWorker},{prepareChunkPrediction}]=await Promise.all([import('../../app/tasks/process-worker.mjs'),import('../../app/core/planning.mjs')]);
  worker=new ProcessWorker(input.workerData,{probeImport:new URL('./source-access-shadow-probe.mjs',import.meta.url).href});
  let sequence=0,lastGraph;const digest=createHash('sha256'),keys=new WeakMap();
  const request=(state,memberId,type)=>new Promise((resolve,reject)=>{
    const id=++sequence;let key=keys.get(state);if(!key){key=sha(JSON.stringify(state));keys.set(state,key);}
    const timer=setTimeout(()=>{clean();reject(Error('TimeoutError'));},120000);
    const fail=()=>{clean();reject(Error('WorkerError'));};
    function clean(){clearTimeout(timer);worker.off('message',receive);worker.off('error',fail);worker.off('exit',fail);}
    function receive(message){if(message.id!==id||message.type==='progress')return;clean();if(message.error){reject(Error('RequestError'));return;}
      lastGraph=message.__sourceGraph;
      const value=message.result??(message.playJSON?JSON.parse(Buffer.from(message.playJSON)):undefined);
      digest.update(sha(JSON.stringify(canonical(value))));resolve(value);
    }
    worker.on('message',receive);worker.once('error',fail);worker.once('exit',fail);
    worker.postMessage({id,type,state,memberId,input:key,snapshotKey:JSON.stringify([state.revision,key]),resultTransport:'json-shared-v1',resultView:'play-v1'});
  });
  await new Promise((resolve,reject)=>{worker.once('message',m=>m.type==='ready'?resolve():reject(Error('ReadyError')));worker.once('error',reject);worker.once('exit',()=>reject(Error('ReadyExit')));});
  const pools=[];
  for(const member of input.state.members)pools.push((await request(input.state,member.id,'roll-pool')).pool.eligible.map(row=>row.id));
  for(const member of input.state.members)await request(input.state,member.id,'evaluate');
  report.initialGraph=lastGraph;report.initialMemory={worker:memory(worker.pid),parent:memory(process.pid)};
  const predict=prepareChunkPrediction(input.state,input.registry),dummy={evaluate:()=>({tasks:[],items:[],access:{}})};
  let candidates=0;
  for(const [index,member] of input.state.members.entries())for(const chunkId of pools[index]){
    const state=predict(member.id,chunkId,{world:input.world,engine:dummy}).state;
    for(const owner of state.members)await request(state,owner.id,'evaluate');
    candidates++;Object.assign(report,{candidates,graph:lastGraph,poolCandidates:pools.map(rows=>rows.length),inputs:input.hashes,node:process.version,progressResultHash:digest.copy().digest('hex')});await saveReport();console.error(JSON.stringify({candidates}));
  }
  await new Promise(resolve=>setTimeout(resolve,2000));
  Object.assign(report,{complete:true,node:process.version,inputs:input.hashes,poolCandidates:pools.map(rows=>rows.length),candidates,
    evaluations:input.state.members.length*(candidates+1),requests:sequence,graph:lastGraph,resultHash:digest.digest('hex'),
    memory:{worker:memory(worker.pid),parent:memory(process.pid)},durationMs:performance.now()-started});
  report.validated=lastGraph?.faults===0&&lastGraph?.ambiguous===0&&Object.values(lastGraph.counters).every(c=>c.differences===0);
  if(!report.validated)process.exitCode=1;
}catch(error){report.error=error.name;process.exitCode=1;}
finally{if(worker)await worker.terminate();if(output)await saveReport();console.log(JSON.stringify(report));}
