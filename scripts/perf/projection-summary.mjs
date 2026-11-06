// Rebuild the Phase 4 numeric/hash artifact from the retained observations.
import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {summary,pairedComparison} from './final-projection-ab.mjs';
import {sha} from './calculator-input.mjs';

export function validateMeasurements(value){
  if(typeof value==='string'){
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64}|v\d+\.\d+\.\d+|projection-[a-z0-9-]+-v1|mixed|preview|member1|shared|\d{4}-\d\d-\d\dT[\d:.+Z-]+)$/.test(value))throw Error('MeasurementStringError');
  }else if(typeof value==='number'&&!Number.isFinite(value))throw Error('MeasurementNumberError');
  else if(value&&typeof value==='object')for(const child of Object.values(value))validateMeasurements(child);
}
const sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);
const correlation=(x,y)=>{
  const average=a=>a.reduce((n,v)=>n+v,0)/a.length,mx=average(x),my=average(y);
  const top=x.reduce((n,v,i)=>n+(v-mx)*(y[i]-my),0),bottom=Math.sqrt(x.reduce((n,v)=>n+(v-mx)**2,0)*y.reduce((n,v)=>n+(v-my)**2,0));
  return bottom?top/bottom:null;
};
export function summarizeGC(trials){
  const out={};
  for(const population of ['mixed','preview']){
    const rows=trials.filter(t=>t.population===population).map(t=>{
      const request=t.after.workers[0].memoryUsage.requests.find(r=>r.id===t.measurement.id);
      if(!request)throw Error('GCRequestError');
      const before=t.before.main.projectionGC,after=t.after.main.projectionGC;
      return {mode:t.mode,wallMs:t.measurement.wallMs,heapBefore:request.heapBefore.used,passes:request.passesAfter-request.passesBefore,
        ...request.gc,hostCount:after.count-before.count,hostPauseMs:after.pauseMs-before.pauseMs,hostMajorCount:after.majorCount-before.majorCount};
    });
    if(!rows.length)continue;
    const arms={};
    for(const mode of [0,1]){
      const a=rows.filter(r=>r.mode===mode);
      arms[mode]={requests:a.length,wallMs:summary(a.map(r=>r.wallMs)),heapBefore:summary(a.map(r=>r.heapBefore)),passes:sum(a,'passes'),
        gcCount:sum(a,'count'),gcPauseMs:summary(a.map(r=>r.pauseMs)),gcPauseTotalMs:sum(a,'pauseMs'),majorRequests:a.filter(r=>r.majorCount>0).length,majorCount:sum(a,'majorCount'),majorPauseTotalMs:sum(a,'majorPauseMs'),hostGCCount:sum(a,'hostCount'),hostGCPauseTotalMs:sum(a,'hostPauseMs'),hostMajorCount:sum(a,'hostMajorCount')};
    }
    const sorted=[...rows].sort((a,b)=>a.wallMs-b.wallMs),tail=sorted.slice(Math.floor(sorted.length*.75));
    const conditioned={};for(const major of [0,1]){const a=rows.filter(r=>Number(r.majorCount>0)===major);conditioned[major]=a.length?summary(a.map(r=>r.wallMs)):null;}
    out[population]={arms,correlationPauseWall:correlation(rows.map(r=>r.wallMs),rows.map(r=>r.pauseMs+r.hostPauseMs)),conditioned,tail:{requests:tail.length,majorRequests:tail.filter(r=>r.majorCount>0).length,pauseMs:summary(tail.map(r=>r.pauseMs)),wallMs:summary(tail.map(r=>r.wallMs))}};
  }
  return out;
}
export function summarizeIdle(reference,candidate,{allowInterrupted=false}={}){
  const arm=r=>{
    if((!r.complete&&!allowInterrupted)||r.samples.length<13||r.samples.at(-1).elapsedMs<3600000)throw Error('IdleIncomplete');
    const first=r.samples[0],last=r.samples.at(-1),scopes={};
    for(const scope of ['worker','parent'])scopes[scope]={startBytes:first[scope].VmRSS,endBytes:last[scope].VmRSS,driftBytes:last[scope].VmRSS-first[scope].VmRSS,peakBytes:Math.max(...r.samples.map(s=>s[scope].VmHWM))};
    return {scheduledComplete:!!r.complete,samples:r.samples.length,durationMs:last.elapsedMs,...scopes};
  };
  const a=arm(reference),b=arm(candidate);
  return {reference:a,candidate:b,endExtraBytes:b.worker.endBytes-a.worker.endBytes,driftDifferenceBytes:b.worker.driftBytes-a.worker.driftBytes};
}
// Require the fixed complete cohort; never silently drop missing/duplicate arms.
export function summarizeWarm(report){
  const expected={preview:48,mixed:48,member1:48,shared:48};
  if(!report.complete||report.differences||JSON.stringify(report.signature.plan)!==JSON.stringify(expected)||report.trials.length!==384)throw Error('CohortIncomplete');
  const warm={},sequences={};
  for(const [population,n]of Object.entries(expected)){
    const rows=report.trials.filter(t=>t.population===population),pairs=[];
    for(let block=0;block<n;block++){
      const pair=[0,1].map(mode=>{
        const arms=rows.filter(t=>t.block===block&&t.mode===mode);
        if(arms.length!==1)throw Error('PairCountError');
        return arms[0];
      });
      if(pair[0].resultHash!==pair[1].resultHash)throw Error('ResultDifference');
      pairs.push(pair);
    }
    const compare=key=>{
      const values=pairs.map(p=>p.map(t=>t.measurement[key]));
      return {...pairedComparison(values),pairedDifferences:summary(values.map(([a,b])=>b-a))};
    };
    const result=compare('wallMs');
    warm[population]={...result,marginMs:result.reference.median*.05,withinMargin:result.pairedBootstrap95[1]<=result.reference.median*.05,
      memory:Object.fromEntries([0,1].map(mode=>[mode,{rssBytes:summary(rows.filter(t=>t.mode===mode).map(t=>t.workerMemory.VmRSS)),peakBytes:summary(rows.filter(t=>t.mode===mode).map(t=>t.workerMemory.VmHWM))}]))};
    if(['preview','shared'].includes(population))sequences[population]=compare('sequenceWallMs');
  }
  return {warm,sequences};
}
async function main(){
  const {values:args}=parseArgs({options:{root:{type:'string'},out:{type:'string'}}});
  const docs=fileURLToPath(new URL('../../docs/perf/',import.meta.url)),target=path.resolve(args.out??'');
  if(!args.root?.startsWith('/tmp/')||!target.endsWith('.json')||!(target.startsWith('/tmp/')||target.startsWith(docs)))throw Error('OptionsError');
  const bytes=await readFile(path.join(args.root,'warm/measurements.json')),observations=JSON.parse(bytes);
  validateMeasurements(observations);
  const metrics=summarizeWarm(observations);
  // Historical controls are supplied by the Phase 4b brief; raw artifacts were
  // unavailable in this checkout. These values are not new measurements.
  const suppliedControls={independentlyRerun:false,gc:{pairsPerPopulation:10,
    mixed:{naturalDifferenceMs:267,collectedDifferenceMs:10,collectedBootstrap95Ms:[-61,38]},
    preview:{naturalDifferenceMs:258,collectedDifferenceMs:30,collectedBootstrap95Ms:[-38,72]},evaluatorPasses:0},
    idle:{durationMs:3600000,previewEndExtraMiB:9.1,mixedEndExtraMiB:4.0,limitMiB:40}};
  const report={format:'projection-phase4-v1',start:'e7d108886e8f2619dd9ee2b4cf6b1ebf2b4d204a',
    complete:true,sourceSHA256:sha(bytes),...metrics,suppliedControls,observations};
  report.gates={sequencesWin:Object.values(metrics.sequences).every(m=>m.pairedBootstrap95[1]<0),
    warmWithinMargin:Object.values(metrics.warm).every(m=>m.withinMargin),idleWithinLimit:[suppliedControls.idle.previewEndExtraMiB,suppliedControls.idle.mixedEndExtraMiB].every(value=>value<=suppliedControls.idle.limitMiB)};
  report.turnOn=Object.values(report.gates).every(Boolean);
  for(const [key,file]of [['audit','audit-summary.json'],['validation','validation.json']]){
    try{report[key]=JSON.parse(await readFile(path.join(args.root,file)));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  validateMeasurements(report);await writeFile(target,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pairs:observations.trials.length/2,differences:observations.differences,gates:report.gates,turnOn:report.turnOn}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error.name,site:[...(error.stack??'').matchAll(/projection-summary.mjs:(\d+):(\d+)/g)].map(m=>m.slice(1))}));process.exitCode=1;});
