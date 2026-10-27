import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCoordinates, GAME_COORDINATE_AREAS, validateGameCoordinateAreas } from '../app/core/game-coords.mjs';

const point = id => [Math.floor(Number(id) / 256), Number(id) % 256];
const world = (ids, extra = {}) => ({ chunks: new Map(ids.map(id => [String(id), {}])), walkable: new Set(ids.map(String)), surface: new Set(), ...extra });

test('known map squares convert in both directions; ordinary and out-of-box chunks retain identity', () => {
  const pairs = [[14878, 7093], [15426, 21283], [16436, 13592], [7729, 5464]];
  const coords = createGameCoordinates(world([...pairs.map(([id]) => id), 12850, 13613, 14654, 18213]));
  for (const [picker, game] of pairs) {
    assert.equal(coords.gameSquareToPickerChunk(...point(game)), String(picker));
    assert.deepEqual(coords.pickerChunkToGameSquare(String(picker)), { x: point(game)[0], z: point(game)[1] });
    assert.equal(coords.pickerChunkToGameId(String(picker)), String(game));
  }
  for (const id of [12850, 13613, 14654, 18213]) {
    assert.equal(coords.gameSquareToPickerChunk(...point(id)), String(id));
    assert.equal(coords.pickerChunkToGameId(String(id)), String(id));
  }
  assert.equal(coords.pickerChunkToGameId('15426-2'), '21283-2');
  assert.equal(coords.pickerChunkToGameId('interior'), 'interior');
  assert.equal(coords.pickerChunkToGameSquare('interior'), null);
  assert.deepEqual(coords.ambiguous, []);
});

test('exact membership preserves empty cells, rectangle gaps and unrelated Citadels', () => {
  const coords = createGameCoordinates(world([15426, 14917, 16191, 16967, 16436]));
  for (const id of [13334, 13590, 14876, 20512, 21284, 14917, 16191, 16967]) {
    assert.equal(coords.gameSquareToPickerChunk(...point(id)), String(id), `no shifted record at ${id}`);
  }
  for (const id of [14917, 16191, 16967, 15427]) assert.equal(coords.pickerChunkToGameId(String(id)), String(id));
  const empty = createGameCoordinates(world([]));
  assert.equal(empty.gameSquareToPickerChunk(...point(21283)), '21283', 'unrelated datasets acquire no geography');
});

test('unwalkable legacy aliases outside the surface resolve to the displaced picker record', () => {
  const coords = createGameCoordinates(world([14878, 7093, 14915, 20772], { walkable: new Set(['14878', '14915']) }));
  assert.equal(coords.gameSquareToPickerChunk(...point(7093)), '14878');
  assert.equal(coords.gameSquareToPickerChunk(...point(20772)), '14915');
  assert.equal(coords.pickerChunkToGameId('7093'), '7093', 'the old alias remains usable on the wire');
  assert.deepEqual(coords.ambiguous, []);
});

test('real destination conflicts preserve normal walkable and surface records in both directions', () => {
  for (const extra of [{ walkable: new Set(['13592']) }, { surface: new Set(['13592']) }]) {
    const coords = createGameCoordinates(world([16436, 13592], extra));
    assert.equal(coords.gameSquareToPickerChunk(...point(13592)), '13592');
    assert.equal(coords.pickerChunkToGameId('16436'), '16436');
    assert.deepEqual(coords.ambiguous, [{ pickerId: '16436', gameId: '13592' }]);
  }
  const terrain = createGameCoordinates(world([16436, 13592], {
    chunks: new Map([['16436', {}], ['13592', { terrainOnly: true }]]), surface: new Set(['13592']),
  }));
  assert.equal(terrain.gameSquareToPickerChunk(...point(13592)), '16436', 'cache-only terrain has no separate picker identity');
});

test('tables reject a wrong shift, wrapped corner, invalid exclusion and overlapping areas', () => {
  assert.doesNotThrow(() => validateGameCoordinateAreas());
  const area = structuredClone(GAME_COORDINATE_AREAS[0]);
  for (const bad of [{ ...area, shift: [-30, 151] }, { ...area, game: [7085, 10428] },
    { ...area, picker: [14884, 18212] }, { ...area, excluded: [12850] }, { ...area, shift: [] }]) {
    assert.throws(() => createGameCoordinates(world([14878]), [bad]), TypeError);
  }
  assert.throws(() => createGameCoordinates(world([14878]), [area, area]), /Overlapping/);
  const duplicate = { name: 'Duplicate destination', picker: [12850, 12850], game: [7093, 7093], shift: [-23, 131], excluded: [] };
  const coords = createGameCoordinates(world([14878, 12850]), [area, duplicate]);
  assert.equal(coords.gameSquareToPickerChunk(...point(7093)), '7093');
  assert.equal(coords.ambiguous.length, 2);
});

test('invalid position inputs cannot wrap into a different map square', () => {
  const coords = createGameCoordinates(world([15426]));
  for (const args of [[-1, 0], [200, 0], [0, 256], [1.5, 2], ['83', 35]]) {
    assert.throws(() => coords.gameSquareToPickerChunk(...args), TypeError);
  }
  for (const id of ['1e4', '-1', '51200', '255', '15426-1']) assert.equal(coords.pickerChunkToGameSquare(id), null);
});
