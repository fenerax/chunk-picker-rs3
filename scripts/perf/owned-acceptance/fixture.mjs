import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { catalogue, random, digest, syntheticWorld } from '../capacity/model.mjs';
import { createGroupState, applyValidatedCommand } from '../../../app/core/state.mjs';
import { buildWorld } from '../../../app/data/world.mjs';
import { buildOwnedBase } from '../../../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../../../app/storage/owned-base-schema.mjs';
import { ownedCodec } from '../../../app/storage/owned-codec.mjs';
import { createOwnedStorage } from '../../../app/storage/owned-storage.mjs';
import { SEED } from './profile.mjs';

export const pickerId = index => 'p_' + (index + 1).toString(16).padStart(32, '0');
export const clock = () => '2026-11-10T12:00:00.000Z';

// Reuse the capacity topology/PRNG, without registry accounts or private inputs.
export function makeCatalogue(shape, dataset) {
  const definitions = catalogue({ tasks: shape.tasks, chunks: shape.chunks, aliases: shape.aliases,
    dependencyDepth: 4, crossLinks: 2 });
  const world = syntheticWorld(definitions, buildWorld);
  const tasks = Object.entries(definitions.challenges.Extra).map(([label, row]) =>
    ({ id: row.PickerId, label, category: 'Extra' }));
  const entries = Object.fromEntries(tasks.map(row => [row.id, { label: row.label, kind: 'task', category: row.category, aliases: [] }]));
  const aliases = Object.fromEntries(Array.from({ length: shape.aliases }, (_, i) =>
    [`Synthetic historical alias ${i}`, i % 7 ? tasks[i % tasks.length].id :
      [tasks[i % tasks.length].id, tasks[(i + 1) % tasks.length].id]]));
  return { definitions, world, ...buildOwnedBase({ dataset, tasks,
    identityRegistry: { schemaVersion: 1, entries, aliases, unresolved: [] } }) };
}

function historyTemplate(shape, registry, world) {
  let state = createGroupState(Array.from({ length: shape.members }, (_, i) =>
    ({ id: `member-${i}`, name: `Synthetic fixture member ${i}`, unlocked: [world.chunks.keys().next().value] })), registry);
  const rng = random(SEED), chunks = [...world.chunks.keys()];
  for (let i = 0; i < shape.history + shape.archiveSegments * shape.archiveEvents; i++) {
    state = applyValidatedCommand(state, { type: 'set-note', memberId: `member-${i % shape.members}`,
      chunkId: chunks[i % chunks.length], note: `Synthetic fixture history ${i} ${Math.floor(rng() * 1e9)}` },
    { registry, world, now: clock() });
  }
  return state;
}

function groupState(template, data, index, exceptionalOrder) {
  // Replace both sides of every note inverse together, preserving real guarded
  // Undo preimages while making each group's active AND archived History unique.
  const state = JSON.parse(JSON.stringify(template).replaceAll('Synthetic fixture', `Synthetic group ${index} ${SEED}`));
  state.tasks = [...data.base.tasks];
  state.tasks[index % state.tasks.length] = { ...state.tasks[index % state.tasks.length], memberIds: [`member-${index % 4}`] };
  const goal = `rs3:goal:acceptance-${index}`;
  state.tasks.push({ id: goal, label: `Synthetic goal ${index}`, category: 'Synthetic' },
    { id: `custom:acceptance-${index}`, label: `Synthetic custom ${index}`, category: 'Custom', memberIds: [`member-${(index + 1) % 4}`] });
  state.identityRegistry = structuredClone(data.base.identityRegistry);
  state.identityRegistry.entries[goal] = { label: `Synthetic goal ${index}`, kind: 'collection', category: 'Synthetic', aliases: [] };
  if (exceptionalOrder) state.identityRegistry.aliases = Object.fromEntries(Object.entries(state.identityRegistry.aliases).reverse());
  state.members.forEach((member, i) => { member.completedTasks = [data.base.tasks[(index * 4 + i + 1) % data.base.tasks.length].id]; });
  return state;
}

export async function prepareFixtures({ root, mode, shape, data, registry, onPublished = () => {} }) {
  const catalogueRoot = path.join(root, 'catalogue'), manifest = createOwnedBaseManifest([data.pin]);
  const owned = index => ({ pickerId: pickerId(index), catalogueRoot, dataset: data.pin.dataset, manifest, releaseBytes: data.bytes });
  // This is the ONLY base publication. All measured opens/commands must perform
  // zero base writes, including temporary files and the optional bounded lanes.
  if (mode === 'format2') {
    await mkdir(path.join(root, 'publisher'), { recursive: true });
    const publisher = createOwnedStorage(owned(999), path.join(root, 'publisher'));
    await publisher.withLease(() => publisher.ensurePublished(), { mode: 'exclusive' });
    onPublished();
    // Reuse storage's verified singleton. Do not retain the fixture builder's
    // second parsed tree in addition to the one used by all live stores.
    data.base = publisher.base;
  } else onPublished();
  const template = historyTemplate(shape, registry, data.world), groups = [], hashes = [];
  // Extra stores are prepared before the baseline; never close one of the 50
  // retained handles in order to run a stopped-writer or full-hook experiment.
  for (let index = 0; index < shape.groups + 4; index++) {
    const directory = path.join(root, 'groups', `synthetic-${index}`);
    await mkdir(path.join(directory, 'history'), { recursive: true });
    // The stopped-rebase fixture never opens a writer. Provision the layout a
    // writer normally creates: readers require its token, staging its backups.
    await mkdir(path.join(directory, 'backups'), { recursive: true });
    const token = Buffer.from(digest(`${SEED}:synthetic-access-token:${index}`), 'hex').toString('base64url');
    await writeFile(path.join(directory, 'access-token'), token + '\n', { flag: 'wx' });
    const state = groupState(template, data, index, index === shape.groups + 1);
    const fullHash = digest(state), references = [];
    for (let segment = 0; segment < shape.archiveSegments; segment++) {
      const events = state.history.slice(segment * shape.archiveEvents, (segment + 1) * shape.archiveEvents);
      const id = `history-${String(events[0].revision).padStart(16, '0')}-${String(events.at(-1).revision).padStart(16, '0')}-${segment.toString(16).padStart(16, '0')}.json.gz`;
      await writeFile(path.join(directory, 'history', id), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events })));
      references.push({ id });
    }
    state.history = state.history.slice(shape.archiveSegments * shape.archiveEvents);
    state.provenance = { historyArchive: references };
    const document = mode === 'format2' ? { format: 'rs3-chunk-picker', schemaVersion: 1, ...ownedCodec(data.base, data.pin).encode(state) }
      : { format: 'rs3-chunk-picker', schemaVersion: 1, state };
    await writeFile(path.join(directory, 'state.json'), JSON.stringify(document) + '\n');
    groups.push({ index, directory, owned: mode === 'format2' ? owned(index) : false });
    hashes.push(fullHash);
  }
  return { groups, hashes, manifest, catalogueRoot };
}
