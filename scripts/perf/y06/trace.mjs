// Optional public-harness probes only. No app files or decisions are changed.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function createTrace(root){
  const storage=new AsyncLocalStorage(),records=new Map(),hosts=[],events=[];let hostId=0;
  const trace={
    current:()=>storage.getStore()?.id,
    stage:()=>storage.getStore()?.stage,
    run(request,work){const id=Number(request.headers['x-y06-trace']);if(!Number.isSafeInteger(id)||id<1)return work();const row={id,at:performance.now(),stages:[],components:[],jobs:[],refusals:[]};records.set(id,row);return storage.run({id,stage:'request'},async()=>{try{return await work();}finally{row.ms=performance.now()-row.at;}});},
    bind(work){const context=storage.getStore();return (...args)=>storage.run(context,()=>work(...args));},
    async measure(name,work,extra={}){const context=storage.getStore(),row=records.get(context?.id),at=performance.now();try{return await storage.run({...context,stage:name},work);}finally{row?.stages.push({name,at,ms:performance.now()-at,...extra});}},
    lifecycle(event,entry){events.push({event,at:performance.now(),type:entry?.type,discarded:!!entry?.discarded,warm:!!entry?.warm});},
    job(entry){if(entry.discarded)trace.lifecycle('cancelled-completion',entry);const row=records.get(entry._y06Trace);if(row)row.jobs.push({type:entry.type,warm:!!entry.warm,stage:entry._y06Stage,queuedAt:entry.queuedAt,startedAt:entry.startedAt,finishedAt:performance.now(),waitMs:entry.startedAt-entry.queuedAt,serviceMs:performance.now()-entry.startedAt});},
    component(name,ms){records.get(storage.getStore()?.id)?.components.push({name,ms});},
    refusal(value){records.get(storage.getStore()?.id)?.refusals.push(value);},
    host(event,slot){if(!slot._y06Host)slot._y06Host=++hostId;hosts.push({event,id:slot._y06Host,group:slot.group,at:performance.now()});},
    reset(){records.clear();hosts.length=events.length=0;},
    metrics:()=>({requests:[...records.values()],hosts,events}),
  };
  globalThis[Symbol.for('y06.trace')]=trace;
  const g="globalThis[Symbol.for('y06.trace')]";
  const replace=(source,from,to)=>{assert.ok(source.includes(from),'Trace seam missing: '+from.slice(0,70));return source.replace(from,to);};
  registerHooks({load(url,context,next){const result=next(url,context);const name=['app/server.mjs','app/picker-router.mjs','app/security/picker-limits.mjs','app/tasks/scheduler.mjs','app/tasks/calculator-pool.mjs','app/picker-context.mjs'].find(name=>url===pathToFileURL(path.join(root,name)).href);if(!name)return result;let s=String(result.source??readFileSync(new URL(url),'utf8'));
    if(name==='app/server.mjs'){
      s=replace(s,'const requestHandler = (request, response, listener = { host, ingressRole }) => {',`const requestHandler = (request, response, listener = { host, ingressRole }) => ${g}.run(request, () => {`);
      s=replace(s,'  };\n  const headerOptions =','  });\n  const headerOptions =');
    }else if(name==='app/picker-router.mjs'){
      if(s.includes('admission.run(owner, open, signal)'))s=replace(s,'admission.run(owner, open, signal)',`admission.run(owner, ${g}.bind(open), signal)`);
      s=replace(s,'await evict(victim);',`await ${g}.measure('eviction', () => evict(victim));`);
    }else if(name==='app/security/picker-limits.mjs'){
      s=replace(s,'return { entry, limit };',"return { entry, limit, scope: key.split(':')[1], kind: key.split(':')[0] };");
      s=replace(s,"for (const { entry, limit } of selected) if (entry.count + amount > limit) throw refusal(message, Math.max(1, Math.ceil((entry.until - at) / 1000)));",`for (const { entry, limit, scope, kind } of selected) if (entry.count + amount > limit) { ${g}.refusal({kind:'rate',budget:kind,scope,count:entry.count,limit,amount,scopeCounts:selected.map(x=>({scope:x.scope,count:x.entry.count,limit:x.limit}))}); throw refusal(message, Math.max(1, Math.ceil((entry.until - at) / 1000))); }`);
    }else if(name==='app/tasks/scheduler.mjs'){
      s=replace(s,'function retire() {',`function retire() { ${g}.lifecycle('retire',active);`);
      if(s.includes('if (!cancelledGrace) {'))s=replace(s,'if (!cancelledGrace) {',`if (!cancelledGrace) { ${g}.lifecycle('grace',active);`);

      s=replace(s,'if (count >= maxOutstandingJobsPerPicker) return;',`if (count >= maxOutstandingJobsPerPicker) { ${g}.refusal({kind:'picker-outstanding',count,limit:maxOutstandingJobsPerPicker}); return; }`);
      s=replace(s,'if (count() >= limit) return;',`if (count() >= limit) { ${g}.refusal({kind:'picker-lane',count:count(),limit}); return; }`);
      s=replace(s,"if (queue.length >= maxQueue && (calculatorPool || active || status !== 'ready')) {",`if (queue.length >= maxQueue && (calculatorPool || active || status !== 'ready')) { ${g}.refusal({kind:'calculator-queue',depth:queue.length,limit:maxQueue,ownQueued:queue.filter(e=>e.pickerId===pickerId).length,shares:[...new Set(queue.map(e=>e.pickerId))].map(id=>queue.filter(e=>e.pickerId===id).length).sort((a,b)=>b-a)});`);
      s=replace(s,'entry = { releaseFair, key, originalKey, pickerId, input, state, stateInput, memberId, type,',`entry = { _y06Trace:${g}.current(), _y06Stage:${g}.stage(), releaseFair, key, originalKey, pickerId, input, state, stateInput, memberId, type,`);
      s=replace(s,'const entry = active; active = undefined; deadlineClock.clearTimeout(entry.timer);',`const entry = active; active = undefined; deadlineClock.clearTimeout(entry.timer); ${g}.job(entry);`);
    }else if(name==='app/picker-context.mjs'){
      s=replace(s,'const saved = await store.getStateSnapshot({ view });',`const saved = await ${g}.measure('stateProjection', () => store.getStateSnapshot({ view }));`);
      s=replace(s,'await sendCached(request, response, await stateRepresentation(view, info)); return;',`await ${g}.measure('stateSend', async () => { const body = await ${g}.measure('stateBody', () => stateRepresentation(view, info)); return sendCached(request, response, body); }); return;`);

      for(const [field,start] of [['storeMs','storeStarted'],['authMs','authStarted'],['variantMs','started'],['stateResponseMs','started']]){
        const needle=`startupTimingMs.${field} = performance.now() - ${start};`;
        s=replace(s,needle,`${needle} ${g}.component('${field}',startupTimingMs.${field});`);
      }
    }else{
      s=replace(s,'if (slot.stopping) return slot.stopping;',`if (slot.stopping) return slot.stopping; ${g}.host('retire',slot);`);
      s=replace(s,'slots.add(slot); peak = Math.max(peak, slots.size);',`${g}.host('allocate',slot); slots.add(slot); peak = Math.max(peak, slots.size);`);
      s=replace(s,"slot.worker.on('exit', () => {",`slot.worker.on('exit', () => { ${g}.host('exit',slot);`);
      s=replace(s,'clearTimeout(slot.startupTimer); slot.pendingOwner = undefined; slot.ready = true;',`clearTimeout(slot.startupTimer); slot.pendingOwner = undefined; slot.ready = true; ${g}.host('ready',slot);`);
    }
    return {...result,source:s};
  }});
  return trace;
}
