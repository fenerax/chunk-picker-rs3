// Read-only explanations over a completed calculation. This never proves eligibility.
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const plain = value => String(value ?? '').replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*/g, '');
const raw = value => String(value).split('--')[0];
const fields = { chunks: ['Chunks', 'chunksPlus'], items: ['Items', 'itemsPlus'], monsters: ['Monsters', 'monstersPlus'], monster: ['Monster', 'monstersPlus'], objects: ['Objects', 'objectsPlus'], npcs: ['NPCs', 'npcsPlus'], shops: ['Shops', 'shopsPlus'], mix: ['Mix', 'mixPlus'] };

export function buildWhyChain(result, definitions, selector, { maxDepth = 24, maxNodes = 160 } = {}) {
  maxDepth = Math.max(1, Math.min(24, Math.trunc(maxDepth) || 24));
  maxNodes = Math.max(2, Math.min(200, Math.trunc(maxNodes) || 160));
  const rows = result.tasks ?? [], byId = new Map(rows.map(row => [row.id, row]));
  const code = definitions.codeItems ?? {};
  let serial = 0, truncated = false;
  const pending = new WeakMap();
  const unique = values => [...new Set(values)];
  function locationName(id) {
    const [base, suffix] = String(id).split('-'), chunk = definitions.chunks?.[base];
    const section = chunk?.Sections?.[suffix] ?? definitions.sections?.[base]?.[suffix];
    return section?.Nickname ?? section?.Name ?? chunk?.Nickname ?? chunk?.Name
      ?? (/^\d+(?:-\d+)?$/.test(id) ? suffix ? 'Map section' : 'Map chunk' : id);
  }
  const readable = text => plain(text).replace(/\b\d{4,6}(?:-\d+)?\b/g, id =>
    definitions.chunks?.[id.split('-')[0]] || id.includes('-') ? locationName(id) : id);
  const cut = (reason, omitted = 1) => ({ kind: 'cut', label: '…', detail: reason, omitted });
  function node(key, label, kind, depth, path, children, extra = {}) {
    if (path.has(key)) return cut('This dependency returns to an earlier step.');
    const value = { kind, label: readable(label), ...extra, children: [] };
    if (value.detail) value.detail = readable(value.detail);
    if (!value.technical && value.label !== plain(label)) value.technical = plain(label);
    pending.set(value, { depth, children: () => children(new Set(path).add(key)).filter(Boolean) });
    return value;
  }
  const expand = (token, aliases) => {
    const clean = String(token).replace(/\*/g, ''), match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
    const alias = match && Object.keys(aliases ?? {}).find(key => key.toLowerCase() === match[1].toLowerCase());
    return { names: unique(alias ? list(aliases[alias]) : [clean]), required: Number(match?.[2] ?? 1), alias: !!alias };
  };
  const matching = (token, blocker) => {
    const field = fields[blocker.kind]?.[0], label = plain(token);
    return field ? blocker.detail === `${field}: ${label}.` || blocker.detail?.startsWith(`${field}: ${label} (need `)
      : blocker.detail?.startsWith(`Requires ${label} (`) || blocker.detail?.startsWith(`${label} requires `);
  };
  function group(label, mode, values, render, depth, path, required = 1) {
    return node(`group:${serial++}`, label, 'group', depth, path,
      next => unique(values).map(value => render(value, depth + 1, next)), { mode, required });
  }
  function task(row, depth, path) {
    return node(`task:${row.id}`, row.label, 'task', depth, path, next => (row.blockers ?? []).map((blocker, index) =>
      requirement(row, blocker, index, depth + 1, next)), { taskId: row.id, mode: 'all', status: row.status });
  }
  function resolveTaskReference(name, category) {
    const label = plain(raw(name));
    const candidates = rows.filter(row => row.category === category && (row.rawLabel === raw(name) || !row.rawLabel && row.label === label));
    return { label, candidates, key: candidates.length ? JSON.stringify(candidates.map(row => row.id).sort()) : `unknown:${category}:${raw(name)}` };
  }
  function renderTaskReference(reference, depth, path) {
    const { label, candidates, key } = reference;
    return candidates.length ? group(label, 'any', candidates, task, depth, path)
      : node(key, label, 'unknown', depth, path, () => [], { detail: 'No matching task is identified in this calculation.' });
  }
  function taskReference(name, category, depth, path) {
    return renderTaskReference(resolveTaskReference(name, category), depth, path);
  }
  function location(id, depth, path) {
    const record = definitions.chunks?.[id] ?? {}, label = locationName(id);
    const targets = rows.filter(row => row.record?.UnlocksArea && (row.rawLabel === id || row.rawLabel === record.Name));
    const reachable = ['bases', 'sections', 'areas'].some(field => list(result.access?.[field]).includes(id));
    return node(`location:${id}`, label, 'location', depth, path, next => {
      if (targets.length) return targets.map(row => task(row, depth + 1, next));
      const diagnostics = (result.access?.diagnostics ?? []).filter(value => value.location === id || value.area === id);
      return diagnostics.map((value, index) => node(`diagnostic:${id}:${index}`, value.detail ?? value.reason ?? 'Access needs review.', 'reason', depth + 1, next, () => []));
    }, { mode: 'all', technical: id, detail: reachable ? 'This location is reachable.' : targets.length ? undefined : `No reachable access to ${plain(label)} is recorded.` });
  }
  function resource(name, field, depth, path) {
    const singular = { monsters: 'Monster', monster: 'Monster', objects: 'Object', npcs: 'NPC', shops: 'Shop', mix: 'Monster' }[field];
    const locations = new Set();
    // Named areas and their numeric map records describe the same location.
    const canonical = id => definitions.chunks?.[definitions.chunks?.[id]?.Name] ? definitions.chunks[id].Name : id;
    for (const [id, record] of Object.entries(definitions.chunks ?? {})) {
      if (record[singular]?.[name] !== undefined && record[singular][name] !== false) locations.add(canonical(id));
      for (const [suffix, section] of Object.entries(record.Sections ?? {})) if (section[singular]?.[name] !== undefined && section[singular][name] !== false) locations.add(`${id}-${suffix}`);
    }
    const plural = { Monster: 'Monsters', Object: 'Objects', NPC: 'NPCs', Shop: 'Shops' }[singular];
    for (const id of Object.keys(definitions.taskUnlocks?.[plural]?.[name] ?? {})) locations.add(canonical(id));
    function sourceLocation(id, d, p) {
      const diagnostics = (result.access?.diagnostics ?? []).filter(value => value.source === name && value.location === id);
      if (!diagnostics.length) return location(id, d, p);
      return node(`source:${field}:${name}:${id}`, locationName(id), 'location', d, p, next => [
        location(id, d + 1, next),
        ...diagnostics.map((value, i) => value.task && value.category ? taskReference(value.task, value.category, d + 1, next)
          : node(`source-diagnostic:${name}:${id}:${i}`, value.detail ?? (value.code === 'source-backlogged' ? 'This source is backlogged.' : 'This source needs an access check.'), 'reason', d + 1, next, () => [])),
      ], { mode: 'all' });
    }
    const label = plain(name).replace(/#(.+)$/, ' ($1)');
    return node(`resource:${field}:${name}`, label, 'resource', depth, path, next => locations.size
      ? [group('Find one reachable location', 'any', [...locations], sourceLocation, depth + 1, next)] : [],
    { detail: locations.size ? undefined : 'No location is identified in the game data.' });
  }
  function requirementLabel(row, blocker) {
    let label = blocker.detail ?? 'Requirement needs review.';
    if (fields[blocker.kind]) {
      const [field] = fields[blocker.kind];
      const token = list(row.record?.[field]).find(value => matching(value, blocker));
      if (token) label = `Need ${plain(blocker.kind === 'chunks' ? locationName(token) : token).split('#')[0].replace(/\[\+\](?:x\d+)?/g, '')}`;
    }
    if (['tasks', 'task', 'personal-completion'].includes(blocker.kind)) label = label.replace(/\[\+\](?:x\d+)?/g, '')
      .replace(/ \([^()]+\)(?=(?: with personal completion evidence)?\.$)/, '').replace(/ with personal completion evidence/, '; complete it on your account');
    return readable(label.replace(/^Requires /, 'Need '));
  }
  function requirement(row, blocker, index, depth, path) {
    let label = requirementLabel(row, blocker);
    if (blocker.kind === 'training') {
      const match = /^(.*?) (\d+)/.exec(label), skill = match?.[1];
      if (skill) label = `Need ${skill} ${match[2]}; no training to this level is reachable.`;
      return node(`blocker:${row.id}:${index}`, label, 'requirement', depth, path, next => {
        const methods = [...new Map(rows.filter(value => value.id !== row.id && value.category === skill && (value.primaryMethod || value.primary || value.record?.Primary) && value.status !== 'available').map(value => [value.id, value])).values()]
          .sort((a, b) => (a.level ?? a.record?.Level ?? 1) - (b.level ?? b.record?.Level ?? 1)
            || (a.blockers?.length ?? 0) - (b.blockers?.length ?? 0) || (a.record?.Priority ?? 0) - (b.record?.Priority ?? 0) || a.label.localeCompare(b.label));
        const summaries = methods.slice(0, 5).map(method => {
          const first = method.blockers?.[0];
          const reason = first ? `${requirementLabel(method, first)}${first.kind === 'chunks' ? ' (chunk)' : ''}` : 'Requirements need review';
          return node(`training:${method.id}`, `${method.label} — ${reason}`, 'summary', depth + 1, next, () => [], { technical: first?.detail });
        });
        if (methods.length > 5) summaries.push(node(`training-more:${row.id}:${index}`, `+${methods.length - 5} more training methods`, 'summary', depth + 1, next, () => []));
        return summaries;
      }, { technical: blocker.detail, mode: 'examples' });
    }
    return node(`blocker:${row.id}:${index}`, label.replace(/^Requires /, 'Need '), 'requirement', depth, path, next => {
      if (['tasks', 'task', 'personal-completion'].includes(blocker.kind)) {
        const entries = Object.entries(row.record?.Tasks ?? {}).filter(([token, category]) => matching(token, blocker)
          && (row.assignment || blocker.detail?.startsWith(`Requires ${plain(token)} (${category})`)));
        const refs = entries.flatMap(([token, category]) => {
          const { names, required } = expand(token, code.tasksPlus);
          // Legacy annotations can resolve to the same subject. Count that
          // subject once, without lowering the authored distinct-count threshold.
          const references = [...new Map(names.map(name => {
            const reference = resolveTaskReference(name, category);
            return [reference.key, reference];
          })).values()];
          return [group(required > 1 ? `Need ${required} of these tasks` : 'Task prerequisite', 'any', references,
            renderTaskReference, depth + 1, next, required)];
        });
        for (const id of list(row.record?.CompletedTasks)) if (byId.has(id) && matching(byId.get(id).label, blocker)) refs.push(task(byId.get(id), depth + 1, next));
        return refs;
      }
      if (blocker.kind === 'master' && byId.has(row.masterTaskId)) return [task(byId.get(row.masterTaskId), depth + 1, next)];
      const mapping = fields[blocker.kind];
      if (mapping) {
        const tokens = list(row.record?.[mapping[0]]).filter(token => matching(token, blocker) || row.assignment);
        if (row.assignment && blocker.kind === 'monsters') return [group('Possible target monsters', 'any', tokens,
          (name, d, p) => resource(name, 'monsters', d, p), depth + 1, next)];
        return tokens.map(token => {
          const { names, required } = expand(token, code[mapping[1]]);
          const render = blocker.kind === 'chunks' ? location : blocker.kind === 'items'
            ? (name, d, p) => node(`item:${name}`, `Need ${plain(name)}`, 'item', d, p, () => [])
            : (name, d, p) => resource(name, blocker.kind, d, p);
          return group(required > 1 ? `Need ${required} alternatives` : 'Required source', 'any', names, render, depth + 1, next, required);
        });
      }
      if (blocker.kind === 'access' && row.record?.UnlocksArea) {
        const diagnostics = (result.access?.diagnostics ?? []).filter(value => value.area === row.rawLabel || value.location === row.rawLabel);
        return diagnostics.map((value, i) => node(`access:${row.id}:${i}`, value.detail ?? value.reason ?? 'Access needs review.', 'reason', depth + 1, next, () => []));
      }
      return [];
    }, { technical: blocker.detail, mode: 'all' });
  }
  let root = byId.get(selector.taskId);
  if (selector.master && selector.assignment) {
    const master = result.activityInfo?.slayer?.masters?.find(value => value.name === selector.master);
    const assignment = master?.tasks.find(value => value.name === selector.assignment);
    if (assignment) {
      const key = assignment.name.split(' - ')[0];
      const targets = Object.keys(code.slayerTasks?.[key] ?? code.reaperTasks?.[key] ?? {});
      root = { id: `assignment:${selector.master}:${assignment.name}`, label: assignment.name, assignment: true,
        status: assignment.planningEligible ? 'available' : 'blocked', blockers: assignment.blockers,
        record: { ...assignment.requirements, Monsters: targets }, masterTaskId: master.method?.id };
    }
  }
  if (!root) throw Object.assign(new Error('This task or assignment is no longer in the saved calculation.'), { status: 404 });
  const tree = task(root, 0, new Set());
  // Admit each complete sibling list before expanding any child. A broad branch
  // can no longer consume the budget depth-first and hide a shorter alternative.
  const queue = [tree];
  let count = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const parent = queue[cursor], work = pending.get(parent);
    if (!work) continue;
    let children = work.children();
    if (!children.length) continue;
    if (work.depth + 1 >= maxDepth) {
      truncated = true;
      children = [cut(`and ${children.length} more steps not shown (depth limit).`, children.length)];
    }
    const remaining = maxNodes - count;
    if (children.length > remaining) {
      truncated = true;
      if (!remaining) {
        parent.detail = `${parent.detail ? `${parent.detail} ` : ''}…and ${children.length} more steps not shown (size limit).`;
        continue;
      }
      const omitted = children.length - remaining + 1;
      children = [...children.slice(0, remaining - 1), cut(`and ${omitted} more steps not shown (size limit).`, omitted)];
    }
    parent.children = children;
    count += children.length;
    queue.push(...children);
  }
  function collapseCuts(parent) {
    const children = [];
    for (const child of parent.children ?? []) {
      collapseCuts(child);
      const previous = children.at(-1);
      if (child.kind === 'cut' && previous?.kind === 'cut') {
        previous.omitted += child.omitted;
        previous.detail = `and ${previous.omitted} more steps not shown.`;
        count--;
      } else children.push(child);
    }
    if (parent.children) parent.children = children;
  }
  collapseCuts(tree);
  return { root: tree, nodeCount: count, truncated, maxDepth, maxNodes };
}
