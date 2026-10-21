import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('house goals stay sparse through authenticated rule activation, check, undo and disabling', async t => {
  const root = fileURLToPath(new URL('../.local/house-server-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const definitions = { chunks: { '12850': { Object: { 'Furniture workbench': true, 'Furniture storage': true },
    Spawn: { 'Mask of Dragith Nurn': 1, 'Oak plank': 3 } } }, sections: { '12850': { 0: [] } }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
    challenges: { Quest: { 'Complete housing tutorial': { BaseQuest: "There's No Place Like Home...", Chunks: ['12850'], QuestPoints: 1 } } }, codeItems: {} };
  const initialState = createGroupState([{ id: 'm', name: 'Fixture', unlocked: ['12850'] }]);
  initialState.rules['content.f2p'] = false;
  initialState.members[0].passiveLevels = { Construction: 46 };
  const app = await createServer({ definitions, initialState, taskMap: {}, dataDir: path.join(directory, 'state'), port: 0 });
  await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const url = new URL(app.inviteUrl), headers = { authorization: `Bearer ${url.pathname.split('/').at(-1)}` };
  const get = route => fetch(`${url.origin}${route}`, { headers }).then(response => response.json());
  const command = async command => {
    const response = await fetch(`${url.origin}/api/command`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: app.store.getState().revision, command }) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.state;
  };
  assert.equal(app.store.getState().tasks.length, 1, 'Potential optional goals do not populate a fresh save.');
  const before = await get('/api/tasks?memberId=m');
  assert.equal(before.houseStorage.enabled, false);
  assert.ok(!before.tasks.some(task => task.kind === 'house-storage'));
  await command({ type: 'set-task-rule', memberId: 'm', ruleId: 'House storage tasks', value: true });
  const enabled = await get('/api/tasks?memberId=m');
  const goal = enabled.tasks.find(task => task.kind === 'house-storage');
  assert.equal(goal.label, 'Store Mask of Dragith Nurn in your armour case');
  assert.ok(enabled.presentation.tasks.some(task => task.id === goal.id));
  assert.equal(app.store.getState().tasks.length, 1, 'Querying eligible goals does not persist them.');
  await command({ type: 'set-task-status', memberId: 'm', taskId: goal.id, challengeCompleted: true });
  assert.equal(app.store.getState().tasks.length, 2, 'Only the checked generated goal is registered.');
  assert.equal((await get('/api/tasks?memberId=m')).tasks.find(task => task.id === goal.id).challengeSatisfied, true);
  await command({ type: 'undo' });
  assert.equal(app.store.getState().tasks.length, 1);
  await command({ type: 'set-task-rule', memberId: 'm', ruleId: 'House storage tasks', value: false });
  assert.ok(!(await get('/api/tasks?memberId=m')).tasks.some(task => task.kind === 'house-storage'));
});
