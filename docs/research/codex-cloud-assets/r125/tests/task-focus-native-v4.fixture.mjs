// No application import precedes environment admission. Parent sanitizes before fork.
import assert from 'node:assert/strict';
import { operationTracker } from './task-focus-native.diagnostic.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, realpath, readdir } from 'node:fs/promises';
const tracker = operationTracker(record => {
  if (process.connected) try { process.send({ type: 'r125-fixture-diagnostic', record }, () => {}); } catch {}
}, 'fixture-failure');
const startupAbort = new AbortController();
let app, startup, stopping, stopRequested = false, failed = false;
const report = message => process.stderr.write(`native fixture: ${message}\n`);
function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected) return reject(new Error('controller disconnected'));
    process.send(message, error => error ? reject(error) : resolve());
  });
}
function stop(code = 0) {
  stopRequested = true; failed ||= code !== 0;
  startupAbort.abort(new Error('fixture stopping'));
  if (stopping) return stopping;
  stopping = (async () => {
    const deadline = setTimeout(() => {
      report('shutdown deadline exceeded; failed; outer guard must drain descendants');
      process.exit(1);
    }, 6000);
    try {
      await startup?.catch(() => {});
      await app?.close();
      if (process.connected) await send({ type: 'stopped', pid: process.pid, ok: !failed });
    } catch { failed = true; report('shutdown failed'); }
    finally {
      clearTimeout(deadline);
      process.exitCode = failed ? 1 : 0;
      // Natural exit leaves leaked handles visible to the controller's drain.
      if (process.connected) process.disconnect();
    }
  })();
  return stopping;
}
process.on('message', message => { if (message === 'stop') void stop(); });
process.once('disconnect', () => { void stop(); });
process.once('SIGTERM', () => { void stop(1); });
process.once('SIGINT', () => { void stop(1); });
const checkRunning = () => { if (stopRequested || !process.connected) throw new Error('fixture stopping'); };
async function absent(filename) {
  try { await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('optional/default input path must be absent');
}
async function admit() {
  assert.equal(process.env.R78_NATIVE, '1', 'native authorization required');
  assert.equal(typeof process.send, 'function', 'owned IPC fixture required');
  checkRunning();
  // Preloads already execute before this file. Reject rather than hide hooks.
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE']) {
    assert.ok(!process.env[key], `unreviewed ${key}; sanitize before fork`);
    delete process.env[key];
  }
  assert.deepEqual(process.execArgv, ['--max-old-space-size=768'],
    'unreviewed fixture execArgv; exactly the reviewed heap bound is admitted');
  assert.ok(!process.env.RS3_WORKER_MEMORY_PROBE_IMPORT,
    'worker probe import requires separate admission; sanitize before fork');
  const selectors = new Set(['RS3_DATASET', 'RS3_TASK_WORKER_MODE', 'RS3_DATASET_PROFILE',
    'RS3_DATASET_PROFILE_SHA256', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PRIVATE_ADDON',
    'RS3_PRIVATE_ADDON_SHA256', 'RS3_PERF_STATE', 'RS3_PERF_COMPANION_ROOT', 'RS3_GAME_DATA_DIR',
    'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN',
    'RS3_LOOPBACK_PORT', 'RS3_RESOURCE_CONTENTS', 'RS3_ARCHAEOLOGY_CONTENTS', 'RS3_CACHE_SHOP_CONTENTS',
    'RS3_WORKER_MEMORY_PROBE_IMPORT']);
  for (const key of Object.keys(process.env).filter(key => key.startsWith('RS3_'))) {
    assert.ok(selectors.has(key), `unreviewed ${key}; explicit admission required`);
    delete process.env[key];
  }
  const requested = process.argv[2];
  assert.ok(requested && path.isAbsolute(requested), 'absolute disposable directory required');
  const dir = path.resolve(requested);
  assert.equal(await realpath(dir), dir, 'run directory must have no symlink aliases');
  assert.ok((await lstat(dir)).isDirectory());
  assert.equal((await readdir(dir)).length, 0, 'fresh empty run directory required');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const relative = path.relative(root, dir);
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'run directory must be outside source');
  // The public tree legitimately tracks .local/release-pc.example.json.
  // Reject input/storage roots, rather than rejecting that benign example.
  for (const name of ['packs', 'duo', 'open-starter', 'game-data', 'map-assets', 'world-images',
    'terrain-assets', 'icon-assets']) await absent(path.join(root, '.local', name));
  const optional = path.join(dir, 'absent-inputs');
  await absent(optional);
  Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process',
    RS3_PACKS_DIR: optional, RS3_PACK_SELECTION: path.join(optional, 'selection.json'),
    RS3_GAME_DATA_DIR: optional, RS3_MAP_ASSETS_DIR: optional,
    RS3_TERRAIN_ASSETS_DIR: optional, RS3_ICON_ASSETS_DIR: optional });
  return { dir, optional };
}
startup = (async () => {
tracker.mark('fixture-environment'); const { dir, optional } = await admit();
checkRunning();
tracker.mark('fixture-app-import'); const { createServer } = await import('../app/server.mjs');
checkRunning();
tracker.mark('fixture-state-import'); const { createGroupState } = await import('../app/core/state.mjs');
tracker.mark('fixture-dataset-import'); const { selectedDataset } = await import('../app/dataset-runtime.mjs');
checkRunning();
tracker.mark('fixture-dataset-identity'); const identity = selectedDataset.status();
assert.equal(selectedDataset.datasetId, 'duo-legacy');
assert.equal(selectedDataset.packed, false, 'public tracked dataset required');
assert.equal(identity.version, 'tracked');
tracker.mark('fixture-state-build'); const members = ['alpha', 'beta'].map(id => ({ id, name: id === 'alpha' ? 'Alpha' : 'Beta', preferences: { setupGuide: 'skipped', hideChecked: false } }));
const initialState = createGroupState(members);
initialState.tasks = members.flatMap(owner => Array.from({ length: 75 }, (_, i) => ({
  id: `custom:r68-${owner.id}-${String(i + 1).padStart(3, '0')}`,
  label: `${owner.name} task ${String(i + 1).padStart(3, '0')}`, category: 'Custom', memberIds: [owner.id],
})));
tracker.mark('fixture-server-create'); app = await createServer({ dataDir: dir, initialState,
  definitions: { chunks: {}, walkableChunks: [], walkableChunksF2P: [], challenges: {} }, taskMap: {},
  port: 0, host: '127.0.0.1', predictionPrewarm: false, shutdownDeadlineMs: 3000,
  startupSignal: startupAbort.signal,
  packsDir: optional, packSelection: path.join(optional, 'selection.json'),
  gameDataDir: optional, mapAssetsDir: optional, terrainAssetsDir: optional, iconAssetsDir: optional,
  worldImagesRoot: optional,
});
checkRunning();
tracker.mark('fixture-server-listen'); await app.listen();
checkRunning();
tracker.mark('fixture-ready-send'); await send({ type: 'ready', invite: app.inviteUrl, pid: process.pid, mode: 'process',
  dataset: { id: identity.id, version: identity.version, digest: identity.digest,
    contractVersion: identity.contractVersion, packed: false } });
})();
startup.catch(error => {
  tracker.fail(error);
  if (!stopRequested) { failed = true; report('startup/admission failed'); }
  void stop(failed ? 1 : 0);
});
