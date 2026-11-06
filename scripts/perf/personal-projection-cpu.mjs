// Node 24: --before <main-worktree> --after <candidate-worktree> --out <json>.
// Use the shared machine's load lock, low priority and cooldown policy.
// Fixed alternating AB/BA pairs resume without changing source or input bytes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {groupFilterFixture} from './group-filter-fixture.mjs';
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const roots={before:path.resolve(option('before')),after:path.resolve(option('after'))};
const output=path.resolve(option('out')),fixturePath=output+'.fixture.json';
fs.mkdirSync(path.dirname(output),{recursive:true});
const challenges={Synthetic:Object.fromEntries(Array.from({length:24000},(_,i)=>[`Synthetic ${i}`,{Level:1+i%99}]))};
const fixture=JSON.stringify(groupFilterFixture({challenges},{historyLength:2000})).replaceAll('"one"','"alpha"').replaceAll('"two"','"beta"');
if(fs.existsSync(fixturePath))assert.equal(fs.readFileSync(fixturePath,'utf8'),fixture);else fs.writeFileSync(fixturePath,fixture);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const arm=fileURLToPath(new URL('./personal-projection-arm.mjs',import.meta.url));
const fingerprint={fixture:sha(fixture),runner:sha(fs.readFileSync(arm)),harness:sha(fs.readFileSync(fileURLToPath(import.meta.url))),sources:Object.fromEntries(Object.entries(roots).map(([kind,root])=>[kind,sha(fs.readFileSync(path.join(root,'app/web/duo-tasks.mjs')))]))};
const protocol={pairs:20,order:Array.from({length:20},(_,pair)=>pair%2?['after','before']:['before','after']),minimumFasterPairs:18,minimumPairedMedianCpuGainPercent:5,wallTimeIsGate:false};
const report=fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):{fixedAt:new Date().toISOString(),fingerprint,protocol,runs:[],decision:'undecided'};
assert.deepEqual(report.fingerprint,fingerprint);assert.deepEqual(report.protocol,protocol);
fs.writeFileSync(output,JSON.stringify(report,null,2));
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const median=a=>{const s=[...a].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
const start=Date.now();
for(let pair=report.runs.length;pair<20;pair++){
 if(Date.now()-start>5*60*1000){console.log('Paused at pair boundary; release the load lock before resuming.');break;}
 const row={pair,order:protocol.order[pair]};
 for(const kind of row.order){
  const r=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=1536',arm,roots[kind],fixturePath],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  assert.equal(r.status,0,r.stderr);row[kind]=JSON.parse(r.stdout);
 }
 assert.deepEqual(row.before.outputs,row.after.outputs);assert.equal(row.before.inputSha256,row.after.inputSha256);
 report.runs.push(row);
 const gains=report.runs.map(r=>100*(1-mean(r.after.cpuMs)/mean(r.before.cpuMs)));
 report.faster=gains.filter(g=>g>0).length;report.pairedMedianCpuGainPercent=median(gains);
 report.beforeMedianCpuMs=median(report.runs.map(r=>mean(r.before.cpuMs)));
 report.afterMedianCpuMs=median(report.runs.map(r=>mean(r.after.cpuMs)));
 report.allFullOutputHashesEqual=true;
 report.decision=report.runs.length===20&&report.faster>=18&&report.pairedMedianCpuGainPercent>=5?'CPU gate passed; targeted correctness checks still required':'undecided';
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log({pair,gain:gains.at(-1),decision:report.decision});
}
