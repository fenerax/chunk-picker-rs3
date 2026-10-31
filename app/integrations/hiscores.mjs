import { observedSkills, validateRuneScapeName } from '../core/game-progress.mjs';

// RS3 index_lite.ws: overall rank,total-level,XP, then one rank,level,XP
// line per skill in the official skill-ID order. Later lines are activities.
export function parseHiscoresLite(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new TypeError('Invalid RS3 hiscores response.');
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < observedSkills.length + 1) throw new TypeError('Incomplete RS3 hiscores response.');
  const row = line => {
    if (!/^-?\d+,-?\d+,-?\d+$/.test(line)) throw new TypeError('Invalid RS3 hiscores row.');
    const values = line.split(',').map(Number);
    if (!values.every(Number.isSafeInteger) || values.some(value => value < -1)) throw new TypeError('Invalid RS3 hiscores values.');
    return values;
  };
  row(lines[0]);
  return observedSkills.flatMap((skill, id) => {
    const [rank, level, xp] = row(lines[id + 1]);
    if (rank === -1) return []; // Unranked means unknown, never level zero.
    if (level < 1 || level > 120 || xp < 0 || xp > 200_000_000) throw new TypeError('Invalid RS3 hiscores skill.');
    return [{ skill, level, xp }];
  });
}

export function createHiscoresSource({ fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 10_000 } = {}) {
  const controllers = new Set();
  return {
    async snapshot(member) {
      const name = validateRuneScapeName(member.runescapeName);
      const url = new URL('https://secure.runescape.com/m=hiscore/index_lite.ws');
      url.searchParams.set('player', name);
      const controller = new AbortController(); controllers.add(controller);
      let timer;
      try {
        const operation = (async () => {
          const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error',
            headers: { Accept: 'text/plain', 'User-Agent': 'RS3ChunkPicker/0.1 (on-demand personal progress sync)' } });
          if (!response.ok) throw new Error('RS3 hiscores is unavailable.');
          return { source: 'hiscores', sourceLabel: 'RS3 hiscores', fetchedAt: new Date(clock()).toISOString(), cached: false,
            skills: parseHiscoresLite(await response.text()), quests: [] };
        })();
        const deadline = new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('RS3 hiscores timed out.')); }, timeoutMs);
        });
        return await Promise.race([operation, deadline]);
      } finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); }
    },
    close() { for (const controller of controllers) controller.abort(); },
  };
}
