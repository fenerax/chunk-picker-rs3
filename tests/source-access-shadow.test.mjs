import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { encodeShadow,createShadowLedger,createSourceAccessShadow,sourceRootInputs,instrumentShadow } from '../scripts/perf/source-access-shadow.mjs';

test('shadow rejects changed positive/negative reads, ordered sets, inputs and scopes and detects mismatches',()=>{
  const graph=createShadowLedger(),reads=new Map([['yes',true],['no',false]]),valid=new Set(['yes']);
  const observe=(job,value=1,input='input',scope='dataset')=>graph.observe('node',scope,input,reads,valid,value,{job,order:[...valid]});
  observe(1);observe(2);assert.equal(graph.report().counters.node.crossJobHits,1);
  valid.add('no');reads.set('no',true);observe(3);assert.equal(graph.report().counters.node.dependencyMisses,1);
  observe(4,2);assert.equal(graph.report().counters.node.differences,1);
  observe(5,2,'changed');observe(6,2,'changed','other-dataset');
  graph.observe('node',null,'input',reads,valid,1);assert.equal(graph.report().counters.node.fallbacks,1);
  const ordered=createShadowLedger();ordered.observe('node','scope','input',new Map(),new Set(['a','b']),1,{job:1,order:['a','b']});
  ordered.observe('node','scope','input',new Map(),new Set(['b','a']),1,{job:2,order:['b','a']});
  assert.equal(ordered.report().counters.node.crossJobHits,0);
});

test('shadow ledger remains bounded and never supplies a cached value',()=>{
  assert.throws(()=>encodeShadow(()=>true),/Untracked/);
  const graph=createShadowLedger({maxEntries:1,maxBytes:1024});
  for(let i=0;i<20;i++)assert.equal(graph.observe('node','scope',i,new Map(),new Set(),i,{job:i}),undefined);
  assert.equal(graph.report().entries,1);assert.ok(graph.report().peakSerializedBytes<=1024);
  const disabled=createShadowLedger({maxBytes:0});disabled.observe('node','scope',1,new Map(),new Set(),2);
  assert.equal(disabled.report().entries,0);
});

const view=(extra=false,quantity='1',area=false)=>JSON.stringify([['100'],[],area?['Room']:[],{},
  [['Coin',[['100',['number',quantity]]]],...(extra?[['Other',[['101',['number','1']]]]]:[])],[],[],[]]);
test('source contributions use exact quantities and stock-location references and conservative gate footprints',()=>{
  const definitions={taskUnlocks:{Shops:{'Store^Prize':{Room:{Gate:'Quest'}}}}};
  const a=sourceRootInputs(definitions,view()),b=sourceRootInputs(definitions,view(true));
  assert.deepEqual(a.get('["spawn","Coin"]').input,b.get('["spawn","Coin"]').input);
  assert.notDeepEqual(a.get('["shop","Store"]').stock,sourceRootInputs(definitions,view(false,'1',true)).get('["shop","Store"]').stock);
  const trace=createSourceAccessShadow({datasetDigest:'a'.repeat(64)}),valid=new Set(),reads=new Map([['gate',false]]);
  const observe=(job,resourceView,quantity=1)=>{trace.job(job);const value={items:new Set(['Coin']),sources:new Map([['Coin',[{kind:'spawn',source:'100',location:'100',quantity}]]]),diagnostics:[]};
    trace.capture(value,[['Coin',value.sources.get('Coin')[0]]],1);trace.sources(definitions,resourceView,{}, {value,reads:new Map(reads)},valid);};
  observe(1,view());observe(2,view(true));
  assert.equal(trace.report().counters.sourceWhole.crossJobHits,0);assert.ok(trace.report().counters.sourceRoot.crossJobHits>0);
  const before=trace.report().counters.sourceRoot.crossJobHits;observe(3,view(false,'2'),2);
  // The stock root may still match; the changed quantity root cannot.
  assert.equal(trace.report().counters.sourceRoot.crossJobHits,before+1);
  valid.add('gate');reads.set('gate',true);observe(4,view(false,'2'),2);
  assert.ok(trace.report().counters.sourceRoot.dependencyMisses>0);assert.equal(trace.report().faults,0);assert.equal(trace.report().ambiguous,0);
});

test('shadow anchors fail closed and the explicit preload preserves ordinary engine outputs',async()=>{
  for(const kind of ['engine','access']){
    const source=await readFile(new URL(`../app/tasks/${kind}.mjs`,import.meta.url),'utf8');
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:instrumentShadow(source,kind),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.throws(()=>instrumentShadow('',kind),/Anchor/);
  }
  const run=probe=>new Promise((resolve,reject)=>{
    const source=`import {parentPort} from 'node:worker_threads';
      import {createTaskEngine} from ${JSON.stringify(new URL('../app/tasks/engine.mjs',import.meta.url).href)};
      import {canonical,hash} from ${JSON.stringify(new URL('../tools/calc-check/compare.mjs',import.meta.url).href)};
      const engine=createTaskEngine({chunks:{100:{Spawn:{Coin:1}},101:{Spawn:{Other:1}}},challenges:{Nonskill:{Goal:{Chunks:['100']}}}},{reviewedOverlays:false,metadataCorrections:false,equipmentCorrections:false});
      const state={rules:{'content.f2p':false},members:[{id:'m',unlocked:['100'],completedTasks:[]}]},hashes=[];
      for(let i=0;i<2;i++){globalThis[Symbol.for('rs3.source.shadow')]?.job(i+1);if(i)state.members[0].unlocked.push('101');hashes.push(hash(JSON.stringify(canonical(engine.evaluate(state,'m')))));}
      parentPort.postMessage({type:'done',hashes});`;
    let received=false;
    const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{execArgv:probe?['--import',new URL('../scripts/perf/source-access-shadow-probe.mjs',import.meta.url).href]:[],workerData:{datasetDigest:'a'.repeat(64)}});
    worker.once('error',reject);worker.once('message',value=>{received=true;worker.terminate().then(()=>resolve(value),reject);});worker.once('exit',code=>{if(code&&!received)reject(Error('WorkerExit'));});
  });
  const reference=await run(false),shadow=await run(true);
  assert.deepEqual(shadow.hashes,reference.hashes);assert.equal(shadow.__sourceGraph.faults,0);
  assert.ok(shadow.__sourceGraph.counters.sourceRoot.crossJobHits>0);
  assert.ok(Object.values(shadow.__sourceGraph.counters).every(c=>c.differences===0));
});
