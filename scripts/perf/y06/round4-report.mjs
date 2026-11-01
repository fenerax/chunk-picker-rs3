// Numeric public-only heap, lifecycle and State-stage handoff.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {summary,requireNode} from './runtime.mjs';
requireNode();
const arg=n=>process.argv[process.argv.indexOf(n)+1],load=async n=>JSON.parse(await readFile(arg(n),'utf8'));
const diagnostic=await load('--attribution'),heap=await load('--heap'),primary=await load('--primary');
const modes=['baseline','candidate'],median=a=>summary(a).p50,f=n=>n.toFixed(3),mib=x=>x/1024**2;
assert.equal(diagnostic.trials.length,2);assert.equal(primary.trials.length,30);assert.equal(primary.censored.length,0);assert.equal(primary.gcAvailable,true);
const overlap=(a,b)=>Math.max(0,Math.min(a.at+a.ms,b.at+b.ms)-Math.max(a.at,b.at));
function stateRanks(t){const rows=t.rawQuiet.filter(r=>r.type==='state').sort((a,b)=>a.ms-b.ms);return [.95,.99].map(q=>{
 const row=rows[Math.ceil(rows.length*q)-1],tr=t.trace.requests.find(x=>x.id===row.id),st=n=>tr.stages.filter(s=>s.name===n),sum=a=>a.reduce((n,x)=>n+x.ms,0),acquire=sum(st('acquire')),open=sum(st('factory')),eviction=sum(st('eviction')),body=sum(st('stateBody')),send=sum(st('stateSend'));
 const jobsWithin=name=>tr.jobs.filter(j=>st(name).some(s=>j.queuedAt>=s.at-.001&&j.finishedAt<=s.at+s.ms+.001));
 const requestJobs=jobsWithin('stateBody'),factoryJobs=jobsWithin('factory');
 const wait=a=>a.reduce((n,j)=>n+j.waitMs,0),service=a=>a.reduce((n,j)=>n+j.serviceMs,0);
 const within=name=>st('stateProjection').reduce((n,p)=>n+st(name).reduce((v,r)=>v+overlap(p,r),0),0);
 return {mode:t.mode,seed:t.seed,pair:t.pair,rank:q,ms:row.ms,admission:acquire-open-eviction,open,eviction,requestProjection:within('stateBody'),factoryProjection:within('factory'),requestCalculatorWait:wait(requestJobs),requestCalculatorService:service(requestJobs),factoryCalculatorWait:wait(factoryJobs),factoryCalculatorService:service(factoryJobs),envelope:Math.max(0,body-within('stateBody')),send:Math.max(0,send-body),other:row.ms-acquire-send};
});}
const ranks=[...diagnostic.trials,...primary.trials.filter(t=>t.seed===73)].flatMap(t=>stateRanks(t).map(r=>({...r,campaign:primary.trials.includes(t)?1:0})));
const lines=['# Round-4 attribution','', '| Memory probe | Before | After | Difference |','| --- | ---: | ---: | ---: |'];
for(const stage of ['before','after'])for(const field of ['rss','heapTotal','heapUsed','external','arrayBuffers']){
 const a=modes.map(mode=>diagnostic.trials.find(t=>t.mode===mode).postIdleHeap[stage].memory[field]);lines.push(`| ${stage==='before'?'Pre-snapshot':'Collected snapshot'} ${field} bytes | ${a[0]} | ${a[1]} | ${a[1]-a[0]} |`);
}
lines.push('','| Constructor | Before count | After count | Count difference | Shallow byte difference |','| --- | ---: | ---: | ---: | ---: |');
for(const r of heap.differences.filter(r=>['object:Object','array:array','number:number','object:Map','object:Set','object:Promise','object:SharedArrayBuffer','native:system / JSArrayBufferData','closure:createPickerAdmission','closure:clearCancelledGrace','closure:stateRepresentation','closure:openSidecars'].includes(r.key)))lines.push(`| ${r.key} | ${r.before.count} | ${r.after.count} | ${r.countDifference} | ${r.byteDifference} |`);
lines.push('','| Candidate retainer path | Count | Shallow bytes |','| --- | ---: | ---: |');
for(const variable of ['groups','cancelledGrace','readinessPrepared']){const a=heap.after.bindings.filter(b=>b.variable===variable);for(const r of a)lines.push(`| ${r.path.map(x=>x.node).join(' → ')} → ${variable} → ${r.target} | 1 | ${r.bytes} |`);}
lines.push('','| Campaign | Rank | Stage ms | Before | After | Difference |','| --- | --- | --- | ---: | ---: | ---: |');
for(const campaign of [0,1])for(const rank of [.95,.99])for(const field of ['ms','admission','open','eviction','factoryProjection','requestProjection','factoryCalculatorWait','factoryCalculatorService','requestCalculatorWait','requestCalculatorService','envelope','send','other']){
 const a=modes.map(mode=>median(ranks.filter(r=>r.campaign===campaign&&r.mode===mode&&r.rank===rank).map(r=>r[field])));lines.push(`| ${campaign} | p${rank*100} | ${field} | ${f(a[0])} | ${f(a[1])} | ${f(a[1]-a[0])} |`);
}
const idle=primary.trials.filter(t=>t.afterIdleRSS);assert.equal(idle.length,2);
lines.push('','| Service-profile post-idle | Before | After |','| --- | ---: | ---: |');
for(const field of ['rss','heapTotal','heapUsed','external','arrayBuffers'])lines.push(`| ${field} bytes | ${modes.map(mode=>idle.find(t=>t.mode===mode).postIdleMemory.memory[field]).join(' | ')} |`);
for(const mode of modes){const t=idle.find(t=>t.mode===mode);assert.equal(t.postIdleMemory.gcAvailable,true);assert.equal(t.postIdleDiagnostics.contexts,1);assert.equal(t.afterIdleRSS.workers,0);assert.ok(t.postIdleDiagnostics.idleGc.collections>=1);}
const delta=idle.find(t=>t.mode==='candidate').afterIdleRSS.mainBytes-idle.find(t=>t.mode==='baseline').afterIdleRSS.mainBytes;
lines.push(`| Main RSS difference MiB | 0 | ${f(mib(delta))} |`,`| Main RSS allowance MiB | 10 | 10 |`,`| RSS gate pass | 1 | ${delta<=10*1024**2?1:0} |`,`| Automatic idle collections | ${modes.map(mode=>idle.find(t=>t.mode===mode).postIdleDiagnostics.idleGc.collections).join(' | ')} |`,'| Shortened idle windows / primary snapshot calls | 0 | 0 |','| Historical +64.6-MiB capture heap snapshots | 0 | 0 |','| Campaign 0 / 1 State rank rows | 4 | 20 |','| Per-trial State / Tasks / Draft attempts | 80 | 12 / 12 |','| Stage-median additivity claims | 0 | 0 |');
const taskTails=[];
for(const seed of [17,73,211]){
 const byMode=modes.map(mode=>primary.trials.filter(t=>t.mode===mode&&t.seed===seed).flatMap(t=>t.rawQuiet.filter(r=>r.type==='tasks').map(row=>({t,row}))));
 const maxima=byMode.map(a=>a.reduce((keep,x)=>!keep||x.row.ms>keep.row.ms?x:keep,undefined));
 if(maxima[1].row.ms<=maxima[0].row.ms)continue;
 const {t,row}=maxima[1],trace=t.trace.requests.find(x=>x.id===row.id),stage=name=>trace.stages.filter(x=>x.name===name).reduce((n,x)=>n+x.ms,0),jobs=trace.jobs.filter(j=>j.stage==='request');
 taskTails.push({seed,pair:t.pair,ms:row.ms,beforeMaximum:maxima[0].row.ms,admission:stage('acquire')-stage('factory')-stage('eviction'),context:stage('factory'),eviction:stage('eviction'),calculatorQueue:jobs.reduce((n,j)=>n+j.waitMs,0),calculatorService:jobs.reduce((n,j)=>n+j.serviceMs,0)});
}
lines.push('','| Failed Tasks range seed | Before maximum ms | After maximum ms | Admission ms | Context ms | Calculator queue ms | Calculator service ms |','| ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const t of taskTails)lines.push(`| ${t.seed} | ${[t.beforeMaximum,t.ms,t.admission,t.context,t.calculatorQueue,t.calculatorService].map(f).join(' | ')} |`);
if(process.argv.includes('--tasks-out'))await writeFile(arg('--tasks-out'),JSON.stringify(taskTails,null,2)+'\n');
await writeFile(arg('--out'),lines.join('\n')+'\n');await writeFile(arg('--out').replace(/\.md$/,'.results.json'),JSON.stringify({schema:1,ranks,taskTails,postIdleMainDifferenceBytes:delta,rssPass:delta<=10*1024**2},null,2)+'\n');
console.log(JSON.stringify({postIdleMainDifferenceBytes:delta,rssPass:delta<=10*1024**2,stateRanks:ranks.length}));
