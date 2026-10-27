import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld } from '../app/data/world.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createGameCoordinates, GAME_COORDINATE_AREAS } from '../app/core/game-coords.mjs';

test('archival world verifies area membership, exclusions, aliases and sparse surface overlap', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const world = buildWorld(definitions, { cacheWalking: false, cacheResources: false, cacheArchaeology: false });
  const coords = createGameCoordinates(world);
  assert.deepEqual(coords.ambiguous, []);
  const enriched = createGameCoordinates(buildWorld(definitions, { dataset: selectedDataset }));
  assert.deepEqual(enriched.ambiguous, [], 'cache-only terrain is not an independent picker destination');
  const counts = [35, 67, 38, 10], aliasCounts = [32, 55, 0, 0];
  for (const [index, area] of GAME_COORDINATE_AREAS.entries()) {
    const sw = area.picker[0], ne = area.picker[1];
    const inBox = [...world.chunks.keys()].filter(id => /^\d+$/.test(id) && Math.floor(+id / 256) >= Math.floor(sw / 256)
      && Math.floor(+id / 256) <= Math.floor(ne / 256) && +id % 256 >= sw % 256 && +id % 256 <= ne % 256);
    const members = inBox.filter(id => !area.excluded.includes(+id));
    assert.equal(members.length, counts[index], `${area.name}: re-audit membership if definitions change`);
    assert.equal(members.filter(id => world.chunks.has(coords.pickerChunkToGameId(id))).length, aliasCounts[index]);
    for (const id of members) {
      const point = coords.pickerChunkToGameSquare(id);
      assert.equal(coords.gameSquareToPickerChunk(point.x, point.z), id);
      assert.equal(enriched.gameSquareToPickerChunk(point.x, point.z), id);
    }
    for (const id of area.excluded) {
      assert.match(world.chunks.get(String(id)).name, /Citadel/);
      assert.equal(world.walkable.has(String(id)), false);
    }
  }
  for (const [picker, game, label] of [[14878, 7093, 'Waiko Western Docks'], [15426, 21283, 'Anachronia South-West Mine'],
    [16436, 13592, "Wendle's Wicks"], [7729, 5464, 'Central Lost Grove']]) {
    assert.equal(world.chunks.get(String(picker)).name, label);
    assert.equal(coords.pickerChunkToGameId(String(picker)), String(game));
  }
  // These are inside Havenhythe's game rectangle and the normal surface crop,
  // but have no displaced picker record. A whole-box translation would steal them.
  for (const id of ['13334', '13589', '14876']) {
    assert.ok(world.surface.has(id) || !world.chunks.has(id));
    assert.equal(coords.gameSquareToPickerChunk(Math.floor(+id / 256), +id % 256), id);
  }
});
