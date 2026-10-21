import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import catalogue from '../app/data/cache-interiors.2026-10-08.v2.json' with { type: 'json' };
import before from '../archive/data/map-connections.2026-10-08.v2.json' with { type: 'json' };
import { MAP_CONNECTIONS, getMapConnectionsForChunk } from '../app/data/map-connections.mjs';
import { sha256 } from '../scripts/lib/provenance-hash.mjs';
import { puroWheatFootprints, addWheatFootprints } from '../scripts/cache/interiors-v2-scenery.mjs';

test('active connections preserve every route/access field and link Draynor interiors without surface lines', () => {
  const originalIds = new Set(before.connections.map(edge => edge.id));
  assert.deepEqual(MAP_CONNECTIONS.connections.filter(edge => originalIds.has(edge.id)).map(edge => edge.id), before.connections.map(edge => edge.id));
  const activeById = new Map(MAP_CONNECTIONS.connections.map(edge => [edge.id, edge]));
  for (let i = 0; i < before.connections.length; i++) {
    const original = before.connections[i], current = activeById.get(original.id);
    for (const field of ['kind', 'members', 'requirement', 'bidirectional', 'provenance', 'sourceSchema']) assert.deepEqual(current[field], original[field], `${original.id}/${field}`);
    for (const point of [current.from, current.to].filter(p => p.offSurface)) {
      assert.equal(current.drawable, false); assert.equal(point.worldX, null); assert.equal(point.worldY, null);
      assert.equal(point.displayChunkId, null); assert.ok(point.interiorMap.api.startsWith('/api/interior-maps?area='));
      if (point.interiorMap.status === 'unknown') assert.deepEqual([point.mapId, point.plane, point.x, point.y], [null, null, null, null]);
    }
  }
  const rows = getMapConnectionsForChunk('12339');
  for (const id of ['10307', '13214', '1546', '23', '5706', '5705', '12438']) {
    const edge = rows.find(e => [e.from, e.to].some(p => (p.areaId ?? p.chunkId) === id));
    assert.ok(edge, id); assert.equal(edge.drawable, false, id);
    const point = [edge.from, edge.to].find(p => (p.areaId ?? p.chunkId) === id);
    assert.equal(point.offSurface, true, id); assert.equal(point.interiorMap.status, 'mapped', id);
  }
  const wars = rows.find(e => [e.from, e.to].some(p => p.chunkId === '13214'));
  const arrival = [wars.from, wars.to].find(p => p.chunkId === '13214');
  assert.deepEqual([arrival.mapId, arrival.plane, arrival.x, arrival.y, arrival.precision], [10003, 0, 3294, 10127, 'exact-arrival']);
  assert.equal(arrival.coordinateEvidence.kind, 'wiki-explicit-player-arrival');
  assert.ok(arrival.coordinateEvidence.role.startsWith('Documented exact teleport/Insignia arrival'));
  const surface = [wars.from, wars.to].find(p => p.chunkId === '12339');
  assert.deepEqual([surface.x, surface.y, surface.precision], [3105, 3311, 'exact-entrance']);
});

test('authenticated v2 area API and installed tiles leave fixture gameplay bytes unchanged', async t => {
  const root = resolve(import.meta.dirname, '../.local/interiors-v2-server-tests');
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'fixture-'));
  const assets = resolve(import.meta.dirname, '../.local/map-assets');
  const app = await createServer({ dataDir: join(directory, 'state'), mapAssetsDir: assets, port: 0, taskMap: {},
    definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] },
    initialState: createGroupState([{ id: 'a', name: 'Synthetic A' }, { id: 'b', name: 'Synthetic B' }]) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen(); const origin = `http://127.0.0.1:${app.address().port}`;
  const headers = { authorization: `Bearer ${app.store.getAccessToken()}` }, get = path => fetch(`${origin}${path}`, { headers });
  const stateFile = join(directory, 'state/state.json'), saved = await readFile(stateFile);
  assert.equal((await fetch(`${origin}/api/interior-maps?area=10307`)).status, 401);
  for (const [id, mapId] of [['10307', 168], ['13214', 10003], ['1546', 10004], ['23', 742], ['5706', 653]]) {
    const response = await get(`/api/interior-maps?area=${id}`); assert.equal(response.status, 200);
    const payload = await response.json(); assert.equal(payload.version, '2026-10-08.v2'); assert.equal(payload.accessEffect, 'none');
    assert.equal(payload.area.status, 'mapped'); assert.deepEqual(payload.area.mapIds, [mapId]);
  }
  const unknown = catalogue.areas.find(a => a.status === 'unknown');
  assert.equal((await (await get(`/api/interior-maps?area=${encodeURIComponent(unknown.areaId)}`)).json()).area.status, 'unknown');
  assert.equal((await get('/api/interior-maps?area=missing-area-fixture')).status, 404);
  assert.equal((await get('/data/cache-interiors.2026-10-08.v2.json')).status, 200);
  if (existsSync(join(assets, catalogue.assets.manifestPath))) {
    const payload = await (await get('/api/interior-maps?area=10307')).json(); assert.equal(payload.assets.available, true);
    const tile = payload.area.maps[0].tiles.find(t => t.x === 40 && t.y === 67);
    assert.ok(tile.sceneryFootprints.count > 0);
    const response = await get(tile.url); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha256(bytes), tile.sha256);
    assert.equal(bytes.readUInt32BE(16), 256); assert.equal(bytes.readUInt32BE(20), 256);
  }
  assert.deepEqual(await readFile(stateFile), saved);
});

test('Puro footprints use exact named scenery, sizes and rotations without selecting nameless morph state', () => {
  const square = { x: 40, z: 67, locations: { locations: [{ id: 1, uses: [{ x: 1, y: 2, plane: 0, rotation: 1, type: 10 }] },
    { id: 2, uses: [{ x: 3, y: 4, plane: 0, rotation: 0, type: 10 }] }] } };
  const rectangles = puroWheatFootprints(square, id => id === 1 ? { name: 'Magical wheat', width: 2, length: 1 } : { morphs: [1] });
  assert.deepEqual(rectangles, [{ objectId: 1, x: 2561, y: 4290, width: 1, height: 2, rotation: 1, type: 10 }]);
  const svg = addWheatFootprints('<svg viewBox="0 0 64 64" width="256" height="256"></svg>', square, rectangles);
  assert.ok(svg.includes('x="1" y="60" width="1" height="2"')); assert.ok(!svg.includes('<text'));
});
