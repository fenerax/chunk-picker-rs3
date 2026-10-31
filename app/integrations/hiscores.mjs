import { observedSkills, validateRuneScapeName } from '../core/game-progress.mjs';

// Official RS3 lite: overall rank,total level,XP followed by skill rank,level,XP
// in skill-ID order. Subsequent rows are activities, never additional skills.
export function parseHiscoresLite(text) {
  const rows = text.trim().split(/\r?\n/);
  if (rows.length < observedSkills.length + 1) throw new TypeError('Incomplete hiscores skills.');
  const skills = [];
  for (let id = 0; id <= observedSkills.length; id++) {
    const row = rows[id].split(',');
    if (row.length !== 3 || row.some(value => !/^-?\d+$/.test(value))) throw new TypeError('Invalid hiscores row.');
    const [rank, level, xp] = row.map(Number);
    if (![rank, level, xp].every(Number.isSafeInteger)) throw new TypeError('Invalid hiscores number.');
    if (id === 0) continue;
    // Unranked/missing skills do not replace last-known observations.
    if (level === -1 || xp === -1) continue;
    if (rank < -1 || rank === 0 || level < 1 || level > 120 || xp < 0 || xp > 200_000_000) throw new TypeError('Invalid hiscores skill.');
    skills.push({ skill: observedSkills[id - 1], level, xp });
  }
  return skills;
}

export function createHiscoresSource({ fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 10_000 } = {}) {
  const controllers = new Set();
  return {
    async snapshot(member) {
      const name = validateRuneScapeName(member.runescapeName);
      const url = new URL('https://secure.runescape.com/m=hiscore/index_lite.ws');
      url.searchParams.set('player', name);
      const controller = new AbortController(); controllers.add(controller);
      let timeout;
      try {
        const operation = (async () => {
          const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'text/plain' } });
          if (!response.ok) throw new Error('Hiscores unavailable.');
          const text = await response.text();
          if (text.length > 1024 * 1024) throw new Error('Hiscores response too large.');
          return { source: 'hiscores', sourceLabel: 'RS3 hiscores', fetchedAt: new Date(clock()).toISOString(), cached: false,
            skills: parseHiscoresLite(text), quests: [] };
        })();
        return await Promise.race([operation, new Promise((resolve, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new Error('Hiscores timeout.')); }, timeoutMs);
        })]);
      } finally { clearTimeout(timeout); controller.abort(); controllers.delete(controller); }
    },
    close() { for (const controller of controllers) controller.abort(); },
  };
}
