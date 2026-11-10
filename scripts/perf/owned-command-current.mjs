// node scripts/perf/owned-command-current.mjs
// One before/after run, synthetic migrated data only; no existing saves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR',
  'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256']) delete process.env[key];
const { openStore } = await import('../../app/storage/store.mjs');
const { prepareOwnedPickerState, preserveGameIdentity } = await import('../../app/game-profile.mjs');
const { ownedCommandFixture, ownedCatalogue, ownedMigration, ownedCommandSequence, ownedDataset,
  ownedNow, ownedPickerId, ownedRegistry, ownedWorld } = await import('./owned-command-fixture.mjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const preparation = variant => {
  const check = prepareOwnedPickerState(ownedDataset, ownedRegistry(), ownedPickerId);
  // Dropping the proofs reproduces the old owned hook/wrapper's full path.
  return preserveGameIdentity(ownedDataset, variant === 'before' ? (state, context) => check(state, context) : check);
};
async function measure(work) {
  const cpu = process.threadCpuUsage(), started = performance.now();
  const value = await work();
  const elapsed = process.threadCpuUsage(cpu);
  return { value, wallMs: performance.now() - started, mainThreadCpuMs: (elapsed.user + elapsed.system) / 1000 };
}
const childIndex = process.argv.indexOf('--child');
if (childIndex >= 0) {
  const variant = process.argv[childIndex + 1], dataDir = process.argv[childIndex + 2];
  assert(['before', 'after'].includes(variant));
  const options = { dataDir, world: ownedWorld, prepareState: preparation(variant), migrateState: ownedMigration(ownedCatalogue()),
    now: ownedNow, retention: false };
  const original = await readFile(path.join(dataDir, 'state.json'));
  const { value: store, ...reopen } = await measure(() => openStore(options));
  try {
    assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), original, 'Current reopen must not rewrite storage');
    const commands = [];
    for (const command of ownedCommandSequence) {
      const { wallMs, mainThreadCpuMs } = await measure(async () => {
        const result = await store.commandSerialized(command, store.getInfo().revision, { omitUnchanged: true, view: 'play-v1' });
        // Include response serialization, as the command HTTP route does.
        return result.stateJSON.length;
      });
      commands.push({ type: command.type, wallMs, mainThreadCpuMs });
    }
    const state = store.getState();
    console.log(JSON.stringify({ reopen, commands, revision: state.revision, stateDigest: digest(state),
      historyDigest: digest(store.getHistory()) }));
  } finally { await store.close(); }
} else {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-command-perf-'));
  try {
    const { state, migrateState } = ownedCommandFixture();
    const seed = path.join(root, 'seed');
    const store = await openStore({ dataDir: seed, world: ownedWorld, initialState: state, migrateState,
      prepareState: preparation('after'), now: ownedNow, retention: false });
    const saved = store.getState();
    const size = { tasks: saved.tasks.length, aliases: Object.keys(saved.identityRegistry.aliases).length,
      stateBytes: Buffer.byteLength(JSON.stringify(saved)) };
    assert.equal(size.tasks, 24000);
    assert.equal(size.aliases, 91000);
    await store.close();
    const rows = {};
    for (const variant of ['before', 'after']) {
      const dataDir = path.join(root, variant);
      await cp(seed, dataDir, { recursive: true });
      rows[variant] = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', variant, dataDir],
        { encoding: 'utf8', timeout: 180000, windowsHide: true }));
    }
    assert.equal(rows.before.stateDigest, rows.after.stateDigest);
    assert.equal(rows.before.historyDigest, rows.after.historyDigest);
    assert.equal(rows.before.revision, rows.after.revision);
    console.log(JSON.stringify({ node: process.version, size, ...rows,
      limitation: 'Single sequential sample per variant; fresh-process store reopen with warm filesystem. Includes durable store and play response work; excludes dataset/calculator startup, HTTP and browser.' }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}
