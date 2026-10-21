#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
export const AUTOMATIC_TELEPORT_PATHS = Object.freeze({
  baseline: 'app/data/transport-routes.2026-10-09.v1.json',
  supplement: 'app/data/transport-routes.automatic-teleports.2026-10-09.v1.json',
  components: 'app/data/transport-components.automatic-teleports.2026-10-09.v1.json',
  evidence: 'docs/research/automatic-teleports-evidence.2026-10-09.v1.json',
  rollDestinations: 'app/data/transport-roll-destinations.automatic-teleports.2026-10-09.v1.json',
  output: 'app/data/transport-routes.2026-10-09.v2.json',
});
const pinned = url => /^https:\/\/runescape\.wiki\/w\/.+[?&]oldid=\d+$/.test(url ?? '');

/** Keep historical manual requirements intact; automatic evidence is additive. */
export function buildAutomaticTeleportCatalogue(baseline, supplement, components, evidence, rollDestinations, inputs) {
  const result = structuredClone(baseline);
  const stations = new Map(result.stations.map(row => [row.id, row]));
  const routes = new Map(result.routes.map(row => [row.id, row]));
  for (const row of supplement.stations) {
    if (stations.has(row.id) || ![row.x, row.y, row.plane, row.mapId].every(Number.isInteger)
      || row.mapId !== 28 || row.plane !== 0
      || row.chunkId !== String(Math.floor(row.x / 64) * 256 + Math.floor(row.y / 64))
      || !pinned(row.coordinateEvidence?.url)) throw new Error(`Unverified automatic teleport station: ${row.id}`);
    const copy = structuredClone(row); stations.set(row.id, copy); result.stations.push(copy);
  }
  for (const row of supplement.routes) {
    if (routes.has(row.id) || !stations.has(row.to) || row.from !== null || row.kind !== 'teleport'
      || typeof row.members !== 'boolean' || row.f2p !== !row.members
      || !row.provenance.some(proof => pinned(proof.url))) throw new Error(`Invalid automatic teleport route: ${row.id}`);
    const copy = structuredClone(row); routes.set(row.id, copy); result.routes.push(copy);
  }
  for (const row of supplement.metadata) {
    const route = routes.get(row.routeId);
    if (!route || route.from !== null || !['teleport', 'lodestone'].includes(route.kind)
      || !row.automatic?.type) throw new Error(`Unknown automatic metadata route: ${row.routeId}`);
    route.automatic = structuredClone(row.automatic);
  }
  for (const witness of components.witnesses) {
    const station = stations.get(witness.stationId);
    if (!supplement.stations.some(row => row.id === witness.stationId)
      || !['x', 'y', 'plane', 'mapId'].every(key => station[key] === witness[key])) throw new Error(`Stale automatic witness: ${witness.stationId}`);
    station.componentWitness = structuredClone(witness);
  }
  if (evidence.existingGlobalAudit.length !== baseline.routes.filter(row => ['teleport', 'lodestone'].includes(row.kind)).length)
    throw new Error('Incomplete existing teleport membership/destination audit');
  const destinationIds = new Set();
  for (const entry of rollDestinations.destinations) {
    const route = routes.get(entry.routeId), station = stations.get(route?.to), destination = entry.rollDestination;
    const proof = destination?.evidence, coordinateProof = station?.coordinateEvidence;
    const coordinate = destination && { x: destination.x, y: destination.y, plane: destination.plane, mapId: destination.mapId, chunkId: destination.chunkId };
    const coordinateHash = coordinate && createHash('sha256').update(JSON.stringify(coordinate)).digest('hex');
    const revision = evidence.revisions.find(row => row.url === proof?.url && row.revisionId === proof?.revisionId);
    const cacheProof = proof?.sourceKind === 'cache-typed-teleport-destination'
      && coordinateProof?.kind === 'cache-typed-coordinate' && coordinateProof?.role === 'exact-teleport-destination'
      && proof.sourcePointer === coordinateProof.pointer && proof.sourcePath === rollDestinations.cacheSource.path
      && proof.sourceSha256 === rollDestinations.cacheSource.sha256;
    const wikiProof = proof?.sourceKind === 'wiki-explicit-teleport-map'
      && coordinateProof?.kind === 'wiki-teleport-map'
      && ['teleport-destination-marker', 'wiki-teleport-destination-map'].includes(coordinateProof?.role)
      && proof.sourceSha256 === revision?.contentSha256;
    if (!route || route.from !== null || !['teleport', 'lodestone'].includes(route.kind)
      || destinationIds.has(entry.routeId) || !station || destination.stationId !== station.id
      || ![destination.x, destination.y, destination.plane, destination.mapId].every(Number.isSafeInteger)
      || destination.plane !== 0 || destination.mapId !== 28
      || !['x', 'y', 'plane', 'mapId', 'chunkId'].every(key => destination[key] === station[key])
      || destination.chunkId !== String(Math.floor(destination.x / 64) * 256 + Math.floor(destination.y / 64))
      || proof?.kind !== 'verified-teleport-destination-chunk' || !pinned(proof.url)
      || proof.url !== coordinateProof?.url || !revision || proof.coordinateSha256 !== coordinateHash
      || !/^[a-f0-9]{64}$/.test(proof.sourceSha256 ?? '') || !cacheProof && !wikiProof)
      throw new Error(`Unverified roll destination: ${entry.routeId}`);
    destinationIds.add(entry.routeId); route.rollDestination = structuredClone(destination);
  }
  result.version = '2026-10-09.v2'; result.reviewedOn = '2026-10-09';
  result.provenance.baselineGenerator = baseline.provenance.generator;
  result.provenance.generator = 'scripts/build-automatic-teleport-catalogue.mjs';
  result.inputs = structuredClone(inputs);
  result.automaticTeleportExclusions = structuredClone(supplement.exclusions);
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

export function generateAutomaticTeleportCatalogue() {
  const rows = ['baseline', 'supplement', 'components', 'evidence', 'rollDestinations'].map(kind => {
    const path = AUTOMATIC_TELEPORT_PATHS[kind], bytes = readFileSync(resolve(repo, path));
    return { data: JSON.parse(bytes), input: { kind, path, sha256: sha256RepositoryText(bytes) } };
  });
  const result = buildAutomaticTeleportCatalogue(...rows.map(row => row.data), rows.map(row => row.input));
  writeFileSync(resolve(repo, AUTOMATIC_TELEPORT_PATHS.output), `${JSON.stringify(result)}\n`);
  return result.summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(generateAutomaticTeleportCatalogue()));
