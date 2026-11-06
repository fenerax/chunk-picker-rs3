import { readFile, lstat, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { replaceSidecar, validatePluginAchievementStore } from '../plugin-achievements.mjs';
import { validatePluginItemStore } from '../plugin-items.mjs';
import { reconcilePluginHandled } from './plugin-handled.mjs';
import { syncDirectory } from './publication.mjs';
import { withStoreWrite } from './snapshot.mjs';
import { withPluginEvidence } from './plugin-evidence-lock.mjs';

export const legacyPluginHandledFiles = ['plugin-achievements.json', 'plugin-items.json'];
const stores = [validatePluginAchievementStore, validatePluginItemStore];

export function decodeLegacyPluginHandled(state, files, unavailable = new Map()) {
  if (unavailable.size) throw new Error('Legacy plugin handled evidence is unavailable.');
  const players = new Map();
  for (const [index, name] of legacyPluginHandledFiles.entries()) {
    if (!files.has(name)) continue;
    const document = stores[index](JSON.parse(files.get(name).toString('utf8')));
    for (const [player, record] of Object.entries(document.players)) {
      if (!record.handled.length) continue;
      const entry = players.get(player) ?? { achievements: [], items: [] };
      entry[index === 0 ? 'achievements' : 'items'] = record.handled;
      players.set(player, entry);
    }
  }
  return players.size ? reconcilePluginHandled(state, { provenance: { pluginAutoHandled: Object.fromEntries(players) } }) : reconcilePluginHandled(state);
}

export async function foldLegacyPluginHandled({ dataDir, state }) {
  const files = new Map();
  for (const name of legacyPluginHandledFiles) {
    try { files.set(name, await readFile(path.join(dataDir, name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const next = decodeLegacyPluginHandled(state, files);
  return isDeepStrictEqual(next.provenance, state.provenance) ? state : next;
}

// The caller holds the store's exclusive writer ownership. These monotonic
// writes bridge committed replay policy to releases that only read sidecars.
// Validate both unions before publishing either; a partial I/O failure must
// prevent serving/rollback, and retrying completes the same union.
export async function preparePluginHandledSidecars({ dataDir, state }) {
  state = await foldLegacyPluginHandled({ dataDir, state });
  const players = state.provenance?.pluginAutoHandled;
  if (!players) return [];
  const publications = [];
  for (const [kind, name, validate] of [
    ['achievements', 'plugin-achievements.json', validatePluginAchievementStore],
    ['items', 'plugin-items.json', validatePluginItemStore],
  ]) {
    const committed = Object.entries(players).filter(([, record]) => record[kind].length);
    if (!committed.length) continue;
    const file = path.join(dataDir, name);
    let original = { v: 1, players: {} }, previous = null;
    try { previous = await readFile(file); original = validate(JSON.parse(previous.toString('utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = structuredClone(original);
    for (const [player, record] of committed) {
      const previous = Object.hasOwn(next.players, player) ? next.players[player] : kind === 'items'
        ? { baselineAt: '1970-01-01T00:00:00.000Z', items: {}, handled: [], journal: null } : { handled: [] };
      const handled = [...new Set([...previous.handled, ...record[kind]])].sort(kind === 'achievements' ? (a, b) => a - b : undefined);
      Object.defineProperty(next.players, player, { value: { ...previous, handled }, enumerable: true, configurable: true, writable: true });
    }
    validate(next); // Includes the legacy limits: never truncate either source.
    publications.push({ file, dataDir, previous, next, changed: !isDeepStrictEqual(original, next) });
  }
  return publications;
}

// Stage every write and its exact preimage before publishing any store. On a
// refused start, restore published preimages using only rename/unlink, then
// remove our staging files. Gameplay is never rewritten by this bridge.
export async function publishPluginHandledSidecars(publications) {
  const staged = [], installed = [], parents = [...new Set(publications.map(row => row.dataDir))];
  async function stage(file, bytes, metadata) {
    const handle = await open(file, 'wx', metadata.mode & 0o777);
    try {
      await handle.writeFile(bytes);
      if (process.platform !== 'win32') { await handle.chmod(metadata.mode & 0o777); await handle.chown(metadata.uid, metadata.gid); }
      await handle.sync();
    } finally { await handle.close(); }
  }
  try {
    for (const row of publications.filter(row => row.changed)) {
      const id = randomUUID(), temporary = row.file + `.reconcile-${id}.new`, preimage = row.file + `.reconcile-${id}.previous`;
      const metadata = await lstat(row.previous === null ? row.dataDir : row.file);
      if (row.previous !== null && (!metadata.isFile() || metadata.nlink !== 1)) throw new Error('Linked plugin evidence is refused.');
      const entry = { ...row, temporary, preimage, metadata }; staged.push(entry);
      await stage(temporary, Buffer.from(`${JSON.stringify(row.next)}\n`), row.previous === null ? { ...metadata, mode: 0o600 } : metadata);
      if (row.previous !== null) await stage(preimage, row.previous, metadata);
    }
    for (const parent of parents) await syncDirectory(parent);
    for (const entry of staged) { await rename(entry.temporary, entry.file); installed.push(entry); }
    for (const parent of parents) await syncDirectory(parent);
    await cleanStaging();
  } catch (cause) {
    const failures = [];
    for (const entry of installed.reverse()) {
      try {
        if (entry.previous === null) await rm(entry.file);
        else {
          // Cleanup may already have removed an earlier preimage. Retain its
          // bytes until the entire transaction, including cleanup, succeeds.
          try { await lstat(entry.preimage); }
          catch (error) { if (error.code !== 'ENOENT') throw error; await stage(entry.preimage, entry.previous, entry.metadata); }
          await rename(entry.preimage, entry.file);
        }
      } catch (error) { failures.push(error); }
    }
    try { await cleanStaging(); } catch (error) { failures.push(error); }
    for (const parent of parents) try { await syncDirectory(parent); } catch (error) { failures.push(error); }
    if (failures.length) cause.rollbackErrors = failures;
    throw cause;
  }
  async function cleanStaging() {
    for (const entry of staged) { await rm(entry.temporary, { force: true }); await rm(entry.preimage, { force: true }); }
  }
}

export async function reconcilePluginHandledSidecars({ dataDir, state }) {
  const publications = await preparePluginHandledSidecars({ dataDir, state });
  if (!publications.length) return;
  await withStoreWrite(dataDir, () => withPluginEvidence(dataDir, async () => {
    for (const { file, next, changed } of publications) {
      if (changed) await replaceSidecar(file, `${JSON.stringify(next)}\n`, false, Date.now);
    }
    // replaceSidecar syncs file contents. Also sync unchanged entries' parent:
    // an earlier attempt may have renamed successfully then failed this sync.
    await syncDirectory(dataDir);
  }));
}
