// R46 wire adapter plus the reviewed strict overlay ledger. No product imports.
import { createLedger } from '../../sources/network-ledger-overlay/ledger.mjs';
import { createNavigationEpochs } from './navigation-epochs.mjs';
export async function wireNetwork(browser, pages, metrics, origin, persist) {
  const root=await browser.newBrowserCDPSession(), scopes=[], waits=new Map();let sequence=0,problem,closing=false,drained=false;const closedPages=new Set(),detached=new Set(),destroyed=new Set();let disconnected=false;const writes=new Set(),ownedListeners=[];const listen=(emitter,event,handler)=>{emitter.on(event,handler);ownedListeners.push({emitter,event,handler});};
  const fail=code=>{problem??=code;};
  const documentProofs=new WeakMap();
  const scopeOf=s=>({target:s.target,session:s.session,page:s.page});
  const checkpoint=(kind,row)=>{if(writes.size>=64){fail('checkpoint-pending-cap');return Promise.resolve();}let pending;try{pending=Promise.resolve(persist(kind,row)).catch(()=>fail('checkpoint-write-failed'));}catch{fail('checkpoint-write-failed');return Promise.resolve();}writes.add(pending);pending.finally(()=>writes.delete(pending));return pending;};
  const browserDisconnected=()=>{disconnected=true;checkpoint('browser-lifecycle',{event:'disconnected',closing});if(!closing)fail('unexpected-browser-disconnect');};
  if(browser.on)listen(browser,'disconnected',browserDisconnected);
  listen(root,'Target.receivedMessageFromTarget',e=>{
    const s=scopes.find(x=>x.session===e.sessionId);if(!s)return fail('unknown-cdp-session');
    let m;try{m=JSON.parse(e.message);}catch{return fail('malformed-cdp');}
    if(m.id){const w=waits.get(m.id);if(!w)return fail('unknown-cdp-reply');if(w.session!==e.sessionId)return fail('wrong-session-cdp-reply');clearTimeout(w.timer);waits.delete(m.id);m.error?w.reject(Error('CDP operation refused')):w.resolve(m.result);return;}
    for(const f of s.listeners.get(m.method)??[])f(m.params);
  });
  const send=(s,method,params={})=>new Promise((resolve,reject)=>{
    if(waits.size>=32)return reject(Error('CDP pending cap'));
    const id=++sequence,timer=setTimeout(()=>{waits.delete(id);reject(Error('CDP deadline'));},10000);
    waits.set(id,{resolve,reject,timer,session:s.session});root.send('Target.sendMessageToTarget',{sessionId:s.session,message:JSON.stringify({id,method,params})}).catch(e=>{clearTimeout(timer);waits.delete(id);reject(e);});
  });
  for(let i=0;i<3;i++){
    const {targetInfo}=await metrics[i].send('Target.getTargetInfo');
    const {sessionId}=await root.send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:false});
    scopes.push({target:targetInfo.targetId,session:sessionId,page:i,epoch:1,role:i<2?'player':'overlay',targetType:'page',listeners:new Map(),requests:new Map(),docs:new Set(),localBodies:new Set(),documentCache:new Map()});
  }
  const contracts=scopes.map(s=>({target:s.target,session:s.session,role:s.role,targetType:'page',path:s.role==='player'?'/api/events':'/overlay/events',method:'GET',requestType:s.role==='player'?'EventSource':'Fetch',responseType:s.role==='player'?'EventSource':'Fetch',capacity:1}));
  const now=()=>performance.now(),ledger=createLedger({ownedOrigin:origin,expectedTargets:3,maxEvents:100000,maxActive:512,maxRecent:8192,maxSessions:3,maxDocumentsPerSession:64,maxWrites:64,expectedStreamContracts:contracts,sink:line=>persist('network-ledger',{...JSON.parse(line)})});
  const ingest=(s,e)=>ledger.ingest({target:s.target,session:s.session,at:now(),...e});
  listen(root,'Target.detachedFromTarget',e=>{const s=scopes.find(s=>s.session===e.sessionId);if(!s)return;detached.add(s.session);checkpoint('browser-lifecycle',{event:'detached',target:s.target,session:s.session,page:s.page,epoch:s.epoch,closing});if(!closing)fail('cdp-detached');});
  listen(root,'Target.targetDestroyed',e=>{const s=scopes.find(s=>s.target===e.targetId);if(!s)return;destroyed.add(s.target);checkpoint('browser-lifecycle',{event:'target-destroyed',target:s.target,session:s.session,page:s.page,epoch:s.epoch,closing});if(!closing)fail('unexpected-target-destroy');});
  for(const s of scopes){
    ingest(s,{event:'attach',role:s.role,targetType:'page'});
    const on=(method,f)=>s.listeners.set(method,[e=>{try{f(e);}catch(error){fail('navigation-evidence:'+error.message);}}]);
    s.navigation=createNavigationEpochs(scopeOf(s));
    on('Page.frameNavigated',e=>{if(!s.navigation.snapshot().bootstrapped)return fail('frame-event-before-bootstrap');const doc=s.navigation.frameNavigated({...scopeOf(s),frame:e.frame});s.epoch=doc.epoch;checkpoint('document-navigation',doc);});
    await send(s,'Page.enable');
    const tree=await send(s,'Page.getFrameTree');s.navigation.bootstrap({...scopeOf(s),frameTree:tree.frameTree});s.epoch=s.navigation.snapshot().epoch;
    on('Network.requestWillBeSent',e=>{
      const old=s.requests.get(e.requestId),doc=s.navigation.request({...scopeOf(s),event:e}),hop=doc.hop;s.epoch=s.navigation.snapshot().epoch;
      if(s.requests.size>=8192&&!old)return fail('wire-retention-cap');
      if(!e.loaderId)return fail('missing-document-identity');s.docs.add(e.loaderId);if(s.docs.size>64)return fail('document-cap');
      const alias=ingest(s,{event:'request',requestId:e.requestId,document:e.loaderId,url:e.request.url,method:e.request.method,type:e.type,redirect:!!e.redirectResponse,redirectStatus:e.redirectResponse?.status});
      const u=new URL(e.request.url),path=['/api/tasks','/api/state','/api/command','/api/usage','/api/events','/overlay/events'].includes(u.pathname)?u.pathname:'[other]';
      let command;try{command=JSON.parse(e.request.postData??'null');}catch{}
      const r={...doc,requestId:e.requestId,alias,hop,url:e.request.url,path,method:e.request.method,type:e.type,at:now(),commandId:command?.requestId};s.requests.set(e.requestId,r);
      checkpoint('wire',{event:'request',page:s.page,epoch:r.epoch,frameId:r.frameId,loaderId:r.loaderId,role:s.role,target:s.target,session:s.session,requestId:e.requestId,hop,document:e.loaderId,path,type:e.type,commandId:r.commandId??null});
    });
    on('Network.responseReceived',e=>{const r=s.requests.get(e.requestId);if(r){if((e.loaderId&&e.loaderId!==r.loaderId)||(e.frameId&&e.frameId!==r.frameId))return fail('response-document-mismatch');r.response=true;checkpoint('wire',{event:'response',...scopeOf(s),epoch:r.epoch,frameId:r.frameId,loaderId:r.loaderId,requestId:r.requestId,hop:r.hop,status:e.response.status});}ingest(s,{event:'response',requestId:e.requestId,status:e.response.status,mime:e.response.mimeType,type:e.type});});
    for(const [method,event]of [['Network.loadingFinished','finished'],['Network.loadingFailed','failed']])on(method,e=>{
      const r=s.requests.get(e.requestId);if(r)r.terminal=event;
      ingest(s,{event,requestId:e.requestId,canceled:e.canceled});
      checkpoint('wire',{event,page:s.page,epoch:r?.epoch??null,frameId:r?.frameId??null,loaderId:r?.loaderId??null,target:s.target,session:s.session,requestId:e.requestId,hop:r?.hop??null,encodedBytes:e.encodedDataLength??null,canceled:e.canceled===true,applicationConsumption:r?.consumed?'observed':'unobserved'});
    });
    await send(s,'Network.enable');ingest(s,{event:'enabled'});
    listen(pages[s.page],'crash',()=>fail('page-crash'));
    listen(pages[s.page],'close',()=>{closedPages.add(s.page);checkpoint('browser-lifecycle',{event:'page-close',target:s.target,session:s.session,page:s.page,epoch:s.epoch,closing});if(!closing)fail('unexpected-page-close');});
  }
  // Observer-only CDP metadata. Actual Chromium bracket ordering is conformance UNRUN.
  async function document(page,e){
    const s=scopes[page];if(!s)throw Error('unknown-body-page');
    if(!Number.isFinite(e.documentTimeOrigin)||e.documentTimeOrigin<=0){fail('missing-document-time-origin');throw Error('missing-document-time-origin');}
    const initial=s.navigation.snapshot(),cached=s.documentCache.get(initial.epoch);
    if(cached&&cached.timeOrigin===e.documentTimeOrigin)return cached.proof;
    if(cached){fail('time-origin-changed-without-document-epoch');throw Error('time-origin-changed-without-document-epoch');}
    const before=await send(s,'Page.getFrameTree');
    const evaluated=await send(s,'Runtime.evaluate',{expression:'performance.timeOrigin',returnByValue:true});
    const after=await send(s,'Page.getFrameTree'),current=s.navigation.snapshot();
    const a=before.frameTree?.frame,b=after.frameTree?.frame,timeOrigin=evaluated.result?.value;
    if(evaluated.exceptionDetails||evaluated.result?.type!=='number'||timeOrigin!==e.documentTimeOrigin||initial.epoch!==current.epoch||!a||!b||a.id!==b.id||a.loaderId!==b.loaderId||b.id!==current.frameId||b.loaderId!==current.loaderId){fail('unproven-body-document');throw Error('unproven-body-document');}
    if(s.documentCache.size>=64&&!s.documentCache.has(current.epoch)){fail('document-proof-cap');throw Error('document-proof-cap');}
    const proof=Object.freeze({});const evidence={...scopeOf(s),epoch:current.epoch,frameId:current.frameId,loaderId:current.loaderId,timeOrigin};
    documentProofs.set(proof,evidence);s.documentCache.set(current.epoch,{timeOrigin,proof});
    await checkpoint('document-proof',{...evidence,authority:'bracketed-CDP-main-frame-and-time-origin',conformance:'UNRUN'});return proof;
  }
  function body(page,e,proof){
    const s=scopes[page];if(!s)return fail('unknown-body-page');
    const doc=documentProofs.get(proof),current=s.navigation.snapshot();
    if(!doc||doc.page!==page||doc.session!==s.session||doc.target!==s.target||doc.epoch!==current.epoch||doc.frameId!==current.frameId||doc.loaderId!==current.loaderId||doc.timeOrigin!==e.documentTimeOrigin)return fail('missing-or-old-document-proof');
    const localKey=JSON.stringify([doc.epoch,doc.timeOrigin,e.localId]);
    if(!Number.isSafeInteger(e.localId)||e.localId<1||s.localBodies.has(localKey))return fail('duplicate-or-missing-local-body-id');
    if(s.localBodies.size>=8192)return fail('local-body-cap');s.localBodies.add(localKey);const matches=[...s.requests.values()].filter(r=>r.kind==='main-request'&&r.epoch===doc.epoch&&r.frameId===doc.frameId&&r.loaderId===doc.loaderId&&r.response&&!r.consumed&&r.url===e.url&&r.method===e.method&&(!e.commandId||r.commandId===e.commandId));
    if(matches.length!==1){checkpoint('body-unknown',{page,localId:e.localId,path:e.path,candidates:matches.length});return false;}
    const r=matches[0];s.navigation.associateBody({...scopeOf(s),...r});r.consumed=true;ingest(s,{event:'bodyConsumed',requestId:r.requestId,requestAlias:r.alias});
    checkpoint('body-consumed',{page,epoch:r.epoch,frameId:r.frameId,loaderId:r.loaderId,documentTimeOrigin:doc.timeOrigin,requestId:r.requestId,hop:r.hop,localId:e.localId,value:e.value,bodyTerminal:'natural-json-read',target:s.target,session:s.session,role:s.role,association:'sole-unconsumed-owned-response'});
    return {target:s.target,session:s.session,page:s.page,epoch:r.epoch,frameId:r.frameId,loaderId:r.loaderId,documentTimeOrigin:doc.timeOrigin,role:s.role,requestId:r.requestId,hop:r.hop,alias:r.alias,localId:e.localId,bodyTerminal:'natural-json-read',association:'sole-unconsumed-owned-response'};
  }
  return {document,body,scopes,ledger,pageCounts(page){const scope=scopes[page];if(!scope)return{active:null,retainedRequests:null,epoch:null};const state=ledger.snapshot(),aliases=new Set([...scope.requests.values()].map(w=>w.alias));return{active:state.pending.filter(r=>aliases.has(r.request)).length,retainedRequests:scope.requests.size,epoch:scope.epoch};},async closeBrowser(close){
    if(!drained)throw Error('pre-close zero-active barrier required');closing=true;await checkpoint('browser-close-begin',{surfaces:scopes.length});
    await close();await ledger.flush();await Promise.all([...writes]);await Promise.resolve();
    const finalNetwork=ledger.snapshot();const receipt={networkPending:finalNetwork.pending.length,networkFaults:[...finalNetwork.faults],browserCloseResolved:true,browserDisconnectedObserved:disconnected,expectedPages:scopes.length,closedPages:[...closedPages].sort(),pendingCDPCommands:waits.size,individualDetach:scopes.map(s=>({target:s.target,session:s.session,page:s.page,epoch:s.epoch,detachedObserved:detached.has(s.session),destroyedObserved:destroyed.has(s.target)})),individualDetachAuthority:'observed events only; missing detach remains unobserved',runtimeAcceptance:false};
    let removed=0;for(const entry of ownedListeners){if(typeof entry.emitter.off==='function'){entry.emitter.off(entry.event,entry.handler);removed++;}}receipt.listenerDisposal={installed:ownedListeners.length,removed,pendingWrites:writes.size};await persist('browser-close-receipt',receipt);if(removed!==ownedListeners.length||writes.size)throw Error('owned observer disposal incomplete');if(!disconnected||closedPages.size!==scopes.length||waits.size)throw Error('post-browser-close lifecycle incomplete');
    if(problem)throw Error(problem);if(finalNetwork.pending.length||finalNetwork.faults.length)throw Error('post-close network drain not proven');return receipt;
  },check(){if(problem)throw Error(problem);const x=ledger.snapshot();if(x.faults.length)throw Error('network evidence fault: '+x.faults.join(','));return x;},async active(){await ledger.flush();return this.check();},async teardown(close){
    const startedAt=now(),budgetMs=5000;await persist('pre-teardown',this.check());await close();
    let result;do{await ledger.flush();result=ledger.drain({startedAt,budgetMs,at:now()});await persist('drain',result);if(!result.pending.length)break;await new Promise(r=>setTimeout(r,50));}while(now()<startedAt+budgetMs);
    // Expected SSE is allowed in active/idle only. Teardown requires ZERO active streams/work.
    if(result.pending.length||result.faults.length||result.status!=='drained')throw Error('final network drain not proven');drained=true;return result;
  }};
}
