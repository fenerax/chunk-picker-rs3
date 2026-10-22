import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { interactionScenarios } from '../scripts/perf/browser-interactions.mjs';
import { loadPerfInputs, perfDatasetMetadata, resolvePerfApplication, fingerprintPerfApplication } from '../scripts/perf/inputs.mjs';

// Synthetic files only; no provider bootstrap, game data, browser or server.
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-perf-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, bytes) => {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
    return filename;
  };
  return { root, put };
}

test('pack measurements load verified provider bytes and migration inputs without tracked PC files', async t => {
  const { root, put } = await fixture(t);
  await put('app/dataset-bootstrap.mjs', `export async function loadDatasetInputs(dataset) {
    return { definitionBytes: dataset.bytes('definitions'), taskBytes: dataset.bytes('tasks') };
  }`);
  await put('app/dataset-pipeline.mjs', `export const prepareServerDefinitions = (raw, dataset) => ({...raw, preparedFor: dataset.digest});
    export const preparedDefinitionStages = () => ['equipmentCorrections', 'definitionOverlays'];`);
  const definitions = { chunks: { 1: { name: 'Synthetic' } } }, taskMap = { sample: 'task' }, history = { schemaVersion: 1 };
  const dataset = { packed: true, datasetId: 'duo-legacy', digest: 'a'.repeat(64),
    bytes: key => Buffer.from(JSON.stringify(key === 'definitions' ? definitions : taskMap)),
    json: async key => { assert.equal(key, 'app/data/legacy-task-history.json'); return history; } };
  const corrections = () => assert.fail('Pack mode must use the selected app definition pipeline');
  const loaded = await loadPerfInputs({ root, dataset, applyEquipmentCorrections: corrections, applyCacheShops: corrections });
  assert.deepEqual(JSON.parse(loaded.raw), definitions);
  assert.deepEqual(loaded.taskMap, taskMap);
  assert.deepEqual(loaded.taskMapHistory, history);
  assert.deepEqual(JSON.parse(loaded.definitionBytes), { ...definitions, preparedFor: dataset.digest });
  assert.deepEqual(loaded.preparedDatasetStages, ['equipmentCorrections', 'definitionOverlays']);
  assert.deepEqual(perfDatasetMetadata(dataset), { datasetId: 'duo-legacy', digest: 'a'.repeat(64), packed: true });
});

test('tracked-file mode retains correction ordering and legacy task-map fallback', async t => {
  const { root, put } = await fixture(t);
  await put('rs3-chunkpicker-chunkinfo-export.json', '{"legacy":true}');
  await put('tasksMap.json', '{"old":"task"}');
  await put('app/data/legacy-task-history.json', '{"history":true}');
  const calls = [];
  const loaded = await loadPerfInputs({ root, dataset: { packed: false },
    applyEquipmentCorrections: raw => { calls.push('equipment'); return { ...raw, equipment: true }; },
    applyCacheShops: raw => { calls.push('shops'); assert.equal(raw.equipment, true); return raw; } });
  assert.deepEqual(calls, ['equipment', 'shops']);
  assert.deepEqual(loaded.definitions, { legacy: true, equipment: true });
  assert.deepEqual(loaded.taskMap, { old: 'task' });
  assert.deepEqual(loaded.preparedDatasetStages, []);
});

test('external checkout selection retains server entry containment and fingerprints all app files', async t => {
  const { root, put } = await fixture(t);
  await put('harness/app/server.mjs', '// harness');
  await put('checkout/app/server.mjs', '// selected');
  const module = await put('checkout/app/web/other.mjs', '// first');
  const harness = path.join(root, 'harness'), checkout = path.join(root, 'checkout');
  await assert.rejects(resolvePerfApplication(harness, { serverEntry: path.join(checkout, 'app/server.mjs') }), /inside the selected worktree/);
  const selected = await resolvePerfApplication(harness, { appDir: checkout });
  assert.equal(selected.applicationRoot, checkout);
  assert.equal(selected.serverEntry, path.join(checkout, 'app/server.mjs'));
  assert.deepEqual(await resolvePerfApplication(harness, { appDir: path.join(checkout, 'app') }), selected);
  await assert.rejects(resolvePerfApplication(harness, { appDir: checkout, serverEntry: path.join(harness, 'app/server.mjs') }), /inside the selected worktree/);
  const before = await fingerprintPerfApplication(checkout);
  assert.deepEqual(before.files.map(row => row.path), ['app/server.mjs', 'app/web/other.mjs']);
  await writeFile(module, '// changed');
  assert.notEqual((await fingerprintPerfApplication(checkout)).sha256, before.sha256);
  const linked = path.join(root, 'linked');
  try { await symlink(checkout, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; throw error; }
  await assert.rejects(resolvePerfApplication(harness, { appDir: linked }), /symlink or junction/);
  await symlink(module, path.join(checkout, 'app/linked.mjs')).catch(error => {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
  });
  // Directory junctions do not require Windows developer mode.
  await symlink(path.join(checkout, 'app/web'), path.join(checkout, 'app/linked-web'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(fingerprintPerfApplication(checkout), /symlink or junction/);
});

test('legacy archived server entries infer their complete app while wrappers retain the selected root', async t => {
  const { root, put } = await fixture(t);
  await put('app/server.mjs', '// current');
  const archive = path.join(root, '.local/archive');
  const entry = await put('.local/archive/app/server.mjs', '// archived server');
  const dependency = await put('.local/archive/app/tasks/worker.mjs', '// archived worker');
  const wrapper = await put('.local/archive/server-wrapper.mjs', '// wrapper');
  const selected = await resolvePerfApplication(root, { serverEntry: entry });
  assert.equal(selected.applicationRoot, archive);
  assert.equal(selected.serverEntry, entry);
  const before = await fingerprintPerfApplication(selected.applicationRoot, selected.serverEntry);
  assert.deepEqual(before.files.map(row => row.path), ['app/server.mjs', 'app/tasks/worker.mjs']);
  await writeFile(dependency, '// changed archived worker');
  assert.notEqual((await fingerprintPerfApplication(selected.applicationRoot, selected.serverEntry)).sha256, before.sha256);
  assert.equal((await resolvePerfApplication(root, { serverEntry: wrapper })).applicationRoot, root);
  assert.equal((await resolvePerfApplication(root, { appDir: root, serverEntry: entry })).applicationRoot, root);
  assert.equal((await resolvePerfApplication(root, { appDir: archive, serverEntry: wrapper })).applicationRoot, archive);
});

const page = await readFile(new URL('../scripts/perf/page-load.mjs', import.meta.url), 'utf8');
function parse(args) {
  const context = vm.createContext({ console: { log() {} }, path, args });
  vm.runInContext(page.slice(page.indexOf('const options ='), page.indexOf('\nfunction inside(')) + '\nparse(args); globalThis.result = options;', context);
  return context.result;
}
test('page options expose pack selection, external app, owned port and predictable JSON output', () => {
  const defaults = parse([]);
  assert.equal(defaults.port, undefined);
  assert.equal(defaults.packsDir, undefined);
  assert.equal(defaults.appDir, undefined);
  assert.equal(defaults.serverHeapMiB, undefined);
  const selected = parse(['--packs-dir', 'packs', '--pack-selection', 'selection.json', '--app-dir', 'checkout', '--port', '8963', '--output', '.local/perf/fixed.json']);
  assert.equal(selected.packsDir, path.resolve('packs'));
  assert.equal(selected.packSelection, path.resolve('selection.json'));
  assert.equal(selected.appDir, path.resolve('checkout'));
  assert.equal(selected.output, path.resolve('.local/perf/fixed.json'));
  assert.equal(selected.port, 8963);
  for (const value of ['0', '8788', '8959', '8970', '8960.5', 'NaN']) assert.throws(() => parse(['--port', value]), /8960 through 8969/);
  assert.equal(parse(['--server-heap-mib', '1536']).serverHeapMiB, 1536);
  for (const value of ['0', '511', '4097', '1.5', 'NaN']) assert.throws(() => parse(['--server-heap-mib', value]), /512 through 4096/);
});

test('Chrome discovery honors CHROME_PATH then checks conventional Linux executables', async () => {
  const start = page.indexOf('async function chromeExecutable()'), end = page.indexOf('\nasync function startServer(', start);
  const checks = [];
  const context = vm.createContext({ options: {}, process: { env: { CHROME_PATH: '/custom/chrome' } }, path,
    access: async candidate => { checks.push(candidate); if (candidate !== '/usr/bin/google-chrome') throw new Error('absent'); } });
  vm.runInContext(page.slice(start, end) + '\nglobalThis.discover = chromeExecutable;', context);
  assert.equal(await context.discover(), path.resolve('/usr/bin/google-chrome'));
  assert.deepEqual(checks, ['/custom/chrome', '/usr/bin/google-chrome']);
});

test('scratch server forwards only owned port/pack inputs and isolates timeline IPC from worker payloads', async () => {
  const filename = new URL('../scripts/perf/server.mjs', import.meta.url);
  const source = (await readFile(filename, 'utf8')).replace(/^import[^\n]*\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(filename.href)).replaceAll('import(', 'loadModule(');
  const launchSource = new Function('process', 'performance', 'pathToFileURL', 'fileURLToPath', 'path', 'loadModule', 'Worker', 'safeDiagnostic',
    'serverMemorySample', 'recordServerMemory', 'SERVER_MEMORY_SAMPLE_INTERVAL_MS', 'getHeapStatistics', 'installCalculatorHeapPolicy', 'setInterval', 'clearInterval', `return (async()=>{${source}})();`);
  const { safeDiagnostic, serverMemorySample, recordServerMemory, SERVER_MEMORY_SAMPLE_INTERVAL_MS } = await import('../scripts/perf/diagnostics.mjs');
  const policies = [];
  const launch = (...args) => launchSource(...args, safeDiagnostic, serverMemorySample, recordServerMemory, SERVER_MEMORY_SAMPLE_INTERVAL_MS,
    () => ({ heap_size_limit: 1610612736 }), (...values) => policies.push(values), () => ({ unref() {} }), () => {});
  const env = { RS3_PERF_SCRATCH: path.resolve('scratch'), RS3_PERF_APP_ROOT: path.resolve('external'),
    RS3_PERF_SERVER_ENTRY: path.resolve('external/custom-entry.mjs'), RS3_PERF_PORT: '8964',
    RS3_PACKS_DIR: path.resolve('packs'), RS3_PACK_SELECTION: path.resolve('packs/selection.json'), RS3_WORKER_MEMORY_PROBE_IMPORT: 'untrusted-ambient-preload', RS3_PERF_CALCULATOR_HEAP_MIB: '1536' };
  const messages = [], entries = [], handlers = {};
  let requested, exitCode;
  class ProcessWorker { emit() { return true; } on() { return this; } }
  class Worker { emit() { return true; } }
  const process = { env, send: value => messages.push(value), on: (event, handler) => { handlers[event] = handler; }, once() {}, exit: code => { exitCode = code; }, memoryUsage: () => ({ rss: 123 }) };
  const loadModule = async url => {
    entries.push(url);
    if (url.endsWith('process-worker.mjs')) return { ProcessWorker };
    if (url.endsWith('dataset-runtime.mjs')) return { selectedDataset: { datasetId: 'duo-legacy', digest: 'a'.repeat(64), packed: true } };
    return { createServer: async options => { requested = options; return {
      listen: async () => {}, close: async () => {}, address: () => ({ port: options.port }), inviteUrl: 'http://127.0.0.1:8964/join/synthetic-token',
    }; } };
  };
  await launch(process, performance, pathToFileURL, fileURLToPath, path, loadModule, Worker);
  assert.equal(exitCode, undefined);
  assert.deepEqual(policies, [[env.RS3_PERF_APP_ROOT, '1536']]);
  assert.equal(requested.host, '127.0.0.1');
  assert.equal(requested.port, 8964);
  assert.equal(requested.packsDir, env.RS3_PACKS_DIR);
  assert.equal(requested.packSelection, env.RS3_PACK_SELECTION);
  assert.equal(requested.publicOrigin, undefined);
  assert.equal(requested.loopbackPort, undefined);
  assert.ok(entries.includes(pathToFileURL(path.resolve('external/app/tasks/process-worker.mjs')).href));
  assert.ok(entries.includes(pathToFileURL(path.resolve('external/app/dataset-runtime.mjs')).href));
  assert.equal(env.RS3_WORKER_MEMORY_PROBE_IMPORT, new URL('../scripts/perf/worker-timeline.mjs', import.meta.url).href);
  assert.equal(messages.shift().type, 'memory');
  assert.deepEqual(messages[0].dataset, { datasetId: 'duo-legacy', digest: 'a'.repeat(64), packed: true });
  assert.equal(messages[0].memoryTelemetry.last.heapSizeLimitBytes, 1610612736);
  const timeline = { startedEpochMs: 10, doneEpochMs: 20, memberId: 'player1', revision: 1 };
  new ProcessWorker().emit('message', { perfTimeline: timeline, privatePayload: 'must-not-cross-IPC' });
  assert.deepEqual(messages[1], { type: 'calculation', perfTimeline: timeline });
  new Worker().emit('message', { perfTimeline: timeline, privatePayload: 'must-not-cross-IPC' });
  assert.deepEqual(messages[2], { type: 'calculation', perfTimeline: timeline });
  const calculator = new ProcessWorker(), unavailable = new ProcessWorker();
  calculator.getMemoryUsage = async () => ({ main: { rss: 500 }, workers: [{ memoryUsage: { rss: 500 } }] });
  unavailable.getMemoryUsage = async () => { throw new Error('retired'); };
  calculator.on('message', () => {}); unavailable.on('message', () => {});
  await handlers.message({ type: 'rss', id: 7 });
  const { memoryTelemetry, ...rssMessage } = messages[3];
  assert.deepEqual(rssMessage, { type: 'rss', id: 7, rssBytes: 123, workersRssBytes: null, totalRssBytes: null, workerRssSamples: 1, workerRssFailures: 1 });
  assert.equal(memoryTelemetry.last.rssBytes, 123);
  unavailable.emit('exit', 0);
  await handlers.message({ type: 'rss', id: 8 });
  assert.equal(messages[4].totalRssBytes, 623);
  assert.equal(messages[4].workersRssBytes, 500);
  calculator.emit('exit', 0);
  await handlers.message({ type: 'rss', id: 9 });
  assert.equal(messages[5].totalRssBytes, 123);
  assert.equal(messages[5].workerRssSamples, 0);
  messages.length = 0; entries.length = 0; env.RS3_PERF_PORT = '8788';
  await launch(process, performance, pathToFileURL, fileURLToPath, path, loadModule, Worker);
  assert.equal(exitCode, 1);
  assert.equal(entries.length, 0);
  assert.equal(messages.shift().type, 'memory');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'error');
  assert.equal(messages[0].message, 'Scratch server startup failed.');
  assert.equal(messages[0].diagnostic.stage, 'server-start');
  assert.equal(messages[0].diagnostic.errorClass, 'Error');
  assert.doesNotMatch(JSON.stringify(messages), /privatePayload|synthetic-token/);
});

test('parent server RSS remains numeric while exposing sampled process totals', async () => {
  const start = page.indexOf('async function startServer('), end = page.indexOf('\nasync function authenticate(', start);
  const child = new EventEmitter();
  child.send = request => queueMicrotask(() => child.emit('message', { type: 'rss', id: request.id, rssBytes: 123,
    workersRssBytes: 500, totalRssBytes: 623, workerRssSamples: 1, workerRssFailures: 0 }));
  let forkOptions;
  const { safeDiagnostic, safeStderrTail, sanitizeMemoryTelemetry, recordServerMemory, serverMemorySample, DIAGNOSTIC_PREFIX } = await import('../scripts/perf/diagnostics.mjs');
  const diagnostics = [];
  const context = vm.createContext({ path, performance, process: { env: { RS3_TASK_WORKER_MODE: 'process' }, execArgv: [] }, ROOT: path.resolve('harness'), setTimeout, clearTimeout, URL,
    safeDiagnostic, safeStderrTail, sanitizeMemoryTelemetry, DIAGNOSTIC_PREFIX, diagnosticContext: { stage: 'measure', scenario: 'unlock' }, console: { error: value => diagnostics.push(value) },
    options: { timeout: 1000, port: 8964, serverHeapMiB: 1536, applicationRoot: path.resolve('external') },
    fork: (script, args, config) => { forkOptions = config; queueMicrotask(() => child.emit('message', { type: 'ready', inviteUrl: 'http://127.0.0.1:8964/join/synthetic', readyMs: 5, rssBytes: 123 })); return child; },
    stopChild: async () => {}, sleep: async () => {} });
  vm.runInContext(page.slice(start, end).replaceAll('import.meta.url', JSON.stringify(new URL('../scripts/perf/page-load.mjs', import.meta.url).href)) + '\nglobalThis.start = startServer;', context);
  const server = await context.start(path.resolve('scratch'));
  assert.equal(server.latestMemory, null);
  assert.equal(await server.rss(), 123);
  assert.equal(server.latestMemory.totalRssBytes, 623);
  assert.equal(server.latestMemory.workersRssBytes, 500);
  assert.deepEqual(Array.from(forkOptions.execArgv), ['--max-old-space-size=1536', '--import', new URL('../scripts/perf/worker-timeline.mjs', import.meta.url).href]);
  assert.equal(forkOptions.env.RS3_TASK_WORKER_MODE, 'process');
  const memoryTelemetry = recordServerMemory(null, serverMemorySample({ rss: 400, heapUsed: 300 }, 1600, 100));
  child.emit('message', { type: 'memory', memoryTelemetry: { ...memoryTelemetry, secret: 'fixture-private' } });
  assert.equal(server.memoryTelemetry.last.heapUsedBytes, 300);
  child.exitCode = null; child.signalCode = 'SIGKILL'; child.emit('exit', null, 'SIGKILL');
  await assert.rejects(server.rss(), /Scratch server exited unexpectedly \(SIGKILL\)/);
  assert.match(diagnostics[0], /SIGKILL/);
  assert.equal(server.memoryTelemetry.peak.rssBytes, 400);
  assert.doesNotMatch(JSON.stringify(server.memoryTelemetry), /secret|fixture-private/);
});

test('interaction medians expand panels and render durations without assuming network records', () => {
  const start = page.indexOf('function median('), end = page.indexOf('\nasync function sourceProvenance(', start);
  const context = vm.createContext({ options: { scenarios: ['panels', 'search'] }, interactionScenarios, ASSET_CLASSES: [], taskMilestoneEvent: () => 'tasks-shown' });
  vm.runInContext(page.slice(start, end) + '\nglobalThis.aggregate = aggregates; globalThis.render = reportMarkdown;', context);
  const suites = [
    { server: {}, results: [{ name: 'chunk-info', durationMs: 10 }, { name: 'possible-tasks', durationMs: 20 }, { name: 'search', durationMs: 30 }] },
    { server: {}, results: [{ name: 'chunk-info', durationMs: 20 }, { name: 'possible-tasks', durationMs: 40 }, { name: 'search', durationMs: 60 }] },
  ];
  const medians = context.aggregate(suites);
  assert.deepEqual(Array.from(medians, row => [row.scenario, row.runs, row.durationMs]), [['chunk-info', 2, 15], ['possible-tasks', 2, 30], ['search', 2, 45]]);
  const rendered = context.render({ label: 'synthetic', capturedAt: 'fixture', environment: {}, options: {}, suites, medians, notes: [] });
  assert.match(rendered, /\| Interaction \| N \| Content painted ms \|/);
  assert.match(rendered, /\| search \| 2 \| 45 \|/);
  assert.match(rendered, /\| possible-tasks \| 2 \| 30 \|/);
});

test('medians expand note save/clear and the three personal filter rows', () => {
  const start = page.indexOf('function median('), end = page.indexOf('\nasync function sourceProvenance(', start);
  const context = vm.createContext({ options: { scenarios: ['note-save', 'personal-filter'] }, interactionScenarios, ASSET_CLASSES: [], taskMilestoneEvent: () => 'duo-tasks-shown' });
  vm.runInContext(page.slice(start, end) + '\nglobalThis.aggregate = aggregates; globalThis.render = reportMarkdown;', context);
  const groups = Object.fromEntries(['appCode', 'dataJson', 'api', 'mapTiles', 'otherAssets'].map(name => [name, {}]));
  const edit = (name, tasksPaintedMs) => ({ name, milestones: { tasksPaintedMs }, longTasks: {}, advisoryMaxMs: 0,
    network: { totals: {}, groups, assetClasses: {}, endpointTtfbMs: { state: [], definitions: [], rules: [], tasks: [], mapInfo: [], manifest: [], pins: [] } } });
  const suites = [{ server: {}, results: [edit('note-save', 700), edit('note-clear', 650),
    { name: 'personal-filter-not-done', durationMs: 900 }, { name: 'personal-filter-only-player', durationMs: 300 }, { name: 'personal-filter-group', durationMs: null }] }];
  const medians = context.aggregate(suites);
  assert.deepEqual(Array.from(medians, row => row.scenario), ['note-save', 'note-clear', 'personal-filter-not-done', 'personal-filter-only-player', 'personal-filter-group']);
  assert.equal(medians[0].milestones.tasksPaintedMs, 700);
  assert.equal(medians[1].milestones.tasksPaintedMs, 650);
  assert.deepEqual(Array.from(medians.slice(2), row => row.durationMs), [900, 300, null]);
  const rendered = context.render({ label: 'synthetic', capturedAt: 'fixture', environment: {}, options: {}, suites, medians, notes: [] });
  assert.match(rendered, /\| personal-filter-group \| 1 \| — \|/);
  assert.match(rendered, /\| note-clear \| 1 \|/);
});

test('all calculation harnesses use provider inputs and pass a pinned pack selection to workers', async () => {
  for (const name of ['unlock-calc', 'unlock-paired', 'unlock-equivalence']) {
    const source = await readFile(new URL(`../scripts/perf/${name}.mjs`, import.meta.url), 'utf8');
    assert.match(source, /await loadPerfInputs\(/, name);
    assert.match(source, /taskMap, taskMapHistory/, name);
    assert.match(source, /preparedDatasetStages/, name);
    if (name !== 'unlock-paired') assert.match(source, /datasetSelection: (?:selectedDataset|dataset).workerSelection\(\)/, name);
  }
});
