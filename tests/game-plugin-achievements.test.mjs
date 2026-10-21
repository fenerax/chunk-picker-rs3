import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { applyCommand, createGroupState } from '../app/core/state.mjs';

const snapshot = '0123456789abcdef', secondSnapshot = '1123456789abcdef';
const part = (part = 1, parts = 1, complete = [], id = snapshot) => ({ snapshot: id, part, parts, complete });
const task = (id, title, group = 'Easy') => ({ id, category: 'Diary', label: `~|Synthetic Achievements#${group}|~ ${title}` });
const identity = { admin: true };

// No HTTP server or live save. The controller uses a real revision-checked core
// command against synthetic state. All sidecars stay inside this worktree.
async function fixture(t, tasks = [task('diary:one', 'First Task'), task('diary:two', 'Second Task')]) {
  const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-achievement-test-', import.meta.url)));
  let at = Date.parse('2026-10-19T12:00:00Z'), input, output, seq = 0, controller, failCommand = false;
  const warnings = [];
  let state = createGroupState([{ id: 'a', name: 'Explorer 1' }, { id: 'b', name: 'Explorer 2' }]);
  state.tasks = tasks;
  const commands = [];
  const store = {
    getInfo: () => ({ revision: state.revision }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => null,
    command: async (command, expectedRevision) => {
      if (failCommand) throw Object.assign(new Error('Synthetic revision race'), { status: 409 });
      state = applyCommand(state, command, { expectedRevision, now: () => new Date(at).toISOString() });
      commands.push(structuredClone(command)); return state;
    },
  };
  let queue = Promise.resolve();
  async function start() {
    controller = await openGamePlugin({ dataDir, store, clock: () => at, world: { chunks: new Map() },
      registry: { resolve: () => ({}) }, questMapping: new Map(),
      serializeMutation: operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; },
      bodyJSON: async (_request, limit) => { assert.equal(limit, 16384); return input; },
      json: async (_request, _response, status, value) => { assert.equal(status, 200); output = value; }, checkRequestOrigin: () => {}, log: message => warnings.push(message),
    });
  }
  await start();
  const { key } = await controller.create(identity, { memberId: 'a', label: 'Synthetic plugin' });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function send(achievements, extra = {}, credential = key) {
    at += 1001; input = { v: 1, seq: ++seq, sentAt: new Date(at).toISOString(), position: { x: 50, z: 50, floor: 0 }, world: { id: 1, beta: false }, ...extra };
    if (achievements !== undefined) input.achievements = achievements;
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${credential}` } };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  async function status() {
    at += 1001;
    const request = { method: 'GET', url: '/api/plugin/v1/status', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  return { get controller() { return controller; }, get state() { return state; }, store, commands, key, send, status, dataDir, warnings,
    setFailure: value => { failCommand = value; },
    restart: async () => { await controller.close(); await start(); },
  };
}

test('achievement assembly is ordered, player-scoped, replaceable, and forgotten on restart', async t => {
  const f = await fixture(t);
  const fresh = await f.status();
  assert.deepEqual(fresh.accepts, ['achievements']); assert.equal(fresh.achievements, null);
  assert.deepEqual(Object.keys(fresh).sort(), ['v', 'accepts', 'achievements', 'player', 'chunkId', 'chunkName', 'state', 'activeTaskCount',
    'unlockedChunkCount', 'pendingProgress', 'seenAt', 'nearby', 'pickableCount', 'pendingRoll', 'partners'].sort());
  assert.equal((await f.send(part(2, 3))).achievements, null);
  const first = await f.send(part(1, 3, [[1, 'First Task', 0, 0]]));
  assert.deepEqual(first.achievements, { snapshot, received: 1, parts: 3 });
  assert.deepEqual((await f.send(part(1, 3))).achievements, first.achievements, 'Last received part repeats as a no-op');
  assert.deepEqual((await f.send(part(3, 3))).achievements, first.achievements);
  assert.equal((await f.send(part(2, 3))).achievements.received, 2);
  assert.equal((await f.send(part(1, 3))).achievements.received, 2, 'Older parts cannot restart the same assembly');
  const other = await f.controller.create(identity, { memberId: 'b', label: 'Second synthetic plugin' });
  assert.equal((await f.send(part(1, 2), {}, other.key)).achievements.received, 1);
  assert.equal((await f.status()).achievements.parts, 3);
  assert.deepEqual((await f.send(part(1, 2, [], secondSnapshot))).achievements, { snapshot: secondSnapshot, received: 1, parts: 2 });
  assert.equal((await f.send(part(2, 3))).achievements.snapshot, secondSnapshot, 'Old continuation is ignored');
  assert.equal((await f.send(part(2, 3, [], secondSnapshot))).achievements.received, 1, 'Parts count must match');
  assert.deepEqual((await f.send(part(2, 2, [], secondSnapshot))).achievements, { snapshot: secondSnapshot, received: 2, parts: 2 });
  assert.equal(f.state.history.length, 0, 'Empty set does not create a command');
  await f.restart();
  assert.equal((await f.status()).achievements, null);
  assert.equal((await f.send(part(2, 2))).achievements, null);
  assert.equal((await f.send(part(1, 2))).achievements.received, 1);
});

test('a complete live batch ticks once with provenance; normal Undo removes ticks and provenance', async t => {
  const f = await fixture(t), before = structuredClone(f.state.members);
  await f.send(part(1, 2, [[1, 'First Task', 0, 0]]));
  assert.equal(f.commands.length, 0);
  const complete = await f.send(part(2, 2, [[2, 'Second Task', 0, 0], [3, 'No task for this', 0, 0]]));
  assert.deepEqual(complete.achievements, { snapshot, received: 2, parts: 2 });
  assert.equal(complete.pendingProgress, false);
  assert.equal(f.commands.length, 1); assert.equal(f.state.history.length, 1);
  assert.equal(f.state.history[0].type, 'apply-game-progress'); assert.equal(f.state.history[0].source, 'game-plugin'); assert.equal(f.state.history[0].command.memberId, 'a');
  assert.deepEqual(f.state.members[0].completedTasks, ['diary:one', 'diary:two']);
  assert.deepEqual(f.state.members[0].achievementProgress['diary:one'], {
    title: 'First Task', achievementId: 1, source: 'game-plugin', memberId: 'a', fetchedAt: '2026-10-19T12:00:02.002Z',
  });
  const summary = f.controller.list(identity).keys[0].achievements;
  assert.equal(summary.completeCount, 3); assert.equal(summary.matchedTaskCount, 2); assert.equal(summary.unmatchedCount, 1); assert.equal(summary.lastTickedCount, 2); assert.ok(summary.lastTickedAt);
  await f.send(part(2, 2)); await f.send(part(1, 2));
  assert.equal(f.commands.length, 1);
  await f.store.command({ type: 'undo' }, f.state.revision);
  assert.deepEqual(f.state.members, before);
  await f.send(part(1, 2, [[1, 'First Task', 0, 0]]));
  assert.equal(f.commands.length, 2, 'A repeated completed snapshot does not re-tick after Undo');
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]], secondSnapshot));
  assert.equal(f.commands.length, 2, 'A new snapshot cannot reverse Undo');
  await f.send(part(2, 2, [[2, 'Second Task', 0, 0]]));
  assert.equal(f.commands.length, 2, 'Older completed snapshots also remain acknowledged');
});

test('beta, absent world and mixed-copy assemblies only propose their matches', async t => {
  for (const worlds of [[{ id: 2, beta: true }], [undefined], [{ id: 2, beta: true }, { id: 1, beta: false }], [undefined, { id: 1, beta: false }]]) {
    const f = await fixture(t);
    for (let i = 0; i < worlds.length; i++) await f.send(part(i + 1, worlds.length, i ? [] : [[1, 'First Task', 0, 0]]), { world: worlds[i] });
    assert.equal(f.commands.length, 0);
    const review = f.controller.review(identity, 'a');
    assert.equal(review.achievements.length, 1); assert.equal(review.achievements[0].title, 'First Task');
    assert.match(review.achievements[0].reason, /beta|world-unknown/);
    assert.equal(review.achievements[0].world, worlds.some(world => world?.beta) ? 'beta' : 'unknown');
    assert.equal((await f.status()).pendingProgress, true);
  }
});

test('unclear matches require a reviewed selection and apply through the checked batch command', async t => {
  const f = await fixture(t, [task('diary:one', 'Shared Task'), task('diary:two', 'Shared Task', 'Hard')]);
  await f.send(part(1, 1, [[42, 'Shared Task', 0, 0]]));
  assert.equal(f.commands.length, 0);
  const preview = f.controller.review(identity, 'a'), body = { previewId: preview.previewId, expectedRevision: preview.stateRevision };
  assert.equal(preview.achievements[0].reason, 'unclear'); assert.equal(preview.achievements[0].candidates.length, 2);
  assert.deepEqual(f.controller.findReview(identity, body, true).command.achievements, []);
  for (const achievements of [[{ achievementId: 42, taskId: 'not-reviewed' }], [{ achievementId: 41, taskId: 'diary:one' }],
    [{ achievementId: 42, taskId: 'diary:one', guessed: true }], [{ achievementId: 42, taskId: 'diary:one' }, { achievementId: 42, taskId: 'diary:two' }]]) {
    assert.throws(() => f.controller.findReview(identity, { ...body, achievements }, true), { status: 400 });
  }
  assert.throws(() => f.controller.findReview({ memberId: 'b' }, body, true), { status: 403 });
  assert.throws(() => f.controller.findReview(identity, { ...body, expectedRevision: 99 }, true), { status: 409 });
  const review = f.controller.findReview(identity, { ...body, achievements: [{ achievementId: 42, taskId: 'diary:two' }] }, true);
  await f.store.command(review.command, body.expectedRevision); await f.controller.finish('a');
  assert.deepEqual(f.state.members[0].completedTasks, ['diary:two']); assert.equal(f.state.history.length, 1);
  assert.equal(f.state.members[0].achievementProgress['diary:two'].achievementId, 42);
  assert.deepEqual(f.controller.review(identity, 'a'), { preview: null });
});

test('failed automatic commands keep a review; completed tasks never gain new provenance', async t => {
  const f = await fixture(t);
  await f.store.command({ type: 'complete-task', memberId: 'a', taskId: 'diary:two', completed: true }, 0);
  f.setFailure(true);
  const result = await f.send(part(1, 1, [[1, 'First Task', 0, 0], [2, 'Second Task', 0, 0]]));
  assert.equal(result.pendingProgress, true); assert.equal(f.commands.length, 1);
  assert.equal(f.state.members[0].achievementProgress, undefined);
  const preview = f.controller.review(identity, 'a');
  assert.equal(preview.achievements.length, 1); assert.equal(preview.achievements[0].reason, 'retry');
  assert.equal(preview.achievements[0].world, 'live');
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-achievements.json')), { code: 'ENOENT' }, 'Failed commands do not handle any IDs');
  f.setFailure(false);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0], [2, 'Second Task', 0, 0]], secondSnapshot));
  assert.equal(f.commands.length, 2); assert.equal(f.state.members[0].achievementProgress['diary:two'], undefined);
  assert.deepEqual(f.controller.review(identity, 'a'), { preview: null });
});

test('achievement review is bounded, retains other progress, and uses existing Dismiss flow', async t => {
  const tasks = Array.from({ length: 205 }, (_, i) => task(`diary:${i}`, `Synthetic Task ${i}`));
  const f = await fixture(t, tasks);
  await f.send(undefined, { skills: { MINING: { level: 5, xp: 500 } } });
  await f.send(part(1, 1, tasks.map((_, i) => [i, `Synthetic Task ${i}`, 0, 0])), { world: { id: 2, beta: true } });
  const preview = f.controller.review(identity, 'a');
  assert.equal(preview.skills.length, 1); assert.equal(preview.achievements.length, 200); assert.equal(preview.achievementsMore, 5);
  const review = f.controller.findReview(identity, { previewId: preview.previewId }); await f.controller.finish(review.command.memberId);
  assert.deepEqual(f.controller.review(identity, 'a'), { preview: null }); assert.equal(f.commands.length, 0);
});

test('live achievement ticks preserve the beta warning on waiting skill observations', async t => {
  const f = await fixture(t);
  await f.send(undefined, { skills: { MINING: { level: 5, xp: 500 } }, world: { id: 2, beta: true } });
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  const preview = f.controller.review(identity, 'a');
  assert.equal(f.commands.length, 1); assert.equal(preview.world.beta, true); assert.equal(preview.skills[0].skill, 'Mining');
});

test('A to B to A acknowledges the replay as complete using the plugin sync continuation rule', async t => {
  const f = await fixture(t);
  await f.send(part(1, 2, [[1, 'First Task', 0, 0]]));
  await f.send(part(2, 2));
  await f.send(part(1, 1, [[2, 'Second Task', 0, 0]], secondSnapshot));
  assert.equal((await f.status()).achievements.snapshot, secondSnapshot);
  const current = part(1, 2, [[1, 'First Task', 0, 0]]);
  // PR #5 sync treats every status for another snapshot/count as received=0.
  const received = status => {
    const held = status.achievements;
    return held?.snapshot === current.snapshot && held.parts === current.parts && Number.isInteger(held.received)
      ? Math.max(0, Math.min(held.received, current.parts)) : 0;
  };
  assert.equal(received(await f.status()), 0);
  const replay = await f.send(current);
  assert.deepEqual(replay.achievements, { snapshot, received: 2, parts: 2 });
  assert.equal(received(replay), current.parts, 'Plugin stops sending achievement parts');
  assert.equal(received(await f.status()), current.parts);
  assert.equal(f.commands.length, 2, 'The replay does not process either set again');
  await f.send(undefined, { skills: { MINING: { level: 5, xp: 500 } } });
  assert.equal(f.controller.review(identity, 'a').skills.length, 1, 'Skills can resume after the achievement ack');
});

test('unclear rows retain their own assembly world while live skill observations wait', async t => {
  for (const worlds of [[{ id: 2, beta: true }], [undefined], [{ id: 1, beta: false }, undefined],
    [{ id: 2, beta: true }, { id: 1, beta: false }], [{ id: 1, beta: false }]]) {
    const f = await fixture(t, [task('diary:one', 'Shared Task'), task('diary:two', 'Shared Task', 'Hard')]);
    await f.send(undefined, { skills: { MINING: { level: 5, xp: 500 } } });
    for (let i = 0; i < worlds.length; i++) await f.send(part(i + 1, worlds.length, i ? [] : [[42, 'Shared Task', 0, 0]]), { world: worlds[i] });
    const preview = f.controller.review(identity, 'a'), row = preview.achievements[0];
    assert.equal(preview.world.beta, false); assert.equal(preview.skills[0].skill, 'Mining');
    assert.deepEqual(Object.keys(row).sort(), ['achievementId', 'title', 'candidates', 'reason', 'world'].sort());
    assert.equal(row.reason, 'unclear'); assert.equal(row.candidates.length, 2);
    assert.equal(row.world, worlds.every(world => world?.beta === false) ? 'live' : worlds.some(world => world?.beta) ? 'beta' : 'unknown');
  }
});

test('handled ids survive Undo, a service reopen, the same set and a new superset', async t => {
  const f = await fixture(t);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  await f.store.command({ type: 'undo' }, f.state.revision);
  await f.restart();
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  assert.deepEqual(f.state.members[0].completedTasks, []);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0], [2, 'Second Task', 0, 0]], secondSnapshot));
  assert.deepEqual(f.state.members[0].completedTasks, ['diary:two']);
  assert.equal(f.commands.length, 3, 'Only the initial tick, Undo and new achievement create commands');
  assert.deepEqual(f.commands[2].achievements.map(row => row.achievementId), [2]);
  assert.equal(f.state.members[0].achievementProgress['diary:one'], undefined);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-achievements.json'), 'utf8'));
  assert.deepEqual(saved, { v: 1, players: { a: { handled: [1, 2] } } });
});

test('manual unticks stick when the plugin reports a new snapshot', async t => {
  const f = await fixture(t);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  await f.store.command({ type: 'complete-task', memberId: 'a', taskId: 'diary:one', completed: false }, f.state.revision);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0], [2, 'Second Task', 0, 0]], secondSnapshot));
  assert.deepEqual(f.state.members[0].completedTasks, ['diary:two']);
  assert.deepEqual(f.commands.at(-1).achievements.map(row => row.achievementId), [2]);
});

test('evicting a completed snapshot from the eight-entry replay cache cannot reverse Undo', async t => {
  const f = await fixture(t);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  await f.store.command({ type: 'undo' }, f.state.revision);
  for (let i = 1; i <= 8; i++) await f.send(part(1, 1, [], i.toString(16).padStart(16, '0')));
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]]));
  assert.deepEqual(f.state.members[0].completedTasks, []);
  assert.equal(f.commands.length, 2);
  assert.deepEqual((await f.status()).achievements, { snapshot, received: 1, parts: 1 });
});

test('review Apply and Dismiss handle selected and skipped live rows only, durably', async t => {
  for (const action of ['apply', 'dismiss']) for (const world of [{ id: 1, beta: false }, { id: 2, beta: true }, undefined]) {
    const f = await fixture(t, [task('diary:one', 'Shared Task'), task('diary:two', 'Shared Task', 'Hard'),
      task('diary:three', 'Other Shared Task'), task('diary:four', 'Other Shared Task', 'Hard')]);
    const complete = [[42, 'Shared Task', 0, 0], [43, 'Other Shared Task', 0, 0]];
    await f.send(part(1, 1, complete), { world });
    const preview = f.controller.review(identity, 'a');
    const body = { previewId: preview.previewId, ...(action === 'apply' ? { expectedRevision: preview.stateRevision,
      achievements: [{ achievementId: 42, taskId: 'diary:two' }] } : {}) };
    const review = f.controller.findReview(identity, body, action === 'apply');
    if (action === 'apply') {
      await f.store.command(review.command, body.expectedRevision);
      assert.deepEqual(f.state.members[0].completedTasks, ['diary:two']);
    }
    await f.controller.finish(review.command.memberId);
    if (action === 'apply') await f.store.command({ type: 'undo' }, f.state.revision);
    await f.restart();
    await f.send(part(1, 1, complete, secondSnapshot));
    const next = f.controller.review(identity, 'a');
    if (world?.beta === false) {
      assert.deepEqual(next, { preview: null }, `${action} preserves both the applied and skipped live choices`);
      assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-achievements.json'), 'utf8')).players.a.handled, [42, 43]);
    } else {
      assert.deepEqual(next.achievements.map(row => row.achievementId), [42, 43], `${action} does not handle beta or unknown-world rows`);
      assert.ok(next.achievements.every(row => row.world === 'live'));
    }
    assert.deepEqual(f.state.members[0].completedTasks, []);
  }
});

test('unmatched ids and matches already complete remain eligible for later task changes or unticks', async t => {
  const f = await fixture(t);
  await f.store.command({ type: 'complete-task', memberId: 'a', taskId: 'diary:one', completed: true }, f.state.revision);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0], [2, 'No current match', 0, 0]]));
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-achievements.json')), { code: 'ENOENT' });
  await f.store.command({ type: 'complete-task', memberId: 'a', taskId: 'diary:one', completed: false }, f.state.revision);
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]], secondSnapshot));
  assert.deepEqual(f.state.members[0].completedTasks, ['diary:one']);
});

test('a corrupt handled file does not break reopening or the report route and logs once', async t => {
  const f = await fixture(t), file = path.join(f.dataDir, 'plugin-achievements.json');
  await writeFile(file, '{broken json');
  await f.restart();
  assert.equal(f.warnings.length, 1);
  assert.equal((await f.send(part(1, 1))).achievements.received, 1);
  assert.equal(await readFile(file, 'utf8'), '{broken json', 'Reading and empty sets preserve the corrupt original');
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]], secondSnapshot));
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).players.a.handled, [1]);
});

test('multiple achievement ids matching one task are all handled by the single automatic tick', async t => {
  const f = await fixture(t), complete = [[1, 'First Task', 0, 0], [2, 'First_Task', 0, 0]];
  await f.send(part(1, 1, complete));
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].achievements.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-achievements.json'), 'utf8')).players.a.handled, [1, 2]);
  await f.store.command({ type: 'undo' }, f.state.revision);
  await f.restart();
  await f.send(part(1, 1, complete, secondSnapshot));
  assert.deepEqual(f.state.members[0].completedTasks, []);
  assert.equal(f.commands.length, 2);
});

test('failed handled writes retry before acknowledging replay without reapplying a successful tick', async t => {
  const f = await fixture(t), file = path.join(f.dataDir, 'plugin-achievements.json');
  await mkdir(file);
  await assert.rejects(f.send(part(1, 1, [[1, 'First Task', 0, 0]])));
  assert.equal(f.commands.length, 1, 'Save command succeeded before the sidecar replacement failed');
  await f.store.command({ type: 'undo' }, f.state.revision);
  await rm(file, { recursive: true });
  assert.deepEqual((await f.send(part(1, 1, [[1, 'First Task', 0, 0]]))).achievements, { snapshot, received: 1, parts: 1 });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).players.a.handled, [1]);
  await f.restart();
  await f.send(part(1, 1, [[1, 'First Task', 0, 0]], secondSnapshot));
  assert.deepEqual(f.state.members[0].completedTasks, []);
  assert.equal(f.commands.length, 2, 'Only the tick and Undo ran');
});
