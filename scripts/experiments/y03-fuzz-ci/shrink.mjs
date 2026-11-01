// Bounded delta debugging: saved arrays/maps only; world and request stay fixed.
export async function shrink(original, request, accepts, validate, maxAttempts = 40) {
  let state = structuredClone(original), attempts = 0, changed = true;
  async function tryState(candidate) {
    try { validate(candidate); } catch { return false; }
    if (attempts >= maxAttempts) return false;
    attempts++;
    if (!await accepts(candidate)) return false;
    state = candidate; return true;
  }
  while (changed && attempts < maxAttempts) {
    changed = false;
    const paths = [['rules'], ['tasks'], ...state.members.flatMap((_, i) =>
      ['unlocked', 'selected', 'pendingRoll', 'blacklisted', 'completedTasks', 'passiveLevels', 'taskRules'].map(key => ['members', i, key]))];
    for (const keys of paths) {
      const parent = value => keys.slice(0, -1).reduce((v, key) => v[key], value), key = keys.at(-1);
      let value = parent(state)[key];
      if (!value) continue;
      let entries = Array.isArray(value) ? [...value] : Object.keys(value), granularity = 2;
      while (entries.length && attempts < maxAttempts) {
        const size = Math.max(1, Math.ceil(entries.length / granularity)); let reduced = false;
        for (let i = 0; i < entries.length && attempts < maxAttempts; i += size) {
          const remaining = entries.filter((_, j) => j < i || j >= i + size);
          if (key === 'unlocked' && !remaining.length) continue;
          const candidate = structuredClone(state);
          parent(candidate)[key] = Array.isArray(value) ? remaining : Object.fromEntries(remaining.map(k => [k, value[k]]));
          if (await tryState(candidate)) { value = parent(state)[key]; entries = remaining; changed = reduced = true; break; }
        }
        if (reduced) granularity = Math.max(2, granularity - 1);
        else if (granularity >= entries.length) break;
        else granularity = Math.min(entries.length, granularity * 2);
      }
    }
    for (let i = 0; i < state.members.length && state.members.length > 1 && attempts < maxAttempts; i++) {
      if (state.members[i].id === request.memberId) continue;
      const candidate = structuredClone(state); candidate.members.splice(i, 1);
      if (await tryState(candidate)) { changed = true; break; }
    }
  }
  return { state, attempts, censored: attempts >= maxAttempts };
}
