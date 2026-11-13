import { cpus } from 'node:os';
import { processTree, diskBytes } from './telemetry.mjs';
import { stageWindow } from './scheduler.mjs';
import { sustainedPhase } from './sustained.mjs';
import { memoryProfile, effectiveCaps, verifyMemoryProfileSample, requireMemoryProfile } from './memory-profile.mjs';
import { residency, verifyResidencySample, requireResidency } from './residency.mjs';
import { errorReceipt } from './failures.mjs';

export function verifySampleProfiles(profile,row) {
  row.memoryProfileVerification=verifyMemoryProfileSample(profile.memoryProfile,row.server?.health,row.server?.diagnostics);
  row.residencyVerification=verifyResidencySample(profile.residency,row.server?.diagnostics);
  if(row.memoryProfileVerification.status!=='unverified')requireMemoryProfile(row.memoryProfileVerification);
  if(row.residencyVerification.status!=='unverified')requireResidency(row.residencyVerification);
  return row;
}

export function observation(profile,start,receivedAt,from=receivedAt) {
  const elapsedMs=start===undefined?null:receivedAt-start;
  return {memoryProfile:memoryProfile(profile.memoryProfile),residency:residency(profile.residency),receivedAt,elapsedMs,windowStartElapsedMs:start===undefined?null:from-start,
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
        entry.timer=timer(()=>{pending.delete(id);entry.completedAt=now();resolve(entry);},5000);
      });
    },
    receive(message,generation,receivedAt=now()) {
      const part=message.type==='sample-error'?(message.part??'snapshot'):
        {'sample-health':'health','sample-diagnostics':'diagnostics','sample-heap':'heap',sample:'snapshot'}[message.type];
      const entry=pending.get(message.id);if(!part||!entry||entry.generation!==generation)return;
      entry[part]??={data:message,generation,receivedAt};
      if(['snapshot','health','diagnostics'].every(key=>entry[key])){
        pending.delete(message.id);cancelTimer(entry.timer);entry.completedAt=receivedAt;entry.resolve(entry);
      }
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
    async collect({start,generation,pid,serverId,client}) {
      const requestedAt=now(),clientObservation=observation(profile,start,client.receivedAt??requestedAt);
      const packet=await requestSnapshot(generation),errorReasons=[];
      const identity=serverId??packet.snapshot?.data?.serverId??packet.health?.data?.serverId??packet.diagnostics?.data?.serverId;
      const part=name=>{
        const receipt=packet[name];
        if(!receipt){errorReasons.push({part:name,error:{name:'ObservationMissing',message:'Observation did not arrive before the inbox deadline.'}});return null;}
        if(receipt.generation!==generation||receipt.data?.serverId!==identity){errorReasons.push({part:name,error:{name:'ObservationIdentityMismatch',message:'Receipt does not match the requested server generation.'}});return null;}
        if(receipt.data.type==='sample-error'){errorReasons.push({part:name,error:receipt.data.error??{name:'ObservationError',message:'Server observation failed.'}});return null;}
        return receipt;
      };
      const snapshot=part('snapshot'),data=snapshot?.data,health=part('health'),diagnostics=part('diagnostics');
      const receivedAt=Math.max(requestedAt,...[snapshot,health,diagnostics].filter(Boolean).map(row=>row.receivedAt));
      const serverWindow=observation(profile,start,receivedAt,lastServerAt??requestedAt);
      const metadata=receipt=>receipt?{...observation(profile,start,receipt.receivedAt),generation,serverId:receipt.data.serverId,
        memoryProfile:receipt.data.memoryProfile,residency:receipt.data.residency}:null;
      const source=data??health?.data??diagnostics?.data;
      const server=source?{...data,serverId:identity,...observation(profile,start,receivedAt),
        window:snapshot?observation(profile,start,snapshot.receivedAt,lastServerAt??requestedAt):null,
        memoryObservation:metadata(snapshot),
        memoryProfile:source.memoryProfile,
        residency:source.residency,
        health:health?.data.health??null,healthObservation:metadata(health),
        diagnostics:diagnostics?.data.diagnostics??null,diagnosticsObservation:metadata(diagnostics),
        effectiveCaps:effectiveCaps(health?.data.health,diagnostics?.data.diagnostics)}:null;
      if(snapshot)lastServerAt=snapshot.receivedAt;
      const treeStart=now();let treeData;
      try {treeData=await readTree(pid);}catch(error){treeData={supported:true,processes:null,error:errorReceipt(error)};}
      const treeAt=now();
      const tree={...treeData,...observation(profile,start,treeAt),window:observation(profile,start,treeAt,lastTreeAt??treeStart),
        cpuPercent:lastTreeCpu!==undefined&&treeData.cpuSeconds!==null?
          Math.max(0,(treeData.cpuSeconds-lastTreeCpu)/((treeAt-lastTreeAt)/1000)/logicalCpus*100):null};
      lastTreeCpu=treeData.cpuSeconds??undefined;lastTreeAt=treeAt;
      if(tree.supported&&!tree.processes)errorReasons.push({part:'process-tree',error:tree.error??{name:'ProcessTreeUnavailable',message:'Process-tree observation is incomplete.'},details:tree.errors});
      if(!disk||treeAt-disk.receivedAt>=profile.diskSampleSeconds*1000) {
        try {const value=await readDisk(directory);disk={...value,...observation(profile,start,now())};}
        catch(error){errorReasons.push({part:'disk',error:errorReceipt(error)});}
      }
      return {errors:errorReasons.length,
        row:{...serverWindow,generation,collectionPhase:client.phase??null,measured:client.phase?false:serverWindow.measured,
          errorReasons,tree,disk,client:{...client,observation:clientObservation},server,treeCpuPercent:tree.cpuPercent,collectedAt:now()}};
    },
  };
}
