import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('map reference endpoint is authenticated, cached and separate from gameplay payloads', async t => {
  const root = fileURLToPath(new URL('../.local/map-info-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const app = await createServer({ port: 0, dataDir: directory, definitions: {
    chunks: { '12339': {} }, sections: { '12339': { 0: [] } }, walkableChunks: ['12339'], walkableChunksF2P: ['12339'],
  }, taskMap: {}, initialState: createGroupState([{ id: 'fixture', name: 'Fixture' }]) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen();
  const url = new URL(app.inviteUrl), headers = { authorization: `Bearer ${url.pathname.split('/').at(-1)}` };
  assert.equal((await fetch(`${url.origin}/api/map-info`)).status, 401);
  const stateBefore = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  const response = await fetch(`${url.origin}/api/map-info`, { headers });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /^private/);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  const data = await response.json();
  assert.equal(data.connections.membershipView, 'f2p');
  assert.ok(data.connections.connections.every(row => row.members !== true && row.f2p !== false));
  assert.ok(data.connections.destinations.every(row => row.members !== true && row.f2p !== false));
  assert.ok(!data.connections.connections.some(row => row.routeId === 'carpet-shantay-pass--menaphos'));
  assert.equal(data.schemaVersion, 1); assert.equal(data.pinDetails.pins.length, 2994);
  assert(data.connections.connections.some(edge => edge.from.chunkId === '9001' || edge.from.areaId === '9001' || edge.to.chunkId === '9001' || edge.to.areaId === '9001'));
  const conditional = await fetch(`${url.origin}/api/map-info`, { headers: { ...headers, 'if-none-match': response.headers.get('etag') } });
  assert.equal(conditional.status, 304);
  const stateAfter = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  assert.equal(stateAfter.state.revision, stateBefore.state.revision);
  assert.equal(stateAfter.pinDetails, undefined); assert.equal(stateAfter.connections, undefined);
  const module = await fetch(`${url.origin}/map-info.mjs`, { headers });
  assert.equal(module.status, 200); assert.match(await module.text(), /drawMapConnections/);
  const changed = await fetch(`${url.origin}/api/command`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: stateAfter.state.revision, command: { type: 'set-rule', ruleId: 'content.f2p', value: false } }) });
  assert.equal(changed.status, 200);
  const membersResponse = await fetch(`${url.origin}/api/map-info`, { headers: { ...headers, 'If-None-Match': response.headers.get('etag') } });
  assert.equal(membersResponse.status, 200);
  const membersData = await membersResponse.json();
  assert.ok(membersData.connections.connections.some(row => row.routeId === 'carpet-shantay-pass--menaphos'));
  assert.ok(membersData.connections.destinations.some(row => row.routeId === 'spell-eastern-anachronia'));
  assert.notEqual(membersResponse.headers.get('etag'), response.headers.get('etag'));
});
