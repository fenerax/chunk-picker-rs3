import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createPhaseRecorder, instrumentEngine } from '../scripts/perf/incremental-engine-phases.mjs';

test('phase transitions exclude time while a processing generator is suspended', () => {
  let now = 0;
  const recorder = createPhaseRecorder(() => now);
  const end = recorder.evaluation(), phase = recorder.pass();
  now = 2; phase('fixedPointMs'); now = 7; phase('processingSelectionMs');
  now = 10; phase(null); now = 110; phase('fixedPointMs');
  now = 114; phase('projectionMs'); now = 120; phase(null); end();
  const { evaluations: [row] } = recorder.drain();
  assert.deepEqual(row.phases, { setupMs: 2, fixedPointMs: 9, processingSelectionMs: 3, projectionMs: 6 });
  assert.equal(row.wallMs, 120);
  assert.equal(row.passes, 1);
});

test('nested evaluations have explicit depths and independent rows', () => {
  let now = 0;
  const recorder = createPhaseRecorder(() => now);
  const outer = recorder.evaluation(); now = 1;
  const inner = recorder.evaluation(); now = 3;
  inner({ metrics: { eligibilityCacheHit: true, checks: 4, privateText: 'excluded' } });
  inner(); now = 5; outer();
  const { evaluations } = recorder.drain();
  assert.deepEqual(evaluations.map(row => [row.depth, row.wallMs, row.cacheHit]), [[1, 2, true], [0, 5, false]]);
  assert.deepEqual(evaluations[0].counters, { checks: 4 });
  assert.ok(!JSON.stringify(evaluations).includes('excluded'));
});

test('compile and prepare timing survive thrown operations and drain resets all records', () => {
  let now = 0;
  const recorder = createPhaseRecorder(() => now);
  recorder.compile(() => { now = 2; });
  const end = recorder.evaluation();
  assert.throws(() => recorder.prepare(() => { now = 7; throw Error('expected'); }), /expected/);
  assert.throws(() => recorder.drain(), /Active/);
  end();
  const report = recorder.drain();
  assert.equal(report.compileMs, 2);
  assert.equal(report.evaluations[0].prepareMs, 5);
  assert.deepEqual(recorder.drain(), { compileMs: 0, evaluations: [], dropped: 0 });
});

test('diagnostic rows stay bounded and unmeasured How replay has no phase state', () => {
  const recorder = createPhaseRecorder(() => 0, 2);
  recorder.pass()('projectionMs');
  for (let index = 0; index < 5; index++) recorder.evaluation()();
  const report = recorder.drain();
  assert.equal(report.evaluations.length, 2);
  assert.equal(report.dropped, 3);
});

test('current engine instrumentation parses and refuses missing or ambiguous anchors', async () => {
  const source = await readFile(new URL('../app/tasks/engine.mjs', import.meta.url), 'utf8');
  const transformed = instrumentEngine(source);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: transformed, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.throws(() => instrumentEngine(source.replace('    let disconnectedDetail;', '    let changedAnchor;')), /Anchor/);
  assert.throws(() => instrumentEngine(source + '\n    let disconnectedDetail;'), /Anchor/);
});

test('diagnostic preload preserves synthetic evaluate, prediction and How results', async t => {
  const [{ Worker }, { once }, { createGroupState }, { buildWorld }, { genericWorkerData }, { canonical }] = await Promise.all([
    import('node:worker_threads'), import('node:events'), import('../app/core/state.mjs'),
    import('../app/data/world.mjs'), import('./helpers/worker-dataset.mjs'), import('../tools/calc-check/compare.mjs'),
  ]);
  const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'],
    walkableChunksF2P: ['12341', '12342'], challenges: { Quest: {
      Present: { Chunks: ['12341'] }, Future: { Chunks: ['12342'] },
    } } };
  const world = buildWorld(definitions), state = createGroupState([{ id: 'one', name: 'One' }]);
  state.members[0].unlocked = ['12341'];
  const reports = [];
  for (const instrumented of [false, true]) {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
      workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }),
      execArgv: ['--import', new URL('./fixtures/counting-clock.mjs', import.meta.url).href,
        ...(instrumented ? ['--import', new URL('../scripts/perf/incremental-engine-probe.mjs', import.meta.url).href] : [])],
    });
    t.after(() => worker.terminate());
    try {
      const [ready] = await once(worker, 'message');
      assert.equal(ready.type, 'ready');
      assert.equal(!!ready.__incrementalProfile, instrumented);
      let sequence = 0;
      const send = async request => {
        const id = ++sequence;
        const response = new Promise((resolve, reject) => {
          const receive = message => {
            if (message.id !== id || ['progress', 'prediction-prepared'].includes(message.type)) return;
            worker.off('message', receive); worker.off('error', reject); resolve(message);
          };
          worker.on('message', receive); worker.once('error', reject);
        });
        worker.postMessage({ id, state, memberId: 'one', ...request });
        const message = await response;
        assert.equal(message.error, undefined);
        assert.equal(!!message.__incrementalProfile, instrumented);
        if (instrumented) assert.equal(message.__incrementalProfile.dropped, 0);
        return message;
      };
      const evaluated = await send({ type: 'evaluate' });
      if (instrumented) {
        const rows = evaluated.__incrementalProfile.evaluations;
        assert.ok(rows.length > 0);
        assert.ok(rows.some(row => row.phases.projectionMs > 0));
      }
      const predicted = await send({ type: 'predict', chunkId: '12342' });
      const how = await send({ type: 'how-task', chunkId: evaluated.result.tasks[0].id });
      const decodeReuse = reuse => reuse && Object.fromEntries(Object.entries(reuse).map(([key, value]) =>
        [key, key.endsWith('JSON') ? JSON.parse(Buffer.from(value)) : value]));
      reports.push(canonical({ evaluated: evaluated.result, predicted: predicted.result,
        reuse: decodeReuse(predicted.unlockReuse), how: how.result }));
    } finally { await worker.terminate(); }
  }
  assert.deepEqual(reports[1], reports[0]);
});
