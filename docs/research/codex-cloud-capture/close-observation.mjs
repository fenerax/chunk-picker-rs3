// Diagnostic-only source instrumentation. Original source is never modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const BASE=Object.freeze({
  'app/server.mjs':'5edc544473fe98ba1bdf42deaf8cceccbea9db5fa9f42d51daa111f3eb9ceb25',
  'app/storage/store.mjs':'bcdd2a3fa7d07403ad76ac34f44e0754ef31ee8f6f204fd29ea0e0231d4b0f06',
});
export const PHASES=Object.freeze([
  'serverEnter','serverPreface','serverActivation','serverOverlays','serverConnections',
  'serverMutation','serverInvites','serverFeedback','serverUsage','serverGamePlugin','serverAuth',
  'serverStore','serverResponses','serverWorker','serverAll',
  'storeEnter','storeActivation','storeWrites','storeMaintenance','storeBeforeUnlock',
  'storeReleaseFile','storeReleaseGuard','storeAll',
]);
export const STATES=Object.freeze(['unobserved','entered','pending','fulfilled','rejected']);
export const COUNTS=Object.freeze(['connections','savingConnections','clients','maintenancePending','storeListeners']);
const observers=`
// R116 diagnostic observer only: no timer, replacement result or swallowed app failure.
function __r116CloseMark(phase,status,counts={}) { try { globalThis.__r116ObserveClose?.({phase,status,counts}); } catch {} }
function __r116CloseWatch(phase,promise,counts=()=>({})) {
  __r116CloseMark(phase,'pending',counts());
  void Promise.resolve(promise).then(()=>__r116CloseMark(phase,'fulfilled',counts()),()=>__r116CloseMark(phase,'rejected',counts()));
  return promise;
}
`;
const replaceOnce=(source,from,to)=>{
  if(source.split(from).length!==2)throw Error('CLOSE_OBSERVATION_ANCHOR_MISMATCH');
  return source.replace(from,to);
};
export function instrumentModule(name,bytes) {
  if(!Object.hasOwn(BASE,name)||sha(bytes)!==BASE[name])throw Error('CLOSE_OBSERVATION_SOURCE_MISMATCH');
  let text=bytes.toString('utf8');
  if(name==='app/server.mjs'){
    text=replaceOnce(text,`    close() {
      if (closePromise) return closePromise;
      closed = true;`,`    close() {
      if (closePromise) return closePromise;
      const observationCounts=()=>({connections:connections.size,savingConnections:savingConnections.size,clients:clients.size});
      __r116CloseMark('serverEnter','entered',observationCounts());
      __r116CloseMark('serverPreface','entered',observationCounts());
      closed = true;`);
    text=replaceOnce(text,`      closePromise = (async () => {
        if (activationPending) await activationPending.catch(() => {});
        const overlaysClosed = overlays.close();`,`      __r116CloseMark('serverPreface','fulfilled',observationCounts());
      closePromise = (async () => {
        if (activationPending) await __r116CloseWatch('serverActivation',activationPending.catch(() => {}),observationCounts);
        const overlaysClosed = __r116CloseWatch('serverOverlays',overlays.close(),observationCounts);`);
    text=replaceOnce(text,'        // Accepted mutations may still be awaiting a save command.',`        __r116CloseWatch('serverConnections',connectionsClosed,observationCounts);
        // Accepted mutations may still be awaiting a save command.`);
    text=replaceOnce(text,'        const authClosed = mutationQueue.then(() => Promise.all([invites.close(), feedback.close(), usage.close(), overlaysClosed, gamePlugin.close()]));',
      `        const authClosed = __r116CloseWatch('serverAuth',__r116CloseWatch('serverMutation',mutationQueue,observationCounts).then(() => Promise.all([
          __r116CloseWatch('serverInvites',invites.close(),observationCounts),
          __r116CloseWatch('serverFeedback',feedback.close(),observationCounts),
          __r116CloseWatch('serverUsage',usage.close(),observationCounts),overlaysClosed,
          __r116CloseWatch('serverGamePlugin',gamePlugin.close(),observationCounts)])),observationCounts);`);
    text=replaceOnce(text,'        const storeClosed = store.close({ beforeUnlock: authClosed });',
      `        const storeClosed = __r116CloseWatch('serverStore',store.close({ beforeUnlock: authClosed }),observationCounts);`);
    text=replaceOnce(text,'        try { await Promise.all([connectionsClosed, taskWorker?.close(shutdownDeadlineMs), boundedResponses]); }',
      `        __r116CloseWatch('serverResponses',boundedResponses,observationCounts);
        try { await __r116CloseWatch('serverAll',Promise.all([connectionsClosed,__r116CloseWatch('serverWorker',taskWorker?.close(shutdownDeadlineMs),observationCounts),boundedResponses]),observationCounts); }`);
  }else{
    text=replaceOnce(text,'  const releaseLock = async () => { try { await releaseFileLock(); } finally { await releaseGuard(); } };',
      `  const releaseLock = async () => { try { await __r116CloseWatch('storeReleaseFile',releaseFileLock()); } finally { await __r116CloseWatch('storeReleaseGuard',releaseGuard()); } };`);
    text=replaceOnce(text,'      closePromise = (async () => { await activationPending?.catch(() => {}); await queue; if (!readOnly && !frozen && !liveSwapStrict) await enqueueMaintenance(maintainRetention, { allowClosing: true }); else await maintenanceQueue; await beforeUnlock; listeners.clear(); await releaseLock(); })();',
      `      const observationCounts=()=>({maintenancePending,storeListeners:listeners.size});
      __r116CloseMark('storeEnter','entered',observationCounts());
      closePromise = __r116CloseWatch('storeAll',(async () => {
        await __r116CloseWatch('storeActivation',activationPending?.catch(() => {}),observationCounts);
        await __r116CloseWatch('storeWrites',queue,observationCounts);
        if (!readOnly && !frozen && !liveSwapStrict) await __r116CloseWatch('storeMaintenance',enqueueMaintenance(maintainRetention, { allowClosing: true }),observationCounts);
        else await __r116CloseWatch('storeMaintenance',maintenanceQueue,observationCounts);
        await __r116CloseWatch('storeBeforeUnlock',beforeUnlock,observationCounts);
        listeners.clear(); await releaseLock();
      })(),observationCounts);`);
  }
  return Buffer.from(observers+text);
}

export function createCloseCollector() {
  const states=Object.fromEntries(PHASES.map(name=>[name,'unobserved']));
  const firstMs=Object.fromEntries(PHASES.map(name=>[name,null])),lastMs={...firstMs};
  const counts=Object.fromEntries(COUNTS.map(name=>[name,null]));
  let events=0,dropped=0,lastPhase='unobserved';
  return {
    record(event){
      if(!event||!PHASES.includes(event.phase)||!STATES.includes(event.status)||event.status==='unobserved'
        ||!Number.isSafeInteger(event.elapsedMs)||event.elapsedMs<0){dropped++;return null;}
      if(events>=128){dropped++;return null;}
      events++;lastPhase=event.phase;states[event.phase]=event.status;
      firstMs[event.phase]??=event.elapsedMs;lastMs[event.phase]=event.elapsedMs;
      for(const key of COUNTS)if(Object.hasOwn(event.counts??{},key)){
        const value=event.counts[key];counts[key]=Number.isSafeInteger(value)&&value>=0?value:null;
      }
      return {phase:event.phase,status:event.status,elapsedMs:event.elapsedMs,
        counts:Object.fromEntries(COUNTS.filter(key=>Object.hasOwn(event.counts??{},key)).map(key=>[key,counts[key]]))};
    },
    snapshot(){return {lastPhase,events,dropped,states:{...states},firstMs:{...firstMs},lastMs:{...lastMs},counts:{...counts}};},
  };
}

/** Exact public-source copy, two admitted transforms, complete derived-tree verification. */
export async function installObservedSource({source,scratch,sourceLock}) {
  const destination=path.join(scratch,'r116-observed-source');
  if(path.relative(scratch,destination).startsWith('..')||!Array.isArray(sourceLock?.files)||sourceLock.files.length!==1928)
    throw Error('CLOSE_OBSERVATION_SOURCE_LOCK');
  await fs.cp(source,destination,{recursive:true,errorOnExist:true,force:false});
  const files=[],modules={};
  for(const file of sourceLock.files){
    if(typeof file.path!=='string'||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(file.path))
      throw Error('CLOSE_OBSERVATION_SOURCE_PATH');
    const filename=path.join(destination,file.path),copied=await fs.readFile(filename);
    if(sha(copied)!==file.sha256||copied.length!==file.bytes)throw Error('CLOSE_OBSERVATION_COPY_MISMATCH');
    let final=copied;
    if(Object.hasOwn(BASE,file.path)){
      final=instrumentModule(file.path,copied);await fs.writeFile(filename,final);
      if(sha(await fs.readFile(filename))!==sha(final))throw Error('CLOSE_OBSERVATION_WRITE_MISMATCH');
      modules[file.path]={originalSha256:sha(copied),observedSha256:sha(final)};
    }
    files.push({path:file.path,bytes:final.length,sha256:sha(final)});
  }
  if(Object.keys(modules).length!==2)throw Error('CLOSE_OBSERVATION_MODULE_SET');
  return {source:destination,identity:{mode:'scratch-source-close-phases-v1',timingEligibility:'diagnostic-only',
    originalManifestSha256:sourceLock.manifestSha256,observedManifestSha256:sha(JSON.stringify(files)),fileCount:files.length,
    originalServerSha256:modules['app/server.mjs'].originalSha256,observedServerSha256:modules['app/server.mjs'].observedSha256,
    originalStoreSha256:modules['app/storage/store.mjs'].originalSha256,observedStoreSha256:modules['app/storage/store.mjs'].observedSha256}};
}
