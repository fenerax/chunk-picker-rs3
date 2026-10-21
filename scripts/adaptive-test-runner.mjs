import { fork, spawnSync } from 'node:child_process';
import { access, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { freemem } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const GiB = 1024 ** 3;
const self = fileURLToPath(import.meta.url);
const countKeys = ['tests', 'suites', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'topLevel'];

export const DEFAULT_FILE_DEADLINE_MS = 15 * 60 * 1000;
const tracer = new URL('./test-trace.mjs', import.meta.url).href;
const sameCase = process.platform === 'win32' ? value => value.toLowerCase() : value => value;
const within = (file, root) => { const a = sameCase(path.resolve(file)), b = sameCase(path.resolve(root)); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };

// Windows has no process groups; taskkill /T follows the parent chain instead.
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

const slash = value => value.replaceAll('\\', '/');
const traceKinds = ['read', 'list', 'stat', 'tree', 'write', 'make'];
// Lane scratch: fresh, empty roots per lane execution (release-v2 refuses leftovers).
const scratchKeys = ['TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'NODE_COMPILE_CACHE'];
const scratchRoots = env => [...new Set(scratchKeys.map(key => env[key]).filter(Boolean).map(root => path.resolve(root)))];

/** Fold the per-process trace files of one test file. Paths inside cwd become
 * project-relative names and scratch paths stay absolute. The Node installation
 * is not an input; every other path outside is reported and keeps the file
 * unreusable. Writes outside cwd and scratch change nothing a later file reads
 * without itself reading outside. */
export async function summarizeTrace(directory, { cwd, env }) {
  const scratch = scratchRoots(env);
  const nodeHome = path.dirname(process.execPath);
  const inside = Object.fromEntries(traceKinds.map(kind => [kind, new Set()]));
  const scratchKinds = Object.fromEntries(traceKinds.map(kind => [kind, new Set()]));
  const hazards = new Set(), outside = new Set(), connects = new Set(), listens = new Set();
  let processes = 0;
  let names = [];
  try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names.filter(name => name.endsWith('.jsonl')).sort()) {
    processes++;
    for (const line of (await readFile(path.join(directory, name), 'utf8')).split('\n')) {
      if (!line) continue;
      let kind, value;
      try { [kind, value] = JSON.parse(line); } catch { hazards.add('unreadable trace line'); continue; }
      if (kind === 'hazard') { hazards.add(value); continue; }
      if (kind === 'connect') { connects.add(value); continue; }
      if (kind === 'listen') { listens.add(value); continue; }
      if (kind === 'child') continue;
      if (!inside[kind] || typeof value !== 'string') { hazards.add('unknown trace kind'); continue; }
      const glob = value.endsWith('*'), file = glob ? value.slice(0, -1) : value;
      if (within(file, cwd)) inside[kind].add(slash(path.relative(cwd, file)) + (glob ? '*' : ''));
      else if (scratch.some(root => within(file, root))) scratchKinds[kind].add(slash(path.resolve(file)) + (glob ? '*' : ''));
      else if (kind === 'write' || kind === 'make' || within(file, nodeHome) || within(file, directory)) continue;
      // realpath and recursive lookups stat each ancestor of the assembly or a
      // scratch root; the run starting there already implies those directories.
      else if (kind === 'stat' && [cwd, ...scratch].some(root => within(root, file))) continue;
      else outside.add(file);
    }
  }
  const sorted = set => [...set].sort();
  return { schema: 'rs3-test-trace-v2', processes, hazards: sorted(hazards), ...Object.fromEntries(traceKinds.map(kind => [kind, sorted(inside[kind])])),
    scratch: Object.fromEntries(traceKinds.map(kind => [kind, sorted(scratchKinds[kind])])), outside: sorted(outside).slice(0, 50), outsideCount: outside.size,
    connects: sorted(connects), listens: sorted(listens) };
}

/** Names under cwd (relative), and files and directories under the scratch roots
 * (absolute), that existed before any file ran. */
export async function traceBaseline({ cwd, env }) {
  const names = new Set(['']);
  for (const name of await readdir(cwd, { recursive: true })) names.add(sameCase(slash(name)));
  // A root that cannot be listed counts as holding unknown files.
  const scratchFiles = new Set(), scratchDirs = new Set(), opaqueRoots = [];
  for (const root of scratchRoots(env)) {
    let entries = [];
    try { entries = await readdir(root, { recursive: true, withFileTypes: true }); scratchDirs.add(sameCase(slash(root))); } catch (error) { if (error.code !== 'ENOENT') { opaqueRoots.push(sameCase(slash(root))); continue; } }
    for (const entry of entries) (entry.isDirectory() ? scratchDirs : scratchFiles).add(sameCase(slash(path.join(entry.parentPath ?? entry.path, entry.name))));
  }
  return { names, scratchFiles, scratchDirs, opaqueRoots };
}

const ancestors = name => {
  const result = [];
  for (let index = name.lastIndexOf('/'); index > 0; index = name.lastIndexOf('/', index - 1)) result.push(name.slice(0, index));
  if (!/^[A-Za-z]:\//.test(name) && name) result.push('');
  return result;
};
/** Cross-file annotations for one lane execution. created: observed cwd names
 * absent at lane start. scratchExisted: observed scratch files present at lane
 * start. foreign: observations another file in this execution wrote, made (when
 * absent at lane start) or, for listings, changed beneath. Files run concurrently,
 * so any such overlap is a dependency. */
export function crossFileTrace(results, { names = new Set(), scratchFiles = new Set(), scratchDirs = new Set(), opaqueRoots = [] } = {}) {
  const existed = name => names.has(sameCase(name)) || scratchDirs.has(sameCase(name));
  const written = new Map(), made = new Map(), beneath = new Map();
  const add = (map, name, file) => { const key = sameCase(name); (map.get(key) ?? map.set(key, new Set()).get(key)).add(file); };
  const others = (map, name, file) => { const owners = map.get(sameCase(name)); return !!owners && (owners.size > 1 || !owners.has(file)); };
  const traced = results.filter(item => item?.trace);
  for (const { file, trace } of traced) {
    for (const name of [...trace.write, ...trace.scratch.write]) { add(written, name, file); for (const parent of ancestors(name)) add(beneath, parent, file); }
    for (const name of [...trace.make, ...trace.scratch.make].filter(name => !name.endsWith('*'))) { add(made, name, file); for (const parent of ancestors(name)) add(beneath, parent, file); }
  }
  for (const { file, trace } of traced) {
    const local = ['read', 'list', 'stat', 'tree'].flatMap(kind => trace[kind]);
    const scratch = ['read', 'list', 'stat', 'tree'].flatMap(kind => trace.scratch[kind]);
    // Only a listing or a tree copy sees a directory's children; a stat or read does not.
    const children = new Set(['list', 'tree'].flatMap(kind => [...trace[kind], ...trace.scratch[kind]]).map(sameCase));
    // mkdir never changes a directory that was already there.
    const foreign = [...new Set([...local, ...scratch])].filter(name => others(written, name, file) || others(made, name, file) && !existed(name)
      || children.has(sameCase(name)) && others(beneath, name, file)
      || ancestors(name).some(parent => others(written, parent, file)));
    trace.foreign = foreign.slice(0, 50); trace.foreignCount = foreign.length;
    trace.created = [...new Set(local)].filter(name => !names.has(sameCase(name))).sort();
    trace.scratchExisted = [...new Set(scratch)].filter(name => scratchFiles.has(sameCase(name)) || opaqueRoots.some(root => sameCase(name) === root || sameCase(name).startsWith(root + '/'))).sort();
  }
  return results;
}
// A controller per file gives Node's native FileTest events and an independent
// environment. Only the actual test child runs cases. No worker is suspended.
// Past its deadline the controller tree is killed and the file counts as failed.
async function nativeFile({ file, cwd, env, signal, onEvent, deadlineMs = DEFAULT_FILE_DEADLINE_MS, traceRoot }) {
  const started = performance.now();
  const environment = { ...env };
  delete environment.NODE_TEST_CONTEXT; delete environment.RS3_TEST_TRACE_DIR; delete environment.RS3_TEST_TRACER;
  let traceDirectory;
  if (traceRoot) {
    traceDirectory = path.join(traceRoot, path.basename(file).replace(/[^\w.-]/g, '_') + '-' + randomUUID());
    await mkdir(traceDirectory, { recursive: true });
    Object.assign(environment, { RS3_TEST_TRACE_DIR: traceDirectory, RS3_TEST_TRACER: tracer });
  }
  const child = fork(self, ['--worker', file], {
    cwd, env: environment, execArgv: [], serialization: 'advanced', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32',
  });
  let summary, fileWallMs, bodyMs = 0, callbackError, childError, timedOut = false;
  const deadline = deadlineMs > 0 ? setTimeout(() => {
    timedOut = true;
    emit({ type: 'test:diagnostic', data: { file, nesting: 0, message: `file deadline of ${deadlineMs} ms exceeded; killing its process tree` } });
    killTree(child);
  }, deadlineMs) : undefined;
  let events = Promise.resolve();
  const emit = event => {
    events = events.then(() => onEvent(event)).catch(error => { callbackError ??= error; });
  };
  child.stdout.on('data', message => emit({ type: 'test:stdout', data: { file, message: String(message) } }));
  child.stderr.on('data', message => emit({ type: 'test:stderr', data: { file, message: String(message) } }));
  child.on('message', event => {
    const { type, data } = event;
    if (type === 'test:summary' && !data.file) {
      // Native IPC retains file:undefined. Receipts use canonical JSON values.
      summary = { success: data.success, counts: { ...data.counts }, duration_ms: data.duration_ms };
      return;
    }
    if (type === 'test:complete' && !data.entryFile) fileWallMs = data.details.duration_ms;
    if (type === 'test:complete' && data.entryFile && data.nesting === 0) bodyMs += data.details.duration_ms;
    // File-local plans and diagnostics remain native. The root plan/summary
    // belong to this controller and are replaced by a single combined root.
    if (type === 'test:plan' && !data.file) return;
    if (type === 'test:diagnostic' && !data.file) return;
    emit(event);
  });
  const abort = () => { if (child.connected) child.send({ abort: true }, () => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const [code, exitSignal, exited] = await new Promise(resolve => {
    child.once('error', error => { childError = error; });
    child.once('close', (code, exitSignal) => resolve([code, exitSignal, performance.now()]));
  });
  clearTimeout(deadline);
  signal?.removeEventListener('abort', abort);
  await events;
  if (callbackError) throw callbackError;
  if (childError && !timedOut) throw childError;
  const trace = traceDirectory ? await summarizeTrace(traceDirectory, { cwd, env: environment }) : undefined;
  if (traceDirectory) await rm(traceDirectory, { recursive: true, force: true });
  if (timedOut) {
    const counts = Object.fromEntries(countKeys.map(key => [key, summary?.counts?.[key] ?? 0]));
    counts.failed = Math.max(1, counts.failed);
    return { file, passed: false, timedOut: true, deadlineMs, processWallMs: exited - started, fileWallMs: fileWallMs ?? exited - started, bodyMs,
      summary: { success: false, counts, duration_ms: exited - started }, ...(trace ? { trace } : {}) };
  }
  if (!summary || !Number.isFinite(fileWallMs)) throw new Error(`Missing native summary/FileTest completion for ${file} (exit ${code}, signal ${exitSignal})`);
  return { file, passed: code === 0 && summary.success === true, processWallMs: exited - started,
    fileWallMs, bodyMs, summary, ...(trace ? { trace } : {}) };
}

// The assembly's reviewed per-file policy: { solo, env }. env values replace the
// lane's variable; undefined removes it. Lanes that call runAdaptive directly
// (release-v2, post-merge-private) get the same policy from the same tree.
export async function loadTestPolicy(cwd) {
  const selection = path.join(cwd, 'scripts/test-selection.mjs');
  try { await access(selection); } catch { return () => ({}); }
  const { testRunPolicy } = await import(pathToFileURL(selection).href);
  return typeof testRunPolicy === 'function' ? testRunPolicy : () => ({});
}

function policyEnvironment(env, overrides = {}) {
  const environment = { ...env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = String(value);
  }
  return environment;
}

/**
 * Run isolated files with memory admission. onEvent receives native node:test
 * event objects, with one combined root plan/summary. onFile runs after that
 * file's controller exits. processWallMs includes controller startup/exit;
 * fileWallMs is Node FileTest lifetime; bodyMs is top-level case/suite duration
 * (nested cases are not counted twice and imports/teardown are excluded).
 * memory and runFile are injectable for deterministic scheduler fixtures.
 * policy(name) gives a file's { solo, env } (default: the tree's testRunPolicy).
 * Solo files run first, one at a time, with nothing else admitted beside them.
 */
export async function runAdaptive({ files, cwd = process.cwd(), env = process.env,
  memory = freemem, floorBytes = 4 * GiB, reserveBytes = GiB,
  minConcurrency = 2, maxConcurrency = 6, pollMs = 250, rampMs = 1000,
  onEvent = async () => {}, onFile = async () => {}, onSchedule = async () => {},
  signal, runFile = nativeFile, policy, fileDeadlineMs = DEFAULT_FILE_DEADLINE_MS, traceRoot } = {}) {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file)) throw new TypeError('files must be an array of nonempty paths');
  if (new Set(files.map(file => path.resolve(cwd, file))).size !== files.length) throw new Error('Duplicate test files');
  policy ??= await loadTestPolicy(cwd);
  const policies = new Map(files.map(file => [file, policy(path.basename(file)) ?? {}]));
  files = [...files.filter(file => policies.get(file).solo), ...files.filter(file => !policies.get(file).solo)];
  let soloActive = false;
  if (!Number.isFinite(floorBytes) || floorBytes < 4 * GiB) throw new Error('Memory floor must be at least 4 GiB');
  if (!Number.isFinite(reserveBytes) || reserveBytes < GiB) throw new Error('Worker reserve must be at least 1 GiB');
  if (![minConcurrency, maxConcurrency].every(Number.isInteger) || minConcurrency < 1 || maxConcurrency < minConcurrency || maxConcurrency > 6) throw new Error('Concurrency must satisfy 1 <= minimum <= maximum <= 6');
  if (!Number.isFinite(pollMs) || pollMs < 1 || !Number.isFinite(rampMs) || rampMs < 0) throw new Error('Invalid scheduling interval');
  if (!Number.isFinite(fileDeadlineMs) || fileDeadlineMs < 0) throw new Error('Invalid file deadline');
  const baseline = traceRoot ? await traceBaseline({ cwd, env }) : undefined;
  const started = performance.now(), completed = [], active = new Set();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let next = 0, target = minConcurrency, peak = 0, lastRamp = started, failure, firstSample = true;
  let nextId = 1, nextTopNumber = 1;
  const ids = new Map(), numbers = new Map();
  let eventChain = Promise.resolve();
  const emit = event => {
    // Independent native streams restart ids/numbers. Namespace those ids so
    // reporters can match nested starts/completions across overlapping files.
    const data = { ...event.data };
    const namespace = `${data.entryFile ?? data.file ?? ''}|${data.entryFile ? 'case' : 'file'}`;
    const id = value => {
      const key = `${namespace}|${value}`;
      if (!ids.has(key)) ids.set(key, nextId++);
      return ids.get(key);
    };
    if (data.testId !== undefined) {
      const original = data.testId;
      data.testId = id(original);
      if (data.parentId) data.parentId = id(data.parentId);
      if (data.entryFile && data.nesting === 0 && data.testNumber !== undefined) {
        const key = `${namespace}|${original}`;
        if (!numbers.has(key)) numbers.set(key, nextTopNumber++);
        data.testNumber = numbers.get(key);
      }
    }
    event = { ...event, data };
    const result = eventChain.then(() => onEvent(event));
    eventChain = result.catch(error => { failure ??= error; });
    return result;
  };
  try {
    while ((next < files.length || active.size) && !failure) {
      if (controller.signal.aborted) break;
      const free = Number(await memory());
      if (!Number.isFinite(free) || free < 0) throw new Error('Invalid free-memory sample');
      // Reserve every admitted worker, including one whose memory has not yet
      // appeared in the OS sample. This deliberately double-counts live usage.
      const room = Math.max(0, Math.floor((free - floorBytes) / reserveBytes));
      if (next === 0 && active.size === 0 && room >= minConcurrency) target = minConcurrency;
      else if (room < active.size + 1) { target = Math.min(target, Math.max(1, active.size)); lastRamp = performance.now(); }
      else if (!firstSample && performance.now() - lastRamp >= rampMs && target < maxConcurrency) { target++; lastRamp = performance.now(); }
      firstSample = false;
      await onSchedule({ freeBytes: free, active: active.size, target, pending: files.length - next });
      let reserved = active.size;
      while (next < files.length && active.size < target && free > floorBytes && free - (reserved + 1) * reserveBytes >= floorBytes) {
        const { solo = false, env: overrides, deadlineMs = fileDeadlineMs } = policies.get(files[next]);
        if (soloActive || (solo && active.size)) break;
        const file = files[next++];
        reserved++;
        soloActive = solo;
        const task = Promise.resolve().then(() => runFile({ file, cwd, env: policyEnvironment(env, overrides), signal: controller.signal, onEvent: emit, deadlineMs, traceRoot }))
          .then(async result => { completed.push(result); await onFile(result); })
          .catch(error => { failure ??= error; })
          .finally(() => { active.delete(task); if (solo) soloActive = false; });
        active.add(task);
        peak = Math.max(peak, active.size);
      }
      if (next < files.length || active.size) {
        const waiting = new AbortController();
        try {
          await Promise.race([delay(pollMs, undefined, { signal: AbortSignal.any([controller.signal, waiting.signal]) }).catch(() => {}), ...active]);
        } finally { waiting.abort(); }
      }
    }
    // Never freeze/kill a memory-holding worker to make headroom. On abort,
    // Node cancels its test children and the controller drains before return.
    await Promise.allSettled([...active]);
    await eventChain;
    if (failure) throw failure;
    if (baseline) crossFileTrace(completed, baseline);
    const counts = Object.fromEntries(countKeys.map(key => [key, completed.reduce((sum, item) => sum + (item.summary?.counts?.[key] ?? 0), 0)]));
    const passed = !controller.signal.aborted && completed.length === files.length && completed.every(item => item.passed);
    const wallMs = performance.now() - started;
    const summary = { success: passed, counts, duration_ms: wallMs };
    await emit({ type: 'test:plan', data: { nesting: 0, count: counts.topLevel } });
    for (const key of countKeys.filter(key => key !== 'topLevel')) await emit({ type: 'test:diagnostic', data: { nesting: 0, message: `${({ passed: 'pass', failed: 'fail' })[key] ?? key} ${counts[key]}` } });
    await emit({ type: 'test:diagnostic', data: { nesting: 0, message: `duration_ms ${wallMs}` } });
    await emit({ type: 'test:summary', data: summary });
    return { passed, exitCode: passed ? 0 : 1, files: completed, summary, wallMs, maxActive: peak, aborted: controller.signal.aborted };
  } finally {
    signal?.removeEventListener('abort', abort);
    // Memory/observer failures stop admission, but active controllers must exit
    // before callers delete their compile cache or write success receipts.
    await Promise.allSettled([...active]);
  }
}

async function worker(file) {
  const { run } = await import('node:test');
  // Only the test child and its descendants are traced, never this controller.
  if (process.env.RS3_TEST_TRACER) process.env.NODE_OPTIONS = `--import=${process.env.RS3_TEST_TRACER} ${process.env.NODE_OPTIONS ?? ''}`.trim();
  const controller = new AbortController();
  process.on('message', message => { if (message?.abort) controller.abort(); });
  process.on('disconnect', () => controller.abort());
  let success = false;
  for await (const event of run({ files: [path.resolve(file)], isolation: 'process', concurrency: 1, signal: controller.signal })) {
    if (event.type === 'test:summary' && !event.data.file) success = event.data.success;
    await new Promise((resolve, reject) => process.send(event, error => error ? reject(error) : resolve()));
  }
  process.exitCode = success ? 0 : 1;
  process.disconnect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  if (process.argv[2] === '--worker' && process.send) await worker(process.argv[3]);
  else if (process.argv[2] === '--help') console.log('Adaptive node:test scheduler (Node 24). Import runAdaptive({ files, cwd, env, onEvent, onFile, memory, signal }). Defaults: 2 initial files, cap 6, 4 GiB floor, 1 GiB reserved per active worker.');
  else throw new Error('Import runAdaptive(), or use --help');
}
