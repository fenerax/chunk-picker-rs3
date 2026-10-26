// Synthetic-only HTTP companion to request-path.mjs. A warmed calculator must
// receive a fresh gameplay revision, then Preview -> Unlock -> Tasks is timed.
// Run with the request-path-probe.mjs preload and a 3072 MiB heap.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const root = path.resolve(option('companion')), sourceRoot = path.resolve(option('root') ?? '.');
const load = file => import(pathToFileURL(path.join(sourceRoot, file)).href);
const receipt = JSON.parse(await readFile(path.join(root, 'companion.json'), 'utf8'));
const provenance = JSON.parse(await readFile(path.join(root, 'packs', 'duo-data', receipt.packs.data.version, 'provenance.json'), 'utf8'));
if (provenance.synthetic !== true || provenance.generator !== 'scripts/perf/scale-dataset.mjs') throw new Error('Only scale-dataset synthetic companions are accepted.');
Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(root, receipt.profile.path),
  RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(root, 'packs'), RS3_PACK_SELECTION: path.join(root, 'selection.json'),
  RS3_TASK_WORKER_MODE: 'process', RS3_WORKER_MEMORY_PROBE_IMPORT: new URL('./request-path-probe.mjs', import.meta.url).href });
process.env.RS3_REQUEST_PATH_LOG = option('output') + '.jsonl';
await writeFile(process.env.RS3_REQUEST_PATH_LOG, '');
const { selectedDataset } = await load('app/dataset-runtime.mjs');
assert.equal(selectedDataset.json('app/data/cache-walkability.2026-10-07.v1.json').summary.doors, 0);
const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const { createServer } = await load('app/server.mjs');
const { surfaceCoordinates } = await load('app/data/surface-grid.mjs');
const input = await loadDatasetInputs(selectedDataset);
const chunks = Object.keys(JSON.parse(input.definitionBytes.toString()).chunks).filter(id => surfaceCoordinates(id));
assert.ok(chunks.length >= 6);
const scratch = await mkdtemp(path.join(tmpdir(), 'rs3-request-path-'));
let app;
const report = { node: process.version, datasetDigest: selectedDataset.digest, requests: [] };
try {
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: chunks.slice(0, 3) }, { id: 'two', name: 'Two', unlocked: chunks.slice(0, 3) }]);
  app = await createServer({ dataDir: path.join(scratch, 'game'), initialState, port: 0, predictionPrewarm: false,
    mapAssetsDir: path.join(scratch, 'assets'), gameDataDir: path.join(scratch, 'game-data'),
    taskWorkerOptions: { idleMs: 600000, predictionDeadlineMs: 300000, deadlineMs: 300000 } });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin, auth = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = async (route, body) => {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(300000),
      headers: { ...auth, 'Accept-Encoding': 'identity', ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    assert.equal(response.status, 200, `${route}: ${text.slice(0, 1000)}`);
    const result = JSON.parse(text);
    // Keep every result row, order and cache counter except durations and
    // revision-dependent history timestamps; hashes never contain save data.
    const stable = JSON.stringify(result, (key, value) => /(?:Ms|elapsedMs)$/.test(key) || key === 'timingMs' ? undefined : value);
    return { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(stable).digest('hex') };
  };
  const tasks = '/api/tasks?memberId=one&view=play-v1';
  console.error('warm tasks'); await request(tasks);
  console.error('warm prediction'); await request(`/api/predict?memberId=one&chunkId=${chunks[3]}`);
  console.error('new gameplay revision');
  await request('/api/command?view=play-v1', { expectedRevision: 0, command: { type: 'set-chunk', memberId: 'one', chunkId: chunks[5], status: 'unlocked' } });
  await request(tasks);
  const snapshot = app.store.getCalculationSnapshot();
  report.stateJSONBytes = snapshot.stateJSON.byteLength;
  globalThis.gc?.();
  globalThis.__requestPath('actionStart'); const start = performance.now();
  const predictStart = performance.now();
  const prediction = await request(`/api/predict?memberId=one&chunkId=${chunks[4]}`);
  const previewMs = performance.now() - predictStart;
  globalThis.__requestPath('previewEnd');
  const commandStart = performance.now();
  // API Unlock is the same state transition as an accepted pending selection;
  // direct set-chunk keeps the synthetic case independent of random roll pools.
  const command = await request('/api/command?view=play-v1', { expectedRevision: 1, command: { type: 'set-chunk', memberId: 'one', chunkId: chunks[4], status: 'unlocked' } });
  const commandMs = performance.now() - commandStart;
  const tasksStart = performance.now(), result = await request(tasks), tasksMs = performance.now() - tasksStart;
  report.action = { totalMs: performance.now() - start, previewMs, commandMs, tasksMs, prediction, commandBytes: command.bytes, result };
  globalThis.__requestPath('actionEnd');
  report.serverPeakRSS = process.resourceUsage().maxRSS * 1024;
  // Size outside the measured action: this materialized snapshot is already
  // owned by the completed Preview, so diagnostics do not remove its clone cost.
  report.stateV8Bytes = serialize(snapshot.state).byteLength;
  report.events = (await readFile(process.env.RS3_REQUEST_PATH_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
  await writeFile(option('output'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report.action));
} finally { await app?.close(); await rm(scratch, { recursive: true, force: true }); }
