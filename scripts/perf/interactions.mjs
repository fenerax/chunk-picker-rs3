import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { createServer as createNetServer } from 'node:net';
import { requireHeavyLock, selectCompanion, readScratchState, seededRandom } from './inputs.mjs';

await requireHeavyLock();
for (const key of ['RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
const probe = createNetServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(8966, '127.0.0.1', resolve); });
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const output = path.resolve(process.argv[2] ?? 'var/perfwalk/interactions');
await mkdir(output, { recursive: true });
await selectCompanion(output);
const { state, sha256 } = await readScratchState(process.env.RS3_PERF_STATE);
// Match perfwalk: one owned chunk each, unchanged personal facts and rules.
for (const member of state.members) {
  member.unlocked = member.unlocked.slice(0, 1);
  member.selected = []; member.pendingRoll = [];
}
state.history = [];
const { createServer } = await import('../../app/server.mjs');
const app = await createServer({ dataDir: path.join(output, 'server'), initialState: state,
  port: 8966, host: '127.0.0.1', loopbackPort: undefined, publicOrigin: undefined,
  packsDir: process.env.RS3_PACKS_DIR, packSelection: process.env.RS3_PACK_SELECTION,
  predictionPrewarm: false, random: seededRandom(1729) });
const rows = [], responses = {};
let committedAt, targetRevision;
const unsubscribe = app.store.subscribe(({ revision }) => { if (revision === targetRevision) committedAt = performance.now(); });
try {
  await app.listen();
  const url = new URL(app.inviteUrl), token = url.pathname.slice('/join/'.length);
  const request = async (route, body) => {
    const response = await fetch(url.origin + route, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Scratch request failed: ${response.status}`);
    return response.json();
  };
  const [owner, peer] = app.store.getState().members.map(member => member.id);
  const lists = async () => {
    const revision = app.store.getInfo().revision;
    return Promise.all([
      request(`/api/tasks?memberId=${owner}&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`),
      request(`/api/tasks?memberId=${peer}&view=play-v1&lane=duo-v1&peerFor=${owner}&revision=${revision}`),
    ]);
  };
  responses.startup = await lists();
  const active = new Set((responses.startup[0].presentation?.tasks ?? []).map(row => typeof row === 'string' ? row : row.id));
  const task = responses.startup[0].tasks.find(row => active.has(row.id) && row.status === 'available' && row.obligation !== false && !row.hidden);
  if (!task) throw new Error('Scratch map has no tickable task.');
  const command = command => request('/api/command?view=play-v1', { expectedRevision: app.store.getInfo().revision, command });
  async function measure(name, edit, profile = false) {
    let session;
    if (profile) { session = new Session(); session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const started = performance.now();
    committedAt = undefined;
    targetRevision = app.store.getInfo().revision + 1;
    const saved = await command(edit), saveMs = performance.now() - started;
    const result = await lists(), wallMs = performance.now() - started;
    if (session) {
      const { profile } = await session.post('Profiler.stop'); session.disconnect();
      await writeFile(path.join(output, `${name}.cpuprofile`), JSON.stringify(profile));
    }
    responses[name] = result;
    rows.push({ name, saveMs, durableSaveMs: committedAt === undefined ? null : committedAt - started,
      groupRefreshMs: wallMs - saveMs, wallMs,
      members: result.map(value => ({ cache: value.cache, timingMs: value.timingMs, metrics: value.metrics })) });
    console.log(JSON.stringify({ name, saveMs, groupRefreshMs: wallMs - saveMs, wallMs }));
    return saved;
  }
  await measure('tick', { type: 'set-task-status', memberId: owner, taskId: task.id, challengeCompleted: true });
  await measure('untick', { type: 'set-task-status', memberId: owner, taskId: task.id, challengeCompleted: false });
  await measure('roll', { type: 'roll', memberId: owner, count: 2 });
  const pending = app.store.getState().members.find(member => member.id === owner).pendingRoll;
  if (!pending.length) throw new Error('Scratch roll has no pending choices.');
  await measure('unlock', { type: 'unlock-selection', memberId: owner, chunkId: pending[0] }, true);
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['revision', 'stateRevision', 'cache', 'timingMs', 'elapsedMs', 'evaluationMs'].includes(key)).map(([key, child]) => [key, normalize(child)]));
    return value;
  };
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ sha256, datasetDigest: selectedDataset.digest,
    dataset: { datasetId: selectedDataset.datasetId, digest: selectedDataset.digest, packed: selectedDataset.packed === true }, node: process.version, rows,
    hashes: Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, value.map(row => createHash('sha256').update(JSON.stringify(normalize(row))).digest('hex'))])) }, null, 2));
  console.log(JSON.stringify({ report: path.join(output, 'results.json') }));
  // Optional local evidence hook runs after every timed action has finished.
  if (process.env.RS3_PERF_CAPTURE_MODULE) {
    const { capture } = await import(pathToFileURL(process.env.RS3_PERF_CAPTURE_MODULE));
    await capture({ origin: url.origin, token, output });
  }
} finally { unsubscribe(); await app.close(); }
