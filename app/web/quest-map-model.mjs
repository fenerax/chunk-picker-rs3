const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const plain = value => String(value).replace(/~\|([^|]+)\|~/g, (_, name) => name.split('#')[0]).replace(/\*+$/g, '');
const groupName = (label, record = {}) => record.BaseQuest ?? /~\|([^|]+)\|~/.exec(label ?? '')?.[1]?.split('#')[0] ?? plain(label ?? '');

/** Recorded quest geography only. Resource sources and interior entrances are
 * deliberately not inferred from item names, prose, or access calculations. */
export function questMapLocations({ quest, task, definitions = {}, world, unlocked = [] } = {}) {
  quest ??= task?.baseQuest ?? groupName(task?.rawLabel ?? task?.label, task?.record);
  const ids = new Set(), missing = new Set(), interiors = new Set(), alternatives = new Map(), visited = new Set();
  const owned = new Set(list(unlocked instanceof Set ? [...unlocked] : unlocked).map(String));
  const records = definitions.challenges ?? {}, aliases = definitions.codeItems ?? {};
  const addMissing = label => { if (label) missing.add(plain(label)); };
  const aliasKey = (token, table) => {
    if (Object.hasOwn(table, token)) return token;
    const matches = Object.keys(table).filter(key => key.toLowerCase() === token.toLowerCase());
    return matches.length === 1 ? matches[0] : undefined;
  };
  function expand(token, table, visit, path = new Set()) {
    if (typeof token !== 'string' && typeof token !== 'number') return;
    const value = String(token).trim(), match = /^(.*\[\+\])(?:x(\d+))?$/.exec(value);
    if (!match) { visit(value); return; }
    const key = aliasKey(match[1], table);
    if (!key || path.has(key) || !list(table[key]).length) { addMissing(value); return; }
    const next = new Set(path).add(key);
    for (const child of list(table[key])) expand(child, table, visit, next);
  }
  function location(token) {
    const value = String(token).replace(/\*/g, '').trim(), match = /^(.*\[\+\])(?:x(\d+))?$/.exec(value);
    const locations = [];
    expand(value, aliases.chunksPlus ?? {}, name => {
      locations.push(name);
      if (/^\d+(?:-\d+)?$/.test(name)) {
        const base = name.split('-')[0];
        const known = world ? world.surface?.has(base) ?? world.chunks?.has(base) : Object.hasOwn(definitions.chunks ?? {}, base);
        if (known) ids.add(base); else addMissing(name);
      } else if (world?.areas?.has(name) || Object.hasOwn(definitions.chunks ?? {}, name)) interiors.add(name);
      else addMissing(name);
    });
    if (match) alternatives.set(value, { label: plain(match[1]), count: Number(match[2] ?? 1), locations: [...new Set(locations)] });
  }
  function recordLocations(category, label, record) {
    const key = `${category}:${label}`;
    if (visited.has(key)) return;
    visited.add(key);
    const chunks = list(record.Chunks ?? record.CHunks);
    for (const token of chunks) location(token);
    const wholeCompletion = Object.hasOwn(record, 'QuestPoints') || / Complete the (?:quest|miniquest|subquest)$/i.test(plain(label));
    const recordedRoute = category === 'Quest' && definitions.quests?.[groupName(label, record)];
    if (wholeCompletion && recordedRoute) for (const token of typeof recordedRoute === 'string' ? recordedRoute.split(/,\s*/) : list(recordedRoute)) location(token);
    if (category === 'Quest' && !chunks.length && !(wholeCompletion && recordedRoute)) addMissing(label);
    if (category !== 'Quest' && !chunks.length) addMissing(label);
    for (const [token, targetCategory] of Object.entries(record.Tasks ?? {})) {
      // Skills have no task geography. The engine accepts numeric skill gates here.
      if (typeof targetCategory !== 'string') continue;
      const choice = /^(.*\[\+\])(?:x(\d+))?$/.exec(token);
      if (choice) alternatives.set(`task:${token}`, { label: plain(choice[1]), count: Number(choice[2] ?? 1), tasks: list(aliases.tasksPlus?.[aliasKey(choice[1], aliases.tasksPlus ?? {})]) });
      expand(token, aliases.tasksPlus ?? {}, target => {
        const targetLabel = target.split('--')[0], targetRecord = records[targetCategory]?.[targetLabel];
        if (!targetRecord) { addMissing(targetLabel); return; }
        recordLocations(targetCategory, targetLabel, targetRecord);
      });
    }
  }
  const route = definitions.quests?.[quest];
  for (const token of typeof route === 'string' ? route.split(/,\s*/) : list(route)) location(token);
  for (const [label, record] of Object.entries(records.Quest ?? {})) if (groupName(label, record) === quest) recordLocations('Quest', label, record);
  if (task?.record && groupName(task.rawLabel ?? task.label, task.record) === quest && !visited.has(`Quest:${task.rawLabel ?? task.label}`)) recordLocations('Quest', task.rawLabel ?? task.label, task.record);
  if (!route && !visited.size) addMissing(quest);
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  return { quest, ids: sorted, lockedIds: sorted.filter(id => !owned.has(id)), missing: [...missing], alternatives: [...alternatives.values()], interiors: [...interiors] };
}
