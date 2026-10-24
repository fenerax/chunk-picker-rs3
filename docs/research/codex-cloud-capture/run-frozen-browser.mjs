// One public fixed-input case. Importing this module never starts an application.
import fs from 'node:fs/promises';
import {writeSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fork} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PIN,FIXTURE_SHA,sha,ownedPath,parseArgs,checkpoints,bounded,until,treeManifest,
  verifySource,verifyHarness,sanitizePath,classifyObservedWrites} from './harness-utils.mjs';
import {installAdapter,instrumentMainSource} from './browser-adapter.mjs';
import {auditPlanning,projectPlanningTask} from './strict-oracle.mjs';
import {auditFrozenPlanning,OPEN_GATES} from './frozen-oracle.mjs';
import {initialExpectations,auditOpeningProjection} from './opening-oracle.mjs';
import {createFailureTracker} from './failure-diagnostics.mjs';
import {selectedTasksSectionReady} from './tasks-section-readiness.mjs';
import {createChildCloser,CLOSE_DRIVER_STAGES,applyCleanupFailure} from './child-close-diagnostics.mjs';
import {createCloseCollector} from './close-observation.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const now=()=>performance.now();
const OBSERVATION_COMPLETE=Symbol('reference-close-observation-complete');
// Test-only observation. This finite vocabulary is also the public policy input.
export const FAILURE_OPERATIONS=Object.freeze([
  'entry-setup','node-version','harness-verify','fixture-read','source-verify','source-lock-write',
  'reference-root-create','reference-child-start','reference-child-ready','reference-witness-begin',
  'reference-snapshot-before','reference-http-fetch','reference-body-parse','reference-playwright-load',
  'reference-browser-launch','reference-browser-version','reference-context-create','reference-adapter-install',
  'reference-origin-route-install','reference-page-create','reference-main-route-install','reference-main-fetch',
  'reference-main-read','reference-main-instrument','reference-main-fulfill','reference-navigation',
  'reference-context-wait','reference-open-chunk','reference-tasks-click','reference-section-ready-wait',
  'reference-summary-open-read','reference-summary-click','reference-all-chip-wait','reference-map-read',
  'reference-projection-build','reference-browser-close','reference-snapshot-before-all',
  'reference-snapshot-after-frames','reference-witness-finish','reference-identity','reference-child-close',
  'reference-page-error','measured-root-create','measured-store-copy','measured-playwright-load',
  'measured-browser-launch','measured-browser-version','measured-child-start','measured-child-ready',
  'measured-source-identity','measured-store-copy-identity','measured-dataset-identity','relay-start',
  'measured-context-create','measured-adapter-install','measured-page-create','measured-network-ledger',
  'measured-origin-route-install','measured-main-route-install','measured-main-fetch','measured-main-read',
  'measured-main-instrument','measured-main-fulfill','measured-navigation','measured-context-wait',
  'measured-instrumentation-count','measured-page-error','overlay-create','overlay-response-parse',
  'overlay-page-create','overlay-network-ledger','overlay-navigation','overlay-content-wait',
  'overlay-content-read','overlay-content-verify','measured-page-foreground','measured-open-chunk',
  'measured-witness-begin','measured-snapshot-before','measured-input-verify','opening-arm','opening-tasks-click',
  'opening-section-ready-wait','opening-summary-open-read','opening-summary-click','opening-transition-wait',
  'all-expectation-build','contrast-wait','contrast-click','measured-snapshot-before-all','native-view-read',
  'native-scope-verify','all-arm','all-click','all-transition-wait','measured-snapshot-after-frames',
  'measured-witness-finish','measured-capture-read','overlay-capture-read','projection-audits',
  'evidence-write','calibration-fetch','controller-cleanup','final-proof-write','scratch-cleanup',
  'result-write','capability-survey','unknown-operation',
]);
export async function capabilitySurvey(page,pageErrorCount,ms=900){
  const unavailable={surveyStatus:'unavailable',documentReadyState:'unknown',tasksTabCount:null,
    tasksTabVisibleCount:null,possibleSummaryCount:null,pageErrorCount:Number.isSafeInteger(pageErrorCount)&&pageErrorCount>=0?pageErrorCount:null};
  if(!page)return unavailable;
  try{
    if(page.isClosed())return unavailable;
    const values=await bounded(page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('#chunk-content button[data-tab="tasks"][role="tab"]')];
      const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();
        return node.isConnected&&!node.hidden&&!node.closest('[hidden]')&&style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
      return {documentReadyState:document.readyState,tasksTabCount:nodes.length,tasksTabVisibleCount:nodes.filter(visible).length,
        possibleSummaryCount:[...document.querySelectorAll('#chunk-content summary')].filter(node=>node.textContent==='Possible Tasks').length};
    }),ms,'CAPABILITY_SURVEY_TIMEOUT');
    const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    return {surveyStatus:'observed',documentReadyState:['loading','interactive','complete'].includes(values.documentReadyState)?values.documentReadyState:'unknown',
      tasksTabCount:count(values.tasksTabCount),tasksTabVisibleCount:count(values.tasksTabVisibleCount),possibleSummaryCount:count(values.possibleSummaryCount),
      pageErrorCount:unavailable.pageErrorCount};
  }catch(error){return {...unavailable,surveyStatus:error?.message==='CAPABILITY_SURVEY_TIMEOUT'?'timed-out':'unavailable'};}
}
export const HARNESS_ERROR_MESSAGES=Object.freeze([
  'ALL_ARM_BLOCKED','ALL_TRANSITION_TIMEOUT','APP_NOT_READY_OR_CLOSING','ASSET_ROOT_OUTSIDE_OWNED_SCRATCH',
  'BROWSER_CLOSE_TIMEOUT','BROWSER_CONTEXT_TIMEOUT','BROWSER_LAUNCH_DRAIN_TIMEOUT','CAPABILITY_SURVEY_TIMEOUT',
  'CHILD_CLOSE_TIMEOUT','CHILD_EXITED','CHILD_FAILED','CHILD_IPC_SEND_FAILED','CHILD_KILL_TIMEOUT',
  'CHILD_READY_TIMEOUT','CHILD_RPC_FAILED','CHILD_RPC_TIMEOUT','CHILD_STARTUP_EXIT','CHROMIUM_VERSION_MISMATCH',
  'CLOSED_REFERENCE_STORE_COPY_MISMATCH','CONTROLLER_DEADLINE','CONTROLLER_SIGNAL','COPIED_ACCESS_TOKEN_REQUIRED',
  'DATASET_IDENTITY_MISSING','DECLARED_SOURCE_LOCK_REQUIRED_FOR_OTHER_COMMIT','DUPLICATE_ARGUMENT',
  'DUPLICATE_SNAPSHOT_PHASE','DUPLICATE_SOURCE_ARGUMENT','EXPECTED_GIT_SOURCE_REQUIRED','FIXTURE_DIGEST_MISMATCH',
  'FIXTURE_HASH_MISMATCH','FIXTURE_IDENTITY_MISMATCH','HARNESS_HASH_MISMATCH','HARNESS_LOCK_REQUIRED',
  'INITIAL_STORE_NOT_EMPTY','INVALID_ARGUMENT','INVALID_ARGUMENTS','INVALID_EXPECTED_SOURCE_PIN',
  'INVALID_IPC_COMMAND','INVALID_SNAPSHOT_PHASE','INVALID_SOURCE_COMMIT','INVALID_SOURCE_LOCK',
  'INVALID_SOURCE_LOCK_PATH','INVALID_SOURCE_MANIFEST_DIGEST','INVALID_SUPPLEMENTARY_KEYS','INVALID_WITNESS_TOKEN',
  'IPC_DISCONNECTED','IPC_REQUIRED','MAIN_INSTRUMENTATION_COUNT','MAIN_SOURCE_MISMATCH','MEASURED_DATASET_CHANGED',
  'MEASURED_EXISTING_STORE_REQUIRED','MEASURED_INPUT_DIFFERS_FROM_REFERENCE','MEASURED_SOURCE_IDENTITY_CHANGED',
  'MISSING_ARGUMENT_VALUE','NATIVE_SCOPE_MISMATCH','NATIVE_TARGET_NOT_VISIBLE','NO_ACTIVE_WITNESS',
  'NODE_VERSION_MISMATCH','NON_LOOPBACK_LISTENER','OPENING_TRANSITION_TIMEOUT','OPENING_SECTION_READY_TIMEOUT','REFERENCE_SECTION_READY_TIMEOUT','OVERLAY_NAVIGATION_FAILED',
  'OVERLAY_WIDGET_CONTENT_MISSING','PATH_NOT_OWNED','PINNED_NODE_VERSION_REQUIRED','PLAYWRIGHT_VERSION_MISMATCH',
  'PREDICATE_TIMEOUT','PUBLIC_ASSET_ROOT_NOT_EMPTY','PUBLIC_DATASET_IDENTITY_MISMATCH',
  'REFERENCE_BROWSER_CLOSE_TIMEOUT','REFERENCE_BROWSER_CONTEXT_TIMEOUT','REFERENCE_BROWSER_LAUNCH_DRAIN_TIMEOUT',
  'REFERENCE_CHROMIUM_VERSION_MISMATCH','REFERENCE_CLOSE_INCOMPLETE','REFERENCE_EMPTY','REFERENCE_INPUT_CHANGED',
  'REFERENCE_MAIN_SOURCE_MISMATCH','REFERENCE_MAP_SCOPE_INVALID','REFERENCE_SCOPE_INVALID','REFERENCE_WITNESS_INVALID',
  'REQUIRED_PATH_ARGUMENT_MISSING','SNAPSHOT_PHASE_ORDER','SNAPSHOT_REVISION_MISMATCH','SOURCE_ANCHOR_MISMATCH',
  'SOURCE_ANCHOR_MISSING','SOURCE_LOCK_ANCHOR_MISSING','SOURCE_LOCK_MISMATCH','SOURCE_PATH_ESCAPED',
  'SOURCE_SCRATCH_NOT_DISJOINT','SOURCE_SPECIAL_FILE_UNSUPPORTED','SOURCE_SYMLINK_UNSUPPORTED',
  'SOURCE_TRACKED_CHANGE','SOURCE_UNTRACKED_CHANGE','STARTUP_CANCELLED','STORE_NOT_FULLY_CLOSED',
  'STORE_OUTSIDE_OWNED_SCRATCH','STORE_OWNER_LOCK_NOT_THIS_PROCESS','STORE_OWNER_LOCK_REMAINS_AFTER_CLOSE',
  'STORE_REALPATH_OUTSIDE_OWNED_SCRATCH','UNKNOWN_ARGUMENT','UNKNOWN_STAGE','UNKNOWN_WITNESS_TOKEN',
  'UNSUPPORTED_ONE_CASE','WITNESS_ALREADY_ACTIVE_OR_CLOSED','WITNESS_TOKEN_MISMATCH','WITNESS_TOKEN_REUSED',
  'WORKER_SELECTION_DATASET_MISMATCH',
]);
const harnessErrorMessages=new Set(HARNESS_ERROR_MESSAGES);
export const codeOf=error=>{
  let message;try{message=error?.message;}catch{return 'runtime-error';}
  if(typeof message!=='string')return 'runtime-error';
  if(/^HTTP_\d{3}$/.test(message))return 'http-error';
  // App/browser exception text is never a public error code.
  return harnessErrorMessages.has(message)?message.toLowerCase().replaceAll('_','-'):'runtime-error';
};
const bodyRecord=(bodyText,extra={})=>({bodyText,bodySha256:sha(bodyText),complete:true,...extra});
export function buildExpected(body){
  const all=body.rows.map(row=>projectPlanningTask(row.task));
  const rows=[...all.filter(row=>!row.blocked),...all.filter(row=>row.blocked)];
  return {rows:rows.slice(0,60),counts:{shown:Math.min(60,rows.length),matching:rows.length,total:rows.length},
    showMoreHidden:rows.length<=60,searchValue:'',contrasting:all.some(row=>!row.blocked)?'blocked':'doable',
    contrastingRows:rows.filter(row=>all.some(value=>!value.blocked)?row.blocked:!row.blocked).slice(0,60)};
}
export function normalizeView(view){
  if(!view)return view;
  const label=view.selectedFilter??'';
  const filter=view.filter??(/^All(?: |$)/.test(label)?'all':/^Blocked(?: |$)/.test(label)?'blocked':/^Doable(?: |$)/.test(label)?'doable':'unknown');
  return {...view,at:view.capturedAt??view.at,filter,rows:view.rows??view.pageRows,shown:view.shown??view.counts?.shown,
    matching:view.matching??view.counts?.matching,total:view.total??view.counts?.total,
    group:view.group??view.nativeGroupChecked,paneVisible:view.paneVisible??view.visible};
}
export function choosePlanningBody(records,scope,beforeBrowserAt){
  return records.filter(record=>record.path==='/api/chunk-planning'&&record.complete&&record.memberId===scope.memberId&&
    String(record.chunkId)===String(scope.chunkId)&&Number.isFinite(record.parsedAt)&&record.parsedAt<=beforeBrowserAt)
    .reduce((latest,record)=>!latest||record.parsedAt>latest.parsedAt?record:latest,null);
}
function relayFor(directOrigin){
  const sockets=new Set(),timers=new Set();let listener;
  const delay=fn=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},20);timers.add(timer);};
  return {async start(){
    listener=net.createServer(client=>{
      const upstream=net.connect(Number(new URL(directOrigin).port),'127.0.0.1');
      for(const socket of [client,upstream]){sockets.add(socket);socket.setNoDelay(true);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{client.destroy();upstream.destroy();});}
      client.on('data',bytes=>delay(()=>{if(!upstream.destroyed)upstream.write(bytes);}));
      upstream.on('data',bytes=>delay(()=>{if(!client.destroyed)client.write(bytes);}));
      client.on('end',()=>delay(()=>{if(!upstream.destroyed)upstream.end();}));
      upstream.on('end',()=>delay(()=>{if(!client.destroyed)client.end();}));
    });
    await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
    return `http://127.0.0.1:${listener.address().port}`;
  },async close(){for(const timer of timers)clearTimeout(timer);timers.clear();for(const socket of sockets)socket.destroy();sockets.clear();if(listener?.listening)await new Promise(resolve=>listener.close(resolve));}};
}
function childHandle(args,onCheckpoint){
  const closeObservation=createCloseCollector();
  const environment={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','PERF_STAGE_FD'])delete environment[key];
  const child=fork(path.join(HERE,'server-driver.mjs'),args,{stdio:['ignore','ignore','pipe','ipc'],
    env:environment,execArgv:['--max-old-space-size=2048']});
  child.stderr.resume();
  const pending=new Map();let nextId=0,ready,joinUrl,origin,exit,stopped,failure,stoppedCount=0,closeStage='unobserved';
  child.on('message',message=>{
    if(message.type==='checkpoint')onCheckpoint(message.phase??message.stage);
    if(message.type==='commit')onCheckpoint('store-commit-observed',{revision:message.entry?.revision??null,
      calculatorBytesSha256:message.entry?.snapshot?.calculation?.sha256??null,fullStateSha256:message.entry?.snapshot?.fullState?.sha256??null});
    if(message.type==='early')origin=message.origin;
    if(message.type==='ready'){ready=message;origin=message.origin??origin;}
    if(message.type==='private-invite')joinUrl=message.joinUrl;
    if(message.type==='close-observation')closeObservation.record(message.event);
    if(message.type==='close-progress'&&CLOSE_DRIVER_STAGES.includes(message.phase))closeStage=message.phase;
    if(message.type==='reply'||message.type==='stopped'){
      const item=pending.get(message.id);if(item){pending.delete(message.id);message.ok===false?item.reject(Error(message.error?.code??message.code??'CHILD_RPC_FAILED')):item.resolve(message.result??message);}
    }
    if(['error','startup-failed','driver-failed','command-failed'].includes(message.type)){failure=message.error?.code??message.code??'CHILD_FAILED';for(const item of pending.values())item.reject(Error(failure));pending.clear();}
    if(message.type==='stopped'){stopped=message;stoppedCount++;}
  });
  const exitPromise=new Promise(resolve=>child.once('exit',(code,signal)=>{exit={code,signal};for(const item of pending.values())item.reject(Error('CHILD_EXITED'));pending.clear();resolve(exit);}));
  child.once('error',()=>{exit={code:null,signal:null,error:'spawn-failed'};});
  let handle;
  const closer=createChildCloser({getExit:()=>exit,getStopped:()=>stopped,getStoppedCount:()=>stoppedCount,getPendingCount:()=>pending.size,
    getDriverStage:()=>closeStage,stop:()=>handle.rpc('stop',{},15000),waitExit:exitPromise,kill:signal=>child.kill(signal)});
  return handle={child,get ready(){return ready;},get origin(){return origin;},get joinUrl(){return joinUrl;},get exit(){return exit;},get stopped(){return stopped;},
    closeDiagnostic:()=>closer.diagnostic(),recordCloseWitness:code=>closer.witness(code),
    closePhaseDiagnostic:()=>closeObservation.snapshot(),
    async waitReady(){await until(()=>{if(failure)throw Error(failure);if(exit)throw Error('CHILD_STARTUP_EXIT');return ready&&joinUrl&&origin;},90000,'CHILD_READY_TIMEOUT');return ready;},
    rpc(command,extra={},ms=15000){const id=++nextId;return bounded(new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.send({id,command,...extra},error=>{if(error){pending.delete(id);reject(Error('CHILD_IPC_SEND_FAILED'));}});}),ms,'CHILD_RPC_TIMEOUT');},
    close:()=>closer.close()};
}
function datasetFrom(ready){const value=ready.identity?.dataset??ready.dataset??ready.identity??{};return {id:value.datasetId??value.id??'duo-legacy',digest:value.digest??ready.identity?.datasetDigest??ready.datasetDigest};}
function snapshotFrom(reply){return reply.snapshot??reply;}
function identityFields(sourceLock,dataset,fixtureHash,calculatorHash,ready){
  const staticEnvelope={datasetId:dataset.id,datasetDigest:dataset.digest,publicOnly:true,sourceObservation:'scratch-close-phases-only',
    suppliedDefinitions:false,suppliedWorld:false,suppliedRegistry:false,customWorkerFactories:false,
    nativeWorkerMode:'linux-default-thread',reviewedOverlays:true,predictionPrewarm:'default-on',
    externalAssetRoots:'fresh-empty-disposable',nodeVersion:process.version,workerSelection:ready.workerSelection,
    boundOptions:{predictionPrewarm:ready.boundOptions?.predictionPrewarm,startupWarmup:ready.boundOptions?.startupWarmup,
      workerFactory:ready.boundOptions?.workerFactory,beforeCommit:ready.boundOptions?.beforeCommit,privateAddon:ready.boundOptions?.privateAddon}};
  return {sourceBundleSha256:sourceLock.manifestSha256,expectedSourceManifestSha256:sourceLock.manifestSha256,
    staticEnvelopeSha256:sha(JSON.stringify(staticEnvelope)),datasetDigest:dataset.digest,fixtureSha256:fixtureHash,
    calculatorBytesSha256:calculatorHash,staticEnvelope};
}
function snapshotHash(snapshot){return snapshot.calculatorBytesSha256??snapshot.calculation?.sha256??snapshot.stateJSONSha256;}
function fullStateHash(snapshot){return snapshot.fullStateSha256??snapshot.fullState?.sha256??snapshot.stateSha256;}
function witnessSnapshot(snapshot,phase){return {phase,calculatorBytesSha256:snapshotHash(snapshot),fullStateSha256:fullStateHash(snapshot),
  revision:snapshot.revision,calculatorBytes:snapshot.calculatorBytes??snapshot.calculation?.bytes??snapshot.calculatorByteLength};}
export function validateClosedWitness(receipt,token,expectedCalculatorHash,expectedFullStateHash){
  if(!receipt||receipt.closeCompleted!==true||receipt.ownershipStable!==true||receipt.ownershipAfterClose?.present!==false)
    return {valid:false,code:'close-receipt-incomplete'};
  if(!Array.isArray(receipt.journal)||receipt.journal.length||!Array.isArray(receipt.captureErrors)||receipt.captureErrors.length)
    return {valid:false,code:'store-commit-or-capture-error-at-close'};
  const witness=receipt.witnesses?.find(value=>value.tokenSha256===sha(token));
  if(!witness||witness.valid!==true||witness.provisional!==false)return {valid:false,code:'finalized-witness-invalid'};
  if(snapshotHash(receipt.finalSnapshot??{})!==expectedCalculatorHash||
     fullStateHash(receipt.finalSnapshot??{})!==expectedFullStateHash)return {valid:false,code:'input-changed-during-close'};
  return {valid:true,code:'closed-witness-verified'};
}
export function publicCloseProof(closed){
  if(!closed)return null;const receipt=closed.final;
  const owner=value=>value?{present:value.present,sameProcess:value.sameProcess,startVerified:value.startVerified,
    ownerRecordSha256:value.ownerRecordSha256}:null;
  return {graceful:closed.graceful,exit:closed.exit,closeCompleted:receipt?.closeCompleted??false,
    ownershipStable:receipt?.ownershipStable??false,ownershipBeforeClose:owner(receipt?.ownershipBeforeClose),
    ownershipAfterClose:owner(receipt?.ownershipAfterClose),finalSnapshot:receipt?.finalSnapshot??null,
    journal:receipt?.journal??null,captureErrors:receipt?.captureErrors??null,witnesses:receipt?.witnesses??null,
    closedStateFile:receipt?.closedStore?.stateFile??null,commitInFlight:receipt?.commitInFlight??null};
}
async function httpText(url,headers={},options={}){
  const response=await fetch(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);return {text:await response.text(),status:response.status};
}
const authFor=joinUrl=>({Authorization:`Bearer ${new URL(joinUrl).pathname.slice('/join/'.length)}`});
async function nativeClick(page,locator){
  const box=await locator.boundingBox();if(!box)throw Error('NATIVE_TARGET_NOT_VISIBLE');
  const plannedNode=now(),label=await locator.textContent();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  return {plannedNode,returnedNode:now(),label};
}
async function networkLedger(context,page,surface){
  const rows=[],byId=new Map(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent',event=>{const row={id:event.requestId,surface,path:sanitizePath(event.request.url),
    method:event.request.method,startedNodeMs:now(),startedCDP:event.timestamp,status:'pending'};rows.push(row);byId.set(event.requestId,row);});
  cdp.on('Network.responseReceived',event=>{const row=byId.get(event.requestId);if(row)Object.assign(row,{httpStatus:event.response.status,
    provenSSE:event.response.mimeType==='text/event-stream',status:event.response.mimeType==='text/event-stream'?'proven-sse':'headers-only'});});
  cdp.on('Network.loadingFinished',event=>{const row=byId.get(event.requestId);if(row)Object.assign(row,{endedNodeMs:now(),endedCDP:event.timestamp,encodedBytes:event.encodedDataLength,status:'body-complete'});});
  cdp.on('Network.loadingFailed',event=>{const row=byId.get(event.requestId);if(row)Object.assign(row,{endedNodeMs:now(),endedCDP:event.timestamp,status:event.canceled?'aborted':'failed'});});
  return rows;
}
async function loadChromium(options,result){
  const module=process.env.PERF_PLAYWRIGHT_MODULE??pathToFileURL(path.join(options.deps,'node_modules/playwright/index.mjs')).href;
  const pkg=JSON.parse(await fs.readFile(path.join(options.deps,'node_modules/playwright/package.json'),'utf8'));
  result.playwrightVersion=pkg.version;if(pkg.version!=='1.62.1')throw Error('PLAYWRIGHT_VERSION_MISMATCH');
  return (await import(module)).chromium;
}
export async function main(argv=process.argv.slice(2),tracker=createFailureTracker(FAILURE_OPERATIONS)){
  const options=await tracker.at('entry-setup',()=>parseArgs(argv));
  await tracker.at('entry-setup',()=>fs.mkdir(options.scratch,{recursive:true}));
  await tracker.at('entry-setup',()=>fs.mkdir(path.dirname(options.out),{recursive:true}));
  const owned=await tracker.at('entry-setup',()=>fs.mkdtemp(path.join(options.scratch,'r116-owned-')));
  const checkpoint=checkpoints(path.join(options.scratch,'r116-checkpoints.jsonl'));let currentStage='start';
  const emit=(stage,fields={})=>{currentStage=stage;checkpoint(stage,fields);};emit.close=()=>checkpoint.close();
  const scope={memberId:options.member,chunkId:options.chunk,group:false,startup:options.startup};
  const result={schema:'r116-app-close-diagnostic-v1',mode:'r116-close-phases-observation-v1',passed:false,acceptance:false,status:'failed',code:'incomplete',scope,
    sourcePin:options['expected-source-pin'],openGates:[...OPEN_GATES],cleanupStatus:'incomplete',rttStatus:'unobserved',
    strictR79Status:'blocked',strictR79Code:'not-observed',frozenStatus:'blocked',frozenCode:'not-observed',openingStatus:'unrun',openingCode:'not-observed',
    nodeVersion:process.version,metrics:{},limitations:['new-linux-chromium151-baseline','no-physical-windows-or-paint-proof','docker-hard-resource-envelope-required']};
  let referenceChild,measuredChild,browser,referenceBrowser,context,relay,referenceClosed,measuredClosed,referencePage,measuredPage;
  let referencePageErrorCount=0,measuredPageErrorCount=0;
  let inputWitness,reference,fullCapture,deadlineTimer,forced=false,referenceToken,measuredToken,launching,referenceLaunching;
  let cancel;
  const deadline=new Promise((_,reject)=>{cancel=reject;deadlineTimer=setTimeout(()=>{forced=true;reject(Error('CONTROLLER_DEADLINE'));},480000);});
  const limited=promise=>Promise.race([promise,deadline]);
  const at=(operation,thunk)=>tracker.at(operation,()=>{
    // The same finite stage may repeat: detail is file-only metadata, while FD3
    // still contains only {stage}. A forced stop retains the last begun seam.
    emit(currentStage,{methodPhase:operation});return limited(Promise.resolve().then(thunk));
  });
  const signal=()=>{forced=true;cancel(Error('CONTROLLER_SIGNAL'));};process.once('SIGTERM',signal);process.once('SIGINT',signal);
  const check=()=>{if(forced)throw Error('CONTROLLER_SIGNAL');};
  const childArgs=(arm,store,lockFile,initial)=>['--source',options.source,'--scratch',arm,'--store',store,
    '--fixture',path.join(HERE,'fixture.json'),'--source-commit',options['expected-source-pin'],
    '--source-lock',lockFile,'--source-manifest-sha256',result.sourceManifestSha256,...(initial?['--initial']:[])];
  try{
    emit('start');await at('node-version',()=>{if(process.version!=='v24.19.0')throw Error('NODE_VERSION_MISMATCH');});
    result.harnessManifestSha256=await at('harness-verify',()=>verifyHarness(HERE));
    const fixtureBytes=await at('fixture-read',()=>fs.readFile(path.join(HERE,'fixture.json')));result.fixtureSha256=sha(fixtureBytes);
    await at('fixture-read',()=>{if(result.fixtureSha256!==FIXTURE_SHA)throw Error('FIXTURE_HASH_MISMATCH');});
    const sourceLock=await at('source-verify',()=>verifySource(options.source,options['expected-source-pin'],options['source-lock']));
    result.sourceManifestSha256=sourceLock.manifestSha256;
    const lockFile=path.join(owned,'source-lock.json');await at('source-lock-write',()=>fs.writeFile(lockFile,JSON.stringify(sourceLock)));
    emit('reference-start',{sourcePin:result.sourcePin,sourceManifestSha256:result.sourceManifestSha256,fixtureSha256:result.fixtureSha256});
    const referenceRoot=path.join(owned,'reference'),referenceStore=path.join(referenceRoot,'store');
    await at('reference-root-create',()=>fs.mkdir(referenceRoot,{recursive:true}));
    referenceChild=await at('reference-child-start',()=>childHandle(childArgs(referenceRoot,referenceStore,lockFile,true),(phase,fields={})=>emit('reference-start',{methodPhase:phase,...fields})));
    await at('reference-child-ready',()=>referenceChild.waitReady());check();
    result.closeObservationIdentity=referenceChild.ready.sourceIdentity?.closeObservation;emit('reference-ready');
    referenceToken='reference-'+randomUUID();await at('reference-witness-begin',()=>referenceChild.rpc('begin',{token:referenceToken}));
    const referenceBefore=snapshotFrom(await at('reference-snapshot-before',()=>referenceChild.rpc('snapshot',{phase:'before'})));
    emit('reference-ready',{methodPhase:'input-snapshot',calculatorBytesSha256:snapshotHash(referenceBefore),fullStateSha256:fullStateHash(referenceBefore),revision:referenceBefore.revision});
    const dataset=datasetFrom(referenceChild.ready);
    await at('reference-identity',()=>{if(dataset.id!=='duo-legacy'||!/^[a-f0-9]{64}$/.test(dataset.digest??''))throw Error('DATASET_IDENTITY_MISSING');});
    result.datasetDigest=dataset.digest;
    const refAuth=authFor(referenceChild.joinUrl);
    const endpoint=`/api/chunk-planning?memberId=${encodeURIComponent(scope.memberId)}&chunkId=${encodeURIComponent(scope.chunkId)}`;
    const refResponse=await at('reference-http-fetch',()=>httpText(referenceChild.origin+endpoint,refAuth));
    const refBody=await at('reference-body-parse',()=>{const body=JSON.parse(refResponse.text);
      if(body.format!=='chunk-planning-v1'||body.memberId!==scope.memberId||String(body.chunkId)!==scope.chunkId||!Array.isArray(body.rows))throw Error('REFERENCE_SCOPE_INVALID');return body;});
    // Reference-only UI setup supplies the map subset from the unchanged
    // baseline's own count pass, independently of the measured browser.
    const referenceChromium=await at('reference-playwright-load',()=>loadChromium(options,result));
    // Keep Playwright's original executable selection. No guessed /deps/browsers override.
    referenceLaunching=tracker.at('reference-browser-launch',()=>referenceChromium.launch({headless:true,timeout:30000,args:['--no-sandbox','--disable-background-networking'],
      env:{...process.env,XDG_CONFIG_HOME:path.join(owned,'reference-xdg-config'),XDG_CACHE_HOME:path.join(owned,'reference-xdg-cache')}}));
    referenceLaunching.then(value=>{referenceBrowser=value;if(forced)void value.close().catch(()=>{});},()=>{});
    referenceBrowser=await at('reference-browser-launch',()=>referenceLaunching);
    await at('reference-browser-version',()=>{result.chromiumVersion=referenceBrowser.version();if(result.chromiumVersion!==options['expected-chromium'])throw Error('REFERENCE_CHROMIUM_VERSION_MISMATCH');});
    const refContext=await at('reference-context-create',()=>referenceBrowser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}));
    await at('reference-adapter-install',()=>refContext.addInitScript(installAdapter,{group:false,memberId:scope.memberId}));
    await at('reference-origin-route-install',()=>refContext.route('**/*',route=>tracker.callback('reference-origin-route-install',async()=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==referenceChild.origin){await route.abort('blockedbyclient');return;}await route.fallback();})));
    const refPage=referencePage=await at('reference-page-create',()=>refContext.newPage());
    refPage.on('pageerror',error=>{referencePageErrorCount++;tracker.recordCallback('reference-page-error',error);});
    await at('reference-main-route-install',()=>refPage.route('**/main.mjs',route=>tracker.callback('reference-main-route-install',async()=>{
      const response=await tracker.at('reference-main-fetch',()=>route.fetch()),original=await tracker.at('reference-main-read',()=>response.text());
      const served=await tracker.at('reference-main-instrument',()=>{if(sha(original)!==sourceLock.files.find(file=>file.path==='app/web/main.mjs')?.sha256)throw Error('REFERENCE_MAIN_SOURCE_MISMATCH');
        result.referenceMainOriginalSha256=sha(original);const served=instrumentMainSource(original);result.referenceMainInstrumentedSha256=sha(served);return served;});
      await tracker.at('reference-main-fulfill',()=>route.fulfill({response,body:served}));
    })));
    await at('reference-navigation',()=>refPage.goto(referenceChild.joinUrl,{waitUntil:'domcontentloaded',timeout:60000}));
    await at('reference-context-wait',()=>until(()=>refPage.evaluate(()=>!!window.__r116Snap?.()?.memberId),60000,'REFERENCE_BROWSER_CONTEXT_TIMEOUT'));
    await at('reference-open-chunk',()=>refPage.evaluate(id=>window.__r116OpenChunk(id),scope.chunkId));
    await at('reference-tasks-click',()=>nativeClick(refPage,refPage.locator('#chunk-content button[data-tab="tasks"][role="tab"]')));
    // The native Tasks tab auto-opens its DETAILS; the shipping stylesheet
    // deliberately hides SUMMARY in tab panels. Observe the linked visible
    // section without clicking hidden UI or changing its open state.
    await at('reference-section-ready-wait',()=>until(()=>refPage.evaluate(selectedTasksSectionReady),60000,'REFERENCE_SECTION_READY_TIMEOUT'));
    await at('reference-all-chip-wait',()=>refPage.locator('#chunk-content .filter-chip').filter({hasText:/^All \d+$/}).waitFor({state:'visible',timeout:60000}));
    const referenceMap=await at('reference-map-read',()=>refPage.evaluate(id=>window.__r116MapTaskIds(id),scope.chunkId));
    await at('reference-map-read',()=>{if(referenceMap.memberId!==scope.memberId||String(referenceMap.chunkId)!==scope.chunkId||referenceMap.group!==false||!Array.isArray(referenceMap.taskIds))throw Error('REFERENCE_MAP_SCOPE_INVALID');});
    const expectedByFilter=await at('reference-projection-build',()=>initialExpectations(refBody,referenceMap.taskIds));
    result.referenceInitialProjectionSha256=sha(JSON.stringify(expectedByFilter));
    await at('reference-browser-close',()=>bounded(referenceBrowser.close(),15000,'REFERENCE_BROWSER_CLOSE_TIMEOUT'));referenceBrowser=null;referenceLaunching=null;
    const referenceAfter=snapshotFrom(await at('reference-snapshot-before-all',()=>referenceChild.rpc('snapshot',{phase:'before-all'})));
    await at('reference-snapshot-after-frames',()=>referenceChild.rpc('snapshot',{phase:'after-frames'}));
    const referenceFinished=await at('reference-witness-finish',()=>referenceChild.rpc('finish',{token:referenceToken}));
    await at('reference-witness-finish',()=>{if(referenceFinished.witness?.valid!==true)throw Error('REFERENCE_WITNESS_INVALID');
      if(snapshotHash(referenceBefore)!==snapshotHash(referenceAfter))throw Error('REFERENCE_INPUT_CHANGED');});
    const identity=identityFields(sourceLock,dataset,result.fixtureSha256,snapshotHash(referenceAfter),referenceChild.ready);
    reference={schema:'r116-frozen-reference-v1',origin:'separate-observed-baseline-instance-diagnostic-only',instanceId:'reference-'+randomUUID(),
      ...identity,scope:{...scope,filter:'all',revision:referenceAfter.revision},...bodyRecord(refResponse.text),initialMapReference:referenceMap};
    result.referenceBodySha256=reference.bodySha256;result.calculatorBytesSha256=identity.calculatorBytesSha256;result.staticEnvelopeSha256=identity.staticEnvelopeSha256;
    emit('reference-result',{referenceBodySha256:reference.bodySha256,calculatorBytesSha256:identity.calculatorBytesSha256,totalRows:refBody.rows.length});
    referenceClosed=await at('reference-child-close',()=>referenceChild.close());check();
    const referenceClosure=validateClosedWitness(referenceClosed.final,referenceToken,reference.calculatorBytesSha256,fullStateHash(referenceBefore));
    referenceChild.recordCloseWitness(referenceClosure.code);result.referenceCloseDiagnostic=referenceChild.closeDiagnostic();
    result.closePhaseDiagnostic=referenceChild.closePhaseDiagnostic();
    await at('reference-child-close',()=>{if(!referenceClosed.graceful||referenceClosed.exit?.code!==0||!referenceClosure.valid)throw Error('REFERENCE_CLOSE_INCOMPLETE');});
    referenceChild=null;
    emit('reference-close');
    // Deliberate diagnostic-only endpoint. No measured UI/RTT lane can run.
    throw OBSERVATION_COMPLETE;
    const measuredRoot=path.join(owned,'measured'),measuredStore=path.join(measuredRoot,'store');await at('measured-root-create',()=>fs.mkdir(measuredRoot,{recursive:true}));
    await at('measured-store-copy',()=>fs.cp(referenceStore,measuredStore,{recursive:true,errorOnExist:true,force:false}));
    // Prelaunch the browser before the measured server so browser startup does
    // not add a favorable provider-warmup wait to the immediate control.
    emit('measured-start',{methodPhase:'browser-prelaunch'});
    const chromium=await at('measured-playwright-load',()=>loadChromium(options,result));
    launching=tracker.at('measured-browser-launch',()=>chromium.launch({headless:true,timeout:30000,args:['--no-sandbox','--disable-background-networking'],
      env:{...process.env,XDG_CONFIG_HOME:path.join(owned,'xdg-config'),XDG_CACHE_HOME:path.join(owned,'xdg-cache')}}));
    launching.then(value=>{browser=value;if(forced)void value.close().catch(()=>{});},()=>{});
    browser=await at('measured-browser-launch',()=>launching);
    await at('measured-browser-version',()=>{result.chromiumVersion=browser.version();if(result.chromiumVersion!==options['expected-chromium'])throw Error('CHROMIUM_VERSION_MISMATCH');});
    emit('measured-start');measuredChild=await at('measured-child-start',()=>childHandle(childArgs(measuredRoot,measuredStore,lockFile,false),(phase,fields={})=>emit('measured-start',{methodPhase:phase,...fields})));
    await at('measured-child-ready',()=>measuredChild.waitReady());check();emit('measured-ready');
    await at('measured-source-identity',()=>{if(measuredChild.ready.identity?.sourceCommit!==sourceLock.sourceCommit||measuredChild.ready.identity?.manifestSha256!==sourceLock.manifestSha256)
      throw Error('MEASURED_SOURCE_IDENTITY_CHANGED');});
    await at('measured-store-copy-identity',()=>{if(measuredChild.ready.initialDiskState?.sha256!==referenceClosed.final.closedStore.stateFile.sha256||
       measuredChild.ready.initialDiskState?.bytes!==referenceClosed.final.closedStore.stateFile.bytes)throw Error('CLOSED_REFERENCE_STORE_COPY_MISMATCH');});
    const measuredDataset=datasetFrom(measuredChild.ready);
    await at('measured-dataset-identity',()=>{if(measuredDataset.digest!==dataset.digest)throw Error('MEASURED_DATASET_CHANGED');});
    relay=relayFor(measuredChild.origin);const origin=await at('relay-start',()=>relay.start());
    context=await at('measured-context-create',()=>browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}));
    await at('measured-adapter-install',()=>context.addInitScript(installAdapter,{group:false,memberId:scope.memberId}));
    const page=measuredPage=await at('measured-page-create',()=>context.newPage());
    page.on('pageerror',error=>{measuredPageErrorCount++;tracker.recordCallback('measured-page-error',error);});
    const mainNetwork=await at('measured-network-ledger',()=>networkLedger(context,page,'main'));
    let interval=false;const writes=[],requestIndex=new WeakMap();
    context.on('request',request=>{
      if(!interval||['GET','HEAD','OPTIONS'].includes(request.method()))return;
      const record={id:writes.length,method:request.method(),path:sanitizePath(request.url()),bodyKeys:[],status:null};
      if(record.path==='/api/action-session'){try{record.bodyKeys=Object.keys(request.postDataJSON()??{}).sort();}catch{}}
      writes.push(record);requestIndex.set(request,record);
    });
    context.on('response',response=>{const record=requestIndex.get(response.request());if(record)record.status=response.status();});
    await at('measured-origin-route-install',()=>context.route('**/*',route=>tracker.callback('measured-origin-route-install',async()=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin){await route.abort('blockedbyclient');return;}await route.fallback();})));
    let mainInstrumentations=0;
    await at('measured-main-route-install',()=>page.route('**/main.mjs',route=>tracker.callback('measured-main-route-install',async()=>{
      const response=await tracker.at('measured-main-fetch',()=>route.fetch()),original=await tracker.at('measured-main-read',()=>response.text());
      const served=await tracker.at('measured-main-instrument',()=>{if(sha(original)!==sourceLock.files.find(file=>file.path==='app/web/main.mjs')?.sha256)throw Error('MAIN_SOURCE_MISMATCH');
        const served=instrumentMainSource(original);mainInstrumentations++;result.mainOriginalSha256=sha(original);result.mainInstrumentedSha256=sha(served);return served;});
      await tracker.at('measured-main-fulfill',()=>route.fulfill({response,body:served}));
    })));
    const invite=new URL(measuredChild.joinUrl);invite.host=new URL(origin).host;
    await at('measured-navigation',()=>page.goto(invite.href,{waitUntil:'domcontentloaded',timeout:60000}));
    await at('measured-context-wait',()=>until(()=>page.evaluate(()=>!!window.__r116Snap?.()?.memberId),60000,'BROWSER_CONTEXT_TIMEOUT'));
    await at('measured-instrumentation-count',()=>{if(mainInstrumentations!==1)throw Error('MAIN_INSTRUMENTATION_COUNT');});
    emit('browser-ready');
    const auth=authFor(measuredChild.joinUrl);
    const overlayResponse=await at('overlay-create',()=>httpText(origin+'/api/overlays',auth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({widget:'count',player:'duo',variant:'compact',size:'small'})}));
    const overlayValue=await at('overlay-response-parse',()=>JSON.parse(overlayResponse.text)),overlayUrl=new URL(overlayValue.link);overlayUrl.host=new URL(origin).host;
    const overlay=await at('overlay-page-create',()=>context.newPage());const overlayNetwork=await at('overlay-network-ledger',()=>networkLedger(context,overlay,'overlay'));
    const overlayNavigation=await at('overlay-navigation',()=>overlay.goto(overlayUrl.href,{waitUntil:'domcontentloaded',timeout:30000}));
    await at('overlay-navigation',()=>{if(!overlayNavigation?.ok())throw Error('OVERLAY_NAVIGATION_FAILED');});
    await at('overlay-content-wait',()=>overlay.locator('#overlay .overlay-count').waitFor({state:'visible',timeout:30000}));
    const overlayContent=await at('overlay-content-read',()=>overlay.locator('#overlay .overlay-count').textContent());
    await at('overlay-content-verify',()=>{if(!/^\d[\d,]* \/ \d[\d,]*$/.test(overlayContent??''))throw Error('OVERLAY_WIDGET_CONTENT_MISSING');});
    emit('overlay-ready');
    await at('measured-page-foreground',()=>page.bringToFront());await at('measured-open-chunk',()=>page.evaluate(id=>window.__r116OpenChunk(id),scope.chunkId));
    const token=measuredToken='all-'+randomUUID();
    const begun=await at('measured-witness-begin',()=>measuredChild.rpc('begin',{token}));
    const beforeSnapshot=snapshotFrom(await at('measured-snapshot-before',()=>measuredChild.rpc('snapshot',{phase:'before'})));
    await at('measured-input-verify',()=>{if(snapshotHash(beforeSnapshot)!==reference.calculatorBytesSha256)throw Error('MEASURED_INPUT_DIFFERS_FROM_REFERENCE');});
    interval=true;emit('episode-start',{methodPhase:'before-snapshot',calculatorBytesSha256:snapshotHash(beforeSnapshot),fullStateSha256:fullStateHash(beforeSnapshot),revision:beforeSnapshot.revision});result.metrics.episodeStartNodeMs=now();
    const openingToken='opening-'+randomUUID();
    await at('opening-arm',()=>page.evaluate(payload=>window.__r116ArmOpening(payload),{token:openingToken,scope:reference.scope,expectedByFilter}));
    const tasksDispatch=await at('opening-tasks-click',()=>nativeClick(page,page.locator('#chunk-content button[data-tab="tasks"][role="tab"]')));
    result.metrics.tasksPlannedNodeMs=tasksDispatch.plannedNode;result.metrics.tasksReturnedNodeMs=tasksDispatch.returnedNode;
    await at('opening-section-ready-wait',()=>until(()=>page.evaluate(selectedTasksSectionReady),60000,'OPENING_SECTION_READY_TIMEOUT'));
    const openingTransition=await at('opening-transition-wait',()=>until(()=>page.evaluate(value=>{const t=window.__r116Transition(value);return t?.status==='correct'||t?.status==='blocked'?t:null;},openingToken),60000,'OPENING_TRANSITION_TIMEOUT'));
    result.metrics.openingObservedNodeMs=now();
    emit('episode-start',{methodPhase:'opening-dom-observed',observationStatus:openingTransition.status});
    const expected=await at('all-expectation-build',()=>{const expected=buildExpected(refBody);if(!expected.rows.length)throw Error('REFERENCE_EMPTY');return expected;});
    const contrastLabel=expected.contrasting==='blocked'?'Blocked':'Doable';
    const contrast=page.locator('#chunk-content .filter-chip').filter({hasText:new RegExp('^'+contrastLabel+' \\d+$')});
    await at('contrast-wait',()=>contrast.waitFor({state:'visible',timeout:60000}));await at('contrast-click',()=>nativeClick(page,contrast));
    const beforeAllSnapshot=snapshotFrom(await at('measured-snapshot-before-all',()=>measuredChild.rpc('snapshot',{phase:'before-all'})));
    emit('episode-start',{methodPhase:'before-all-snapshot',calculatorBytesSha256:snapshotHash(beforeAllSnapshot),fullStateSha256:fullStateHash(beforeAllSnapshot),revision:beforeAllSnapshot.revision});
    const current=normalizeView(await at('native-view-read',()=>page.evaluate(()=>window.__r116Snap())));
    await at('native-scope-verify',()=>{if(current.memberId!==scope.memberId||current.nativeMemberValue!==scope.memberId||String(current.chunkId)!==scope.chunkId||current.group!==false)throw Error('NATIVE_SCOPE_MISMATCH');});
    const arm=await at('all-arm',async()=>{const arm=await page.evaluate(payload=>window.__r116ArmAll(payload),{token,scope:reference.scope,expected});if(arm?.status==='blocked')throw Error('ALL_ARM_BLOCKED');return arm;});
    const all=page.locator('#chunk-content .filter-chip').filter({hasText:new RegExp('^All '+refBody.rows.length+'$')});
    const allDispatch=await at('all-click',()=>nativeClick(page,all));
    result.metrics.allPlannedNodeMs=allDispatch.plannedNode;result.metrics.allReturnedNodeMs=allDispatch.returnedNode;
    const transition=await at('all-transition-wait',()=>until(()=>page.evaluate(value=>{const t=window.__r116Transition(value);return t?.status==='correct'||t?.status==='blocked'?t:null;},token),60000,'ALL_TRANSITION_TIMEOUT'));
    result.metrics.episodeEndNodeMs=now();emit('episode-end');
    const afterFramesSnapshot=snapshotFrom(await at('measured-snapshot-after-frames',()=>measuredChild.rpc('snapshot',{phase:'after-frames'})));
    emit('episode-end',{methodPhase:'after-frames-snapshot',calculatorBytesSha256:snapshotHash(afterFramesSnapshot),fullStateSha256:fullStateHash(afterFramesSnapshot),revision:afterFramesSnapshot.revision});
    const finished=await at('measured-witness-finish',()=>measuredChild.rpc('finish',{token}));interval=false;
    fullCapture=await at('measured-capture-read',()=>page.evaluate(()=>window.__r116Read({includeBodies:true})));
    const overlayCapture=await at('overlay-capture-read',()=>overlay.evaluate(()=>window.__r116Read?.({includeBodies:false})??null));
    const body=choosePlanningBody(fullCapture.bodies??[],scope,normalizeView(transition.dom)?.at??Infinity);
    const response=body?bodyRecord(body.bodyText,{consumedAt:body.consumedAt,parsedAt:body.parsedAt}):null;
    const openingBody=choosePlanningBody(fullCapture.bodies??[],scope,normalizeView(openingTransition.dom)?.at??-Infinity);
    const openingResponse=openingBody?bodyRecord(openingBody.bodyText,{consumedAt:openingBody.consumedAt,parsedAt:openingBody.parsedAt}):null;
    if(response)result.observedBodySha256=response.bodySha256;
    if(openingResponse)result.openingObservedBodySha256=openingResponse.bodySha256;
    const journal=finished.journal??finished.witness?.journal;
    const measuredIdentity=identityFields(sourceLock,measuredDataset,result.fixtureSha256,snapshotHash(beforeSnapshot),measuredChild.ready);
    const classified=classifyObservedWrites(writes);
    inputWitness={schema:'r116-frozen-witness-v1',instanceId:'measured-'+randomUUID(),...measuredIdentity,
      ownership:{isolatedSave:true,writerLeaseHeld:measuredChild.ready.owner?.sameProcess===true&&measuredChild.ready.owner?.present===true,
        sourceVerified:true,noOtherWriter:true},journal,
      snapshots:[witnessSnapshot(beforeSnapshot,'before'),witnessSnapshot(beforeAllSnapshot,'before-all'),witnessSnapshot(afterFramesSnapshot,'after-frames')],
      ...classified,beginToken:token,endToken:token,beginAcknowledgedBeforeDispatch:true,endRequestedAfterFrames:true,
      openingToken,beginAcknowledgedBeforeOpening:true};
    const dom=normalizeView(transition.dom),before=normalizeView(transition.before),frames=(transition.frames??[]).map(normalizeView);
    const native=transition.native;
    const frozen=await at('projection-audits',()=>auditFrozenPlanning({reference,response,witness:inputWitness,native,before,dom,frames}));
    const opening=await at('projection-audits',()=>auditOpeningProjection({reference,response:openingResponse,witness:inputWitness,expectedByFilter,
      transition:{...openingTransition,dom:normalizeView(openingTransition.dom),frames:(openingTransition.frames??[]).map(normalizeView)}}));
    const strictRequest={memberId:scope.memberId,revision:reference.scope.revision,chunkId:scope.chunkId,group:false,
      inputKey:null,generation:native?.token,nativeValue:native?.label,peerIds:['explorer-2']};
    const strict=await at('projection-audits',()=>auditPlanning({request:strictRequest,native:{trusted:native?.trusted,value:native?.label,generation:native?.token,at:native?.capturedAt},responses:[],dom}));
    result.strictR79Status=strict.status;result.strictR79Code=strict.code;result.frozenStatus=frozen.status;result.frozenCode=frozen.code;
    result.projectionStatus=frozen.status;result.projectionCode=frozen.code;
    result.openingStatus=opening.status;result.openingCode=opening.code;
    result.openingProjectionStatus=opening.status;result.openingProjectionCode=opening.code;
    result.status=frozen.status;result.code=frozen.code;
    if(opening.status!=='correct'){result.status=opening.status;result.code=opening.code;}
    result.metrics.totalRows=frozen.total??refBody.rows.length;result.metrics.shownRows=frozen.shown??0;
    result.metrics.episodeToObservedCompleteNodeMs=result.metrics.episodeEndNodeMs-result.metrics.episodeStartNodeMs;
    if(frozen.trustedCaptureToCorrectDOMMs!=null)result.metrics.trustedCaptureToCorrectDOMMs=frozen.trustedCaptureToCorrectDOMMs;
    if(frozen.trustedCaptureToLaterFrameOpportunityMs!=null)result.metrics.trustedCaptureToLaterFrameOpportunityMs=frozen.trustedCaptureToLaterFrameOpportunityMs;
    for(const field of ['tasksCaptureToCorrectDOMMs','tasksCaptureToLaterFrameOpportunityMs','expansionCaptureToCorrectDOMMs','expansionCaptureToLaterFrameOpportunityMs'])
      if(opening[field]!=null)result.metrics[field]=opening[field];
    await at('evidence-write',()=>fs.writeFile(path.join(options.scratch,'r116-public-task-evidence.json'),JSON.stringify({reference,response,openingResponse,witness:inputWitness,openingTransition,opening,expectedByFilter,transition,strict,frozen,
      browser:fullCapture,overlay:overlayCapture,network:{main:mainNetwork,overlay:overlayNetwork},
      overlayWitness:{httpStatus:overlayNavigation.status(),widget:'count',countText:overlayContent}},null,2)));
    emit('calibration-start');const rtt={direct:[],bridge:[]};
    for(const [base,key] of [[measuredChild.origin,'direct'],[origin,'bridge']])for(let i=0;i<5;i++){
      const started=now();await at('calibration-fetch',()=>httpText(base+'/api/health'));rtt[key].push(now()-started);
    }
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    result.metrics.totalRttMedianMs=median(rtt.bridge);result.metrics.directRttMedianMs=median(rtt.direct);
    result.rttStatus=Math.abs(result.metrics.totalRttMedianMs-40)<=2?'within-band':'outside-band';
    if(result.rttStatus==='outside-band'&&result.status==='correct'){result.status='calibration-blocked';result.code='total-rtt-outside-band';}
    emit('calibration-end',{rttStatus:result.rttStatus});
  }catch(error){
    if(error===OBSERVATION_COMPLETE){result.status='blocked';result.code='r116-close-observation-complete';}
    else{
    result.code=codeOf(error);result.status=result.code.includes('input')||result.code.includes('reference')||result.code.includes('opening')?'blocked':'failed';
    Object.assign(result,tracker.diagnostic(error));
    if(tracker.callbackFailure)result.callbackFailure=tracker.callbackFailure;
    if(result.code.includes('opening')){result.openingStatus='blocked';result.openingCode=result.code;}
    emit('error',{code:result.code,failureOperation:result.failureOperation,errorName:result.errorName,errorCode:result.errorCode,errorStackSha256:result.errorStackSha256,...(result.callbackFailure?{callbackFailure:result.callbackFailure}:{})});
    // Diagnostic only, after failure and outside every timing interval. No retry,
    // DOM text/labels/URLs, extra native actions, or weakening of a failed gate.
    result.diagnosticMetrics=await capabilitySurvey(measuredPage??referencePage,measuredPage?measuredPageErrorCount:referencePageErrorCount);
    emit('error',{methodPhase:'post-failure-capability-survey',diagnosticMetrics:result.diagnosticMetrics});
    }
  }
  finally{
    emit('cleanup-start');let clean=true;
    const cleanupFailed=error=>{clean=false;if(!result.failureOperation){Object.assign(result,tracker.diagnostic(error));result.code=codeOf(error);}};
    try{await tracker.at('controller-cleanup',async()=>{if(referenceLaunching&&!referenceBrowser)referenceBrowser=await bounded(referenceLaunching,35000,'REFERENCE_BROWSER_LAUNCH_DRAIN_TIMEOUT');
      await bounded(referenceBrowser?.close()??Promise.resolve(),15000,'REFERENCE_BROWSER_CLOSE_TIMEOUT');});}catch(error){cleanupFailed(error);}
    try{await tracker.at('controller-cleanup',async()=>{if(launching&&!browser)browser=await bounded(launching,35000,'BROWSER_LAUNCH_DRAIN_TIMEOUT');await bounded(browser?.close()??Promise.resolve(),15000,'BROWSER_CLOSE_TIMEOUT');});}catch(error){cleanupFailed(error);}
    try{await tracker.at('controller-cleanup',()=>relay?.close());}catch(error){cleanupFailed(error);}
    try{await tracker.at('controller-cleanup',async()=>{if(referenceChild){referenceClosed=await referenceChild.close();if(!referenceClosed.graceful||referenceClosed.exit?.code!==0||referenceClosed.final?.closeCompleted!==true)clean=false;}});}catch(error){cleanupFailed(error);}
    try{await tracker.at('controller-cleanup',async()=>{if(measuredChild){measuredClosed=await measuredChild.close();if(!measuredClosed.graceful||measuredClosed.exit?.code!==0||measuredClosed.final?.closeCompleted!==true)clean=false;}});}catch(error){cleanupFailed(error);}
    if(referenceChild){result.referenceCloseDiagnostic=referenceChild.closeDiagnostic();result.closePhaseDiagnostic=referenceChild.closePhaseDiagnostic();}
    if(measuredChild)result.measuredCloseDiagnostic=measuredChild.closeDiagnostic();
    // Stop/drain is part of the witness: a delayed store commit cannot be ignored.
    if(inputWitness){
      const closure=validateClosedWitness(measuredClosed?.final,measuredToken,inputWitness.calculatorBytesSha256,inputWitness.snapshots[0].fullStateSha256);
      measuredChild?.recordCloseWitness(closure.code);if(measuredChild)result.measuredCloseDiagnostic=measuredChild.closeDiagnostic();
      if(!closure.valid){result.status='blocked';if(!result.failureOperation)result.code=closure.code;result.frozenStatus='blocked';result.frozenCode=closure.code;
        if(result.openingStatus!=='unrun'){result.openingStatus='blocked';result.openingCode=closure.code;}}
    }
    result.cleanupStatus=clean?'complete':'incomplete';
    if(!clean)applyCleanupFailure(result);
    const finalProof={schema:'r116-final-input-proof-v1',sourceManifestSha256:result.sourceManifestSha256,fixtureSha256:result.fixtureSha256,
      datasetDigest:result.datasetDigest,calculatorBytesSha256:result.calculatorBytesSha256,
      reference:publicCloseProof(referenceClosed),measured:publicCloseProof(measuredClosed)};
    const finalProofText=JSON.stringify(finalProof,null,2)+'\n';result.finalProofSha256=sha(finalProofText);
    await tracker.at('final-proof-write',()=>fs.writeFile(path.join(options.scratch,'r116-final-proof.json'),finalProofText));
    // Never publish or retain authored stores, invite/cookie material or private keys.
    if(clean){try{await tracker.at('scratch-cleanup',async()=>{ownedPath(options.scratch,owned);await fs.rm(owned,{recursive:true,force:true});});}catch(error){if(!result.failureOperation){Object.assign(result,tracker.diagnostic(error));result.code='scratch-cleanup-incomplete';}result.cleanupStatus='incomplete';result.status='failed';}}
    clearTimeout(deadlineTimer);process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);
    emit('cleanup-end',{cleanupStatus:result.cleanupStatus});await tracker.at('result-write',()=>fs.writeFile(options.out,JSON.stringify(result,null,2)+'\n'));
    emit('result',{status:result.status,code:result.code});emit.close();
  }
  process.stdout.write(JSON.stringify({status:result.status,code:result.code})+'\n');
  return result.status==='failed'?1:0;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const tracker=createFailureTracker(FAILURE_OPERATIONS);
  main(process.argv.slice(2),tracker).then(code=>{process.exitCode=code;},error=>{
    // Entry/final-write failures still produce the raw FD3 enum protocol. Forked
    // app children keep FD3 for IPC and never receive PERF_STAGE_FD.
    if(process.env.PERF_STAGE_FD==='3')for(const stage of ['error','result']){try{writeSync(3,JSON.stringify({stage})+'\n');}catch{}}
    process.stderr.write(JSON.stringify({status:'failed',code:codeOf(error),...tracker.diagnostic(error)})+'\n');process.exitCode=1;
  });
}
