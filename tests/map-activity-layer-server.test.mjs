import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

test('activity data and browser assets are authenticated read-only resources for viewers', async t => {
  const root = fileURLToPath(new URL('../.local/layer-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'server-'));
  const definitions = { chunks: { '12341': { Monster: { Chicken: true }, NPC: { Private: true } } },
    walkableChunks: ['12341'], walkableChunksF2P: ['12341'], clues: { easy: { '12341': true } },
    codeItems: { slayerTasks: { Birds: { Chicken: true } } }, challenges: {} };
  const application = await createServer({ dataDir, definitions, taskMap: {},
    initialState: createGroupState([{ id: 'actor1', name: 'Player' }]),
    port: 0, predictionPrewarm: false });
  t.after(async () => { await application.close(); await rm(dataDir, { recursive: true, force: true }); });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const admin = application.store.getAccessToken();
  const request = (route, cookie) => fetch(origin + route, { headers: cookie ? { Cookie: cookie } : {} });
  const route = '/api/definitions?view=map-layers-v1';
  assert.equal((await request(route)).status, 401);
  const created = await fetch(origin + '/api/invites', { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ label: 'Layer viewer', viewer: true }) });
  assert.equal(created.status, 201);
  const joined = await fetch((await created.json()).link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const before = application.store.getInfo().revision;
  const response = await request(route, cookie);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.clues, definitions.clues);
  if (selectedDataset.capabilities.independent) assert.equal(payload.monsterMembership.Chicken, undefined, 'Unknown membership stays unknown without a catalogue record');
  else assert.equal(payload.monsterMembership.Chicken.members, false);
  assert.equal(payload.chunks['12341'].NPC, undefined);
  const cached = await fetch(origin + route, { headers: { Cookie: cookie, 'If-None-Match': response.headers.get('etag') } });
  assert.equal(cached.status, 304);
  for (const module of ['map-activity-layers.mjs', 'map-activity-layer-model.mjs', 'map-activity-layer-renderer.mjs', 'map-activity-layers.css', 'data/access-policy.mjs']) {
    assert.equal((await request('/' + module)).status, 401);
    assert.equal((await request('/' + module, cookie)).status, 200);
  }
  assert.equal(application.store.getInfo().revision, before);
});
