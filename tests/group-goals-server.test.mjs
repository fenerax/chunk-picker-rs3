import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

async function fixture(t) {
  const base = path.resolve('.local/group-goals-server-tests');
  await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'server-'));
  const workerFactory = () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
    };
    worker.terminate = async () => worker.emit('exit', 0);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 }));
    return worker;
  };
  const options = { dataDir, initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]),
    definitions: { chunks: {}, walkableChunks: [], walkableChunksF2P: [] }, taskMap: {}, port: 0, host: '127.0.0.1', predictionPrewarm: false,
    gameDataDir: path.join(dataDir, 'game'), mapAssetsDir: path.join(dataDir, 'assets'),
    taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory } };
  let app = await createServer(options);
  t.after(async () => { await app.close(); assert.equal(path.dirname(dataDir), base); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const request = async (route, body, credentials) => {
    const url = new URL(app.inviteUrl);
    const auth = credentials ?? { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
    return fetch(url.origin + route, { method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...auth, ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  };
  const command = (command, expectedRevision = app.store.getInfo().revision, credentials) => request('/api/command?view=play-v1', { command, expectedRevision }, credentials);
  const invite = async memberId => {
    const response = await request('/api/invites', { label: memberId ?? 'Watcher', ...(memberId ? { memberId } : { viewer: true }) });
    assert.equal(response.status, 201);
    const joined = await request(new URL((await response.json()).link).pathname, undefined, {});
    assert.equal(joined.status, 303);
    return { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  };
  return { get app() { return app; }, request, command, invite, async restart() { await app.close(); app = await createServer(options); await app.listen(); } };
}
const add = { type: 'add-group-goal', goalId: 'group-goal:pickaxes', text: 'Both get a rune pickaxe', completion: 'players' };
const tick = { type: 'set-group-goal-done', goalId: add.goalId, memberId: 'actor1', done: true };

test('shared goals survive compact responses, backups and restart, without changing calculation inputs', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const original = f.app.store.getState(), input = f.app.store.getCalculationSnapshot(), fingerprint = f.app.store.getGameplayFingerprint();
  let baseline = (await (await f.request('/api/state?view=play-v1')).json()).state;
  for (const edit of [add, tick, { ...tick, memberId: 'reed' }]) {
    const response = await f.command(edit);
    assert.equal(response.status, 200, await response.clone().text());
    baseline = mergeCommandState(baseline, await response.json());
    assert.deepEqual(baseline.groupGoals, f.app.store.getState().groupGoals);
  }
  assert.equal(baseline.groupGoals[0].done, true);
  assert.deepEqual(f.app.store.getState().members, original.members);
  assert.equal(f.app.store.getGameplayFingerprint(), fingerprint);
  assert.equal(f.app.store.getCalculationSnapshot().inputKey, input.inputKey);
  assert.equal(f.app.store.getCalculationState().groupGoals, undefined);
  assert.equal((await f.command(add, 0)).status, 409);
  assert.equal((await f.command({ ...tick, memberId: 'absent' })).status, 400);
  assert.deepEqual((await (await f.request('/api/backup')).json()).state.groupGoals, baseline.groupGoals);
  const beforeRestart = f.app.store.getState().groupGoals;
  await f.restart();
  assert.deepEqual(f.app.store.getState().groupGoals, beforeRestart);
  assert.equal((await f.command({ type: 'undo' })).status, 200);
  assert.deepEqual(f.app.store.getState().groupGoals[0].completedBy, ['actor1']);
  assert.equal(f.app.store.getState().groupGoals[0].done, false);
  const history = (await (await f.request('/api/history')).json()).history;
  assert.equal(describeHistoryEvent(history.find(event => event.type === add.type)), 'Added group goal “Both get a rune pickaxe”');
  assert.equal(history.find(event => event.type === tick.type).command.goalText, add.text);
});

test('either player can manage the shared plan and undo its changes', { timeout: 20000 }, async t => {
  const { app, command, invite } = await fixture(t);
  const actor1 = await invite('actor1'), reed = await invite('reed');
  const edits = [add, { ...tick, memberId: 'actor1' }, { type: 'update-group-goal', goalId: add.goalId, text: 'Get pickaxes together', completion: 'group' },
    { ...add, goalId: 'group-goal:quest', text: 'Finish Dragon Slayer before members' },
    { type: 'move-group-goal', goalId: add.goalId, index: 1 }, { type: 'set-group-goal-done', goalId: add.goalId, done: true },
    { type: 'remove-group-goal', goalId: add.goalId }, { type: 'undo' }];
  for (const [index, edit] of edits.entries()) {
    const response = await command(edit, undefined, index % 2 ? actor1 : reed);
    assert.equal(response.status, 200, await response.clone().text());
  }
  assert.equal(app.store.getState().groupGoals[1].done, true);
});

test('view-only links read goals and cannot execute any goal command or Undo', { timeout: 20000 }, async t => {
  const { app, request, command, invite } = await fixture(t);
  assert.equal((await command(add)).status, 200);
  const viewer = await invite(), revision = app.store.getInfo().revision;
  for (const route of ['/api/state', '/api/state?view=play-v1']) {
    const response = await request(route, undefined, viewer);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).state.groupGoals, app.store.getState().groupGoals);
  }
  for (const edit of [add, tick, { type: 'update-group-goal', goalId: add.goalId, text: 'Changed', completion: 'group' },
    { type: 'move-group-goal', goalId: add.goalId, index: 0 }, { type: 'remove-group-goal', goalId: add.goalId }, { type: 'undo' }]) {
    assert.equal((await command(edit, undefined, viewer)).status, 403);
  }
  assert.equal((await request('/api/state?view=play-v1', undefined, {})).status, 401);
  assert.equal(app.store.getInfo().revision, revision);
  for (const route of ['/group-goals.mjs', '/group-goals.css', '/core/group-goals.mjs']) assert.equal((await request(route, undefined, viewer)).status, 200);
});
