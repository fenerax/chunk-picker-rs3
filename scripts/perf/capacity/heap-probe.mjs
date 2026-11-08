// Measurement-only worker preload. No GC, snapshots, deadlines or app mutations.
import { isMainThread, parentPort, threadId } from 'node:worker_threads';
if(!isMainThread && parentPort) parentPort.on('message',message=>{
  if(message?.type==='cancel' && message.id===-1 && message.memoryPort)
    message.memoryPort.postMessage({threadId,memoryUsage:process.memoryUsage()});
});
