// Structural checks only: names must have an exact runtime declaration, not a
// proof of player access. Exceptions never grant inventory or waive a gate.
const entries = value => Object.entries(value ?? {});
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const fields = { Chunks: 'chunksPlus', Items: 'itemsPlus', Objects: 'objectsPlus', NPCs: 'npcsPlus',
  Monsters: 'monstersPlus', Monster: 'monstersPlus', Shops: 'shopsPlus', Mix: 'mixPlus' };

export function referenceNamespaces(data, { runtimeObjects = [] } = {}) {
  const ns = Object.fromEntries(Object.keys(fields).map(field => [field, new Set()]));
  const spawns = new Set();
  function node(id, record) {
    ns.Chunks.add(id);
    if (record.Name) ns.Chunks.add(record.Name);
    for (const [kind, field] of entries({ Object: 'Objects', NPC: 'NPCs', Monster: 'Monsters', Shop: 'Shops', Spawn: 'Spawns' }))
      for (const [name, value] of entries(record[kind])) if (value !== false) (field === 'Spawns' ? spawns : ns[field]).add(name);
    for (const [suffix, section] of entries(record.Sections)) node(`${id}-${suffix}`, section);
  }
  for (const [id, record] of entries(data.chunks)) node(id, record);
  for (const [base, sections] of entries(data.sections)) for (const suffix of Object.keys(sections)) ns.Chunks.add(`${base}-${suffix}`);
  for (const field of ['Objects', 'NPCs', 'Monsters', 'Shops', 'Spawns']) for (const name of Object.keys(data.taskUnlocks?.[field] ?? {}))
    if (!name.includes('^')) (field === 'Spawns' ? spawns : ns[field]).add(name);
  ns.Monster = ns.Monsters;
  ns.Mix = new Set([...ns.NPCs, ...ns.Monsters]);
  const expand = (category, name, seen = new Set()) => {
    if (typeof name !== 'string' || seen.has(name)) return [];
    const table = data.skillItems?.[category]?.[name] ?? data.codeItems?.dropTables?.[name];
    return table ? Object.keys(table).flatMap(child => expand(category, child, new Set([...seen, name]))) : [name];
  };
  spawns.forEach(name => ns.Items.add(name));
  for (const table of ['drops', 'shopItems', 'objectItems']) for (const [, stock] of entries(data[table]))
    for (const [name, value] of entries(stock)) if (value !== false) expand('', name).forEach(child => ns.Items.add(child));
  for (const [category, records] of entries(data.challenges)) for (const [, record] of entries(records)) {
    for (const name of list(record.Output)) expand(category, name).forEach(child => ns.Items.add(child));
    for (const name of list(record.Reward)) if (typeof name === 'string') ns.Items.add(name);
    for (const name of list(record['Output Object'])) for (const child of data.codeItems?.objectsPlus?.[name] ?? [name]) ns.Objects.add(child);
  }
  runtimeObjects.forEach(name => ns.Objects.add(name));
  return ns;
}

export function referenceIssues(data, options = {}) {
  const ns = referenceNamespaces(data, options), issues = [];
  const issue = (kind, path, details) => issues.push({ kind, path, ...details });
  const alias = (token, table, strip = true) => {
    const clean = strip ? token.replaceAll('*', '') : token;
    const match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
    const aliases = data.codeItems?.[table] ?? {};
    const key = match && Object.keys(aliases).find(key => key.toLowerCase() === match[1].toLowerCase());
    return { names: match ? aliases[key] : [clean], count: Number(match?.[2] ?? 1), clean };
  };
  const taskReference = (token, category, path, kind) => {
    const { names, count } = alias(token, 'tasksPlus', false);
    const defined = [...new Set(names ?? [])].filter(name => Object.hasOwn(data.challenges?.[category] ?? {}, name.split('--')[0]));
    if (defined.length < count) issue(kind, path, { token, category, required: count, unresolved: [...new Set(names ?? [token])].filter(name => !defined.includes(name)) });
  };
  for (const [category, records] of entries(data.challenges)) for (const [label, record] of entries(records)) {
    // Match the engine's retained spelling normalization and inline task links.
    const normalized = { ...record };
    for (const [from, to] of entries({ CHunks: 'Chunks', Itmems: 'Items', Sklls: 'Skills' }))
      if (normalized[from] !== undefined && normalized[to] === undefined) normalized[to] = normalized[from];
    const tasks = { ...record.Tasks };
    for (const [field, value] of entries(record)) if (!fields[field] && typeof value === 'string' && data.challenges?.[value]?.[field]) tasks[field] = value;
    for (const [field, table] of entries(fields)) for (const token of list(normalized[field])) {
      const { names, count, clean } = alias(token, table);
      if (clean === 'Monster[+]') continue; // Engine's explicit any-monster selector.
      const resolved = [...new Set(names ?? [])].filter(name => ns[field].has(name));
      if (resolved.length < count) issue('task-selector', ['challenges', category, label, field],
        { token, required: count, unresolved: [...new Set(names ?? [clean])].filter(name => !ns[field].has(name)) });
    }
    for (const [token, target] of entries(tasks)) if (typeof target === 'string') taskReference(token, target, ['challenges', category, label, 'Tasks'], 'task-prerequisite');
  }
  const gate = (value, path) => {
    if (Array.isArray(value)) return value.forEach((child, index) => gate(child, [...path, String(index)]));
    if (!value || typeof value !== 'object') return;
    for (const [token, category] of entries(value)) {
      if (token === '__all') gate(category, [...path, token]);
      else taskReference(token, category, path, 'source-prerequisite');
    }
  };
  for (const [kind, sources] of entries(data.taskUnlocks)) for (const [source, locations] of entries(sources)) {
    if (kind === 'Items') { gate(locations, ['taskUnlocks', kind, source]); continue; }
    for (const [location, value] of entries(locations)) {
      if (!ns.Chunks.has(location)) issue('source-location', ['taskUnlocks', kind, source], { location });
      gate(value, ['taskUnlocks', kind, source, location]);
    }
  }
  const connections = (id, record) => {
    for (const [to, value] of entries(record.Connect)) gate(value, ['chunks', id, 'Connect', to]);
    for (const [suffix, section] of entries(record.Sections)) connections(`${id}-${suffix}`, section);
  };
  for (const [id, record] of entries(data.chunks)) connections(id, record);
  for (const [base, sections] of entries(data.questSections)) for (const [section, value] of entries(sections)) gate(value, ['questSections', base, section]);
  for (const [master, assignments] of entries(data.slayerMasterTasks)) for (const [assignment, record] of entries(assignments)) {
    const name = assignment.split(' - ')[0];
    const mapping = data.codeItems?.slayerTasks?.[name] ?? data.codeItems?.reaperTasks?.[name];
    if (!Object.keys(mapping ?? {}).some(monster => ns.Monsters.has(monster))) issue('assignment', ['slayerMasterTasks', master, assignment], { unresolved: Object.keys(mapping ?? {}) });
    for (const [token, category] of entries(record.Tasks)) taskReference(token, category, ['slayerMasterTasks', master, assignment, 'Tasks'], 'assignment-prerequisite');
  }
  for (const table of ['slayerTasks', 'reaperTasks']) for (const [assignment, mapping] of entries(data.codeItems?.[table]))
    for (const monster of Object.keys(mapping)) if (!ns.Monsters.has(monster)) issue('assignment-variant', ['codeItems', table, assignment], { monster });
  // A drop table can be deliberately dormant. A unique case-only counterpart
  // is actionable and is kept separate from that broader coverage inventory.
  for (const name of Object.keys(data.drops ?? {})) if (!ns.Monsters.has(name)) {
    const matches = [...ns.Monsters].filter(monster => monster.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) issue('drop-case-join', ['drops', name], { target: matches[0] });
  }
  return issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function duplicateAliasChildren(data) {
  return entries(data.codeItems).flatMap(([table, aliases]) => entries(aliases).flatMap(([name, children]) =>
    Array.isArray(children) && new Set(children).size !== children.length ? [{ table, name }] : []));
}
