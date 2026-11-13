import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { openStore, DEFAULT_RETENTION } from '../../../app/storage/store.mjs';
import { buildWorld } from '../../../app/data/world.mjs';
import { prepareFixtureInputs } from './fixture-inputs.mjs';
import { loadCapacityOwnedRelease } from './owned-release.mjs';
import { syntheticWorld } from './model.mjs';

const backupId = /^(\d{16})-[a-f0-9]{16}\.json(?:\.gz)?$/;
// The same metadata-only recent/daily/first/latest selection as the store.
// These are selection candidates; pinned documents may correctly remain.
export async function retentionInventory(dataDir, at, policy = DEFAULT_RETENTION) {
  const directory = path.join(dataDir, 'backups');
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const backups = await Promise.all(entries.filter(row => row.isFile() && backupId.test(row.name)).map(async row => {
    const value = await stat(path.join(directory, row.name));
    return { id: row.name, revision: Number(backupId.exec(row.name)[1]), at: value.mtime.toISOString() };
  }));
  backups.sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at));
  const keep = new Set([backups[0]?.id, backups.at(-1)?.id]), days = new Set(), candidates = [];
  for (const row of backups) {
    const day = row.at.slice(0, 10), daily = !days.has(day); days.add(day);
    if (!keep.has(row.id) && !daily && Date.parse(row.at) < Date.parse(at) - policy.backupDays * 86400000) candidates.push(row.id);
  }
  const packs = (await readdir(path.join(directory, 'archives')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }))
    .filter(name => /^archive-[a-f0-9]{16}\.json\.gz$/.test(name));
  return { standaloneIds: backups.map(row => row.id), candidateIds: candidates, packIds: packs };
}

export async function normalizeStoreRetention(options, { at = new Date().toISOString(), open = openStore } = {}) {
  at = new Date(at).toISOString();
  const before = await retentionInventory(options.dataDir, at, options.retention);
  const store = await open({ ...options, now: at });
  try {
    await store.prepareSnapshot();
    const retention = store.getInfo().retention;
    if (retention.failure) throw new Error(`Fixture retention normalization failed: ${retention.failure}`);
    const after = await retentionInventory(options.dataDir, at, options.retention);
    return { at, candidatesBefore: before.candidateIds.length, candidatesAfter: after.candidateIds.length,
      packedSnapshots: before.standaloneIds.filter(id => !after.standaloneIds.includes(id)).length,
      packsBefore: before.packIds.length, packsAfter: after.packIds.length,
      packsAdded: after.packIds.filter(id => !before.packIds.includes(id)).length,
      retainedSnapshots: (await store.listBackups()).length, retention };
  } finally { await store.close(); }
}

// Only receives a new fixture or an already byte-verified working copy.
export async function normalizeFixtureRetention(directory, profile, manifest, { servingNow = Date.now } = {}) {
  const at = new Date(typeof servingNow === 'function' ? servingNow() : servingNow).toISOString();
  const { data, rules } = await prepareFixtureInputs(profile);
  const world = syntheticWorld(data, buildWorld);
  const owned = manifest.storageFormat === 'format2' ? await loadCapacityOwnedRelease(directory) : false;
  const legacy = await normalizeStoreRetention({ dataDir: path.join(directory, 'legacy'), world, registry: rules }, { at });
  const groups = [];
  for (const group of manifest.groups) {
    const receipt = await normalizeStoreRetention({ dataDir: path.join(directory, 'pickers', group.pickerId), world, registry: rules,
      ownedFormat2: owned ? { ...owned, pickerId: group.pickerId } : false }, { at });
    group.retention = receipt.retention; group.retainedSnapshots = receipt.retainedSnapshots;
    group.retentionNormalization = receipt; groups.push({ index: group.index, ...receipt });
  }
  const totals = Object.fromEntries(['candidatesBefore', 'candidatesAfter', 'packedSnapshots', 'packsAdded'].map(key =>
    [key, [legacy, ...groups].reduce((sum, row) => sum + row[key], 0)]));
  return manifest.retentionNormalization = { clock: 'serving-wall-clock', at,
    candidateMeaning: 'metadata selection before document pin checks; packedSnapshots counts validated standalone removals', ...totals, legacy, groups };
}
