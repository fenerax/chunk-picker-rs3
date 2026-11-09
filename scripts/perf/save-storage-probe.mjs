// Synthetic storage study. No real saves, HTTP listeners, cleanup, or app edits.
// Run with Node 24 from this worktree. Results stay in a NEW ignored directory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants as osConstants, cpus, setPriority } from 'node:os';
import { gzipSync, constants } from 'node:zlib';
import { randomBytes, createHash } from 'node:crypto';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(path.resolve(process.cwd()), path.resolve(root), 'Run from the script checkout.');
assert.equal(process.argv.length, 2, 'No input save or output path is accepted.');
setPriority(osConstants.priority.PRIORITY_BELOW_NORMAL);
const output = path.join(root, '.local', `save-storage-probe-${Date.now()}-${randomBytes(4).toString('hex')}`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_')) delete process.env[key];
process.env.RS3_DATASET = 'open-starter';
process.env.RS3_PACKS_DIR = path.join(output, 'no-packs');
process.env.RS3_GAME_DATA_DIR = path.join(output, 'no-game-data');
process.env.RS3_MAP_ASSETS_DIR = path.join(output, 'no-assets');

// Wrap selected functions IN MEMORY. Source files and application behavior stay
// unchanged. Timings are inclusive; nested rows must not be added together.
const context = new AsyncLocalStorage();
let currentMetrics;
const empty = () => ({ calls: 0, wallMs: 0, cpuMs: 0 });
async function span(name, work) {
  if (!currentMetrics) return work();
  const metrics = currentMetrics, start = performance.now(), cpu = process.cpuUsage();
  try { return await context.run([...(context.getStore() ?? []), name], work); }
  finally {
    const row = metrics.spans[name] ??= empty(), used = process.cpuUsage(cpu);
    row.calls++; row.wallMs += performance.now() - start; row.cpuMs += (used.user + used.system) / 1000;
  }
}
globalThis[Symbol.for('save-storage-probe')] = span;
const storeURL = new URL('../../app/storage/store.mjs', import.meta.url).href;
const hook = registerHooks({ load(url, options, next) {
  const result = next(url, options);
  if (url !== storeURL) return result;
  let source = String(result.source);
  for (const name of ['retainBackup', 'serializedDiskState', 'compactHistory', 'pruneBackups', 'standaloneBackups',
    'retainedArchiveIndex', 'importStoredBackup', 'hydrateHistory']) {
    const token = `async function ${name}(`;
    assert.equal(source.split(token).length, 2, `Instrumentation anchor ${name}`);
    source = source.replace(token, `async function ${name}(...args) { return globalThis[Symbol.for('save-storage-probe')]('${name}', () => probe_${name}(...args)); }\n  async function probe_${name}(`);
  }
  const token = 'const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);';
  assert(source.includes(token));
  source = source.replace(token, `const probeGzip = promisify(gzip), probeGunzip = promisify(gunzip);
    const gzipAsync = (...args) => globalThis[Symbol.for('save-storage-probe')]('gzip', () => probeGzip(...args));
    const gunzipAsync = (...args) => globalThis[Symbol.for('save-storage-probe')]('gunzip', () => probeGunzip(...args));`);
  return { ...result, source };
} });
function count(name, amount = 1) {
  if (currentMetrics) currentMetrics.io[name] = (currentMetrics.io[name] ?? 0) + amount;
}
const original = Object.fromEntries(['open', 'readFile', 'stat', 'readdir', 'unlink', 'rename'].map(key => [key, fs[key]]));
for (const key of ['stat', 'readdir', 'unlink', 'rename']) fs[key] = async (...args) => {
  count(key); return original[key](...args);
};
fs.readFile = async (...args) => {
  const result = await original.readFile(...args); count('readFile'); count('readBytes', Buffer.byteLength(result)); return result;
};
fs.open = async (...args) => {
  const handle = await original.open(...args); count('open');
  const sync = handle.sync.bind(handle), write = handle.writeFile.bind(handle);
  handle.sync = async () => { count('syncAttempt'); return span('fsync', async () => {
    try { const result = await sync(); count('syncSuccess'); return result; }
    catch (error) { count(`syncError:${error.code}`); throw error; }
  }); };
  handle.writeFile = async (bytes, ...rest) => {
    count('writeFile'); count('writeBytes', Buffer.byteLength(bytes)); return span('writeFile', () => write(bytes, ...rest));
  };
  return handle;
};
syncBuiltinESMExports();
const { createGroupState, applyCommand, applyValidatedCommand, validateState } = await import('../../app/core/state.mjs');
const { createRuleRegistry } = await import('../../app/core/rules.mjs');
const { openStore } = await import('../../app/storage/store.mjs');
const { atomicWrite } = await import('../../app/storage/atomic-write.mjs');
const { buildWorld } = await import('../../app/data/world.mjs');
const { catalogue, syntheticWorld } = await import('./capacity/model.mjs');
const rules = createRuleRegistry(), data = catalogue({ chunks: 64, tasks: 500, dependencyDepth: 4, crossLinks: 1 });
const world = syntheticWorld(data, buildWorld), chunks = Object.keys(data.chunks);
const tasks = Array.from({ length: 500 }, (_, i) => ({ id: `synthetic:${i}`, label: `Synthetic task ${i}`, category: 'Synthetic' }));
const envelope = state => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function measure(work) {
  assert.equal(currentMetrics, undefined);
  const metrics = { spans: {}, io: {} }; currentMetrics = metrics;
  try { await span('total', work); } finally { currentMetrics = undefined; }
  return metrics;
}
function cpuSamples(work, count = 5) {
  work(); const samples = [];
  for (let i = 0; i < count; i++) {
    const at = performance.now(), cpu = process.cpuUsage(); work(); const used = process.cpuUsage(cpu);
    samples.push({ wallMs: performance.now() - at, cpuMs: (used.user + used.system) / 1000 });
  }
  return samples;
}
async function disk(dir) {
  const result = {};
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        const family = path.relative(dir, file).split(path.sep).slice(0, -1).join('/') || entry.name;
        const row = result[family] ??= { bytes: 0, files: 0 }; row.bytes += (await fs.stat(file)).size; row.files++;
      }
    }
  }
  await walk(dir); return result;
}
async function packHashes(dir) {
  const result = {};
  for (const name of await fs.readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    result[name] = sha(await fs.readFile(path.join(dir, name)));
  }
  return result;
}
const results = [];
for (const spec of [{ name: 'small', roster: 1, history: 12, snapshots: 12 },
  { name: 'typical', roster: 3, history: 200, snapshots: 60 },
  { name: 'grown', roster: 5, history: 1000, snapshots: 300 }]) {
  console.log(JSON.stringify({ phase: 'begin', ...spec }));
  const dataDir = path.join(output, spec.name), base = Date.UTC(2026, 0, 1);
  let clock = base, state = createGroupState(Array.from({ length: spec.roster }, (_, i) => ({
    id: i ? `member${i + 1}` : 'owner', name: `Synthetic ${i + 1}`, unlocked: chunks.slice(0, 32),
  })), rules);
  state.tasks = structuredClone(tasks);
  const snapshots = [];
  for (let i = 0; i < spec.history; i++) {
    if (i >= spec.history - spec.snapshots) snapshots.push(envelope(state));
    state = applyValidatedCommand(state, { type: 'set-note', memberId: state.members[i % spec.roster].id,
      chunkId: chunks[i % chunks.length], note: `Synthetic history ${i}` }, { registry: rules, world, now: base + i * 1000 });
  }
  state = validateState(state, rules);
  const cmd = { type: 'set-note', memberId: 'owner', chunkId: chunks[0], note: 'Synthetic measured note' };
  const baselineDigest = sha(JSON.stringify(state)), options = { registry: rules, world, now: base };
  const core = { applyCommand: cpuSamples(() => applyCommand(state, cmd, options)),
    applyValidatedCommand: cpuSamples(() => applyValidatedCommand(state, cmd, options)),
    validateState: cpuSamples(() => validateState(state, rules)) };
  assert.equal(sha(JSON.stringify(state)), baselineDigest);
  let store = await openStore({ dataDir, initialState: state, registry: rules, world, now: () => clock });
  try {
    // Seed real command preimages directly to isolate one retention pass. These
    // are synthetic valid envelopes, not copies of a real or default save.
    const seed = await measure(async () => {
      for (const [i, document] of snapshots.entries()) {
        const id = `${String(document.state.revision).padStart(16, '0')}-${i.toString(16).padStart(16, '0')}.json.gz`;
        const file = path.join(dataDir, 'backups', id);
        await atomicWrite(file, gzipSync(JSON.stringify(document), { level: constants.Z_BEST_SPEED }));
        const at = new Date(base + i * 12 * 3600000); await fs.utimes(file, at, at);
      }
    });
    // Three ordinary durable commands, each preserving one additional preimage.
    // Keep them recent during the first scan. No 50-write background pass fires.
    clock = base + spec.snapshots * 12 * 3600000;
    const commands = [];
    for (let i = 0; i < 3; i++) commands.push(await measure(() => store.command({ ...cmd, note: `Synthetic measured ${i}` }, store.getInfo().revision)));
    const before = await disk(dataDir);
    const retention = await measure(() => store.prepareSnapshot());
    assert.equal(store.getInfo().retention.failure, undefined);
    const firstPacks = await packHashes(path.join(dataDir, 'backups', 'archives'));
    // Advance the synthetic clock so every historical day is outside the hot
    // tier. Daily, first, latest, and pinned rules still apply unchanged.
    clock += 400 * 86400000;
    const agedRetention = await measure(() => store.prepareSnapshot());
    assert.equal(store.getInfo().retention.failure, undefined);
    const after = await disk(dataDir), packs = await packHashes(path.join(dataDir, 'backups', 'archives'));
    const repeatRetention = await measure(() => store.prepareSnapshot());
    assert.deepEqual(await packHashes(path.join(dataDir, 'backups', 'archives')), packs, 'An unchanged pass rewrote packs.');
    for (const [name, hash] of Object.entries(firstPacks)) assert.equal(packs[name], hash, 'A later pass rewrote an old pack.');
    const retained = await store.listBackups(); assert.equal(retained.length, spec.snapshots + 3);
    const portable = await store.backup(); assert.equal(portable.state.history.length, spec.history + 3);
    const sample = retained.find(row => row.revision === snapshots[2].state.revision);
    await assert.rejects(fs.stat(path.join(dataDir, 'backups', sample.id)), { code: 'ENOENT' });
    const restored = await store.readBackup(sample.id); assert.equal(restored.state.revision, sample.revision);
    await store.close(); store = undefined;
    const coldOpen = await measure(async () => { store = await openStore({ dataDir, registry: rules, world, now: () => clock }); });
    assert.equal(store.getInfo().retention.failure, undefined);
    await store.close(); store = undefined;
    results.push({ ...spec, core, seed, commands, before, retention, agedRetention, repeatRetention, coldOpen, after,
      retained: retained.length, stateBytes: Buffer.byteLength(JSON.stringify(state)), portableBytes: Buffer.byteLength(JSON.stringify(portable)),
      firstPackCount: Object.keys(firstPacks).length, finalPackCount: Object.keys(packs).length });
    console.log(JSON.stringify({ phase: 'done', name: spec.name, retentionMs: retention.spans.total.wallMs,
      agedMs: agedRetention.spans.total.wallMs, repeatMs: repeatRetention.spans.total.wallMs }));
  } finally { await store?.close(); }
}
hook.deregister();
for (const [key, value] of Object.entries(original)) fs[key] = value;
syncBuiltinESMExports();
const result = { node: process.version, platform: process.platform, cpu: cpus()[0].model,
  sourceSHA256: sha(await fs.readFile(new URL('../../app/storage/store.mjs', import.meta.url))),
  description: 'Inclusive instrumented wall/process CPU ms; logical bytes, not allocated blocks. Five core samples after warm-up. No HTTP server, real save, deletion, or full suite.',
  catalogue: { chunks: 64, tasks: 500, unlockedPerMember: 32 }, results };
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(path.join(output, 'results.json'));
