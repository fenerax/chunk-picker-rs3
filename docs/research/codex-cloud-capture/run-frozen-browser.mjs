// One public fixed-input case. Importing this module never starts an application.
import fs from 'node:fs/promises';
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

const HERE=path.dirname(fileURLToPath(import.meta.url));
const now=()=>performance.now();
const codeOf=error=>{
  const message=String(error?.message??'');
  if(/^HTTP_\d{3}$/.test(message))return 'http-error';
  // App/browser exception text is never a public error code.
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(message)?message.toLowerCase().replaceAll('_','-'):'runtime-error';
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
  const environment={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','PERF_STAGE_FD'])delete environment[key];
  const child=fork(path.join(HERE,'server-driver.mjs'),args,{stdio:['ignore','ignore','pipe','ipc'],
    env:environment,execArgv:['--max-old-space-size=2048']});
  child.stderr.resume();
  const pending=new Map();let nextId=0,ready,joinUrl,origin,exit,stopped,failure;
  child.on('message',message=>{
    if(message.type==='checkpoint')onCheckpoint(message.phase??message.stage);
    if(message.type==='commit')onCheckpoint('store-commit-observed',{revision:message.entry?.revision??null,
      calculatorBytesSha256:message.entry?.snapshot?.calculation?.sha256??null,fullStateSha256:message.entry?.snapshot?.fullState?.sha256??null});
    if(message.type==='early')origin=message.origin;
    if(message.type==='ready'){ready=message;origin=message.origin??origin;}
    if(message.type==='private-invite')joinUrl=message.joinUrl;
    if(message.type==='reply'||message.type==='stopped'){
      const item=pending.get(message.id);if(item){pending.delete(message.id);message.ok===false?item.reject(Error(message.error?.code??message.code??'CHILD_RPC_FAILED')):item.resolve(message.result??message);}
    }
    if(['error','startup-failed','driver-failed','command-failed'].includes(message.type)){failure=message.error?.code??message.code??'CHILD_FAILED';for(const item of pending.values())item.reject(Error(failure));pending.clear();}
    if(message.type==='stopped')stopped=message;
  });
  const exitPromise=new Promise(resolve=>child.once('exit',(code,signal)=>{exit={code,signal};for(const item of pending.values())item.reject(Error('CHILD_EXITED'));pending.clear();resolve(exit);}));
  child.once('error',()=>{exit={code:null,signal:null,error:'spawn-failed'};});
  return {child,get ready(){return ready;},get origin(){return origin;},get joinUrl(){return joinUrl;},get exit(){return exit;},get stopped(){return stopped;},
    async waitReady(){await until(()=>{if(failure)throw Error(failure);if(exit)throw Error('CHILD_STARTUP_EXIT');return ready&&joinUrl&&origin;},90000,'CHILD_READY_TIMEOUT');return ready;},
    rpc(command,extra={},ms=15000){const id=++nextId;return bounded(new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.send({id,command,...extra},error=>{if(error){pending.delete(id);reject(Error('CHILD_IPC_SEND_FAILED'));}});}),ms,'CHILD_RPC_TIMEOUT');},
    async close(){
      let result=null,graceful=true;
      if(!exit){try{result=await this.rpc('stop',{},15000);}catch{graceful=false;}}
      if(!exit){try{await bounded(exitPromise,2000,'CHILD_CLOSE_TIMEOUT');}catch{graceful=false;child.kill('SIGKILL');await bounded(exitPromise,3000,'CHILD_KILL_TIMEOUT');}}
      return {graceful,exit,final:result??stopped};
    }};
}
function datasetFrom(ready){const value=ready.identity?.dataset??ready.dataset??ready.identity??{};return {id:value.datasetId??value.id??'duo-legacy',digest:value.digest??ready.identity?.datasetDigest??ready.datasetDigest};}
function snapshotFrom(reply){return reply.snapshot??reply;}
function identityFields(sourceLock,dataset,fixtureHash,calculatorHash,ready){
  const staticEnvelope={datasetId:dataset.id,datasetDigest:dataset.digest,publicOnly:true,
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
export async function main(argv=process.argv.slice(2)){
  const options=parseArgs(argv);await fs.mkdir(options.scratch,{recursive:true});
  await fs.mkdir(path.dirname(options.out),{recursive:true});
  const owned=await fs.mkdtemp(path.join(options.scratch,'r116-owned-'));
  const emit=checkpoints(path.join(options.scratch,'r116-checkpoints.jsonl'));
  const scope={memberId:options.member,chunkId:options.chunk,group:false,startup:options.startup};
  const result={schema:'r116-frozen-browser-v1',mode:'r116-frozen-input-v1',status:'failed',code:'incomplete',scope,
    sourcePin:options['expected-source-pin'],openGates:[...OPEN_GATES],cleanupStatus:'incomplete',rttStatus:'unobserved',
    strictR79Status:'blocked',strictR79Code:'not-observed',frozenStatus:'blocked',frozenCode:'not-observed',openingStatus:'unrun',openingCode:'not-observed',
    nodeVersion:process.version,metrics:{},limitations:['new-linux-chromium151-baseline','no-physical-windows-or-paint-proof','docker-hard-resource-envelope-required']};
  let referenceChild,measuredChild,browser,referenceBrowser,context,relay,referenceClosed,measuredClosed;
  let inputWitness,reference,fullCapture,deadlineTimer,forced=false,referenceToken,measuredToken,launching,referenceLaunching;
  let cancel;
  const deadline=new Promise((_,reject)=>{cancel=reject;deadlineTimer=setTimeout(()=>{forced=true;reject(Error('CONTROLLER_DEADLINE'));},480000);});
  const limited=promise=>Promise.race([promise,deadline]);
  const signal=()=>{forced=true;cancel(Error('CONTROLLER_SIGNAL'));};process.once('SIGTERM',signal);process.once('SIGINT',signal);
  const check=()=>{if(forced)throw Error('CONTROLLER_SIGNAL');};
  const childArgs=(arm,store,lockFile,initial)=>['--source',options.source,'--scratch',arm,'--store',store,
    '--fixture',path.join(HERE,'fixture.json'),'--source-commit',options['expected-source-pin'],
    '--source-lock',lockFile,'--source-manifest-sha256',result.sourceManifestSha256,...(initial?['--initial']:[])];
  try{
    emit('start');if(process.version!=='v24.19.0')throw Error('NODE_VERSION_MISMATCH');
    result.harnessManifestSha256=await verifyHarness(HERE);
    const fixtureBytes=await fs.readFile(path.join(HERE,'fixture.json'));result.fixtureSha256=sha(fixtureBytes);
    if(result.fixtureSha256!==FIXTURE_SHA)throw Error('FIXTURE_HASH_MISMATCH');
    const sourceLock=await verifySource(options.source,options['expected-source-pin'],options['source-lock']);
    result.sourceManifestSha256=sourceLock.manifestSha256;
    const lockFile=path.join(owned,'source-lock.json');await fs.writeFile(lockFile,JSON.stringify(sourceLock));
    emit('reference-start',{sourcePin:result.sourcePin,sourceManifestSha256:result.sourceManifestSha256,fixtureSha256:result.fixtureSha256});
    const referenceRoot=path.join(owned,'reference'),referenceStore=path.join(referenceRoot,'store');
    await fs.mkdir(referenceRoot,{recursive:true});
    referenceChild=childHandle(childArgs(referenceRoot,referenceStore,lockFile,true),(phase,fields={})=>emit('reference-start',{methodPhase:phase,...fields}));
    await limited(referenceChild.waitReady());check();emit('reference-ready');
    referenceToken='reference-'+randomUUID();await limited(referenceChild.rpc('begin',{token:referenceToken}));
    const referenceBefore=snapshotFrom(await limited(referenceChild.rpc('snapshot',{phase:'before'})));
    emit('reference-ready',{methodPhase:'input-snapshot',calculatorBytesSha256:snapshotHash(referenceBefore),fullStateSha256:fullStateHash(referenceBefore),revision:referenceBefore.revision});
    const dataset=datasetFrom(referenceChild.ready);
    if(dataset.id!=='duo-legacy'||!/^[a-f0-9]{64}$/.test(dataset.digest??''))throw Error('DATASET_IDENTITY_MISSING');
    result.datasetDigest=dataset.digest;
    const refAuth=authFor(referenceChild.joinUrl);
    const endpoint=`/api/chunk-planning?memberId=${encodeURIComponent(scope.memberId)}&chunkId=${encodeURIComponent(scope.chunkId)}`;
    const refResponse=await limited(httpText(referenceChild.origin+endpoint,refAuth));
    const refBody=JSON.parse(refResponse.text);
    if(refBody.format!=='chunk-planning-v1'||refBody.memberId!==scope.memberId||String(refBody.chunkId)!==scope.chunkId||!Array.isArray(refBody.rows))throw Error('REFERENCE_SCOPE_INVALID');
    // Reference-only UI setup supplies the map subset from the unchanged
    // baseline's own count pass, independently of the measured browser.
    const referenceChromium=await loadChromium(options,result);
    referenceLaunching=referenceChromium.launch({headless:true,timeout:30000,args:['--no-sandbox','--disable-background-networking'],
      env:{...process.env,XDG_CONFIG_HOME:path.join(owned,'reference-xdg-config'),XDG_CACHE_HOME:path.join(owned,'reference-xdg-cache')}});
    referenceLaunching.then(value=>{referenceBrowser=value;if(forced)void value.close().catch(()=>{});},()=>{});
    referenceBrowser=await limited(referenceLaunching);
    if(referenceBrowser.version()!==options['expected-chromium'])throw Error('REFERENCE_CHROMIUM_VERSION_MISMATCH');
    const refContext=await limited(referenceBrowser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}));
    await limited(refContext.addInitScript(installAdapter,{group:false,memberId:scope.memberId}));
    await limited(refContext.route('**/*',async route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==referenceChild.origin){await route.abort('blockedbyclient');return;}await route.fallback();}));
    const refPage=await limited(refContext.newPage());
    await limited(refPage.route('**/main.mjs',async route=>{const response=await route.fetch(),original=await response.text();
      if(sha(original)!==sourceLock.files.find(file=>file.path==='app/web/main.mjs')?.sha256)throw Error('REFERENCE_MAIN_SOURCE_MISMATCH');
      result.referenceMainOriginalSha256=sha(original);const served=instrumentMainSource(original);result.referenceMainInstrumentedSha256=sha(served);
      await route.fulfill({response,body:served});}));
    await limited(refPage.goto(referenceChild.joinUrl,{waitUntil:'domcontentloaded',timeout:60000}));
    await limited(until(()=>refPage.evaluate(()=>!!window.__r116Snap?.()?.memberId),60000,'REFERENCE_BROWSER_CONTEXT_TIMEOUT'));
    await limited(refPage.evaluate(id=>window.__r116OpenChunk(id),scope.chunkId));
    await limited(nativeClick(refPage,refPage.locator('#chunk-content button[data-tab="tasks"][role="tab"]')));
    const refSummary=refPage.locator('#chunk-content summary').filter({hasText:'Possible Tasks'});
    await limited(refSummary.waitFor({state:'visible',timeout:60000}));
    if(!await limited(refSummary.evaluate(node=>node.parentElement.open)))await limited(nativeClick(refPage,refSummary));
    await limited(refPage.locator('#chunk-content .filter-chip').filter({hasText:/^All \d+$/}).waitFor({state:'visible',timeout:60000}));
    const referenceMap=await limited(refPage.evaluate(id=>window.__r116MapTaskIds(id),scope.chunkId));
    if(referenceMap.memberId!==scope.memberId||String(referenceMap.chunkId)!==scope.chunkId||referenceMap.group!==false||!Array.isArray(referenceMap.taskIds))throw Error('REFERENCE_MAP_SCOPE_INVALID');
    const expectedByFilter=initialExpectations(refBody,referenceMap.taskIds);
    result.referenceInitialProjectionSha256=sha(JSON.stringify(expectedByFilter));
    await bounded(referenceBrowser.close(),15000,'REFERENCE_BROWSER_CLOSE_TIMEOUT');referenceBrowser=null;referenceLaunching=null;
    const referenceAfter=snapshotFrom(await limited(referenceChild.rpc('snapshot',{phase:'before-all'})));
    await limited(referenceChild.rpc('snapshot',{phase:'after-frames'}));
    const referenceFinished=await limited(referenceChild.rpc('finish',{token:referenceToken}));
    if(referenceFinished.witness?.valid!==true)throw Error('REFERENCE_WITNESS_INVALID');
    if(snapshotHash(referenceBefore)!==snapshotHash(referenceAfter))throw Error('REFERENCE_INPUT_CHANGED');
    const identity=identityFields(sourceLock,dataset,result.fixtureSha256,snapshotHash(referenceAfter),referenceChild.ready);
    reference={schema:'r116-frozen-reference-v1',origin:'separate-untouched-baseline-instance',instanceId:'reference-'+randomUUID(),
      ...identity,scope:{...scope,filter:'all',revision:referenceAfter.revision},...bodyRecord(refResponse.text),initialMapReference:referenceMap};
    result.referenceBodySha256=reference.bodySha256;result.calculatorBytesSha256=identity.calculatorBytesSha256;result.staticEnvelopeSha256=identity.staticEnvelopeSha256;
    emit('reference-result',{referenceBodySha256:reference.bodySha256,calculatorBytesSha256:identity.calculatorBytesSha256,totalRows:refBody.rows.length});
    referenceClosed=await limited(referenceChild.close());check();
    const referenceClosure=validateClosedWitness(referenceClosed.final,referenceToken,reference.calculatorBytesSha256,fullStateHash(referenceBefore));
    if(!referenceClosed.graceful||referenceClosed.exit?.code!==0||!referenceClosure.valid)throw Error('REFERENCE_CLOSE_INCOMPLETE');
    referenceChild=null;
    emit('reference-close');
    const measuredRoot=path.join(owned,'measured'),measuredStore=path.join(measuredRoot,'store');await fs.mkdir(measuredRoot,{recursive:true});
    await fs.cp(referenceStore,measuredStore,{recursive:true,errorOnExist:true,force:false});
    // Prelaunch the browser before the measured server so browser startup does
    // not add a favorable provider-warmup wait to the immediate control.
    emit('measured-start',{methodPhase:'browser-prelaunch'});
    const chromium=await loadChromium(options,result);
    launching=chromium.launch({headless:true,timeout:30000,args:['--no-sandbox','--disable-background-networking'],
      env:{...process.env,XDG_CONFIG_HOME:path.join(owned,'xdg-config'),XDG_CACHE_HOME:path.join(owned,'xdg-cache')}});
    launching.then(value=>{browser=value;if(forced)void value.close().catch(()=>{});},()=>{});
    browser=await limited(launching);
    result.chromiumVersion=browser.version();if(result.chromiumVersion!==options['expected-chromium'])throw Error('CHROMIUM_VERSION_MISMATCH');
    emit('measured-start');measuredChild=childHandle(childArgs(measuredRoot,measuredStore,lockFile,false),(phase,fields={})=>emit('measured-start',{methodPhase:phase,...fields}));
    await limited(measuredChild.waitReady());check();emit('measured-ready');
    if(measuredChild.ready.identity?.sourceCommit!==sourceLock.sourceCommit||measuredChild.ready.identity?.manifestSha256!==sourceLock.manifestSha256)
      throw Error('MEASURED_SOURCE_IDENTITY_CHANGED');
    if(measuredChild.ready.initialDiskState?.sha256!==referenceClosed.final.closedStore.stateFile.sha256||
       measuredChild.ready.initialDiskState?.bytes!==referenceClosed.final.closedStore.stateFile.bytes)throw Error('CLOSED_REFERENCE_STORE_COPY_MISMATCH');
    const measuredDataset=datasetFrom(measuredChild.ready);
    if(measuredDataset.digest!==dataset.digest)throw Error('MEASURED_DATASET_CHANGED');
    relay=relayFor(measuredChild.origin);const origin=await relay.start();
    context=await limited(browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}));
    await limited(context.addInitScript(installAdapter,{group:false,memberId:scope.memberId}));
    const page=await limited(context.newPage());const mainNetwork=await limited(networkLedger(context,page,'main'));
    let interval=false;const writes=[],requestIndex=new WeakMap();
    context.on('request',request=>{
      if(!interval||['GET','HEAD','OPTIONS'].includes(request.method()))return;
      const record={id:writes.length,method:request.method(),path:sanitizePath(request.url()),bodyKeys:[],status:null};
      if(record.path==='/api/action-session'){try{record.bodyKeys=Object.keys(request.postDataJSON()??{}).sort();}catch{}}
      writes.push(record);requestIndex.set(request,record);
    });
    context.on('response',response=>{const record=requestIndex.get(response.request());if(record)record.status=response.status();});
    await limited(context.route('**/*',async route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin){await route.abort('blockedbyclient');return;}await route.fallback();}));
    let mainInstrumentations=0;
    await limited(page.route('**/main.mjs',async route=>{const response=await route.fetch();const original=await response.text();
      if(sha(original)!==sourceLock.files.find(file=>file.path==='app/web/main.mjs')?.sha256)throw Error('MAIN_SOURCE_MISMATCH');
      const served=instrumentMainSource(original);mainInstrumentations++;result.mainOriginalSha256=sha(original);result.mainInstrumentedSha256=sha(served);await route.fulfill({response,body:served});}));
    const invite=new URL(measuredChild.joinUrl);invite.host=new URL(origin).host;
    await limited(page.goto(invite.href,{waitUntil:'domcontentloaded',timeout:60000}));
    await limited(until(()=>page.evaluate(()=>!!window.__r116Snap?.()?.memberId),60000,'BROWSER_CONTEXT_TIMEOUT'));
    if(mainInstrumentations!==1)throw Error('MAIN_INSTRUMENTATION_COUNT');
    emit('browser-ready');
    const auth=authFor(measuredChild.joinUrl);
    const overlayResponse=await limited(httpText(origin+'/api/overlays',auth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({widget:'count',player:'duo',variant:'compact',size:'small'})}));
    const overlayValue=JSON.parse(overlayResponse.text),overlayUrl=new URL(overlayValue.link);overlayUrl.host=new URL(origin).host;
    const overlay=await limited(context.newPage());const overlayNetwork=await limited(networkLedger(context,overlay,'overlay'));
    const overlayNavigation=await limited(overlay.goto(overlayUrl.href,{waitUntil:'domcontentloaded',timeout:30000}));
    if(!overlayNavigation?.ok())throw Error('OVERLAY_NAVIGATION_FAILED');
    await limited(overlay.locator('#overlay .overlay-count').waitFor({state:'visible',timeout:30000}));
    const overlayContent=await limited(overlay.locator('#overlay .overlay-count').textContent());
    if(!/^\d[\d,]* \/ \d[\d,]*$/.test(overlayContent??''))throw Error('OVERLAY_WIDGET_CONTENT_MISSING');
    emit('overlay-ready');
    await limited(page.bringToFront());await limited(page.evaluate(id=>window.__r116OpenChunk(id),scope.chunkId));
    const token=measuredToken='all-'+randomUUID();
    const begun=await limited(measuredChild.rpc('begin',{token}));
    const beforeSnapshot=snapshotFrom(await limited(measuredChild.rpc('snapshot',{phase:'before'})));
    if(snapshotHash(beforeSnapshot)!==reference.calculatorBytesSha256)throw Error('MEASURED_INPUT_DIFFERS_FROM_REFERENCE');
    interval=true;emit('episode-start',{methodPhase:'before-snapshot',calculatorBytesSha256:snapshotHash(beforeSnapshot),fullStateSha256:fullStateHash(beforeSnapshot),revision:beforeSnapshot.revision});result.metrics.episodeStartNodeMs=now();
    const openingToken='opening-'+randomUUID();
    await limited(page.evaluate(payload=>window.__r116ArmOpening(payload),{token:openingToken,scope:reference.scope,expectedByFilter}));
    const tasksDispatch=await limited(nativeClick(page,page.locator('#chunk-content button[data-tab="tasks"][role="tab"]')));
    result.metrics.tasksPlannedNodeMs=tasksDispatch.plannedNode;result.metrics.tasksReturnedNodeMs=tasksDispatch.returnedNode;
    const summary=page.locator('#chunk-content summary').filter({hasText:'Possible Tasks'});await limited(summary.waitFor({state:'visible',timeout:60000}));
    if(!await limited(summary.evaluate(node=>node.parentElement.open)))await limited(nativeClick(page,summary));
    const openingTransition=await limited(until(()=>page.evaluate(value=>{const t=window.__r116Transition(value);return t?.status==='correct'||t?.status==='blocked'?t:null;},openingToken),60000,'OPENING_TRANSITION_TIMEOUT'));
    result.metrics.openingObservedNodeMs=now();
    emit('episode-start',{methodPhase:'opening-dom-observed',observationStatus:openingTransition.status});
    const expected=buildExpected(refBody);if(!expected.rows.length)throw Error('REFERENCE_EMPTY');
    const contrastLabel=expected.contrasting==='blocked'?'Blocked':'Doable';
    const contrast=page.locator('#chunk-content .filter-chip').filter({hasText:new RegExp('^'+contrastLabel+' \\d+$')});
    await limited(contrast.waitFor({state:'visible',timeout:60000}));await limited(nativeClick(page,contrast));
    const beforeAllSnapshot=snapshotFrom(await limited(measuredChild.rpc('snapshot',{phase:'before-all'})));
    emit('episode-start',{methodPhase:'before-all-snapshot',calculatorBytesSha256:snapshotHash(beforeAllSnapshot),fullStateSha256:fullStateHash(beforeAllSnapshot),revision:beforeAllSnapshot.revision});
    const current=normalizeView(await limited(page.evaluate(()=>window.__r116Snap())));
    if(current.memberId!==scope.memberId||current.nativeMemberValue!==scope.memberId||String(current.chunkId)!==scope.chunkId||current.group!==false)throw Error('NATIVE_SCOPE_MISMATCH');
    const arm=await limited(page.evaluate(payload=>window.__r116ArmAll(payload),{token,scope:reference.scope,expected}));
    if(arm?.status==='blocked')throw Error('ALL_ARM_BLOCKED');
    const all=page.locator('#chunk-content .filter-chip').filter({hasText:new RegExp('^All '+refBody.rows.length+'$')});
    const allDispatch=await limited(nativeClick(page,all));
    result.metrics.allPlannedNodeMs=allDispatch.plannedNode;result.metrics.allReturnedNodeMs=allDispatch.returnedNode;
    const transition=await limited(until(()=>page.evaluate(value=>{const t=window.__r116Transition(value);return t?.status==='correct'||t?.status==='blocked'?t:null;},token),60000,'ALL_TRANSITION_TIMEOUT'));
    result.metrics.episodeEndNodeMs=now();emit('episode-end');
    const afterFramesSnapshot=snapshotFrom(await limited(measuredChild.rpc('snapshot',{phase:'after-frames'})));
    emit('episode-end',{methodPhase:'after-frames-snapshot',calculatorBytesSha256:snapshotHash(afterFramesSnapshot),fullStateSha256:fullStateHash(afterFramesSnapshot),revision:afterFramesSnapshot.revision});
    const finished=await limited(measuredChild.rpc('finish',{token}));interval=false;
    fullCapture=await limited(page.evaluate(()=>window.__r116Read({includeBodies:true})));
    const overlayCapture=await limited(overlay.evaluate(()=>window.__r116Read?.({includeBodies:false})??null));
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
    const frozen=auditFrozenPlanning({reference,response,witness:inputWitness,native,before,dom,frames});
    const opening=auditOpeningProjection({reference,response:openingResponse,witness:inputWitness,expectedByFilter,
      transition:{...openingTransition,dom:normalizeView(openingTransition.dom),frames:(openingTransition.frames??[]).map(normalizeView)}});
    const strictRequest={memberId:scope.memberId,revision:reference.scope.revision,chunkId:scope.chunkId,group:false,
      inputKey:null,generation:native?.token,nativeValue:native?.label,peerIds:['explorer-2']};
    const strict=auditPlanning({request:strictRequest,native:{trusted:native?.trusted,value:native?.label,generation:native?.token,at:native?.capturedAt},responses:[],dom});
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
    await fs.writeFile(path.join(options.scratch,'r116-public-task-evidence.json'),JSON.stringify({reference,response,openingResponse,witness:inputWitness,openingTransition,opening,expectedByFilter,transition,strict,frozen,
      browser:fullCapture,overlay:overlayCapture,network:{main:mainNetwork,overlay:overlayNetwork},
      overlayWitness:{httpStatus:overlayNavigation.status(),widget:'count',countText:overlayContent}},null,2));
    emit('calibration-start');const rtt={direct:[],bridge:[]};
    for(const [base,key] of [[measuredChild.origin,'direct'],[origin,'bridge']])for(let i=0;i<5;i++){
      const started=now();await limited(httpText(base+'/api/health'));rtt[key].push(now()-started);
    }
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    result.metrics.totalRttMedianMs=median(rtt.bridge);result.metrics.directRttMedianMs=median(rtt.direct);
    result.rttStatus=Math.abs(result.metrics.totalRttMedianMs-40)<=2?'within-band':'outside-band';
    if(result.rttStatus==='outside-band'&&result.status==='correct'){result.status='calibration-blocked';result.code='total-rtt-outside-band';}
    emit('calibration-end',{rttStatus:result.rttStatus});
  }catch(error){result.code=codeOf(error);result.status=result.code.includes('input')||result.code.includes('reference')||result.code.includes('opening')?'blocked':'failed';if(result.code.includes('opening')){result.openingStatus='blocked';result.openingCode=result.code;}emit('error',{code:result.code});}
  finally{
    emit('cleanup-start');let clean=true;
    try{if(referenceLaunching&&!referenceBrowser)referenceBrowser=await bounded(referenceLaunching,35000,'REFERENCE_BROWSER_LAUNCH_DRAIN_TIMEOUT');
      await bounded(referenceBrowser?.close()??Promise.resolve(),15000,'REFERENCE_BROWSER_CLOSE_TIMEOUT');}catch{clean=false;}
    try{if(launching&&!browser)browser=await bounded(launching,35000,'BROWSER_LAUNCH_DRAIN_TIMEOUT');await bounded(browser?.close()??Promise.resolve(),15000,'BROWSER_CLOSE_TIMEOUT');}catch{clean=false;}
    try{await relay?.close();}catch{clean=false;}
    try{if(referenceChild){referenceClosed=await referenceChild.close();if(!referenceClosed.graceful||referenceClosed.exit?.code!==0||referenceClosed.final?.closeCompleted!==true)clean=false;}}catch{clean=false;}
    try{if(measuredChild){measuredClosed=await measuredChild.close();if(!measuredClosed.graceful||measuredClosed.exit?.code!==0||measuredClosed.final?.closeCompleted!==true)clean=false;}}catch{clean=false;}
    // Stop/drain is part of the witness: a delayed store commit cannot be ignored.
    if(inputWitness){
      const closure=validateClosedWitness(measuredClosed?.final,measuredToken,inputWitness.calculatorBytesSha256,inputWitness.snapshots[0].fullStateSha256);
      if(!closure.valid){result.status='blocked';result.code=closure.code;result.frozenStatus='blocked';result.frozenCode=closure.code;
        if(result.openingStatus!=='unrun'){result.openingStatus='blocked';result.openingCode=closure.code;}}
    }
    result.cleanupStatus=clean?'complete':'incomplete';
    if(!clean){result.status='failed';result.code='cleanup-incomplete';}
    const finalProof={schema:'r116-final-input-proof-v1',sourceManifestSha256:result.sourceManifestSha256,fixtureSha256:result.fixtureSha256,
      datasetDigest:result.datasetDigest,calculatorBytesSha256:result.calculatorBytesSha256,
      reference:publicCloseProof(referenceClosed),measured:publicCloseProof(measuredClosed)};
    const finalProofText=JSON.stringify(finalProof,null,2)+'\n';result.finalProofSha256=sha(finalProofText);
    await fs.writeFile(path.join(options.scratch,'r116-final-proof.json'),finalProofText);
    // Never publish or retain authored stores, invite/cookie material or private keys.
    if(clean){try{ownedPath(options.scratch,owned);await fs.rm(owned,{recursive:true,force:true});}catch{result.cleanupStatus='incomplete';result.status='failed';result.code='scratch-cleanup-incomplete';}}
    clearTimeout(deadlineTimer);process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);
    emit('cleanup-end',{cleanupStatus:result.cleanupStatus});await fs.writeFile(options.out,JSON.stringify(result,null,2)+'\n');
    emit('result',{status:result.status,code:result.code});emit.close();
  }
  process.stdout.write(JSON.stringify({status:result.status,code:result.code})+'\n');
  return result.status==='failed'?1:0;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().then(code=>{process.exitCode=code;},error=>{process.stderr.write(JSON.stringify({status:'failed',code:codeOf(error)})+'\n');process.exitCode=1;});
}
