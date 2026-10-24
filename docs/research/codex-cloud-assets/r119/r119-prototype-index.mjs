const values = value => value == null ? [] : Array.isArray(value) ? value : [value];
function* entries(value) {
  if (value && typeof value === 'object') for (const key in value) if (Object.hasOwn(value, key)) yield [key, value[key]];
}
const definitionIndexes = new WeakMap();

/** Numeric section IDs share a surface base. Hyphenated interior names do not. */
export function baseLocationId(location) {
  const id = String(location);
  return /^\d+-\d+$/.test(id) ? id.split('-')[0] : id;
}

export function* declarationIndex(definitions, world) {
  if (definitionIndexes.has(definitions)) return definitionIndexes.get(definitions);
  const sources = new Map(), locations = new Set(), aliases = new Map(), reverseAliases = new Map();
  const add = (kind, name, location) => {
    const key = `${kind}:${name}`, set = sources.get(key) ?? new Set(); set.add(location); sources.set(key, set);
  };
  const visit = function* (location, record) {
    locations.add(location); yield;
    for (const kind of ['Object', 'NPC', 'Monster', 'Shop', 'Spawn']) for (const [name, quantity] of entries(record[kind])) { if (quantity !== false) add(kind, name, location); yield; }
    for (const [section, data] of entries(record.Sections)) yield* visit(`${location}-${section}`, data);
  };
  for (const [id, record] of entries(definitions.chunks)) {
    yield* visit(id, record);
    if (/^\d+$/.test(id) && record.Name && definitions.chunks[record.Name]) {
      aliases.set(id, record.Name); const names = reverseAliases.get(record.Name) ?? []; names.push(id); reverseAliases.set(record.Name, names);
    }
  }
  for (const id of world?.chunks?.keys?.() ?? []) { locations.add(id); yield; }
  for (const id of world?.areas?.keys?.() ?? []) { locations.add(id); yield; }
  for (const [field, kind] of [['Objects', 'Object'], ['NPCs', 'NPC'], ['Monsters', 'Monster'], ['Shops', 'Shop'], ['Spawns', 'Spawn']]) {
    for (const [name, gates] of entries(definitions.taskUnlocks?.[field])) {
      yield;
      for (const [location] of entries(gates)) { if (locations.has(location)) add(kind, name, location); yield; }
    }
  }
  const value = { sources, locations, aliases, reverseAliases }; definitionIndexes.set(definitions, value); return value;
}

/** Location associations retain task status. They never simulate unlocking or
 * turn a clue location marker into proof of a doable step. */
export function* chunkPlanningIndexSteps(definitions, result, world) {
  const declarations = yield* declarationIndex(definitions, world);
  const byLocation = new Map(), clueLocations = new Map();
  const canonical = location => declarations.aliases.get(String(location)) ?? String(location);
  function* keys(location) {
    const id = canonical(location), seen = new Set();
    for (const key of [id, baseLocationId(id)]) { if (!seen.has(key)) { seen.add(key); yield key; } }
    for (const key of declarations.reverseAliases.get(id) ?? []) { if (!seen.has(key)) { seen.add(key); yield key; } }
  }
  function* add(task, location, reason) {
    const id = canonical(location);
    if (!declarations.locations.has(id)) { yield; return; }
    for (const key of keys(id)) {
      const rows = byLocation.get(key) ?? new Map();
      const row = rows.get(task.id) ?? { task, evidence: [] };
      let duplicate = false;
      for (const evidence of row.evidence) {
        duplicate = evidence.location === id && evidence.reason === reason;
        yield;
        if (duplicate) break;
      }
      if (!duplicate) row.evidence.push({ location: id, reason });
      rows.set(task.id, row); byLocation.set(key, rows); yield;
    }
  }
  const expand = (kind, token) => {
    const clean = String(token).replace(/\*/g, '');
    return values(definitions.codeItems?.[`${kind}Plus`]?.[clean] ?? clean);
  };
  for (const task of result.tasks ?? []) {
    const record = task.record ?? {};
    for (const token of values(record.Chunks)) { yield; for (const location of expand('chunks', token)) yield* add(task, location, 'Declared location requirement'); }
    for (const [field, kind, aliasKind] of [['Objects', 'Object', 'objects'], ['NPCs', 'NPC', 'npcs'], ['Monsters', 'Monster', 'monsters'], ['Monster', 'Monster', 'monsters'], ['Shops', 'Shop', 'shops'], ['Spawns', 'Spawn', 'items'], ['Items', 'Spawn', 'items']]) {
      for (const token of values(record[field])) { yield; for (const name of expand(aliasKind, token)) { yield; for (const location of declarations.sources.get(`${kind}:${name}`) ?? []) {
        let excluded = false;
        if (Array.isArray(record.SourceLocations)) {
          const selectors = [];
          for (const selector of record.SourceLocations) {
            if (selector?.field === field && selector.name === name) selectors.push(selector);
            yield;
          }
          for (const selector of selectors) {
            let includes = !Array.isArray(selector.locations);
            if (!includes) for (const candidate of selector.locations) { includes = candidate === location; yield; if (includes) break; }
            if (!Array.isArray(selector.locations) || !includes) excluded = true;
            yield;
            if (excluded) break;
          }
        }
        if (excluded) continue;
        const plural = { Object: 'Objects', NPC: 'NPCs', Monster: 'Monsters', Shop: 'Shops', Spawn: 'Spawns' }[kind];
        const gates = definitions.taskUnlocks?.[plural]?.[name], gate = gates?.[location] ?? gates?.[baseLocationId(location)];
        const suffix = gate === false ? ' · Source is disabled by its declaration' : gate != null && gate !== true ? ' · An additional source-task gate is declared' : '';
        yield* add(task, location, `${field === 'Items' ? 'Declared spawn for required item' : `Declared ${kind.toLowerCase()} requirement`}: ${name}${suffix}`);
      } } }
    }
    for (const source of task.sources ?? []) {
      for (const location of (function* () { yield source.location; yield* values(source.locations); })()) { yield; if (location) yield* add(task, location, `Current engine source: ${source.name ?? source.source ?? source.kind ?? 'source'}`); }
      if (source.kind === 'chunks' && source.name) yield* add(task, source.name, 'Current engine location evidence');
    }
    yield;
  }
  for (const [tier, markers] of entries(definitions.clues)) { yield; for (const [location, marker] of entries(markers)) {
    const id = canonical(location);
    if (!declarations.locations.has(id)) { yield; continue; }
    for (const key of keys(id)) {
      const rows = clueLocations.get(key) ?? []; rows.push({ tier, location: id, marker }); clueLocations.set(key, rows); yield;
    }
    yield;
  }
  }
  return { byLocation, clueLocations, canonical };
}

export function buildChunkPlanningIndex(definitions, result, world) {
  const steps = chunkPlanningIndexSteps(definitions, result, world);
  let next; do { next = steps.next(); } while (!next.done); return next.value;
}

/** Explicit planning views build the same index in small slices so input and
 * map painting can continue while the full location evidence is processed. */
export async function buildChunkPlanningIndexIncremental(definitions, result, world, isCurrent = () => true) {
  const steps = chunkPlanningIndexSteps(definitions, result, world);
  let started = performance.now(), units = 0;
  const check = () => { if (!isCurrent()) throw new Error('The viewed chunk changed while loading location evidence.'); };
  for (;;) {
    check();
    const next = steps.next();
    check();
    if (next.done) return next.value;
    if (++units < 128 && performance.now() - started < 8) continue;
    await new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(resolve) : setTimeout(resolve, 0));
    check();
    started = performance.now(); units = 0;
  }
}

