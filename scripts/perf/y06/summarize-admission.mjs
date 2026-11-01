// Aggregate only public synthetic artifacts; no saved gameplay is opened.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { requireNode, summary } from './runtime.mjs';
requireNode();
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const primary=JSON.parse(await readFile(arg('--primary'),'utf8'));
const longer=process.argv.includes('--long')?JSON.parse(await readFile(arg('--long'),'utf8')):{trials:[],censored:[{reason:'not run'}]};
const lines=[],add=s=>lines.push(s),sum=(ts,fn)=>ts.reduce((n,t)=>n+fn(t),0),f=x=>x===null||x===undefined?'—':x.toFixed(1);
const spread=(a,scale=1)=>{const s=summary(a.map(x=>x/scale));return `${f(s.p50)} [${f(s.min)}–${f(s.max)}]`;};
function campaign(label,report){
  add(`## ${label}`);add('');add(`Harness SHA-256: ${report.harnessSha256 ?? 'unavailable'}.`);add('');add(`${report.trials.length} completed trials; ${report.censored.length} censored entries. Nearest-rank cross-trial p50 values [minimum–maximum] below summarize per-trial statistics, not pooled percentiles or confidence intervals. Successful-only percentiles exclude refusals; all-attempt values include them. Short draft/task p95/p99 often equal observed maxima.`);add('');
  add('| Seed | Mode | Trials | Quiet success / scheduled | Quiet min picker completion % | Storm success / attempts | Retries (all roles) | Peak tree MiB | Post-drain MiB | CPU core-s |');add('| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- | --- |');
  for(const seed of [...new Set(report.trials.map(t=>t.seed))])for(const mode of ['baseline','candidate']){
    const ts=report.trials.filter(t=>t.seed===seed&&t.mode===mode);if(!ts.length)continue;
    add(`| ${seed} | ${mode} | ${ts.length} | ${sum(ts,t=>t.quiet.successes)} / ${sum(ts,t=>t.scheduledQuiet)} | ${spread(ts.map(t=>100*Math.min(...t.pickers.filter(p=>p.role!=='noisy').map(p=>p.successes/p.attempts))))} | ${sum(ts,t=>t.phases.storm.successes)} / ${sum(ts,t=>t.phases.storm.attempts)} | ${sum(ts,t=>t.attempts.retries)} | ${spread(ts.map(t=>t.treePeakBytes),1024**2)} | ${spread(ts.map(t=>summary(t.afterDrainBytes).p50),1024**2)} | ${spread(ts.map(t=>t.cpuSeconds))} |`);
  }
  add('');add('| Mode | Endpoint | Success samples / all attempts | Successful p50 | Successful p95 | Successful p99 | All-attempt p50 | All-attempt p95 | All-attempt p99 |');add('| --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
  const gates=[];
  for(const mode of ['baseline','candidate'])for(const endpoint of ['state','tasks','draft']){
    const ts=report.trials.filter(t=>t.mode===mode),rs=ts.map(t=>t.quietEndpoints[endpoint]);if(!ts.length)continue;
    add(`| ${mode} | ${endpoint} | ${sum(rs,r=>r.successes)} / ${sum(rs,r=>r.attempts)} | ${['successMs','allMs'].flatMap(k=>['p50','p95','p99'].map(q=>spread(rs.map(r=>r[k][q]).filter(Number.isFinite)))).join(' | ')} |`);
  }
  add('');
  for(const seed of [...new Set(report.trials.map(t=>t.seed))])for(const endpoint of ['state','tasks','draft']){
    const median=mode=>summary(report.trials.filter(t=>t.mode===mode&&t.seed===seed).map(t=>t.quietEndpoints[endpoint].successMs.p95).filter(Number.isFinite)).p50;
    const baseline=median('baseline'),candidate=median('candidate'),threshold=baseline+Math.max(5,baseline*.1);
    gates.push({seed,endpoint,baseline,candidate,threshold,pass:candidate<=threshold});
  }
  add('Latency gates, candidate median per-trial successful p95 versus baseline + max(5 ms, 10%):');add('');
  for(const g of gates)add(`- Seed ${g.seed}, ${g.endpoint}: ${f(g.baseline)} → ${f(g.candidate)} ms; threshold ${f(g.threshold)} ms; ${g.pass?'PASS':'FAIL'}.`);
  const candidates=report.trials.filter(t=>t.mode==='candidate');
  const quietFailures=sum(candidates,t=>t.scheduledQuiet-t.quiet.successes),tails=report.trials.flatMap((t,i)=>Object.entries(t.quietEndpoints).filter(([,r])=>r.successMs.max>300).map(([endpoint,r])=>({trial:i+1,mode:t.mode,seed:t.seed,pair:t.pair,endpoint,maxMs:r.successMs.max,admissionServiceMax:t.admission?.serviceMs?.max,foregroundServiceMax:t.foregroundServiceMs.max,calculatorOldestSampleMax:t.diagnostics.oldestMs.max,advisoryWaitMax:t.advisoryWaitMs?.max,advisoryServiceMax:t.advisoryServiceMs?.max})));
  add('');add(`Candidate quiet failures: ${quietFailures}. >300 ms quiet successful endpoint observations (trial/endpoint maxima): ${tails.length}.`);add('');
  for(const x of tails)add(`- Trial ${x.trial}, ${x.mode}, seed ${x.seed}, pair ${x.pair}, ${x.endpoint}: ${f(x.maxMs)} ms; cold admission service max ${f(x.admissionServiceMax)}, foreground calculator service max ${f(x.foregroundServiceMax)}, oldest sampled calculator queue ${f(x.calculatorOldestSampleMax)}, exact advisory wait/service maxima ${f(x.advisoryWaitMax)} / ${f(x.advisoryServiceMax)} ms. These trial-wide maxima do not attribute individual requests.`);
  const reasons=ts=>{const r={};for(const t of ts)for(const[k,n]of Object.entries(t.quiet.reasons))r[k]=(r[k]??0)+n;return r;};
  add('');add('Steady role totals (successes / scheduled attempts; reasons include intentional noisy disconnects):');add('');
  for(const mode of ['baseline','candidate'])for(const role of ['noisy','light','idle']){
    const ps=report.trials.filter(t=>t.mode===mode).flatMap(t=>t.pickers.filter(p=>p.role===role)),reasons={};
    for(const p of ps)for(const[k,n]of Object.entries(p.reasons))reasons[k]=(reasons[k]??0)+n;
    add(`- ${mode}, ${role}: ${sum(ps,p=>p.successes)} / ${sum(ps,p=>p.attempts)}; \`${JSON.stringify(reasons)}\`.`);
  }
  add('');add('Quiet steady reason totals:');add('');for(const mode of ['baseline','candidate'])add(`- ${mode}: \`${JSON.stringify(reasons(report.trials.filter(t=>t.mode===mode)))}\`.`);
  add('');add('Candidate exact cold-acquisition telemetry (storm, steady and probes combined):');add('');
  for(const key of ['waitMs','serviceMs'])add(`- ${key}: ${sum(candidates,t=>t.admission[key].n)} released acquisitions; per-trial p95 ${spread(candidates.map(t=>t.admission[key].p95))} ms; observed maximum ${f(Math.max(...candidates.map(t=>t.admission[key].max)))} ms.`);
  const eventCounts={};for(const t of candidates)for(const [key,n]of Object.entries(t.admission.counts))eventCounts[key]=(eventCounts[key]??0)+n;
  add(`- Events: \`${JSON.stringify(eventCounts)}\`. Peak pending ${Math.max(0,...candidates.map(t=>t.admission.pendingPeak))}; active ${Math.max(0,...candidates.map(t=>t.admission.activePeak))}; final pending total ${sum(candidates,t=>t.admission.finalPending)}.`);
  for(const mode of ['baseline','candidate']){const ts=report.trials.filter(t=>t.mode===mode);add(`- ${mode} exact factory service p95 ${spread(ts.map(t=>t.factoryMs.p95))} ms; foreground calculator queue p95 ${spread(ts.map(t=>t.foregroundWaitMs.p95))} ms; foreground service p95 ${spread(ts.map(t=>t.foregroundServiceMs.p95))} ms. Primary advisory wait remains sampled; long runs add exact advisory intervals.`);}
  for(const mode of ['baseline','candidate']){
    const ts=report.trials.filter(t=>t.mode===mode&&t.advisoryWaitMs);
    if(ts.length)add(`- ${mode} exact advisory queue p95 ${spread(ts.map(t=>t.advisoryWaitMs.p95))} ms and maximum ${f(Math.max(...ts.map(t=>t.advisoryWaitMs.max)))} ms; advisory service p95 ${spread(ts.map(t=>t.advisoryServiceMs.p95))} ms and maximum ${f(Math.max(...ts.map(t=>t.advisoryServiceMs.max)))} ms; ${sum(ts,t=>t.advisoryWaitMs.n)} observed completed jobs.`);
  }
  const ts=report.trials;
  add('');add(`Validation differences ${sum(ts,t=>t.validationDifferences)}; drain failures ${ts.filter(t=>!t.drained).length}; post-drain samples ${sum(ts,t=>t.afterDrainBytes.length)} (required ${ts.length*3}); normal-close descendants ${sum(ts,t=>t.childrenAfterClose)}; OOM / OOM kills ${sum(ts,t=>t.oom)} / ${sum(ts,t=>t.oomKill)}; guard breaches ${ts.filter(t=>t.guard).length}; sampled context maximum ${Math.max(0,...ts.map(t=>t.diagnostics.contexts.max))}; calculator host maximum ${Math.max(0,...ts.map(t=>t.workerPeak))}.`);
  return {quietFailures,gates,tails,passed:!report.censored.length&&!quietFailures&&gates.every(g=>g.pass)&&!tails.some(t=>t.mode==='candidate')};
}
add('# Matched public admission measurements');add('');add('Historical round-1 criteria: survivor-only latency gates are superseded by round2-summary.mjs and the round-2 report. Numeric measurements below remain historical evidence.');add('');
add(`Node ${primary.node}; cpu.max ${primary.cpuMax}; memory.max ${primary.memoryMax} bytes. Harness SHA-256 ${primary.harnessSha256}; runtime SHA-256 ${primary.runtimeSha256}.`);add('');
const primaryGate=campaign('Primary: 24-second arrivals',primary),longGate=campaign('Long: 120-second arrivals',longer);
add('');add(`Historical primary gate: ${primaryGate.passed?'PASS':'FAIL'}. Historical long gate: ${longGate.passed?'PASS':'FAIL'}. Tail attribution lacks individual HTTP/job correlation; unexplained candidate >300 ms tails are conservatively failures.`);
for(const report of [primary,longer])for(const t of report.trials){assert.equal(t.afterDrainBytes.length,3);assert.ok(t.afterDrainBytes.every(x=>Number.isFinite(x)&&x>0));}
await writeFile(arg('--out'),lines.join('\n')+'\n');
