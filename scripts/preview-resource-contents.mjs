import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorld } from '../app/data/world.mjs';
import { BACKUP_FORMAT, SCHEMA_VERSION, validateOwnedState } from '../app/core/state.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { buildEquipmentCatalogue, evaluateEquipment } from '../app/tasks/equipment.mjs';
import { entityId, resolveIdentity } from '../app/tasks/identity.mjs';
import defaultResourceCatalogue from '../app/data/cache-resources.2026-10-08.v1.json' with { type: 'json' };
import defaultResourceSelectors from '../app/data/cache-resource-selectors.2026-10-08.v1.json' with { type: 'json' };

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const unique = values => [...new Set(values)].sort(compare);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STATIC_ID = /^static-([a-f0-9]{64})\.json\.gz$/;
const STATIC_FIELDS = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
const isLiveStorePath = file => /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(file);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Explicit-path, read-only hydration. Never opens the durable store, locks,
 * history archives, a default data directory, or a missing-state fallback. */
export async function readStateCopy(statePath) {
  if (typeof statePath !== 'string' || !statePath.trim()) throw new TypeError('An explicit --state copy path is required.');
  const requested = path.resolve(statePath);
  const file = await realpath(requested);
  if (isLiveStorePath(file)) throw new Error('Use a copied state.json outside .local/duo, with its static/ dependencies.');
  const bytes = await readFile(file);
  const document = JSON.parse(bytes.toString('utf8'));
  if (!object(document)) throw new TypeError('State document must be an object.');
  const envelope = Object.hasOwn(document, 'state');
  if (envelope && (document.format !== BACKUP_FORMAT || document.schemaVersion !== SCHEMA_VERSION)) throw new TypeError('Unsupported state backup envelope.');
  let state = envelope ? document.state : document;
  if (!object(state)) throw new TypeError('State must be an object.');
  const dependencies = [];
  if (document.storage !== undefined) {
    const metadata = document.storage;
    if (!envelope || !object(metadata) || metadata.schemaVersion !== 1 || !object(metadata.fields)
      || Object.keys(metadata).some(key => !['schemaVersion', 'fields'].includes(key))) throw new TypeError('Invalid static storage metadata.');
    state = { ...state };
    for (const [key, reference] of Object.entries(metadata.fields).sort(([a], [b]) => compare(a, b))) {
      const match = STATIC_ID.exec(reference?.id ?? '');
      if (!STATIC_FIELDS.has(key) || Object.hasOwn(state, key) || !object(reference) || !match
        || reference.sha256 !== match[1] || Object.keys(reference).some(name => !['id', 'sha256'].includes(name))) throw new TypeError(`Invalid static field reference: ${key}`);
      const expectedDirectory = path.join(path.dirname(file), 'static');
      const directory = await realpath(expectedDirectory);
      if (isLiveStorePath(directory)) throw new TypeError('Use copied static/ dependencies outside .local/duo.');
      if (!samePath(directory, expectedDirectory)) throw new TypeError('Copy static/ into the state copy directory; linked static directories are not supported.');
      const sidecar = await realpath(path.join(directory, reference.id));
      if (isLiveStorePath(sidecar)) throw new TypeError('Use copied static/ dependencies outside .local/duo.');
      if (!samePath(path.dirname(sidecar), directory)) throw new TypeError(`Invalid static field location: ${key}`);
      const compressed = await readFile(sidecar), content = gunzipSync(compressed);
      if (createHash('sha256').update(content).digest('hex') !== reference.sha256) throw new TypeError(`Static field checksum mismatch: ${key}`);
      state[key] = JSON.parse(content.toString('utf8'));
      dependencies.push({ file: sidecar, bytes: compressed });
    }
  }
  state = validateOwnedState(state);
  return { state, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    async verifyUnchanged() {
      for (const dependency of [{ file, bytes }, ...dependencies]) {
        if (!dependency.bytes.equals(await readFile(dependency.file))) throw new Error('State copy or static dependency changed during preview.');
      }
    } };
}

/** Flatten display records without treating their resource selectors as
 * walking reachability. Identity and classification are separate fields. */
export function buildObjectCanonicalMap(resourceCatalogue, resourceSelectors) {
  const classes = new Map((resourceCatalogue.classes ?? []).map(row => [row.key ?? row.classKey, row]));
  const canonical = new Map();
  for (const mapping of resourceSelectors.mappings ?? []) {
    const keys = mapping.classKeys ?? (mapping.classKey ? [mapping.classKey] : []);
    if (keys.length !== 1 || mapping.unmatchedChildren?.length || typeof mapping.name !== 'string' || mapping.name.includes('[+]')) continue;
    const definition = classes.get(keys[0]);
    if (typeof definition?.name !== 'string' || !definition.name || definition.name.includes('[+]')) continue;
    canonical.set(mapping.name, { name: definition.name, classKey: keys[0] });
  }
  return canonical;
}

export function flattenChunkContents(record, chunkId, canonicalNames = new Map()) {
  const rows = new Map();
  function visit(data, location) {
    if (!object(data)) return;
    for (const [name, quantity] of Object.entries(data.Object ?? {}).sort(([a], [b]) => compare(a, b))) {
      const provenance = data.ObjectProvenance?.[name] ?? {};
      const canonical = canonicalNames.get(name);
      const label = canonical?.name ?? name;
      const id = canonical ? entityId('object', label) : entityId('object', name, provenance);
      let row = rows.get(id);
      if (!row) { row = { id, kind: 'object', label, labels: [], classifications: [], locations: [], quantities: [], placementIds: [] }; rows.set(id, row); }
      row.labels.push(name);
      const classification = { source: provenance.source ?? 'retained-only', classKey: provenance.classKey ?? canonical?.classKey ?? null };
      if (!row.classifications.some(value => same(value, classification))) row.classifications.push(classification);
      row.locations.push(location);
      const placementIds = unique(provenance.placements ?? []);
      row.placementIds.push(...placementIds);
      row.quantities.push({ location, quantity, ...(placementIds.length ? { placementIds } : {}) });
    }
    for (const [section, contents] of Object.entries(data.Sections ?? {}).sort(([a], [b]) => compare(a, b))) visit(contents, `${chunkId}-${section}`);
    for (const [component, contents] of Object.entries(data.CacheComponents ?? {}).sort(([a], [b]) => compare(a, b))) visit(contents, component);
  }
  visit(record, chunkId);
  return [...rows.values()].sort((a, b) => compare(a.id, b.id)).map(row => ({ ...row,
    labels: unique(row.labels), classifications: row.classifications.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), locations: unique(row.locations), placementIds: unique(row.placementIds),
    quantities: row.quantities.sort((a, b) => compare(a.location, b.location)) }));
}

export function diffChunkContents(before, after) {
  const prior = new Map(before.map(row => [row.id, row])), current = new Map(after.map(row => [row.id, row]));
  const result = { added: [], removed: [], reclassified: [], changed: [] };
  for (const id of unique([...prior.keys(), ...current.keys()])) {
    const old = prior.get(id), next = current.get(id);
    if (!old) result.added.push(next);
    else if (!next) result.removed.push(old);
    else {
      if (!same(old.classifications, next.classifications) || !same(old.labels, next.labels)) result.reclassified.push({ id, label: next.label,
        before: old.classifications, after: next.classifications, beforeLabels: old.labels, afterLabels: next.labels });
      if (!same(old.locations, next.locations) || !same(old.quantities, next.quantities)) result.changed.push({ id, label: next.label,
        before: { locations: old.locations, quantities: old.quantities }, after: { locations: next.locations, quantities: next.quantities } });
    }
  }
  return result;
}

const kindAlias = { objects: 'object', npcs: 'npc', monsters: 'monster', shops: 'shop', drop: 'monster', spawn: 'item' };
const baseChunk = location => /^\d+(?:-\d+)?$/.test(location) ? location.split('-')[0] : null;

export function summarizeTask(task, registry) {
  const resolved = resolveIdentity(task.id, registry, task.category);
  const sources = (task.sources ?? []).map(source => {
    const kind = kindAlias[source.kind] ?? source.kind ?? 'unknown';
    const locations = unique([source.location, ...source.locations ?? []].filter(value => typeof value === 'string'));
    const name = source.name ?? source.source;
    const taskIdentity = source.task ?? source.taskId;
    const sourceIdentity = taskIdentity ? resolveIdentity(taskIdentity, registry) : null;
    const identity = taskIdentity ? sourceIdentity.status === 'resolved' ? sourceIdentity.id : taskIdentity : name ? entityId(kind, name) : source.id ?? null;
    return { kind, id: identity, itemId: source.item ? entityId('item', source.item) : null, locations, chunks: unique(locations.map(baseChunk).filter(Boolean)) };
  });
  const canonicalSources = [...new Map(sources.map(source => [JSON.stringify(source), source])).values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return { id: resolved.status === 'resolved' ? resolved.id : task.id, label: task.label, status: task.status,
    available: task.status === 'available', obligation: task.obligation !== false,
    sourceChunks: unique(canonicalSources.flatMap(source => source.chunks)), sources: canonicalSources };
}

export function diffTasks(before, after) {
  const prior = new Map(before.map(row => [row.id, row])), current = new Map(after.map(row => [row.id, row]));
  const changes = [];
  for (const id of unique([...prior.keys(), ...current.keys()])) {
    const old = prior.get(id), next = current.get(id);
    const becameAvailable = !old?.available && !!next?.available;
    const becameUnavailable = !!old?.available && !next?.available;
    const sourcesChanged = !same(old?.sources ?? [], next?.sources ?? []);
    if (!becameAvailable && !becameUnavailable && !sourcesChanged) continue;
    changes.push({ id, label: next?.label ?? old.label, becameAvailable, becameUnavailable, sourcesChanged,
      before: old ?? null, after: next ?? null,
      addedSourceChunks: (next?.sourceChunks ?? []).filter(chunk => !(old?.sourceChunks ?? []).includes(chunk)),
      removedSourceChunks: (old?.sourceChunks ?? []).filter(chunk => !(next?.sourceChunks ?? []).includes(chunk)) });
  }
  return changes;
}

/** Compare canonical task summaries by owned chunk, regardless of source kind,
 * name or location. Another source in the same chunk replaces a lost source;
 * partner, selected and pending chunks never count as owned regressions. */
export function findSourceChunkRegressions(before, after, unlocked) {
  const owned = new Set(unlocked), current = new Map(after.map(row => [row.id, row]));
  return [...before].sort((a, b) => compare(a.id, b.id)).flatMap(old => {
    const next = current.get(old.id);
    const lostSourceChunks = unique((old.sourceChunks ?? []).filter(chunk => owned.has(chunk)
      && !(next?.sourceChunks ?? []).includes(chunk)));
    return lostSourceChunks.length ? [{ id: old.id, label: next?.label ?? old.label, lostSourceChunks,
      before: old, after: next ?? null }] : [];
  });
}

function createEvaluator(definitions, options) {
  const engine = createTaskEngine(definitions, { dataset: selectedDataset, ...options }), collection = createCollectionEngine(definitions, { dataset: selectedDataset });
  const equipmentNames = Object.keys(definitions.equipment ?? {});
  const equipmentIds = new Map(buildEquipmentCatalogue(definitions).map((row, index) => [row.id, equipmentNames[index]]));
  return (state, memberId) => {
    const member = state.members.find(row => row.id === memberId);
    const savedIds = unique([...Object.keys(member.taskStatus ?? {}), ...member.completedTasks ?? []]);
    const result = engine.evaluate(state, memberId, { ownItemQueries: savedIds.filter(id => equipmentIds.has(id)).map(id => equipmentIds.get(id)) });
    const collected = collection.evaluate(state, memberId, result, { obligationQueries: savedIds });
    result.tasks.push(...collected.tasks);
    const equipment = evaluateEquipment(result, state, memberId, definitions);
    result.tasks = [...new Map([...result.tasks, ...equipment.catalogue].map(row => [row.id, row])).values()];
    return result;
  };
}

/** Both sides use the identical walking topology. Selected and pending chunks
 * are inspected as declared contents; they never become hypothetical unlocks. */
export function buildResourcePreview(definitions, state, { resourceCatalogue = defaultResourceCatalogue, resourceSelectors = defaultResourceSelectors,
  metadataCorrections = true, lodestones, reviewedOverlays } = {}) {
  const original = JSON.stringify(state);
  const shared = { cacheWalking: true, resourceCatalogue, resourceSelectors, metadataCorrections, lodestones,
    ...(reviewedOverlays === undefined ? {} : { reviewedOverlays }) };
  const canonicalNames = buildObjectCanonicalMap(resourceCatalogue, resourceSelectors);
  const beforeWorld = buildWorld(definitions, { dataset: selectedDataset, ...shared, cacheResources: false });
  const afterWorld = buildWorld(definitions, { dataset: selectedDataset, ...shared, cacheResources: true });
  if (!(beforeWorld.resourceContents instanceof Map) || !(afterWorld.resourceContents instanceof Map)) throw new Error('Resource contents world API is required.');
  const topology = world => JSON.stringify([...world.sectionTopology].map(([id, sections]) => [id, [...sections]]));
  if (topology(beforeWorld) !== topology(afterWorld)) throw new Error('Resource switch changed walking topology.');
  const beforeEvaluate = createEvaluator(definitions, { ...shared, cacheResources: false });
  const afterEvaluate = createEvaluator(definitions, { ...shared, cacheResources: true });
  const members = [...state.members].sort((a, b) => compare(a.id, b.id)).map(member => {
    const ids = unique([...member.unlocked, ...member.selected, ...member.pendingRoll]);
    const chunks = ids.map(id => ({ id, label: afterWorld.chunks.get(id)?.name ?? id,
      scopes: ['unlocked', 'selected', 'pendingRoll'].filter(scope => member[scope].includes(id)),
      ...diffChunkContents(flattenChunkContents(beforeWorld.resourceContents.get(id), id, canonicalNames), flattenChunkContents(afterWorld.resourceContents.get(id), id, canonicalNames)) }));
    const before = beforeEvaluate(state, member.id), after = afterEvaluate(state, member.id);
    const beforeTasks = before.tasks.map(task => summarizeTask(task, state.identityRegistry));
    const afterTasks = after.tasks.map(task => summarizeTask(task, state.identityRegistry));
    const tasks = diffTasks(beforeTasks, afterTasks);
    const sourceChunkLosses = findSourceChunkRegressions(beforeTasks, afterTasks, member.unlocked);
    const availabilityChanges = tasks.filter(task => task.becameAvailable || task.becameUnavailable);
    return { id: member.id, chunks, tasks, regressions: { sourceChunkLosses, availabilityChanges },
      counts: { beforeAvailable: before.tasks.filter(task => task.status === 'available').length, afterAvailable: after.tasks.filter(task => task.status === 'available').length,
        // Count task/chunk pairs: two tasks losing the same chunk are two losses.
        lostSourceTasks: sourceChunkLosses.length, lostSourceChunks: sourceChunkLosses.reduce((sum, row) => sum + row.lostSourceChunks.length, 0),
        availabilityGains: availabilityChanges.filter(task => task.becameAvailable).length,
        availabilityLosses: availabilityChanges.filter(task => task.becameUnavailable).length } };
  });
  if (original !== JSON.stringify(state)) throw new Error('Preview evaluation mutated its supplied state.');
  return { schemaVersion: 1, cacheWalking: true, metadataCorrections, beforeCacheResources: false, afterCacheResources: true,
    taskCoverage: 'Task engine, collection goals and equipment catalogue; availability and canonical source identities/locations. Presentation hiding and saved derived-row fallback are not compared.',
    members };
}

export function renderResourcePreview(report) {
  const lines = ['Resource contents preview', 'Before: retained resources. After: cache resources. Walking topology is identical.',
    'Selected and pending chunks are contents-only previews; task evaluation uses current unlocks.', report.taskCoverage];
  const describe = row => `${row.label} [${row.id}] ${JSON.stringify({ labels: row.labels, classifications: row.classifications, locations: row.locations, quantities: row.quantities })}`;
  for (const member of report.members) {
    lines.push('', `Member ${member.id}`, `Available task rows: ${member.counts.beforeAvailable} -> ${member.counts.afterAvailable}`);
    const losses = member.regressions?.sourceChunkLosses ?? [];
    const availability = member.regressions?.availabilityChanges ?? member.tasks.filter(task => task.becameAvailable || task.becameUnavailable);
    lines.push('', `Owned source chunk losses: ${losses.length} task(s), ${losses.reduce((sum, row) => sum + row.lostSourceChunks.length, 0)} task/chunk pair(s)`);
    for (const row of losses) lines.push(`  ${row.label} [${row.id}]: lost ${JSON.stringify(row.lostSourceChunks)}; no replacement source in those owned chunks`);
    if (!losses.length) lines.push('  No owned source chunk losses.');
    lines.push('', `Availability changes: ${availability.filter(task => task.becameAvailable).length} gain(s), ${availability.filter(task => task.becameUnavailable).length} loss(es)`);
    for (const row of availability) lines.push(`  ${row.label} [${row.id}]: ${row.becameAvailable ? 'became available' : 'became unavailable'}`);
    for (const chunk of member.chunks) {
      lines.push('', `${chunk.id} ${chunk.label} (${chunk.scopes.join(', ')})`);
      for (const row of chunk.added) lines.push(`  Added: ${describe(row)}`);
      for (const row of chunk.removed) lines.push(`  Removed: ${describe(row)}`);
      for (const row of chunk.reclassified) lines.push(`  Reclassified: ${row.label} [${row.id}] labels ${JSON.stringify(row.beforeLabels)} -> ${JSON.stringify(row.afterLabels)}; ${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`);
      for (const row of chunk.changed) lines.push(`  Locations/quantities changed: ${row.label} [${row.id}] ${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`);
      if (!chunk.added.length && !chunk.removed.length && !chunk.reclassified.length && !chunk.changed.length) lines.push('  No resource or facility changes.');
    }
    lines.push('', 'Task changes');
    for (const task of member.tasks) {
      const changes = [task.becameAvailable && 'became available', task.becameUnavailable && 'became unavailable', task.sourcesChanged && 'sources changed'].filter(Boolean);
      lines.push(`  ${task.label} [${task.id}]: ${changes.join('; ')}`,
        `    Source chunks: ${JSON.stringify(task.before?.sourceChunks ?? [])} -> ${JSON.stringify(task.after?.sourceChunks ?? [])}`,
        `    Sources: ${JSON.stringify(task.before?.sources ?? [])} -> ${JSON.stringify(task.after?.sources ?? [])}`);
    }
    if (!member.tasks.length) lines.push('  No availability or source changes.');
  }
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  let statePath, json = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--state' && args[index + 1] && !args[index + 1].startsWith('--') && statePath === undefined) statePath = args[++index];
    else if (args[index] === '--json' && !json) json = true;
    else throw new Error('Use node scripts/preview-resource-contents.mjs --state <state.json copy> [--json]');
  }
  if (!statePath) throw new Error('Use node scripts/preview-resource-contents.mjs --state <state.json copy> [--json]');
  const loaded = await readStateCopy(statePath);
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const report = { ...buildResourcePreview(definitions, loaded.state), sourceSha256: loaded.sourceSha256 };
  await loaded.verifyUnchanged();
  process.stdout.write(`${json ? JSON.stringify(report, null, 2) : renderResourcePreview(report)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
