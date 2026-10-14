// Pool summaries are small, independent of the protected prepared-unlock cache.
// Reading them never requests a calculation or refreshes a worker's idle clock.
const SKILLS = new Set('Attack Strength Defence Ranged Prayer Magic Runecrafting Construction Dungeoneering Constitution Agility Herblore Thieving Crafting Fletching Slayer Hunter Mining Smithing Fishing Cooking Firemaking Woodcutting Farming Summoning Divination Invention Archaeology Necromancy'.split(' '));
const text = value => String(value?.label ?? value?.name ?? value ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 240);
const examples = values => [...new Set(values.map(text).filter(Boolean))].slice(0, 3);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function summarizePoolPrediction(id, prediction) {
  const delta = prediction?.delta;
  if (!Array.isArray(delta?.tasksAdded) || prediction.cancelled) return;
  const tasks = delta.tasksAdded, bySkill = {};
  for (const task of tasks) {
    if (!SKILLS.has(task.category)) continue;
    const row = bySkill[task.category] ??= { count: 0, examples: [] };
    row.count++;
    if (row.examples.length < 3 && text(task)) row.examples.push(text(task));
  }
  const objects = delta.objectsAdded ?? [];
  return { id: String(id), status: 'checked', count: tasks.length, examples: examples(tasks), bySkill,
    notable: {
      quests: examples(tasks.filter(task => /^quests?$/i.test(task.category) || task.kind === 'quest')),
      shops: examples(delta.shopsAdded ?? []),
      resources: examples([...(delta.itemsAdded ?? []), ...objects.filter(value => !/teleport|lodestone/i.test(text(value)))]),
      // These are newly available spell tasks or travel landmarks. They do not
      // establish a personal activation or waive the transport requirements.
      teleports: examples([...objects.filter(value => /teleport|lodestone/i.test(text(value))),
        ...tasks.filter(task => /teleport|lodestone/i.test(text(task)))]),
    } };
}

export function createPoolRanking({ limit = 512, byteLimit = 2 * 1024 * 1024, leaseMs = 30000, now = Date.now } = {}) {
  const summaries = new Map(), interests = new Map(), pools = new Map(), counts = new Map();
  let input, bytes = 0;
  const key = (memberId, id) => JSON.stringify([memberId, String(id)]);
  const sync = nextInput => {
    if (nextInput === input) return;
    input = nextInput; summaries.clear(); interests.clear(); pools.clear(); counts.clear(); bytes = 0;
  };
  const remove = id => { const entry = summaries.get(id); if (entry) { bytes -= entry.bytes; summaries.delete(id); } };
  const rememberCount = (memberId, row) => {
    if (!pools.get(memberId)?.has(row.id)) return;
    counts.set(key(memberId, row.id), { id: row.id, status: 'checked', count: row.count,
      bySkill: Object.fromEntries(Object.entries(row.bySkill).map(([skill, value]) => [skill, { count: value.count, examples: [] }])),
      examples: [], notable: { quests: [], shops: [], resources: [], teleports: [] } });
  };
  const api = {
    sync,
    remember(nextInput, memberId, id, prediction) {
      if (nextInput !== input) return false;
      const row = summarizePoolPrediction(id, prediction);
      if (!row) return false;
      // Counts cover the complete known pools, even when the richer examples
      // exceed their separate LRU budget. Their size follows the world/roster,
      // never a request history, and no candidate is repeatedly recalculated.
      rememberCount(memberId, row);
      const size = Buffer.byteLength(JSON.stringify(row)), cacheKey = key(memberId, id);
      if (size > byteLimit) return false;
      remove(cacheKey); summaries.set(cacheKey, { row, bytes: size }); bytes += size;
      while (summaries.size > limit || bytes > byteLimit) remove(summaries.keys().next().value);
      return true;
    },
    read(nextInput, memberId, revision, ids, peek = () => undefined) {
      sync(nextInput);
      const pool = new Set(ids.map(String));
      for (const id of pools.get(memberId) ?? []) if (!pool.has(id)) counts.delete(key(memberId, id));
      pools.set(memberId, pool);
      const rows = [...pool].map(id => {
        const cacheKey = key(memberId, id);
        if (!summaries.has(cacheKey) && !counts.has(cacheKey)) api.remember(nextInput, memberId, id, peek(id));
        const summary = summaries.get(cacheKey)?.row;
        if (summary) rememberCount(memberId, summary);
        return summary ?? counts.get(cacheKey) ?? { id, status: 'estimated', count: null, examples: [], bySkill: {},
          notable: { quests: [], shops: [], resources: [], teleports: [] } };
      });
      rows.sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || compare(a.id, b.id));
      return { memberId, stateRevision: revision, total: rows.length, checked: rows.filter(row => row.status === 'checked').length, rows };
    },
    interest(nextInput, watcher, memberId, visible) {
      sync(nextInput);
      api.interestedMembers();
      const previous = interests.get(watcher);
      const fresh = !previous || previous.memberId !== memberId;
      if (visible && (previous || interests.size < 128)) interests.set(watcher, { memberId, until: now() + leaseMs });
      else interests.delete(watcher);
      return visible && fresh && interests.has(watcher);
    },
    interestedMembers() {
      for (const [watcher, interest] of interests) if (interest.until <= now()) interests.delete(watcher);
      return new Set([...interests.values()].map(row => row.memberId));
    },
    missing(memberId, ids) { return ids.filter(id => !summaries.has(key(memberId, id)) && !counts.has(key(memberId, id))); },
    clear() { summaries.clear(); interests.clear(); pools.clear(); counts.clear(); bytes = 0; },
    diagnostics() { return { entries: summaries.size, bytes, limit, byteLimit, countedRows: counts.size, watchers: interests.size }; },
  };
  return api;
}
