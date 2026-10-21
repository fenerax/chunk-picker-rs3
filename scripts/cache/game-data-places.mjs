#!/usr/bin/env node
// Static labels and typed coordinate evidence, never personal travel eligibility.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { buildSurfaceLayout, sourceToSurface, unpackCoord, inCrop } from './surface.mjs';
import { plainLabel, createDefinitionResolver } from './pins.mjs';
import { surfaceLodestones } from '../../app/data/lodestones.mjs';

export const enumEntries = row => row.stringArrayValue1 ?? row.intArrayValue1 ?? row.stringArrayValue2?.values ?? row.intArrayValue2?.values ?? [];
export function typedCoordinates(extra, params) {
  return (extra ?? []).filter(row => params.get(row.prop)?.type?.vartype === 22 && Number.isInteger(row.intvalue) && row.intvalue !== -1)
    .map(row => ({ param: row.prop, packed: row.intvalue, ...unpackCoord(row.intvalue) }));
}
const chunkId = p => String(Math.floor(p.x / 64) * 256 + Math.floor(p.y / 64));
const normalName = name => plainLabel(name).replace(/ Lodestone$/i, '').replace(/^Draynor$/, 'Draynor Village')
  .replace(/^Fremennik$/, 'Fremennik Province').replace(/^Wilderness$/, 'Wilderness Crater').toLowerCase();

export async function extractPlaces({ workspace, output }) {
  if (!output) throw new Error('Supply a NEW --output directory');
  const { cache, context } = await openGameCache({ workspace });
  try {
    const labels = loadTable(cache, { major: 2, minor: 36, kind: 'labels' });
    const structs = loadTable(cache, { major: 22, groupSize: 32, kind: 'struct' });
    const enums = loadTable(cache, { major: 17, kind: 'enum' });
    const params = loadTable(cache, { major: 2, minor: 11, kind: 'param' });
    const zones = cache.archive(23, 0), pastes = cache.archive(23, 1), layouts = new Map(), mapRecords = [], errors = [];
    for (const [id, bytes] of zones ?? []) {
      try {
        const zone = cache.decoders.decode('zones', bytes), pasteBytes = pastes?.get(id);
        const paste = pasteBytes ? cache.decoders.decode('pastes', pasteBytes) : null;
        mapRecords.push({ id, ...zone, pastePresent: !!paste, declaredPastes: paste ? { squares: paste.squares.length, chunks: paste.chunks.length } : null });
        if (paste) layouts.set(id, { zone, paste });
      } catch (error) { errors.push({ mapId: id, message: error.message }); }
    }
    const layoutCache = new Map();
    function layout(id, plane) {
      const key = `${id}:${plane}`;
      if (!layoutCache.has(key)) {
        const row = layouts.get(id);
        try { layoutCache.set(key, row ? buildSurfaceLayout(row.zone, row.paste, { mapId: id, plane }) : null); }
        catch (error) { errors.push({ mapId: id, plane, message: error.message }); layoutCache.set(key, null); }
      }
      return layoutCache.get(key);
    }
    const resolver = createDefinitionResolver(() => null, id => labels.definitions.get(id));
    const placements = [], rawPlacements = [];
    for (const minor of cache.table(42).entries.keys()) {
      try {
        const bytes = cache.file(42, minor);
        if (!bytes) { errors.push({ major: 42, minor, message: 'Declared label placement archive missing' }); continue; }
        const rows = cache.decoders.decode('labelLocations', bytes);
        for (const [index, row] of rows.entries()) {
          const source = unpackCoord(row.location);
          const resolved = resolver.resolveLabel(row.labelId), element = resolved.definition;
          const conditions = [...resolved.conditions, ...['toggle_1', 'toggle_2', 'toggle_1_v2', 'toggle_2_v2']
            .filter(key => element[key]).map(key => ({ kind: key, ...element[key] }))];
          const raw = { mapId: minor, index, elementId: row.labelId, source, conditional: row.conditional,
            label: plainLabel(element.text), category: element.category ?? null, spriteId: element.sprite ?? null,
            conditions, defaultSelection: resolved.conditions.length ? 'encoded default branch; player state unknown' : 'no legacy switch', rawElement: element };
          rawPlacements.push(raw);
          for (let plane = 0; plane < 4; plane++) {
            const map = layout(minor, plane);
            if (!map) continue;
            for (const point of sourceToSurface(map, source.x, source.y, source.plane)) placements.push({
              mapId: minor, plane, x: point.x, y: point.y, region: chunkId(point), label: raw.label,
              elementId: raw.elementId, category: raw.category, conditional: raw.conditional,
              conditions: raw.conditions, source: { major: 42, minor, index, ...source },
              transform: point.mapping.translation });
          }
        }
      } catch (error) { errors.push({ major: 42, minor, message: error.message }); }
    }
    const surfaceLayout = layout(28, 0);
    const project = coord => surfaceLayout ? sourceToSurface(surfaceLayout, coord.x, coord.y, coord.plane)
      .filter(p => inCrop(p.x, p.y)).map(p => ({ x: p.x, y: p.y, plane: p.plane, mapId: 28, region: chunkId(p), transform: p.mapping.translation })) : [];
    function mapProjections(coord) {
      const result = [];
      for (const [mapId, { paste }] of layouts) for (const kind of ['squares', 'chunks']) for (const [index, row] of paste[kind].entries()) {
        const offset = coord.plane - row.original_plane, size = kind === 'squares' ? 64 : 8;
        const sx = row.original_regionX * 64 + (row.original_chunkX ?? 0) * 8;
        const sy = row.original_regionY * 64 + (row.original_chunkY ?? 0) * 8;
        if (offset < 0 || offset >= row.n_planes || coord.x < sx || coord.x >= sx + size || coord.y < sy || coord.y >= sy + size) continue;
        const x = row.new_regionX * 64 + (row.new_chunkX ?? 0) * 8 + coord.x - sx;
        const y = row.new_regionY * 64 + (row.new_chunkY ?? 0) * 8 + coord.y - sy;
        result.push({ mapId, mapName: layouts.get(mapId).zone.name, x, y, plane: row.new_plane + offset,
          region: chunkId({ x, y }), paste: { kind, index } });
      }
      return result;
    }
    const travelStructs = [], coordinateStructs = [];
    for (const [id, row] of structs.definitions) {
      const coordinates = typedCoordinates(row.extra, params.definitions);
      if (!coordinates.length) continue;
      const strings = row.extra.filter(p => p.stringvalue != null).map(p => ({ param: p.prop, value: p.stringvalue }));
      const normalized = { id, strings, coordinates: coordinates.map(p => ({ ...p, surface: project(p), mapProjections: mapProjections(p) })), rawParams: row.extra };
      coordinateStructs.push(normalized);
      // Text alone is candidate evidence. Never call an arbitrary coordgrid a destination.
      if (strings.some(p => /teleport|lodestone|travel|transport/i.test(p.value))) travelStructs.push(normalized);
    }
    const lodestones = travelStructs.filter(row => /Lodestone$/i.test(row.strings.find(p => p.param === 2794)?.value ?? ''))
      .map(row => ({ structId: row.id, name: row.strings.find(p => p.param === 2794).value,
        description: row.strings.find(p => p.param === 2795)?.value ?? null,
        coordinates: row.coordinates.filter(p => p.param === 2941),
        membersCandidate: row.rawParams.find(p => p.prop === 2809)?.intvalue ?? 0,
        membersInterpretation: 'candidate from consistent ability param pattern; conflicting variants retained', rawParams: row.rawParams }));
    const coordinateEnums = [...enums.definitions].filter(([, row]) => [row.key_type2, row.key_type1, row.value_type1, row.value_type2].includes(22))
      .map(([id, row]) => ({ id, keyType: row.key_type2 ?? row.key_type1, valueType: row.value_type2 ?? row.value_type1,
        rows: enumEntries(row).map(([key, value]) => ({ key, value,
          coordinate: unpackCoord((row.key_type2 ?? row.key_type1) === 22 ? key : value) })), raw: row }));
    const surfaceLabels = placements.filter(p => p.mapId === 28 && p.plane === 0 && p.label && inCrop(p.x, p.y));
    const byRegion = Object.fromEntries([...new Set(surfaceLabels.map(p => p.region))].sort().map(region => [region, surfaceLabels.filter(p => p.region === region)]));
    const retained = JSON.parse(readFileSync(context.reference.path));
    const regionNames = Object.entries(byRegion).map(([region, rows]) => ({ region, retainedName: retained.chunks[region]?.Nickname ?? null,
      cacheLabels: [...new Set(rows.map(p => p.label))], method: 'label anchor in region; labels may describe multiple regions' }));
    const lodestoneComparison = surfaceLodestones.map(row => {
      const candidates = lodestones.filter(p => normalName(p.name) === normalName(row.name));
      const destinations = candidates.flatMap(p => p.coordinates.flatMap(c => c.surface));
      return { retained: row, structIds: candidates.map(p => p.structId), coordinates: destinations,
        regionMatch: destinations.some(p => p.region === row.chunkId), missingCache: !candidates.length,
        membersCandidateValues: [...new Set(candidates.map(p => p.membersCandidate))],
        sectionsCompared: false };
    });
    const summary = { mapDefinitions: mapRecords.length, mapElements: labels.definitions.size,
      rawLabelPlacements: rawPlacements.length, mappedLabelPlacements: placements.length,
      surfaceTextLabels: surfaceLabels.length, namedSurfaceRegions: Object.keys(byRegion).length,
      lodestoneStructs: lodestones.length, distinctLodestoneNames: new Set(lodestones.map(p => normalName(p.name))).size,
      coordinateStructs: coordinateStructs.length, travelTextCoordinateStructs: travelStructs.length,
      coordinateEnums: coordinateEnums.length, retainedSurfaceLodestones: surfaceLodestones.length,
      retainedLodestoneRegionMatches: lodestoneComparison.filter(p => p.regionMatch).length,
      retainedLodestoneMissing: lodestoneComparison.filter(p => p.missingCache).length,
      errors: errors.length + labels.errors.length + structs.errors.length + enums.errors.length + params.errors.length };
    const provenance = { decoder: context.decoder, generatedAt: context.generatedAt, reference: context.reference,
      archiveHashes: 'manifest.v1.json', classification: 'advisory static client definitions' };
    for (const [name, data] of Object.entries({ 'places.v1.json': { mapRecords, mapElements: [...labels.definitions], rawPlacements, placements, byRegion },
      'travel.v1.json': { lodestones, travelStructs, coordinateEnums, coordinateStructs },
      'comparison.v1.json': { regionNames, lodestoneComparison } })) context.outputs.push(writeDataset(output, name, { schemaVersion: 1, provenance, summary, ...data }));
    context.outputs.push(writeDataset(output, 'errors.v1.json', errors));
    await finishManifest(cache, context, output, { summary });
    console.log(JSON.stringify({ output, summary }, null, 2));
    return { summary, regionNames, lodestoneComparison, surfaceLabels, lodestones, travelStructs, provenance };
  } finally { cache.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  extractPlaces(cliOptions()).catch(error => { console.error(error.message); process.exitCode = 1; });
