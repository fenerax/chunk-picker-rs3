import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, readdir, statfs } from 'node:fs/promises';
import { SNAPSHOT_EXCLUSIONS } from './store-identity-policy.mjs';

export const CAPTURE_FILE_BUDGET = 4096;
export const DEFAULT_STORAGE_BUDGET = Object.freeze({ maxBytes: 1024 ** 3, maxFiles: 3584, minFreeBytes: 5 * 1024 ** 3 });
const variables = { maxBytes: 'RS3_STORE_MAX_BYTES', maxFiles: 'RS3_STORE_MAX_FILES', minFreeBytes: 'RS3_STORE_MIN_FREE_BYTES' };
export function storageBudget(options = {}, env = process.env) {
  const result = {};
  if (!options || Object.keys(options).some(key => !Object.hasOwn(variables, key))) throw new TypeError('Invalid storage budget.');
  for (const [key, variable] of Object.entries(variables)) {
    const value = options[key] ?? (env[variable] === undefined ? DEFAULT_STORAGE_BUDGET[key] : Number(env[variable]));
    if (!Number.isSafeInteger(value) || value < 1 || key === 'maxFiles' && value > DEFAULT_STORAGE_BUDGET.maxFiles)
      throw new TypeError(`Invalid ${variable}. Use a positive safe integer${key === 'maxFiles' ? ' at most 3584' : ''}.`);
    result[key] = value;
  }
  return Object.freeze(result);
}

// Metadata only: never decode backups or open gameplay, registry or ledger writers.
// Count exactly the tree capture visits, plus its sibling dataset binding.
export async function storageUsage(dataDir) {
  let bytes = 0, files = 0;
  async function visit(file, root = false) {
    let info;
    try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isDirectory()) {
      for (const name of await readdir(file)) {
        if (root && SNAPSHOT_EXCLUSIONS.includes(name)) continue;
        await visit(path.join(file, name));
      }
    } else {
      // Count paths conservatively even if packing has just unlinked one
      // (Windows can report nlink=0), or multiple paths share an inode.
      if (!info.isFile()) throw new Error('Storage accounting requires regular files.');
      bytes += info.size; files++;
    }
  }
  await visit(dataDir, true);
  await visit(dataDir + '.dataset.json');
  return { bytes, files };
}

export function storagePressure(usage, limits = storageBudget()) {
  const ratio = Math.max(usage.bytes / limits.maxBytes, usage.files / limits.maxFiles);
  return ratio >= 1 || usage.files + 8 >= limits.maxFiles ? 'critical' : ratio >= 0.8 ? 'warning' : null;
}

const context = new AsyncLocalStorage(), queues = new Map(), reservations = new Map(), released = new Map();
// A refused group reuses its last walk briefly, so repeated refused writes
// cannot rescan a full store each time. Admission and maintenance clear it.
const refusedUsage = new Map(), REFUSAL_RESCAN_NS = 10_000_000_000n;
const refused = reason => Object.assign(new Error(reason + ' Ask the group owner to contact the server operator. Your saved progress, History and backup downloads remain available.'),
  { status: 507, code: 'STORAGE_BUDGET_EXCEEDED' });

// Serialize accounting with publication/packing for this group. Other groups
// reserve their entire peak output on the same filesystem before writing.
// Reservations are process-local: the service already owns all gameplay writers.
export async function withStorageBudget(dataDir, publications, limits, work, { maintenance = false } = {}) {
  const directory = path.resolve(dataDir), parent = context.getStore();
  if (parent?.directory === directory && parent.active) return work();
  const previous = queues.get(directory) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  queues.set(directory, gate);
  await previous;
  let device, reserved = 0;
  const owner = { directory, active: true };
  try {
    let growth = 0, addedFiles = 0;
    const outputSizes = [];
    const outputs = new Map(publications.map(row => [path.resolve(row.file), row.bytes]));
    for (const [file, bytes] of outputs) {
      if (!file.startsWith(directory + path.sep)) throw new TypeError('Publication escapes its group store.');
      const size = Buffer.byteLength(bytes);
      let info;
      try { info = await lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info && !info.isFile()) throw new TypeError('Publication requires a regular file.');
      growth += size - (info?.size ?? 0); addedFiles += info ? 0 : 1;
      // All outgoing bytes coexist with old files. Include allocation, temp
      // names, directory metadata and optional plugin review lowering slack.
      outputSizes.push(size);
    }
    // Maintenance (packing) only reduces the group, so it skips the walk.
    if (!maintenance) {
      const over = usage => usage.bytes + growth > limits.maxBytes || usage.files + addedFiles + 8 > limits.maxFiles;
      const recent = refusedUsage.get(directory);
      let usage = recent && process.hrtime.bigint() - recent.at < REFUSAL_RESCAN_NS ? recent.usage : undefined;
      // A cached refusal can only refuse; anything that might fit is rescanned.
      if (!usage || !over(usage)) usage = await storageUsage(directory);
      if (over(usage)) {
        if (usage !== recent?.usage) refusedUsage.set(directory, { usage, at: process.hrtime.bigint() });
        throw refused('This group has reached its retained save storage limit.');
      }
    }
    refusedUsage.delete(directory);
    device = String((await lstat(directory)).dev);
    // A reservation released while statfs runs may already be written but
    // missing from this sample. Treat its bytes as used rather than free.
    const releasedBefore = released.get(device) ?? 0;
    const disk = await statfs(directory, { bigint: true });
    const block = Math.max(4096, Number(disk.bsize));
    reserved = outputSizes.reduce((sum, size) => sum + Math.ceil(size / block) * block + block, 1024 * 1024);
    const active = reservations.get(device) ?? 0, stale = (released.get(device) ?? 0) - releasedBefore;
    if (disk.bavail * disk.bsize < BigInt(limits.minFreeBytes) + BigInt(active + stale) + BigInt(reserved)) {
      reserved = 0;
      throw refused('The server needs more free disk space before it can save this change.');
    }
    reservations.set(device, active + reserved);
    return await context.run(owner, work);
  } finally {
    owner.active = false;
    if (reserved) {
      released.set(device, (released.get(device) ?? 0) + reserved);
      const remaining = reservations.get(device) - reserved;
      if (remaining) reservations.set(device, remaining); else reservations.delete(device);
    }
    release();
    if (queues.get(directory) === gate) queues.delete(directory);
  }
}
