import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { loadSurfaceLayout, sourceToSurface, inCrop, unpackCoord, mapsquareId, PICKER_CROP } from './surface.mjs';

const validId = id => Number.isInteger(id) && id >= 0 && id !== 32767 && id !== 65535 && id !== 16777215;
const stableId = parts => `cache-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
export function plainLabel(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
}
export function morphInfo(loc) {
  const first = loc.morphs_1 ?? loc.morphs_1_v2;
  const second = loc.morphs_2 ?? loc.morphs_2_v2;
  if (!first && !second) return null;
  const value = second ?? first;
  // This is the pinned renderer's default selection, not a current-player value.
  const defaultId = second ? second.unk2 : (first.options[0] ?? first.default);
  return { kind: second ? 'morphs_2' : 'morphs_1', ...value, defaultId: validId(defaultId) ? defaultId : null };
}

export function createDefinitionResolver(readLoc, readLabel) {
  const locations = new Map(), elements = new Map();
  const getLoc = id => { if (!locations.has(id)) locations.set(id, readLoc(id)); return locations.get(id); };
  const getLabel = id => { if (!elements.has(id)) elements.set(id, readLabel(id)); return elements.get(id); };
  function resolveLabel(id, seen = []) {
    if (!validId(id)) return null;
    if (seen.includes(id)) throw new Error(`Map-element default cycle: ${[...seen, id].join(' -> ')}`);
    const raw = getLabel(id);
    if (!raw) throw new Error(`Missing map-element ${id}`);
    const sw = raw.legacy_switch_v2 ?? raw.legacy_switch;
    if (sw && validId(sw.default_ref)) {
      const child = resolveLabel(sw.default_ref, [...seen, id]);
      return { originalId: id, resolvedId: child.resolvedId, definition: { ...raw, ...child.definition },
        conditions: [{ kind: 'legacy-switch', elementId: id, ...sw }, ...child.conditions],
        alternate: validId(sw.legacy_ref) ? { elementId: sw.legacy_ref, definition: getLabel(sw.legacy_ref) } : null };
    }
    return { originalId: id, resolvedId: id, definition: raw, conditions: [], alternate: null };
  }
  function resolveObject(id, seen = []) {
    if (seen.includes(id)) throw new Error(`Object default morph cycle: ${[...seen, id].join(' -> ')}`);
    const raw = getLoc(id);
    if (!raw) throw new Error(`Missing object definition ${id}`);
    const morph = morphInfo(raw);
    if (morph?.defaultId != null) {
      const child = resolveObject(morph.defaultId, [...seen, id]);
      return { originalId: id, resolvedId: child.resolvedId, definition: { ...raw, ...child.definition },
        morphs: [{ objectId: id, ...morph }, ...child.morphs] };
    }
    return { originalId: id, resolvedId: id, definition: raw, morphs: morph ? [{ objectId: id, ...morph }] : [] };
  }
  // Keep every conditional branch with its selector path; never mark it currently active.
  function alternateElements(id, seen = [], conditions = []) {
    if (!validId(id) || seen.includes(id)) return [];
    const loc = getLoc(id);
    if (!loc) throw new Error(`Missing alternate object definition ${id}`);
    const result = validId(loc.maplabel) ? [{ objectId: id, elementId: loc.maplabel,
      element: resolveLabel(loc.maplabel), conditions }] : [];
    const morph = morphInfo(loc);
    if (morph) {
      const branches = [...morph.options.map((objectId, option) => ({ objectId, option })),
        { objectId: morph.default, option: 'encoded-tail' },
        ...(morph.kind === 'morphs_2' ? [{ objectId: morph.unk2, option: 'fallback' }] : [])];
      for (const branch of branches) if (validId(branch.objectId)) result.push(...alternateElements(branch.objectId,
        [...seen, id], [...conditions, { kind: 'object-morph', objectId: id, varbit: morph.varbit,
          varp: morph.varp, option: branch.option, selectedObjectId: branch.objectId }]));
    }
    return result;
  }
  return { getLoc, getLabel, resolveLabel, resolveObject, alternateElements, locations, elements };
}

function elementConditions(resolved) {
  const def = resolved.definition;
  return [...resolved.conditions, ...['toggle_1', 'toggle_2', 'toggle_1_v2', 'toggle_2_v2']
    .filter(key => def[key]).map(key => ({ kind: key, ...def[key] })),
  ...['unknown_07', 'unknown_08', 'unknown_1c', 'unknown_1e'].filter(key => def[key] !== undefined)
    .map(key => ({ kind: 'uninterpreted-element-setting', field: key, value: def[key] }))];
}
function elementFields(element) {
  const def = element.definition;
  return { elementId: element.originalId, resolvedElementId: element.resolvedId,
    spriteId: validId(def.sprite) ? def.sprite : null, hoverSpriteId: validId(def.sprite_hover) ? def.sprite_hover : null,
    backgroundSpriteId: validId(def.background_sprite) ? def.background_sprite : null,
    category: def.category ?? null, label: plainLabel(def.text), labelOrigin: def.text ? 'cache-map-element-text' : 'none',
    conditions: elementConditions(element), legacyAlternate: element.alternate,
    elementDefinition: def };
}

/** Offline diagnostic export only. No player varbits/varps or access rules are available. */
export function exportPins(cache, { layout = loadSurfaceLayout(cache), crop = PICKER_CROP,
  progress = () => {}, squares = null, locDefinitions = null } = {}) {
  const labels = cache.archive(2, 36);
  if (!labels) throw new Error('Copied map-element definitions missing');
  const resolver = createDefinitionResolver(id => locDefinitions ? locDefinitions.get(id) : cache.object(16, id, 'loc'), id => {
    const bytes = labels.get(id); return bytes ? cache.decoders.decode('labels', bytes) : null;
  });
  const pins = [], exclusions = [], counts = { explicit: 0, object: 0, textOnly: 0, alternateElements: 0,
    sourceRegions: 0, missingLocationArchives: 0, missingExplicitArchive: 0 };
  function place(source, element, extra = {}) {
    const destinations = sourceToSurface(layout, source.x, source.y, source.renderPlane ?? source.plane);
    if (!destinations.length) { exclusions.push({ reason: 'no-surface-paste', source }); return; }
    for (const display of destinations) {
      if (!inCrop(display.x, display.y, crop)) continue;
      const fields = elementFields(element);
      if (fields.spriteId == null && !fields.label) continue;
      const id = stableId([source.kind, source.identity, layout.mapId, display.x, display.y, display.plane]);
      pins.push({ id, x: display.x, y: display.y, plane: display.plane, mapId: layout.mapId,
        chunkId: String(Math.floor(display.x / 64) * 256 + Math.floor(display.y / 64)),
        ...fields, ...extra, source, surfaceTransform: display.mapping });
      counts[source.kind]++;
      if (fields.spriteId == null) counts.textOnly++;
    }
  }
  const explicit = cache.file(42, layout.mapId);
  if (!explicit) counts.missingExplicitArchive++;
  else {
    const repeated = new Map();
    for (const [index, row] of cache.decoders.decode('labelLocations', explicit).entries()) {
      const point = unpackCoord(row.location), key = `${row.labelId}:${row.location}`;
      const ordinal = repeated.get(key) ?? 0; repeated.set(key, ordinal + 1);
      place({ kind: 'explicit', identity: [row.labelId, row.location, ordinal], ...point,
        cache: { major: 42, minor: layout.mapId, index }, conditional: row.conditional },
      resolver.resolveLabel(row.labelId), { placementConditional: row.conditional });
    }
  }
  const regions = new Map();
  for (const mapping of layout.blocks.values()) {
    if (!inCrop(mapping.destination.x, mapping.destination.y, crop)) continue;
    const rx = Math.floor(mapping.source.x / 64), ry = Math.floor(mapping.source.y / 64);
    regions.set(mapsquareId(rx, ry), { rx, ry });
  }
  const definitionIds = new Set();
  for (const [minor, { rx, ry }] of regions) {
    counts.sourceRegions++;
    const supplied = squares?.get(minor) ?? (squares ? [...squares.values()].find(q => q.x === rx && q.z === ry) : null);
    const archive = supplied ? null : cache.archive(5, minor);
    const bytes = archive?.get(0);
    const locations = supplied?.locations ?? (bytes ? cache.decoders.decode('locations', bytes) : null);
    if (!locations) { counts.missingLocationArchives++; exclusions.push({ reason: 'missing-source-locations', minor, rx, ry }); continue; }
    const tiles = supplied?.tiles ?? (archive?.get(3) ? cache.decoders.decode('tiles', archive.get(3)) : null);
    const nxttiles = supplied?.nxttiles ?? (archive?.get(5) ? cache.decoders.decode('nxt', archive.get(5)) : null);
    const repeated = new Map();
    for (const loc of locations.locations) {
      definitionIds.add(loc.id);
      const resolved = resolver.resolveObject(loc.id), labelId = resolved.definition.maplabel;
      const alternates = resolver.alternateElements(loc.id).map(alt => ({ objectId: alt.objectId,
        ...elementFields(alt.element), morphConditions: alt.conditions }));
      if (!validId(labelId)) {
        if (alternates.length) exclusions.push({ reason: 'alternate-element-without-default-element', minor,
          objectId: loc.id, uses: loc.uses, alternates });
        continue;
      }
      const element = resolver.resolveLabel(labelId);
      for (const [index, use] of loc.uses.entries()) {
        const x = rx * 64 + use.x, y = ry * 64 + use.y;
        const tileSettings = (plane) => {
          const nxt = nxttiles?.[`level${plane}`]?.[(use.x + 1) * 66 + use.y + 1];
          if (nxt) return { bridge: !!(nxt.flags & 4), forcedDraw: !!(nxt.flags & 32), flags: nxt.flags, format: 'nxt' };
          const tile = tiles?.tiles?.[plane * 4096 + use.x * 64 + use.y];
          return { bridge: !!((tile?.settings ?? 0) & 2), forcedDraw: !!((tile?.settings ?? 0) & 8),
            flags: tile?.settings ?? null, format: tile ? 'classic' : 'missing' };
        };
        const bridge = tileSettings(1), own = tileSettings(use.plane);
        const renderPlane = use.plane - (bridge.bridge ? 1 : 0);
        if (!sourceToSurface(layout, x, y, renderPlane).some(q => inCrop(q.x, q.y, crop))) continue;
        const key = `${loc.id}:${use.x}:${use.y}:${use.plane}:${use.type}:${use.rotation}`;
        const ordinal = repeated.get(key) ?? 0; repeated.set(key, ordinal + 1);
        place({ kind: 'object', identity: [minor, key, ordinal], x, y, plane: use.plane, renderPlane,
          cache: { major: 5, minor, subid: 0, index }, objectId: loc.id, type: use.type,
          rotation: use.rotation, extra: use.extra }, element, { resolvedObjectId: resolved.resolvedId,
          objectName: plainLabel(resolved.definition.name), morphs: resolved.morphs,
          alternates, planeProjection: { bridge, own, effectivePlane: renderPlane,
            method: 'pinned-renderer-bridge-effective-level' },
          defaultSelection: resolved.morphs.length ? 'pinned-renderer-default-no-player-state' : 'unconditional-object' });
        counts.alternateElements += alternates.length;
      }
    }
    if (counts.sourceRegions % 50 === 0) progress({ ...counts, pins: pins.length });
  }
  pins.sort((a, b) => a.x - b.x || a.y - b.y || (a.spriteId ?? -1) - (b.spriteId ?? -1) || a.id.localeCompare(b.id));
  if (new Set(pins.map(pin => pin.id)).size !== pins.length) throw new Error('Duplicate stable pin identity');
  return { schemaVersion: 1, exportType: 'cache-diagnostic', mapId: layout.mapId, plane: layout.plane,
    crop, pins, counts: { ...counts, pins: pins.length, objectDefinitions: definitionIds.size,
      distinctSprites: new Set(pins.filter(p => p.spriteId != null).map(p => p.spriteId)).size }, exclusions,
    limits: ['No current player varbits/varps; conditional alternates are retained without claiming simultaneous visibility.',
      'Bridge effective planes follow decoded NXT/classic tile flags. Forced-draw visual flags are preserved without overriding object icon planes.',
      'Missing copied source archives are reported; cache freshness is supplied by the caller.'] };
}

export function extractSurfacePins({ cache, layout, locDefinitions, squares, crop, progress }) {
  return exportPins(cache, { layout, locDefinitions, squares, crop, progress });
}

export function comparePinSnapshots(current, baseline) {
  const currentRows = current.pins ?? current, baselineRows = baseline.pins ?? baseline;
  const key = pin => `${pin.mapId ?? 28}:${pin.plane ?? 0}:${pin.x}:${pin.y}:${pin.spriteId ?? 'text'}`;
  const index = rows => { const result = new Map(); for (const row of rows) {
    const k = key(row); if (!result.has(k)) result.set(k, []); result.get(k).push(row.id);
  } return result; };
  const after = index(currentRows), before = index(baselineRows);
  const numericCategory = row => {
    const value = row.category ?? row.conditions?.icon?.unk_19 ?? row.conditions?.properties?.unk_19;
    return Number.isInteger(value) ? value : null;
  };
  const categoryKey = row => `${row.mapId ?? 28}:${row.plane ?? 0}:${row.x}:${row.y}:${numericCategory(row)
    ?? (row.spriteId == null ? `text:${plainLabel(row.label)}` : `unclassified-sprite:${row.spriteId}`)}`;
  const categoryIndex = rows => {
    const result = new Map();
    for (const row of rows) {
      const placement = categoryKey(row);
      if (!result.has(placement)) result.set(placement, { placement, x: row.x, y: row.y, mapId: row.mapId ?? 28,
        plane: row.plane ?? 0, category: numericCategory(row), ids: [], spriteIds: [], labels: [], objectIds: [] });
      const group = result.get(placement);
      group.ids.push(row.id);
      if (row.spriteId != null && !group.spriteIds.includes(row.spriteId)) group.spriteIds.push(row.spriteId);
      // Category names such as "Bank" cannot identify one particular facility.
      const label = plainLabel(row.label);
      if (label && !['category', 'none', undefined, null].includes(row.labelOrigin) && !group.labels.includes(label)) group.labels.push(label);
      const objectId = row.source?.objectId ?? row.objectId;
      if (Number.isInteger(objectId) && !group.objectIds.includes(objectId)) group.objectIds.push(objectId);
    }
    for (const group of result.values()) group.spriteIds.sort((a,b) => a-b);
    return result;
  };
  const categoryAfter = categoryIndex(currentRows), categoryBefore = categoryIndex(baselineRows);
  const matched = [...categoryAfter.keys()].filter(k => categoryBefore.has(k));
  const spriteChanges = matched.filter(k => categoryAfter.get(k).category != null)
    .map(placementAndCategory => ({ placementAndCategory, baselineSpriteIds: categoryBefore.get(placementAndCategory).spriteIds,
      currentSpriteIds: categoryAfter.get(placementAndCategory).spriteIds }))
    .filter(q => JSON.stringify(q.baselineSpriteIds) !== JSON.stringify(q.currentSpriteIds));
  const semanticAdded = [...categoryAfter.values()].filter(q => !categoryBefore.has(q.placement));
  const semanticRemoved = [...categoryBefore.values()].filter(q => !categoryAfter.has(q.placement));
  const usedAfter = new Set(), usedBefore = new Set(), movedCandidates = [];
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const sameSurface = (a,b) => a.mapId === b.mapId && a.plane === b.plane;
  function candidate(old, next, method, evidence) {
    const id = stableId(['move-candidate', old.placement, next.placement]);
    movedCandidates.push({ id, baseline: old, current: next, from: { x: old.x, y: old.y, mapId: old.mapId, plane: old.plane },
      to: { x: next.x, y: next.y, mapId: next.mapId, plane: next.plane },
      displacement: { x: next.x-old.x, y: next.y-old.y, distanceTiles: distance(old,next) },
      method, evidence, verified: false, uncertaintyReasons: [
        method === 'mutual-unique-nearest-category' ? 'Nearest same-category facilities may be unrelated.' : 'Unique label/object identity is corroboration, not observed continuity.',
        'Snapshots differ in date, surface evidence, transforms and conditional/default selection.',
        'No current-player variables or in-game verification establish the same active placement.' ] });
    usedBefore.add(old.placement); usedAfter.add(next.placement);
  }
  const identityIndex = groups => {
    const result = new Map();
    for (const group of groups) for (const identity of [...group.labels.map(label => `label:${label}`), ...group.objectIds.map(id => `object:${id}`)]) {
      const key = `${group.mapId}:${group.plane}:${identity}`;
      if (!result.has(key)) result.set(key, []); result.get(key).push(group);
    }
    return result;
  };
  const identitiesAfter = identityIndex([...categoryAfter.values()]), identitiesBefore = identityIndex([...categoryBefore.values()]);
  const unmatchedAfter = new Set(semanticAdded.map(q => q.placement)), unmatchedBefore = new Set(semanticRemoved.map(q => q.placement));
  const identityEdges = [];
  for (const [identity, next] of identitiesAfter) {
    const old = identitiesBefore.get(identity);
    if (next.length === 1 && old?.length === 1 && unmatchedAfter.has(next[0].placement)
      && unmatchedBefore.has(old[0].placement) && distance(old[0],next[0]) > 0)
      identityEdges.push({ old: old[0], next: next[0], identity });
  }
  // Different identities that suggest different partners are ambiguous, even if each identity is unique.
  for (const edge of identityEdges) {
    if (usedBefore.has(edge.old.placement) || usedAfter.has(edge.next.placement)) continue;
    if (identityEdges.some(q => (q.old.placement === edge.old.placement && q.next.placement !== edge.next.placement)
      || (q.next.placement === edge.next.placement && q.old.placement !== edge.old.placement))) continue;
    candidate(edge.old, edge.next, 'unique-label-or-object-identity', identityEdges.filter(q =>
      q.old.placement === edge.old.placement && q.next.placement === edge.next.placement).map(q => q.identity));
  }
  const remainingBefore = semanticRemoved.filter(q => !usedBefore.has(q.placement));
  const remainingAfter = semanticAdded.filter(q => !usedAfter.has(q.placement));
  function uniqueNearest(row, candidates) {
    if (row.category == null) return null;
    const nearby = candidates.filter(q => sameSurface(row,q) && q.category === row.category && distance(row,q) <= 64)
      .map(q => ({ row: q, distance: distance(row,q) })).sort((a,b) => a.distance-b.distance);
    if (!nearby.length || (nearby.length > 1 && Math.abs(nearby[0].distance-nearby[1].distance) < 1e-9)) return null;
    return nearby[0].row;
  }
  for (const old of remainingBefore) {
    const next = uniqueNearest(old, remainingAfter);
    if (!next || usedAfter.has(next.placement)) continue;
    const reverse = uniqueNearest(next, remainingBefore);
    if (reverse?.placement === old.placement) candidate(old, next, 'mutual-unique-nearest-category',
      { category: old.category, maximumDistanceTiles: 64, mutuallyNearest: true, tiedNearestRejected: true });
  }
  const added = semanticAdded.filter(q => !usedAfter.has(q.placement));
  const removed = semanticRemoved.filter(q => !usedBefore.has(q.placement));
  const exactSpriteComparison = { method: 'exact-display-coordinate-plane-map-and-current-sprite',
    matchedPlacements: [...after.keys()].filter(k => before.has(k)).length,
    added: [...after].filter(([k]) => !before.has(k)).map(([placement, ids]) => ({ placement, ids })),
    removed: [...before].filter(([k]) => !after.has(k)).map(([placement, ids]) => ({ placement, ids })) };
  return { method: 'same-display-coordinate-map-plane-and-numeric-category-with-unverified-move-candidates',
    baselinePins: baselineRows.length, currentPins: currentRows.length,
    matchedPlacements: exactSpriteComparison.matchedPlacements,
    semanticMatchedPlacements: matched.length,
    matchedNumericCategoryPlacements: matched.filter(k => categoryAfter.get(k).category != null).length,
    spriteChangesAtSameCoordinateAndNumericCategory: spriteChanges,
    spriteStyleChangeCount: spriteChanges.length, exactSpriteComparison, semanticAdded, semanticRemoved,
    added, removed, movedCandidates, moved: movedCandidates,
    counts: { added: added.length, removed: removed.length, moved: movedCandidates.length, movedCandidates: movedCandidates.length,
      verifiedMoved: 0, semanticMatched: matched.length, semanticAdded: semanticAdded.length,
      semanticRemoved: semanticRemoved.length, spriteStyleChanges: spriteChanges.length },
    caveat: 'Added/removed are unmatched category-position groups after heuristic candidate pairing; moved rows are unverified candidates. SemanticAdded/semanticRemoved preserve every observed coordinate/category difference before pairing. Snapshot date, coverage, transforms and default selection differ. No hidden-pin ID migration is applied.' };
}

export const comparePins = comparePinSnapshots;

/** Decode the two current sprite container formats, without browser image APIs. */
export function decodeSpriteFrames(buffer) {
  if (buffer.length < 7) throw new Error('Truncated sprite container');
  const footer = buffer.readUInt16BE(buffer.length - 2), rgb = !!(footer & 0x8000), count = footer & 0x7fff;
  const dimensions = (width, height) => {
    if (!width || !height || width > 4096 || height > 4096) throw new Error(`Invalid sprite dimensions ${width}x${height}`);
  };
  const frames = [];
  if (rgb) {
    if (buffer[0] !== 0 || count !== 1) throw new Error('Unsupported RGB sprite variant');
    const alpha = !!(buffer[1] & 1), width = buffer.readUInt16BE(2), height = buffer.readUInt16BE(4);
    dimensions(width, height);
    const size = width * height, end = 6 + size * (alpha ? 4 : 3);
    if (end !== buffer.length - 2) throw new Error('Invalid RGB sprite payload length');
    const rgba = Buffer.alloc(size * 4);
    for (let p = 0; p < size; p++) {
      rgba[p * 4] = buffer[6 + p * 3]; rgba[p * 4 + 1] = buffer[7 + p * 3];
      rgba[p * 4 + 2] = buffer[8 + p * 3]; rgba[p * 4 + 3] = alpha ? buffer[6 + size * 3 + p] : 255;
    }
    frames.push({ x: 0, y: 0, width, height, fullwidth: width, fullheight: height, rgba });
  } else {
    if (!count || count > 1024) throw new Error(`Invalid sprite frame count ${count}`);
    const metadataOffset = buffer.length - 7 - count * 8;
    if (metadataOffset < 0) throw new Error('Truncated paletted sprite metadata');
    const fullwidth = buffer.readUInt16BE(metadataOffset), fullheight = buffer.readUInt16BE(metadataOffset + 2);
    dimensions(fullwidth, fullheight);
    const paletteCount = buffer[metadataOffset + 4], paletteOffset = metadataOffset - paletteCount * 3;
    if (paletteOffset < 0) throw new Error('Truncated sprite palette');
    let scan = 0;
    for (let frame = 0; frame < count; frame++) {
      const origin = metadataOffset + 5 + frame * 2;
      const x = buffer.readUInt16BE(origin), y = buffer.readUInt16BE(origin + count * 2);
      const width = buffer.readUInt16BE(origin + count * 4), height = buffer.readUInt16BE(origin + count * 6);
      if (width === 0 || height === 0) { frames.push({ x, y, width, height, fullwidth, fullheight, rgba: Buffer.alloc(0) }); continue; }
      dimensions(width, height);
      if (x + width > fullwidth || y + height > fullheight) throw new Error('Sprite frame extends outside canvas');
      const flags = buffer[scan++], alpha = !!(flags & 2), transpose = !!(flags & 1), size = width * height;
      if (flags & ~3) throw new Error(`Unsupported paletted sprite flags ${flags}`);
      if (scan + size * (alpha ? 2 : 1) > paletteOffset) throw new Error('Truncated paletted sprite pixels');
      const rgba = Buffer.alloc(size * 4);
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const input = transpose ? px * height + py : py * width + px, output = (py * width + px) * 4;
        const colour = buffer[scan + input];
        if (colour > paletteCount) throw new Error('Sprite palette index out of range');
        if (colour) {
          const palette = paletteOffset + (colour - 1) * 3;
          rgba[output] = buffer[palette]; rgba[output + 1] = buffer[palette + 1]; rgba[output + 2] = buffer[palette + 2];
          rgba[output + 3] = alpha ? buffer[scan + size + input] : 255;
        }
      }
      scan += size * (alpha ? 2 : 1);
      frames.push({ x, y, width, height, fullwidth, fullheight, rgba });
    }
    if (scan !== paletteOffset) throw new Error(`Sprite has ${paletteOffset - scan} unconsumed pixel bytes`);
  }
  return frames;
}

function pngCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function rgbaPng(width, height, rgba) {
  if (!width || !height || rgba.length !== width * height * 4) throw new Error('Invalid PNG RGBA payload');
  const chunk = (type, payload) => {
    const name = Buffer.from(type), result = Buffer.alloc(payload.length + 12);
    result.writeUInt32BE(payload.length); name.copy(result, 4); payload.copy(result, 8);
    result.writeUInt32BE(pngCrc(Buffer.concat([name, payload])), result.length - 4); return result;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) rgba.copy(scanlines, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

/** Returns PNG buffers and anchors for the caller to store in its explicit output. */
export function exportPinSprites(cache, pinResult, { includeAlternates = true } = {}) {
  const ids = new Set();
  const add = row => {
    for (const key of ['spriteId', 'backgroundSpriteId', 'hoverSpriteId']) if (validId(row[key])) ids.add(row[key]);
    if (row.legacyAlternate?.definition) {
      for (const key of ['sprite', 'background_sprite', 'sprite_hover']) if (validId(row.legacyAlternate.definition[key])) ids.add(row.legacyAlternate.definition[key]);
    }
  };
  for (const pin of pinResult.pins ?? pinResult) { add(pin); if (includeAlternates) for (const alt of pin.alternates ?? []) add(alt); }
  const sprites = [], missing = [];
  for (const spriteId of [...ids].sort((a, b) => a - b)) {
    const bytes = cache.file(8, spriteId);
    if (!bytes) { missing.push({ spriteId, reason: 'missing-copied-sprite' }); continue; }
    const frames = decodeSpriteFrames(bytes).map((frame, index) => {
      const { rgba, ...metadata } = frame;
      return { ...metadata, index, png: frame.width && frame.height ? rgbaPng(frame.width, frame.height, rgba) : null };
    });
    sprites.push({ spriteId, sourceSha256: createHash('sha256').update(bytes).digest('hex'), frames });
  }
  return { sprites, missing, requested: ids.size, limits: ['Frame PNGs retain their cropped dimensions; x/y/fullwidth/fullheight record the original anchors.',
    'Sprite IDs do not supply human legend/category names.'] };
}
