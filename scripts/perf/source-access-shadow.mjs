// Measurement only: never returns a computed contribution to the evaluator.
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
export function encodeShadow(value) {
  const visit = value => {
    if (typeof value === 'function' || typeof value === 'symbol') throw Error('UntrackedShadowValue');
    return value === null ? ['null'] : typeof value !== 'object'
    ? [typeof value, String(value)] : value instanceof Map ? ['map',[...value].map(([k,v])=>[visit(k),visit(v)])]
      : value instanceof Set ? ['set',[...value].map(visit)] : Array.isArray(value) ? ['array',value.map(visit)]
        : ['object',Object.entries(value).map(([k,v])=>[k,visit(v)])];
  };
  return JSON.stringify(visit(value));
}
export function createShadowLedger({ maxEntries = 4096, maxBytes = 32*1024**2 } = {}) {
  const entries=new Map(), digest=createHash('sha256'); let bytes=0,peakBytes=0,peakEntries=0;
  const counters={};
  function observe(kind,scope,input,reads,valid,value,{job=0,order,computeMs=0,empty=false,footprintHash}={}) {
    const c=counters[kind]??={observations:0,crossJobAttempts:0,crossJobHits:0,withinJobHits:0,misses:0,
      dependencyMisses:0,differences:0,fallbacks:0,outputBytes:0,crossJobBytes:0,crossJobHitBytes:0,
      emptyObservations:0,positiveReads:0,negativeReads:0,computeMs:0,crossJobHitComputeMs:0,evictions:0};
    c.observations++;c.computeMs+=computeMs;if(empty)c.emptyObservations++;
    if(!scope||!(reads instanceof Map)||typeof valid?.has!=='function'||(order!==undefined&&!Array.isArray(order))
      ||[...reads].some(([key,present])=>typeof present!=='boolean'||valid.has(key)!==present)){c.fallbacks++;return;}
    const key=sha(encodeShadow([kind,scope,input])), encoded=encodeShadow(value),hash=sha(encoded),outputBytes=Buffer.byteLength(encoded);
    const previous=entries.get(key), cross=!previous||previous.job!==job;
    c.outputBytes+=outputBytes;
    for(const present of reads.values())present?c.positiveReads++:c.negativeReads++;
    if(cross){c.crossJobAttempts++;c.crossJobBytes+=outputBytes;}
    const matched=previous&&previous.reads.every(([key,present])=>valid.has(key)===present)
      &&(!previous.order||previous.order.length===valid.size&&[...valid].every((key,i)=>key===previous.order[i]));
    if(matched){
      if(previous.hash!==hash)c.differences++;
      else if(cross){c.crossJobHits++;c.crossJobHitBytes+=outputBytes;c.crossJobHitComputeMs+=computeMs;}
      else c.withinJobHits++;
    } else {c.misses++;if(previous)c.dependencyMisses++;}
    digest.update(encodeShadow([kind,key,hash,(footprintHash??sha(encodeShadow([...reads]))),Boolean(matched),job]));
    if(previous){entries.delete(key);bytes-=previous.bytes;}
    const entry={reads:[...reads],order,job,hash};
    entry.bytes=Buffer.byteLength(JSON.stringify([key,entry]));
    if(maxEntries>0&&entry.bytes<=maxBytes){
      entries.set(key,entry);bytes+=entry.bytes;
      while(entries.size>maxEntries||bytes>maxBytes){const [oldKey,old]=entries.entries().next().value;entries.delete(oldKey);bytes-=old.bytes;c.evictions++;}
    } else c.fallbacks++;
    peakBytes=Math.max(peakBytes,bytes);peakEntries=Math.max(peakEntries,entries.size);
  }
  return {observe,report(){return {counters:structuredClone(counters),entries:entries.size,retainedSerializedBytes:bytes,
    peakSerializedBytes:peakBytes,peakEntries,maxEntries,maxBytes,hash:digest.copy().digest('hex')};}};
}
// Inputs come from baseItemSourceView, including hidden per-location quantities.
// Shop task-stock gates use exactly the selector/location references read by
// collectBaseItemSources. Other roots read their own locations, rules/backlogs
// and task gates. Whole-collector task reads deliberately over-invalidate roots.
export function sourceRootInputs(definitions,view) {
  const [bases,sections,areas,backlogs,spawns,shops,monsters,objects]=JSON.parse(view);
  if(JSON.parse(view).length!==8||![bases,sections,areas,spawns,shops,monsters,objects].every(Array.isArray))throw Error('ShadowViewError');
  const roots=new Map(),key=(kind,name)=>JSON.stringify([kind,name]);
  for(const [kind,rows] of [['spawn',spawns],['shop',shops],['drop',monsters],['object',objects]])for(const row of rows){
    if(typeof row[0]!=='string'||!Array.isArray(row[1]))throw Error('ShadowRootError');
    roots.set(key(kind,row[0]),{input:[row,backlogs],events:[]});
  }
  const sets=[new Set(bases),new Set(sections),new Set(areas)];
  for(const [selector,locations] of Object.entries(definitions.taskUnlocks?.Shops??{})){
    const [shop,item]=selector.split('^');if(!item)continue;
    const id=key('shop',shop),root=roots.get(id)??{input:[null,backlogs],events:[]};
    (root.stock??=[]).push([selector,Object.keys(locations).map(location=>[location,...sets.map(set=>set.has(location))])]);
    roots.set(id,root);
  }
  return roots;
}
export function createSourceAccessShadow({ datasetDigest, ...limits }={}) {
  const ledger=createShadowLedger(limits),scopes=new WeakMap(),captures=new WeakMap();
  let sequence=0,job=0,faults=0,ambiguous=0,traceMs=0,sourceCalls=0,accessCalls=0;
  const now=()=>performance.now();
  const scope=value=>{
    if(!value||typeof value!=='object'||!/^[a-f0-9]{64}$/.test(datasetDigest??''))return;
    if(!scopes.has(value))scopes.set(value,++sequence);
    return [datasetDigest,scopes.get(value)];
  };
  return {now,job(value){job=value;},fault(){faults++;},
    capture(value,events,computeMs){captures.set(value,{events,computeMs});},
    sources(definitions,view,rules,entry,valid){
      const start=now();sourceCalls++;
      try{
        const captured=captures.get(entry.value);captures.delete(entry.value);
        const options={job,computeMs:captured?.computeMs??0,footprintHash:sha(encodeShadow([...entry.reads]))},rulesKey=sha(encodeShadow(rules));
        ledger.observe('sourceWhole',scope(definitions),[view,rulesKey],entry.reads,valid,entry.value,options);
        if(!captured){ambiguous++;return;}
        const roots=sourceRootInputs(definitions,view),backlogsKey=sha(encodeShadow(JSON.parse(view)[3]));
        for(const [item,reason] of captured.events){
          const id=JSON.stringify([reason.kind,reason.kind==='spawn'?item:reason.source]);
          const root=roots.get(id);if(!root){ambiguous++;return;}root.events.push([item,reason]);
        }
        for(const [id,root] of roots)ledger.observe('sourceRoot',scope(definitions),[id,root.input[0],backlogsKey,root.stock,rulesKey],entry.reads,valid,root.events,
          {job,empty:root.events.length===0,footprintHash:options.footprintHash});
      }catch{faults++;}finally{traceMs+=now()-start;}
    },
    access(index,inputSignature,owner,key,rules,entry,valid,view,computeMs){
      const start=now();accessCalls++;
      try{ledger.observe('accessWhole',typeof inputSignature==='string'&&/^[a-f0-9]{64}$/.test(inputSignature)?scope(index):undefined,[inputSignature,owner,key,rules],entry.reads,valid,[entry.value,view],{job,order:entry.order,computeMs});}
      catch{faults++;}finally{traceMs+=now()-start;}
    },
    report(){return {...ledger.report(),sourceCalls,accessCalls,faults,ambiguous,traceMs,scopes:sequence};},
  };
}
export function instrumentShadow(source,kind) {
  const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('ShadowAnchorError');source=source.replace(from,to);};
  const global="globalThis[Symbol.for('rs3.source.shadow')]";
  if(kind==='engine'){
    replace('      const value = calculateAccess(index, evaluationState, ownerId,',`      const __shadowAccessStart = ${global}.now();\n      const value = calculateAccess(index, evaluationState, ownerId,`);
    replace('      entry = { value, reads, order }; entries.push(entry); cache.set(key, entries);',
      `      entry = { value, reads, order }; entries.push(entry); cache.set(key, entries);\n      try { ${global}.access(index, eligibilityInputKey(evaluationState, ownerId), ownerId, key, rules, entry, valid, baseItemSourceView(value), ${global}.now()-__shadowAccessStart); } catch { ${global}.fault(); }`);
    replace('        replay.baseCollections++;',`        replay.baseCollections++;\n        if (!proof) ${global}.sources(definitions, view, rules, entry, valid);`);
  }else if(kind==='access'){
    const marker='export function collectBaseItemSources(';const start=source.indexOf(marker);if(start<0)throw Error('ShadowAnchorError');
    const head=source.slice(0,start);source=source.slice(start);
    replace('  const result = { items: new Set(), sources: new Map(), diagnostics: [] };',
      `  const __shadowStart = ${global}.now(), __shadowEvents = proof ? null : [];\n  const result = { items: new Set(), sources: new Map(), diagnostics: [] };`);
    replace('    result.items.add(item);','    __shadowEvents?.push([item, reason]);\n    result.items.add(item);');
    replace('  return result;\n}',`  if (__shadowEvents) ${global}.capture(result, __shadowEvents, ${global}.now()-__shadowStart);\n  return result;\n}`);
    source=head+source;
  }else throw Error('ShadowModuleError');
  return source;
}
