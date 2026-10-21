#!/usr/bin/env node
// Original-service reads only. No clicks, credentials, or persistent browser profile.
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openChrome, until } from '../perf/cdp.mjs';

export const ORIGINAL_SITE = 'https://source-chunk.github.io/chunk-picker-rs3/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_ROOT = path.join(ROOT, '.local/research');
// The upstream sources at commit 98a3bdc (v6.9.68), hashed with LF line endings.
// The copies are no longer kept; the capture compares the deployed site to these pins.
export const RETAINED_SOURCE_SHA256 = Object.freeze({
  'index.js': '8e4d21bbfad09de8fffe263f131e3f5bdb63fca65da27c27f9e3d670623af894',
  'worker.js': '76a962701fd22c65d5c78e110dd7eb8733fc365e316e46e431d3d41700343404',
});
export function assertPinnedSourceHash(name, actualHash) {
  if(actualHash!==RETAINED_SOURCE_SHA256[name]) throw new Error(`Deployed original ${name} changed: review its source before continuing`);
}
export function assertRetainedSourceHash(name, actualHash, retainedSource) {
  const expected=createHash('sha256').update(retainedSource.replaceAll('\r\n','\n')).digest('hex');
  if(actualHash!==expected) throw new Error(`Deployed original ${name} changed: review its source before continuing`);
}
export function isFirebaseURL(value) {
  const host = new URL(value).hostname.toLowerCase();
  return host === 'firebaseio.com' || host.endsWith('.firebaseio.com')
    || host === 'firebasedatabase.app' || host.endsWith('.firebasedatabase.app') || host.endsWith('.firebaseapp.com')
    || host.endsWith('.cloudfunctions.net') || /^(?:identitytoolkit|securetoken|firestore|firebase[^.]*)\.googleapis\.com$/.test(host);
}
export function readOnlySocketAction(data) {
  if (typeof data !== 'string') return null;
  if (data === '0') return 'heartbeat';
  try {
    const packet = JSON.parse(data);
    if (packet?.t === 'd' && ['q','n','g'].includes(packet.d?.a)) return packet.d.a;
  } catch {}
  return null;
}
export function shouldBlockRequest(url, method) {
  // Long-poll can encode writes in GET query strings. Only websocket read messages
  // and ordinary public REST GETs are allowed; long-poll is disabled completely.
  const pathname = decodeURIComponent(new URL(url).pathname).toLowerCase();
  return isFirebaseURL(url) && (method !== 'GET' || /\/(?:\.lp|\.settings)\b/.test(pathname));
}
export const guardSource = `(() => {
  const audit = window.__parityAudit = {socketActions:{}, blockedSocketActions:{}, errors:[]};
  const NativeSocket = window.WebSocket;
  const firebase = ${isFirebaseURL.toString()};
  const readAction = ${readOnlySocketAction.toString()};
  window.WebSocket = class extends NativeSocket {
    constructor(url, protocols) { super(url, ...(protocols === undefined ? [] : [protocols])); this.__firebaseReadOnly = firebase(url); }
    send(data) {
      if (this.__firebaseReadOnly) {
        let action;
        try { const packet = JSON.parse(data); action = packet?.t === 'd' ? packet.d?.a : undefined; } catch {}
        if (data === '0') return super.send(data);
        const safe = readAction(data) !== null;
        const counts = safe ? audit.socketActions : audit.blockedSocketActions;
        counts[action ?? 'unknown'] = (counts[action ?? 'unknown'] ?? 0) + 1;
        if (!safe) return;
      }
      return super.send(data);
    }
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); this.addEventListener('message', e => {
      if (e.data?.type === 'current') window.__parityWorkerCurrent = e.data;
      if (e.data?.type === 'error') audit.errors.push(String(e.data.err?.message ?? 'worker error'));
    }); }
  };
})();`;
export const recomputeActiveExpression = `(() => {
  if (!viewOnly) throw new Error('Expected view-only mode');
  window.__parityComputedList = setupCurrentChallenges(tempChallengeArrSaved,true,true);
  return true;
})();`;
export const computedHTMLExpression = `(() => {
  const el=document.createElement('div'); el.innerHTML=challengeArr.join('');
  return [...el.querySelectorAll('.challenge')].map(row=>({text:row.textContent,disabled:row.querySelector('input')?.disabled ?? null}));
})();`;
export const canonicalActiveExpression = `(() => {
  const raw=Object.entries(activeTasks).flatMap(([category,tasks])=>category==='Favorite'
    ? Object.entries(tasks).flatMap(([c,values])=>Object.entries(values).map(([rawLabel,value])=>({category:c,rawLabel,value,favorite:true})))
    : Object.entries(tasks).map(([rawLabel,value])=>({category,rawLabel,value,favorite:false})));
  return window.__parityComputedList.flatMap(entry=>Object.entries(entry).filter(([key])=>key!=='prefix').map(([rawLabel,category])=> {
    const match=raw.find(row=>row.category===category && row.rawLabel===rawLabel);
    const shortened=raw.find(row=>row.category===category && row.rawLabel===rawLabel.split('|')[1]);
    return {category,rawLabel,value:match?.value ?? shortened?.value ?? chunkInfo.challenges?.[category]?.[rawLabel]?.Level ?? null,
      prefix:entry.prefix,favorite:!!(match?.favorite ?? shortened?.favorite),metadata:chunkInfo.challenges?.[category]?.[rawLabel] ?? null};
  }));
})();`;

export function compareOriginalMap(original, local, identity) {
  const own=new Map(local.tasks.map(row=>[row.id,row]));
  const accessible=new Map((local.otherAccessibleTasks ?? []).map(row=>[row.id,row]));
  const resolve=row=> {
    const resolution=identity.resolveOriginal(row);
    const id=resolution.status==='resolved' ? resolution.id : `unresolved:${row.category}:${row.rawLabel}`;
    const localRow=own.get(id) ?? accessible.get(id) ?? null;
    return {...row,id,resolution:resolution.status,candidates:resolution.candidates,local:localRow};
  };
  const diff=(originalRows,localRows)=> {
    const rows=originalRows.map(resolve), originals=new Map(rows.map(row=>[row.id,row]));
    const locals=new Map(localRows.map(row=>[row.id,row]));
    return {originalCount:originalRows.length,originalUnique:originals.size,localCount:localRows.length,
      common:[...originals.values()].filter(row=>locals.has(row.id)),
      originalOnly:[...originals.values()].filter(row=>!locals.has(row.id)),
      localOnly:[...locals.values()].filter(row=>!originals.has(row.id)),
      unmapped:rows.filter(row=>row.resolution!=='resolved')};
  };
  const active=diff(original.active,local.activeTasks);
  const possible=diff(original.possible,local.eligibleTasks);
  // False Quest/Diary entries are nested prerequisites suppressed by the
  // original worker. Keep the full model and positive projection distinct.
  const positivePossible=diff(original.possible.filter(row=>!!row.value),local.eligibleTasks);
  const statusDifferences=original.possible.map(resolve).flatMap(row=> {
    if(!row.local || row.resolution!=='resolved') return [];
    const required=typeof row.metadata?.Level==='number' ? row.metadata.Level : typeof row.value==='number' ? row.value : null;
    const boost=original.boosts?.[row.category]?.[row.rawLabel] ?? 0;
    const effective=required===null ? null : Math.max(1,required-boost);
    const statusDrift=row.local.status!=='available';
    const requiredLevelDrift=required!==null && row.local.requiredLevel!==null && required!==row.local.requiredLevel;
    const effectiveLevelDrift=effective!==null && row.local.effectiveLevel!==null && effective!==row.local.effectiveLevel;
    return statusDrift || requiredLevelDrift || effectiveLevelDrift ? [{...row,originalRequiredLevel:required,originalEffectiveLevel:effective,statusDrift,requiredLevelDrift,effectiveLevelDrift}] : [];
  });
  const idSet=values=>new Set(values.map(String));
  const originalUnlocked=Object.keys(original.chunks.unlocked ?? {}),originalSelected=Object.keys(original.chunks.selected ?? {});
  const chunkDiff=(o,l)=>({original:o.length,local:l.length,originalOnly:o.filter(id=>!idSet(l).has(String(id))),localOnly:l.filter(id=>!idSet(o).has(String(id)))});
  const state=local.chunks.saved;
  const selectedOrder=originalSelected.sort((a,b)=>Number(original.chunks.selected[a])-Number(original.chunks.selected[b]));
  const progress=(rows,flag)=> {
    const mapped=rows.map(resolve),positive=flag==='backlogged' ? mapped : mapped.filter(row=>row.value===true);
    return {original:positive.length,mapped:positive.filter(row=>row.resolution==='resolved').length,
      matched:positive.filter(row=>row.resolution==='resolved' && (local.savedStatuses?.[row.id] ?? row.local?.savedStatus)?.[flag]===true).length,
      missing:positive.filter(row=>row.resolution!=='resolved' || (local.savedStatuses?.[row.id] ?? row.local?.savedStatus)?.[flag]!==true)};
  };
  return {chunks:{unlocked:chunkDiff(originalUnlocked,state.unlocked),selected:chunkDiff(originalSelected,state.selected),
    selectedOrderMatches:JSON.stringify(selectedOrder)===JSON.stringify(state.selected.map(String))},active,possible,positivePossible,statusDifferences,
    progress:{completed:progress(original.completed,'challengeCompleted'),checked:progress(original.checked,'challengeCompleted'),
      fullListChecked:progress(original.fullListChecked,'challengeCompleted'),backlog:progress(original.backlog,'backlogged')},
    currentBiS:compareCurrentBiS(original.highestOverall,local.currentBiS),
    originalCurrentBiS:original.highestOverall,localCurrentBiS:local.currentBiS};
}

export function compareCurrentBiS(original, current) {
  const slots=new Map(), normalizeSlot=slot=>slot==='off-hand weapon' ? 'off-hand' : slot;
  const norm=name=>name==null || name==='N/A' ? null : String(name).toLowerCase();
  for(const row of current?.obtainable?.recommendations ?? []) slots.set(`${row.style}-${normalizeSlot(row.slot)}`,{
    item:typeof row.equipment==='string' ? row.equipment : row.equipment?.name,alternatives:row.alternatives ?? []});
  for(const row of current?.obtainable?.loadouts ?? []) {
    const best=row.best; if(!best) continue;
    for(const [slot,key] of [['main hand weapon','mainHand'],['off-hand','offHand'],['ammo','ammunition']]) {
      const name=`${row.style}-${slot}`;
      // Recommendation peers are already restricted to this equipment slot.
      // A tied loadout's mixed item array cannot establish slot equivalence.
      slots.set(name,{item:best[key] ?? null,alternatives:slots.get(name)?.alternatives ?? []});
    }
    if(best.mode==='two-handed') {
      const name=`${row.style}-2h weapon`;
      slots.set(name,{item:best.mainHand,alternatives:slots.get(name)?.alternatives ?? []});
    }
  }
  const rows=Object.entries(original ?? {}).filter(([key])=>/^(?:Melee|Ranged|Magic|Necromancy|Prayer)-/.test(key)).map(([key,item])=> {
    const split=key.indexOf('-'),canonical=`${key.slice(0,split)}-${normalizeSlot(key.slice(split+1))}`,local=slots.get(canonical);
    const same=norm(item)===norm(local?.item);
    const equivalentTie=!same && (local?.alternatives ?? []).some(name=>norm(name)===norm(item));
    return {slot:key,original:item,local:local?.item ?? null,status:same?'same':equivalentTie?'equivalent-tie':'different',alternatives:local?.alternatives ?? []};
  });
  const originals=new Set(rows.map(row=>{const split=row.slot.indexOf('-');return `${row.slot.slice(0,split)}-${normalizeSlot(row.slot.slice(split+1))}`;}));
  return {rows,counts:{originalSlots:rows.length,same:rows.filter(row=>row.status==='same').length,equivalentTies:rows.filter(row=>row.status==='equivalent-tie').length,different:rows.filter(row=>row.status==='different').length},
    added:[...slots].filter(([slot])=>!originals.has(slot)).map(([slot,row])=>({slot,item:row.item}))};
}

const readyExpression = `typeof viewOnly !== 'undefined' && viewOnly === true && typeof globalValids !== 'undefined' && Object.keys(globalValids).length > 0 && workersOut.current === false && !!window.__parityWorkerCurrent`;
export const snapshotExpression = `(() => {
  if (!viewOnly) throw new Error('Expected view-only mode');
  const rows = (records, favorite=false) => Object.entries(records ?? {}).flatMap(([category,tasks]) => category === 'Favorite'
    ? rows(tasks,true) : Object.entries(tasks ?? {}).map(([rawLabel,value]) => ({category,rawLabel,value,favorite,
    metadata: chunkInfo.challenges?.[category]?.[rawLabel] ?? null})));
  return { mapId:mid, version:currentVersion, viewOnly, chunks:tempChunks, rules, settings,
    active:rows(activeTasks), possible:rows(globalValids), boosts:globalValidsBoosts,
    highestCurrent, highestOverall, highestOverallCompleted, bisUpgrades,
    completed:rows(completedChallenges), checked:rows(checkedChallenges), fullListChecked:rows(checkedAllTasks), backlog:rows(backlog),
    nonValids:window.__parityWorkerCurrent?.nonValids ?? {},
    domActive:[...document.querySelectorAll('.panel-active .challenge')].map(el=>({text:el.innerText,disabled:el.querySelector('input')?.disabled ?? null})),
    audit:window.__parityAudit };
})();`;

export async function openBrowserCDP(profile) {
  const [portText,browserPath] = (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
  const port=Number(portText);
  if(!Number.isInteger(port) || port<1024 || [8788,8789,8790].includes(port) || !browserPath.startsWith('/devtools/browser/')) throw new Error('Unsafe browser endpoint');
  const socket=new WebSocket(`ws://127.0.0.1:${port}${browserPath}`),pending=new Map(); let sequence=0;
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(new Error('Worker inspection connection failed')),{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),entry=pending.get(message.id);if(!entry)return;
    clearTimeout(entry.timer);pending.delete(message.id);message.error?entry.reject(new Error(`Worker inspection ${entry.method} failed`)):entry.resolve(message.result);});
  const close=()=>{socket.close();for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Worker inspection closed'));}pending.clear();};
  socket.addEventListener('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Worker inspection closed'));}pending.clear();});
  return {close,send:(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Worker inspection ${method} timed out`));},10000);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));})};
}

export async function readOriginalWorker(profile, {connect=openBrowserCDP,site=ORIGINAL_SITE}={}) {
  // Chrome's dedicated worker target can remain inert (and have an empty URL)
  // until the parent page enables auto-attach. Never pause or rerun the worker.
  let browser,stage='connection';
  const parents=[];
  try {
    browser=await connect(profile);
    stage='targets';
    let {targetInfos}=await browser.send('Target.getTargets');
    const candidates=targetInfos.filter(t=>t.type==='worker' && (!t.url || t.url.startsWith(site)));
    for(const parentId of new Set(candidates.map(t=>t.parentId).filter(Boolean))) {
      stage='parent-attachment';
      const {sessionId}=await browser.send('Target.attachToTarget',{targetId:parentId,flatten:true});
      parents.push(sessionId);
      await browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId);
    }
    ({targetInfos}=await browser.send('Target.getTargets'));
    for(const target of targetInfos.filter(t=>t.type==='worker' && (!t.url || t.url.startsWith(site)))) {
      stage='worker-attachment';
      const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      try {
        stage='evaluation';
        const response=await browser.send('Runtime.evaluate',{expression:"({origin:location.href,ready:typeof globalValids !== 'undefined' && !!globalValids && Object.keys(globalValids).length>0,nonValids:typeof nonValids === 'undefined' ? null : nonValids})",returnByValue:true},sessionId);
        if(response.exceptionDetails) throw new Error('Original worker inspection failed');
        const value=response.result?.value;
        if(value?.ready && value.origin?.startsWith(site) && value.nonValids!==null && value.nonValids!==undefined) {
          return {nonValids:value.nonValids,diagnostic:{available:true,reason:null}};
        }
      } finally {await browser.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
    }
    return {nonValids:null,diagnostic:{available:false,reason:'No ready original worker diagnostics'}};
  } catch {
    // Diagnostic availability must not discard an otherwise successful capture.
    return {nonValids:null,diagnostic:{available:false,reason:`Worker inspection unavailable during ${stage}`}};
  } finally {
    if(browser) {
      for(const sessionId of parents) {
        await browser.send('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true},sessionId).catch(()=>{});
        await browser.send('Target.detachFromTarget',{sessionId}).catch(()=>{});
      }
      browser.close();
    }
  }
}

async function prepareOutputRoot() {
  const root=await realpath(ROOT);
  for(const directory of [path.join(ROOT,'.local'),OUTPUT_ROOT]) {
    const stat=await lstat(directory).catch(error=>{if(error.code!=='ENOENT') throw error;return null;});
    if(stat?.isSymbolicLink()) throw new Error('Research output cannot use a symlink or junction');
    if(!stat) await mkdir(directory);
    const resolved=await realpath(directory),relative=path.relative(root,resolved);
    if(!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Research output escapes the worktree');
  }
}

async function safeRemoveScratch(target) {
  const base = await realpath(OUTPUT_ROOT), resolved = await realpath(target);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolved).startsWith('original-scratch-')) throw new Error('Unsafe scratch cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

export async function captureOriginal({ mapIds = ['qxa','qxb'], chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', timeoutMs = 180000 } = {}) {
  if (mapIds.some(id => !['qxa','qxb'].includes(id)) || new Set(mapIds).size !== mapIds.length || !mapIds.length) throw new Error('Only QXA and QXB are authorized');
  await prepareOutputRoot();
  const captures = {};
  for (const mapId of mapIds) {
    const scratch = await mkdtemp(path.join(OUTPUT_ROOT,'original-scratch-'));
    let browser, handler;
    const blockedRequests = [], sourceHashes = {};
    try {
      browser = await openChrome(chrome, scratch);
      let requestFailure;
      handler = message => {
        if (message.method === 'Fetch.requestPaused') {
          const {requestId,request} = message.params;
          const blocked = shouldBlockRequest(request.url, request.method);
          if (blocked) blockedRequests.push({method:request.method,host:new URL(request.url).hostname,path:new URL(request.url).pathname});
          browser.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', blocked ? {requestId,errorReason:'BlockedByClient'} : {requestId}).catch(e=>{requestFailure=e;});
        }
        if (message.method === 'Network.responseReceived' && /\/(index|worker)\.js(?:\?|$)/.test(message.params.response.url)) {
          const name = new URL(message.params.response.url).pathname.split('/').at(-1);
          sourceHashes[name] = {requestId:message.params.requestId,url:message.params.response.url};
        }
      };
      browser.listeners.add(handler);
      await browser.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
      await browser.send('Target.setDiscoverTargets',{discover:true});
      await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:guardSource});
      await browser.send('Page.navigate',{url:`${ORIGINAL_SITE}?${mapId}-view`});
      await until(async()=> { if(requestFailure) throw requestFailure; return browser.evaluate(readyExpression).catch(()=>false); },timeoutMs,500);
      const savedDisplay = await browser.evaluate(snapshotExpression);
      const hashes={};
      for (const [name, info] of Object.entries(sourceHashes)) {
        const body=await browser.send('Network.getResponseBody',{requestId:info.requestId}); hashes[name]=createHash('sha256').update(body.base64Encoded ? Buffer.from(body.body,'base64') : body.body).digest('hex');
      }
      assertPinnedSourceHash('index.js',hashes['index.js']);
      // >=100 chunks shows saved activeTasks until "Show New Tasks". Invoke
      // ONLY the source-verified builder's noDisplay branch. It updates the
      // in-memory model/HTML array without calling setCurrentChallenges or
      // changeChallengeColor (which calls setData). No clicks occur.
      await browser.evaluate(recomputeActiveExpression);
      captures[mapId] = await browser.evaluate(snapshotExpression);
      captures[mapId].initialDisplay={active:savedDisplay.active,domActive:savedDisplay.domActive};
      captures[mapId].activeProvenance='Original setupCurrentChallenges(tempChallengeArrSaved,true,true), audited noDisplay branch; initial saved display retained separately.';
      captures[mapId].computedHTML=await browser.evaluate(computedHTMLExpression);
      captures[mapId].computedList=await browser.evaluate('window.__parityComputedList');
      captures[mapId].activeModel=captures[mapId].active;
      captures[mapId].active=await browser.evaluate(canonicalActiveExpression);
      const workerDiagnostics=await readOriginalWorker(scratch);
      captures[mapId].nonValids=workerDiagnostics.nonValids;
      captures[mapId].workerDiagnostics=workerDiagnostics.diagnostic;
      const workerSource=await browser.evaluate("fetch('./worker.js?v=6.9.68').then(r=>{if(!r.ok)throw Error('Worker source unavailable');return r.text()})");
      hashes['worker.js']=createHash('sha256').update(workerSource).digest('hex');
      assertPinnedSourceHash('worker.js',hashes['worker.js']);
      captures[mapId].workerSourceProvenance='Same-URL browser GET after calculation; hash matches retained worker source, not an intercepted worker response.';
      captures[mapId].sourceHashes=hashes;
      captures[mapId].blockedRequests = blockedRequests;
      if (!captures[mapId].viewOnly) throw new Error('Read-only assertion failed');
    } finally {
      if(browser) { await browser.close(); }
      await safeRemoveScratch(scratch);
    }
  }
  return {capturedAt:new Date().toISOString(),site:ORIGINAL_SITE,maps:captures};
}

export async function runOriginalParityCli(argv=process.argv.slice(2)) {
  const options={};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--help') { process.stdout.write('node scripts/research/original-parity.mjs [--maps qxa,qxb] [--chrome PATH] [--data-dir WORKTREE-COPY] [--game-data PATH] [--map-assets PATH] [--original-capture PATH] [--capture-only] [--output .local/research/FILE.json]\nDefaults: read worktree .local/duo; writes ignored evidence only. Never starts a picker server.\n'); return; }
    if(argv[i]==='--capture-only') {options.captureOnly=true;continue;}
    const key=argv[i],value=argv[++i]; if(!value || value.startsWith('--')) throw new Error('Missing option value');
    if(key==='--maps') options.mapIds=value.split(','); else if(key==='--chrome') options.chrome=value;
    else if(key==='--output') options.output=path.resolve(value);
    else if(key==='--data-dir') options.dataDir=path.resolve(value);
    else if(key==='--game-data') options.gameDataDir=path.resolve(value);
    else if(key==='--map-assets') options.mapAssetsDir=path.resolve(value);
    else if(key==='--original-capture') options.originalCapture=path.resolve(value);
    else throw new Error(`Unknown option ${key}`);
  }
  const output=options.output ?? path.join(OUTPUT_ROOT,`original-parity-${new Date().toISOString().replaceAll(':','-')}.json`);
  if(path.dirname(output)!==OUTPUT_ROOT) throw new Error('Output must stay directly in worktree .local/research');
  await prepareOutputRoot();
  if(await lstat(output).catch(()=>null)) throw new Error('Refusing to overwrite existing evidence');
  const dataDir=options.dataDir ?? path.join(ROOT,'.local/duo');
  let model;
  try {
    if(!options.captureOnly) {
      const directory=await realpath(dataDir),relative=path.relative(await realpath(path.join(ROOT,'.local')),directory);
      if(!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Data directory must be a worktree-local copy, never the live store');
      const {loadLocalParityModel}=await import('./local-parity-model.mjs');
      model=await loadLocalParityModel({dataDir:directory,gameDataDir:options.gameDataDir,mapAssetsDir:options.mapAssetsDir});
    }
    const capture=options.originalCapture ? JSON.parse(await readFile(options.originalCapture,'utf8'))
      : await captureOriginal({mapIds:options.mapIds,chrome:options.chrome});
    const local={},comparisons={};
    if(model) for(const member of model.members) {
      const mapId=member.sourceMapId?.toLowerCase(); if(!capture.maps[mapId]) continue;
      const summary=await model.summarize(member.id); local[mapId]=summary;
      comparisons[mapId]=compareOriginalMap(capture.maps[mapId],summary,model);
    }
    const document=model ? {capture,source:model.source,local,comparisons} : capture;
    await writeFile(output,JSON.stringify(document),{flag:'wx'});
    process.stdout.write(JSON.stringify({output,capturedAt:capture.capturedAt,maps:Object.fromEntries(Object.entries(capture.maps).map(([id,m])=>[id,{viewOnly:m.viewOnly,unlocked:Object.keys(m.chunks.unlocked ?? {}).length,selected:Object.keys(m.chunks.selected ?? {}).length,active:m.active.length,possible:m.possible.length,completed:m.completed.length,backlog:m.backlog.length,
      ...(comparisons[id] ? {localActive:comparisons[id].active.localCount,localPossible:comparisons[id].possible.localCount,activeCommon:comparisons[id].active.common.length,possibleCommon:comparisons[id].possible.common.length} : {}),audit:m.audit,blockedRequests:m.blockedRequests.length}]))})+'\n');
    return document;
  } finally {await model?.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) runOriginalParityCli().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
