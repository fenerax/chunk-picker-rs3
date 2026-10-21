import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../app/server.mjs';
import { performance } from 'node:perf_hooks';
import { buildWorld, surfaceCoordinates } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';

// Deterministic, realistic-size synthetic geography; never reads private saves.
// Retained topology still decides actual reachability and roll eligibility.
const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const world = buildWorld(definitions, { dataset: selectedDataset });
function nearby(home, count) {
  const origin = surfaceCoordinates(home);
  const distance = id => { const p = surfaceCoordinates(id); return Math.abs(p.x - origin.x) + Math.abs(p.y - origin.y); };
  return [...world.f2p].filter(id => world.surface.has(id)).sort((a, b) => distance(a) - distance(b) || Number(a) - Number(b)).slice(0, count);
}
const state = createGroupState([
  { id: 'player1', name: 'Player 1', unlocked: nearby('12342', 136) },
  { id: 'player2', name: 'Player 2', unlocked: nearby('12850', 113) },
]);
for (const owner of state.members) owner.taskRules = { 'Every Drop': true, 'Rare Drop Amount': '1/0' };
// The HTTP server has an isolated synthetic store and an ephemeral port. Both
// task lanes use retained definitions; the live picker and private saves are untouched.
const temporaryRoot = path.resolve('.local/death-verification/tmp');
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(path.join(temporaryRoot, 'http-benchmark-'));
let application;
const observations = [];
let heartbeatCount = 0, maxHeartbeatGapMs = 0, previousBeat = performance.now();
const heartbeat = setInterval(() => {
  const now = performance.now(); maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - previousBeat); previousBeat = now; heartbeatCount++;
}, 20);
try {
  const startupStarted = performance.now();
  application = await createServer({ dataDir: directory, definitions, taskMap: {}, initialState: state, port: 0 });
  await application.listen();
  const startupMs = performance.now() - startupStarted;
  const origin = `http://127.0.0.1:${application.address().port}`;
  const headers = { Authorization: `Bearer ${application.store.getAccessToken()}` };
  async function api(route) {
    const response = await fetch(`${origin}${route}`, { headers });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
    return result;
  }
  const standaloneTasks = new Map();
  for (const owner of state.members) {
    const started = performance.now();
    const tasks = await api(`/api/tasks?memberId=${owner.id}`);
    assert.equal(tasks.cache.hit, false);
    standaloneTasks.set(owner.id, { requestMs: Math.round(performance.now() - started),
      serverRequestMs: Math.round(tasks.cache.requestMs), workerMs: Math.round(tasks.cache.evaluationMs) });
  }
  // A synthetic note advances the conservative fingerprint and revision without
  // changing any eligibility. Contention requests cannot reuse these HTTP or
  // worker baseline results, so both comparisons contain real evaluations.
  await application.store.command({ type: 'set-note', memberId: state.members[0].id,
    chunkId: state.members[0].unlocked[0], note: 'Synthetic benchmark revision' }, application.store.getInfo().revision);
  for (const owner of state.members) {
    const route = `/api/death-estimates?memberId=${owner.id}`;
    const coldStarted = performance.now();
    let deathFinished = false;
    const batch = api(route).finally(() => { deathFinished = true; });
    // Avoid an unhandled rejection if a foreground assertion fails first.
    batch.catch(() => {});
    let diagnostic;
    do {
      diagnostic = await api('/api/diagnostics');
      if (deathFinished) throw new Error('The cold batch ended before contention could be measured.');
      if (diagnostic.deathLane.worker.ready && diagnostic.deathLane.queue.active) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (performance.now() - coldStarted < 30000);
    assert.equal(diagnostic.deathLane.worker.ready, true);
    assert.equal(diagnostic.deathLane.queue.active, 1);
    // Let the cold worker enter its synchronous baseline/candidate calculation.
    await new Promise(resolve => setTimeout(resolve, 100));
    const normalStarted = performance.now();
    const tasks = await api(`/api/tasks?memberId=${owner.id}`);
    const normalMs = performance.now() - normalStarted;
    const completedBeforeDeath = !deathFinished;
    assert.equal(tasks.cache.hit, false, 'Measure a cold evaluation rather than an HTTP cache hit');
    assert.equal(completedBeforeDeath, true, 'Normal tasks must finish before the active cold batch');
    const during = await api('/api/diagnostics');
    assert.equal(during.deathLane.queue.active, 1);
    const cold = await batch;
    const coldMs = performance.now() - coldStarted;
    const warmStarted = performance.now();
    const warm = await api(route);
    const cachedMs = performance.now() - warmStarted;
    assert.equal(cold.cancelled, false);
    assert.equal(warm.cache.hit, true);
    observations.push({ memberId: owner.id, ownedChunks: owner.unlocked.length, candidateCount: cold.candidateIds.length,
      coldMs: Math.round(coldMs), cachedMs: Math.round(cachedMs), workerMs: Math.round(cold.cache.evaluationMs),
      standaloneTasks: standaloneTasks.get(owner.id),
      normalTasks: { requestMs: Math.round(normalMs), workerMs: Math.round(tasks.cache.evaluationMs),
        serverRequestMs: Math.round(tasks.cache.requestMs),
        cacheHit: tasks.cache.hit, completedBeforeDeath, deathActiveAtCompletion: during.deathLane.queue.active,
        timingMs: tasks.timingMs ?? during.timingMs.last },
      deathTimingMs: (await api('/api/diagnostics')).deathLane.timingMs.last,
      deathCount: cold.estimates.filter(row => row.death).length,
      pricedObligations: cold.estimates.reduce((count, row) => count + row.breakdown.filter(duty => duty.hours !== null).length, 0),
      unknownObligations: cold.estimates.reduce((count, row) => count + row.unknown.length, 0), cache: warm.cache });
  }
  process.stdout.write(`${JSON.stringify({ fixture: 'Synthetic F2P maps with 136 / 113 owned chunks, full retained definitions; isolated HTTP server on an ephemeral port, no personal saves',
    startupMs: Math.round(startupMs), catalogueCount: application.store.getState().tasks.length, observations,
    mainThreadHeartbeat: { intervalMs: 20, heartbeatCount, maxGapMs: Math.round(maxHeartbeatGapMs) } }, null, 2)}\n`);
} finally {
  clearInterval(heartbeat);
  await application?.close();
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}`));
  await rm(resolved, { recursive: true, force: true });
}
