// Explicit calculator preload only. No production module imports this file.
import { registerHooks } from 'node:module';
import { isMainThread,parentPort,workerData } from 'node:worker_threads';
import { createSourceAccessShadow,instrumentShadow } from './source-access-shadow.mjs';
if(!isMainThread&&parentPort){
  const trace=createSourceAccessShadow({datasetDigest:workerData?.datasetDigest});
  globalThis[Symbol.for('rs3.source.shadow')]=trace;
  registerHooks({load(url,context,next){const result=next(url,context);
    const kind=url.endsWith('/app/tasks/engine.mjs')?'engine':url.endsWith('/app/tasks/access.mjs')?'access':null;
    return kind?{...result,source:instrumentShadow(String(result.source),kind)}:result;}});
  const on=parentPort.on.bind(parentPort),send=parentPort.postMessage.bind(parentPort);
  parentPort.on=(event,listener)=>on(event,event==='message'?message=>{if(Number.isSafeInteger(message.id))trace.job(message.id);return listener(message);}:listener);
  parentPort.postMessage=(message,...rest)=>send(['progress','prediction-prepared'].includes(message.type)?message:{...message,__sourceGraph:trace.report()},...rest);
}
