// Numeric public-fixture correction report. No gameplay or private input reads.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {requireNode,summary} from './runtime.mjs';
requireNode();
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const input=arg('--input'),out=arg('--out');assert.ok(input&&out);
const bytes=await readFile(input),data=JSON.parse(bytes),ts=data.trials;
const modes=['baseline','candidate'],eps=['state','tasks','draft'],seeds=[17,73,211];
const sum=(a,f)=>a.reduce((s,x)=>s+f(x),0),median=a=>summary(a).p50;
const format=x=>x.toFixed(1),spread=a=>{const x=summary(a);return `${format(x.p50)} [${format(x.min)}, ${format(x.max)}]`;};
const mib=n=>n/1024**2;
assert.equal(ts.length,30);assert.equal(data.censored.length,0);
for(const seed of seeds)for(const mode of modes){const trials=ts.filter(t=>t.seed===seed&&t.mode===mode);assert.deepEqual(trials.map(t=>t.pair),[1,2,3,4,5]);}
for(const mode of modes){const a=ts.filter(t=>t.mode===mode);for(const t of a)assert.deepEqual(t.sourceHashes,a[0].sourceHashes);}
for(const t of ts){
  assert.equal(t.seconds,24);assert.equal(t.rawQuiet.length,104);assert.equal(t.scheduledQuiet,104);
  assert.equal(t.quiet.successes,t.rawQuiet.filter(r=>r.status===200).length);
  assert.equal(t.validationDifferences+t.childrenAfterClose+t.oom+t.oomKill,0);
  assert.ok(t.drained&&!t.guard&&t.workerPeak<=2&&t.diagnostics.contexts.max<=7);
  assert.equal(t.afterDrainBytes.length,3);assert.ok(t.afterDrainBytes.every(x=>Number.isFinite(x)&&x>0));
  if(t.mode==='baseline')assert.equal(t.rootCommit,'a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9');
}
const rows=[];
for(const seed of seeds)for(const endpoint of eps){
  const a=modes.map(mode=>ts.filter(t=>t.seed===seed&&t.mode===mode));
  const q=ceiling=>a.map(trials=>trials.map(t=>summary(t.rawQuiet.filter(r=>r.type===endpoint).map(r=>ceiling&&r.status!==200?2000:r.ms))));
  const observed=q(false),ceiling=q(true),quant=(a,key)=>a.map(x=>median(x.map(y=>y[key]))),pass=a=>a[1]<=a[0]+Math.max(5,a[0]*.1);
  const actual95=quant(observed,'p95'),actual99=quant(observed,'p99'),ceiling95=quant(ceiling,'p95'),ceiling99=quant(ceiling,'p99');
  rows.push({seed,endpoint,samples:a.map(x=>sum(x,t=>t.rawQuiet.filter(r=>r.type===endpoint).length)),failures:a.map(x=>sum(x,t=>t.rawQuiet.filter(r=>r.type===endpoint&&r.status!==200).length)),actual95,actual99,ceiling95,ceiling99,actual95Pass:pass(actual95),actual99Pass:pass(actual99),ceiling95Pass:pass(ceiling95),ceiling99Pass:pass(ceiling99),beforeRange:[Math.min(...ceiling[0].map(x=>x.p95)),Math.max(...ceiling[0].map(x=>x.p95))],afterMaximum:Math.max(...ceiling[1].map(x=>x.p95)),withinRange:Math.max(...ceiling[1].map(x=>x.p95))<=Math.max(...ceiling[0].map(x=>x.p95)),actualBeforeRange:[Math.min(...observed[0].map(x=>x.p95)),Math.max(...observed[0].map(x=>x.p95))],actualAfterMaximum:Math.max(...observed[1].map(x=>x.p95)),actualWithinRange:Math.max(...observed[1].map(x=>x.p95))<=Math.max(...observed[0].map(x=>x.p95))});
}
const idle=ts.filter(t=>t.afterIdleRSS);assert.equal(idle.length,2);
for(const t of idle){assert.equal(t.seed,73);assert.equal(t.pair,1);assert.ok(t.afterIdleRSS.idleMs>=610000);assert.equal(t.afterIdleRSS.workers,0);}
const pair=a=>a.map(format).join(' → '),flag=x=>x?'1':'0';
const lines=['# play-v1 corrected measurements','',`| Input SHA-256 | ${createHash('sha256').update(bytes).digest('hex')} |`,'| --- | --- |',`| Node | ${data.node} |`,`| --expose-gc before / after | ${data.gcAvailable?1:0} / ${data.gcAvailable?1:0} |`,`| Trials / censored | ${ts.length} / ${data.censored.length} |`,'| Before | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |','| Seeds / pairs per seed / window ms | 17, 73, 211 / 5 / 24000 |','| Failure ceiling ms / p95-p99 allowance ms | 2000 / max(5, 10%) |','| Quantiles | median(per-trial nearest-rank) |','| Gate pass / fail | 1 / 0 |','',
'| Seed | Endpoint | Samples B/C | Failures B/C | Actual p95 B→C ms | Actual p99 B→C ms | Ceiling p95 B→C ms | Ceiling p99 B→C ms | Actual p95/p99 gates | Ceiling p95/p99 gates | Ceiling before p95 range ms | After p95 max ms | Ceiling range gate | Actual before p95 range ms | Actual range gate |',
'| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: |'];
for(const r of rows)lines.push(`| ${r.seed} | ${r.endpoint} | ${r.samples.join('/')} | ${r.failures.join('/')} | ${pair(r.actual95)} | ${pair(r.actual99)} | ${pair(r.ceiling95)} | ${pair(r.ceiling99)} | ${flag(r.actual95Pass)}/${flag(r.actual99Pass)} | ${flag(r.ceiling95Pass)}/${flag(r.ceiling99Pass)} | ${r.beforeRange.map(format).join('–')} | ${format(r.afterMaximum)} | ${flag(r.withinRange)} | ${r.actualBeforeRange.map(format).join('–')} | ${flag(r.actualWithinRange)} |`);
lines.push('','| Mode | Quiet successes/scheduled | Attempts | Quiet refusals | Peak RSS MiB median [min, max] | Post-drain RSS MiB median [min, max] |','| --- | ---: | ---: | ---: | --- | --- |');
for(const mode of modes){const a=ts.filter(t=>t.mode===mode);lines.push(`| ${mode} | ${sum(a,t=>t.quiet.successes)}/${sum(a,t=>t.scheduledQuiet)} | ${sum(a,t=>t.attempts.attempts)} | ${sum(a,t=>t.quiet.attempts-t.quiet.successes)} | ${spread(a.map(t=>mib(t.treePeakBytes)))} | ${spread(a.map(t=>mib(median(t.afterDrainBytes))))} |`);}
lines.push('','| Seed / pair | Mode | Sample | Idle ms | Main MiB | Workers MiB | Tree MiB | Worker count | Process count |','| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const t of idle)for(const [name,s]of [['post-drain',t.postDrainRSS],['post-eviction',t.afterIdleRSS]])lines.push(`| ${t.seed}/${t.pair} | ${t.mode} | ${name} | ${format(s.idleMs??0)} | ${format(mib(s.mainBytes))} | ${format(mib(s.workerBytes))} | ${format(mib(s.totalBytes))} | ${s.workers} | ${s.processes} |`);
lines.push('','| Gate | Count |','| --- | ---: |',...['actual95Pass','actual99Pass','ceiling95Pass','ceiling99Pass'].map(key=>`| ${key} | ${rows.filter(r=>r[key]).length}/9 |`),`| Tasks/Draft actual before-range | ${rows.filter(r=>r.endpoint!=='state'&&r.actualWithinRange).length}/6 |`,`| Tasks/Draft ceiling before-range | ${rows.filter(r=>r.endpoint!=='state'&&r.withinRange).length}/6 |`,`| Validation / descendants / OOM / guard | 0 / 0 / 0 / 0 |`,'| Post-drain / idle sample counts | 90 / 2 |','| Default context / worker idle ms | 600000 / 600000 |','| Idle interval / shortened-window overrides / forced GC | 610000 / 0 / 0 |',`| Post-idle V8 counter / native-allocator trace samples | ${ts.filter(t=>t.postIdleMemory).length} / 0 |`,'| Stable per-trial Tasks/Draft tail estimates | 0 |','| Per-trial Tasks/Draft samples | 12 / 12 |');
await writeFile(out,lines.join('\n')+'\n');
await writeFile(out.replace(/\.md$/,'.results.json'),JSON.stringify({schema:1,inputSha256:createHash('sha256').update(bytes).digest('hex'),rows},null,2)+'\n');
console.log(JSON.stringify({gates:rows,completed:ts.length}));
