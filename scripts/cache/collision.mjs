/**
 * Offline, conservative surface collision analysis. No gameplay/access mutations.
 * Decoder contract: x/z are 64-tile region coordinates; tiles and locations are
 * rsmv parsed structs (or their arrays), optional nxttiles is the parsed NXT struct.
 * Optional sourceSquares supplies ORIGINAL decoded squares plus border anchors;
 * use it to include objects outside displayed terrain whose clipping spills in.
 * Display provenance sourceX/sourceY are original REGION coordinates and plane
 * fields describe layout offsets. Footprints project into every displayed copy.
 * Masks are x-major (x*64+z), with world z increasing north. Missing data is unknown.
 * Source: rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15,
 * src/3d/mapsquare.ts:858-927,1398-1428,1767-1865,1950-1964 and locs opcodes.
 * This models cache clipping, not quest scripts, transport, membership or live state.
 */
export const SURFACE_CROP = Object.freeze({ minX: 1856, maxX: 4863, minZ: 1408, maxZ: 4607 });
export const BLOCK = Object.freeze({ UNKNOWN: 1, TERRAIN: 2, WATER: 4, VOID: 8, OBJECT: 16, MORPH: 32 });
export const WALL = Object.freeze({ W: 1, N: 2, E: 4, S: 8, NW: 16, NE: 32, SE: 64, SW: 128 });
const DX = [-1, 0, 1, 0], DZ = [0, 1, 0, -1], TILE_COUNT = 4096;
const absentId = id => id == null || id < 0 || id === 32767 || id === 65535 || id === 16777215;
const regionId = (x, z) => String(x * 256 + z);
const index = (x, z) => x * 64 + z;
const lookup = (map, id) => map instanceof Map ? map.get(id) ?? map.get(String(id)) : map?.[id];

export function defaultMorphId(definition) {
  const a = definition.morphs_1 ?? definition.morphs_1_v2;
  const b = definition.morphs_2 ?? definition.morphs_2_v2;
  const id = b ? b.unk2 : a ? a.options?.[0] ?? a.default : -1;
  return absentId(id) ? -1 : id;
}

function morphInfo(definition) {
  const a = definition.morphs_1 ?? definition.morphs_1_v2;
  const b = definition.morphs_2 ?? definition.morphs_2_v2;
  const morph = b ?? a;
  return morph ? { varbit: morph.varbit, varp: morph.varp,
    defaultId: defaultMorphId(definition), options: [...new Set([...(morph.options ?? []), morph.default, b?.unk2]
      .filter(id => id != null))] } : null;
}

function terrain(square, plane, x, z) {
  const java = square.tiles?.tiles ?? square.tiles;
  const t = java?.[plane * TILE_COUNT + index(x, z)];
  const nxt = square.nxttiles?.[`level${plane}`]?.[(x + 1) * 66 + z + 1];
  if (nxt) return { settings: (nxt.flags & 2 ? 1 : 0) | (nxt.flags & 4 ? 2 : 0),
    water: !!(nxt.flags & 16), floor: !!(nxt.flags & 1), source: 'nxt' };
  if (!t) return null;
  return { settings: t.settings ?? 0, water: !!((t.settings ?? 0) & 128),
    floor: !!(t.underlay || t.overlay), source: 'java' };
}

function makeRegion(x, z, square, crop) {
  const id = regionId(x, z), reasons = new Uint8Array(TILE_COUNT), planes = new Uint8Array(TILE_COUNT), water = new Uint8Array(TILE_COUNT);
  const issues = [], terrainCounts = { blocked: 0, water: 0, void: 0, unknown: 0, bridge: 0 };
  let decoded = 0;
  for (let tx = 0; tx < 64; tx++) for (let tz = 0; tz < 64; tz++) {
    const i = index(tx, tz), wx = x * 64 + tx, wz = z * 64 + tz;
    if (wx < crop.minX || wx > crop.maxX || wz < crop.minZ || wz > crop.maxZ || !square) {
      reasons[i] = BLOCK.UNKNOWN; terrainCounts.unknown++; continue;
    }
    const bridge = !!((terrain(square, 1, tx, tz)?.settings ?? 0) & 2);
    planes[i] = bridge ? 1 : 0;
    const t = terrain(square, planes[i], tx, tz);
    if (!t) { reasons[i] = BLOCK.UNKNOWN; terrainCounts.unknown++; continue; }
    decoded++;
    if (bridge) terrainCounts.bridge++;
    if (t.settings & 1) { reasons[i] |= BLOCK.TERRAIN; terrainCounts.blocked++; }
    // NXT water16 describes rendered water, including partially shaped shores.
    // Only blocking2 (translated settings1) establishes terrain clipping. For
    // example Lumbridge source(3233,3257) has water17, shape20, and no blocking.
    if (t.water) { water[i] = 1; terrainCounts.water++; if (t.settings & 1) reasons[i] |= BLOCK.WATER; }
    // Blank decoded ground is not evidence of a walkable floor. In particular,
    // empty/ocean maps and missing planes must never become a traversable shortcut.
    if (!t.floor) { reasons[i] |= BLOCK.VOID; terrainCounts.void++; }
  }
  const hasLocations = Array.isArray(square?.locations?.locations ?? square?.locations);
  if (square && !hasLocations) issues.push({ code: 'missing-locations' });
  if (square?.error) issues.push({ code: 'source-error', message: String(square.error) });
  // Terrain alone cannot establish clipping when its object archive failed.
  if (square && (!hasLocations || square.error)) for (let i = 0; i < TILE_COUNT; i++) reasons[i] |= BLOCK.UNKNOWN;
  return { id, x, z, status: !square ? 'missing' : square.error ? 'error' : decoded < TILE_COUNT || !hasLocations ? 'partial' : 'decoded',
    provenance: square?.provenance ?? null, reasons, planes, water, walls: new Uint8Array(TILE_COUNT),
    terrainCounts, issues, componentMasks: null, components: [] };
}

function address(regions, x, z) {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return null;
  const r = regions.get(regionId(Math.floor(x / 64), Math.floor(z / 64)));
  return r ? { r, i: index(x - r.x * 64, z - r.z * 64) } : null;
}

function sourceTranslation(region) {
  const p = region.provenance;
  return p && Number.isInteger(p.sourceX) && Number.isInteger(p.sourceY)
    ? { x: (p.sourceX - region.x) * 64, z: (p.sourceY - region.z) * 64,
      plane: (p.sourcePlane ?? 0) - (p.destinationPlane ?? 0) } : null;
}

function continuous(a, b) {
  if (a === b) return true;
  const ta = sourceTranslation(a), tb = sourceTranslation(b);
  // Synthetic/untransformed fixtures without layout provenance are identity.
  // A supplied layout cannot turn geographically distant source blocks into
  // walking neighbors merely by pasting them alongside one another on a map.
  return !ta || !tb || ta.x === tb.x && ta.z === tb.z && ta.plane === tb.plane;
}

function sourcePoint(a) {
  const shift = sourceTranslation(a.r) ?? { x: 0, z: 0, plane: 0 };
  return { x: a.r.x * 64 + (a.i >> 6) + shift.x, z: a.r.z * 64 + (a.i & 63) + shift.z,
    plane: shift.plane + a.r.planes[a.i] };
}

function sourceRegionIndex(regions) {
  const result = new Map();
  for (const r of regions.values()) {
    const shift = sourceTranslation(r) ?? { x: 0, z: 0, plane: 0 };
    const key = `${r.x + shift.x / 64}:${r.z + shift.z / 64}:${shift.plane}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(r);
  }
  return result;
}

function sourceTargets(sourceIndex, x, z, plane) {
  const rx = Math.floor(x / 64), rz = Math.floor(z / 64), i = index(x - rx * 64, z - rz * 64);
  return (sourceIndex.get(`${rx}:${rz}:${plane}`) ?? []).map(r => ({ r, i }));
}

function collisionShape(definition, use) {
  if (definition.walkable) return [];
  let width = definition.width ?? 1, length = definition.length ?? 1;
  if (use.rotation & 1) [width, length] = [length, width];
  // Decorations 4..8 do not clip; floor decorations only clip with opcode 27.
  if (use.type >= 4 && use.type <= 8 || use.type === 22 && !definition.blocks_movement) return [];
  if (![0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].includes(use.type)) return [];
  const shape = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < length; z++) {
    const rotation = use.rotation & 3;
    const walls = use.type === 0 ? 1 << rotation : use.type === 2 ? (1 << rotation) | (1 << ((rotation + 1) & 3))
      : use.type === 1 || use.type === 3 ? 16 << rotation : 0;
    shape.push({ x, z, walls, center: !walls });
  }
  return shape;
}

// Loc width and length are unsigned-byte opcodes (14/15), bounding an unknown
// decoded definition to 255x255. Rotation swaps dimensions but placement remains
// northeast of the anchor. Include a tile halo for reciprocal wall/corner flags.
function unknownFootprint(sourceIndex, { x, z, plane }, issue) {
  const minX = x - 1, maxX = x + 255, minZ = z - 1, maxZ = z + 255;
  for (let rx = Math.floor(minX / 64); rx <= Math.floor(maxX / 64); rx++)
    for (let rz = Math.floor(minZ / 64); rz <= Math.floor(maxZ / 64); rz++) {
      for (const r of sourceIndex.get(`${rx}:${rz}:${plane}`) ?? []) {
        for (let tx = Math.max(0, minX - rx * 64); tx <= Math.min(63, maxX - rx * 64); tx++)
          for (let tz = Math.max(0, minZ - rz * 64); tz <= Math.min(63, maxZ - rz * 64); tz++)
            r.reasons[index(tx, tz)] |= BLOCK.UNKNOWN;
        if (r.status === 'decoded') r.status = 'partial';
        r.issues.push({ ...issue, code: 'unknown-object-footprint', cause: issue.code,
          sourceBounds: { minX, maxX, minZ, maxZ, plane } });
      }
    }
}

function morphShapes(rawId, raw, use, definitions) {
  if (!morphInfo(raw)) return { shape: collisionShape(raw, use), branches: [], problems: [] };
  const parts = new Map(), branches = [], problems = [];
  let visited = 0;
  function add(definition) {
    for (const part of collisionShape(definition, use)) {
      const key = `${part.x}:${part.z}`, existing = parts.get(key);
      if (existing) { existing.walls |= part.walls; existing.center ||= part.center; }
      else parts.set(key, { ...part });
    }
  }
  function visit(id, definition, inherited, path) {
    if (path.includes(id)) { problems.push({ code: 'morph-cycle', path: [...path, id] }); return; }
    if (++visited > 2048) { problems.push({ code: 'morph-traversal-limit', locId: id }); return; }
    const merged = { ...inherited, ...definition };
    // Pinned rsmv retains outer raw flags even when a morph is walkable. Retain
    // those flags for every branch's dimensions, then union branch-state clipping
    // as a conservative bound where a live client interprets its flags instead.
    add({ ...merged, walkable: raw.walkable, blocks_movement: raw.blocks_movement });
    if (!!merged.walkable !== !!raw.walkable || !!merged.blocks_movement !== !!raw.blocks_movement) add(merged);
    const info = morphInfo(definition);
    if (!info) return;
    branches.push({ locId: id, path: [...path, id], ...info });
    for (const next of info.options) {
      if (absentId(next)) continue;
      const option = lookup(definitions, next);
      if (!option) { problems.push({ code: 'missing-morph-definition', locId: next, path: [...path, id, next] }); continue; }
      visit(next, option, merged, [...path, id]);
    }
  }
  visit(rawId, raw, {}, []);
  return { shape: [...parts.values()], branches, problems };
}

function applyShape(sourceIndex, { x, z, plane }, shape, extraReason = 0) {
  for (const part of shape) {
    for (const a of sourceTargets(sourceIndex, x + part.x, z + part.z, plane)) {
      if (part.center) a.r.reasons[a.i] |= BLOCK.OBJECT | extraReason;
      a.r.walls[a.i] |= part.walls;
    }
    // Resolve source-game neighbors, then project every displayed copy. The
    // anchor and its neighbor can occupy unrelated display locations or the
    // anchor can lie completely outside the displayed crop.
    for (let d = 0; d < 4; d++) if (part.walls & (1 << d)) {
      for (const b of sourceTargets(sourceIndex, x + part.x + DX[d], z + part.z + DZ[d], plane))
        b.r.walls[b.i] |= 1 << ((d + 2) & 3);
    }
    for (let d = 0; d < 4; d++) if (part.walls & (16 << d)) {
      const diagonalX = [-1, 1, 1, -1][d], diagonalZ = [1, 1, -1, -1][d];
      for (const b of sourceTargets(sourceIndex, x + part.x + diagonalX, z + part.z + diagonalZ, plane))
        b.r.walls[b.i] |= 16 << ((d + 2) & 3);
    }
  }
}

function mayStep(a, b, direction) {
  return a && b && !a.r.reasons[a.i] && !b.r.reasons[b.i]
    && !(a.r.walls[a.i] & (1 << direction)) && !(b.r.walls[b.i] & (1 << ((direction + 2) & 3)))
    && continuous(a.r, b.r);
}

function components(regions, seamDiagnostics = []) {
  for (const r of regions.values()) {
    const labels = new Uint16Array(TILE_COUNT), walkable = new Uint8Array(TILE_COUNT), queue = new Uint16Array(TILE_COUNT);
    r.componentMasks = labels; r.walkable = walkable;
    for (let i = 0; i < TILE_COUNT; i++) walkable[i] = r.reasons[i] === 0 ? 1 : 0;
    for (let first = 0; first < TILE_COUNT; first++) {
      if (!walkable[first] || labels[first]) continue;
      const label = r.components.length + 1, firstX = first >> 6, firstZ = first & 63;
      const component = { id: `${r.id}:${label}`, label, tiles: 0,
        minX: r.x * 64 + firstX, maxX: r.x * 64 + firstX, minZ: r.z * 64 + firstZ, maxZ: r.z * 64 + firstZ,
        sample: { x: r.x * 64 + firstX, z: r.z * 64 + firstZ }, boundaryTiles: { W: [], N: [], E: [], S: [] } };
      let head = 0, tail = 1; queue[0] = first; labels[first] = label;
      while (head < tail) {
        const i = queue[head++], x = i >> 6, z = i & 63, wx = r.x * 64 + x, wz = r.z * 64 + z;
        component.tiles++;
        component.minX = Math.min(component.minX, wx); component.maxX = Math.max(component.maxX, wx);
        component.minZ = Math.min(component.minZ, wz); component.maxZ = Math.max(component.maxZ, wz);
        if (x === 0) component.boundaryTiles.W.push(z);
        if (z === 63) component.boundaryTiles.N.push(x);
        if (x === 63) component.boundaryTiles.E.push(z);
        if (z === 0) component.boundaryTiles.S.push(x);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (nx < 0 || nx > 63 || nz < 0 || nz > 63) continue;
          const ni = index(nx, nz);
          if (!labels[ni] && mayStep({ r, i }, { r, i: ni }, d)) { labels[ni] = label; queue[tail++] = ni; }
        }
      }
      r.components.push(component);
    }
  }
  const edgeMap = new Map(), seamMap = new Map();
  for (const r of regions.values()) for (const d of [1, 2]) for (let t = 0; t < 64; t++) {
    const x = r.x * 64 + (d === 2 ? 63 : t), z = r.z * 64 + (d === 1 ? 63 : t);
    const a = address(regions, x, z), b = address(regions, x + DX[d], z + DZ[d]);
    if (a && b && !a.r.reasons[a.i] && !b.r.reasons[b.i]
      && !(a.r.walls[a.i] & (1 << d)) && !(b.r.walls[b.i] & (1 << ((d + 2) & 3))) && !continuous(a.r, b.r)) {
      const key = `${a.r.id}|${b.r.id}`;
      if (!seamMap.has(key)) seamMap.set(key, { code: 'non-contiguous-seam', from: a.r.id, to: b.r.id,
        direction: d === 1 ? 'N' : 'E', rejectedPortals: [] });
      seamMap.get(key).rejectedPortals.push({ x, z, toX: x + DX[d], toZ: z + DZ[d],
        source: sourcePoint(a), destinationSource: sourcePoint(b) });
    }
    if (!mayStep(a, b, d)) continue;
    const from = `${r.id}:${r.componentMasks[a.i]}`, to = `${b.r.id}:${b.r.componentMasks[b.i]}`, key = `${from}|${to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { from, to, direction: d === 1 ? 'N' : 'E', portals: [] });
    edgeMap.get(key).portals.push({ x, z, toX: x + DX[d], toZ: z + DZ[d] });
  }
  seamDiagnostics.push(...seamMap.values());
  return [...edgeMap.values()];
}

/** Explicit evidence is required to remove a door's clipping in the potential graph.
 * openableEvidence Map keys: loc id or `id@worldX,worldZ,plane`; values:
 * {passableWhenOpen:true,evidence:'source/review reference',conditions:[...]}.
 * Name and Open actions only produce candidate annotations, never open clipping.
 */
export function analyzeSurfaceCollision({ squares = [], sourceSquares = null, locDefinitions = new Map(), crop = SURFACE_CROP,
  openableEvidence = new Map(), membershipAt = null } = {}) {
  for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) if (!Number.isInteger(crop[k])) throw new TypeError(`Invalid crop ${k}`);
  if (crop.minX > crop.maxX || crop.minZ > crop.maxZ) throw new RangeError('Inverted crop');
  const bySquare = new Map();
  for (const s of squares) {
    if (!Number.isInteger(s.x) || !Number.isInteger(s.z)) throw new TypeError('Square coordinates must be region integers');
    const key = regionId(s.x, s.z);
    if (bySquare.has(key)) throw new Error(`Duplicate square ${key}`);
    bySquare.set(key, s);
  }
  const regions = new Map(), objects = [], doors = [], uncertainties = [];
  for (let x = Math.floor(crop.minX / 64); x <= Math.floor(crop.maxX / 64); x++)
    for (let z = Math.floor(crop.minZ / 64); z <= Math.floor(crop.maxZ / 64); z++)
      regions.set(regionId(x, z), makeRegion(x, z, bySquare.get(regionId(x, z)), crop));
  const sourceIndex = sourceRegionIndex(regions), rawSourceMode = sourceSquares != null;
  const objectSquares = rawSourceMode ? sourceSquares instanceof Map ? [...sourceSquares.values()] : sourceSquares : squares;
  if (!Array.isArray(objectSquares)) throw new TypeError('sourceSquares must be an array or Map of original decoded squares');
  for (const square of objectSquares) for (const loc of square.locations?.locations ?? square.locations ?? []) {
    const raw = lookup(locDefinitions, loc.id);
    for (const use of loc.uses ?? []) {
      const anchorX = square.x * 64 + use.x, anchorZ = square.z * 64 + (use.y ?? use.z);
      let origin;
      if (rawSourceMode) {
        const bridge = !!((terrain(square, 1, use.x, use.y ?? use.z)?.settings ?? 0) & 2);
        origin = { x: anchorX, z: anchorZ, plane: use.plane - (bridge ? 1 : 0) };
      } else {
        const a = address(regions, anchorX, anchorZ);
        if (!a || use.plane - a.r.planes[a.i] !== 0) continue;
        const shift = sourceTranslation(a.r) ?? { x: 0, z: 0, plane: 0 };
        origin = { x: anchorX + shift.x, z: anchorZ + shift.z, plane: shift.plane };
      }
      const displayAnchors = sourceTargets(sourceIndex, origin.x, origin.z, origin.plane).map(a => ({
        x: a.r.x * 64 + (a.i >> 6), z: a.r.z * 64 + (a.i & 63), regionId: a.r.id }));
      // Skip halo objects whose maximum legal footprint cannot touch this map.
      let affectsMap = displayAnchors.length > 0;
      for (let rx = Math.floor((origin.x - 1) / 64); !affectsMap && rx <= Math.floor((origin.x + 255) / 64); rx++)
        for (let rz = Math.floor((origin.z - 1) / 64); rz <= Math.floor((origin.z + 255) / 64); rz++)
          if (sourceIndex.has(`${rx}:${rz}:${origin.plane}`)) { affectsMap = true; break; }
      if (!affectsMap) continue;
      const x = displayAnchors[0]?.x ?? origin.x, z = displayAnchors[0]?.z ?? origin.z;
      const instance = { locId: loc.id, x, z, plane: use.plane, type: use.type, rotation: use.rotation,
        sourceX: origin.x, sourceZ: origin.z, effectiveSourcePlane: origin.plane, displayAnchors,
        coordinateSpace: displayAnchors.length ? 'display' : 'source' };
      if (!raw) {
        unknownFootprint(sourceIndex, origin, { code: 'missing-loc-definition', ...instance });
        uncertainties.push({ code: 'missing-loc-definition', ...instance }); continue;
      }
      const morph = morphInfo(raw), { shape, branches, problems } = morphShapes(loc.id, raw, use, locDefinitions);
      if (morph) {
        uncertainties.push({ code: 'conditional-morph', ...instance, ...morph, branches });
        for (const problem of problems) {
          const issue = { ...instance, ...problem };
          unknownFootprint(sourceIndex, origin, issue); uncertainties.push(issue);
        }
      }
      const actions = Object.entries(raw).filter(([key, value]) => /^actions_\d$/.test(key) && typeof value === 'string').map(([, value]) => value);
      const candidate = /\b(door|gate|portcullis)\b/i.test(raw.name ?? '') || actions.some(action => /^(open|close)$/i.test(action));
      const proof = lookup(openableEvidence, `${loc.id}@${x},${z},${use.plane}`) ?? lookup(openableEvidence, loc.id);
      const proven = proof?.passableWhenOpen === true && typeof proof.evidence === 'string' && proof.evidence.trim().length > 0;
      const affectedRegions = new Set();
      if (proven) for (const part of shape) {
        const coordinates = [[origin.x + part.x, origin.z + part.z]];
        for (let d = 0; d < 4; d++) if (part.walls & (1 << d))
          coordinates.push([origin.x + part.x + DX[d], origin.z + part.z + DZ[d]]);
        for (const [sx, sz] of coordinates) for (const a of sourceTargets(sourceIndex, sx, sz, origin.plane)) affectedRegions.add(a.r.id);
      }
      if (candidate || proven) doors.push({ ...instance, name: raw.name ?? null, actions, affectedRegions: [...affectedRegions],
        classification: proven ? 'evidenced-openable' : 'conditional-unverified',
        evidence: proven ? proof.evidence : null, conditions: proof?.conditions ?? [], morph,
        conditionHints: { quests: raw.quests ?? [], members: !!(raw.is_members || raw.isMembers) } });
      objects.push({ origin, shape, morph: !!morph, proven });
      if (use.extra) uncertainties.push({ code: 'custom-placement', ...instance, extra: use.extra });
    }
  }
  // Keep a terrain copy only where a second scenario is actually justified.
  let potentialRegions = null;
  if (objects.some(o => o.proven)) potentialRegions = new Map([...regions].map(([id, r]) => [id, {
    ...r, reasons: r.reasons.slice(), walls: new Uint8Array(TILE_COUNT), components: [], componentMasks: null,
  }]));
  const potentialSourceIndex = potentialRegions ? sourceRegionIndex(potentialRegions) : null;
  for (const o of objects) {
    applyShape(sourceIndex, o.origin, o.shape, o.morph ? BLOCK.MORPH : 0);
    if (potentialRegions && !o.proven) applyShape(potentialSourceIndex, o.origin, o.shape, o.morph ? BLOCK.MORPH : 0);
  }
  const nonContiguousSeams = [], edges = components(regions, nonContiguousSeams),
    potentialEdges = potentialRegions ? components(potentialRegions) : null;
  uncertainties.push(...nonContiguousSeams);
  const summary = { crop: { ...crop }, regionCount: regions.size, coverage: {}, walkableTiles: 0, components: 0,
    boundaryEdges: edges.length, doors: { evidenced: doors.filter(d => d.classification === 'evidenced-openable').length,
      unverified: doors.filter(d => d.classification === 'conditional-unverified').length },
    conditionalMorphs: uncertainties.filter(u => u.code === 'conditional-morph').length,
    sourceCollision: { mode: rawSourceMode ? 'original-squares' : 'display-squares', squares: objectSquares.length,
      borderAnchorsSupplied: rawSourceMode },
    nonContiguousSeams: { boundaries: nonContiguousSeams.length,
      rejectedPortals: nonContiguousSeams.reduce((n, seam) => n + seam.rejectedPortals.length, 0) },
    assumptions: ['Closed static cache baseline; nested morphs conservatively union all branch clipping while preserving raw collision flags',
      'Unknown loc/morph definitions and cycles exclude a 255-tile northeast footprint plus reciprocal wall halo',
      'Walking cannot cross noncontiguous pasted seams; object clipping projects original-game footprints into all displayed copies',
      'No-floor tiles excluded; terrain blocking flag controls water clipping; water presence retained separately; four cardinal movement connections',
      'No transport, stairs, game scripts or membership inferred; potential scenario preserves evidence conditions'] };
  for (const r of regions.values()) {
    summary.coverage[r.status] = (summary.coverage[r.status] ?? 0) + 1;
    summary.walkableTiles += r.components.reduce((n, c) => n + c.tiles, 0); summary.components += r.components.length;
  }
  const scenario = name => {
    if (name === 'potential' && potentialRegions) return { regions: potentialRegions, edges: potentialEdges };
    if (name !== 'closed' && name !== undefined && name !== 'potential') throw new Error(`Unknown scenario ${name}`);
    return { regions, edges };
  };
  function query(x, z, name = 'closed') {
    const graph = scenario(name), a = address(graph.regions, x, z);
    if (!a) return { x, z, status: 'outside-crop', walkable: false, known: false, component: null };
    const label = a.r.componentMasks[a.i];
    return { x, z, regionId: a.r.id, status: a.r.status, known: !(a.r.reasons[a.i] & BLOCK.UNKNOWN),
      walkable: !!a.r.walkable[a.i], blockMask: a.r.reasons[a.i], wallMask: a.r.walls[a.i],
      sourcePlane: a.r.planes[a.i], water: !!a.r.water[a.i], component: label ? `${a.r.id}:${label}` : null,
      membership: membershipAt ? membershipAt(x, z, a.r.planes[a.i]) : 'unknown' };
  }
  function reachable({ starts = [], claimed, scenario: name = 'closed' } = {}) {
    if (!(claimed instanceof Set) && !Array.isArray(claimed)) throw new TypeError('An explicit claimed region set is required');
    const allowed = new Set([...claimed].map(String)), graph = scenario(name), adjacency = new Map(), reached = new Set(), queue = [];
    const valid = new Set([...graph.regions.values()].flatMap(r => r.components.map(c => c.id)));
    const admit = component => { if (valid.has(component) && allowed.has(component.split(':')[0]) && !reached.has(component)) { reached.add(component); queue.push(component); } };
    for (const e of graph.edges) {
      if (!allowed.has(e.from.split(':')[0]) || !allowed.has(e.to.split(':')[0])) continue;
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      if (!adjacency.has(e.to)) adjacency.set(e.to, []);
      adjacency.get(e.from).push(e.to); adjacency.get(e.to).push(e.from);
    }
    for (const start of starts) admit(typeof start === 'string' ? start : query(start.x, start.z, name).component);
    for (let head = 0; head < queue.length; head++) for (const next of adjacency.get(queue[head]) ?? []) admit(next);
    return { components: [...reached], regions: [...new Set([...reached].map(c => c.split(':')[0]))],
      conditions: name === 'potential' ? doors.filter(d => d.classification === 'evidenced-openable' && d.affectedRegions.some(id => allowed.has(id)))
        .map(d => ({ locId: d.locId, x: d.x, z: d.z, evidence: d.evidence, conditions: d.conditions })) : [] };
  }
  return { summary, regions, edges, doors, uncertainties,
    potential: potentialRegions ? { regions: potentialRegions, edges: potentialEdges } : null, query, reachable };
}

/** Compact portable masks; component IDs are local stable scan-order labels. */
export function serializeCollision(analysis, { includeMasks = true } = {}) {
  const graph = regions => [...regions.values()].map(r => ({ id: r.id, x: r.x, z: r.z, status: r.status,
    provenance: r.provenance, terrainCounts: r.terrainCounts, issues: r.issues, components: r.components,
    ...(includeMasks ? { masks: { encoding: 'base64', order: 'x*64+z', reasons: Buffer.from(r.reasons).toString('base64'),
      walls: Buffer.from(r.walls).toString('base64'), planes: Buffer.from(r.planes).toString('base64'),
      water: Buffer.from(r.water).toString('base64'),
      components: encodeComponents(r.componentMasks), componentType: 'uint16-le' } } : {}) }));
  return { schemaVersion: 1, summary: analysis.summary, regions: graph(analysis.regions), edges: analysis.edges,
    doors: analysis.doors, uncertainties: analysis.uncertainties,
    potential: analysis.potential ? { regions: graph(analysis.potential.regions), edges: analysis.potential.edges } : null };
}

function encodeComponents(labels) {
  const bytes = Buffer.alloc(labels.length * 2);
  for (let i = 0; i < labels.length; i++) bytes.writeUInt16LE(labels[i], i * 2);
  return bytes.toString('base64');
}
