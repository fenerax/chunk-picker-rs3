// Bounded synthetic attribution. Application sources are instrumented in memory.
// node scripts/perf/save-storage-attribution.mjs --catalogue-shape nominal
// No input-save/output-path option, HTTP server, full suite, or cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cpus, constants, setPriority } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(path.resolve(process.cwd()), path.resolve(root), 'Run from this checkout.');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
const nativeJSON = { parse: JSON.parse, stringify: JSON.stringify }, nativeClone = globalThis.structuredClone;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

if (isMainThread) {
  const { values } = parseArgs({ options: { 'catalogue-shape': { type: 'string', default: 'nominal' },
    copies: { type: 'string', default: '6' }, 'history-points': { type: 'string', default: '0,560,1120,1300' }, control: { type: 'boolean', default: false } } });
  assert(['nominal', 'smoke'].includes(values['catalogue-shape']));
  const copies = Number(values.copies), points = values['history-points'].split(',').map(Number);
  assert(Number.isInteger(copies) && copies >= 4 && copies <= 12 && copies % 2 === 0);
  assert(points.length >= 1 && points.length <= 5 && points.every(n => Number.isInteger(n) && n >= 0 && n <= 1300));
  assert.deepEqual(points, [...new Set(points)].sort((a, b) => a - b));
  const output = path.join(root, '.local', `save-storage-attribution-${Date.now()}-${randomBytes(4).toString('hex')}`);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.mkdir(output);
  // The worker matches fixture-group's isMainThread=false replacement path.
  const worker = new Worker(new URL(import.meta.url), { workerData: { output, shape: values['catalogue-shape'], copies, points, instrument: !values.control } });
  let lastPhase = 'starting';
  const heartbeat = setInterval(() => console.log(`Still measuring: ${lastPhase}`), 30000);
  const deadline = setTimeout(() => { console.error('18-minute budget reached; terminating this probe worker.'); void worker.terminate(); }, 18 * 60000);
  worker.on('message', message => { lastPhase = message.phase; console.log(nativeJSON.stringify(message)); });
  try {
    await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code ? reject(new Error(`Probe worker exit ${code}`)) : resolve()); });
  } finally { clearInterval(heartbeat); clearTimeout(deadline); }
  console.log(path.join(output, 'results.json'));
} else {
  await run(workerData);
}

async function run({ output, shape, copies, points, instrument }) {
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
  process.env.RS3_DATASET = 'duo-legacy';
  process.env.RS3_PACKS_DIR = path.join(output, 'no-packs');
  process.env.RS3_GAME_DATA_DIR = path.join(output, 'no-game-data');
  process.env.RS3_MAP_ASSETS_DIR = path.join(output, 'no-assets');
  const context = new AsyncLocalStorage();
  let metrics;
  const blank = () => ({ calls: 0, wallMs: 0, cpuMs: 0, selfWallMs: 0, selfCpuMs: 0 });
  function bucket(name, parent) {
    if (name.startsWith('catalogue-')) return 'taskCatalogue';
    if (name === 'history-checks') return 'historyChecks';
    if (name.startsWith('JSON.')) return 'json';
    if (name === 'structuredClone') return 'clone';
    if (name === 'gzip' || name === 'gunzip') return name;
    if (name.startsWith('disk.')) return 'disk';
    if (['hydrateStaticDocument', 'readStaticField', 'static-normalize'].includes(name)) return 'staticOther';
    if (['validateState', 'validateOwnedState', 'validateStateCopy', 'assertJson'].includes(name)) {
      if (['taskCatalogue', 'historyChecks'].includes(parent?.bucket)) return parent.bucket;
      return parent?.inHistory ? 'validationInHydrateHistory' : 'otherValidation';
    }
    if (name === 'hydrateHistory') return 'historyAssembly';
    return parent?.bucket ?? 'other';
  }
  function begin(name) {
    if (!metrics) return undefined;
    const parent = context.getStore();
    const frame = { name, parent, metrics, bucket: bucket(name, parent), inHistory: name === 'hydrateHistory' || parent?.inHistory,
      operation: ['importStoredBackup', 'hydrateHistory'].includes(name) ? name : parent?.operation ?? 'outsideImport',
      start: performance.now(), cpu: process.cpuUsage(), childWall: 0, childCpu: 0 };
    context.enterWith(frame); return frame;
  }
  function end(frame) {
    if (!frame) return;
    const used = process.cpuUsage(frame.cpu), wall = performance.now() - frame.start, cpu = (used.user + used.system) / 1000;
    const row = frame.metrics.spans[frame.name] ??= blank();
    row.calls++; row.wallMs += wall; row.cpuMs += cpu;
    row.selfWallMs += wall - frame.childWall; row.selfCpuMs += cpu - frame.childCpu;
    const category = frame.metrics.categories[frame.bucket] ??= { wallMs: 0, cpuMs: 0 };
    category.wallMs += wall - frame.childWall; category.cpuMs += cpu - frame.childCpu;
    const operation = frame.metrics.byOperation[frame.operation] ??= {};
    const part = operation[frame.bucket] ??= { wallMs: 0, cpuMs: 0 };
    part.wallMs += wall - frame.childWall; part.cpuMs += cpu - frame.childCpu;
    if (frame.parent) { frame.parent.childWall += wall; frame.parent.childCpu += cpu; }
    context.enterWith(frame.parent);
  }
  const profiler = {
    begin, end,
    sync(name, work) { const frame = begin(name); try { return work(); } finally { end(frame); } },
    async async(name, work) {
      const previous = context.getStore(), frame = begin(name); context.enterWith(previous);
      return context.run(frame, async () => { try { return await work(); } finally { end(frame); } });
    },
  };
  globalThis[Symbol.for('storage-attribution')] = profiler;
  const sourceHashes = {};
  const storeURL = new URL('../../app/storage/store.mjs', import.meta.url).href;
  const stateURL = new URL('../../app/core/state.mjs', import.meta.url).href;
  function once(source, old, replacement) { assert.equal(source.split(old).length, 2, `Anchor: ${old.slice(0, 90)}`); return source.replace(old, replacement); }
  const hook = instrument ? registerHooks({ load(url, options, next) {
    const result = next(url, options);
    if (![storeURL, stateURL].includes(url)) return result;
    let source = String(result.source); sourceHashes[url === storeURL ? 'store' : 'state'] = sha(source);
    source = source.replace(/\r\n/g, '\n');
    const wrap = (name, async) => {
      source = once(source, `${async ? 'async ' : ''}function ${name}(`,
        `${async ? 'async ' : ''}function ${name}(...args) { return __storageProbe.${async ? 'async' : 'sync'}('${name}', () => probe_${name}(...args)); }\n${async ? 'async ' : ''}function probe_${name}(`);
    };
    if (url === storeURL) {
      for (const name of ['retainBackup', 'serializedDiskState', 'compactHistory', 'pruneBackups', 'standaloneBackups',
        'retainedArchiveIndex', 'importStoredBackup', 'hydrateHistory', 'readStaticField', 'hydrateStaticDocument', 'replacementState']) wrap(name, true);
      source = once(source, 'const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);',
        `const probeGzip = promisify(gzip), probeGunzip = promisify(gunzip);
        const gzipAsync = (...args) => __storageProbe.async('gzip', () => probeGzip(...args));
        const gunzipAsync = (...args) => __storageProbe.async('gunzip', () => probeGunzip(...args));`);
      source = once(source, 'for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {',
        `const probeNormalize = __storageProbe.begin('static-normalize');
        for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {`);
      source = once(source, '    return state;\n  }\n  async function staticReference',
        `    __storageProbe.end(probeNormalize);\n    return state;\n  }\n  async function staticReference`);
      source = once(source, 'if (JSON.stringify(copy.document) !== JSON.stringify(snapshot.document))',
        `if (!__storageProbe.sync('JSON.compare', () => JSON.stringify(copy.document) === JSON.stringify(snapshot.document)))`);
    } else {
      for (const name of ['validateState', 'validateOwnedState', 'validateStateCopy', 'assertJson', 'applyCommand', 'applyValidatedCommand']) wrap(name, false);
      source = once(source, "  uniqueRecords(copy.tasks, 'tasks');", "  const probeCatalogue = __storageProbe.begin('catalogue-rows-and-indexes');\n  uniqueRecords(copy.tasks, 'tasks');");
      source = once(source, "  uniqueRecords(copy.members, 'members');", "  __storageProbe.end(probeCatalogue);\n  uniqueRecords(copy.members, 'members');");
      source = once(source, "  uniqueRecords(copy.history, 'history');", "  const probeHistory = __storageProbe.begin('history-checks');\n  uniqueRecords(copy.history, 'history');");
      source = once(source, '  const diagnostics = savedTaskRuleDiagnostics(copy);', "  __storageProbe.end(probeHistory);\n  const diagnostics = savedTaskRuleDiagnostics(copy);");
      source = once(source, 'const historicalTasks = new Map(copy.tasks.map(task => [task.id, task]));',
        "const historicalTasks = __storageProbe.sync('catalogue-history-index', () => new Map(copy.tasks.map(task => [task.id, task])));");
      source = once(source, 'let replayTaskIds = new Set(copy.tasks.map(task => task.id));',
        "let replayTaskIds = __storageProbe.sync('catalogue-replay-id-index', () => new Set(copy.tasks.map(task => task.id)));");
      source = once(source, 'let replayPositions = new Map(copy.tasks.map((task, index) => [task.id, index]));',
        "let replayPositions = __storageProbe.sync('catalogue-replay-position-index', () => new Map(copy.tasks.map((task, index) => [task.id, index])));");
      const visit = "visit(item[key], key === 'history' || key === 'incomingHistory' || key === 'previousHistory');";
      source = once(source, visit, `if (key === 'tasks' && branch.length === 1) __storageProbe.sync('catalogue-json-shape', () => ${visit.slice(0, -1)});
        else if (['history', 'incomingHistory', 'previousHistory'].includes(key)) __storageProbe.sync('history-checks', () => ${visit.slice(0, -1)});
        else ${visit}`);
    }
    return { ...result, source: `const __storageProbe = globalThis[Symbol.for('storage-attribution')];\n${source}` };
  } }) : { deregister() {} };
  if (instrument) {
    JSON.parse = (...args) => profiler.sync('JSON.parse', () => nativeJSON.parse(...args));
    JSON.stringify = (...args) => profiler.sync('JSON.stringify', () => nativeJSON.stringify(...args));
    globalThis.structuredClone = (...args) => profiler.sync('structuredClone', () => nativeClone(...args));
  }
  const original = {};
  const count = (key, value = 1) => { if (metrics) metrics.io[key] = (metrics.io[key] ?? 0) + value; };
  for (const key of instrument ? ['open', 'readFile', 'stat', 'readdir', 'unlink', 'rename', 'realpath', 'utimes'] : []) {
    original[key] = fs[key];
    fs[key] = (...args) => profiler.async(`disk.${key}`, async () => {
      count(key); const value = await original[key](...args);
      if (key === 'readFile') count('readBytes', Buffer.byteLength(value));
      if (key === 'open') {
        for (const method of ['sync', 'writeFile', 'close']) {
          const native = value[method].bind(value);
          value[method] = (...arguments_) => profiler.async(`disk.${method}`, async () => {
            count(method); if (method === 'writeFile') count('writeBytes', Buffer.byteLength(arguments_[0]));
            return native(...arguments_);
          });
        }
      }
      return value;
    });
  }
  syncBuiltinESMExports();
  async function measure(phase, work) {
    assert.equal(metrics, undefined); parentPort.postMessage({ phase });
    const sample = { spans: {}, categories: {}, byOperation: {}, io: {} }; metrics = instrument ? sample : undefined;
    const start = performance.now(), cpuStart = process.cpuUsage();
    try {
      if (instrument) await profiler.async('total', work);
      else {
        await work(); const used = process.cpuUsage(cpuStart);
        sample.spans.total = { ...blank(), calls: 1, wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1000 };
      }
    }
    finally { metrics = undefined; context.enterWith(undefined); }
    const cpu = Object.values(sample.categories).reduce((sum, row) => sum + row.cpuMs, 0);
    if (instrument) assert(Math.abs(cpu - sample.spans.total.cpuMs) < 0.001, 'CPU partition must conserve total.');
    await fs.writeFile(path.join(output, `${phase}.json`), nativeJSON.stringify(sample, null, 2), { flag: 'wx' });
    parentPort.postMessage({ phase: `${phase}:done`, wallMs: sample.spans.total.wallMs, cpuMs: sample.spans.total.cpuMs });
    return sample;
  }
  const { catalogue, syntheticWorld, planFixture, random } = await import('./capacity/model.mjs');
  const { growthCommands } = await import('./capacity/growth.mjs');
  const { createGroupState, applyCommand, applyValidatedCommand } = await import('../../app/core/state.mjs');
  const { createRuleRegistry } = await import('../../app/core/rules.mjs');
  const { buildWorld } = await import('../../app/data/world.mjs');
  const { createTaskEngine } = await import('../../app/tasks/engine.mjs');
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  const { openStore } = await import('../../app/storage/store.mjs');
  const { bindDatasetStorage } = await import('../../app/dataset-binding.mjs');
  const profile = nativeJSON.parse(await fs.readFile(new URL('./capacity/profiles/nominal.json', import.meta.url), 'utf8'));
  if (shape === 'smoke') profile.catalogue = { chunks: 64, tasks: 500, dependencyDepth: 4, crossLinks: 1 };
  const item = planFixture(profile).find(row => row.grown), rules = createRuleRegistry();
  let world, chunks, tasks;
  const catalogueBuild = await measure('catalogue-build', () => {
    const data = catalogue(profile.catalogue);
    tasks = createTaskEngine(data).catalogue.map(({ id, label, category }) => ({ id, label, category }));
    const { challenges, ...worldData } = data;
    world = syntheticWorld(worldData, buildWorld); chunks = Object.keys(worldData.chunks);
  });
  let state = createGroupState(item.members, rules), tick = 0;
  state.provenance = { dataset: { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest } };
  const expectedTicks = item.size * (Math.max(1, Math.floor(chunks.length * profile.fixture.unlockFraction)) + 6) + 1 + 1300;
  const now = () => Date.UTC(2026, 9, 1) + (tick - expectedTicks) * 12 * 3600000;
  const rng = random(`${profile.seed}-${item.index}`);
  const growth = await measure('growth', () => {
    for (const { command, ticks = 1 } of growthCommands(state, item, chunks, profile.fixture, now, rules)) {
      tick += ticks; state = applyCommand(state, command, { world, registry: rules, now: now(), random: rng });
    }
  });
  state.tasks = state.tasks.concat(nativeClone(tasks)); tasks = undefined;
  const catalogueTasks = state.tasks.length, taskBytes = Buffer.byteLength(nativeJSON.stringify(state.tasks));
  const seedDir = path.join(output, 'replacement'); await bindDatasetStorage(seedDir, selectedDataset);
  let store;
  const initialOpen = await measure('initial-open', async () => { store = await openStore({ dataDir: seedDir, world, registry: rules, initialState: state, now, random: rng }); });
  let replacement;
  try {
    replacement = await measure('replacement', () => store.replace({ format: 'rs3-chunk-picker', schemaVersion: 1, state: store.getState() }, store.getInfo().revision));
    state = store.getState();
  } finally { await store.close(); }
  const initialTick = tick, sampledStates = new Map();
  const cpu = process.cpuUsage(), at = performance.now();
  for (let i = 0; i <= Math.max(...points); i++) {
    if (points.includes(i)) sampledStates.set(i, state);
    if (i === Math.max(...points)) break;
    tick++;
    const phaseIndex = i < 1000 ? i : i - 1000;
    state = applyValidatedCommand(state, { type: 'set-note', memberId: 'owner', chunkId: chunks[phaseIndex % chunks.length],
      note: i < 1000 ? `Synthetic history ${item.index}-${i}` : `Synthetic snapshot ${i - 1000}` }, { registry: rules, world, now: now(), random: rng });
  }
  const usage = process.cpuUsage(cpu), offlineHistory = { wallMs: performance.now() - at, cpuMs: (usage.user + usage.system) / 1000 };
  const rows = [];
  for (const position of points) {
    const dataDir = path.join(output, `history-${position}`);
    let clock = Date.UTC(2026, 9, 1) + (initialTick + position - expectedTicks) * 12 * 3600000;
    const open = await measure(`h${position}-open`, async () => {
      store = await openStore({ dataDir, world, registry: rules, initialState: sampledStates.get(position), now: () => clock, random: rng });
    });
    try {
      const commands = [];
      for (let i = 0; i < copies; i++) {
        clock += 12 * 3600000;
        const index = position + i, phaseIndex = index < 1000 ? index : index - 1000;
        commands.push(await measure(`h${position}-command${i}`, () => store.command({ type: 'set-note', memberId: 'owner',
          chunkId: chunks[phaseIndex % chunks.length], note: index < 1000 ? `Synthetic history ${item.index}-${index}` : `Synthetic snapshot ${phaseIndex}` }, store.getInfo().revision)));
      }
      clock += 400 * 86400000;
      const beforeFiles = await fs.readdir(path.join(dataDir, 'backups'));
      const packing = await measure(`h${position}-packing`, () => store.prepareSnapshot());
      assert.equal(store.getInfo().retention.failure, undefined);
      const afterFiles = await fs.readdir(path.join(dataDir, 'backups'));
      const packed = beforeFiles.filter(name => name.endsWith('.json.gz')).length - afterFiles.filter(name => name.endsWith('.json.gz')).length;
      assert(packed > 0); if (instrument) assert.equal(packed, packing.io.unlink);
      const repeat = await measure(`h${position}-repeat`, () => store.prepareSnapshot());
      assert.equal(repeat.io.writeBytes ?? 0, 0);
      const packFiles = await fs.readdir(path.join(dataDir, 'backups', 'archives'));
      const hashes = {};
      for (const file of packFiles) hashes[file] = sha(await fs.readFile(path.join(dataDir, 'backups', 'archives', file)));
      await store.close();
      const cold = await measure(`h${position}-cold`, async () => { store = await openStore({ dataDir, world, registry: rules, now: () => clock, random: rng }); });
      assert.equal(store.getInfo().retention.failure, undefined);
      for (const [file, hash] of Object.entries(hashes)) assert.equal(sha(await fs.readFile(path.join(dataDir, 'backups', 'archives', file))), hash);
      rows.push({ position, historyEntries: sampledStates.get(position).history.length, copies, packed, packs: packFiles.length, open, commands, packing, repeat, cold,
        stateBytes: (await fs.stat(path.join(dataDir, 'state.json'))).size,
        staticFiles: (await fs.readdir(path.join(dataDir, 'static')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).length });
    } finally { await store.close(); }
  }
  hook.deregister(); JSON.parse = nativeJSON.parse; JSON.stringify = nativeJSON.stringify; globalThis.structuredClone = nativeClone;
  for (const [key, value] of Object.entries(original)) fs[key] = value;
  syncBuiltinESMExports();
  const result = { node: process.version, platform: process.platform, cpu: cpus()[0].model, priority: 'BelowNormal', instrument,
    shape: profile.catalogue, item, catalogueTasks, taskBytes, unlockedPerMember: Math.floor(chunks.length / 2),
    sourceHashes, catalogueBuild, growth, initialOpen, replacement, offlineHistory, rows,
    scope: 'One worker, synthetic data, no HTTP server/full suite. Inclusive spans and exclusive CPU categories; JSON and catalogue probes add overhead. Actual six-command windows; 1300-command fixture is extrapolated.' };
  await fs.writeFile(path.join(output, 'results.json'), nativeJSON.stringify(result, null, 2), { flag: 'wx' });
}
