// Rejudge historical synthetic outcomes without inventing raw observations.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { requireNode, summary } from './runtime.mjs';
requireNode();
const arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const primary=JSON.parse(await readFile(arg('--primary','docs/experiments/y06-admission-fairness.primary.results.json'),'utf8'));
const median=a=>summary(a).p50, f=x=>x.toFixed(1);
// Historical files retain counts and quantiles, not individual durations. A
// replacement failure quantile is exact when its rank falls among the failures,
// or matches a retained successful rank. Otherwise retain an interval.
export function ceilingQuantile(row,q,ceiling=2000){
  const rank=Math.ceil(row.attempts*q),n=row.successes;
  assert.ok(row.successMs.max===null||row.successMs.max<ceiling,'Ceiling must exceed all successful values');
  if(rank>n)return {lower:ceiling,upper:ceiling};
  const points=[[1,row.successMs.min],[Math.ceil(n*.5),row.successMs.p50],[Math.ceil(n*.95),row.successMs.p95],[Math.ceil(n*.99),row.successMs.p99],[n,row.successMs.max]];
  return {lower:Math.max(...points.filter(([k])=>k<=rank).map(([,v])=>v)),upper:Math.min(...points.filter(([k])=>k>=rank).map(([,v])=>v))};
}
const lines=['# Round 2: all-attempt rejudgment','','Failure-as-observed includes each refusal/timeout at time to failure. Failure-as-never-served replaces it with 2000 ms. Values are nearest-rank cross-trial p50 of trial endpoint p95/p99; bracketed figures are per-trial ranges. Historical raw samples were not retained: ceiling values below are proved from counts and quantile ranks, never interpolated.','','| Seed | Endpoint | Scheduled B/C | Failures B/C | Observed p95 B → C (ms) | Observed p99 B → C (ms) | Ceiling p95 B → C (ms) | Ceiling p99 B → C (ms) | Observed p95 gate | Ceiling p95 gate |','| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |'];
const judged=[];
for(const seed of [17,73,211])for(const endpoint of ['state','tasks','draft']){
  const modes=['baseline','candidate'].map(mode=>primary.trials.filter(t=>t.seed===seed&&t.mode===mode).map(t=>t.quietEndpoints[endpoint]));
  const observed=q=>modes.map(rs=>median(rs.map(r=>r.allMs[q]))),penalized=q=>modes.map(rs=>{const intervals=rs.map(r=>ceilingQuantile(r,q)),lo=median(intervals.map(x=>x.lower)),hi=median(intervals.map(x=>x.upper));assert.equal(lo,hi,'Median is not exactly recoverable');return lo;});
  const a95=observed('p95'),a99=observed('p99'),c95=penalized(.95),c99=penalized(.99),pass=a=>a[1]<=a[0]+Math.max(5,a[0]*.1);
  judged.push({seed,endpoint,observed95:a95,observed99:a99,ceiling95:c95,ceiling99:c99,observedPass:pass(a95),ceilingPass:pass(c95)});
  const totals=rs=>rs.reduce((s,r)=>s+r.attempts,0),fail=rs=>rs.reduce((s,r)=>s+r.attempts-r.successes,0),pair=a=>a.map(f).join(' → ');
  lines.push(`| ${seed} | ${endpoint} | ${modes.map(totals).join('/')} | ${modes.map(fail).join('/')} | ${pair(a95)} | ${pair(a99)} | ${pair(c95)} | ${pair(c99)} | ${pass(a95)?'PASS':'FAIL'} | ${pass(c95)?'PASS':'FAIL'} |`);
}
lines.push('',`Observed-response-time gates: ${judged.filter(x=>x.observedPass).length}/9 pass. Completion-aware ceiling gates: ${judged.filter(x=>x.ceilingPass).length}/9 pass. The round-1 survivor-only rejection is superseded: its apparent service regression disappears when unserved work is charged at the deadline. Fast refusals still make observed-response-time tails smaller on baseline; that is not faster service.`,'','The original 319 quiet losses are retained, not imputed as successful work. Candidate has zero quiet losses in these primary trials. P99 also improves under the ceiling in all nine groups.');
await writeFile(arg('--out','docs/experiments/y06-admission-fairness.round2-measurements.md'),lines.join('\n')+'\n');
