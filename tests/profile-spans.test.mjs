import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { reconcile, interactionWindows, stats, html } from '../scripts/perf/profile-stack/report.mjs';
import { parse, syntheticEnvironment } from '../scripts/perf/profile-stack.mjs';
import { harness } from '../scripts/perf/profile-stack/harness.mjs';
import { rendererSpans } from '../scripts/perf/profile-stack/renderer.mjs';
import { workerStartupSpans } from '../scripts/perf/profile-stack/worker-startup.mjs';
import { bootstrapPaired } from '../scripts/perf/profile-stack/bootstrap-stats.mjs';
import { browserProbe } from '../scripts/perf/profile-stack/browser.mjs';

const root = new URL('../', import.meta.url);
test('unset profiling does not load profiling code, inspector, or observers through app hooks', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import { registerHooks } from 'node:module';
    const loaded=[];registerHooks({load(url,c,next){loaded.push(url);return next(url,c)}});
    await import('./app/server.mjs');
    assert.equal(loaded.some(u=>u.includes('profile-spans')||u.includes('inspector')),false);
  `], { cwd: root, env: syntheticEnvironment(process.env, '/tmp/unused-profile-test', root.pathname, false), encoding:'utf8' });
  assert.equal(result.status,0,result.stderr);
});
test('contexts remain separate through asynchronous work and failures, and span parents cross jobs', async t => {
  const dir=await mkdtemp('/tmp/rs3-span-test-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
    const p=await import('./app/profile-spans.mjs');
    const pooled=new EventEmitter();let controls=0;pooled.postMessage=()=>controls++;p.attach(pooled);assert.equal(controls,0,'pooled endpoints must never receive diagnostic jobs');
    async function run(id,fail){const response=new EventEmitter();response.end=()=>response.emit('finish');
      return p.request({headers:{'x-rs3-profile':id},url:'/api/state'},response,async()=>{
        try {return await p.span('outer',async()=>{await new Promise(r=>setTimeout(r,5));const entry={};p.queued(entry);p.dispatch(entry);await p.workerHandler(async()=>p.span('inner',()=>{if(fail)throw Error('expected');return 7}))({_profile:entry._profile,type:'evaluate'});p.completed(entry);return 7;});}
        finally{response.end();}});}
    const values=await Promise.allSettled([run('click-a',false),run('click-b',true)]);
    assert.equal(values[0].value,7);assert.equal(values[1].status,'rejected');
    assert.equal(p.current(),undefined);
    const r=new EventEmitter();r.end=()=>{};
    assert.equal(p.request({headers:{'x-rs3-profile':'invalid / id'},url:'/'},r,()=>42),42);
  `],{cwd:root,env:{...process.env,RS3_PROFILE:'1',RS3_PROFILE_DIR:dir},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const rows=(await Promise.all((await readdir(dir)).map(file=>readFile(`${dir}/${file}`,'utf8')))).join('').trim().split('\n').map(JSON.parse);
  const ids=new Map(rows.map(r=>[r.id,r]));assert.ok(rows.length>=10);
  for(const row of rows){assert.ok(['click-a','click-b'].includes(row.profileId));assert.ok(row.end>=row.start);if(row.parentId)assert.equal(ids.get(row.parentId)?.profileId,row.profileId);}
  assert.ok(rows.some(r=>r.name==='inner'&&r.profileId==='click-b'));
});
test('coverage clips spans, ignores envelopes and partitions overlaps without double counting',()=>{
  const s=reconcile(10,30,[{layer:'server',name:'routing',start:0,end:100,envelope:true},{layer:'browser',name:'render',start:5,end:20},{layer:'engine',name:'evaluate',start:15,end:25}]);
  assert.equal(s.wallMs,20);assert.equal(s.accountedMs,15);assert.equal(s.unaccountedMs,5);assert.equal(s.reconciliationErrorMs,0);
  assert.deepEqual(s.phases,{'browser:render':5,'engine:evaluate':10});
  assert.deepEqual(stats([4,1,2,3]),{median:2.5,min:1,max:4});
  const windows=interactionWindows({profileId:'r',start:0,end:10,spans:[
    {id:'h',profileId:'r',layer:'harness',name:'poll.sleep',start:0,end:10},
    {id:'i1',profileId:'r.c1',layer:'browser',name:'input.click',start:2,end:2},
    {id:'work',profileId:'r.c1',layer:'server',name:'async.work',start:3,end:9},
    {id:'i2',profileId:'r.c2',layer:'browser',name:'input.click',start:5,end:5}]});
  assert.deepEqual(windows.map(w=>[w.start,w.end]),[[0,2],[2,5],[5,10]]);
  assert.ok(windows[1].outsideWindowSpans.includes('work'));
  assert.ok(windows[2].concurrentSpans.includes('work'));assert.ok(!windows[2].spans.includes('work'));
  assert.ok(windows.every(w=>w.summary.unaccountedMs===0));

});
test('synthetic runner rejects private input, strips inherited private settings, validates scenarios',()=>{
  assert.throws(()=>parse(['--private-state','/tmp/save']),/not supported/);
  assert.throws(()=>parse(['--runs','0']),/Runs/);assert.throws(()=>parse(['--scenario','unknown']),/scenario/);
  const e=syntheticEnvironment({RS3_GAME_DEFAULTS_FILE:'secret',RS3_PACKS_DIR:'secret',RS3_PROFILE:'1',RS3_PROFILE_DIR:'secret',RS3_DATASET:'duo-legacy',RS3_DATASET_PROFILE:'secret'},'/tmp/synthetic','/tmp/root',false);
  assert.equal(e.RS3_DATASET,'open-f2p');assert.equal(e.RS3_PACKS_DIR,undefined);assert.equal(e.RS3_GAME_DEFAULTS_FILE,undefined);assert.equal(e.RS3_PROFILE,undefined);assert.equal(e.RS3_PROFILE_DIR,undefined);assert.equal(e.RS3_DATASET_PROFILE,undefined);
});
test('report embeds data safely and needs no network resources',()=>{
  const result=html({summary:[],clicks:[],clocks:[],limits:['</script><img src=x>']});
  assert.ok(!result.includes('</script><img'));assert.ok(!result.includes('<script src='));assert.ok(result.includes('Unaccounted'));
});

test('browser fetch sets the profile header only when enabled and preserves JSON results',async()=>{
  for(const enabled of [false,true]){
    let received;
    const page=runInNewContext(`(${browserProbe.toString()})(${enabled},'click-1'); globalThis`,{
      performance,Headers,Request,document:{addEventListener(){}},
      PerformanceObserver:class {observe(){}},
      fetch:async(input,options)=>{received=options.headers;return new Response('{"answer":42}');},
    });
    const response=await page.fetch('/api/state');assert.equal((await response.json()).answer,42);
    assert.equal(received.get('x-rs3-profile'),enabled?'click-1':null);
    assert.ok(page.__rs3Stack.records.some(r=>r.name==='response.parse'));
    assert.ok(page.__rs3Stack.records.some(r=>r.name==='response.body'));
  }
});

test('existing y06 trace loader still imports all of its app seams',()=>{
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {createTrace} from './scripts/perf/y06/trace.mjs';
    createTrace(process.cwd());await import('./app/server.mjs');
  `],{cwd:root,env:syntheticEnvironment(process.env,'/tmp/unused-profile-test',root.pathname,false),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});


test('harness records actual awaited operations and leaves unobserved intervals uncovered',async()=>{
 const h=harness({evaluate:async()=>7,send:async()=>8},'test');
 assert.equal(await h.browser.evaluate('0'),7);assert.equal(await h.browser.send('Page.test'),8);
 await h.browser.wait('poll.sleep',()=>new Promise(r=>setTimeout(r,5)));
 assert.equal(h.spans.length,3);assert.ok(h.spans.every(s=>s.layer==='harness'&&s.end>=s.start));
 const s=reconcile(0,10,[{layer:'harness',name:'poll.sleep',start:2,end:8},{layer:'browser',name:'style',start:4,end:6}]);
 assert.equal(s.harnessMs,4);assert.equal(s.unaccountedMs,4);assert.equal(s.phases['browser:style'],2);
});
test('renderer reconstruction uses observed top-level tasks, nested categories and B/E pairs only',()=>{
 const e=[{ph:'M',name:'thread_name',pid:1,tid:2,args:{name:'CrRendererMain'}},
 {ph:'X',pid:1,tid:2,ts:1000,dur:8000,name:'RunTask',cat:'toplevel'},
 {ph:'B',pid:1,tid:2,ts:2000,name:'FunctionCall',args:{data:{functionName:'render'}}},
 {ph:'X',pid:1,tid:2,ts:4000,dur:1000,name:'Layout'},
 {ph:'E',pid:1,tid:2,ts:7000},
 {ph:'X',pid:1,tid:99,ts:0,dur:20000,name:'RunTask'}];
 const r=rendererSpans(e,{start:0,end:10,profileId:'click'});
 assert.equal(r.spans.reduce((n,s)=>n+s.end-s.start,0),8);
 assert.ok(r.spans.some(s=>s.name==='main.script:render'));assert.ok(r.spans.some(s=>s.name==='main.layout'));
 assert.equal(reconcile(0,10,r.spans).unaccountedMs,2);
 assert.equal(rendererSpans(e.slice(1),{start:0,end:10,profileId:'click'}).spans.length,0);
});
test('startup split preserves time and labels only measured module/dataset intervals',()=>{
 const r=workerStartupSpans([{id:'q',name:'worker.startup.wait',workerPid:42,start:0,end:10,spawnedAt:2,layer:'server'}],[
 {kind:'startup',processId:'42-1',phase:'module.load',start:2,end:4,module:'app/example.mjs'},
 {kind:'startup',processId:'42-1',phase:'dataset.evaluate',start:4,end:6},
 {kind:'startup',processId:'42-1',phase:'calculator.initialize',start:6,end:9}]);
 assert.equal(r.reduce((n,s)=>n+s.end-s.start,0),10);assert.deepEqual(r.map(s=>s.name),['worker.startup.spawn','worker.startup.module.load','worker.startup.dataset.evaluate','worker.startup.calculator.initialize','worker.startup.runtime/relay']);
});
test('mode flags default to spans only and paired bootstrap resamples differences',()=>{
 assert.equal(parse([]).cpu,false);assert.equal(parse([]).trace,false);
 assert.equal(parse(['--cpu','--trace']).cpu,true);assert.equal(parse(['--cpu','--trace']).trace,true);
 const b=bootstrapPaired(Array(20).fill(2),{samples:1000});assert.equal(b.median,2);assert.deepEqual(b.interval,[2,2]);assert.equal(b.pairedCount,20);
 assert.throws(()=>bootstrapPaired([NaN]),/Finite/);
});
