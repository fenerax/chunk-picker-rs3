import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

// Inspect only the harness text: importing it would load real game modules.
const source = readFileSync(new URL('../scripts/perf/unlock-calc.mjs', import.meta.url), 'utf8');
const optionsSource = source.slice(source.indexOf('function options()'), source.indexOf('\nasync function rejectLinks'));
const casesSource = source.slice(source.indexOf('function selectCases('), source.indexOf('\nfunction resultSummary('));
const selectCases = new Function(`${casesSource}; return selectCases;`)();
const options = args => new Function('process', `${optionsSource}; return options();`)({ argv: ['node', 'harness', '--source', '.local/fixture', ...args] });

test('calculation batches retain the full deterministic 16-case plan with defaults and disjoint four-case slices', () => {
  const defaults = options([]);
  assert.equal(defaults.chunks, 8);
  assert.equal(defaults.caseStart, 0);
  assert.equal(defaults.caseLimit, null);
  assert.equal(defaults.heapSamples, 'off');
  assert.equal(options(['--heap-samples', 'on']).heapSamples, 'on');
  assert.throws(() => options(['--case-start', '-1']), /nonnegative/);
  assert.throws(() => options(['--case-limit', '0']), /positive/);
  assert.throws(() => options(['--heap-samples', 'invalid']), /on or off/);
  const candidates = ['a', 'b'].map(memberId => ({ memberId, chunks: Array.from({ length: 8 }, (_, index) => ({ id: `${memberId}-${index}` })) }));
  const saved = JSON.stringify(candidates), all = selectCases(candidates, 0, null);
  assert.equal(all.total, 16);
  assert.equal(all.cases.length, 16);
  const batched = [0, 4, 8, 12].flatMap(start => selectCases(candidates, start, 4).cases);
  assert.deepEqual(batched, all.cases);
  assert.deepEqual(batched.map(row => row.caseIndex), Array.from({ length: 16 }, (_, index) => index));
  assert.equal(batched.filter(row => row.memberId === 'a').length, 8);
  assert.equal(batched.filter(row => row.memberId === 'b').length, 8);
  assert.throws(() => selectCases(candidates, 16, 4), /outside/);
  assert.equal(JSON.stringify(candidates), saved);
});

function probe(enabled) {
  const start = source.indexOf('const runtime = String.raw`') + 'const runtime = String.raw`'.length;
  const end = source.indexOf('\n`;\n\nfunction replaceOnce', start);
  const runtime = source.slice(start, end).replace(/^import[^\n]*\n/gm, '').replace(/\bexport /g, '');
  let memoryReads = 0, time = 0;
  const context = {
    workerData: { probeHeap: enabled }, structuredClone,
    performance: { now: () => ++time },
    process: { memoryUsage() {
      memoryReads++;
      return { heapUsed: 100 + memoryReads, heapTotal: 200 + memoryReads, external: 20 + memoryReads, arrayBuffers: 10 + memoryReads, rss: 9999 };
    } },
  };
  vm.runInNewContext(`${runtime}\nglobalThis.probe = { begin, measured, sampleHeap, snapshot };`, context);
  return { api: context.probe, reads: () => memoryReads };
}

test('optional worker heap samples preserve operation/counters and retain only boundary maxima, not RSS', () => {
  const disabled = probe(false);
  disabled.api.begin();
  assert.equal(disabled.api.measured('accessEvaluateMs', () => 7), 7);
  const ordinary = disabled.api.snapshot();
  assert.equal(disabled.reads(), 0);
  assert.equal(ordinary.counts.accessEvaluateMs, 1);
  assert.equal(Object.keys(ordinary.heapBoundaryMax).length, 0);
  const enabled = probe(true);
  enabled.api.begin();
  assert.equal(enabled.api.measured('accessEvaluateMs', () => 7), 7);
  const sampled = enabled.api.snapshot();
  assert.equal(sampled.counts.accessEvaluateMs, 1);
  assert.equal(sampled.timings.accessEvaluateMs, ordinary.timings.accessEvaluateMs);
  assert.equal(sampled.heapBoundaryMax.accessEvaluateMs.samples, 2);
  assert.equal(sampled.heapBoundaryMax.accessEvaluateMs.heapUsedBytes, 103);
  assert.equal(sampled.heapBoundaryMax.requestStart.samples, 1);
  assert.equal(sampled.heapBoundaryMax.requestEnd.samples, 1);
  assert.equal(Object.hasOwn(sampled.heapBoundaryMax.accessEvaluateMs, 'rss'), false);
  assert.equal(Object.hasOwn(sampled.heapBoundaryMax.accessEvaluateMs, 'rssBytes'), false);
});

test('heap instrumentation anchors match current and available archived worker sources without importing game modules', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const helperSource = source.slice(source.indexOf('function replaceOnce('), source.indexOf('\nasync function startWorker('));
  const runtimeStart = source.indexOf('const runtime = String.raw`') + 'const runtime = String.raw`'.length;
  const runtime = source.slice(runtimeStart, source.indexOf('\n`;\n\nfunction replaceOnce', runtimeStart));
  const writes = new Map();
  let legacyImportFixture = false;
  const readSource = async filename => {
    const content = readFileSync(filename, 'utf8');
    return legacyImportFixture && filename.endsWith(`${path.sep}worker.mjs`)
      ? content.replace("import { projectDuoSidebarResult }", "import { projectDuoPlayResult, projectDuoSidebarResult }") : content;
  };
  const instrument = new Function('assert', 'path', 'pathToFileURL', 'readFile', 'writeFile', 'ROOT', 'relative', 'sha', 'runtime',
    `${helperSource}; return instrument;`)(assert, path, pathToFileURL, readSource,
    async (filename, content) => writes.set(filename, content), root, filename => path.relative(root, filename), () => 'fixture-hash', runtime);
  const archive = path.join(root, '.local/perf-fixtures/engine-before-395ceb0/app');
  for (const [appDir, legacyFixture] of [[path.join(root, 'app'), false], [path.join(root, 'app'), true],
    ...(existsSync(archive) ? [[archive, false]] : [])]) {
    legacyImportFixture = legacyFixture;
    const scratch = path.join(root, '.local/perf-fixtures/heap-anchor-check');
    const result = await instrument(scratch, appDir);
    assert(result.anchors.includes('worker stage heap start'));
    assert(result.anchors.includes('worker stage heap end'));
    const worker = writes.get(path.join(scratch, 'worker.mjs'));
    const original = await readSource(path.join(appDir, 'tasks/worker.mjs'));
    const expectedProjection = original.includes('projectDuoPlayResult, projectDuoSidebarResult }') ? 'active' : 'sidebar';
    assert.equal(result.peerProjection, expectedProjection);
    assert.equal(worker.includes('function projectDuoPlayResult('), expectedProjection === 'active');
    assert(worker.includes('projectDuoSidebarResult as rawProjectDuoSidebarResult'));
    assert.equal(worker.split('sampleHeap(stage);').length - 1, 2);
    assert(worker.includes('probe: startupSnapshot()'));
    if (original.includes('setImmediate(() => parentPort.postMessage')) {
      assert(worker.includes('setImmediate(() => parentPort.postMessage'), 'instrumentation preserves deferred readiness');
    }
    assert(worker.includes(pathToFileURL(path.join(appDir, 'play-view.mjs')).href));
    assert(writes.get(path.join(scratch, 'probe-runtime.mjs')).includes('export function sampleHeap'));
  }
});
