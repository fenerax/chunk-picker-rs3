// One local comparison, not a production storage implementation.
// node --expose-gc scripts/perf/format2-memory-spike.mjs --out var/format2-memory-spike/development
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, link } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fork, execFileSync, spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { parseArgs } from 'node:util';
import { constants, setPriority, cpus, freemem, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import { makeBase, representation, freeze, sha, stats, slope, transform } from './format2-memory-prototype.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), self = fileURLToPath(import.meta.url);
const MiB = 1024 ** 2;
const { values } = parseArgs({ options: {
  out: { type: 'string' }, child: { type: 'string' }, check: { type: 'boolean', default: false },
} });
assert.equal(path.resolve(process.cwd()), path.resolve(root), 'Run from this checkout');
if (values.check) {
  for (const mode of ['A', 'B', 'C']) for (const [name, file] of [['store', 'app/storage/store.mjs'], ['state', 'app/core/state.mjs']]) {
    const source = transform(await readFile(path.join(root, file), 'utf8'), name, mode);
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  console.log('All six transformed modules parse; exact source anchors match.');
} else {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.20+ within 24.x');
  assert(Number(process.versions.node.split('.')[1]) >= 20);
  assert(values.out, '--out is required; no save/input path is accepted');
  const output = path.resolve(root, values.out);
  assert(output.startsWith(path.join(root, 'var', 'format2-memory-spike') + path.sep), 'Output must be beneath var/format2-memory-spike/');
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  if (values.child) await trial(values.child, output);
  else await comparison(output);
}

async function comparison(output) {
  await mkdir(output, { recursive: true });
  // Refuse accidental repeats against a development output directory.
  await writeFile(path.join(output, 'started.json'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }), { flag: 'wx' });
  const results = [];
  const leaseDeadline = Date.now() + (process.env.GITHUB_ACTIONS === 'true' ? 27 : 9) * 60 * 1000;
  for (const mode of ['A', 'B', 'C']) {
    if (mode === 'C' && results[1].decision.targetMet) break;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RS3_') || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
    env.RS3_DATASET = 'open-starter';
    console.log(`Starting ${mode}: 50 groups, fresh process, synthetic inputs only.`);
    const child = fork(self, ['--out', output, '--child', mode], {
      cwd: root, env, execArgv: ['--expose-gc', '--max-old-space-size=3072'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const deadline = setTimeout(() => child.kill(), Math.max(1, Math.min(8 * 60 * 1000, leaseDeadline - Date.now())));
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${mode} failed: ${code ?? signal}`)));
      });
    } finally { clearTimeout(deadline); }
    const result = JSON.parse(await readFile(path.join(output, `${mode}.json`), 'utf8'));
    results.push(result);
  }
  // Fixture, initial History and final logical state must match across variants.
  for (const r of results.slice(1)) {
    assert.equal(r.fixtureHash, results[0].fixtureHash);
    assert.deepEqual(r.sourceHashes, results[0].sourceHashes, 'Source changed during the comparison');
    assert.deepEqual(r.finalHashes, results[0].finalHashes, 'Final logical state/History differs across variants');
  }
  const report = { format: 'owned-format2-memory-spike', version: 1, results,
    recommendation: results.find(r => r.mode !== 'A' && r.decision.targetMet)?.mode ?? 'No candidate meets the target',
    equivalence: 'All 50 final logical-state and History hashes match across measured variants' };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  await writeFile(path.join(output, 'comparison.html'), chart(results), { flag: 'wx' });
  console.log(JSON.stringify({ recommendation: report.recommendation, results: results.map(r => ({ mode: r.mode,
    retainedMiB: Object.fromEntries(Object.entries(r.retainedHeapBytes).map(([k, v]) => [k, k === 'count' ? v : v / MiB])),
    heapMiB: r.finalMemory.heapUsed / MiB, rssMiB: r.finalMemory.rss / MiB, decision: r.decision })) }, null, 2));
}

async function trial(mode, output) {
  assert(['A', 'B', 'C'].includes(mode));
  assert(globalThis.gc, 'Pass --expose-gc');
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
  process.env.RS3_DATASET = 'open-starter';
  const sourceHashes = {};
  for (const file of ['app/storage/store.mjs', 'app/core/state.mjs', 'scripts/perf/format2-memory-prototype.mjs', 'scripts/perf/format2-memory-spike.mjs']) {
    sourceHashes[file] = sha(await readFile(path.join(root, file)));
  }
  const base = makeBase(), proto = mode === 'A' ? { base } : representation(base, mode);
  globalThis[Symbol.for('format2-memory-spike')] = proto;
  const sources = new Map([
    [new URL('../../app/storage/store.mjs', import.meta.url).href, 'store'],
    [new URL('../../app/core/state.mjs', import.meta.url).href, 'state'],
  ]);
  const hook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    return sources.has(url) ? { ...result, source: transform(String(result.source), sources.get(url), mode) } : result;
  } });
  const { createGroupState, applyValidatedCommand, validateOwnedState } = await import('../../app/core/state.mjs');
  const { createRuleRegistry } = await import('../../app/core/rules.mjs');
  const { openStore } = await import('../../app/storage/store.mjs');
  const registry = createRuleRegistry(), clock = '2026-11-10T12:00:00.000Z';
  const world = { chunks: new Map(Array.from({ length: 32 }, (_, i) => [String(10000 + i), { id: String(10000 + i) }])) };
  const fixture = await prepareFixture({ base, createGroupState, applyValidatedCommand, registry, world, clock, output, mode });
  const handles = [], opens = [], commands = {}, openSamples = [], commandSamples = [], finalHashes = [];
  let peak = process.memoryUsage();
  const guard = () => {
    const m = process.memoryUsage();
    for (const key of Object.keys(m)) peak[key] = Math.max(peak[key], m[key]);
    assert(m.rss < 3.5 * 1024 ** 3, '3.5 GiB process RSS guard reached');
  };
  async function gc() {
    await new Promise(resolve => setImmediate(resolve));
    globalThis.gc(); globalThis.gc(); guard();
    return process.memoryUsage();
  }
  async function timed(work) {
    const beforeCPU = process.cpuUsage(), start = performance.now();
    await work();
    const cpu = process.cpuUsage(beforeCPU);
    guard();
    return { wallMs: performance.now() - start, cpuMs: (cpu.user + cpu.system) / 1000 };
  }
  async function command(store, kind, input) {
    const time = await timed(() => store.command(input, store.getInfo().revision));
    (commands[kind] ??= []).push(time);
  }
  try {
    // Warm command code with tiny independent state; no measured group is closed.
    let warm = createGroupState([{ id: 'warm', name: 'Synthetic warmup' }], registry);
    warm = applyValidatedCommand(warm, { type: 'set-note', memberId: 'warm', chunkId: '10000', note: 'warm' }, { registry, world, now: clock });
    applyValidatedCommand(warm, { type: 'undo' }, { registry, world, now: clock });
    warm = undefined;
    const warmStore = await openStore({ dataDir: path.join(output, mode, 'warm-store'), registry, world,
      initialState: createGroupState([{ id: 'warm', name: 'Synthetic warmup' }], registry), now: clock });
    await warmStore.command({ type: 'set-note', memberId: 'warm', chunkId: '10000', note: 'warm' }, 0);
    await warmStore.command({ type: 'undo' }, 1);
    await warmStore.close();
    const baselineMemory = await gc();
    for (let i = 0; i < 50; i++) {
      let store;
      opens.push(await timed(async () => { store = await openStore({ dataDir: fixture.directories[i], registry, world,
        retention: { backupDays: 90, historyEntries: 1000 }, now: clock,
        taskCatalogue: new Map([[`rs3:task:spike-generated-${i}`, { id: `rs3:task:spike-generated-${i}`,
          label: `Synthetic generated objective ${i}`, category: 'Synthetic', aliases: [`generated-alias-${i}`] }]]) }); }));
      handles.push(store);
      if (mode !== 'A') proto.assertShared(store._spikeState());
      openSamples.push(await gc());
      if ((i + 1) % 10 === 0) console.log(`${mode}: ${i + 1} handles open; heap ${(openSamples.at(-1).heapUsed / MiB).toFixed(1)} MiB`);
    }
    const openMemory = openSamples.at(-1);
    for (let i = 0; i < 50; i++) {
      const store = handles[i], taskId = base.tasks[i + 2].id;
      await command(store, 'tick', { type: 'complete-task', memberId: 'member-0', taskId, completed: true });
      await command(store, 'note', { type: 'set-note', memberId: 'member-0', chunkId: '10000', note: `Synthetic measured note ${i}` });
      await command(store, 'undo', { type: 'undo' });
      await command(store, 'generated', { type: 'complete-task', memberId: 'member-0', taskId: `rs3:task:spike-generated-${i}`, completed: true });
      if (mode !== 'A') proto.assertShared(store._spikeState());
      assert(!Object.hasOwn(base.identityRegistry.entries, `rs3:task:spike-generated-${i}`), 'Shared base mutated');
      commandSamples.push(await gc());
      if ((i + 1) % 10 === 0) console.log(`${mode}: ${i + 1} groups exercised; heap ${(commandSamples.at(-1).heapUsed / MiB).toFixed(1)} MiB`);
    }
    // Cross-group overlap with every handle alive; CPU is batch CPU, not an
    // invalid sum of overlapping per-command process.cpuUsage measurements.
    const simultaneous = await timed(() => Promise.all(handles.map((store, i) => store.command({ type: 'set-note',
      memberId: 'member-1', chunkId: '10001', note: `Synthetic concurrent note ${i}` }, store.getInfo().revision))));
    const beforeRepeatMemory = await gc();
    const repeated = [];
    for (const [i, store] of handles.entries()) {
      repeated.push(await timed(async () => {
        await store.command({ type: 'set-note', memberId: 'member-2', chunkId: '10002', note: `Synthetic repeat ${i}` }, store.getInfo().revision);
        await store.command({ type: 'undo' }, store.getInfo().revision);
      }));
    }
    const finalMemory = await gc();
    // Expensive final full validation and hashes are outside measurement, and
    // happen while ALL stores are still open. Flatten C only at this boundary.
    for (const store of handles) {
      const state = JSON.parse(JSON.stringify(await store._spikeLogical()));
      validateOwnedState(state, registry);
      assert.equal(state.members.length, 4);
      assert.equal(state.tasks.length, 24002);
      assert(state.members[0].completedTasks.includes(state.tasks.at(-1).id));
      finalHashes.push({ state: sha(JSON.stringify(state)), history: sha(JSON.stringify(state.history)) });
    }
    const perGroup = openSamples.map((m, i) => m.heapUsed - (i ? openSamples[i - 1].heapUsed : baselineMemory.heapUsed)
      + commandSamples[i].heapUsed - (i ? commandSamples[i - 1].heapUsed : openMemory.heapUsed));
    // Post-batch cache/History growth is charged evenly, not hidden as shared.
    const finalAdjustment = (finalMemory.heapUsed - commandSamples.at(-1).heapUsed) / 50;
    const attributed = perGroup.map(bytes => bytes + finalAdjustment);
    const cumulative = [0];
    for (const bytes of attributed) cumulative.push(cumulative.at(-1) + bytes);
    const retainedHeapBytes = { ...stats(attributed), slope: slope(cumulative),
      mean: (finalMemory.heapUsed - baselineMemory.heapUsed) / 50 };
    const decision = { targetMet: retainedHeapBytes.p95 <= 5 * MiB && retainedHeapBytes.max <= 15 * MiB && retainedHeapBytes.mean <= 5 * MiB,
      rejected: retainedHeapBytes.max > 15 * MiB || finalMemory.heapUsed - baselineMemory.heapUsed > 750 * MiB };
    const summarizeTime = rows => ({ wallMs: stats(rows.map(row => row.wallMs)), cpuMs: stats(rows.map(row => row.cpuMs)) });
    const result = { mode, fixtureHash: fixture.hash, finalHashes, sourceHashes,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      host: { platform: process.platform, architecture: process.arch, node: process.version, v8: process.versions.v8.split('.').slice(0, 2).join('.'),
        cpu: cpus()[0]?.model, logicalCPUs: cpus().length, totalMemory: totalmem(), freeMemoryAtEnd: freemem() },
      shape: { groups: 50, tasks: 24000, aliases: 100000, members: 4, hotHistory: 1000, archivedEvents: 200, archiveSegments: 2, seed: 'owned-format2-memory-spike-v1' },
      baselineMemory, openMemory, finalMemory, observedPeakMemory: peak, openSamples, commandSamples,
      retainedHeapBytes, attributedHeapBytes: attributed, decision,
      open: summarizeTime(opens), commands: Object.fromEntries(Object.entries(commands).map(([key, rows]) => [key, summarizeTime(rows)])),
      simultaneous, repeat: { ...summarizeTime(repeated), retainedBytes: finalMemory.heapUsed - beforeRepeatMemory.heapUsed },
      scope: 'Actual openStore, validation, archives, command kernel, backups and fsync. Commit/ack only; no HTTP response, server context, calculator or browser cache. No child workers.',
      caveats: ['Per-group figures are paired post-GC deltas, not heap dominators; first-group/JIT noise is visible in raw samples.',
        'B is an optimistic owner-only flat lower bound: private mutable dictionary containers, frozen shared entries; concurrent historical snapshots are untested.',
        'B/C prototype compact writes cannot be reopened by production; durability format correctness is outside this spike.'] };
    await writeFile(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(`${mode}: p95 ${(retainedHeapBytes.p95 / MiB).toFixed(2)} MiB/group; target ${decision.targetMet}; rejected ${decision.rejected}`);
  } finally {
    for (const store of handles) await store.close();
    hook.deregister();
  }
}

async function prepareFixture({ base, createGroupState, applyValidatedCommand, registry, world, clock, output, mode }) {
  const directory = path.join(output, mode);
  await mkdir(directory);
  const shared = path.join(directory, 'shared'); await mkdir(shared);
  const identities = JSON.stringify(base.identityRegistry), identityHash = sha(identities);
  const identityFile = path.join(shared, `static-${identityHash}.json.gz`);
  await writeFile(identityFile, gzipSync(identities, { level: 1 }));
  let template = createGroupState(Array.from({ length: 4 }, (_, i) => ({ id: `member-${i}`, name: `Synthetic member ${i + 1}`,
    journal: `Synthetic journal ${i}. `.repeat(400), unlocked: ['10000'] })), registry);
  // Real note commands produce guarded Undo, rather than invented History rows.
  for (let i = 0; i < 1200; i++) template = applyValidatedCommand(template, { type: 'set-note',
    memberId: `member-${i % 4}`, chunkId: String(10000 + i % 32), note: `Synthetic historical note ${i}` }, { registry, world, now: clock });
  const archiveNames = [];
  for (let i = 0; i < 2; i++) {
    const events = template.history.slice(i * 100, (i + 1) * 100);
    const id = `history-${String(events[0].revision).padStart(16, '0')}-${String(events.at(-1).revision).padStart(16, '0')}-${'0'.repeat(15)}${i}.json.gz`;
    await writeFile(path.join(shared, id), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events }), { level: 1 }));
    archiveNames.push(id);
  }
  template.history = template.history.slice(200);
  const directories = [];
  let hash;
  for (let i = 0; i < 50; i++) {
    const group = path.join(directory, `synthetic-group-${i}`);
    await mkdir(group); await mkdir(path.join(group, 'static')); await mkdir(path.join(group, 'history'));
    await link(identityFile, path.join(group, 'static', path.basename(identityFile)));
    for (const id of archiveNames) await link(path.join(shared, id), path.join(group, 'history', id));
    const tasks = [...base.tasks];
    tasks[0] = { ...tasks[0], memberIds: [`member-${i % 4}`] };
    tasks.push({ id: `custom:synthetic-${i}`, label: `Synthetic custom task ${i}`, category: 'Synthetic', memberIds: ['member-0'] });
    const taskBytes = JSON.stringify(tasks), taskHash = sha(taskBytes), taskId = `static-${taskHash}.json.gz`;
    await writeFile(path.join(group, 'static', taskId), gzipSync(taskBytes, { level: 1 }));
    const state = { ...template, provenance: { syntheticGroup: i, historyArchive: archiveNames.map(id => ({ id })) } };
    // A referenced static field must be absent from the inline state.
    delete state.tasks;
    delete state.identityRegistry;
    const document = { format: 'rs3-chunk-picker', schemaVersion: 1, state,
      storage: { schemaVersion: 1, fields: { tasks: { id: taskId, sha256: taskHash },
        identityRegistry: { id: path.basename(identityFile), sha256: identityHash } } } };
    for (const key of Object.keys(document.storage.fields)) assert(!Object.hasOwn(state, key));
    assert.equal(state.history.length, 1000);
    assert.equal(state.members.length, 4);
    if (i === 0) hash = sha(JSON.stringify(document));
    await writeFile(path.join(group, 'state.json'), JSON.stringify(document) + '\n');
    directories.push(group);
  }
  return { directories, hash };
}

function chart(results) {
  const max = Math.max(16, ...results.map(r => r.retainedHeapBytes.max / MiB));
  const bars = results.map((r, i) => {
    const value = r.retainedHeapBytes.p95 / MiB;
    return `<text x="25" y="${55 + i * 60}">${r.mode}</text><rect x="70" y="${35 + i * 60}" width="${value / max * 570}" height="30" fill="var(--chart-${i + 1})"/><text x="${78 + value / max * 570}" y="${55 + i * 60}">${value.toFixed(2)} MiB</text>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Owned format 2 memory spike</title><style>:root{--foreground:light-dark(#203248,#e0e8ef);--chart-1:#748daa;--chart-2:#d49a58;--chart-3:#53a98f;--success:#53a98f;--destructive:#dc7777}body{font:16px var(--font-sans,system-ui);margin:0;color:var(--foreground)}text{font:16px var(--font-sans,system-ui);fill:var(--foreground)}svg{height:240px;width:100%}</style><p><strong>Retained heap per group, p95</strong></p><p>One fresh-process comparison; 50 synthetic stores kept open. Target 5 MiB; reject above 15 MiB. Shared baseline excluded.</p><svg viewBox="0 0 850 240" role="img" aria-label="Post-GC retained heap per synthetic group">${bars}<path d="M ${70 + 5 / max * 570} 20 V 220" stroke="var(--success)" stroke-dasharray="5 5"/><path d="M ${70 + 15 / max * 570} 20 V 220" stroke="var(--destructive)" stroke-dasharray="5 5"/></svg><p>A: current format 1. B: flat shared objects with private dictionaries. C: sparse identity CatalogueView, measured only when B misses.</p><p>Commit/ack timings and raw memory checkpoints are in results.json. Server contexts and calculator heaps are outside this store-only experiment.</p>`;
}
