import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync, crc32, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { frames, frame, packParts, unpackParts } from '../calculator/reference/codec.mjs';
import { differences, digestTree, treeDifferences } from '../tools/calc-check/compare.mjs';
import { commandWords, Calculator } from '../tools/calc-check/client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = `${JSON.stringify(process.execPath)} calculator/reference/main.mjs`;
const candidate = `${JSON.stringify(process.execPath)} tools/calc-check/wrong-candidate.mjs`;
function publicEnv(dataset) {
  const env = { ...process.env, RS3_DATASET: dataset };
  for (const key of ['NODE_TEST_CONTEXT', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_GAME_DEFAULTS_FILE', 'RS3_MAP_ASSETS_DIR', 'RS3_GAME_DATA_DIR']) delete env[key];
  return env;
}

test('framing survives every byte boundary, multipart JSON, and refuses truncation', async () => {
  const parts = packParts({ play: { message: 'é' }, full: [1, null, -0, 0.1] });
  const bytes = frame({ v: 1, type: 'result', parts: parts.parts }, parts.body);
  const received = [];
  for await (const value of frames(Readable.from([...bytes].map(b => Buffer.from([b]))))) received.push(value);
  assert.equal(received.length, 1);
  assert.deepEqual(unpackParts(received[0].header, received[0].body), { play: { message: 'é' }, full: [1, null, 0, 0.1] });
  await assert.rejects(async () => { for await (const value of frames(Readable.from([bytes.subarray(0,-1)]))) void value; }, TypeError);
  const prefix = Buffer.from('{\"message\":\"é\"');
  const compressed = gzipSync(prefix, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
  const encoded = { name: 'play', bytes: compressed.length, encoding: 'gzip-sync-prefix', rawLength: prefix.length, crc32: crc32(prefix) };
  assert.deepEqual(unpackParts({ parts: [encoded] }, compressed).play, { message: 'é' });
  assert.throws(() => unpackParts({ parts: [{ ...encoded, crc32: 0 }] }, compressed), TypeError);
  const literal = { $calcType: 'Map', entries: [['literal', 1]] };
  const packed = packParts({ full: literal });
  assert.deepEqual(unpackParts(packed, packed.body).full, literal);
  assert.throws(() => unpackParts({ parts: [{ name: 'x', bytes: 99 }] }, Buffer.from('{}')), TypeError);
});

test('comparison preserves array order and gameplay fields, ignores only sourced measurements', () => {
  assert.deepEqual(differences({ play: { metrics: { elapsedMs: 1, availableCount: 2 } } }, { play: { metrics: { elapsedMs: 3, availableCount: 2 } } }), []);
  const diff = differences({ play: { metrics: { availableCount: 2 } } }, { play: { metrics: { availableCount: 3 } } });
  assert.equal(diff[0].path, '/play/metrics/availableCount');
  assert.match(diff[0].referenceHash, /^[a-f0-9]{64}$/);
  assert.equal(differences([1,2], [2,1]).length, 2);
  assert.equal(differences({ play: { timingMs: 1 } }, { play: { timingMs: 2 } }).length, 1);
  const dictionaryLabel = 'Sensitive dictionary label';
  assert.ok(!JSON.stringify(differences({ [dictionaryLabel]: 1 }, { [dictionaryLabel]: 2 })).includes(dictionaryLabel));
  assert.equal(treeDifferences(digestTree({ cache: { baselineSource: 'worker' } }), digestTree({ cache: { baselineSource: 'current-list' } })).length, 1);
  assert.equal(treeDifferences(digestTree({ cache: { baselineHit: true } }), digestTree({ cache: { baselineHit: false } })).length, 0);
  assert.deepEqual(commandWords('node "two words.mjs" \'literal$()\''), ['node', 'two words.mjs', 'literal$()']);
});

test('small generated and fixture corpus matches, while one wrong field exits nonzero at its exact path', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'calc-check-test-'));
  const { writeFile } = await import('node:fs/promises');
  try {
    const spec = path.join(directory, 'corpus.json');
    await writeFile(spec, JSON.stringify({ generated: { steps: 2 }, fixtures: { capture: false }, limits: { generated: 4, fixtures: 2 } }));
    for (const [command, expectedCode, serial] of [[reference, 0, false], [candidate, 1, false], [candidate, 1, true]]) {
      const reportFile = path.join(directory, `report-${expectedCode}.json`);
      const child = spawn(process.execPath, ['tools/calc-check/main.mjs', '--reference', reference, '--candidate', command,
        '--corpus', spec, '--seed', '17', '--report', reportFile, '--cap-predict', '1', '--cap-death-estimates', '1', '--cap-chunk-planning', '1', '--serial', String(serial)],
        { cwd: root, env: { ...process.env, RS3_DATASET: 'open-starter' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.resume(); child.stderr.resume();
      const [code] = await once(child, 'close');
      const report = JSON.parse(await readFile(reportFile, 'utf8'));
      assert.equal(code, expectedCode, JSON.stringify({ error: report.errorKind, differences: report.differences.slice(0,3) }));
      assert.equal(report.errors, 0);
      if (expectedCode && process.platform === 'linux' && report.peakRSSBytes.reference > 0) {
        assert.ok(report.peakRSSBytes.candidate > 64 * 1024 * 1024, 'wrapper RSS includes its calculator child');
      }
      assert.equal(report.corpus.generated, 4); assert.equal(report.corpus.fixtures, 2);
      assert.ok(report.sequenceRequests > 0);
      for (const type of ['evaluate','predict','death-estimates','chunk-planning','sandbox','area-check','roll-pool','prepare-rules']) assert.ok(report.requests[type] > 0, type);
      if (expectedCode) {
        assert.ok(report.differences.some(d => d.requestType === 'evaluate' && d.path === '/play/metrics/availableCount'));
      } else assert.equal(report.differenceCount, 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('adapter refuses unknown requests, validates state members, bounds refs, scopes supersession, and exits on EOF', { timeout: 30000 }, async () => {
  const calculator = new Calculator(reference, { timeoutMs: 10000, env: publicEnv('duo-legacy') });
  // Resolve the independent bundle in a child so the suite never changes the
  // application's process-wide dataset selection.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { selectedDataset } from './app/dataset-runtime.mjs';
    import { stringify } from './calculator/reference/codec.mjs';
    console.log(stringify({ datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
      definitions: { chunks: { '12341': {}, '12342': {} }, challenges: { Extra: { Goal: { PickerId: 'rs3:task:calc-check-goal' } } }, walkableChunks: ['12341','12342'], walkableChunksF2P: ['12341','12342'] },
      datasetOptions: { cacheWalking: false, reviewedOverlays: false }, world: { chunks: new Map([['12341',{id:'12341'}],['12342',{id:'12342'}]]), areas: new Map(), surface: new Set(['12341','12342']) }, omitReadyCatalogue: true }));
  `], { cwd: root, env: publicEnv('duo-legacy'), stdio: ['ignore','pipe','ignore'] });
  let output = ''; child.stdout.on('data', b => { output += b; });
  await once(child, 'close');
  const { parse } = await import('../calculator/reference/codec.mjs');
  const bundle = parse(Buffer.from(output));
  const state = { schemaVersion: 1, revision: 0, rules: {}, tasks: [], history: [], members: [{ id: 'm', name: 'M', sourceMapId: null, unlocked: ['12341'], selected: [], pendingRoll: [], blacklisted: [], completedTasks: [], teleports: [], taskStatus: {}, taskRules: {} }] };
  const request = (input, overrides = {}) => ({ type: 'prepare-rules', pickerId: 'legacy-shared', revision: 0, input, snapshotKey: JSON.stringify([0,input]), state: 'body', ...overrides });
  try {
    const ready = await calculator.init(bundle);
    assert.equal(ready.header.supports.length, 8);
    assert.deepEqual(ready.parts, {});
    assert.equal((await calculator.request(request('x', { type: 'unknown' }), state).promise).header.error.kind, 'invalid');
    assert.equal((await calculator.request(request('x', { memberIds: ['wrong'] }), state).promise).header.error.kind, 'invalid');
    for (const key of ['a','b','c']) assert.equal((await calculator.request(request(key), state).promise).header.type, 'result');
    assert.equal((await calculator.request(request('a', { state: 'ref' })).promise).header.error.kind, 'snapshot-missing');
    const rebound = request('c', { state: 'ref', revision: 1, snapshotKey: JSON.stringify([1,'c']) });
    assert.equal((await calculator.request(rebound).promise).header.type, 'result');
    const evaluate = pickerId => request('shared', { type: 'evaluate', memberId: 'm', pickerId, view: 'play-v1', projections: [] });
    const first = await calculator.request(evaluate('legacy-shared'), state).promise;
    const otherPicker = 'p_00000000000000000000000000000001';
    const different = { ...state, members: state.members.map(m => ({ ...m, unlocked: ['12342'] })) };
    const second = await calculator.request(evaluate(otherPicker), different).promise;
    const reused = await calculator.request({ ...evaluate('legacy-shared'), state: 'ref' }).promise;
    assert.deepEqual(digestTree(first.parts), digestTree(reused.parts));
    assert.notEqual(digestTree(first.parts).hash, digestTree(second.parts).hash);
    const pool = await calculator.request(request('pool-draft', { type: 'roll-pool', memberId: 'm', draft: { changes: { doneTasks: ['rs3:task:calc-check-goal'] } } }), state).promise;
    assert.equal(pool.header.type, 'result');
    for (const [revision, threshold] of [[0, 1], [1, 2]]) {
      const changed = { ...state, revision, members: state.members.map(m => ({ ...m, preferences: { deathThresholdHours: threshold } })) };
      const reply = await calculator.request(request('preferences', { type: 'death-estimates', memberId: 'm', chunkIds: ['12342'], revision, snapshotKey: JSON.stringify([revision, 'preferences']) }), changed).promise;
      assert.equal(reply.header.type, 'result', JSON.stringify({ revision, kind: reply.header.error?.kind }));
      assert.equal(reply.parts.estimates.estimates[0].thresholdHours, threshold);
    }
    await calculator.control({ type: 'supersede', pickerId: 'p_ffffffffffffffffffffffffffffffff', revision: 9999 });
    assert.equal((await calculator.request(request('d'), state).promise).header.cancelled, false);
    await calculator.control({ type: 'supersede', pickerId: 'legacy-shared', revision: 2 });
    assert.equal((await calculator.request(request('e'), state).promise).header.cancelled, true);
  } finally { await calculator.close(); }
  assert.equal(calculator.exit.code, 0);
});

// Runs three core test files in a child; under the full suite on CI that alone can pass 30 s.
test('fixture harvesting includes commands, getter-safe engines and per-test datasets', { timeout: 120000 }, async () => {
  const env = publicEnv('duo-legacy');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { buildCorpus } from './tools/calc-check/corpus.mjs';
    const corpus = await buildCorpus({ fixtures: { tests: ['planning.test.mjs', 'engine-hotspots.test.mjs', 'game-plugin-mapping.test.mjs'] } }, 17);
    try {
      console.log(JSON.stringify({ coverage: corpus.coverage,
        states: corpus.groups.reduce((n,g) => n + g.states.length, 0),
        datasets: new Set(corpus.groups.map(g => g.bundle.datasetDigest)).size }));
    } finally { await corpus.close(); }
  `], { cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = ''; child.stdout.on('data', bytes => { output += bytes; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  const result = JSON.parse(output);
  assert.equal(result.coverage.fixtureTestFiles, 3);
  assert.equal(result.coverage.fixtureTests.failed, 0);
  assert.ok(result.coverage.fixtureCaptures > 10, JSON.stringify(result));
  assert.ok(result.states > 10);
  assert.equal(result.datasets, 2);
});

test('malformed candidate replies and unread init bundles fail within the watchdog instead of hanging', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'calc-check-client-'));
  const { writeFile } = await import('node:fs/promises');
  const codec = JSON.stringify(new URL('../calculator/reference/codec.mjs', import.meta.url).href);
  try {
    // Ready is valid; every result declares a part longer than its body.
    const malformed = path.join(directory, 'malformed.mjs');
    await writeFile(malformed, `import { frames, writer } from ${codec};
      const send = writer(process.stdout);
      for await (const { header } of frames(process.stdin)) {
        if (header.type === 'init') await send({ v: 1, type: 'ready', parts: [] });
        else if (header.id) await send({ v: 1, type: 'result', id: header.id, parts: [{ name: 'play', bytes: 99 }] }, Buffer.from('{}'));
      }`);
    const calculator = new Calculator(`${JSON.stringify(process.execPath)} ${JSON.stringify(malformed)}`, { timeoutMs: 20000 });
    await calculator.init({});
    const began = performance.now();
    await assert.rejects(calculator.request({ type: 'evaluate' }, {}).promise, /failed/);
    assert.ok(performance.now() - began < 10000, 'rejected by the decode failure, not the request watchdog');
    await calculator.close();
    // Never reads stdin, so a bundle larger than the pipe buffer cannot drain.
    const deaf = path.join(directory, 'deaf.mjs');
    await writeFile(deaf, 'setInterval(() => {}, 1000);');
    const stuck = new Calculator(`${JSON.stringify(process.execPath)} ${JSON.stringify(deaf)}`, { timeoutMs: 1000 });
    await assert.rejects(stuck.init({ padding: 'x'.repeat(8 * 1024 * 1024) }), /failed/);
    await stuck.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing history states are verified forwards and backwards, while undo barriers stay gaps', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createGroupState, applyCommand } from './app/core/state.mjs';
    import { createRuleRegistry } from './app/core/rules.mjs';
    import { buildWorld } from './app/data/world.mjs';
    import { SURFACE_GRID } from './app/data/surface-grid.mjs';
    import { rebuildHistoryRevisions } from './tools/calc-check/history.mjs';
    const registry=createRuleRegistry(), ids=[String(SURFACE_GRID.startId),String(SURFACE_GRID.startId+SURFACE_GRID.stride)], world=buildWorld({chunks:Object.fromEntries(ids.map(id=>[id,{}])), challenges:{}, walkableChunks:ids, walkableChunksF2P:ids});
    const options={registry,world,now:()=> '2026-01-01T00:00:00.000Z'};
    const initial=createGroupState([{id:'m',name:'Player',unlocked:[ids[0]]}],registry);
    initial.tasks=[{id:'rs3:task:history-proof',category:'Extra',label:'Goal'}];
    const states=[initial], rule=registry.definitions.find(row=>row.type==='boolean');
    for (const command of [{type:'set-rule',ruleId:rule.id,value:!rule.default},{type:'set-chunk',memberId:'m',chunkId:ids[1],status:'unlocked'},{type:'complete-task',memberId:'m',taskId:'rs3:task:history-proof',completed:true}]) states.push(applyCommand(states.at(-1),command,options));
    for (const anchors of [[0,3],[3]]) {
      const known=new Map(anchors.map(i=>[i,{load:async()=>states[i]}]));
      assert.equal(await rebuildHistoryRevisions(states[3],known,options),2,JSON.stringify(anchors));
      for (const i of [1,2]) assert.deepEqual(await known.get(i).load(),states[i]);
    }
    const undone=applyCommand(states[3],{type:'undo'},options), known=new Map([[4,{load:async()=>undone}]]);
    assert.equal(await rebuildHistoryRevisions(undone,known,options),0);
    assert.equal(known.size,1);
  `], { cwd: root, env: publicEnv('open-starter'), stdio: ['ignore','ignore','pipe'] });
  let errors=''; child.stderr.on('data', bytes => { errors+=bytes; });
  const [code]=await once(child,'close');
  assert.equal(code,0,errors);
});
