// Numeric public HTTP traces only. Never opens gameplay or private inputs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {requireNode,summary} from './runtime.mjs';
requireNode();
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const load=async name=>JSON.parse(await readFile(arg(name),'utf8'));
const primary=await load('--primary'),longer=process.argv.includes('--long')?await load('--long'):{trials:[],censored:[]};
for(const report of [primary,longer])for(const t of report.trials){
  assert.equal(t.rawQuiet.length,t.scheduledQuiet);
  assert.equal(t.rawQuiet.length,t.quiet.attempts);
  assert.ok(t.rawQuiet.every(r=>Number.isFinite(r.ms)&&r.ms>=0));
  assert.equal(t.afterDrainBytes.length,3);
  assert.ok(t.afterDrainBytes.every(n=>Number.isFinite(n)&&n>0));
  assert.equal(t.trace.requests.length,t.rawQuiet.filter(r=>r.id!==undefined).length);
  assert.equal(t.quiet.successes,t.rawQuiet.filter(r=>r.status===200).length);
  assert.ok(t.diagnostics.contexts.max<=7&&t.workerPeak<=2);
  assert.ok(t.admission.activePeak<=1&&t.admission.pendingPeak<=64);
  assert.equal(t.admission.finalPending,0);
  assert.ok(t.drained&&!t.guard&&!t.oom&&!t.oomKill);
  assert.equal(t.childrenAfterClose+t.validationDifferences,0);
  const ids=t.rawQuiet.map(r=>r.id);assert.equal(new Set(ids).size,ids.length);

}
if(longer.trials.length){assert.equal(primary.traceSha256,longer.traceSha256);assert.equal(primary.harnessSha256,longer.harnessSha256);}
for(const mode of ['baseline','candidate']){
  const source=[...primary.trials,...longer.trials].filter(t=>t.mode===mode).map(t=>t.sourceHashes);
  for(const value of source)assert.deepEqual(value,source[0],'Application changed during measurement');
}
for(const seed of new Set(primary.trials.map(t=>t.seed))){
  const pairs=mode=>primary.trials.filter(t=>t.seed===seed&&t.mode===mode).map(t=>t.pair).sort();
  assert.deepEqual(pairs('baseline'),pairs('candidate'),'Unmatched seed pairs');
}
const sum=(a,fn)=>a.reduce((n,x)=>n+fn(x),0),med=a=>summary(a).p50;
const f=x=>Number.isFinite(x)?x.toFixed(1):'—';
const spread=a=>{const s=summary(a);return `${f(s.p50)} [${f(s.min)}–${f(s.max)}]`;};
const pair=a=>a.map(f).join(' → '),modes=['baseline','candidate'],endpoints=['state','tasks','draft'];
const quant=(t,ep,ceiling)=>summary(t.rawQuiet.filter(r=>r.type===ep).map(r=>ceiling&&r.status!==200?2000:r.ms));
// Startup is a SUBSET of queue wait. Intersect and union intervals, never add it.
function startup(job,hosts){
  const group=['sandbox','predict'].includes(job.type)?'advisory':'foreground',starts=new Map(),intervals=[];
  for(const h of hosts){if(h.group!==group)continue;if(h.event==='allocate')starts.set(h.id,h.at);if(h.event==='ready'&&starts.has(h.id)){
    const a=Math.max(starts.get(h.id),job.queuedAt),b=Math.min(h.at,job.startedAt);if(b>a)intervals.push([a,b]);
  }}
  intervals.sort((a,b)=>a[0]-b[0]);let end=-Infinity,total=0;
  for(const[a,b]of intervals){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;
}
function attribution(t,r){
  const trace=t.trace.requests.find(x=>x.id===r.id);assert.ok(trace,'Missing quiet trace');
  const stage=name=>sum(trace.stages.filter(s=>s.name===name),s=>s.ms);
  const acquire=stage('acquire'),factory=stage('factory'),eviction=stage('eviction');
  const jobs=trace.jobs.filter(j=>j.stage==='request'),factoryJobs=trace.jobs.filter(j=>j.stage==='factory');
  const wait=sum(jobs,j=>j.waitMs),service=sum(jobs,j=>j.serviceMs),host=sum(jobs,j=>startup(j,t.trace.hosts));
  return {id:r.id,picker:r.picker,status:r.status,ms:r.ms,admission:Math.max(0,acquire-factory-eviction),eviction,open:factory,wait,host,service,other:r.ms-acquire-wait-service,
    factoryWait:sum(factoryJobs,j=>j.waitMs),factoryService:sum(factoryJobs,j=>j.serviceMs),factoryHost:sum(factoryJobs,j=>startup(j,t.trace.hosts)),
    components:Object.fromEntries(trace.components.map(c=>[c.name,c.ms])),jobs:trace.jobs};
}
const lines=['# Round-3 measurements','','Milliseconds; nearest-rank per-trial quantiles. Cross-trial median [minimum–maximum]. Before = d64eef2275f3b7591b2d5e4831c209a66c2fbc64. After = three application files recorded by SHA-256 in the numeric artifacts. Failure actual = response time; failure ceiling = 2000 ms. Scheduled quiet arrivals include local shedding. Startup overlap is included in calculator queue wait, not added. Context-open contains factory calculator work. Admission/residency wait = acquisition − factory − eviction. Residual includes HTTP and uncaptured work. Rank-row component medians are not additive. Attribution ranks use actual response time; 2000-ms failure penalties have no measured service decomposition.',''];
const judged=[];
function campaign(label,report){
  const ts=report.trials;
  lines.push(`## ${label}`,'',`Trials ${ts.length}; censored ${report.censored.length}; trace SHA-256 ${report.traceSha256??'—'}; harness SHA-256 ${report.harnessSha256??'—'}.`,'',
    '| Mode | Quiet successes / scheduled | Attempts | Retries | Refusals/timeouts/shedding | Minimum picker completion | Peak RSS MiB | Post-drain RSS MiB | CPU s |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |');
  for(const mode of modes){const a=ts.filter(t=>t.mode===mode);if(!a.length)continue;
    const minimum=a.map(t=>Math.min(...t.pickers.filter(p=>p.role!=='noisy').map(p=>p.successes/p.attempts)));
    lines.push(`| ${mode} | ${sum(a,t=>t.quiet.successes)}/${sum(a,t=>t.scheduledQuiet)} | ${sum(a,t=>t.attempts.attempts)} | ${sum(a,t=>t.attempts.retries)} | ${sum(a,t=>t.quiet.attempts-t.quiet.successes)} | ${spread(minimum.map(x=>100*x))}% | ${spread(a.map(t=>t.treePeakBytes/1024**2))} | ${spread(a.map(t=>med(t.afterDrainBytes)/1024**2))} | ${spread(a.map(t=>t.cpuSeconds))} |`);
  }
  lines.push('','| Seed | Endpoint | Samples B/C | Failures B/C | Actual p95 B→C | Actual p99 B→C | Ceiling p95 B→C | Ceiling p99 B→C | Actual gate | Ceiling gate | Before p95 range | Candidate p95 maximum | Candidate p95 within before range |',
    '| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | --- |');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const ep of endpoints){
    const a=modes.map(mode=>ts.filter(t=>t.seed===seed&&t.mode===mode)),observed=a.map(ts=>ts.map(t=>quant(t,ep,false))),ceiling=a.map(ts=>ts.map(t=>quant(t,ep,true)));
    const values=(kind,q)=>kind.map(rs=>med(rs.map(r=>r[q]))),o95=values(observed,'p95'),o99=values(observed,'p99'),c95=values(ceiling,'p95'),c99=values(ceiling,'p99');
    const pass=a=>a[1]<=a[0]+Math.max(5,a[0]*.1),max=Math.max(...ceiling[0].map(x=>x.p95)),candidateMax=Math.max(...ceiling[1].map(x=>x.p95)),within=candidateMax<=max;
    const entry={label,seed,endpoint:ep,actual95:o95,actual99:o99,ceiling95:c95,ceiling99:c99,actualPass:pass(o95),ceilingPass:pass(c95),actual99Pass:pass(o99),ceiling99Pass:pass(c99),beforeMaximum:max,candidateMaximum:candidateMax,withinBeforeRange:within};
    if(label==='24-second arrivals')judged.push(entry);
    lines.push(`| ${seed} | ${ep} | ${observed.map(rs=>sum(rs,r=>r.n)).join('/')} | ${a.map(ts=>sum(ts,t=>t.rawQuiet.filter(r=>r.type===ep&&r.status!==200).length)).join('/')} | ${pair(o95)} | ${pair(o99)} | ${pair(c95)} | ${pair(c99)} | ${pass(o95)?'PASS':'FAIL'} | ${pass(c95)?'PASS':'FAIL'} | ${spread(ceiling[0].map(x=>x.p95))} | ${f(candidateMax)} | ${within?'PASS':'FAIL'} |`);
  }
  lines.push('','| Seed | Mode | Endpoint | Actual p50 | Actual p95 | Actual p99 | Ceiling p50 | Ceiling p95 | Ceiling p99 |','| ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const mode of modes)for(const ep of endpoints){const a=ts.filter(t=>t.seed===seed&&t.mode===mode);lines.push(`| ${seed} | ${mode} | ${ep} | ${[false,true].flatMap(c=>['p50','p95','p99'].map(q=>spread(a.map(t=>quant(t,ep,c)[q])))).join(' | ')} |`);}
  lines.push('','| Seed | Mode | Endpoint | Successful samples | Successful p50 | Successful p95 | Successful p99 |',
    '| ---: | --- | --- | ---: | --- | --- | --- |');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const mode of modes)for(const ep of endpoints){
    const a=ts.filter(t=>t.seed===seed&&t.mode===mode).map(t=>t.quietEndpoints[ep].successMs);
    lines.push(`| ${seed} | ${mode} | ${ep} | ${sum(a,x=>x.n)} | ${['p50','p95','p99'].map(q=>spread(a.map(x=>x[q]))).join(' | ')} |`);
  }
  lines.push('','| Seed | Mode | Endpoint | Rank | Successful rank rows | Total | Admission/residency | Eviction | Context open | Calculator wait | Host startup overlap | Calculator service | Residual |',
    '| ---: | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
  const cases=[];
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const mode of modes)for(const ep of endpoints)for(const q of [.95,.99]){
    const a=ts.filter(t=>t.seed===seed&&t.mode===mode).map(t=>{
      const rows=t.rawQuiet.filter(r=>r.type===ep).sort((a,b)=>a.ms-b.ms),row=rows[Math.ceil(rows.length*q)-1];return {seed,mode,pair:t.pair,endpoint:ep,rank:q,...attribution(t,row)};
    });
    cases.push(...a);lines.push(`| ${seed} | ${mode} | ${ep} | p${q*100} | ${a.filter(x=>x.status===200).length}/${a.length} | ${['ms','admission','eviction','open','wait','host','service','other'].map(k=>spread(a.map(x=>x[k]))).join(' | ')} |`);
  }
  lines.push('','| Seed | Endpoint | Rank | Δ total | Δ admission/residency | Δ context open | Δ calculator wait | Δ startup overlap | Δ calculator service |',
    '| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const ep of endpoints)for(const q of [.95,.99]){
    const a=modes.map(mode=>cases.filter(x=>x.seed===seed&&x.mode===mode&&x.endpoint===ep&&x.rank===q));
    lines.push(`| ${seed} | ${ep} | p${q*100} | ${['ms','admission','open','wait','host','service'].map(k=>f(med(a[1].map(x=>x[k]))-med(a[0].map(x=>x[k])))).join(' | ')} |`);
  }
  lines.push('','| Seed | Mode | Endpoint | Rank | Store | Auth | Variant | Prepared state response | Factory calculator wait | Factory calculator service | Factory host overlap |',
    '| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for(const seed of [...new Set(ts.map(t=>t.seed))])for(const mode of modes)for(const ep of endpoints)for(const q of [.95,.99]){
    const a=cases.filter(x=>x.seed===seed&&x.mode===mode&&x.endpoint===ep&&x.rank===q);
    lines.push(`| ${seed} | ${mode} | ${ep} | p${q*100} | ${['storeMs','authMs','variantMs','stateResponseMs'].map(k=>spread(a.map(x=>x.components[k]??0))).join(' | ')} | ${['factoryWait','factoryService','factoryHost'].map(k=>spread(a.map(x=>x[k]))).join(' | ')} |`);
  }
  lines.push('','| Mode | Advisory allocations | Advisory retirements | Grace starts | Cancelled completions | Contexts max | Calculators max | Queue max | Cold pending / active max | Validation / children / OOM / memory differences | Drain samples |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |');
  for(const mode of modes){const a=ts.filter(t=>t.mode===mode);lines.push(`| ${mode} | ${sum(a,t=>t.trace.hosts.filter(h=>h.event==='allocate'&&h.group==='advisory').length)} | ${sum(a,t=>t.trace.hosts.filter(h=>h.event==='retire'&&h.group==='advisory').length)} | ${sum(a,t=>t.trace.events.filter(e=>e.event==='grace').length)} | ${sum(a,t=>t.trace.events.filter(e=>e.event==='cancelled-completion').length)} | ${Math.max(...a.map(t=>t.diagnostics.contexts.max))} | ${Math.max(...a.map(t=>t.workerPeak))} | ${Math.max(...a.map(t=>t.diagnostics.queue.max))} | ${Math.max(...a.map(t=>t.admission.pendingPeak))}/${Math.max(...a.map(t=>t.admission.activePeak))} | ${sum(a,t=>t.validationDifferences)}/${sum(a,t=>t.childrenAfterClose)}/${sum(a,t=>t.oom+t.oomKill)}/${sum(a,t=>+t.guard)} | ${sum(a,t=>t.afterDrainBytes.length)}/${a.length*3} |`);}
  lines.push('','| Mode | Quiet refusal reason | Count |','| --- | --- | ---: |');
  for(const mode of modes){const counts={};for(const t of ts.filter(t=>t.mode===mode))for(const[k,v]of Object.entries(t.quiet.reasons))if(k!=='success')counts[k]=(counts[k]??0)+v;if(!Object.keys(counts).length)counts.none=0;for(const[k,v]of Object.entries(counts))lines.push(`| ${mode} | ${k} | ${v} |`);}
  lines.push('','| Mode | Quiet refusal scope | Count | Maximum counter / bound |',
    '| --- | --- | ---: | --- |');
  for(const mode of modes){
    const groups=new Map();
    for(const t of ts.filter(t=>t.mode===mode))for(const r of t.trace.requests)for(const refusal of r.refusals){
      const key=[refusal.kind,refusal.budget??'',refusal.scope??''].join(':'),group=groups.get(key)??[];group.push(refusal);groups.set(key,group);
    }
    if(!groups.size)lines.push(`| ${mode} | none | 0 | 0 |`);
    for(const[key,a]of groups)lines.push(`| ${mode} | ${key} | ${a.length} | ${Math.max(...a.map(x=>x.count??x.depth??0))}/${Math.max(...a.map(x=>x.limit??0))} |`);
  }
  // Keep every rank-selected request and every failure/tail >=250 ms in numeric evidence.
  const tails=[];for(const t of ts)for(const r of t.rawQuiet)if(r.status!==200||r.ms>=250)tails.push({seed:t.seed,mode:t.mode,pair:t.pair,endpoint:r.type,reason:r.reason,refusals:t.trace.requests.find(x=>x.id===r.id)?.refusals??[],...attribution(t,r)});
  return {label,cases,tails};
}
const attributionReports=[campaign('24-second arrivals',primary)];if(longer.trials.length)attributionReports.push(campaign('120-second arrivals',longer));
lines.push('',`Ceiling p95/p99 gates ${judged.filter(g=>g.ceilingPass).length}/${judged.length} / ${judged.filter(g=>g.ceiling99Pass).length}/${judged.length}; actual p95 gates ${judged.filter(g=>g.actualPass).length}/${judged.length}; Tasks/Draft before-range gates ${judged.filter(g=>g.endpoint!=='state'&&g.withinBeforeRange).length}/${judged.filter(g=>g.endpoint!=='state').length}.`,'','Tasks/Draft samples per 24-second trial: 12/12. Per-trial p95/p99 are maxima; pooled totals are sample counts, not stable-tail estimates. Seeds and 120-second observations remain separate.');
await writeFile(arg('--out','docs/experiments/y06-admission-fairness.round3-measurements.md'),lines.join('\n')+'\n');
const numeric={schema:1,gates:judged,reports:attributionReports};
const rows=a=>a.map(x=>'      '+JSON.stringify(x)).join(',\n');
const compact='{\n  "schema": 1,\n  "gates": [\n'+rows(judged)+'\n  ],\n  "reports": [\n'+attributionReports.map(r=>'    {\n      "label": '+JSON.stringify(r.label)+',\n      "cases": [\n'+rows(r.cases)+'\n      ],\n      "tails": [\n'+rows(r.tails)+'\n      ]\n    }').join(',\n')+'\n  ]\n}\n';
assert.deepEqual(JSON.parse(compact),numeric);
await writeFile(arg('--json','docs/experiments/y06-admission-fairness.round3-attribution.results.json'),compact);
console.log(JSON.stringify({gates:judged,ceilingPass:judged.filter(g=>g.ceilingPass).length,withinRange:judged.filter(g=>g.endpoint!=='state'&&g.withinBeforeRange).length}));
