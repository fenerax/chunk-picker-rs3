import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('Helper resources and chunk drops use the existing invitation and never save', async t => {
  const root = fileURLToPath(new URL('../.local/helper-tests/', import.meta.url)); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const initialState = createGroupState([{ id: 'm', name: 'Fixture', unlocked: ['12850'] }]);
  const definitions = { chunks: { '12850': { Monster: { Cow: true } } }, sections: { '12850': { 0: [] } }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'], challenges: {}, drops: { Cow: { Bones: { '1': 'Always' } } } };
  const application = await createServer({ definitions, taskMap: {}, initialState, dataDir: directory, port: 0, prewarm: false });
  await application.listen(); t.after(async () => { await application.close(); await rm(directory, { recursive: true, force: true }); });
  const invite = new URL(application.inviteUrl), headers = { authorization: `Bearer ${invite.pathname.split('/').at(-1)}` }, origin = invite.origin;
  const before = application.store.getState();
  assert.equal((await fetch(`${origin}/api/helper-drops?memberId=m`)).status, 401);
  assert.equal((await fetch(`${origin}/api/helper-drops?memberId=unknown`, { headers })).status, 400);
  const response = await fetch(`${origin}/api/helper-drops?memberId=m`, { headers }); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.memberId, 'm'); assert.equal(value.stateRevision, before.revision);
  assert.ok(value.drops.some(row => row.monster === 'Cow' && row.item === 'Bones' && row.denominator === 1));
  assert.equal((await fetch(`${origin}/api/helper-progress`)).status, 401);
  const progress = await (await fetch(`${origin}/api/helper-progress`, { headers })).json();
  assert.equal(progress.stateRevision, before.revision);
  assert.equal(progress.current.members[0].metrics.unlockedChunks, 1);
  for (const route of ['helper.mjs', 'helper.css', 'helper-model.mjs', 'helper-training.mjs', 'helper-goals.mjs', 'helper-drops.mjs', 'helper-charts.mjs', 'helper-utilities.mjs', 'helper-progress.mjs', 'helper-progress-model.mjs', 'amount-input.mjs', 'core/experience.mjs', 'core/combat-level.mjs']) assert.equal((await fetch(`${origin}/${route}`, { headers })).status, 200, route);
  assert.deepEqual(application.store.getState(), before);
});
