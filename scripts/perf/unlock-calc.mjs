import { selectedDataset } from '../../app/dataset-runtime.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, lstat, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readCopiedState } from '../research/local-parity-model.mjs';
import { applyCommand } from '../../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool } from '../../app/core/rules.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { applyEquipmentCorrections } from '../../app/data/equipment-corrections.mjs';
import { applyCacheShops, cacheShopContentsEnabled } from '../../app/data/cache-shops.mjs';
import { cacheResourceContentsEnabled } from '../../app/data/cache-resources.mjs';
import { cacheArchaeologyContentsEnabled } from '../../app/data/cache-archaeology.mjs';
import { projectPlayResult } from '../../app/play-view.mjs';
import { projectDuoPlayResult, projectDuoSidebarResult } from '../../app/duo-play-view.mjs';
import { taskReuseInputKey } from '../../app/tasks/unlock-reuse.mjs';
import { createGameplayFingerprint } from '../../app/storage/gameplay-fingerprint.mjs';
import { hasGameplayMigration, hasCurrentProgressAliasMigration, migrateOwnedGameplay, resolveSavedTaskId } from '../../app/tasks/migration.mjs';
import { deserialize } from 'node:v8';

// One native worker; no HTTP server, scheduler, browser or writable save store.
// Scratch instrumentation uses original module URLs for every dependency.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const overlap = (a, b) => a === b || inside(a, b) || inside(b, a);
const relative = filename => path.relative(ROOT, filename).replaceAll('\\', '/');
const normalized = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
const valueHash = value => sha(JSON.stringify(normalized(value)));
const shared = bytes => { const value = new SharedArrayBuffer(bytes.length); Buffer.from(value).set(bytes); return value; };
const parseShared = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const numberSort = (a, b) => Number(a) - Number(b) || a.localeCompare(b);
const ms = operation => { const start = performance.now(); const value = operation(); return { value, ms: performance.now() - start }; };

function options() {
  const args = process.argv.slice(2), result = { chunks: 8, profile: 0, output: '.local/perf/unlock-calc.json', appDir: 'app', caseStart: 0, caseLimit: null, heapSamples: 'off' };
  if (args.includes('--help')) return { help: true };
  const names = new Map([['--source', 'source'], ['--output', 'output'], ['--chunks-per-member', 'chunks'], ['--profile-unlocks', 'profile'], ['--app-dir', 'appDir'], ['--case-start', 'caseStart'], ['--case-limit', 'caseLimit'], ['--heap-samples', 'heapSamples']]);
  for (let index = 0; index < args.length; index += 2) {
    const key = names.get(args[index]);
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option ${args[index]}`);
    result[key] = ['chunks', 'profile', 'caseStart', 'caseLimit'].includes(key) ? Number(args[index + 1]) : args[index + 1];
  }
  if (!result.source) throw new Error('An explicit frozen copied --source is required.');
  if (!Number.isSafeInteger(result.profile) || result.profile < 0 || result.profile > 3) throw new Error('--profile-unlocks must be 0, 1, 2 or 3.');
  if (!Number.isSafeInteger(result.chunks) || !(result.chunks >= 8 || result.chunks === 3 && result.profile > 0)) throw new Error('--chunks-per-member must be at least 8; 3 is allowed only for a CPU diagnostic with --profile-unlocks.');
  if (!Number.isSafeInteger(result.caseStart) || result.caseStart < 0) throw new Error('--case-start must be a nonnegative integer.');
  if (result.caseLimit !== null && (!Number.isSafeInteger(result.caseLimit) || result.caseLimit < 1)) throw new Error('--case-limit must be a positive integer.');
  if (!['on', 'off'].includes(result.heapSamples)) throw new Error('--heap-samples must be on or off.');
  result.diagnosticOnly = result.chunks < 8;
  return result;
}

async function rejectLinks(filename, base) {
  const resolved = path.resolve(filename);
  if (resolved !== base && !inside(base, resolved)) throw new Error('Path escapes the authorized worktree.');
  let current = base;
  for (const part of path.relative(base, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlinks/junctions are forbidden: ${relative(current)}`); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}

async function paths(configuration) {
  const local = await realpath(path.join(ROOT, '.local'));
  await rejectLinks(local, ROOT);
  const requestedSource = path.resolve(ROOT, configuration.source), output = path.resolve(ROOT, configuration.output);
  await rejectLinks(requestedSource, local); await rejectLinks(output, local);
  const source = await realpath(requestedSource), forbidden = path.join(local, 'duo'), perf = path.join(local, 'perf');
  if (!inside(local, source) || overlap(source, forbidden)) throw new Error('Source must be a copied save inside this worktree .local, outside .local/duo.');
  if (!inside(perf, output) || overlap(source, output) || overlap(source, perf) || overlap(output, forbidden)) throw new Error('Output/scratch must stay in .local/perf and cannot overlap the source or .local/duo.');
  const requestedApp = path.resolve(ROOT, configuration.appDir);
  await rejectLinks(requestedApp, ROOT);
  const appDir = await realpath(requestedApp);
  if (!inside(ROOT, appDir) || !(await lstat(appDir)).isDirectory() || overlap(appDir, source) || overlap(appDir, perf) || overlap(appDir, forbidden)) {
    throw new Error('App directory must stay inside the worktree, without links or overlap with copied saves, .local/duo or .local/perf output/scratch.');
  }
  await mkdir(path.dirname(output), { recursive: true });
  const outputParent = await realpath(path.dirname(output));
  if (outputParent !== perf && !inside(perf, outputParent) || overlap(source, outputParent)) throw new Error('Report directory escaped the authorized area.');
  try { if (!(await lstat(output)).isFile()) throw new Error('Output must be a regular file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(perf, { recursive: true });
  const scratch = await mkdtemp(path.join(perf, 'unlock-calc-scratch-'));
  await rejectLinks(scratch, local);
  if (!inside(perf, await realpath(scratch)) || overlap(source, scratch)) throw new Error('Unsafe scratch directory.');
  return { local, source, output, scratch, perf, appDir };
}

async function inputFingerprint(directory) {
  await rejectLinks(path.join(directory, 'state.json'), directory);
  const stateBytes = await readFile(path.join(directory, 'state.json')), document = JSON.parse(stateBytes), dependencies = [];
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference?.id ?? '')) throw new Error('Invalid copied static dependency.');
    const filename = path.join(directory, 'static', reference.id);
    await rejectLinks(filename, directory);
    if (!inside(directory, await realpath(filename))) throw new Error('Static dependency escaped copied source.');
    dependencies.push({ field: key, file: reference.id, sha256: sha(await readFile(filename)) });
  }
  return { stateSha256: sha(stateBytes), dependencySha256: sha(JSON.stringify(dependencies)), dependencies };
}

async function appFingerprint(appDir) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Application fingerprint cannot follow links.');
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push({ file: `app/${path.relative(appDir, filename).replaceAll('\\', '/')}`, sha256: sha(await readFile(filename)) });
    }
  }
  await visit(appDir);
  for (const name of ['rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json']) files.push({ file: name, sha256: sha(await readFile(path.join(ROOT, name))) });
  return { sha256: sha(JSON.stringify(files)), files };
}

const runtime = String.raw`
import { Session } from 'node:inspector';
import { writeFile } from 'node:fs/promises';
import { workerData } from 'node:worker_threads';
let current, startup = { timings: {}, counts: {}, engine: [], steps: [], fixedPointPasses: [], heapBoundaryMax: {} }, session;
export function begin() { current = { timings: {}, counts: {}, engine: [], steps: [], fixedPointPasses: [], heapBoundaryMax: {} }; heap('requestStart'); }
const context = () => current ?? startup;
function heap(name) {
  if (workerData?.probeHeap !== true) return;
  const values = process.memoryUsage(), target = context().heapBoundaryMax[name] ??= { samples: 0 };
  target.samples++;
  for (const key of ['heapUsed', 'heapTotal', 'external', 'arrayBuffers']) target[key + 'Bytes'] = Math.max(target[key + 'Bytes'] ?? 0, values[key]);
}
export function sampleHeap(name) { heap(name); }
export function measured(name, operation) {
  heap(name);
  const started = performance.now();
  try { return operation(); }
  finally { const target = context(); target.timings[name] = (target.timings[name] ?? 0) + performance.now() - started; target.counts[name] = (target.counts[name] ?? 0) + 1; heap(name); }
}
export function addDuration(name, started) {
  const target = context(); target.timings[name] = (target.timings[name] ?? 0) + performance.now() - started;
  target.counts[name] = (target.counts[name] ?? 0) + 1;
  heap(name);
}
export function step(iterator, input) {
  heap('fixedPointStep');
  const started = performance.now(), value = iterator.next(input).value;
  context().steps.push({ ms: performance.now() - started, final: !!value?.tasks,
    tasks: value?.tasks?.length ?? null, eligibleRecipes: value?.eligibleTaskIds?.length ?? null,
    multiRecipes: value?.multiTaskIds?.length ?? null });
  heap('fixedPointStep');
  return value;
}
export function fixedPointPass(started, beforeChecks, beforeDependencies, counters, blockedCheckCount, projectOnly, changed, validSize) {
  const target = context(), duration = performance.now() - started;
  target.timings.fixedPointPassMs = (target.timings.fixedPointPassMs ?? 0) + duration;
  target.counts.fixedPointPassMs = (target.counts.fixedPointPassMs ?? 0) + 1;
  target.fixedPointPasses.push({ ms: duration, pass: counters.passes, projectOnly, changed, validTasks: validSize,
    checksDelta: counters.checks - beforeChecks, taskChecksDelta: counters.checks - beforeChecks - blockedCheckCount,
    staticBlockedChecksAccounted: blockedCheckCount, dependencyChecksDelta: counters.dependencyChecks - beforeDependencies });
  heap('fixedPointPassMs');
}
export function engineEvaluation(operation) {
  heap('engine');
  const started = performance.now(), value = operation();
  context().engine.push({ ms: performance.now() - started,
    metrics: Object.fromEntries(Object.getOwnPropertyNames(value.metrics ?? {}).map(key => [key, value.metrics[key]])),
    tasks: value.tasks?.length, items: value.items?.length, diagnostics: value.diagnostics?.length,
    sourceRows: value.items?.reduce((sum, row) => sum + (row.sources?.length ?? 0), 0) });
  heap('engine');
  return value;
}
export const snapshot = () => { heap('requestEnd'); return structuredClone(context()); };
export const startupSnapshot = () => { heap('startupEnd'); return structuredClone(startup); };
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));
export async function startProfile(filename) {
  if (!filename) return;
  if (session) throw new Error('Profiler already running');
  session = new Session();
  try {
    session.connect();
    await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start');
  } catch (error) { session.disconnect(); session = undefined; throw error; }
}
export async function stopProfile(filename) {
  if (!filename || !session) return;
  try {
    const { profile } = await post('Profiler.stop');
    await writeFile(filename, JSON.stringify(profile) + '\n');
  } finally { session.disconnect(); session = undefined; }
}
`;

function replaceOnce(source, anchor, replacement, label, anchors) {
  const count = source.split(anchor).length - 1;
  assert.equal(count, 1, `Instrumentation anchor ${label} must match once (found ${count})`);
  anchors.push(label);
  return source.replace(anchor, replacement);
}

function absoluteImports(source, original, overrides = new Map()) {
  return source.replace(/\bfrom (['"])(\.[^'"\r\n]+)\1/g, (match, quote, specifier) => {
    const url = overrides.get(specifier) ?? pathToFileURL(path.resolve(path.dirname(original), specifier)).href;
    return `from ${quote}${url}${quote}`;
  });
}

async function instrument(scratch, appDir) {
  const workerFile = path.join(appDir, 'tasks/worker.mjs'), engineFile = path.join(appDir, 'tasks/engine.mjs');
  const workerOriginal = (await readFile(workerFile, 'utf8')).replaceAll('\r\n', '\n');
  const engineOriginal = (await readFile(engineFile, 'utf8')).replaceAll('\r\n', '\n');
  const runtimeURL = pathToFileURL(path.join(scratch, 'probe-runtime.mjs')).href, engineURL = pathToFileURL(path.join(scratch, 'engine.mjs')).href;
  const anchors = [], replace = (source, anchor, replacement, label) => replaceOnce(source, anchor, replacement, label, anchors);
  let engine = engineOriginal;
  // Alias whole imported functions, preserving arguments and return identity.
  engine = replace(engine, 'buildAccessIndex, calculateAccess, collectBaseItemSources,', 'buildAccessIndex as rawBuildAccessIndex, calculateAccess as rawCalculateAccess, collectBaseItemSources as rawCollectBaseItemSources,', 'access imports');
  engine = replace(engine, 'isProcessingSourceTask, processingSkills, selectProcessingSources }', 'isProcessingSourceTask, processingSkills, selectProcessingSources as rawSelectProcessingSources }', 'processing import');
  // Newer engines pick the variant per member (personal rules); archived ones per group rules.
  const evaluation = engine.includes('return variantForMember(state, memberId).evaluate(')
    ? 'variantForMember(state, memberId).evaluate(state, memberId, evaluateOptions)' : 'variantForRules(state.rules).evaluate(state, memberId, evaluateOptions)';
  engine = replace(engine, `return ${evaluation};`, `return engineEvaluation(() => ${evaluation});`, 'engine evaluation');
  // Match complete indentation so every resume anchor is independently unique.
  for (const [index, [anchor, replacement]] of [
    ['\n    let processing = evaluation.next().value;', '\n    let processing = step(evaluation);'],
    ['\n      processing = evaluation.next().value;', '\n      processing = step(evaluation);'],
    ['\n        result = evaluation.next().value;', '\n        result = step(evaluation);'],
    ['\n        result = finalEvaluation.next().value;', '\n        result = step(finalEvaluation);'],
    ['\n        processing = evaluation.next({ admitted }).value;', '\n        processing = step(evaluation, { admitted });'],
    ['\n        processing = evaluation.next().value;', '\n        processing = step(evaluation);'],
    ['\n    result = finalEvaluation.next().value;', '\n    result = step(finalEvaluation);'],
  ].entries()) engine = replace(engine, anchor, replacement, `fixed-point resume ${index + 1}`);
  // Anchor on the pass counter alone: newer engines put a proof-budget check between the loop header and it.
  engine = replace(engine, '\n        counters.passes++; changed = false;',
    '\n        const passStarted = performance.now(), beforeChecks = counters.checks, beforeDependencies = counters.dependencyChecks;\n        counters.passes++; changed = false;', 'inner fixed-point pass start');
  engine = replace(engine, '        if (discoveryExpanded) { changed = true; discoveryExpanded = false; }\n      }\n      updatePoints();',
    '        if (discoveryExpanded) { changed = true; discoveryExpanded = false; }\n        fixedPointPass(passStarted, beforeChecks, beforeDependencies, counters, blockedCheckCount, projectOnly, changed, valid.size);\n      }\n      updatePoints();', 'inner fixed-point pass end');
  engine = replace(engine, '    const rows = compiled.map(task => {\n      const blockers', '    const provenanceStarted = performance.now();\n    const rows = compiled.map(task => {\n      const blockers', 'provenance start');
  engine = replace(engine, '    const equipment = [];\n    const houseStorage', '    addDuration("taskProvenanceMs", provenanceStarted);\n    const equipment = [];\n    const houseStorage', 'provenance end');
  engine = replace(engine, '    const diagnostics = [...compileDiagnostics,', '    const diagnosticsStarted = performance.now();\n    const diagnostics = [...compileDiagnostics,', 'diagnostics start');
  engine = replace(engine, '    const ownItemOrigins = ownItemQueries.filter', '    addDuration("diagnosticsMs", diagnosticsStarted);\n    const ownItemOrigins = ownItemQueries.filter', 'diagnostics end');
  engine = absoluteImports(engine, engineFile);
  engine = `import { measured, addDuration, step, engineEvaluation, fixedPointPass } from ${JSON.stringify(runtimeURL)};\n`
    + engine + '\nfunction buildAccessIndex(...args) { return measured("accessCompileMs", () => rawBuildAccessIndex(...args)); }\n'
    + 'function calculateAccess(...args) { return measured("accessEvaluateMs", () => rawCalculateAccess(...args)); }\n'
    + 'function collectBaseItemSources(...args) { return measured("baseSourcesMs", () => rawCollectBaseItemSources(...args)); }\n'
    + 'function selectProcessingSources(...args) { return measured("processingSelectionMs", () => rawSelectProcessingSources(...args)); }\n';
  let worker = workerOriginal;
  worker = replace(worker, 'function timed(timingMs, stage, operation) {\n  const started = performance.now();',
    'function timed(timingMs, stage, operation) {\n  sampleHeap(stage);\n  const started = performance.now();', 'worker stage heap start');
  // Match the timing assignment independently of the finally block layout so
  // heartbeat reporting and archived compact workers share the same boundary.
  worker = replace(worker, 'if (timingMs) timingMs[stage] = (timingMs[stage] ?? 0) + performance.now() - started;',
    'if (timingMs) timingMs[stage] = (timingMs[stage] ?? 0) + performance.now() - started; sampleHeap(stage);', 'worker stage heap end');
  worker = replace(worker, '{ configureAutomaticTransport }', '{ configureAutomaticTransport, registerAutomaticTransportEngineFactory }', 'automatic factory import');
  // Preserve the complete initializer in tracked and pre-provider archived sources.
  worker = replace(worker, 'const engineOptions = ',
    'registerAutomaticTransportEngineFactory(createTaskEngine);\nconst engineOptions = ', 'instrumented automatic factory');
  worker = replace(worker, 'projectPlayResult, projectPlayTask }', 'projectPlayResult as rawProjectPlayResult, projectPlayTask }', 'play projection import');
  const peerProjection = worker.includes('projectDuoPlayResult, projectDuoSidebarResult }') ? 'active' : 'sidebar';
  worker = peerProjection === 'active'
    ? replace(worker, 'projectDuoPlayResult, projectDuoSidebarResult }', 'projectDuoPlayResult as rawProjectDuoPlayResult, projectDuoSidebarResult as rawProjectDuoSidebarResult }', 'duo projection import')
    : replace(worker, 'projectDuoSidebarResult }', 'projectDuoSidebarResult as rawProjectDuoSidebarResult }', 'duo projection import');
  worker = replace(worker, "JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(workerData.definitionBytes))", "measured('definitionDecodeParseMs', () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(workerData.definitionBytes)))", 'definition decode');
  worker = replace(worker, "state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateJSON));", "state = measured('stateDecodeParseMs', () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateJSON)));", 'state decode');
  worker = replace(worker, 'function sharedJSON(value) {\n  const bytes = Buffer.from(JSON.stringify(value));', 'function sharedJSON(value) {\n  return measured("sharedJSONMs", () => {\n  const bytes = measured("stringifyMs", () => Buffer.from(JSON.stringify(value)));', 'shared JSON start');
  worker = replace(worker, '  Buffer.from(shared).set(bytes);\n  return shared;\n}\n', '  Buffer.from(shared).set(bytes);\n  return shared;\n  });\n}\n', 'shared JSON end');
  // Current workers send the generated catalogue as bytes from a deferred block;
  // earlier workers defer an inline message, and archived workers compute the
  // duration inline. Add the probe without changing any order.
  worker = worker.includes('dynamicCatalogueBytes, compileMs });')
    ? replace(worker, 'dynamicCatalogueBytes, compileMs });', 'dynamicCatalogueBytes, compileMs, probe: startupSnapshot() });', 'startup timing')
    : worker.includes('compileMs }));')
    ? replace(worker, 'compileMs }));', 'compileMs, probe: startupSnapshot() }));', 'startup timing')
    : replace(worker, "compileMs: performance.now() - compileStarted });", "compileMs: performance.now() - compileStarted, probe: startupSnapshot() });", 'startup timing');
  worker = replace(worker, 'stateTransport, stateJSON, stateJSONBytes, stateRevision, stateMemberIds, duoProjection = false, duoSidebarProjection = false', 'stateTransport, stateJSON, stateJSONBytes, stateRevision, stateMemberIds, duoProjection = false, duoSidebarProjection = false, probeFresh = false, probeProfile', 'request flags');
  worker = replace(worker, '  const started = performance.now();\n  // Fixed stage names', '  begin();\n  if (probeFresh) { snapshots.clear(); stateSnapshots.clear(); sandboxSnapshots.clear(); }\n  const started = performance.now();\n  // Fixed stage names', 'request begin');
  worker = replace(worker, '  requests.set(id, request);\n  try {', '  requests.set(id, request);\n  try {\n    await startProfile(probeProfile);', 'profile start');
  worker = replace(worker, '    parentPort.postMessage({ id, ...payload,', '    await stopProfile(probeProfile);\n    parentPort.postMessage({ id, probe: snapshot(), ...payload,', 'profile stop and report');
  worker = replace(worker, '  } catch (error) {\n    timingMs.totalMs', '  } catch (error) {\n    await stopProfile(probeProfile);\n    timingMs.totalMs', 'profile error cleanup');
  worker = absoluteImports(worker, workerFile, new Map([['./engine.mjs', engineURL]]));
  worker = `import { measured, begin, snapshot, startupSnapshot, startProfile, stopProfile, sampleHeap } from ${JSON.stringify(runtimeURL)};\n`
    + 'function projectPlayResult(...args) { return measured("playProjectionMs", () => rawProjectPlayResult(...args)); }\n'
    + (peerProjection === 'active' ? 'function projectDuoPlayResult(...args) { return measured("duoProjectionMs", () => rawProjectDuoPlayResult(...args)); }\n' : '')
    + 'function projectDuoSidebarResult(...args) { return measured("sidebarProjectionMs", () => rawProjectDuoSidebarResult(...args)); }\n' + worker;
  await writeFile(path.join(scratch, 'probe-runtime.mjs'), runtime);
  await writeFile(path.join(scratch, 'engine.mjs'), engine);
  await writeFile(path.join(scratch, 'worker.mjs'), worker);
  return { workerFile: path.join(scratch, 'worker.mjs'), peerProjection, anchors, workerSha256: sha(worker), engineSha256: sha(engine), runtimeSha256: sha(runtime) };
}

async function startWorker(filename, definitionBytes, world, heapSamples = false) {
  const spawned = performance.now(), worker = new Worker(pathToFileURL(filename), { workerData: {
    definitionBytes: shared(definitionBytes), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [], probeHeap: heapSamples,
  } });
  let sequence = 0, stopping = false, resolveReady, rejectReady;
  const pending = new Map(), ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const startupTimer = setTimeout(() => rejectReady(new Error('Worker startup exceeded 120 seconds')), 120000);
  const fail = error => { clearTimeout(startupTimer); rejectReady(error); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  worker.on('error', fail); worker.on('exit', code => { if (!stopping) fail(new Error(`Worker exited (${code})`)); });
  worker.on('message', message => {
    if (message.type === 'ready') { clearTimeout(startupTimer); resolveReady(message.dynamicCatalogueBytes === undefined ? message : { ...message, dynamicCatalogue: deserialize(message.dynamicCatalogueBytes) }); return; }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`Worker ${message.error.name}: ${message.error.message}`));
    else entry.resolve({ message, roundTripMs: performance.now() - entry.started });
  });
  const close = async () => { stopping = true; fail(new Error('Worker stopped')); await worker.terminate(); };
  try {
    const initial = await ready;
    return { ready: initial, startupMs: performance.now() - spawned, close, send(request) {
      return new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Worker request exceeded 120 seconds')); }, 120000);
        pending.set(id, { resolve, reject, timer, started: performance.now() });
        try { worker.postMessage({ id, ...request }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    } };
  } catch (error) { await close(); throw error; }
}

function currentMigration(state, ready) {
  const registered = new Set(state.tasks.map(task => task.id));
  return ready.catalogue.every(row => registered.has(row.id)) && state.identityRegistry?.schemaVersion === 1 && hasCurrentProgressAliasMigration(state)
    && state.members.every(member => member.sourceMapId == null || state.legacy?.gameplayMigration?.schemaVersion >= 2 && hasGameplayMigration(state, member))
    && state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
      && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)));
}

function chunksFor(state, member, world, registry, count) {
  const locked = id => /^[1-9]\d*$/.test(id) && world.chunks.has(id) && world.surface.has(id) && !member.unlocked.includes(id);
  const pool = evaluateRollPool(world, state, member.id, registry).eligible.map(row => row.id).filter(locked).sort(numberSort);
  const adjacent = [...new Set(member.unlocked.flatMap(id => world.neighbors.get(id) ?? []))].filter(locked).sort(numberSort);
  const selected = [...new Set([...member.pendingRoll, ...member.selected])].filter(locked).sort(numberSort);
  // Alternate eligible and geometric-frontier choices, reserving diversity.
  const outsidePool = adjacent.filter(id => !pool.includes(id));
  // Reserve three ordinary pool choices and three arbitrary adjacent choices
  // when available, then add the reviewed choices and remaining frontier.
  const ordered = [...pool.slice(0, count >= 8 ? 3 : 1), ...outsidePool.slice(0, count >= 8 ? 3 : 1), ...selected.slice(0, 2)];
  for (let index = 0; index < Math.max(pool.length, adjacent.length); index++) {
    if (pool[index]) ordered.push(pool[index]); if (adjacent[index]) ordered.push(adjacent[index]);
  }
  const candidates = [...new Set(ordered)].slice(0, count);
  if (candidates.length < count) throw new Error(`Only ${candidates.length} deterministic locked chunks for member ${member.id}; ${count} required.`);
  return candidates.map(id => ({ id, pool: pool.includes(id), adjacent: adjacent.includes(id), selected: selected.includes(id) }));
}

function selectCases(candidates, start, limit) {
  const plan = candidates.flatMap(candidate => candidate.chunks.map(chunk => ({ memberId: candidate.memberId, chunk })))
    .map((entry, caseIndex) => ({ ...entry, caseIndex }));
  if (start >= plan.length) throw new Error('--case-start is outside the deterministic scenario plan.');
  return { total: plan.length, cases: plan.slice(start, limit === null ? undefined : start + limit) };
}

function resultSummary(result) {
  const taskHashes = new Map(result.tasks.map(task => [task.id, valueHash(task)]));
  return { fullSha256: valueHash(result), taskHashes,
    counts: { tasks: result.tasks.length, available: result.tasks.filter(task => task.status === 'available' && task.obligation !== false).length,
      presented: result.presentation?.tasks?.length ?? 0, diagnostics: result.diagnostics?.length ?? 0 },
    fieldHashes: Object.fromEntries(['access', 'obligationAccess', 'partnerConnections', 'items', 'training', 'presentation', 'currentBiS', 'activityInfo', 'diagnostics'].map(key => [key, valueHash(result[key] ?? null)])) };
}

function taskDelta(before, after) {
  return { added: [...after.taskHashes.keys()].filter(id => !before.taskHashes.has(id)).length,
    removed: [...before.taskHashes.keys()].filter(id => !after.taskHashes.has(id)).length,
    changed: [...after.taskHashes].filter(([id, hash]) => before.taskHashes.has(id) && before.taskHashes.get(id) !== hash).length,
    changedFields: Object.keys(after.fieldHashes).filter(key => before.fieldHashes[key] !== after.fieldHashes[key]) };
}

async function request(worker, state, memberId, input, view, { selected = true, profile } = {}) {
  const started = performance.now(), stringify = ms(() => Buffer.from(JSON.stringify(state))), copy = ms(() => shared(stringify.value));
  const { message, roundTripMs } = await worker.send({ type: 'evaluate', memberId, input, resultView: view, resultTransport: 'json-shared-v1',
    stateTransport: 'json-shared-v1', stateJSON: copy.value, stateJSONBytes: copy.value.byteLength,
    stateRevision: state.revision, stateMemberIds: state.members.map(member => member.id), snapshotKey: JSON.stringify([state.revision, input]),
    duoProjection: !selected && view === 'play-v1', duoSidebarProjection: selected && view === 'play-v1', probeFresh: true, probeProfile: profile });
  const responseAssembly = ms(() => {
    const bytes = Buffer.from(view === 'full' ? message.resultJSON : selected ? message.duoSidebarJSON : message.duoJSON);
    const suffix = JSON.stringify({ stateRevision: state.revision, memberId, cache: { hit: false, evaluationMs: message.evaluationMs, timingMs: message.timingMs, worker: true } });
    return Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(`,${suffix.slice(1)}`)]);
  });
  const resultParse = ms(() => JSON.parse(responseAssembly.value.toString('utf8')));
  const calculationTransportMs = performance.now() - started - resultParse.ms;
  const { stateRevision: responseRevision, memberId: responseMember, cache: responseCache, ...wireProjection } = resultParse.value;
  // Personal play parsing supports equality only; it is outside response timing.
  const result = view === 'full' ? wireProjection : parseShared(message.playJSON);
  return { result, wireProjection, message, timing: { stateSerializationMs: stringify.ms + copy.ms,
    stateStringifyColdUpperBoundMs: stringify.ms, sharedStateCopyMs: copy.ms, roundTripMs,
    transferDispatchResidualMs: Math.max(0, roundTripMs - message.evaluationMs),
    responseAssemblyMs: responseAssembly.ms, compactCalculationTransportMs: calculationTransportMs,
    resultDecodeParseMs: resultParse.ms, evaluationMs: message.evaluationMs, stages: message.timingMs,
    instrumentation: message.probe, stateBytes: copy.value.byteLength, responseBytes: responseAssembly.value.length,
    rssBytes: process.memoryUsage.rss() } };
}

function quantiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = (sorted.length - 1) / 2;
  return { samples: sorted.length, median: (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2,
    p90: sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)], min: sorted[0], max: sorted.at(-1) };
}

function aggregate(scenarios) {
  const owners = [...new Set(scenarios.map(row => row.memberId))];
  const summaries = [];
  for (const memberId of [null, ...owners]) for (const lane of ['selected', 'partner']) for (const view of ['compact', 'full']) {
    const samples = scenarios.filter(row => memberId === null || row.memberId === memberId).flatMap(row => row.results.filter(value => value.lane === lane).map(value => value[view]));
    const stages = [...new Set(samples.flatMap(row => Object.keys(row.stages)))];
    const instrumentStages = [...new Set(samples.flatMap(row => Object.keys(row.instrumentation.timings)))];
    const heapStages = [...new Set(samples.flatMap(row => Object.keys(row.instrumentation.heapBoundaryMax ?? {})))];
    summaries.push({ memberId, lane, view, roundTripMs: quantiles(samples.map(row => row.roundTripMs)), evaluationMs: quantiles(samples.map(row => row.evaluationMs)),
      calculationTransportMs: quantiles(samples.map(row => row.compactCalculationTransportMs)),
      stateStringifyColdUpperBoundMs: quantiles(samples.map(row => row.stateStringifyColdUpperBoundMs)),
      sharedStateCopyMs: quantiles(samples.map(row => row.sharedStateCopyMs)), transferDispatchResidualMs: quantiles(samples.map(row => row.transferDispatchResidualMs)),
      responseAssemblyMs: quantiles(samples.map(row => row.responseAssemblyMs)), resultDecodeParseMs: quantiles(samples.map(row => row.resultDecodeParseMs)),
      stateBytes: quantiles(samples.map(row => row.stateBytes)), responseBytes: quantiles(samples.map(row => row.responseBytes)),
      fixedPoint: { passesPerRequest: quantiles(samples.map(row => row.instrumentation.fixedPointPasses.length)),
        taskChecksPerRequest: quantiles(samples.map(row => row.instrumentation.fixedPointPasses.reduce((sum, pass) => sum + pass.taskChecksDelta, 0))),
        dependencyChecksPerRequest: quantiles(samples.map(row => row.instrumentation.fixedPointPasses.reduce((sum, pass) => sum + pass.dependencyChecksDelta, 0))),
        taskCheckCallsPerPass: quantiles(samples.flatMap(row => row.instrumentation.fixedPointPasses.map(pass => pass.taskChecksDelta))),
        dependencyChecksAccountedPerPass: quantiles(samples.flatMap(row => row.instrumentation.fixedPointPasses.map(pass => pass.dependencyChecksDelta))),
        passMs: quantiles(samples.flatMap(row => row.instrumentation.fixedPointPasses.map(pass => pass.ms))) },
      stages: Object.fromEntries(stages.map(key => [key, quantiles(samples.map(row => row.stages[key] ?? 0))])),
      instrumentation: Object.fromEntries(instrumentStages.map(key => [key, quantiles(samples.map(row => row.instrumentation.timings[key] ?? 0))])),
      heapBoundaryMax: Object.fromEntries(heapStages.map(stage => {
        const boundaries = samples.map(row => row.instrumentation.heapBoundaryMax?.[stage]).filter(Boolean);
        return [stage, { samples: boundaries.reduce((sum, row) => sum + row.samples, 0),
          ...Object.fromEntries(['heapUsedBytes', 'heapTotalBytes', 'externalBytes', 'arrayBuffersBytes'].map(key => [key, Math.max(...boundaries.map(row => row[key]))])) }];
      })) });
  }
  return summaries;
}

async function main() {
  const configuration = options();
  if (configuration.help) { console.log('node scripts/perf/unlock-calc.mjs --source .local/speed-save --chunks-per-member 8 --output .local/perf/unlock-calc.json [--profile-unlocks 3] [--app-dir app] [--case-start 0 --case-limit 4] [--heap-samples on]\nOne instrumented worker, independent in-memory unlocks and sequential partner calculations. Cases index the complete deterministic owner/chunk plan before slicing, for sequential old/new batches. App-dir selects worker/engine and their original dependencies; state/world/projections still use the current root app. Heap diagnostics sample worker stage boundaries, not true high-water marks, and default off. Profiling is a separate diagnostic. No writable store or server.'); return; }
  const locations = await paths(configuration);
  let worker, copiedBefore, appBefore, rssTimer, peakRSS = process.memoryUsage.rss();
  try {
    copiedBefore = await inputFingerprint(locations.source); appBefore = await appFingerprint(locations.appDir);
    rssTimer = setInterval(() => { peakRSS = Math.max(peakRSS, process.memoryUsage.rss()); }, 50); rssTimer.unref();
    const report = { format: 'unlock-calculation-profile-v1', createdAt: new Date().toISOString(), node: process.version,
    configuration: { chunksPerMember: configuration.chunks, profileUnlocks: configuration.profile, diagnosticOnly: configuration.diagnosticOnly, workerCount: 1, appDir: relative(locations.appDir),
      caseStart: configuration.caseStart, caseLimit: configuration.caseLimit, heapSamples: configuration.heapSamples },
    inputs: { ...copiedBefore, source: relative(locations.source), scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), app: appBefore },
    contentFlags: { cacheShops: cacheShopContentsEnabled(), cacheResources: cacheResourceContentsEnabled(), cacheArchaeology: cacheArchaeologyContentsEnabled() },
    normalization: 'elapsedMs only; complete task ordering, evidence, diagnostics and projection fields retained',
    notes: ['Compact task request uses server shared-state transport and response-byte assembly without HTTP, browser, scheduling, save or background jobs.',
      'Input JSON.stringify is a cold upper-bound construction: the production store retains static serialized strings. Shared copy and worker decode are reported separately; transferDispatchResidualMs includes dispatch/event-loop time and is not pure transfer CPU.',
      'Each request clears worker result/snapshot caches; compiled definitions remain warm. Full view is a separate fresh evaluation and includes Current BiS and Activity Info.',
      'Engine subphase measurements are nested inclusive durations; do not sum them with engineMs. Generator resumes include discovery and final explanation passes.',
      'taskChecksDelta/taskChecksPerRequest count calls to check(task), including cached rejection and early returns, after removing static-blocked checks counted without a call. They are not distinct or fully evaluated task counts. dependencyChecksDelta preserves logical counter accounting, including cached training failures.',
      'resultDecodeParseMs decodes the actual assembled sidebar/peer/full response. Separate personal-play parsing used for projection equality is outside calculation/response timing.',
      'RSS is whole-process sampled every 50 ms, including the one worker; this is a sampled peak, not an OS high-water mark.',
      'Optional heapBoundaryMax records worker-isolate memoryUsage fields at stage/request boundaries. It can miss transient peaks; RSS remains whole-process. Heap samples sit outside each local stopwatch but their cost appears in enclosing timings/round trips, so compare matching heap-samples settings.',
      'Separate inspector-profile requests are excluded from scenario medians. Node --cpu-prof artifacts are separate from the targeted worker inspector profiles.'],
    baselines: [], scenarios: [], profiles: [] };
    const registry = createRuleRegistry(), loaded = await readCopiedState(locations.source, registry);
    const definitionRaw = await readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'));
    const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(definitionRaw.toString('utf8'))));
    const definitionBytes = Buffer.from(JSON.stringify(definitions)), world = buildWorld(definitions, { dataset: selectedDataset });
    report.inputs.definitionSha256 = sha(definitionRaw); report.inputs.effectiveDefinitionSha256 = sha(definitionBytes);
    const transformed = await instrument(locations.scratch, locations.appDir);
    report.instrumentationSource = { ...transformed, workerFile: relative(transformed.workerFile) };
    worker = await startWorker(transformed.workerFile, definitionBytes, world, configuration.heapSamples === 'on');
    report.startup = { totalMs: worker.startupMs, compileMs: worker.ready.compileMs, instrumentation: worker.ready.probe, rssBytes: process.memoryUsage.rss() };
    let state = loaded.state;
    report.migrationReused = currentMigration(state, worker.ready);
    if (!report.migrationReused) state = migrateOwnedGameplay(state, { definitions, catalogue: worker.ready.catalogue, dynamicCatalogue: worker.ready.dynamicCatalogue,
      taskMap: JSON.parse(await readFile(path.join(ROOT, 'reference/original-picker/tasksMap.json'), 'utf8')), taskMapHistory: JSON.parse(await readFile(path.join(ROOT, 'app/data/legacy-task-history.json'), 'utf8')) }).state;
    const { history, provenance, ...calculation } = state; calculation.history = [];
    const fingerprint = createGameplayFingerprint(), baseInput = fingerprint(calculation), immutableInput = taskReuseInputKey(calculation);
    report.sourceRevision = state.revision;
    const candidates = calculation.members.map(member => ({ memberId: member.id, chunks: chunksFor(calculation, member, world, registry, configuration.chunks) }));
    report.candidates = candidates;
    const casePlan = selectCases(candidates, configuration.caseStart, configuration.caseLimit);
    report.casePlan = { total: casePlan.total, indices: casePlan.cases.map(entry => entry.caseIndex), partial: casePlan.cases.length !== casePlan.total };
    console.log(JSON.stringify({ candidateIds: candidates.map(row => ({ memberId: row.memberId, ids: row.chunks.map(chunk => chunk.id) })) }));
    const baselineByMember = new Map();
    for (const member of calculation.members) {
      const baseline = await request(worker, calculation, member.id, baseInput, 'full');
      const summary = resultSummary(baseline.result), play = projectPlayResult(baseline.result);
      summary.duoSha256 = valueHash(transformed.peerProjection === 'sidebar'
        ? projectDuoSidebarResult(play, calculation, registry, member.id) : projectDuoPlayResult(play, calculation));
      baselineByMember.set(member.id, summary);
      report.baselines.push({ memberId: member.id, timing: baseline.timing, fullSha256: summary.fullSha256,
        duoSha256: summary.duoSha256, counts: summary.counts, fieldHashes: summary.fieldHashes });
    }
    const profileChoices = [];
    for (const { memberId, chunk, caseIndex } of casePlan.cases) {
      const command = ms(() => applyCommand(calculation, { type: 'set-chunk', memberId, chunkId: chunk.id, status: 'unlocked' }, { world, registry }));
      const after = command.value, input = fingerprint(after), results = [];
      assert.equal(taskReuseInputKey(calculation), immutableInput, 'Memory command mutated frozen baseline');
      for (const owner of calculation.members) if (owner.id !== memberId) assert.deepEqual(after.members.find(row => row.id === owner.id), owner, 'Partner ownership/progress changed');
      for (const ownerId of [memberId, ...calculation.members.filter(owner => owner.id !== memberId).map(owner => owner.id)]) {
        const selected = ownerId === memberId;
        const compact = await request(worker, after, ownerId, input, 'play-v1', { selected });
        const full = await request(worker, after, ownerId, input, 'full', { selected });
        const play = projectPlayResult(full.result), expected = { play: valueHash(play),
          duo: valueHash(transformed.peerProjection === 'sidebar' ? projectDuoSidebarResult(play, after, registry, ownerId) : projectDuoPlayResult(play, after)),
          sidebar: valueHash(projectDuoSidebarResult(play, after, registry, ownerId)) };
        const actual = { play: valueHash(compact.result), ...(selected ? { sidebar: valueHash(compact.wireProjection) } : { duo: valueHash(compact.wireProjection) }) };
        for (const [key, hash] of Object.entries(actual)) assert.equal(hash, expected[key], `${ownerId} ${chunk.id} ${key} compact/full projection mismatch`);
        const summary = resultSummary(full.result), baseline = baselineByMember.get(ownerId);
        results.push({ memberId: ownerId, lane: selected ? 'selected' : 'partner', compact: compact.timing, full: full.timing,
          projections: { equivalent: true, compact: actual, full: expected }, fullSha256: summary.fullSha256,
          unchangedDuoProjection: expected.duo === baseline.duoSha256,
          unchangedFullResult: summary.fullSha256 === baseline.fullSha256, before: baseline.counts, after: summary.counts, delta: taskDelta(baseline, summary) });
      }
      report.scenarios.push({ memberId, chunkId: chunk.id, caseIndex, classification: chunk, commandMs: command.ms, afterTaskInputSha256: taskReuseInputKey(after),
        originalInputUnchanged: true, partnerStateUnchanged: true, results });
      profileChoices.push({ memberId, chunkId: chunk.id });
      console.error(`Measured unlock ${memberId} ${chunk.id}, case ${caseIndex} (${report.scenarios.length}/${casePlan.cases.length}; full plan ${casePlan.total})`);
    }
    // Pick diagnostic profiles round-robin across members, separate from medians.
    const profileOrder = [];
    for (let index = 0; index < configuration.chunks; index++) for (const member of calculation.members) {
      const choice = profileChoices.find(row => row.memberId === member.id && row.chunkId === candidates.find(row => row.memberId === member.id).chunks[index].id);
      if (choice) profileOrder.push(choice);
    }
    for (const [index, choice] of profileOrder.slice(0, configuration.profile).entries()) {
      const after = applyCommand(calculation, { type: 'set-chunk', memberId: choice.memberId, chunkId: choice.chunkId, status: 'unlocked' }, { world, registry });
      const filename = path.join(path.dirname(locations.output), `${path.basename(locations.output, '.json')}-unlock-${index + 1}-${choice.chunkId}.cpuprofile`);
      await rejectLinks(filename, locations.local);
      const profiled = await request(worker, after, choice.memberId, fingerprint(after), 'play-v1', { profile: filename });
      report.profiles.push({ ...choice, file: relative(filename), sha256: sha(await readFile(filename)), diagnosticOnly: true, timing: profiled.timing });
    }
    assert.deepEqual(await inputFingerprint(locations.source), copiedBefore, 'Frozen source or dependency changed during measurements');
    assert.deepEqual(await appFingerprint(locations.appDir), appBefore, 'Selected application changed during measurements');
    report.sourceUnchanged = true; report.appUnchanged = true; report.allProjectionsEquivalent = true;
    report.aggregates = aggregate(report.scenarios); report.peakRSSBytes = Math.max(peakRSS, process.memoryUsage.rss());
    await worker.close(); worker = undefined;
    await writeFile(locations.output, JSON.stringify(report, null, 2) + '\n');
    for (const summary of report.aggregates.filter(row => row.memberId === null)) console.log(JSON.stringify({ lane: summary.lane, view: summary.view,
      medianP90Ms: Object.fromEntries([['roundTrip', summary.roundTripMs], ['evaluation', summary.evaluationMs], ['calculationTransport', summary.calculationTransportMs],
        ['stateStringifyColdUpperBound', summary.stateStringifyColdUpperBoundMs], ['sharedStateCopy', summary.sharedStateCopyMs], ['transferDispatchResidual', summary.transferDispatchResidualMs],
        ['responseAssembly', summary.responseAssemblyMs], ['resultDecodeParse', summary.resultDecodeParseMs],
        ...Object.entries(summary.stages), ...Object.entries(summary.instrumentation)].map(([key, value]) => [key, value ? { median: value.median, p90: value.p90 } : null])),
      medianP90Bytes: Object.fromEntries([['state', summary.stateBytes], ['response', summary.responseBytes]].map(([key, value]) => [key, value ? { median: value.median, p90: value.p90 } : null])),
      fixedPoint: summary.fixedPoint }));
    console.log(JSON.stringify({ report: relative(locations.output), scenarios: report.scenarios.length, profileArtifacts: report.profiles.length,
      allProjectionsEquivalent: true, sourceUnchanged: true, appUnchanged: true, peakRSSMiB: report.peakRSSBytes / 1048576 }));
  } finally {
    clearInterval(rssTimer);
    await worker?.close();
    const resolvedScratch = await realpath(locations.scratch);
    assert(inside(locations.perf, resolvedScratch) && !overlap(locations.source, resolvedScratch), 'Unsafe scratch cleanup target');
    await rm(resolvedScratch, { recursive: true, force: true });
    if (copiedBefore) assert.deepEqual(await inputFingerprint(locations.source), copiedBefore, 'Frozen source changed during calculation diagnostic');
  }
}

export { ROOT, sha, inside, overlap, relative, valueHash, paths, inputFingerprint, appFingerprint,
  instrument, startWorker, currentMigration, chunksFor, selectCases, resultSummary, taskDelta, request, quantiles, aggregate };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
