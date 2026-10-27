// Map-square coordinates, not tiles. These authored transforms describe map
// layout only; membership comes from the selected world's existing records.
// See docs/game-coordinates.md for evidence and the remaining in-game checks.
export const GAME_COORDINATE_AREAS = Object.freeze([
  { name: 'Arc Islands', picker: [14870, 18212], game: [7085, 10427], shift: [-31, 151], excluded: [] },
  { name: 'Anachronia', picker: [14655, 16967], game: [20512, 22824], shift: [23, -31],
    // Unrelated Empyrean/Clan Citadel records inside the drawing's rectangle.
    excluded: [14917, 14918, 15174, 15175, 15687, 16191, 16711, 16959, 16967] },
  { name: 'Havenhythe', picker: [16176, 17720], game: [13332, 14876], shift: [-11, -28], excluded: [] },
  { name: 'Lost Grove', picker: [7471, 7986], game: [5206, 5721], shift: [-9, 39], excluded: [] },
].map(area => Object.freeze({ ...area, picker: Object.freeze(area.picker), game: Object.freeze(area.game),
  shift: Object.freeze(area.shift), excluded: Object.freeze(area.excluded) })));

const square = id => ({ x: Math.floor(Number(id) / 256), z: Number(id) % 256 });
const squareId = (x, z) => String(x * 256 + z);
const numeric = id => /^[1-9]\d*$/.test(String(id)) && Number.isSafeInteger(Number(id));
const validSquare = ({ x, z }) => Number.isInteger(x) && x >= 0 && x <= 199 && Number.isInteger(z) && z >= 0 && z <= 199;
const contains = (box, { x, z }) => {
  const sw = square(box[0]), ne = square(box[1]);
  return x >= sw.x && x <= ne.x && z >= sw.z && z <= ne.z;
};

/** Catch a transposed corner, wrapped z coordinate or inconsistent shift. */
export function validateGameCoordinateAreas(areas = GAME_COORDINATE_AREAS) {
  for (const area of areas) {
    const { picker, game, shift, excluded } = area;
    if (![picker, game, shift].every(row => Array.isArray(row) && row.length === 2)
      || !shift.every(Number.isInteger) || !Array.isArray(excluded)) throw new TypeError('Invalid game coordinate area.');
    for (const box of [picker, game]) {
      if (!box.every(id => numeric(id) && validSquare(square(id)))
        || square(box[0]).x > square(box[1]).x || square(box[0]).z > square(box[1]).z) {
        throw new TypeError('Invalid game coordinate box.');
      }
    }
    for (let corner = 0; corner < 2; corner++) {
      const p = square(picker[corner]), g = square(game[corner]);
      if (p.x + shift[0] !== g.x || p.z + shift[1] !== g.z) throw new TypeError('Game coordinate shift disagrees with its boxes.');
    }
    if (new Set(excluded).size !== excluded.length || excluded.some(id => !numeric(id) || !contains(picker, square(id)))) {
      throw new TypeError('Invalid game coordinate exclusion.');
    }
  }
}

/** Build once for the selected world. Empty box cells never acquire a mapping.
 * Nonwalkable records outside the normal surface are legacy game-position
 * aliases; the shifted picker record wins, as it does over cache-only terrain
 * records (which have no independent picker identity). A walkable or surface destination
 * is ambiguous: preserve its identity and leave the displaced source unmapped.
 * `ambiguous` exposes these refusals for inspection without changing the save.
 */
export function createGameCoordinates(world, areas = GAME_COORDINATE_AREAS) {
  validateGameCoordinateAreas(areas);
  const candidates = new Map(), destinations = new Map(), ambiguous = [];
  for (const [pickerId, record] of world.chunks) {
    if (!numeric(pickerId) || record.terrainOnly) continue;
    const point = square(pickerId);
    for (const area of areas) {
      if (!contains(area.picker, point) || area.excluded.includes(Number(pickerId))) continue;
      const gameId = squareId(point.x + area.shift[0], point.z + area.shift[1]);
      if (candidates.has(pickerId)) throw new TypeError('Overlapping picker coordinate areas.');
      candidates.set(pickerId, gameId);
      destinations.set(gameId, [...(destinations.get(gameId) ?? []), pickerId]);
    }
  }
  const toPicker = new Map(), toGame = new Map();
  for (const [pickerId, gameId] of candidates) {
    if (destinations.get(gameId).length > 1 || candidates.has(gameId)
      || world.chunks.has(gameId) && !world.chunks.get(gameId).terrainOnly
        && (world.walkable?.has(gameId) || world.surface?.has(gameId))) {
      ambiguous.push(Object.freeze({ pickerId, gameId }));
      continue;
    }
    toPicker.set(gameId, pickerId); toGame.set(pickerId, gameId);
  }
  return Object.freeze({
    ambiguous: Object.freeze(ambiguous),
    gameSquareToPickerChunk(x, z) {
      if (!validSquare({ x, z })) throw new TypeError('Expected a game map square in 0–199.');
      const id = squareId(x, z);
      return toPicker.get(id) ?? id;
    },
    pickerChunkToGameSquare(id) {
      if (!numeric(id) || !validSquare(square(id))) return null;
      return square(toGame.get(String(id)) ?? id);
    },
    // Wire IDs retain section suffixes on pending rolls; Lua displays these as
    // text. Nearby rows and current positions always use base map-square IDs.
    pickerChunkToGameId(id) {
      const [base, ...section] = String(id).split('-');
      return [toGame.get(base) ?? base, ...section].join('-');
    },
  });
}
