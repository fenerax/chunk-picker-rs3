import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateMeasurements, summarizeIdle, summarizeWarm } from '../scripts/perf/projection-summary.mjs';
import { plannedPairs, warmPlan, replyHash, rss } from '../scripts/perf/projection-warm.mjs';

test('warm cohort fixes the pair counts before observing new data', () => {
  assert.deepEqual(warmPlan, { preview: 48, mixed: 48, member1: 48, shared: 48 });
  assert.ok(Object.isFrozen(warmPlan));
  assert.equal(plannedPairs({ reference: { n: 20 }, pairedBootstrap95: [-15, 240] }, 25.488), 512);
  assert.equal(plannedPairs({ reference: { n: 20 }, pairedBootstrap95: [-76, 41] }, 28.245), 96);
  assert.equal(plannedPairs({ reference: { n: 20 }, pairedBootstrap95: [-1, 1] }, 25), 40);
});

test('warm response hashes compare transported content and exclude timing noise', () => {
  const encoded = new SharedArrayBuffer(17); new Uint8Array(encoded).set(Buffer.from('{"rows":[2,1,3]} '));
  const reply = { resultJSON: encoded, timingMs: { totalMs: 1 }, id: 1 };
  const expected = { resultJSON: { rows: [2, 1, 3] }, timingMs: { totalMs: 999 }, id: 8 };
  assert.equal(replyHash(reply), replyHash(expected));
  assert.notEqual(replyHash(reply), replyHash({ resultJSON: { rows: [2, 1, 4] } }));
  assert.ok(rss(process.pid).VmRSS > 0);
});

test('explicit GC probe preserves memoryUsage.rss and returns bounded numeric request diagnostics', () => {
  const probe = new URL('../scripts/perf/projection-gc-probe.mjs', import.meta.url).href;
  const workerCode = `import ${JSON.stringify(probe)}; import {parentPort} from 'node:worker_threads';
    parentPort.on('message',m=>{if(m.type==='echo')parentPort.postMessage({id:m.id,type:'echo'});});
    parentPort.postMessage({type:'ready'});`;
  const main = `import assert from 'node:assert/strict'; import {Worker,MessageChannel} from 'node:worker_threads';
    assert.equal(typeof process.memoryUsage.rss,'function'); assert.ok(process.memoryUsage.rss()>0);
    const w=new Worker(new URL('data:text/javascript,'+encodeURIComponent(${JSON.stringify(workerCode)})),{execArgv:[]});
    await new Promise(r=>w.once('message',r));
    const echoed=new Promise(r=>w.once('message',r));w.postMessage({type:'echo',id:1});await echoed;
    const c=new MessageChannel(),response=new Promise(r=>c.port1.once('message',r));
    w.postMessage({type:'cancel',id:-1,memoryPort:c.port2},[c.port2]);
    const {memoryUsage:d}=await response;assert.ok(d.heap.used>0);assert.equal(d.requests.length,1);
    assert.equal(d.requests[0].passesAfter-d.requests[0].passesBefore,0);
    assert.equal(typeof d.requests[0].gc.pauseMs,'number');assert.ok(d.gc.count>=0);
    c.port1.close();await w.terminate();`;
  const result = spawnSync(process.execPath, ['--import', probe, '--input-type=module', '-e', main], { encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('report builder rejects prose values and incomplete residency windows', () => {
  assert.doesNotThrow(() => validateMeasurements({ format: 'projection-phase4-v1', hash: 'a'.repeat(64), bytes: 8, samples: [1, 2] }));
  assert.throws(() => validateMeasurements({ nested: { text: 'Synthetic unapproved prose' } }), /MeasurementString/);
  assert.throws(() => validateMeasurements({ bytes: NaN }), /MeasurementNumber/);
  const sample = { elapsedMs: 0, worker: { VmRSS: 100, VmHWM: 200 }, parent: { VmRSS: 300, VmHWM: 400 } };
  assert.throws(() => summarizeIdle({ complete: false, samples: [sample] }, {}), /IdleIncomplete/);
  const reference = { complete: true, samples: Array.from({ length: 13 }, (_, i) => ({ ...structuredClone(sample), elapsedMs: i * 300000 })) };
  const candidate = structuredClone(reference); candidate.samples.at(-1).worker.VmRSS = 120;
  const result = summarizeIdle(reference, candidate);
  assert.equal(result.reference.durationMs, 3600000);
  assert.equal(result.candidate.worker.driftBytes, 20);
  assert.equal(result.endExtraBytes, 20);
  candidate.complete = false;
  assert.throws(() => summarizeIdle(reference, candidate), /IdleIncomplete/);
  assert.equal(summarizeIdle(reference, candidate, { allowInterrupted: true }).candidate.scheduledComplete, false);
});


test('fixed cohort summaries retain paired sequence totals and refuse duplicate arms', () => {
  const plan={preview:48,mixed:48,member1:48,shared:48},trials=[];
  for(const population of Object.keys(plan))for(let block=0;block<48;block++)for(const mode of [0,1])
    trials.push({population,block,mode,resultHash:'a'.repeat(64),measurement:{wallMs:1000+block-mode*20,sequenceWallMs:5000+block-mode*500},workerMemory:{VmRSS:100,VmHWM:200}});
  const report={complete:true,differences:0,signature:{plan},trials};
  const result=summarizeWarm(report);
  assert.equal(result.warm.preview.reference.n,48);
  assert.deepEqual(result.warm.preview.pairedDifferences,{n:48,median:-20,min:-20,max:-20});
  assert.deepEqual(result.sequences.shared.pairedBootstrap95,[-500,-500]);
  assert.equal(result.warm.mixed.withinMargin,true);
  const duplicate=structuredClone(report);duplicate.trials[1]=structuredClone(duplicate.trials[0]);
  assert.throws(()=>summarizeWarm(duplicate),/PairCount/);
  const mismatch=structuredClone(report);mismatch.trials[1].resultHash='b'.repeat(64);
  assert.throws(()=>summarizeWarm(mismatch),/ResultDifference/);
  assert.throws(()=>summarizeWarm({...report,complete:false}),/CohortIncomplete/);
});
