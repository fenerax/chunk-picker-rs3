// Numeric-only diagnostics for the current calc-check implementation. Runtime
// hooks leave files and calculator messages unchanged. Prefixes are diagnostic.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';

const symbol = Symbol.for('calc-check-profile');
const stat = pid => {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  return { parent: Number(fields[1]), cpu: Number(fields[11]) + Number(fields[12]), start: fields[19] };
};
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0;
};

// A separate thread keeps sampling when the checker's event loop is hashing.
function monitor() {
  const counters = new Map();
  let peak = 0;
  function sample() {
    try {
      const processes = readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
        try { return [{ pid: Number(name), ...stat(name) }]; } catch { return []; }
      });
      const descendants = new Set([workerData.pid]);
      for (let changed = true; changed;) {
        changed = false;
        for (const row of processes) if (descendants.has(row.parent) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
      }
      let rss = 0;
      for (const row of processes) if (descendants.has(row.pid)) {
        counters.set(`${row.pid}:${row.start}`, { cpu: row.cpu, main: row.pid === workerData.pid });
        try { rss += Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${row.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; } catch {}
      }
      peak = Math.max(peak, rss);
      const ticks = workerData.ticks;
      let mainThreadCpuSeconds = null;
      if (ticks) try { mainThreadCpuSeconds = stat(`${workerData.pid}/task/${workerData.pid}`).cpu / ticks; } catch {}
      const resources = { aggregatePeakRSSBytes: peak, processCount: counters.size, mainThreadCpuSeconds,
        mainProcessCpuSeconds: ticks ? [...counters.values()].filter(row => row.main).reduce((sum, row) => sum + row.cpu / ticks, 0) : null,
        descendantCpuSeconds: ticks ? [...counters.values()].filter(row => !row.main).reduce((sum, row) => sum + row.cpu / ticks, 0) : null };
      writeFileSync(workerData.output, `${JSON.stringify(resources)}\n`);
    } catch { /* Resource counters are optional outside Linux. */ }
  }
  sample();
  const timer = setInterval(sample, 250);
  parentPort.once('message', () => { clearInterval(timer); sample(); parentPort.close(); });
}

function hooks() {
  function replace(source, before, after) {
    if (!source.includes(before)) throw new Error('unsupported-checker-version');
    return source.replace(before, after);
  }
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith(new URL('../../tools/calc-check/', import.meta.url).href)) return result;
    let source = String(result.source);
    if (url.endsWith('/main.mjs')) {
      source = replace(source, 'corpus = await buildCorpus(spec, seed);', 'corpus = await globalThis[Symbol.for("calc-check-profile")].span("corpus.total", () => buildCorpus(spec, seed));');
      source = replace(source, 'return entry.load ? await entry.load() : entry.state;', 'return await globalThis[Symbol.for("calc-check-profile")].span("snapshot.load", () => entry.load ? entry.load() : entry.state);');
      source = replace(source, 'corpus.groups = partitionCorpus(corpus, selectedShard);', 'corpus.groups = partitionCorpus(corpus, selectedShard); globalThis[Symbol.for("calc-check-profile")].select(corpus);');
      source = replace(source, 'for (let stateIndex = 0;', 'globalThis[Symbol.for("calc-check-profile")].phase = "cold"; for (let stateIndex = 0;');
      source = replace(source, 'for (const entry of sample(retained, retained.length, random)) {', 'globalThis[Symbol.for("calc-check-profile")].phase = "warm"; for (const entry of sample(retained, retained.length, random)) {');
      source = replace(source, 'await c.request(prime, state).promise;', 'await globalThis[Symbol.for("calc-check-profile")].during("prime", () => c.request(prime, state).promise);');
      source = replace(source, 'const chosen = retained.find', 'globalThis[Symbol.for("calc-check-profile")].phase = "cancel"; const chosen = retained.find');
      source = replace(source, 'await run(d, state, false, chosen.baseline);', 'await globalThis[Symbol.for("calc-check-profile")].during("rerun", () => run(d, state, false, chosen.baseline));');
      source = replace(source, 'await Promise.all(calculators.map(c => c.close()));', 'await globalThis[Symbol.for("calc-check-profile")].span("close-and-replay", () => Promise.all(calculators.map(c => c.close())));');
    }
    if (url.endsWith('/corpus.mjs')) {
      for (const [before, after] of [
        ['const input = await selectedInput();', 'const input = await globalThis[Symbol.for("calc-check-profile")].span("corpus.dataset", () => selectedInput());'],
        ['const store = await openStore({ dataDir, world: input.world, registry, retention: false });', 'const store = await globalThis[Symbol.for("calc-check-profile")].span("corpus.open", () => openStore({ dataDir, world: input.world, registry, retention: false }));'],
        ['const current = (await store.backup()).state;', 'const current = (await globalThis[Symbol.for("calc-check-profile")].span("corpus.current", () => store.backup())).state;'],
        ['const backups = await snapshots.listBackups();', 'const backups = await globalThis[Symbol.for("calc-check-profile")].span("corpus.inventory", () => snapshots.listBackups());'],
        ['await rebuildHistoryRevisions(current, byRevision, { world: input.world, registry })', 'await globalThis[Symbol.for("calc-check-profile")].span("corpus.history", () => rebuildHistoryRevisions(current, byRevision, { world: input.world, registry }))'],
      ]) source = replace(source, before, after);
    }
    if (url.endsWith('/serial.mjs')) {
      source = replace(source, 'const operation = { header, index, id: pending.id };', 'const operation = { header, index, id: pending.id, profilePhase: globalThis[Symbol.for("calc-check-profile")].phase };');
      source = replace(source, 'const state = operation.body ?', 'globalThis[Symbol.for("calc-check-profile")].phase = operation.profilePhase; const state = operation.body ?');
    }
    if (url.endsWith('/compare.mjs')) {
      source = replace(source, 'export function compareValues(left, right) {', 'function profileCompareValues(left, right) {');
      source += '\nexport function compareValues(left, right) { const start = performance.now(); try { return profileCompareValues(left, right); } finally { globalThis[Symbol.for("calc-check-profile")].add("comparison", performance.now() - start); } }\n';
      source = replace(source, 'export function digestTree(value, path = []) {', 'function profileDigestTree(value, path = []) {');
      source = replace(source, 'const child = digestTree(value[key]', 'const child = profileDigestTree(value[key]');
      source += '\nexport function digestTree(value, path = []) { const start = performance.now(); try { return profileDigestTree(value, path); } finally { globalThis[Symbol.for("calc-check-profile")].add("hashing", performance.now() - start); } }\n';
    }
    return { ...result, source };
  } });
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('node scripts/perf/calc-check-profile.mjs --profile /tmp/profile.json [--first-states N] -- <calc-check arguments>');
    return;
  }
  const split = args.indexOf('--');
  if (split < 0) throw new TypeError('invalid');
  let output, first = Infinity;
  for (let i = 0; i < split; i += 2) {
    if (args[i] === '--profile') output = path.resolve(args[i + 1]);
    else if (args[i] === '--first-states') {
      first = Number(args[i + 1]);
      if (!Number.isSafeInteger(first) || first < 1) throw new TypeError('invalid');
    } else throw new TypeError('invalid');
  }
  if (!output || path.relative(tmpdir(), output).startsWith('..') || output === tmpdir()) throw new TypeError('invalid');
  const began = performance.now(), rows = new Map();
  const profile = { phase: 'cold', corpusStates: null, selectedStates: null,
    add(key, value) { if (!rows.has(key)) rows.set(key, []); rows.get(key).push(value); },
    async span(key, fn) { const start = performance.now(); try { return await fn(); } finally { this.add(key, performance.now() - start); } },
    async during(phase, fn) { const previous = this.phase; this.phase = phase; try { return await fn(); } finally { this.phase = previous; } },
    select(corpus) {
      this.corpusStates = corpus.manifest.groups.reduce((sum, group) => sum + group.states.length, 0);
      let remaining = first;
      for (const group of corpus.groups) { group.states = group.states.slice(0, remaining); remaining -= group.states.length; }
      corpus.groups = corpus.groups.filter(group => group.states.length);
      this.selectedStates = corpus.groups.reduce((sum, group) => sum + group.states.length, 0);
    },
  };
  globalThis[symbol] = profile;
  let ticks;
  try { ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  const resourceFile = `${output}.resources.json`;
  const sampler = new Worker(new URL(import.meta.url), { execArgv: [], workerData: { pid: process.pid, ticks, output: resourceFile } });
  let samplerFailed = false;
  sampler.on('error', () => { samplerFailed = true; });
  const stopped = once(sampler, 'exit');
  stopped.catch(() => {});
  function save() {
    let resources;
    try { resources = JSON.parse(readFileSync(resourceFile, 'utf8')); } catch {}
    writeFileSync(output, `${JSON.stringify({ elapsedMs: performance.now() - began, diagnosticPrefix: Number.isFinite(first),
      corpusStates: profile.corpusStates, selectedStates: profile.selectedStates, cpuTickMs: ticks ? 1000 / ticks : null,
      resources, samplerFailed, rows: Object.fromEntries([...rows].map(([key, values]) => [key, { count: values.length, total: values.reduce((a, b) => a + b, 0), median: median(values), min: values.reduce((a, b) => Math.min(a, b), Infinity), max: values.reduce((a, b) => Math.max(a, b), -Infinity) }])) }, null, 2)}\n`);
  }
  let timer;
  try {
    save();
    timer = setInterval(save, 30000); timer.unref();
    hooks();
    const { Calculator } = await import('../../tools/calc-check/client.mjs');
    const init = Calculator.prototype.init, request = Calculator.prototype.request;
    let nextSide = 0;
    Calculator.prototype.init = async function(bundle) {
      this.profileSide = nextSide++ % 2 ? 'candidate' : 'reference';
      return profile.span(`init.${this.profileSide}`, () => init.call(this, bundle));
    };
    Calculator.prototype.request = function(header, state) {
      const phase = profile.phase, side = this.profileSide, start = performance.now();
      const cpu = () => {
        if (!ticks) return null;
        try { return (this.memoryPids ?? [this.child.pid]).reduce((sum, pid) => { try { return sum + stat(pid).cpu * 1000 / ticks; } catch { return sum; } }, 0); } catch { return null; }
      };
      const before = cpu(), pending = request.call(this, header, state);
      return { ...pending, promise: pending.promise.then(reply => {
        profile.add(`request.${side}.${phase}.${header.type}`, performance.now() - start);
        const after = cpu();
        if (before !== null && after !== null) profile.add(`cpu.${side}.${phase}.${header.type}`, Math.max(0, after - before));
        return reply;
      }) };
    };
    try { await (await import('../../tools/calc-check/main.mjs')).cli(args.slice(split + 1)); }
    finally { Calculator.prototype.init = init; Calculator.prototype.request = request; }
  } finally {
    clearInterval(timer); sampler.postMessage('stop'); await stopped; save();
  }
}

if (isMainThread) await main(process.argv.slice(2)).catch(() => { console.error('profile-failed'); process.exitCode = 1; });
else monitor();
