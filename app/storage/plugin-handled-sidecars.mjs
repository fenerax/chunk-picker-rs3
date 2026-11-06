import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validatePluginAchievementStore } from '../plugin-achievements.mjs';
import { validatePluginItemStore } from '../plugin-items.mjs';
import { reconcilePluginHandled } from './plugin-handled.mjs';
import { warnOptionalPluginData } from '../core/optional-plugin-data.mjs';

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

// Legacy decisions are optional input. Never lower current atomic decisions
// into rollback sidecars or allow an unreadable/overflowing legacy union to
// prevent gameplay. Existing valid atomic decisions always take precedence.
export async function foldLegacyPluginHandled({ dataDir, state }) {
  let next = state;
  for (const name of legacyPluginHandledFiles) {
    try {
      const files = new Map([[name, await readFile(path.join(dataDir, name))]]);
      const folded = decodeLegacyPluginHandled(next, files);
      if (!isDeepStrictEqual(folded.provenance, next.provenance)) next = folded;
    } catch (error) { if (error.code !== 'ENOENT') warnOptionalPluginData('legacy handled capture'); }
  }
  return next;
}
