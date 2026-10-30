import test from 'node:test';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuleRegistry, createRollPoolCache, evaluateRollPool, partnerConnections, checkedPrecomputedRollPool } from '../app/core/rules.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { captureProgressSnapshot } from '../app/core/progress-timeline.mjs';
import { createProgressQuestPoints } from '../app/helper-progress.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createServer } from '../app/server.mjs';
import { applySandboxChanges } from '../app/sandbox.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { emptyMetadataDataset } from './helpers/server-dataset.mjs';

const ids = ['12341', '12342', '12343', '12344'];
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, {}])), walkableChunks: ids,
  walkableChunksF2P: ids, challenges: { Quest: { Example: { Chunks: [ids[0]] } } } };
const registry = createRuleRegistry();
const world = buildWorld(definitions);
function fixture() {
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: [ids[0]] }, { id: 'two', name: 'Two', unlocked: [ids[3]] }], registry);
  state.rules['roll.neighborMode'] = registry.get('roll.neighborMode').options.find(value => ['frontier', 'geometric'].includes(value));
  state.members[0].selected = [ids[1], ids[2]];
  return state;
}
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const cacheFor = (rules = registry, limit = 16) => createRollPoolCache(world, rules, { inputKey: createTaskReuseFingerprint(), limit });
function remember(cache, state, memberId = 'one') {
  return cache.set(state, memberId, { pool: evaluateRollPool(world, state, memberId, registry) });
}

test('pool cache reuses display revisions and invalidates every roll and task input, with bounded immutable entries', () => {
  const state = fixture(), cache = cacheFor(registry, 2), first = remember(cache, state);
  const display = { ...state, revision: state.revision + 1, history: [{ type: 'display' }],
    members: state.members.map(member => ({ ...member, notes: { [ids[0]]: 'A note' }, journal: 'A journal' })) };
  assert.equal(cache.get(display, 'one'), first);
  assert.throws(() => first.pool.eligible.push({ id: '99' }), TypeError);
  for (const [field, value] of Object.entries({ selected: [ids[3]], pendingRoll: [ids[1]], blacklisted: [ids[1]],
    unlocked: [ids[2]], taskRules: { 'Example rule': true }, sectionOverrides: { [ids[1] + '-0']: false },
    transportFacts: { flags: {} }, completedTasks: ['example'] })) {
    const changed = structuredClone(state); changed.members[0][field] = value;
    assert.equal(cache.get(changed, 'one'), undefined, field);
  }
  const peer = structuredClone(state); peer.members[1].selected.push(ids[2]);
  assert.equal(cache.get(peer, 'one'), undefined);
  const rules = { ...state, rules: { ...state.rules, 'roll.selected': false } };
  assert.equal(cache.get(rules, 'one'), undefined);
  const staticChange = { ...state, tasks: [{ id: 'example', category: 'Quest', label: 'Example' }] };
  assert.equal(cache.get(staticChange, 'one'), undefined);
  remember(cache, rules); remember(cache, staticChange);
  assert.equal(cache.get(state, 'one'), undefined, 'oldest input evicted');
});

test('precomputed draws match inline commands, and revision/member/world/registry/input mismatches fall back safely', () => {
  const state = fixture(), cache = cacheFor(); remember(cache, state);
  const token = cache.prepare(state, 'one');
  const options = { world, registry, now: '2026-01-01T00:00:00.000Z' };
  assert.ok(checkedPrecomputedRollPool(token, world, state, 'one', registry));
  for (const count of [1, 2]) for (const value of [0, 0.25, 0.999]) {
    const command = { type: 'roll', memberId: 'one', count };
    let inlineDraws = 0, preparedDraws = 0;
    const inline = applyCommand(state, command, { ...options, random: () => { inlineDraws++; return value; } });
    const prepared = applyCommand(state, command, { ...options, precomputedPool: token, random: () => { preparedDraws++; return value; } });
    assert.equal(canonical(prepared), canonical(inline)); assert.equal(preparedDraws, inlineDraws);
  }
  const changed = structuredClone(state); changed.members[0].blacklisted.push(ids[1]);
  for (const [input, map, memberId, rules] of [[{ ...state, revision: 1 }, world, 'one', registry],
    [changed, world, 'one', registry], [state, buildWorld(definitions), 'one', registry],
    [state, world, 'two', registry], [state, world, 'one', createRuleRegistry()]]) {
    assert.equal(checkedPrecomputedRollPool(token, map, input, memberId, rules), undefined);
  }
  assert.equal(checkedPrecomputedRollPool({ pool: { eligible: [] } }, world, state, 'one', registry), undefined);
  const command = { type: 'roll', memberId: 'one', count: 1 };
  assert.deepEqual(applyCommand(changed, command, { ...options, precomputedPool: token, random: () => 0 }),
    applyCommand(changed, command, { ...options, random: () => 0 }));
});

test('custom hook caches include fields outside ordinary task input', () => {
  const custom = createRuleRegistry([{ id: 'custom', type: 'boolean', default: true, label: 'Custom', description: 'Fixture hook',
    candidates: ({ state }) => [{ id: ids[1], detail: String(state.revision) }] }]);
  const state = fixture(), cache = cacheFor(custom);
  cache.set(state, 'one', { pool: evaluateRollPool(world, state, 'one', custom) });
  assert.equal(cache.get({ ...state, revision: 1 }, 'one'), undefined);
});

test('calculator roll-pool matches inline canonical JSON for members, input changes, serialized snapshots and sandbox drafts', async t => {
  const scheduler = await createTaskScheduler({ workerData: genericWorkerData({ definitions, world: { ...world } }) });
  t.after(() => scheduler.close());
  assert.equal(scheduler.supports('roll-pool'), true);
  const state = fixture(), changes = { unlockChunks: [ids[1]], lockChunks: [], doneTasks: [] };
  const states = [state, { ...state, revision: 1 }, { ...state, members: state.members.map(member => ({ ...member, blacklisted: [ids[2]] })) }];
  let sequence = 0;
  const fixtureHash = createHash('sha256');
  for (const input of states) for (const member of input.members) {
    const key = 'fixture-' + sequence++, bytes = Buffer.from(JSON.stringify(input)), shared = new SharedArrayBuffer(bytes.length);
    Buffer.from(shared).set(bytes);
    const result = await scheduler.evaluate({ revision: input.revision, members: input.members.map(({ id }) => ({ id })) }, member.id,
      'roll-pool', undefined, key, key, undefined, [], 'full', { stateJSON: shared, inputKey: key });
    assert.equal(canonical(result.result.pool), canonical(evaluateRollPool(world, input, member.id, registry)));
    fixtureHash.update(canonical(result.result.pool)).update('\n');
    assert.deepEqual(result.result.partnerConnections, partnerConnections(world, input, member.id, registry));
  }
  const draft = await scheduler.evaluate(state, 'one', 'roll-pool', { changes }, 'draft', 'draft');
  const hypothetical = applySandboxChanges(state, 'one', changes, []);
  assert.equal(canonical(draft.result.pool), canonical(evaluateRollPool(world, hypothetical, 'one', registry)));
  fixtureHash.update(canonical(draft.result.pool)).update('\n');
  t.diagnostic(JSON.stringify({ pools: sequence + 1, differences: 0, sha256: fixtureHash.digest('hex') }));
  // An unsaved hypothetical revision must not supersede the live map's work.
  const live = await scheduler.evaluate(state, 'one', 'death-estimates', undefined, 'live-after-hypothetical', 'live', undefined, []);
  assert.equal(live.result.stateRevision, state.revision); assert.equal(live.result.cancelled, false);
});

test('HTTP pool reuse survives display saves; a roll uses the same draw and state as the inline command', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roll-pool-test-'));
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const initialState = fixture(); initialState.members[1].id = '__proto__';
  app = await createServer({ dataset: await emptyMetadataDataset(), dataDir, port: 0, definitions, taskMap: {},
    initialState, registry, random: () => 0.25, now: '2026-01-01T00:00:00.000Z', predictionPrewarm: false });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  async function request(route, body) {
    const response = await fetch(origin + route, { headers: { Authorization: `Bearer ${app.store.getAccessToken()}`,
      Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200); return response.json();
  }
  const initial = await request('/api/state?view=play-v1');
  const beforeCount = (await request('/api/diagnostics')).counts.completed;
  await request('/api/command?view=play-v1', { expectedRevision: initial.state.revision,
    command: { type: 'set-note', memberId: 'one', chunkId: ids[0], note: 'Display only' } });
  assert.equal((await request('/api/diagnostics')).counts.completed, beforeCount, 'display save does not request a pool');
  const before = app.store.getState(), command = { type: 'roll', memberId: 'one', count: 1 };
  assert.equal(typeof beforeCount, 'number');
  const expected = captureProgressSnapshot(applyCommand(before, command, { registry, world: app.world, random: () => 0.25,
    actor: before.history.at(-1).actor, now: '2026-01-01T00:00:00.000Z' }),
    { questPoints: createProgressQuestPoints(definitions), at: '2026-01-01T00:00:00.000Z' });
  await request('/api/command?view=play-v1', { expectedRevision: before.revision, command });
  assert.equal(canonical(app.store.getState()), canonical(expected));
  const restored = await request('/api/restore', { expectedRevision: app.store.getInfo().revision, backup: await app.store.backup() });
  assert.equal(Object.hasOwn(restored.pools, '__proto__'), true, 'pool dictionaries preserve all valid member IDs');
});


test('a save while a sandbox pool is awaiting the calculator refuses the stale response', { timeout: 15000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roll-pool-race-'));
  let app, release, held;
  const blocked = new Promise(resolve => { held = resolve; });
  t.after(async () => { release?.(); await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  app = await createServer({ dataset: await emptyMetadataDataset(), dataDir, port: 0, definitions, taskMap: {},
    initialState: fixture(), registry, predictionPrewarm: false, taskWorkerOptions: { workerFactory(data) {
      const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: data });
      const send = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        if (message.type === 'roll-pool' && message.draft !== undefined) {
          const { chunkId, ...request } = message; release = () => send(request); held();
        }
        else send(message);
      };
      return worker;
    } } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST', body: JSON.stringify(body), headers: {
    Authorization: `Bearer ${app.store.getAccessToken()}`, Origin: origin, 'Content-Type': 'application/json' } });
  const pending = post('/api/sandbox/evaluate', { memberId: 'one', baseRevision: app.store.getInfo().revision,
    changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } });
  await blocked;
  const saved = await post('/api/command?view=play-v1', { expectedRevision: app.store.getInfo().revision,
    command: { type: 'set-note', memberId: 'one', chunkId: ids[0], note: 'Concurrent save' } });
  assert.equal(saved.status, 200); await saved.arrayBuffer();
  release(); release = undefined;
  const response = await pending; assert.equal(response.status, 409); await response.arrayBuffer();
});


test('mutable command response pools cannot alter a cache reused by a later display save', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roll-pool-response-'));
  const store = await openStore({ dataDir, initialState: fixture(), world, registry });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const command = { type: 'set-note', memberId: 'one', chunkId: ids[0], note: 'First' };
  const first = await store.commandSerialized(command, 0);
  const expected = evaluateRollPool(world, store.getState(), 'one', registry);
  first.pools.one.eligible.length = 0;
  const second = await store.commandSerialized({ ...command, note: 'Second' }, 1);
  assert.deepEqual(second.pools.one, expected);
});
