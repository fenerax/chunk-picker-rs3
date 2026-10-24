// PREPARED ONLY. Run only after root explicitly authorizes native work.
import {pathToFileURL} from 'node:url';
import {qualifies} from './protocol.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {note} from './diagnostics.mjs';
const candidate=pathToFileURL(process.env.R131_CANDIDATE_ROOT+'/');
const appURL=p=>new URL(p,candidate);
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { sha256, requirePublicOnly, authoredDefinitions, serializedState } from './driver-lib.mjs';
if (!process.argv.includes('--authorized-native')) throw new Error('Native execution requires root authorization and --authorized-native');

const tracked=async(op,load)=>{note(op);try{return await load();}catch(error){note(op,error,'failed');throw error;}};
const [{ Worker }, { ProcessWorker }, { createTaskScheduler }, { createGroupState }, { buildWorld }, { selectedDataset }] = await Promise.all([
  import('node:worker_threads'), tracked('app-import-process',()=>import(appURL('app/tasks/process-worker.mjs'))), tracked('app-import-scheduler',()=>import(appURL('app/tasks/scheduler.mjs'))),
  tracked('app-import-state',()=>import(appURL('app/core/state.mjs'))), tracked('app-import-world',()=>import(appURL('app/data/world.mjs'))), tracked('app-import-dataset',()=>import(appURL('app/dataset-runtime.mjs'))),
]);
const records=[];let generation=0;

export function fixture(scale,cold=false) {
  note('fixture-definition');
  const definitions = authoredDefinitions(scale);if(cold)for(const record of Object.values(definitions.challenges.Quest))record.NeverShow=true;const world = buildWorld(definitions);
  const state = createGroupState([{ id:'a',name:'Authored A' },{ id:'b',name:'Authored B' }]);
  state.members[0].unlocked = ['12341']; state.members[1].unlocked = ['12342']; state.rules['content.f2p'] = false;
  return { definitions, state, workerData: { definitions, world: { chunks: world.chunks, surface: world.surface },
    datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
    datasetOptions: { cacheWalking:false, reviewedOverlays:false } } };
}
export async function schedulerFixture(t, mode, data, enabled, phase) {
  const events = [], workers = []; let phaseAction;
  const factory = workerData => {workerData={...workerData,r131WorkerURL:appURL('app/tasks/worker.mjs').href};
    // Real adapters; readiness/capability messages are never invented or edited.
    const preload = new URL('./native-phase-preload-v3.mjs',import.meta.url).href;
    const worker = mode === 'thread' ? new Worker(appURL('app/tasks/worker.mjs'), {
      workerData, resourceLimits:{maxOldGenerationSizeMb:768,maxYoungGenerationSizeMb:32}, execArgv:phase?['--import',preload]:[],
    }) : new ProcessWorker(workerData, phase ? { probeImport:preload } : { probeImport:undefined });
    const pid=mode==='thread'?process.pid:worker.pid,stat=readFileSync(`/proc/${pid}/stat`,'utf8');const startTicks=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];const identity={generation:++generation,pid,startTicks,...(mode==='thread'?{threadId:worker.threadId}:{})};
    workers.push({ worker, identity });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { events.push({ direction:'send',type:message.type,id:message.id,identity,atParentMs:performance.now() }); return post(message); };
    worker.on('exit',code=>events.push({direction:'exit',code,identity}));
    worker.on('message', message => {
      events.push({ direction:'receive',type:message.type??'result',id:message.id,identity,atParentMs:performance.now(),workerDurationMs:message.evaluationMs,workerStages:message.timingMs,phase:message.phase,sourceURL:message.sourceURL,caller:message.caller,armed:message.armed,baseline:message.idlePlanningBaseline,resultUndefined:message.result===undefined,privateBaseline:Boolean(message.idlePlanningBaseline),capable:message.idlePlanning });
      if (message.type === 'r131-phase' && message.phase === phase && message.armed && message.sourceURL===appURL('app/tasks/chunk-planning-index.mjs').href && qualifies(message.caller,message.sourceURL,phase) && events.some(e=>e.direction==='send'&&e.type==='idle-planning'&&e.id===message.id&&e.identity===identity)) phaseAction?.();
    });
    return worker;
  };
  note('fixture-scheduler-start');const scheduler = await createTaskScheduler({ workerData:data.workerData, workerFactory:factory, predictionWorkerFactory:factory,
    experimentalIdleForegroundPlanning:enabled, deadlineMs:12000, startupDeadlineMs:12000, maxRestarts:0 });
  t.after(async()=>{await scheduler.close();for(const {worker,identity} of workers){assert.ok(events.some(e=>e.direction==='exit'&&e.identity===identity),'real owned worker exit required');if(mode==='thread')assert.equal(worker.threadId,-1);else if(existsSync(`/proc/${identity.pid}/stat`)){const stat=readFileSync(`/proc/${identity.pid}/stat`,'utf8');assert.notEqual(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],identity.startTicks,'owned process must be absent');}}});
  const inputFor = () => sha256(JSON.stringify([data.state.rules,data.state.taskRules,data.state.members]));
  const warm = member => {note('fixture-warm');return scheduler.evaluate(data.state,member,'evaluate',undefined,`warm:${member}:${inputFor()}`, inputFor(),undefined,[],'full',serializedState(data.state,inputFor()));};
  const planning = signal => {note('fixture-planning');return scheduler.evaluate(data.state,'a','chunk-planning','12341',JSON.stringify([data.state.revision,inputFor(),'a','12341']),inputFor(),signal,[],'full',serializedState(data.state,inputFor()));};
  return { scheduler,warm,planning,events,workers,setPhaseAction:action => phaseAction=action };
}
