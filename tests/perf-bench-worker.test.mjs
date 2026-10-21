import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

test('worker timeline observes actual receive/completion and keeps only approved metadata', async t => {
  const preload = new URL('../scripts/perf/worker-timeline.mjs', import.meta.url).href;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`import {parentPort} from 'node:worker_threads';
    parentPort.on('message',message=>{if(message.type!=='cancel')parentPort.postMessage({id:message.id,result:true});});`)),
  { execArgv: ['--import', preload] });
  t.after(() => worker.terminate());
  worker.postMessage({ id: 1, type: 'evaluate', memberId: 'player1', stateRevision: 7, secret: 'fixture-private' });
  const [message] = await once(worker, 'message');
  assert.equal(message.perfTimeline.memberId, 'player1');
  assert.equal(message.perfTimeline.revision, 7);
  assert.ok(message.perfTimeline.startedEpochMs <= message.perfTimeline.doneEpochMs);
  assert.ok(message.perfTimeline.startedEpochMs > Date.now() - 10000);
  assert.doesNotMatch(JSON.stringify(message.perfTimeline), /fixture-private|secret/);
  worker.postMessage({ id: 2, type: 'evaluate', memberId: 'fixture-private', state: { revision: 8 } });
  const [next] = await once(worker, 'message');
  assert.equal(next.perfTimeline.memberId, null);
  assert.equal(next.perfTimeline.revision, 8);
});
