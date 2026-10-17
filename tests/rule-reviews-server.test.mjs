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
  const base = path.resolve('var', 'rule-reviews-server-tests');
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
const review = { type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: true, note: 'Agreed together.' };

test('rule reviews survive compact responses, backups and restart without changing calculation inputs', { timeout: 20000 }, async t => {
  const f = await fixture(t), original = f.app.store.getState();
  const input = f.app.store.getCalculationSnapshot(), fingerprint = f.app.store.getGameplayFingerprint();
  const baseline = (await (await f.request('/api/state?view=play-v1')).json()).state;
  const response = await f.command(review);
  assert.equal(response.status, 200, await response.clone().text());
  const saved = mergeCommandState(baseline, await response.json());
  assert.deepEqual(saved.ruleReviews, { [review.ruleId]: { reviewed: true, note: review.note } });
  assert.deepEqual(f.app.store.getState().members, original.members);
  assert.deepEqual(f.app.store.getState().rules, original.rules);
  assert.equal(f.app.store.getGameplayFingerprint(), fingerprint);
  assert.equal(f.app.store.getCalculationSnapshot().inputKey, input.inputKey);
  assert.equal(f.app.store.getCalculationSnapshot().taskInputKey, input.taskInputKey);
  assert.equal(f.app.store.getCalculationState().ruleReviews, undefined);
  assert.equal((await f.command(review, 0)).status, 409);
  assert.equal((await f.command({ ...review, ruleId: 'unknown' })).status, 400);
  assert.equal((await f.command({ ...review, note: 'x'.repeat(501) })).status, 400);
  assert.deepEqual((await (await f.request('/api/backup')).json()).state.ruleReviews, saved.ruleReviews);
  await f.restart();
  assert.deepEqual(f.app.store.getState().ruleReviews, saved.ruleReviews);
  const history = (await (await f.request('/api/history')).json()).history;
  assert.equal(history.find(event => event.type === review.type).command.note, review.note);
  assert.equal(describeHistoryEvent(history.find(event => event.type === review.type)), 'Reviewed a rule');
  assert.equal((await f.command({ type: 'undo', undoRevision: 1 })).status, 200);
  assert.equal(f.app.store.getState().ruleReviews, undefined);
  assert.equal(f.app.store.getGameplayFingerprint(), fingerprint);
});

test('both players can update shared reviews while viewers only read', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor1 = await f.invite('actor1'), reed = await f.invite('reed');
  assert.equal((await f.command(review, undefined, actor1)).status, 200);
  const changed = { ...review, reviewed: false, note: 'Please revisit this.' };
  assert.equal((await f.command(changed, undefined, reed)).status, 200);
  const viewer = await f.invite(), revision = f.app.store.getInfo().revision;
  for (const route of ['/api/state', '/api/state?view=play-v1']) {
    const response = await f.request(route, undefined, viewer);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).state.ruleReviews, f.app.store.getState().ruleReviews);
  }
  for (const command of [review, changed, { type: 'undo' }]) assert.equal((await f.command(command, undefined, viewer)).status, 403);
  assert.equal(f.app.store.getInfo().revision, revision);
  assert.equal((await f.command({ type: 'undo' }, undefined, actor1)).status, 200);
  assert.deepEqual(f.app.store.getState().ruleReviews, { [review.ruleId]: { reviewed: true, note: review.note } });
});
