import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';

async function fixture(t) {
  const base = path.resolve('.local/finish-line-server-tests');
  await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'server-'));
  assert.equal(path.dirname(dataDir), base);
  const workerFactory = () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
    };
    worker.terminate = async () => worker.emit('exit', 0);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 }));
    return worker;
  };
  const app = await createServer({ dataDir, initialState: createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]),
    definitions: { chunks: {}, walkableChunks: [], walkableChunksF2P: [] }, taskMap: {}, port: 0, host: '127.0.0.1', predictionPrewarm: false,
    gameDataDir: path.join(dataDir, 'game'), mapAssetsDir: path.join(dataDir, 'assets'),
    taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory } });
  t.after(async () => { await app.close(); assert.equal(path.dirname(dataDir), base); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const url = new URL(app.inviteUrl), auth = { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
  const request = (route, body, credentials = auth) => fetch(url.origin + route, { method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { ...credentials, ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const command = (command, expectedRevision = app.store.getInfo().revision, credentials) => request('/api/command?view=play-v1', { command, expectedRevision }, credentials);
  const invite = async memberId => {
    const response = await request('/api/invites', { label: memberId ?? 'Watcher', ...(memberId ? { memberId } : { viewer: true }) });
    assert.equal(response.status, 201);
    const joined = await request(new URL((await response.json()).link).pathname, undefined, {});
    assert.equal(joined.status, 303);
    return { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  };
  return { app, request, command, invite };
}
const setting = { type: 'set-finish-line-item', itemId: 'skill:Mining', target: 60 };
const add = { type: 'add-finish-line-custom', itemId: 'finish:shared-bank', text: 'Fill the shared bank' };
const tick = { type: 'set-finish-line-custom', itemId: add.itemId, memberId: 'player1', completed: true };

test('finish line commands preserve compact state, revisions, backups and guarded Undo without changing engine input', { timeout: 20000 }, async t => {
  const { app, request, command } = await fixture(t);
  const original = app.store.getState(), input = app.store.getCalculationSnapshot(), fingerprint = app.store.getGameplayFingerprint();
  let baseline = (await (await request('/api/state?view=play-v1')).json()).state;
  for (const edit of [setting, add, tick, { ...tick, memberId: 'player2' }]) {
    const response = await command(edit);
    assert.equal(response.status, 200, await response.clone().text());
    baseline = mergeCommandState(baseline, await response.json());
    assert.ok(baseline);
    assert.deepEqual(baseline.finishLine, app.store.getState().finishLine);
  }
  const saved = app.store.getState();
  assert.deepEqual(saved.finishLine.customItems[0].completedBy, ['player1', 'player2']);
  assert.deepEqual(saved.members, original.members);
  assert.equal(app.store.getGameplayFingerprint(), fingerprint);
  assert.equal(app.store.getCalculationSnapshot().inputKey, input.inputKey);
  assert.equal(app.store.getCalculationState().finishLine, undefined);
  assert.equal((await command(setting, 0)).status, 409);
  assert.equal((await command({ ...setting, target: 121 })).status, 400);
  assert.equal(app.store.getInfo().revision, saved.revision);
  const undo = await command({ type: 'undo' });
  assert.equal(undo.status, 200, await undo.clone().text());
  assert.deepEqual((await undo.json()).state.finishLine.customItems[0].completedBy, ['player1']);
  const backup = await request('/api/backup');
  assert.equal(backup.status, 200);
  assert.deepEqual((await backup.json()).state.finishLine, app.store.getState().finishLine);
  const history = app.store.getHistory().history;
  assert.equal(history.find(event => event.type === 'set-finish-line-custom').command.itemText, add.text);
  assert.equal(history.find(event => event.type === 'set-finish-line-item').undo.finishLineChange.after.value.items['skill:Mining'].target, 60);
  const partnerHistory = await request('/api/history?player=player2');
  assert.equal(partnerHistory.status, 200);
  const partnerEvents = (await partnerHistory.json()).history;
  assert.ok(partnerEvents.some(event => event.type === 'set-finish-line-item'));
  assert.ok(partnerEvents.some(event => event.type === 'add-finish-line-custom'));
  assert.equal(history.find(event => event.type === 'set-finish-line-item').command.itemLabel, 'Mining');
});

test('both players can edit the shared list; personal ticks and their Undo require the account owner or admin', { timeout: 20000 }, async t => {
  const { command, invite } = await fixture(t);
  const player1 = await invite('player1'), player2 = await invite('player2');
  assert.equal((await command(setting, undefined, player1)).status, 200);
  assert.equal((await command({ ...setting, enabled: false }, undefined, player2)).status, 200);
  assert.equal((await command(add, undefined, player2)).status, 200);
  assert.equal((await command({ type: setting.type, itemId: add.itemId, enabled: false }, undefined, player1)).status, 200);
  assert.equal((await command(tick, undefined, player2)).status, 403);
  assert.equal((await command(tick, undefined, player1)).status, 200);
  assert.equal((await command({ type: 'undo' }, undefined, player2)).status, 403);
  assert.equal((await command({ type: 'undo' }, undefined, player1)).status, 200);
  assert.equal((await command({ ...tick, memberId: 'player2' }, undefined, player2)).status, 200);
  assert.equal((await command({ type: 'undo' })).status, 200);
  assert.equal((await command(tick)).status, 200);
  assert.equal((await command({ type: 'undo' })).status, 200);
  assert.equal((await command({ type: 'delete-finish-line-custom', itemId: add.itemId }, undefined, player1)).status, 200);
  assert.equal((await command({ type: 'undo' }, undefined, player2)).status, 200);
});

test('view-only finish line reads remain read-only and every checklist mutation is denied', { timeout: 20000 }, async t => {
  const { app, request, command, invite } = await fixture(t);
  assert.equal((await command(setting)).status, 200);
  assert.equal((await command(add)).status, 200);
  const viewer = await invite();
  const revision = app.store.getInfo().revision;
  for (const route of ['/api/state', '/api/state?view=play-v1']) {
    const response = await request(route, undefined, viewer);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).state.finishLine, app.store.getState().finishLine);
  }
  for (const edit of [setting, add, tick, { type: 'delete-finish-line-custom', itemId: add.itemId }, { type: 'undo' }]) {
    assert.equal((await command(edit, undefined, viewer)).status, 403);
  }
  assert.equal((await request('/api/state?view=play-v1', undefined, {})).status, 401);
  assert.equal(app.store.getInfo().revision, revision);
});
