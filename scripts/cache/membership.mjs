import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { readFileSync } from 'node:fs';
import { buildWorld } from '../../app/data/world.mjs';

/** Geographic F2P mask only; does not establish walkability or route access.
 * square is decoded terrain, x/z are LOCAL tile coordinates in [0, 63].
 * Pinned rsmv documents southwest -> north -> east; copied-cache/Wiki
 * calibration supports 1=free and low bits south. See cache-membership.md.
 * Missing masks stay unknown. There is no independent plane bit.
 */
export function rawFreeAt(square, x, z) {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x > 63 || z < 0 || z > 63)
    throw new RangeError('Membership lookup requires local tile coordinates 0..63.');
  const mask = square?.nonmembarea;
  if (mask === null || mask === undefined) return null;
  if (!(mask instanceof Uint8Array) || mask.length !== 8)
    throw new TypeError('Geographic membership mask must contain exactly eight bytes.');
  return (mask[Math.floor(x / 8)] & (1 << Math.floor(z / 8))) !== 0;
}

const emptyCounts = () => ({ free: 0, members: 0, unknown: 0 });
const classification = counts => counts.unknown || !counts.free && !counts.members ? 'unknown'
  : counts.free && counts.members ? 'mixed' : counts.free ? 'free' : 'members';
const total = counts => counts.free + counts.members + counts.unknown;
const addCounts = (to, from) => { for (const key of ['free', 'members', 'unknown']) to[key] += from[key]; };

/** Join geographic bits to the closed collision graph. Section/component matches
 * are provisional neighbour-signature candidates, never tile geometry claims.
 * Full-square translations preserve local mask positions; chunk pastes/rotations
 * require a different transform and are rejected by the surface importer.
 */
export function analyzeMembership(analysis, squares, comparison = {}, { world } = {}) {
  if (!(analysis?.regions instanceof Map) || !Array.isArray(squares))
    throw new TypeError('Membership analysis needs collision regions and decoded squares.');
  world ??= buildWorld(JSON.parse(readFileSync(new URL('../../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8')), { dataset: selectedDataset });
  const bySquare = new Map();
  for (const square of squares) {
    const id = String(square.x * 256 + square.z);
    if (bySquare.has(id)) throw new Error(`Duplicate membership square ${id}`);
    bySquare.set(id, square);
  }
  const regions = [], byComponent = new Map(), byRegion = new Map();
  const summary = { regions: 0, components: 0, tiles: emptyCounts(), classifications: {} };
  const discrepancies = { f2pWithoutFreeWalkableTiles: [], freeWalkableTilesOutsideF2p: [],
    unknownRegionMembership: [], sectionPolicyConflicts: [], unresolvedSectionPolicies: [] };
  for (const region of analysis.regions.values()) {
    const square = bySquare.get(region.id), terrain = square?.tiles;
    // Validate even when collision leaves no usable tile, so bad masks are not hidden.
    rawFreeAt(terrain, 0, 0);
    const counts = emptyCounts();
    const componentRows = new Map(region.components.map(component => [component.label,
      { component: component.id, label: component.label, tiles: component.tiles, counts: emptyCounts() }]));
    for (let i = 0; i < (region.componentMasks?.length ?? 0); i++) {
      const label = region.componentMasks[i];
      if (!label) continue;
      const component = componentRows.get(label);
      if (!component) throw new Error(`Missing collision component ${region.id}:${label}`);
      const free = rawFreeAt(terrain, i >> 6, i & 63);
      const key = free === true ? 'free' : free === false ? 'members' : 'unknown';
      counts[key]++; component.counts[key]++;
    }
    const components = [...componentRows.values()].map(component => {
      if (total(component.counts) !== component.tiles) throw new Error(`Collision label count mismatch ${component.component}`);
      const result = { ...component, status: region.status, classification: classification(component.counts),
        anyFreeWalkableTile: component.counts.free > 0 ? true : component.counts.unknown ? null : false };
      byComponent.set(result.component, result); return result;
    });
    const complete = region.status === 'decoded' && !counts.unknown;
    const row = { region: region.id, name: world.chunks.get(region.id)?.name ?? null,
      status: region.status, maskHex: terrain?.nonmembarea ? Buffer.from(terrain.nonmembarea).toString('hex') : null,
      source: square?.provenance ?? null, walkableTiles: total(counts), counts,
      classification: classification(counts), anyFreeWalkableTile: counts.free > 0 ? true : complete ? false : null,
      baseline: { defined: world.chunks.has(region.id), walkable: world.walkable.has(region.id), f2p: world.f2p.has(region.id) },
      components };
    regions.push(row); byRegion.set(region.id, row);
    summary.regions++; summary.components += components.length; addCounts(summary.tiles, counts);
    summary.classifications[row.classification] = (summary.classifications[row.classification] ?? 0) + 1;
    if (!row.baseline.defined) continue;
    const evidence = { region: row.region, name: row.name, status: row.status, walkableTiles: row.walkableTiles,
      counts, classification: row.classification, baseline: row.baseline, maskHex: row.maskHex };
    if (row.anyFreeWalkableTile === null) discrepancies.unknownRegionMembership.push(evidence);
    else if (row.baseline.f2p && !row.anyFreeWalkableTile) discrepancies.f2pWithoutFreeWalkableTiles.push(evidence);
    else if (!row.baseline.f2p && row.anyFreeWalkableTile) discrepancies.freeWalkableTilesOutsideF2p.push(evidence);
  }
  const signatures = new Map((comparison.sectionCandidates ?? []).map(row => [`${row.region}-${row.section}`, row]));
  const sections = [];
  for (const [base, policy] of world.sectionMembership ?? []) for (const [section, free] of policy) {
    const candidateRow = signatures.get(`${base}-${section}`), candidates = candidateRow?.candidates ?? [];
    const bestHits = candidates.reduce((best, candidate) => Math.max(best, candidate.hits ?? 0), 0);
    const best = candidates.filter(candidate => (candidate.hits ?? 0) === bestHits);
    const mapped = best.map(candidate => ({ ...candidate, membership: byComponent.get(candidate.component) ?? null }));
    const exactSignature = best.length > 0 && best.every(candidate => !candidate.missing?.length);
    const counts = emptyCounts();
    for (const candidate of mapped) if (candidate.membership) addCounts(counts, candidate.membership.counts);
    const known = exactSignature && mapped.every(candidate => candidate.membership
      && candidate.membership.status === 'decoded' && candidate.membership.classification !== 'unknown');
    const result = { region: base, section, policyFree: free, provisional: true,
      match: !best.length ? 'unmapped' : !exactSignature ? 'incomplete-neighbor-signature' : best.length > 1 ? 'ambiguous' : 'single-neighbor-signature',
      counts, classification: known ? classification(counts) : 'unknown', candidates: mapped };
    sections.push(result);
    // Only unanimous opposite homogeneous candidates produce a conflict. Mixed,
    // partial or ambiguous evidence is kept for review without claiming geometry.
    const opposite = free ? 'members' : 'free';
    if (known && mapped.every(candidate => candidate.membership.classification === opposite))
      discrepancies.sectionPolicyConflicts.push(result);
    if (!known || result.match !== 'single-neighbor-signature' || result.classification === 'mixed')
      discrepancies.unresolvedSectionPolicies.push(result);
  }
  return { schemaVersion: 1, convention: { granularityTiles: 8, byteAxis: 'localX/8', bitAxis: 'localZ/8',
    bitOrder: 'least significant south, increasing north', setBit: 'free', planeSpecific: false },
    limits: ['Geographic mask is not a server-exact access gate', 'Only conservatively walkable closed-scenario tiles are counted',
      'Legacy section matching uses neighbor signatures and remains provisional', 'No quest, transport, ownership or return route inferred'],
    summary: { ...summary, discrepancyCounts: Object.fromEntries(Object.entries(discrepancies).map(([key, rows]) => [key, rows.length])) },
    regions, sections, discrepancies };
}
