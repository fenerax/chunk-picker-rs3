import { selectedDataset } from '../../app/dataset-runtime.mjs';
import fs from 'node:fs/promises';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { applySelectorEvidence, collectTaskLocationDeclarations } from './selector-mapping.mjs';
import { applyMapCorrections } from '../../app/data/map-corrections.mjs';
import { permanentTaskId } from '../../app/tasks/identity.mjs';

const membershipPath = process.argv[2];
if (!membershipPath) throw new Error('Supply membership.v1.json from the audited cache output.');
const bytes = await fs.readFile(membershipPath);
const membership = JSON.parse(bytes);
const cache = JSON.parse(await fs.readFile(new URL('../../app/data/cache-walkability.2026-10-07.v1.json', import.meta.url)));
const definitions = JSON.parse(await fs.readFile(new URL('../../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const world = buildWorld(definitions, { dataset: selectedDataset, cacheWalking: false });
const resourceDefinitions = applyMapCorrections(definitions).definitions;
const touch = new Map();
for (const [a, b] of cache.edges) {
  for (const [from, to] of [[a, b], [b, a]]) {
    if (!touch.has(from)) touch.set(from, new Set());
    touch.get(from).add(to.split(':')[0]);
  }
}
const mapping = [];
// Reviewed landmass correspondence: mainland and island signatures paired with
// 11569's two disjoint coasts disambiguate the one-neighbour Port Sarim pier.
const reviewed = { '11825-1': [2], '11825-2': [1], '11569-1': [1], '11569-2': [5] };
for (const [base, sections] of world.sectionTopology) {
  const region = cache.regions.find(row => row[0] === base);
  const assigned = new Set();
  const records = [];
  for (const [suffix, edges] of sections) {
    const id = `${base}-${suffix}`;
    const signature = new Set(edges.filter(edge => !world.sectionRoutes.get(id)?.has(edge)
      && (world.neighbors.get(base) ?? []).includes(edge.split('-')[0])).map(edge => edge.split('-')[0]));
    const candidates = (region?.[3] ?? []).filter(([label]) => {
      const neighbors = touch.get(`${base}:${label}`) ?? new Set();
      return signature.size && neighbors.size === signature.size && [...signature].every(id => neighbors.has(id));
    }).map(([label]) => label);
    const record = { legacy: id, components: [], candidates, method: 'unresolved', signature: [...signature].sort() };
    if (reviewed[id]) { record.components = reviewed[id]; record.method = 'reviewed-landmass'; }
    else if (sections.size === 1 && region?.[3]?.length === 1) { record.components = [region[3][0][0]]; record.method = 'sole-component'; }
    else if (candidates.length === 1) { record.components = candidates; record.method = 'unique-boundary-signature'; }
    if (record.components.length) for (const label of record.components) assigned.add(label);
    records.push(record);
  }
  // A remaining exact signature becomes unique after a stronger sibling
  // correspondence, without ranking fragment size or fanning out a seed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) if (!record.components.length) {
      const remaining = record.candidates.filter(label => !assigned.has(label));
      if (remaining.length === 1) { record.components = remaining; record.method = 'unique-after-sibling'; assigned.add(remaining[0]); changed = true; }
    }
  }
  mapping.push(...records);
}
const selectorEvidenceName = 'cache-selector-evidence.2026-10-07.v1.json';
const selectorEvidenceBytes = await fs.readFile(new URL(`../../app/data/${selectorEvidenceName}`, import.meta.url));
const selectorEvidence = JSON.parse(selectorEvidenceBytes);
applySelectorEvidence(mapping, cache.regions, selectorEvidence);
const resourceSelectors = new Map();
for (const record of mapping) if (!record.legacy.endsWith('-0')) for (const label of record.components) {
  const component = `${record.legacy.split('-')[0]}:${label}`;
  resourceSelectors.set(component, [...resourceSelectors.get(component) ?? [], record.legacy]);
}
for (const record of mapping) record.project = record.components.length > 0 && record.components.every(label =>
  (resourceSelectors.get(`${record.legacy.split('-')[0]}:${label}`)?.length ?? 0) <= 1);
const taskLocations = collectTaskLocationDeclarations(resourceDefinitions, mapping, permanentTaskId);
for (const record of mapping) {
  const review = record.spatialReview;
  const conflict = review?.cohort === 'priority-corroboration' && ['footprint-touches-several-components', 'exclusive-anchors-disagree'].includes(review.reason);
  const [base, suffix] = record.legacy.split('-');
  const chunk = resourceDefinitions.chunks[base];
  const section = suffix === '0' ? chunk : chunk?.Sections?.[suffix] ?? {};
  const proof = selectorEvidence.records.find(row => row.legacy === record.legacy);
  const located = new Set(Object.keys(section?.Object ?? {}).filter(name => {
    const anchors = proof?.anchors.filter(a => a.name === name) ?? [];
    return anchors.length && anchors.every(a => !a.conditional && a.witness.components.some(component =>
      record.components.includes(Number(component.split(':')[1])) && component.startsWith(`${base}:`)));
  }));
  const unlocated = [];
  for (const category of ['Object', 'NPC', 'Monster', 'Shop', 'Spawn', 'Connect']) {
    const names = Object.keys(section?.[category] ?? {}).filter(name => category !== 'Object' || !located.has(name));
    if (names.length) unlocated.push({ category, names });
  }
  // Retained exports also encode an entrance/area alias directly as a section
  // key (for example 12342-3 has { "12610": true }), outside Connect.
  const locationAliases = Object.keys(section ?? {}).filter(key => /^[1-9]\d*$/.test(key)
    || Object.hasOwn(resourceDefinitions.chunks, key));
  if (locationAliases.length) unlocated.push({ category: 'LocationAlias', names: locationAliases });
  const declaredTasks = taskLocations.get(record.legacy);
  if (declaredTasks?.length) {
    unlocated.push({ category: 'TaskLocation', names: [...new Set(declaredTasks.map(task => `${task.category}: ${task.rawLabel}`))] });
    record.declaredTaskLocations = declaredTasks;
  }
  record.resourceUnresolved = !record.components.length || !record.project || conflict || unlocated.length > 0;
  if (record.resourceUnresolved) record.resourceUnresolvedReason = !record.components.length ? 'unresolved-selector-correspondence'
    : !record.project ? 'shared-component-resource-aliases' : conflict ? 'declared-object-spatial-conflict' : 'unlocated-declared-contents-or-entrances';
  if (unlocated.length) record.unlocatedDeclarations = unlocated;
}
const output = {
  schemaVersion: 1,
  provenance: { walkability: 'cache-walkability.2026-10-07.v1.json', membershipSha256: sha256(bytes),
    source: 'cache-audit-2026-10-07-v4/membership.v1.json', mappingPolicy: 'docs/research/cache-walkability-application.md',
    selectorEvidence: selectorEvidenceName, selectorEvidenceSha256: sha256RepositoryText(selectorEvidenceBytes),
    selectorMappingPolicy: 'docs/research/cache-selector-mapping.md' },
  membership: membership.regions.map(region => [region.region, region.components.map(component => [component.label, component.counts.free, component.counts.members, component.counts.unknown])]),
  mapping,
};
await fs.writeFile(new URL('../../app/data/cache-component-policy.2026-10-07.v1.json', import.meta.url), JSON.stringify(output));
console.log(`Mapped ${mapping.filter(row => row.components.length).length}/${mapping.length} legacy section selectors; unresolved selectors remain saved.`);
