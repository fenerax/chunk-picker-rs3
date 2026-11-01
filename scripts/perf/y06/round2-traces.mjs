// Analyze numeric public request/job traces; never read saved gameplay.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {requireNode,summary} from './runtime.mjs';
requireNode();
const arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const primary=JSON.parse(await readFile(arg('--primary'), 'utf8')),longer=process.argv.includes('--long')?JSON.parse(await readFile(arg('--long'),'utf8')):{trials:[],censored:[{reason:'not yet measured'}]};
const f=x=>Number.isFinite(x)?x.toFixed(1):'—',sum=(ts,fn)=>ts.reduce((n,t)=>n+fn(t),0),spread=a=>{const s=summary(a);return `${f(s.p50)} [${f(s.min)}–${f(s.max)}]`;};
const overlap=(job,hosts)=>{
  const group=job.type==='sandbox'||job.type==='predict'?'advisory':'foreground',starts=new Map(),intervals=[];
  for(const h of hosts){if(h.group!==group)continue;if(h.event==='allocate')starts.set(h.id,h.at);if(h.event==='ready'&&starts.has(h.id)){const a=Math.max(job.queuedAt,starts.get(h.id)),b=Math.min(job.startedAt,h.at);if(b>a)intervals.push([a,b]);}}
  intervals.sort((a,b)=>a[0]-b[0]);let total=0,end=-Infinity;for(const[a,b]of intervals){total+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}return total;
};
const lines=['# Round-2 causal before/after measurements','','Before = round-1 candidate at b48b7c4, including its fair cold queue. After = the same code with only warm router acquisition moved outside the cold residency mutex. Existing hard limits remain fixed. These are separate from the original-main comparison. All figures are nearest-rank cross-trial p50 [min–max], not pooled percentiles or confidence intervals.'];
function campaign(label,report){
  const ts=report.trials;lines.push('',`## ${label}`,'',`${ts.length} complete trials; ${report.censored.length} censored. Trace SHA-256 ${report.traceSha256??'unmeasured'}.`,'','| Mode | Quiet success / offered | Raw p95/p99 state ms | Raw p95/p99 tasks ms | Raw p95/p99 draft ms | Peak RSS MiB |','| --- | ---: | --- | --- | --- | --- |');
  for(const mode of ['baseline','candidate']){const a=ts.filter(t=>t.mode===mode);if(!a.length)continue;lines.push(`| ${mode==='baseline'?'before':'after'} | ${sum(a,t=>t.quiet.successes)} / ${sum(a,t=>t.scheduledQuiet)} | ${['state','tasks','draft'].map(ep=>['p95','p99'].map(q=>spread(a.map(t=>t.quietEndpoints[ep].allMs[q]))).join(' / ')).join(' | ')} | ${spread(a.map(t=>t.treePeakBytes/1024**2))} |`);}
  lines.push('','| Mode | Endpoint | Failure-ceiling p95 ms | Failure-ceiling p99 ms | Samples |','| --- | --- | --- | --- | ---: |');
  for(const mode of ['baseline','candidate'])for(const ep of ['state','tasks','draft']){const a=ts.filter(t=>t.mode===mode);if(!a.length)continue;const q=a.map(t=>summary(t.rawQuiet.filter(r=>r.type===ep).map(r=>r.status===200?r.ms:2000)));lines.push(`| ${mode==='baseline'?'before':'after'} | ${ep} | ${spread(q.map(x=>x.p95))} | ${spread(q.map(x=>x.p99))} | ${sum(q,x=>x.n)} |`);}
  lines.push('','| Mode | Warm quiet acquisitions | Warm acquisition p95 ms | Maximum warm wait ms | Cold acquisition p95 ms | Advisory allocations |','| --- | ---: | --- | --- | --- | ---: |');
  for(const mode of ['baseline','candidate']){const a=ts.filter(t=>t.mode===mode);if(!a.length)continue;const values=warm=>a.map(t=>summary(t.trace.requests.flatMap(r=>r.stages.filter(s=>s.name==='acquire'&&s.warm===warm).map(s=>s.ms))));const warm=values(true),cold=values(false);lines.push(`| ${mode==='baseline'?'before':'after'} | ${sum(warm,x=>x.n)} | ${spread(warm.map(x=>x.p95))} | ${f(Math.max(...warm.map(x=>x.max??0)))} | ${spread(cold.map(x=>x.p95))} | ${sum(a,t=>t.trace.hosts.filter(h=>h.group==='advisory'&&h.event==='allocate').length)} |`);}
  lines.push('','Completion-aware per-seed p95 checks (all failures at 2000 ms):','');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const ep of ['state','tasks','draft']){
    const values=['baseline','candidate'].map(mode=>summary(ts.filter(t=>t.seed===seed&&t.mode===mode).map(t=>summary(t.rawQuiet.filter(r=>r.type===ep).map(r=>r.status===200?r.ms:2000)).p95)).p50);
    const threshold=values[0]+Math.max(5,values[0]*.1);
    lines.push(`- Seed ${seed}, ${ep}: ${f(values[0])} → ${f(values[1])} ms, threshold ${f(threshold)} ms: ${values[1]<=threshold?'PASS':'FAIL'}.`);
  }
  lines.push('','Exact refusal totals (diagnostic scope, including all phases):','');
  for(const mode of ['baseline','candidate']){const counts={};for(const t of ts.filter(t=>t.mode===mode))for(const[k,v]of Object.entries(t.trace.refusals))counts[k]=(counts[k]??0)+v;lines.push(`- ${mode==='baseline'?'before':'after'}: \`${JSON.stringify(counts)}\`.`);}
  const cases=[];for(const t of ts){const byId=new Map(t.rawQuiet.map(r=>[r.id,r]));for(const trace of t.trace.requests){const r=byId.get(trace.id);assert.ok(r);if(r.status!==200){cases.push({mode:t.mode,seed:t.seed,pair:t.pair,id:r.id,type:r.type,status:r.status,reason:r.reason,refusals:trace.refusals});}if(r.status===200&&r.ms>=250){const acquire=trace.stages.find(x=>x.name==='acquire'),jobs=trace.jobs.filter(j=>j.stage==='request'),dominant=[...jobs].sort((a,b)=>(b.waitMs+b.serviceMs)-(a.waitMs+a.serviceMs))[0];cases.push({mode:t.mode,seed:t.seed,pair:t.pair,id:r.id,type:r.type,ms:r.ms,acquireMs:acquire?.ms,warm:acquire?.warm,job:dominant?.type,queueMs:dominant?.waitMs,serviceMs:dominant?.serviceMs,startupOverlapMs:dominant?overlap(dominant,t.trace.hosts):0});}}}
  lines.push('','Retained causal cases: every quiet failure and every successful quiet request ≥250 ms. Request IDs are synthetic counters local to each trial. Queue intervals include host readiness; startup overlap is the union of allocate→ready intervals intersecting the dominant job\'s queued→started interval. These intervals are not added to each other.','');for(const c of cases)lines.push(`- \`${JSON.stringify(c)}\``);
  lines.push('',`Bounds: contexts max ${Math.max(0,...ts.map(t=>t.diagnostics.contexts.max))}; calculators max ${Math.max(0,...ts.map(t=>t.workerPeak))}; known post-close children ${sum(ts,t=>t.childrenAfterClose)}; drain samples ${sum(ts,t=>t.afterDrainBytes.length)}/${ts.length*3}; OOM/kill ${sum(ts,t=>t.oom)}/${sum(ts,t=>t.oomKill)}; memory breaches ${ts.filter(t=>t.guard).length}; validation differences ${sum(ts,t=>t.validationDifferences)}.`);
  return cases;
}
campaign('24-second arrivals: 3 matched pairs per seed',primary);campaign('120-second arrivals: 2 matched pairs (partial repetition)',longer);


if(process.argv.includes('--confirmation')){
  const more=JSON.parse(await readFile(arg('--confirmation'),'utf8'));
  assert.equal(more.traceSha256,primary.traceSha256);
  assert.equal(more.harnessSha256,primary.harnessSha256);
  campaign('Fixed confirmation: 2 additional seed-73 pairs',more);
  const both=[...primary.trials.filter(t=>t.seed===73),...more.trials];
  lines.push('','## Seed 73 combined: five matched pairs','','Initial results remain included. Same app, harness and trace bytes.','','| Endpoint | Observed p95 B/C | Observed p99 B/C | Ceiling p95 B/C | Ceiling p99 B/C | Ceiling p95 gate |','| --- | --- | --- | --- | --- | --- |');
  for(const ep of ['state','tasks','draft']){
    const stats=['baseline','candidate'].map(mode=>{const a=both.filter(t=>t.mode===mode);return {raw:a.map(t=>t.quietEndpoints[ep].allMs),ceiling:a.map(t=>summary(t.rawQuiet.filter(r=>r.type===ep).map(r=>r.status===200?r.ms:2000)))};});
    const cols=['raw','ceiling'].flatMap(kind=>['p95','p99'].map(q=>stats.map(s=>spread(s[kind].map(x=>x[q]))).join(' / ')));
    const med=stats.map(s=>summary(s.ceiling.map(x=>x.p95)).p50);
    lines.push(`| ${ep} | ${cols.join(' | ')} | ${med[1]<=med[0]+Math.max(5,med[0]*.1)?'PASS':'FAIL'} |`);
  }
}
await writeFile(arg('--out','docs/experiments/y06-admission-fairness.round2-traces.md'),lines.join('\n')+'\n');
