#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { formatTransportRequirements } from './build-transport-routes.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
export const TRANSPORT_SUPPLEMENT_PATHS = Object.freeze({
  baseline: 'app/data/transport-routes.2026-10-08.v1.json',
  supplement: 'app/data/transport-routes.desert-anachronia.2026-10-09.v1.json',
  components: 'app/data/transport-components.desert-anachronia.2026-10-09.v1.json',
  output: 'app/data/transport-routes.2026-10-09.v1.json',
  mapBaseline: 'archive/data/map-connections.2026-10-08.v3.json',
  mapOutput: 'app/data/map-connections.2026-10-09.v1.json',
});

/** Extend the historical catalogue without rewriting its pinned generator or data. */
export function buildTransportSupplement(baseline, supplement, components, inputs) {
  const result = structuredClone(baseline);
  const ids = new Set(result.stations.map(row => row.id));
  for (const row of supplement.stations) {
    if (ids.has(row.id)) throw new Error(`Duplicate station: ${row.id}`);
    if (![row.x, row.y, row.plane, row.mapId].every(Number.isInteger)
      || row.mapId !== 28 || row.plane !== 0
      || row.chunkId !== String(Math.floor(row.x / 64) * 256 + Math.floor(row.y / 64))
      || !/^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/.test(row.coordinateEvidence?.url ?? '')) throw new Error(`Unverified supplement station: ${row.id}`);
    ids.add(row.id); result.stations.push(structuredClone(row));
  }
  const routeIds = new Set(result.routes.map(row => row.id));
  for (const row of supplement.routes) {
    if (routeIds.has(row.id) || !ids.has(row.to) || row.from !== null && !ids.has(row.from)
      || !['carpet', 'teleport', 'shortcut'].includes(row.kind) || row.members !== true || row.f2p !== false
      || !row.provenance.some(proof => /^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/.test(proof.url ?? '')))
      throw new Error(`Invalid supplement route: ${row.id}`);
    routeIds.add(row.id); result.routes.push(structuredClone(row));
  }
  for (const witness of components.witnesses) {
    const row = result.stations.find(row => row.id === witness.stationId);
    if (!supplement.stations.some(station => station.id === witness.stationId)
      || !['x', 'y', 'mapId', 'plane'].every(key => row[key] === witness[key])) throw new Error(`Stale supplement witness: ${witness.stationId}`);
    row.componentWitness = structuredClone(witness);
  }
  result.version = '2026-10-09.v1'; result.reviewedOn = '2026-10-09';
  result.provenance.generator = 'scripts/build-transport-supplement.mjs';
  result.provenance.baselineGenerator = baseline.provenance.generator;
  result.inputs = structuredClone(inputs);
  result.networks.push(...structuredClone(supplement.networks));
  result.limitations.push(...supplement.limitations);
  result.stations.sort((a, b) => a.id.localeCompare(b.id)); result.routes.sort((a, b) => a.id.localeCompare(b.id));
  const byKind = {};
  for (const row of result.routes) {
    const count = byKind[row.kind] ??= { total: 0, f2p: 0, members: 0 };
    count.total++; count[row.f2p ? 'f2p' : 'members']++;
  }
  result.summary = { ...result.summary, stations: result.stations.length, routes: result.routes.length,
    f2p: result.routes.filter(row => row.f2p).length, members: result.routes.filter(row => row.members).length, byKind };
  return result;
}

export function generateTransportSupplement() {
  const entries = ['baseline', 'supplement', 'components'].map(kind => {
    const path = TRANSPORT_SUPPLEMENT_PATHS[kind], bytes = readFileSync(resolve(repo, path));
    return { data: JSON.parse(bytes), input: { kind, path, sha256: sha256RepositoryText(bytes) } };
  });
  const result = buildTransportSupplement(...entries.map(row => row.data), entries.map(row => row.input));
  writeFileSync(resolve(repo, TRANSPORT_SUPPLEMENT_PATHS.output), `${JSON.stringify(result)}\n`);
  const mapBytes = readFileSync(resolve(repo, TRANSPORT_SUPPLEMENT_PATHS.mapBaseline));
  const map = buildSupplementConnections(JSON.parse(mapBytes), result, entries[1].data,
    [{ kind: 'baseline-map-connections', path: TRANSPORT_SUPPLEMENT_PATHS.mapBaseline, sha256: sha256RepositoryText(mapBytes) },
      { kind: 'reviewed-transport-supplement', path: TRANSPORT_SUPPLEMENT_PATHS.supplement, sha256: entries[1].input.sha256 },
      { kind: 'active-transport-catalogue', path: TRANSPORT_SUPPLEMENT_PATHS.output, sha256: sha256RepositoryText(`${JSON.stringify(result)}\n`) }]);
  writeFileSync(resolve(repo, TRANSPORT_SUPPLEMENT_PATHS.mapOutput), `${JSON.stringify(map)}\n`);
  return result.summary;
}

/** Add bounded display records; preserve old declarations and walking verbatim. */
export function buildSupplementConnections(baseline, catalogue, supplement, inputs) {
  const result = structuredClone(baseline), stations = new Map(catalogue.stations.map(row => [row.id, row]));
  const point = station => ({ chunkId: station.chunkId, locationId: null, areaId: null, sectionId: null,
    stationId: station.id, name: station.name, x: station.x, y: station.y, plane: station.plane, mapId: station.mapId,
    precision: 'exact-entrance', coordinateEvidence: structuredClone(station.coordinateEvidence),
    worldX: (station.x + 0.5 - 1856) * 2, worldY: (4608 - station.y - 0.5) * 2 });
  for (const route of supplement.routes) {
    const provenance = { kind: 'reviewed-transport-route', file: TRANSPORT_SUPPLEMENT_PATHS.output,
      routeId: route.id, provenance: structuredClone(route.provenance) };
    if (route.from === null) {
      result.destinations.push({ id: `destination-${route.id}`, routeId: route.id, ...point(stations.get(route.to)),
        name: route.name, kind: route.kind, members: route.members, f2p: route.f2p,
        requirement: formatTransportRequirements(route.requirements), requirements: structuredClone(route.requirements),
        origin: null, provenance, unknowns: structuredClone(route.unknowns) });
    } else {
      result.connections.push({ id: `connection-${route.id}`, routeId: route.id, kind: route.kind === 'carpet' ? 'transport' : route.kind,
        routeKind: route.kind, from: point(stations.get(route.from)), to: point(stations.get(route.to)), label: route.name,
        members: route.members, f2p: route.f2p, requirement: formatTransportRequirements(route.requirements),
        requirements: structuredClone(route.requirements), bidirectional: route.bidirectional, drawable: true,
        provenance: [provenance, ...structuredClone(route.provenance)], unknowns: structuredClone(route.unknowns) });
    }
  }
  result.version = '2026-10-09.v1'; result.generatedAt = '2026-10-09T00:00:00.000Z';
  result.inputs.push(...structuredClone(inputs));
  result.provenance.transportSupplement = { file: TRANSPORT_SUPPLEMENT_PATHS.output, generator: 'scripts/build-transport-supplement.mjs' };
  result.connections.sort((a, b) => a.id.localeCompare(b.id));
  const addedEdges = supplement.routes.filter(row => row.from !== null).length;
  Object.assign(result.summary, { connections: result.connections.length, destinations: result.destinations.length,
    drawableConnections: result.connections.filter(row => row.drawable).length,
    unresolvedConnections: result.connections.filter(row => !row.drawable).length,
    supplementalConnections: baseline.summary.supplementalConnections + addedEdges,
    reviewedTransportRoutes: catalogue.routes.length,
    reviewedTransportConnections: baseline.summary.reviewedTransportConnections + addedEdges });
  result.limitations.push('October 9 additions preserve Wiki station/destination anchors; display availability never establishes personal access or an exact player landing.');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(generateTransportSupplement()));
