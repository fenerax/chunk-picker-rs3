import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { playerControlSkills } from '../app/core/player-controls.mjs';

const alternateSkill = playerControlSkills.includes('Firemaking') ? 'Firemaking' : playerControlSkills.find(skill => skill !== 'Woodcutting');

async function fixture(t) {
  const base = path.resolve('.local/custom-tasks-server-tests');
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
  const app = await createServer({ dataDir, initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]),
    definitions: { chunks: {}, walkableChunks: [], walkableChunksF2P: [] }, taskMap: {}, port: 0, host: '127.0.0.1', predictionPrewarm: false,
    gameDataDir: path.join(dataDir, 'game'), mapAssetsDir: path.join(dataDir, 'assets'),
    taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory } });
  t.after(async () => { await app.close(); assert.equal(path.dirname(dataDir), base); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const url = new URL(app.inviteUrl), auth = { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
  const request = (route, body, credentials = auth) => fetch(url.origin + route, { method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { ...credentials, ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const command = (command, expectedRevision = app.store.getInfo().revision, credentials) => request('/api/command?view=play-v1', { command, expectedRevision }, credentials);
  const invite = async viewer => {
    const response = await request('/api/invites', { label: viewer ? 'Watcher' : 'Reed', ...(viewer ? { viewer: true } : { memberId: 'reed' }) });
    assert.equal(response.status, 201);
    const joined = await request(new URL((await response.json()).link).pathname, undefined, {});
    assert.equal(joined.status, 303);
    return { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  };
  return { app, request, command, invite };
}

test('custom task server commands preserve fields in compact state, enforce revisions and support undo', async t => {
  const { app, request, command } = await fixture(t);
  const task = { id: 'rs3:task:custom:server01', label: 'Supply acadia logs', category: 'Woodcutting', skill: 'Woodcutting', level: 50, memberIds: ['actor1'] };
  let response = await command({ type: 'add-task', task });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).state.tasks[0], task);
  const beforeEdit = app.store.getInfo().revision;
  response = await command({ type: 'update-task', taskId: task.id, task: { label: 'Burn acadia logs', skill: alternateSkill, level: 60, memberIds: ['reed'] } });
  assert.equal(response.status, 200, await response.clone().text());
  const edited = (await response.json()).state.tasks[0];
  assert.deepEqual(edited, { id: task.id, label: 'Burn acadia logs', category: alternateSkill, skill: alternateSkill, level: 60, memberIds: ['reed'] });
  assert.equal((await command({ type: 'delete-task', taskId: task.id }, beforeEdit)).status, 409);
  assert.equal((await command({ type: 'update-task', taskId: task.id, task: { label: 'Invalid', level: 30 } })).status, 400);
  assert.equal((await command({ type: 'delete-task', taskId: 'rs3:task:builtin' })).status, 400);
  response = await command({ type: 'delete-task', taskId: task.id });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).state.tasks, []);
  assert.equal(app.store.getHistory().history.at(-1).command.taskLabel, edited.label);
  response = await command({ type: 'undo' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).state.tasks[0], edited);
  for (const route of ['/custom-tasks-model.mjs', '/screen-custom-tasks.mjs']) assert.equal((await request(route)).status, 200, route);
});

test('player invitations can edit custom tasks and view-only invitations cannot mutate them', async t => {
  const { command, invite } = await fixture(t);
  const task = { id: 'custom:shared', label: 'Share logs', category: 'Custom' };
  assert.equal((await command({ type: 'add-task', task })).status, 200);
  const reed = await invite(false), watcher = await invite(true);
  assert.equal((await command({ type: 'update-task', taskId: task.id, task: { label: 'Share more logs', memberIds: ['reed'] } }, undefined, reed)).status, 200);
  for (const type of ['update-task', 'delete-task']) {
    const payload = { type, taskId: task.id, ...(type === 'update-task' ? { task: { label: 'View-only edit' } } : {}) };
    assert.equal((await command(payload, undefined, watcher)).status, 403);
  }
  assert.equal((await command({ type: 'delete-task', taskId: task.id }, undefined, reed)).status, 200);
});
