import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';

// Offline copied-save audit. Never opens a store, binds a port, or reads a live save.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY = path.join(ROOT, '.local', 'f2p-audit-duo', 'state.json');
const OUT = path.join(ROOT, '.local', 'f2p-audit');
const hash = sha256;
const args = process.argv.slice(2);
const mode = args.shift() ?? 'capture';
const label = args.shift() ?? 'baseline';
const scenarioMode = args.shift() ?? 'all';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && (!['capture', 'compare', 'publish', 'canonicalize'].includes(mode) || !/^[a-z0-9-]+$/.test(label) || !['all', 'focused', 'f2p'].includes(scenarioMode) || args.length)) throw new Error('Usage: node scripts/audit-f2p-membership.2026-10-08.v1.mjs capture LABEL [all|focused|f2p] | compare AFTER_LABEL | publish AFTER_LABEL | canonicalize LABEL');

export function auditCounts(result) {
  return { catalogue: result.tasks.length, possible: result.tasks.filter(row => row.status === 'available').length,
    possibleOwn: result.tasks.filter(row => row.status === 'available' && row.obligation !== false).length,
    possibleVisibleOwn: result.tasks.filter(row => row.status === 'available' && row.obligation !== false && !row.hidden).length,
    active: result.presentation.tasks.length, items: result.items.length, equipment: result.equipment.length,
    recommendations: result.equipmentPlanning.recommendations.length, loadouts: result.equipmentPlanning.loadouts.length,
    upgradePaths: result.equipmentPlanning.specialist?.upgradePaths?.length ?? 0 };
}

async function sourceHashes(directory, prefix = '', textHash = sha256RepositoryText) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name), full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await sourceHashes(full, relative, textHash));
    else if (/\.(mjs|json)$/.test(entry.name)) result[relative] = textHash(await readFile(full));
  }
  return result;
}

function redact(value, members) {
  const replacements = members.flatMap((member, index) => [member.name, member.runescapeName, member.sourceMapId, member.id]
    .filter(Boolean).map(text => [text, `player-${index + 1}`])).sort((a, b) => b[0].length - a[0].length);
  const privateKeys = new Set(['note', 'notes', 'history', 'runeMetricsSync', 'originalPickerSync', 'observedRunescapeName', 'observedFetchedAt']);
  function clean(input) {
    if (typeof input === 'string') {
      for (const [from, to] of replacements) input = input.replaceAll(from, to);
      return input.replaceAll(ROOT.replaceAll('\\', '/'), '<worktree>').replaceAll(ROOT, '<worktree>')
        .replace(/C:[/\\]Users[/\\]User[/\\]Projects[/\\]chunk-picker-rs3(?=[/\\])/g, '<main-read-only-data>');
    }
    if (Array.isArray(input)) return input.map(clean);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => !privateKeys.has(key)).map(([key, item]) => [clean(key), clean(item)]));
    return input;
  }
  return clean(value);
}

async function evaluate(worker, state, memberId, id) {
  return new Promise((resolve, reject) => {
    function message(response) { if (response.id !== id) return; cleanup(); response.error ? reject(new Error(response.error.message)) : resolve(response.result); }
    function error(error) { cleanup(); reject(error); }
    function cleanup() { worker.off('message', message); worker.off('error', error); }
    worker.on('message', message); worker.on('error', error);
    worker.postMessage({ id, type: 'evaluate', state, memberId });
  });
}

async function capture() {
  if (await realpath(COPY) !== COPY) throw new Error('Audit copy must be a real file at the isolated expected path.');
  const stateBytes = await readFile(COPY), document = JSON.parse(stateBytes), raw = document.state ?? document;
  const dependencies = {};
  for (const [field, reference] of Object.entries(document.storage?.fields ?? {})) {
    if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)) throw new Error('Invalid copied static dependency');
    const bytes = gunzipSync(await readFile(path.join(path.dirname(COPY), 'static', reference.id)));
    if (hash(bytes) !== reference.sha256) throw new Error(`Copied ${field} dependency hash mismatch`);
    raw[field] = JSON.parse(bytes); dependencies[field] = reference.sha256;
  }
  // Validation fills only documented in-memory defaults; the copied JSON is never written.
  const { validateState } = await import('../app/core/state.mjs');
  const state = validateState(raw);
  const definitionsBytes = await readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'));
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: { definitions: JSON.parse(definitionsBytes) } });
  const report = { format: 'f2p-real-save-audit-v1', label, scenarioMode, capturedAt: new Date().toISOString(),
    source: { stateSha256: hash(stateBytes), definitionSha256: sha256RepositoryText(definitionsBytes), revision: state.revision,
      hashConvention: { repositoryText: 'sha256RepositoryText: LF-normalized', externalSaveSidecarsAndResults: 'sha256: exact bytes' },
      copiedStaticDependencies: dependencies,
      defaults: 'validateState, in memory only', environment: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['RS3_RESOURCE_CONTENTS', 'RS3_ARCHAEOLOGY_CONTENTS', 'RS3_CACHE_SHOP_CONTENTS'].includes(key))),
      appHashes: await sourceHashes(path.join(ROOT, 'app')) }, members: {}, scenarios: {} };
  let id = 0;
  try {
    for (const [scenario, f2p] of [['saved', null], ['f2p', true], ['members', false]]) {
      if (scenarioMode !== 'all' && scenario === 'saved' || scenarioMode === 'f2p' && scenario === 'members') continue;
      const clone = structuredClone(state);
      if (f2p !== null) {
        clone.rules['content.f2p'] = f2p;
        for (const member of clone.members) member.taskRules = { ...member.taskRules, F2P: f2p };
      }
      report.scenarios[scenario] = {};
      for (const [index, member] of clone.members.entries()) {
        const player = `player-${index + 1}`;
        report.members[player] = { unlocked: member.unlocked.length, selected: member.selected.length };
        const result = await evaluate(worker, clone, member.id, ++id);
        report.scenarios[scenario][player] = { counts: auditCounts(result), result: redact(result, state.members) };
        console.log(JSON.stringify({ label, scenario, player, counts: report.scenarios[scenario][player].counts }));
      }
    }
  } finally { await worker.terminate(); }
  if (hash(await readFile(COPY)) !== report.source.stateSha256) throw new Error('Audit copied state changed during evaluation.');
  const output = path.join(OUT, `${label}.json`);
  await writeFile(output, `${JSON.stringify(report)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output: path.relative(ROOT, output), sha256: hash(await readFile(output)), stateSha256: report.source.stateSha256 }));
}

const stable = value => JSON.stringify(value);
// Added provenance does not itself mean a source was removed.
const sourceKey = source => stable([source.kind ?? source.type, source.taskId, source.category,
  source.name ?? source.source, source.location, source.locations, source.tables, source.item, source.rate, source.probability, source.own]);
function deltas(before, after, key) {
  const next = new Map(after.map(row => [key(row), row]));
  return before.flatMap(row => {
    const successor = next.get(key(row));
    return !successor || stable(row) !== stable(successor) ? [{ before: row, after: successor ?? null }] : [];
  });
}

export function compareResults(before, after) {
  const nextTasks = new Map(after.tasks.map(row => [row.id, row]));
  const previousTasks = new Map(before.tasks.map(row => [row.id, row]));
  const allAvailableTaskLosses = before.tasks.filter(row => row.status === 'available')
    .filter(row => !nextTasks.has(row.id) || nextTasks.get(row.id).status !== 'available')
    .map(row => ({ before: row, after: nextTasks.get(row.id) ?? null }));
  const removedTasks = before.tasks.filter(row => row.status === 'available' && row.obligation !== false)
    .filter(row => !nextTasks.has(row.id) || nextTasks.get(row.id).status !== 'available' || nextTasks.get(row.id).obligation === false)
    .map(row => ({ before: row, after: nextTasks.get(row.id) ?? null }));
  const sourceOnly = before.tasks.filter(row => row.status === 'available' && nextTasks.get(row.id)?.status === 'available')
    .flatMap(row => {
      const successor = nextTasks.get(row.id), remaining = new Set(successor.sources.map(sourceKey));
      const removedSources = row.sources.filter(source => !remaining.has(sourceKey(source)));
      return removedSources.length ? [{ id: row.id, label: row.label, category: row.category, removedSources,
        survivingSources: successor.sources, before: row, after: successor }] : [];
    });
  const nextItems = new Map(after.items.map(row => [row.name, row]));
  const removedItemSources = before.items.flatMap(item => {
    const successor = nextItems.get(item.name), remaining = new Set((successor?.sources ?? []).map(sourceKey));
    return item.sources.filter(source => !remaining.has(sourceKey(source))).map(source => ({ item: item.name, source,
      itemSurvives: !!successor, survivingSources: successor?.sources ?? [],
      producerTaskSurvives: source.taskId ? nextTasks.get(source.taskId)?.status === 'available' : null }));
  });
  const allAvailableTaskGains = after.tasks.filter(row => row.status === 'available' && previousTasks.get(row.id)?.status !== 'available')
    .map(row => ({ before: previousTasks.get(row.id) ?? null, after: row }));
  const ownAvailableTaskGains = after.tasks.filter(row => row.status === 'available' && row.obligation !== false &&
    (previousTasks.get(row.id)?.status !== 'available' || previousTasks.get(row.id)?.obligation === false)).map(row => ({ before: previousTasks.get(row.id) ?? null, after: row }));
  return { beforeCounts: auditCounts(before), afterCounts: auditCounts(after), removedTasks, sourceOnly, allAvailableTaskGains, ownAvailableTaskGains,
    allAvailableTaskLosses, removedItemSources,
    changedTasks: deltas(before.tasks, after.tasks, row => row.id), changedItems: deltas(before.items, after.items, row => row.name),
    changedEquipment: deltas(before.equipment, after.equipment, row => row.name),
    beforePlanning: before.equipmentPlanning, afterPlanning: after.equipmentPlanning,
    beforeCurrentBiS: before.currentBiS, afterCurrentBiS: after.currentBiS,
    removedPresented: before.presentation.tasks.filter(row => !after.presentation.tasks.some(next => next.id === row.id)),
    addedPresented: after.presentation.tasks.filter(row => !before.presentation.tasks.some(next => next.id === row.id)) };
}

/** Follow declared task dependencies and obtainable-item producer edges. Each
 * visited node retains its own evidence; an unknown does not become a member gate. */
const dependencyIndexes = new WeakMap();
export function dependencyEvidence(root, result, definitions, { itemMembership, pickerEntityMembership = itemMembership, sourceMembershipRecord, sourceMembershipRequiredItems = () => [], taskItemMembershipBlockers }) {
  let index = dependencyIndexes.get(result);
  if (!index) { index = { tasks: new Map(result.tasks.map(row => [row.id, row])),
    taskNames: new Map(result.tasks.map(row => [`${row.category}\u0000${row.rawLabel}`, row])),
    items: new Map(result.items.map(row => [row.name, row])) }; dependencyIndexes.set(result, index); }
  const { tasks, taskNames, items } = index;
  const seen = new Set(), nodes = [], edges = [], pending = [{ type: 'task', id: root.id, depth: 0 }];
  const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
  const clean = value => String(value).replace(/\*/g, '');
  function enqueue(from, type, id, depth, relation) {
    edges.push({ from, to: `${type}:${id}`, relation }); pending.push({ type, id, depth });
  }
  while (pending.length) {
    const next = pending.shift(), key = `${next.type}:${next.id}`;
    if (seen.has(key)) continue; seen.add(key);
    if (next.type === 'item') {
      const membership = pickerEntityMembership(next.id), item = items.get(next.id);
      const sourceRecords = (item?.sources ?? []).flatMap(source => {
        const kind = { object: 'Object', drop: 'Monster', shop: 'Shop', task: 'Task' }[source.kind];
        const name = source.name ?? source.source;
        const records = kind ? [sourceMembershipRecord(kind, name, source.category ?? '')] : [];
        if (source.kind === 'drop') records.push(...[name, ...(source.tables ?? [])].map(table => sourceMembershipRecord('DropItem', next.id, table)));
        if (source.kind === 'shop') records.push(sourceMembershipRecord('ShopItem', next.id, name));
        return records.filter(Boolean);
      });
      nodes.push({ key, type: 'item', name: next.id, depth: next.depth, membership, sources: item?.sources ?? [], sourceRecords });
      for (const source of item?.sources ?? []) if (source.taskId) enqueue(key, 'task', source.taskId, next.depth + 1, 'producer');
      continue;
    }
    const row = tasks.get(next.id) ?? (root.id === next.id ? root : null);
    if (!row) { nodes.push({ key, type: 'task', depth: next.depth, status: 'unresolved-task-reference' }); continue; }
    const record = row.record ?? {};
    const method = sourceMembershipRecord('Task', row.rawLabel, row.category);
    const reviewedRequiredItems = sourceMembershipRequiredItems(row.category, row.rawLabel, record, true);
    const sourceRecords = row.sources.flatMap(source => {
      const kind = { objects: 'Object', npcs: 'NPC', monsters: 'Monster', shops: 'Shop', object: 'Object', drop: 'Monster', shop: 'Shop' }[source.kind];
      const evidence = kind && sourceMembershipRecord(kind, source.name ?? source.source);
      return evidence ? [evidence] : [];
    });
    nodes.push({ key, type: 'task', depth: next.depth, id: row.id, label: row.label, category: row.category,
      declaredNotF2P: !!record['Not F2P'], method, sourceRecords, reviewedRequiredItems, record });
    for (const selector of array(record.Chunks)) if (typeof selector === 'string' && !/^\d+(?:-\d+)?$/.test(selector)) {
      const area = sourceMembershipRecord('Area', clean(selector));
      const areaKey = `area:${clean(selector)}`;
      edges.push({ from: key, to: areaKey, relation: 'defining-area' });
      if (!seen.has(areaKey)) { seen.add(areaKey); nodes.push({ key: areaKey, type: 'area', name: clean(selector), depth: next.depth + 1, sourceRecords: area ? [area] : [] }); }
    }
    for (const token of [...array(record.Items), ...reviewedRequiredItems]) {
      const name = clean(token), parsed = /^(.*\[\+\])(?:x(\d+))?$/.exec(name);
      const aliasName = parsed?.[1] ?? name;
      let alias = definitions.codeItems?.itemsPlus?.[aliasName];
      if (!alias && parsed) {
        const keys = Object.keys(definitions.codeItems?.itemsPlus ?? {}).filter(key => key.toLowerCase() === aliasName.toLowerCase());
        if (keys.length === 1) alias = definitions.codeItems.itemsPlus[keys[0]];
      }
      for (const item of alias ?? [name]) enqueue(key, 'item', item, next.depth + 1, alias ? 'item-alternative' : 'required-item');
    }
    for (const token of [...array(record.Output), ...array(record.Reward)]) {
      const expand = (name, seen = new Set()) => {
        if (typeof name !== 'string' || seen.has(name)) return [];
        const table = definitions.skillItems?.[row.category]?.[name] ?? definitions.codeItems?.dropTables?.[name];
        return table ? Object.keys(table).flatMap(item => expand(item, new Set([...seen, name]))) : [name];
      };
      for (const item of expand(token)) enqueue(key, 'item', item, next.depth + 1, 'declared-product');
    }
    if (row.equipmentName) enqueue(key, 'item', row.equipmentName, next.depth + 1, 'equipment-goal');
    for (const source of row.sources) if (source.item) enqueue(key, 'item', source.item, next.depth + 1, 'available-supply');
    for (const dependency of array(record.Tasks)) if (dependency && typeof dependency === 'object') for (const [name, category] of Object.entries(dependency)) {
      const aliases = definitions.codeItems?.tasksPlus?.[name] ?? [name];
      for (const dependencyName of aliases) {
        const row = taskNames.get(`${category}\u0000${dependencyName}`);
        if (row) enqueue(key, 'task', row.id, next.depth + 1, aliases.length > 1 ? 'declared-task-alternative' : 'declared-task');
        else nodes.push({ key: `unresolved:${category}:${dependencyName}`, type: 'unresolved', depth: next.depth + 1, name: dependencyName, category });
      }
    }
  }
  const memberNodes = nodes.filter(node => node.membership?.members === true || node.declaredNotF2P || node.method?.members === true || node.sourceRecords?.some(record => record.members === true));
  const rootNode = nodes.find(node => node.key === `task:${root.id}`);
  const directActivity = rootNode?.declaredNotF2P || rootNode?.method?.members === true;
  const products = edges.filter(edge => edge.from === `task:${root.id}` && edge.relation === 'declared-product').map(edge => nodes.find(node => node.key === edge.to));
  const memberProductsOnly = taskItemMembershipBlockers
    ? taskItemMembershipBlockers(root.record ?? {}, root.category, definitions, root.rawLabel).some(blocker => blocker.product === true)
    : products.length > 0 && products.every(node => node?.membership?.members === true);
  const memberEquipmentGoal = root.equipmentName && itemMembership(root.equipmentName).members === true;
  const directMemberWield = /^(Wield|Wear|Equip)\b/i.test(root.label) && array(root.record?.Items).some(name => itemMembership(clean(name)).members === true);
  return { classification: directActivity ? 'direct-members-activity' : memberProductsOnly ? 'member-only-product-activity'
    : memberEquipmentGoal || directMemberWield ? 'members-only-equipment-goal' : memberNodes.length ? 'member-supply-or-transitive-dependency' : 'unresolved-membership-causality',
    nodes, edges, memberNodes: memberNodes.map(node => node.key), unknownNodes: nodes.filter(node => node.membership?.status === 'unknown' || node.type === 'unresolved' || node.status === 'unresolved-task-reference').map(node => node.key) };
}

export function survivingViolations(result, definitions, { itemMembership, pickerEntityMembership = itemMembership, sourceMembershipRecord, taskItemMembershipBlockers, sourceMembershipBlocker, sourceMembershipRequiredItems = () => [] }) {
  const violations = [], unknownItems = [], sources = new Map();
  for (const item of result.items) {
    const membership = pickerEntityMembership(item.name);
    if (membership.members === true) violations.push({ kind: 'item', name: item.name, membership });
    if (membership.status === 'unknown') unknownItems.push({ name: item.name, membership });
    for (const source of item.sources) {
      const kind = { object: 'Object', drop: 'Monster', shop: 'Shop', task: 'Task', reward: 'Task' }[source.kind];
      const name = source.name ?? source.source;
      if (kind && name) sources.set(`${kind}\u0000${source.category ?? ''}\u0000${name}`, { kind, name, category: source.category ?? '' });
      if (['shop', 'drop'].includes(source.kind)) {
        const rowKind = source.kind === 'shop' ? 'ShopItem' : 'DropItem';
        for (const category of [name, ...(source.kind === 'drop' ? source.tables ?? [] : [])]) sources.set(`${rowKind}\u0000${category}\u0000${item.name}`, { kind: rowKind, name: item.name, category });
      }
    }
  }
  for (const row of result.tasks.filter(row => row.status === 'available')) {
    const method = sourceMembershipBlocker('Task', row.rawLabel, true, row.category);
    const blockers = taskItemMembershipBlockers(row.record ?? {}, row.category, definitions, row.rawLabel);
    for (const name of sourceMembershipRequiredItems(row.category, row.rawLabel, row.record ?? {}, true)) if (pickerEntityMembership(name).members === true) blockers.push({ item: name, membership: pickerEntityMembership(name), reason: 'reviewed-missing-supply-field' });
    if (method || blockers.length || row.record?.['Not F2P']) violations.push({ kind: 'task', id: row.id, label: row.label, method, blockers });
  }
  for (const row of result.equipment) if (itemMembership(row.name).members === true) violations.push({ kind: 'equipment', name: row.name, membership: itemMembership(row.name) });
  for (const row of result.equipmentPlanning.recommendations) if (itemMembership(row.equipment.name).members === true) violations.push({ kind: 'recommendation', name: row.equipment.name, membership: itemMembership(row.equipment.name) });
  const references = new Map();
  function visit(value, field = '', at = 'equipmentPlanning') {
    if (typeof value === 'string' && ['name', 'item', 'items', 'ammo', 'mainHand', 'offHand', 'alternatives'].includes(field)) {
      const membership = itemMembership(value);
      if (membership.members === true) references.set(`${at}:${value}`, { kind: 'planning-item-reference', path: at, name: value, membership });
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, field, `${at}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (!['diagnostics', 'coverage', 'sources'].includes(key)) visit(item, key, `${at}.${key}`);
    }
  }
  visit(result.equipmentPlanning);
  violations.push(...references.values());
  const unmatchedSources = [];
  for (const source of sources.values()) {
    const record = sourceMembershipRecord(source.kind, source.name, source.category);
    const blocker = sourceMembershipBlocker(source.kind, source.name, true, source.category);
    if (blocker) violations.push({ kind: 'source', ...source, blocker });
    else if (!record || record.members === null) unmatchedSources.push({ ...source, record });
  }
  return { violations, unknownItems, unmatchedSources };
}

function controlDifferences(before, after) {
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['elapsedMs', 'evaluationMs', 'timingMs'].includes(key)).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  return Object.keys(before).filter(key => hash(stable(clean(before[key]))) !== hash(stable(clean(after[key]))));
}

async function compare() {
  const baseline = JSON.parse(await readFile(path.join(OUT, 'baseline.json')));
  baseline.source.hashConvention ??= { repositoryText: 'sha256: raw working-tree bytes (immutable original baseline)', externalSaveSidecarsAndResults: 'sha256: exact bytes' };
  const after = JSON.parse(await readFile(path.join(OUT, `${label}.json`)));
  if (baseline.source.stateSha256 !== after.source.stateSha256) throw new Error('Cannot compare different copied saves.');
  const report = { format: 'f2p-real-save-delta-v1', baselineSource: baseline.source, afterSource: after.source, players: {} };
  const definitions = JSON.parse(await readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json')));
  const [{ itemMembership, pickerEntityMembership = itemMembership }, { sourceMembershipRecord, sourceMembershipBlocker, sourceMembershipRequiredItems }, { taskItemMembershipBlockers }] = await Promise.all([
    import('../app/data/item-membership.mjs'), import('../app/data/source-membership.mjs'),
    import('../app/tasks/membership.mjs'),
  ]);
  for (const player of Object.keys(baseline.members)) {
    report.players[player] = compareResults(baseline.scenarios.f2p[player].result, after.scenarios.f2p[player].result);
    report.players[player].membersControl = after.scenarios.members?.[player] ? compareResults(baseline.scenarios.members[player].result, after.scenarios.members[player].result) : null;
    const delta = report.players[player];
    if (delta.beforeCounts.possible - delta.allAvailableTaskLosses.length + delta.allAvailableTaskGains.length !== delta.afterCounts.possible
      || delta.beforeCounts.possibleOwn - delta.removedTasks.length + delta.ownAvailableTaskGains.length !== delta.afterCounts.possibleOwn) throw new Error('Available task losses/gains do not reconcile with before/after counts.');
    for (const row of delta.removedItemSources) {
      row.itemMembership = pickerEntityMembership(row.item);
      const source = row.source, name = source.name ?? source.source;
      const kind = { object: 'Object', drop: 'Monster', shop: 'Shop', task: 'Task', reward: 'Task' }[source.kind];
      const records = kind ? [sourceMembershipRecord(kind, name, source.category ?? '')] : [];
      if (source.kind === 'drop') records.push(...[name, ...(source.tables ?? [])].map(table => sourceMembershipRecord('DropItem', row.item, table)));
      if (source.kind === 'shop') records.push(sourceMembershipRecord('ShopItem', row.item, name));
      row.sourceMembershipRecords = records.filter(Boolean);
    }
    const lostRows = new Map(delta.allAvailableTaskLosses.map(row => [row.before.id, row]));
    const sourceRows = new Map(delta.sourceOnly.map(row => [row.id, row]));
    const outputLosses = new Map();
    for (const row of delta.removedItemSources) if (row.source.taskId) {
      const rows = outputLosses.get(row.source.taskId) ?? []; rows.push(row); outputLosses.set(row.source.taskId, rows);
    }
    const beforePresented = new Set(baseline.scenarios.f2p[player].result.presentation.tasks.map(row => row.id));
    delta.baselineMembershipEvidence = {};
    delta.baselineOffendingPossible = baseline.scenarios.f2p[player].result.tasks.filter(row => row.status === 'available').flatMap(row => {
      const method = sourceMembershipBlocker('Task', row.rawLabel, true, row.category);
      const blockers = taskItemMembershipBlockers(row.record ?? {}, row.category, definitions, row.rawLabel);
      for (const name of sourceMembershipRequiredItems(row.category, row.rawLabel, row.record ?? {}, true)) if (pickerEntityMembership(name).members === true) blockers.push({ item: name, membership: pickerEntityMembership(name), reason: 'reviewed-missing-supply-field' });
      const removed = lostRows.get(row.id), changedSources = sourceRows.get(row.id), products = outputLosses.get(row.id) ?? [];
      const proof = dependencyEvidence(row, baseline.scenarios.f2p[player].result, definitions, { itemMembership, pickerEntityMembership, sourceMembershipRecord, sourceMembershipRequiredItems, taskItemMembershipBlockers });
      if (!method && !blockers.length && !removed && !changedSources && !products.length && !proof.memberNodes.length) return [];
      const references = proof.nodes.filter(node => proof.memberNodes.includes(node.key)).map(node => {
        const evidence = { type: node.type, name: node.name ?? node.label,
          declaredNotF2P: node.declaredNotF2P ?? false, item: conciseEvidence(node.membership), method: conciseEvidence(node.method),
          sources: [...new Map((node.sourceRecords ?? []).filter(record => record.members === true).map(record => [stable(conciseEvidence(record)), conciseEvidence(record)])).values()] };
        const evidenceId = hash(stable(evidence)).slice(0, 24);
        delta.baselineMembershipEvidence[evidenceId] = evidence;
        return { evidenceId, depth: node.depth };
      });
      return [{ id: row.id, label: row.label, category: row.category, ownObligation: row.obligation !== false,
        presented: beforePresented.has(row.id), method, blockers, removed: !!removed, reducedInputSources: changedSources?.removedSources.length ?? 0,
        reducedOutputSources: products.length, outputItems: [...new Set(products.map(row => row.item))],
        classification: proof.classification, outcome: removed ? 'blocked-or-no-longer-relevant' : changedSources || products.length ? 'survives-with-reduced-sources' : 'survives-valid-alternatives',
        transitiveMemberEvidence: references }];
    });
    for (const removed of [...delta.allAvailableTaskLosses, ...delta.removedTasks]) removed.dependencyEvidence = dependencyEvidence(removed.before, baseline.scenarios.f2p[player].result, definitions, { itemMembership, pickerEntityMembership, sourceMembershipRecord, sourceMembershipRequiredItems, taskItemMembershipBlockers });
    delta.falsePositiveCandidates = delta.removedTasks.filter(row => row.dependencyEvidence.classification === 'unresolved-membership-causality').map(row => ({ id: row.before.id, label: row.before.label, reason: 'No verified member node found in declared dependency graph; inspect source/location gates and after blockers.' }));
    delta.falsePositiveCandidates.push(...(delta.membersControl?.removedTasks ?? []).map(row => ({ id: row.before.id, label: row.before.label, reason: 'Also removed in members-enabled control.' })));
    delta.freeItemProbes = ['Magic logs', 'Yew logs', 'Acadia logs', 'Teak logs'].map(name => ({ name, membership: pickerEntityMembership(name), before: baseline.scenarios.f2p[player].result.items.find(row => row.name === name) ?? null, after: after.scenarios.f2p[player].result.items.find(row => row.name === name) ?? null }));
    delta.entityIdentityProbes = [{ name: 'Slayer points', pickerEntity: pickerEntityMembership('Slayer points'), physicalItem: itemMembership('Slayer points') }];
    delta.freeSourceProbes = ['Blue dragon', 'Blue dragon#Wilderness', 'Green dragon', 'Green dragon#Wilderness', 'Red dragon'].map(name => ({ name,
      membership: sourceMembershipRecord('Monster', name), beforeReachable: baseline.scenarios.f2p[player].result.access.monsters.includes(name),
      afterReachable: after.scenarios.f2p[player].result.access.monsters.includes(name),
      beforeTaskIds: baseline.scenarios.f2p[player].result.tasks.filter(row => row.status === 'available' && (row.record?.Monsters ?? []).includes(name)).map(row => row.id),
      afterTaskIds: after.scenarios.f2p[player].result.tasks.filter(row => row.status === 'available' && (row.record?.Monsters ?? []).includes(name)).map(row => row.id) }));
    delta.freeQuestProbes = baseline.scenarios.f2p[player].result.tasks.filter(row => row.status === 'available' &&
      /^(Violet is Blue|Death Plateau|Sabbot's Tunnel)/.test(row.label)).map(row => ({ id: row.id, label: row.label,
      beforeAvailable: true, afterAvailable: after.scenarios.f2p[player].result.tasks.find(next => next.id === row.id)?.status === 'available',
      beforeOwnObligation: row.obligation !== false }));
    delta.survivingAudit = survivingViolations(after.scenarios.f2p[player].result, definitions, { itemMembership, pickerEntityMembership, sourceMembershipRecord, sourceMembershipBlocker, sourceMembershipRequiredItems, taskItemMembershipBlockers });
    delta.membersControlChangedFields = after.scenarios.members?.[player] ? controlDifferences(baseline.scenarios.members[player].result, after.scenarios.members[player].result) : null;
  }
  const output = path.join(OUT, `${label}-delta.json`);
  // Own loss graphs also occur in the all-capability list. Store each once.
  const serialized = { ...report, players: Object.fromEntries(Object.entries(report.players).map(([player, row]) => [player, {
    ...row, allAvailableTaskLosses: row.allAvailableTaskLosses.map(loss => loss.before.obligation !== false
      ? { taskId: loss.before.id, ownObligation: true, evidenceRef: 'removedTasks' } : loss),
  }])) };
  await writeFile(output, `${JSON.stringify(serialized)}\n`, { flag: 'wx' });
  const grouped = new Map();
  for (const [player, changes] of Object.entries(report.players)) for (const row of changes.removedTasks) {
    const entry = grouped.get(row.before.id) ?? { id: row.before.id, label: row.before.label, category: row.before.category, players: [], reasons: [] };
    entry.players.push(player); entry.reasons.push(...(row.after?.blockers ?? []).map(blocker => blocker.detail)); grouped.set(entry.id, entry);
  }
  // Spread the named review across categories so a long recipe family does not
  // consume the whole fifty-row summary. The exhaustive delta stays separate.
  const categories = new Map();
  for (const row of [...grouped.values()].sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))) {
    const bucket = categories.get(row.category) ?? []; bucket.push(row); categories.set(row.category, bucket);
  }
  const chosen = [];
  while (chosen.length < 50 && [...categories.values()].some(rows => rows.length)) for (const rows of categories.values()) {
    if (rows.length && chosen.length < 50) chosen.push(rows.shift());
  }
  const top50 = chosen.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  await writeFile(path.join(OUT, `${label}-top50.json`), `${JSON.stringify(top50, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output: path.relative(ROOT, output), sha256: hash(await readFile(output)), players: Object.fromEntries(Object.entries(report.players).map(([player, row]) => [player, { before: row.beforeCounts, after: row.afterCounts, removed: row.removedTasks.length, sourceOnly: row.sourceOnly.length }])) }));
}

function conciseEvidence(value) {
  if (!value) return null;
  return { ...(value.name ? { name: value.name } : {}), ...(value.source ? { source: value.source } : {}),
    ...(value.entityKind ? { entityKind: value.entityKind } : {}),
    ...(value.excludedPhysicalItems ? { excludedPhysicalItems: value.excludedPhysicalItems } : {}),
    ...(value.category ? { category: value.category } : {}), ...(value.members !== undefined ? { members: value.members } : {}),
    ...(value.status ? { status: value.status } : {}), ...(value.reason ? { reason: value.reason } : {}),
    ...(value.candidateIds ? { candidateIds: value.candidateIds } : {}), ...(value.wiki ? { wiki: value.wiki } : {}),
    ...(value.evidence ? { evidence: value.evidence } : {}), ...(value.detail ? { detail: value.detail } : {}) };
}

export function publicAuditReport(delta, top50) {
  const sourceSummary = source => Object.fromEntries(Object.entries(source).filter(([key]) => ['kind', 'name', 'source', 'taskId', 'category', 'item', 'location', 'locations', 'tables', 'own'].includes(key)));
  function planningSummary(value) {
    if (Array.isArray(value)) return value.map(planningSummary);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (['data', 'sources', 'diagnostics', 'coverage', 'challenge', 'personalCompleted', 'challengeSatisfied'].includes(key)) continue;
      result[key] = key === 'equipment' ? { name: item.name, slot: item.slot, class: item.class, tier: item.tier } : planningSummary(item);
    }
    return result;
  }
  const bisSummary = view => view ? { obtainable: view.obtainable,
    recordedFacts: { possessionKnown: view.owned?.known ?? false,
      recordedItems: (view.owned?.recordedObtained ?? []).map(item => ({ name: item.name, slot: item.slot, taskId: item.taskId })),
      recordedBest: planningSummary(view.owned?.recordedBest),
      membershipExcludedRecorded: view.coverage?.membershipExcludedRecordedItems ?? [],
      currentlyIneligibleRecorded: view.owned?.recordedBest?.coverage?.excludedRecordedItems ?? [] },
    importedSelections: view.importedSelections, excludedImportedSelections: view.coverage?.excludedImportedSelections ?? [] } : null;
  const planningChanges = (before, after) => ({
    recommendations: before.recommendations.filter((row, index) => stable(row) !== stable(after.recommendations[index])).map(row => ({ style: row.style, slot: row.slot })),
    loadouts: before.loadouts.filter((row, index) => stable(row) !== stable(after.loadouts[index])).map(row => ({ style: row.style, kind: row.kind })),
    upgradePaths: (before.specialist?.upgradePaths ?? []).filter((row, index) => stable(row) !== stable(after.specialist?.upgradePaths?.[index]))
      .map(row => ({ kind: row.kind, name: row.name, style: row.style, slot: row.slot })) });
  const players = {};
  for (const [player, row] of Object.entries(delta.players)) {
    const evidenceSets = {}, evidence = { ...row.baselineMembershipEvidence };
    function evidenceSet(references) {
      const ids = [...new Set(references.map(reference => reference.evidenceId))].sort();
      const key = hash(stable(ids)).slice(0, 24); evidenceSets[key] = ids; return key;
    }
    const summarizeTask = removed => ({ id: removed.before.id, label: removed.before.label, category: removed.before.category,
      ownObligation: removed.before.obligation !== false,
      classification: removed.dependencyEvidence.classification, afterStatus: removed.after?.status ?? 'absent',
      userClassification: ['direct-members-activity', 'member-only-product-activity', 'members-only-equipment-goal'].includes(removed.dependencyEvidence.classification) ? 'a'
        : removed.dependencyEvidence.classification === 'member-supply-or-transitive-dependency' ? 'b' : 'review',
      afterBlockers: removed.after?.blockers ?? [], membershipEvidenceSet: evidenceSet(removed.dependencyEvidence.nodes
        .filter(node => removed.dependencyEvidence.memberNodes.includes(node.key)).map(node => {
          const item = { type: node.type, name: node.name ?? node.label,
            declaredNotF2P: node.declaredNotF2P ?? false, item: conciseEvidence(node.membership), method: conciseEvidence(node.method),
            sources: [...new Map((node.sourceRecords ?? []).filter(record => record.members === true).map(record => [stable(conciseEvidence(record)), conciseEvidence(record)])).values()] };
          const evidenceId = hash(stable(item)).slice(0, 24); evidence[evidenceId] = item; return { evidenceId };
        })),
      unknownDependencies: removed.dependencyEvidence.unknownNodes });
    players[player] = { counts: { before: row.beforeCounts, after: row.afterCounts },
      membersModeChangedFields: row.membersControlChangedFields,
      membersModeCounts: row.membersModeCounts,
      baselineOffendingPossible: row.baselineOffendingPossible.map(({ transitiveMemberEvidence, ...task }) => ({ ...task,
        userClassification: task.removed && ['direct-members-activity', 'member-only-product-activity', 'members-only-equipment-goal'].includes(task.classification) ? 'a' : 'b',
        classificationBasis: task.removed ? 'Status loss with recorded after blockers.' : 'Surviving free capability: member paths are optional supporting evidence or removed sources.',
        membershipEvidenceSet: evidenceSet(transitiveMemberEvidence) })),
      baselineMembershipEvidence: evidence,
      membershipEvidenceSets: evidenceSets,
      removedMembershipObligations: row.removedTasks.map(summarizeTask),
      allAvailableTaskLosses: row.allAvailableTaskLosses.map(summarizeTask),
      newlyAvailablePossible: (row.allAvailableTaskGains ?? []).map(gain => ({ id: gain.after.id, label: gain.after.label, category: gain.after.category,
        ownObligation: gain.after.obligation !== false, previousStatus: gain.before?.status ?? 'absent', previousBlockers: gain.before?.blockers ?? [] })),
      newlyAvailableOwnObligations: (row.ownAvailableTaskGains ?? []).map(gain => ({ id: gain.after.id, label: gain.after.label, category: gain.after.category })),
      lostOwnRelevanceWhileStillPossible: row.removedTasks.filter(loss => loss.after?.status === 'available').map(loss => ({ id: loss.before.id, label: loss.before.label, category: loss.before.category })),
      survivingTasksWithReducedSources: row.sourceOnly.map(source => ({ id: source.id, label: source.label, category: source.category,
        removedSources: source.removedSources.map(sourceSummary), survivingSourceCount: source.survivingSources.length })),
      removedItemSources: row.removedItemSources.map(source => ({ item: source.item, source: sourceSummary(source.source), itemSurvives: source.itemSurvives,
        producerTaskSurvives: source.producerTaskSurvives, itemMembership: conciseEvidence(source.itemMembership),
        sourceMembership: source.sourceMembershipRecords.map(conciseEvidence) })),
      equipmentChanges: row.changedEquipment.map(change => ({ name: change.before.name, survives: !!change.after,
        beforeSources: change.before.sources.map(sourceSummary), afterSources: (change.after?.sources ?? []).map(sourceSummary) })),
      presentedRemoved: row.removedPresented.map(task => ({ id: task.id, label: task.label, category: task.category })),
      presentedAdded: row.addedPresented.map(task => ({ id: task.id, label: task.label, category: task.category })),
      bis: { before: planningSummary(row.beforePlanning), after: planningSummary(row.afterPlanning),
        currentBiSBefore: bisSummary(row.beforeCurrentBiS), currentBiSAfter: bisSummary(row.afterCurrentBiS),
        changedPlanningReferences: planningChanges(planningSummary(row.beforePlanning), planningSummary(row.afterPlanning)) },
      falsePositiveReview: row.falsePositiveCandidates,
      freeItemProbes: row.freeItemProbes.map(probe => ({ name: probe.name, membership: conciseEvidence(probe.membership), beforeAvailable: !!probe.before, afterAvailable: !!probe.after })),
      freeSourceProbes: row.freeSourceProbes,
      freeQuestProbes: row.freeQuestProbes,
      entityIdentityProbes: row.entityIdentityProbes,
      safeguards: row.safeguardCases ?? [],
      reviewedResidualIdentities: row.reviewedResidualIdentities ?? [],
      residual: { knownMembershipViolations: row.survivingAudit.violations, unknownItems: row.survivingAudit.unknownItems,
        unmatchedSources: row.survivingAudit.unmatchedSources },
    };
  }
  const classificationCounts = Object.fromEntries(Object.entries(players).map(([player, row]) => {
    const intrinsic = row.removedMembershipObligations.filter(task => ['direct-members-activity', 'member-only-product-activity', 'members-only-equipment-goal'].includes(task.classification)).length;
    const supply = row.removedMembershipObligations.filter(task => task.classification === 'member-supply-or-transitive-dependency').length;
    const unresolved = row.removedMembershipObligations.length - intrinsic - supply;
    return [player, { intrinsicOrMemberOutputRemovedObligations: intrinsic, supplyOrSourceDependentRemovedObligations: supply,
      unresolvedRemovedObligations: unresolved, survivingTasksWithReducedSources: row.survivingTasksWithReducedSources.length,
      removedItemSources: row.removedItemSources.length, falsePositiveReviewCandidates: row.falsePositiveReview.length,
      allPossibleTaskLosses: row.allAvailableTaskLosses.length,
      allPossibleTaskGains: row.newlyAvailablePossible.length,
      ownObligationTaskGains: row.newlyAvailableOwnObligations.length,
      allPossibleIntrinsicOrMemberOutputLosses: row.allAvailableTaskLosses.filter(task => ['direct-members-activity', 'member-only-product-activity', 'members-only-equipment-goal'].includes(task.classification)).length,
      allPossibleSupplyOrSourceDependentLosses: row.allAvailableTaskLosses.filter(task => task.classification === 'member-supply-or-transitive-dependency').length,
      allPossibleUnresolvedLosses: row.allAvailableTaskLosses.filter(task => task.classification === 'unresolved-membership-causality').length,
      baselineOffendingPossible: row.baselineOffendingPossible.length,
      baselineOffendingPresented: row.baselineOffendingPossible.filter(task => task.presented).length,
      preservedValidAlternativeRows: row.baselineOffendingPossible.filter(task => task.outcome === 'survives-valid-alternatives').length,
      baselinePossibleClassA: row.baselineOffendingPossible.filter(task => task.userClassification === 'a').length,
      baselinePossibleClassB: row.baselineOffendingPossible.filter(task => task.userClassification === 'b').length,
      classCFiniteSafeguardCases: row.safeguards.filter(probe => probe.type !== 'method' || probe.afterStatus === 'available').length,
      classCSafeguardScope: 'Enumerated identity, source, currency and preserved method/quest probes; not subtracted from possible-task losses or class-b optional paths.' }];
  }));
  for (const row of Object.values(players)) {
    row.bis.currentBiSBefore = planningSummary(row.bis.currentBiSBefore);
    row.bis.currentBiSAfter = planningSummary(row.bis.currentBiSAfter);
  }
  return { schemaVersion: 1, verifiedOn: '2026-10-08', policy: 'Offline real copied-save audit. Player names, profile fields, save IDs, storage and authentication are omitted. Possible counts include capability rows; own obligations are counted separately. Source reductions preserve free activities where a valid source survives. Unknown membership remains review evidence, never an inferred prohibition.',
    source: { retainedDefinitionSha256: delta.afterSource.definitionSha256, baselineRetainedDefinitionSha256: delta.baselineSource.definitionSha256,
      beforeHashConvention: delta.baselineSource.hashConvention, afterHashConvention: delta.afterSource.hashConvention,
      beforeRelevantAppHashes: Object.fromEntries(Object.entries(delta.baselineSource.appHashes).filter(([key]) => /^(tasks\/(access|engine|equipment|presentation|membership)\.mjs|data\/(item-membership|picker-entities|source-(membership|row-membership|method-requirements|incidental-output)))/.test(key))),
      afterRelevantAppHashes: Object.fromEntries(Object.entries(delta.afterSource.appHashes).filter(([key]) => /^(tasks\/(access|engine|equipment|presentation|membership)\.mjs|data\/(item-membership|picker-entities|source-(membership|row-membership|method-requirements|incidental-output)))/.test(key))) },
    limitations: ['Saved membership and challenge-completion facts were evaluated in a copied snapshot, not live character membership.',
      'A member node in a transitive graph is supporting evidence; optional aliases and mixed sources require the recorded after blockers to assess causal necessity.',
      'Unmatched source records are an exhaustive review queue, not automatically member-only content.'],
    classificationDefinitions: { a: 'Removed intrinsically members-only activities, member-only product activities and members-only equipment goals.',
      b: 'Removed supply/source/transitive-dependent obligations plus surviving free tasks with a reduced member source set; free items can become unobtainable without becoming member items.',
      c: 'False-positive safeguards: free quests/areas, free dragons, free logs and valid alternatives remain allowed; unresolved removals are review candidates, not asserted member-only activities.' },
    classificationCounts, players, top50GroupedRemovals: top50 };
}

async function publish() {
  const delta = JSON.parse(await readFile(path.join(OUT, `${label}-delta.json`)));
  const baseline = JSON.parse(await readFile(path.join(OUT, 'baseline.json')));
  const captured = JSON.parse(await readFile(path.join(OUT, `${label}.json`)));
  const { itemMembership, pickerEntityMembership } = await import('../app/data/item-membership.mjs');
  const { sourceMembershipRecord } = await import('../app/data/source-membership.mjs');
  const aliases = JSON.parse(await readFile(path.join(ROOT, 'app', 'data', 'item-membership-aliases.2026-10-08.v1.json')));
  for (const [player, row] of Object.entries(delta.players)) {
    const own = new Map(row.removedTasks.map(loss => [loss.before.id, loss]));
    row.allAvailableTaskLosses = row.allAvailableTaskLosses.map(loss => loss.evidenceRef === 'removedTasks' ? own.get(loss.taskId) : loss);
    // Earlier prototype deltas also counted unchanged non-own rows. Their raw
    // records permit correcting that view without touching frozen captures.
    row.allAvailableTaskLosses = row.allAvailableTaskLosses.filter(loss => loss.after?.status !== 'available');
    const afterTasks = new Map(captured.scenarios.f2p[player].result.tasks.map(task => [task.id, task]));
    const previousTasks = new Map(baseline.scenarios.f2p[player].result.tasks.map(task => [task.id, task]));
    row.allAvailableTaskGains = captured.scenarios.f2p[player].result.tasks.filter(task => task.status === 'available' && previousTasks.get(task.id)?.status !== 'available')
      .map(task => ({ before: previousTasks.get(task.id) ?? null, after: task }));
    row.ownAvailableTaskGains = captured.scenarios.f2p[player].result.tasks.filter(task => task.status === 'available' && task.obligation !== false &&
      (previousTasks.get(task.id)?.status !== 'available' || previousTasks.get(task.id)?.obligation === false)).map(task => ({ before: previousTasks.get(task.id) ?? null, after: task }));
    row.freeQuestProbes = baseline.scenarios.f2p[player].result.tasks.filter(task => task.status === 'available' &&
      /^(Violet is Blue|Death Plateau|Sabbot's Tunnel)/.test(task.label)).map(task => ({ id: task.id, label: task.label,
        beforeAvailable: true, afterAvailable: afterTasks.get(task.id)?.status === 'available', beforeOwnObligation: task.obligation !== false }));
    row.membersModeCounts = { before: baseline.scenarios.members[player].counts, after: captured.scenarios.members[player].counts };
    const afterResult = captured.scenarios.f2p[player].result, beforeResult = baseline.scenarios.f2p[player].result;
    row.reviewedResidualIdentities = aliases.reviews.filter(review => review.status === 'unknown').map(review => ({ name: review.name,
      identityStatus: review.status, reason: review.reason, evidence: { page: review.facts?.title ?? null, url: review.facts?.url ?? null,
        revid: review.facts?.revid ?? null, rejectedIds: review.rejected ?? [] },
      beforeAvailable: beforeResult.items.some(item => item.name === review.name), afterAvailable: afterResult.items.some(item => item.name === review.name),
      membershipDecision: 'Unknown physical identity; no inferred member-item ban. Separate source/method rules can still remove a route.' }));
    const historical = { 'Topiary hedge (bagged)': ['2026-07-13', 37103775], 'Racing boots': ['2014-12-08', 36321484],
      'Starting horn': ['2014-12-08', 36908127], 'Super large egg': ['2026-02-16', 37133839] };
    for (const review of row.reviewedResidualIdentities) {
      if (historical[review.name]) {
        const [removedOn, revid] = historical[review.name];
        review.historicalContent = { removedOn, revid, url: `https://runescape.wiki/w/Special:PermanentLink/${revid}`,
          decision: 'Deleted historical content; stale retained stock is a separate cleanup question, not an inferred membership prohibition.' };
      }
      if (review.name === 'Ceremonial sword') review.purchaseAndUseDistinction = {
        activity: { members: true, revid: 37001331, url: 'https://runescape.wiki/w/Special:PermanentLink/37001331' },
        rewardShop: { purchasesFree: true, usesPartlyRestricted: true, revid: 37171868, url: 'https://runescape.wiki/w/Special:PermanentLink/37171868' },
        decision: 'Ambiguous retained reward-stock label remains unknown; member-only activity does not prove a member-only purchase.' };
    }
    row.safeguardCases = [
      ...['Magic logs', 'Magic incense sticks', 'Games necklace', 'Cat'].map(name => ({ type: 'item-identity', name,
        membership: conciseEvidence(pickerEntityMembership(name)), beforeAvailable: beforeResult.items.some(item => item.name === name), afterAvailable: afterResult.items.some(item => item.name === name) })),
      ...[['Area', 'Rune Essence mine'], ['Object', 'Rune essence rock'], ['Monster', 'King Black Dragon'], ['Monster', 'Chaos Elemental'],
        ['Monster', 'Blue dragon'], ['Monster', 'Green dragon'], ['Monster', 'Red dragon']].map(([kind, name]) => ({ type: 'source-identity', kind, name,
        membership: conciseEvidence(sourceMembershipRecord(kind, name)), beforeReachable: beforeResult.access[{ Area: 'areas', Object: 'objects', Monster: 'monsters' }[kind]].includes(name),
        afterReachable: afterResult.access[{ Area: 'areas', Object: 'objects', Monster: 'monsters' }[kind]].includes(name) })),
      ...beforeResult.tasks.filter(task => /acadia|Wendlewick|Jacquelyn|Turael|Vannaka|Mazchna|Chaeldar|Duradel|Kuradal|Morvran|Laniakea/i.test(task.rawLabel)
        && (task.status === 'available' || /Jacquelyn|Vannaka/.test(task.rawLabel))).map(task => ({ type: 'method', id: task.id, label: task.label, category: task.category,
          beforeStatus: task.status, afterStatus: afterTasks.get(task.id)?.status ?? 'absent', afterBlockers: afterTasks.get(task.id)?.blockers ?? [],
          methodMembership: conciseEvidence(sourceMembershipRecord('Task', task.rawLabel, task.category)) })),
      { type: 'virtual-currency', name: 'Slayer points', pickerEntity: conciseEvidence(pickerEntityMembership('Slayer points')), physicalItem: conciseEvidence(itemMembership('Slayer points')) },
      { type: 'purchase-use-distinction', name: "Artisans' Workshop Reward Shop", purchasesFree: true, usesPartlyRestricted: true,
        url: 'https://runescape.wiki/w/Special:PermanentLink/37171868', retainedCeremonialSwordStock: 'Ambiguous identity; no inferred member-only purchase.' },
      ...row.freeQuestProbes.map(probe => ({ type: 'free-quest', ...probe })),
    ];
  }
  const top50 = JSON.parse(await readFile(path.join(OUT, `${label}-top50.json`)));
  const report = publicAuditReport(delta, top50);
  report.source.auditScriptSha256 = sha256RepositoryText(await readFile(fileURLToPath(import.meta.url)));
  report.source.auditScriptHashConvention = 'sha256RepositoryText: LF-normalized';
  report.source.copiedSave = { revision: captured.source.revision, exactByteSha256: captured.source.stateSha256 };
  report.source.captureHashes = { baseline: sha256(await readFile(path.join(OUT, 'baseline.json'))), final: sha256(await readFile(path.join(OUT, `${label}.json`))),
    delta: sha256(await readFile(path.join(OUT, `${label}-delta.json`))) };
  const output = path.join(ROOT, 'docs', 'research', 'f2p-membership-audit.2026-10-08.v1.json');
  await writeFile(output, `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify({ output: path.relative(ROOT, output), bytes: (await readFile(output)).length, sha256: hash(await readFile(output)) }));
}

async function canonicalize() {
  const report = JSON.parse(await readFile(path.join(OUT, `${label}.json`)));
  const raw = await sourceHashes(path.join(ROOT, 'app'), '', sha256);
  if (stable(raw) !== stable(report.source.appHashes)) throw new Error('Captured app source changed; cannot canonicalize stale capture.');
  const definitions = await readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'));
  if (sha256(definitions) !== report.source.definitionSha256) throw new Error('Captured retained definitions changed.');
  report.label = `${label}-lf`;
  report.source.originalCapturedAppHashesConvention = 'sha256: raw working-tree bytes';
  report.source.appHashes = await sourceHashes(path.join(ROOT, 'app'));
  report.source.definitionSha256 = sha256RepositoryText(definitions);
  report.source.hashConvention = { repositoryText: 'sha256RepositoryText: LF-normalized', externalSaveSidecarsAndResults: 'sha256: exact bytes' };
  const output = path.join(OUT, `${report.label}.json`);
  await writeFile(output, `${JSON.stringify(report)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output: path.relative(ROOT, output), sha256: hash(await readFile(output)), sourceVerifiedUnchanged: true }));
}
if (isMain) {
  await mkdir(OUT, { recursive: true });
  if (mode === 'capture') await capture(); else if (mode === 'compare') await compare(); else if (mode === 'publish') await publish(); else await canonicalize();
}
