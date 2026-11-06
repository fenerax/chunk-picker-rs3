import { readFile } from 'node:fs/promises';
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
export async function reconcilePluginHandledSidecars({ dataDir, state }) {
  state = await foldLegacyPluginHandled({ dataDir, state });
  const players = state.provenance?.pluginAutoHandled;
  if (!players) return;
  const publications = [];
  for (const [kind, name, validate] of [
    ['achievements', 'plugin-achievements.json', validatePluginAchievementStore],
    ['items', 'plugin-items.json', validatePluginItemStore],
  ]) {
    const committed = Object.entries(players).filter(([, record]) => record[kind].length);
    if (!committed.length) continue;
    const file = path.join(dataDir, name);
    let original = { v: 1, players: {} };
    try { original = validate(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = structuredClone(original);
    for (const [player, record] of committed) {
      const previous = Object.hasOwn(next.players, player) ? next.players[player] : kind === 'items'
        ? { baselineAt: '1970-01-01T00:00:00.000Z', items: {}, handled: [], journal: null } : { handled: [] };
      const handled = [...new Set([...previous.handled, ...record[kind]])].sort(kind === 'achievements' ? (a, b) => a - b : undefined);
      Object.defineProperty(next.players, player, { value: { ...previous, handled }, enumerable: true, configurable: true, writable: true });
    }
    validate(next); // Includes the legacy limits: never truncate either source.
    publications.push({ file, next, changed: !isDeepStrictEqual(original, next) });
  }
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
