import { cpus } from 'node:os';
import { processTree, diskBytes } from './telemetry.mjs';
import { stageWindow } from './scheduler.mjs';
import { sustainedPhase } from './sustained.mjs';

export function observation(profile,start,receivedAt,from=receivedAt) {
  const elapsedMs=start===undefined?null:receivedAt-start;
  return {receivedAt,elapsedMs,windowStartElapsedMs:start===undefined?null:from-start,
    ...(start===undefined?{stage:null,classification:null,measured:false}:stageWindow(profile.stages,start,from,receivedAt)),
    phase:elapsedMs===null?null:sustainedPhase(profile,elapsedMs)};
}

// Stamp IPC parts in the message handler, before resuming any collector await.
export function createSampleInbox({now=()=>performance.now(),timer=setTimeout,cancelTimer=clearTimeout}={}) {
  const pending=new Map();
  return {
    expect(id,generation) {
      return new Promise(resolve=>{
        const entry={generation,resolve};pending.set(id,entry);
        entry.timer=timer(()=>{pending.delete(id);resolve({...entry,snapshot:{data:null,generation,receivedAt:now()}});},5000);
      });
    },
    receive(message,generation,receivedAt=now()) {
      const part={'sample-health':'health','sample-diagnostics':'diagnostics',sample:'snapshot','sample-error':'snapshot'}[message.type];
      const entry=pending.get(message.id);if(!part||!entry||entry.generation!==generation)return;
      entry[part]??={data:message,generation,receivedAt};
      if(part==='snapshot'){pending.delete(message.id);cancelTimer(entry.timer);entry.resolve(entry);}
    },
  };
}

// Each source has a receipt and window of its own. Slow tree/disk collection
// may delay persistence, but cannot move health, memory or SSE observations.
export function createSampleCollector({profile,directory,requestSnapshot,now=()=>performance.now(),
  readTree=processTree,readDisk=diskBytes,logicalCpus=cpus().length}) {
  let lastServerAt,lastTreeAt,lastTreeCpu,disk;
  return {
    reset(){lastServerAt=undefined;lastTreeAt=undefined;lastTreeCpu=undefined;},
    async collect({start,generation,pid,client}) {
      const requestedAt=now(),clientObservation=observation(profile,start,client.receivedAt??requestedAt);
      const packet=await requestSnapshot(generation),snapshot=packet.snapshot,data=snapshot.data;
      const serverWindow=observation(profile,start,snapshot.receivedAt,lastServerAt??requestedAt);
      const part=name=>packet[name]?.generation===generation&&packet[name].data.serverId===data?.serverId&&
        packet[name].receivedAt<=snapshot.receivedAt?packet[name]:null;
      const health=part('health'),diagnostics=part('diagnostics');
      const metadata=receipt=>receipt?{...observation(profile,start,receipt.receivedAt),generation,serverId:receipt.data.serverId}:null;
      const server=data?.type==='sample'?{...data,...observation(profile,start,snapshot.receivedAt),window:serverWindow,
        health:health?.data.health??null,healthObservation:metadata(health),
        diagnostics:diagnostics?.data.diagnostics??null,diagnosticsObservation:metadata(diagnostics)}:null;
      if(server)lastServerAt=snapshot.receivedAt;
      const treeStart=now(),treeData=await readTree(pid),treeAt=now();
      const tree={...treeData,...observation(profile,start,treeAt),window:observation(profile,start,treeAt,lastTreeAt??treeStart),
        cpuPercent:lastTreeCpu!==undefined&&treeData.cpuSeconds!==null?
          Math.max(0,(treeData.cpuSeconds-lastTreeCpu)/((treeAt-lastTreeAt)/1000)/logicalCpus*100):null};
      lastTreeCpu=treeData.cpuSeconds??undefined;lastTreeAt=treeAt;
      if(!disk||treeAt-disk.receivedAt>=profile.diskSampleSeconds*1000) {
        const value=await readDisk(directory);disk={...value,...observation(profile,start,now())};
      }
      return {errors:Number(!server||!health||!diagnostics)+Number(tree.supported&&!tree.processes),
        row:{...serverWindow,generation,collectionPhase:client.phase??null,measured:client.phase?false:serverWindow.measured,
          tree,disk,client:{...client,observation:clientObservation},server,treeCpuPercent:tree.cpuPercent,collectedAt:now()}};
    },
  };
}
