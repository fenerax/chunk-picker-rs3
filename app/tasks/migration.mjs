import { decodeLegacyText, hasGameplayMigration } from './gameplay-compat.mjs';
import { projectMemberTaskFacts as projectFacts } from './fact-projection.mjs';
import { buildIdentityIndex, legacyTaskId, permanentTaskId, isPermanentId, resolveIdentity, resolveTaskAlias, lookupPermanentId, isVerifiedProgressAlias } from './identity.mjs';
export { decodeLegacyText, hasGameplayMigration };

/** Startup readiness is separate from ownership conversion: an alias upgrade
 * must run once without enabling legacy field fallback or replaying deletions. */
export function hasCurrentProgressAliasMigration(state) {
  const previous = state.legacy?.gameplayMigration;
  return !previous || previous.progressAliasesVersion >= 1;
}

export function hasCurrentJournalMigration(state) {
  const saved = state.legacy?.gameplayMigration?.journalMigratedMembers;
  const migrated = Array.isArray(saved) ? saved.filter(record) : [];
  return state.members.every(member => member.sourceMapId == null || typeof state.legacy?.maps?.[member.sourceMapId]?.chunkNotes !== 'string'
    || migrated.some(entry => entry.memberId === member.id && entry.sourceMapId === member.sourceMapId));
}

const FIREBASE_NUMBER_PREFIX = '*fb*_';
const TASK_ID_PREFIX = 'rs3:';
const SOURCE_KINDS = new Set(['objects', 'npcs', 'monsters', 'shops', 'spawns', 'items']);
const STATUS_SOURCES = Object.freeze({
  checkedAllTasks: 'challengeCompleted',
  checkedChallenges: 'challengeCompleted',
  completedChallenges: 'challengeCompleted',
  backlog: 'backlogged',
  favoriteTasks: 'favorite',
});

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalized(value) {
  return String(value).normalize('NFC');
}

function decodeKey(value) {
  const decoded = decodeLegacyText(value);
  return typeof decoded === 'string' && decoded.startsWith(FIREBASE_NUMBER_PREFIX)
    ? decoded.slice(FIREBASE_NUMBER_PREFIX.length) : decoded;
}

function decodedObject(value) {
  if (Array.isArray(value)) return value.map(decodedObject);
  if (!record(value)) return typeof value === 'string' ? decodeLegacyText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [decodeKey(key), decodedObject(child)]));
}

/** Resolve the explicitly authored permanent identity; custom labels stay readable. */
export function stableTaskId(category, rawTaskLabel) {
  return permanentTaskId(category, rawTaskLabel);
}

export { legacyTaskId };

/** Remove the upstream wiki/HTML markers while retaining readable task text. */
export function stripTaskMarkup(rawTaskLabel) {
  const label = normalized(decodeLegacyText(String(rawTaskLabel)));
  // Worker display labels are already plain. In particular, replacing every
  // ordinary space needlessly copies all potential labels during startup.
  if (!/[<~|]|\*+$|\s\s|[^\S ]/.test(label)) return label.trim();
  return label
    .replace(/<[^>]*>/g, '')
    .replace(/~\|([\s\S]*?)\|~/g, (_, text) => text.split('#')[0])
    .replace(/[~|]/g, '')
    .replace(/\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function taskRecord(category, rawTaskLabel) {
  const raw = normalized(rawTaskLabel);
  return { id: stableTaskId(category, raw), label: stripTaskMarkup(raw), category: normalized(category), rawLabel: raw };
}

function catalogueArray(catalogue) {
  if (catalogue === undefined) return [];
  if (!Array.isArray(catalogue)) throw new TypeError('catalogue must be an array');
  return catalogue;
}

// Index only canonical URI spellings. Decoding a noncanonical escape or an
// unnormalized Unicode spelling must not create a match that legacyTaskId
// would never have produced. Categories named task/entity/goal remain valid.
function canonicalLegacyReferences(ids) {
  const categories = new Map();
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const match = /^rs3:([^:]+):([\s\S]*)$/.exec(id);
    if (!match) continue;
    let category, rawLabel;
    try { category = normalized(decodeURIComponent(match[1])); rawLabel = normalized(decodeURIComponent(match[2])); }
    catch { continue; }
    if (legacyTaskId(category, rawLabel) !== id) continue;
    let labels = categories.get(category);
    if (!labels) { labels = new Map(); categories.set(category, labels); }
    labels.set(rawLabel, id);
  }
  return categories;
}

function referencedLegacyId(categories, task) {
  if (typeof task.category !== 'string' || typeof task.rawLabel !== 'string') return undefined;
  const labels = categories.get(task.category) ?? categories.get(normalized(task.category));
  return labels ? labels.get(task.rawLabel) ?? labels.get(normalized(task.rawLabel)) : undefined;
}

// Potential generated tasks are a lookup surface, not the saved catalogue.
// rawLabel and aliases retain the source spelling without encoding it in identity.
function dynamicCatalogueIndex(catalogue) {
  const tasks = new Map(), categories = new Map(), projections = new WeakMap();
  const project = task => {
    let value = projections.get(task);
    if (!value) {
      value = { id: task.id, label: stripTaskMarkup(task.label), category: task.category,
        ...(task.rawLabel ? { rawLabel: task.rawLabel } : {}), ...(task.aliases ? { aliases: task.aliases } : {}) };
      projections.set(task, value);
    }
    return value;
  };
  for (const task of catalogueArray(catalogue)) {
    if (!record(task) || typeof task.id !== 'string' || !task.id.trim()
      || typeof task.label !== 'string' || !task.label.trim()
      || typeof task.category !== 'string' || !task.category.trim()) {
      throw new TypeError('dynamicCatalogue tasks need nonempty id, label and category strings');
    }
    if (task.rawLabel !== undefined && (typeof task.rawLabel !== 'string' || !task.rawLabel.trim())) throw new TypeError('dynamicCatalogue rawLabel must be a nonempty string');
    if (task.aliases !== undefined && (!Array.isArray(task.aliases) || task.aliases.some(alias => typeof alias !== 'string' || !alias.trim()))) throw new TypeError('dynamicCatalogue aliases must be nonempty strings');
    let category = categories.get(task.category);
    if (category === undefined) { category = normalized(task.category); categories.set(task.category, category); }
    let rawLabel = task.rawLabel;
    if (rawLabel === undefined) {
      const prefix = `${TASK_ID_PREFIX}${encodeURIComponent(category)}:`;
      try { rawLabel = task.id.startsWith(prefix) ? decodeURIComponent(task.id.slice(prefix.length)) : ''; } catch { rawLabel = ''; }
    }
    if (!isPermanentId(task.id) && (!rawLabel.trim() || stableTaskId(category, rawLabel) !== task.id)) throw new TypeError('dynamicCatalogue tasks need canonical stable category/raw-label IDs or permanent IDs');
    // A nonempty plain label cannot become empty through display decoding.
    // Still reject invalid markup/encoded labels anywhere in the catalogue.
    if (/%|<|-_-|_-(?=[0-9a-f]{2})|[~|]|\*+\s*$/i.test(task.label) && !stripTaskMarkup(task.label)) throw new TypeError('dynamicCatalogue tasks need nonempty display labels');
    // Keep unselected rows by reference. Only non-NFC categories or legacy IDs
    // without explicit raw labels need a cheap lookup view here.
    const value = category === task.category && (!rawLabel || rawLabel === task.rawLabel)
      ? task : { ...task, category, ...(rawLabel ? { rawLabel } : {}) };
    const existing = tasks.get(task.id);
    if (existing && JSON.stringify(project(existing)) !== JSON.stringify(project(value))) throw new TypeError(`Ambiguous dynamicCatalogue task ID: ${task.id}`);
    tasks.set(task.id, value);
  }
  return Object.freeze({ has: id => tasks.has(id), get: id => tasks.has(id) ? project(tasks.get(id)) : undefined,
    values: () => tasks.values(), project });
}

function definitionChallenges(definitions) {
  return record(definitions?.challenges) ? definitions.challenges : {};
}

function categoriesFromUserTasks(rawUserTasks) {
  const result = [];
  const userTasks = decodedObject(rawUserTasks);
  if (!record(userTasks)) return result;
  for (const [category, tasks] of Object.entries(userTasks)) {
    if (!record(tasks)) continue;
    for (const rawLabel of Object.keys(tasks)) result.push({ category, rawLabel });
  }
  return result;
}

function reverseTaskMap(taskMap) {
  const reverse = new Map();
  if (!record(taskMap)) return reverse;
  for (const [label, legacyId] of Object.entries(taskMap)) {
    if (label === 'currentNextIndex' || typeof legacyId !== 'string' || !legacyId.startsWith('t_')) continue;
    const labels = reverse.get(legacyId) ?? [];
    labels.push(normalized(label));
    reverse.set(legacyId, labels);
  }
  return reverse;
}

function sourceContainers(map) {
  const chunkinfo = record(map?.chunkinfo) ? map.chunkinfo : {};
  return Object.keys(STATUS_SOURCES).map(source => ({ source, value: chunkinfo[source] }));
}

function encounteredBis(map, reverse) {
  const result = [];
  for (const { value } of sourceContainers(map)) {
    if (!record(value)) continue;
    const entry = Object.entries(value).find(([category]) => decodeKey(category) === 'BiS');
    if (!record(entry?.[1])) continue;
    for (const key of Object.keys(entry[1])) {
      const decoded = normalized(decodeKey(key));
      if (!decoded.startsWith('t_')) result.push(decoded);
      else if ((reverse.get(decoded) ?? []).length === 1) result.push(reverse.get(decoded)[0]);
    }
  }
  return result;
}

function catalogueIndex(state, options, getReverse) {
  const tasks = new Map(), representedIds = new Set();
  const currentAliasTargets = new Map(), savedIds = new Set((state.tasks ?? []).map(task => task.id));
  const savedLegacyReferences = canonicalLegacyReferences(savedIds);
  const addCurrentAlias = (alias, id) => {
    if (!savedIds.has(alias)) return;
    if (!currentAliasTargets.has(alias)) currentAliasTargets.set(alias, id);
    else if (currentAliasTargets.get(alias) !== id) currentAliasTargets.set(alias, null);
  };
  for (const task of [...catalogueArray(options.catalogue), ...catalogueArray(options.dynamicCatalogue)]) {
    if (!record(task) || typeof task.id !== 'string') continue;
    for (const alias of task.aliases ?? []) addCurrentAlias(alias, task.id);
    const implicitAlias = referencedLegacyId(savedLegacyReferences, task);
    if (implicitAlias !== undefined) addCurrentAlias(implicitAlias, task.id);
  }
  const addExisting = task => {
    if (!record(task) || typeof task.id !== 'string') return;
    tasks.set(task.id, task);
  };
  for (const task of state.tasks ?? []) {
    addExisting(task);
    // An old saved row already represents this authored objective. Appending
    // its current catalogue row manufactures a collision and duplicates the
    // entire catalogue in both archives and conflict reports on every upgrade.
    const id = resolveSavedTaskId(state.identityRegistry, task.id, task.category);
    // A supplied competing alias must keep both candidate rows visible. The
    // complete identity index below still decides ambiguity without guessing.
    if (isPermanentId(id) && (!currentAliasTargets.has(task.id) || currentAliasTargets.get(task.id) === id)) representedIds.add(id);
  }
  for (const task of catalogueArray(options.catalogue)) {
    if (!record(task) || typeof task.id !== 'string' || !task.id
      || typeof task.label !== 'string' || !task.label
      || typeof task.category !== 'string' || !task.category) {
      throw new TypeError('catalogue tasks need nonempty id, label and category strings');
    }
    if (!tasks.has(task.id) && !representedIds.has(task.id)) addExisting({ ...task, id: task.id, label: stripTaskMarkup(task.label), category: normalized(task.category) });
  }

  const add = (category, rawLabel, custom = false) => {
    if (typeof category !== 'string' || typeof rawLabel !== 'string' || !category || !rawLabel) return;
    const id = stableTaskId(category, rawLabel);
    if (tasks.has(id) || representedIds.has(id)) return;
    const task = taskRecord(category, rawLabel);
    if (custom) task.customIdentity = true;
    tasks.set(task.id, task);
  };
  for (const [category, definitions] of Object.entries(definitionChallenges(options.definitions))) {
    if (!record(definitions)) continue;
    for (const rawLabel of Object.keys(definitions)) add(category, rawLabel);
  }
  for (const [mapId, map] of Object.entries(state.legacy?.maps ?? {})) {
    if (state.members?.filter(member => member.sourceMapId === mapId).every(member => hasGameplayMigration(state, member))) continue;
    for (const { category, rawLabel } of categoriesFromUserTasks(map?.userTasks)) add(category, rawLabel, true);
    for (const rawLabel of encounteredBis(map, getReverse())) add('BiS', rawLabel);
  }
  return tasks;
}

function definitionsByCategory(options, catalogue, dynamicCatalogue) {
  const result = new Map();
  for (const [category, definitions] of Object.entries(definitionChallenges(options.definitions))) {
    result.set(normalized(category), new Set(record(definitions) ? Object.keys(definitions).map(normalized) : []));
  }
  for (const index of [catalogue, dynamicCatalogue]) for (const task of index?.values() ?? []) {
    if (!result.has(task.category)) result.set(task.category, new Set());
    if (typeof task.id === 'string' && task.id.startsWith(`${TASK_ID_PREFIX}${encodeURIComponent(task.category)}:`)) {
      const raw = task.id.slice(`${TASK_ID_PREFIX}${encodeURIComponent(task.category)}:`.length);
      try { result.get(task.category).add(decodeURIComponent(raw)); } catch { /* supplied custom ID */ }
    }
    if (typeof task.rawLabel === 'string') result.get(task.category).add(normalized(task.rawLabel));
    for (const alias of task.aliases ?? []) {
      const prefix = `${TASK_ID_PREFIX}${encodeURIComponent(task.category)}:`;
      if (typeof alias === 'string' && alias.startsWith(prefix)) {
        try { result.get(task.category).add(decodeURIComponent(alias.slice(prefix.length))); } catch { /* opaque alias */ }
      }
    }
  }
  return result;
}

function resolveTask(category, legacyKey, reverse, categoryLabels, catalogue, dynamicCatalogue, register = true, getIdentityIndex) {
  const decodedCategory = normalized(decodeLegacyText(category));
  const decodedKey = normalized(decodeKey(legacyKey));
  let candidates;
  let allCandidates;
  if (decodedKey.startsWith('t_')) {
    allCandidates = reverse.get(decodedKey) ?? [];
    candidates = allCandidates;
    const known = categoryLabels.get(decodedCategory);
    if (known) candidates = candidates.filter(label => known.has(label) || dynamicCatalogue.has(stableTaskId(decodedCategory, label))
      || resolveTaskAlias(legacyTaskId(decodedCategory, label), { category: decodedCategory }).status === 'resolved');
  } else {
    candidates = [decodedKey];
    allCandidates = candidates;
  }
  candidates = [...new Set(candidates)];
  // Resolve the original key before assigning any canonical status. Static
  // aliases alone cannot see a competing saved/catalogue decoder target.
  if (candidates.some(label => isVerifiedProgressAlias(decodedCategory, label)) && getIdentityIndex) {
    const alias = decodedKey.startsWith('t_') ? decodedKey : legacyTaskId(decodedCategory, decodedKey);
    const resolution = getIdentityIndex().resolve(alias, { category: decodedCategory });
    if (resolution.status !== 'resolved') return { category: decodedCategory, legacyKey, decodedKey,
      candidates: resolution.candidates, reason: resolution.status === 'ambiguous' ? 'ambiguous legacy task ID' : 'unknown legacy task ID' };
  }
  if (candidates.length !== 1) {
    const visibleCandidates = candidates.length ? candidates : [...new Set(allCandidates)];
    const reason = candidates.length ? 'ambiguous legacy task ID'
      : visibleCandidates.length ? 'legacy task ID has no exact label in its category catalogue'
        : 'unknown legacy task ID';
    return { category: decodedCategory, legacyKey, decodedKey, candidates: visibleCandidates, reason };
  }
  let task = taskRecord(decodedCategory, candidates[0]);
  // A reviewed category seam must materialize its owning catalogue metadata,
  // rather than create a new Extra/Constitution row with the canonical ID.
  if (isVerifiedProgressAlias(decodedCategory, candidates[0])) task = { ...lookupPermanentId(task.id) };
  if (!catalogue.has(task.id)) {
    if (dynamicCatalogue.has(task.id)) { if (register) catalogue.set(task.id, cloneJson(dynamicCatalogue.get(task.id))); }
    else if (decodedCategory === 'BiS' || !decodedKey.startsWith('t_') || resolveTaskAlias(legacyTaskId(decodedCategory, candidates[0]), { category: decodedCategory }).status === 'resolved') { if (register) catalogue.set(task.id, task); }
    else return { category: decodedCategory, legacyKey, decodedKey, candidates,
      reason: 'task is absent from the category catalogue' };
  }
  return { task: catalogue.get(task.id) ?? dynamicCatalogue.get(task.id) ?? task, category: decodedCategory, decodedKey };
}

function noteStatus(member, taskId, patch) {
  member.taskStatus ??= {};
  const existing = record(member.taskStatus[taskId]) ? member.taskStatus[taskId] : {};
  member.taskStatus[taskId] = { ...patch, ...existing };
}

function addUnresolved(unresolved, member, source, resolution) {
  unresolved.push({ memberId: member.id, sourceMapId: member.sourceMapId, source,
    category: resolution.category, legacyKey: resolution.legacyKey,
    decodedKey: resolution.decodedKey, reason: resolution.reason, candidates: resolution.candidates });
}

function migrateStatuses(member, map, reverse, categoryLabels, catalogue, dynamicCatalogue, unresolved, provenance, counts, getIdentityIndex) {
  for (const { source, value } of sourceContainers(map)) {
    if (!record(value)) continue;
    for (const [category, categoryTasks] of Object.entries(value)) {
      if (!record(categoryTasks)) continue;
      for (const [legacyKey, rawValue] of Object.entries(categoryTasks)) {
        const unchecked = STATUS_SOURCES[source] === 'challengeCompleted' && !rawValue;
        const resolution = resolveTask(category, legacyKey, reverse, categoryLabels, catalogue, dynamicCatalogue, !unchecked, getIdentityIndex);
        if (!resolution.task) { addUnresolved(unresolved, member, source, resolution); continue; }
        if (unchecked) continue;
        const field = STATUS_SOURCES[source];
        const patch = { [field]: true };
        if (source === 'backlog' && typeof rawValue === 'string' && rawValue.length) patch.note = decodeLegacyText(rawValue);
        noteStatus(member, resolution.task.id, patch);
        const key = `${member.id}\u0000${resolution.task.id}`;
        const entry = provenance.get(key) ?? { memberId: member.id, taskId: resolution.task.id, sources: [] };
        if (!entry.sources.includes(source)) entry.sources.push(source);
        provenance.set(key, entry);
        counts[field] += 1;
      }
    }
  }
}

// Retry only previously quarantined, now-reviewed progress. Replaying every
// legacy status on upgrades would resurrect checks users deliberately cleared.
function reprojectVerifiedProgress(member, map, reverse, categoryLabels, catalogue, dynamicCatalogue, unresolved, provenance, counts, getIdentityIndex) {
  for (let position = unresolved.length - 1; position >= 0; position--) {
    const item = unresolved[position];
    if (item.memberId !== member.id || item.sourceMapId !== member.sourceMapId || !Object.hasOwn(STATUS_SOURCES, item.source)) continue;
    const category = normalized(decodeKey(item.category)), key = normalized(decodeKey(item.legacyKey));
    const labels = key.startsWith('t_') ? reverse.get(key) ?? [] : [key];
    if (!labels.some(label => isVerifiedProgressAlias(category, label))) continue;
    const categoryTasks = Object.entries(map.chunkinfo?.[item.source] ?? {}).find(([raw]) => normalized(decodeKey(raw)) === category)?.[1];
    if (!record(categoryTasks) || !Object.hasOwn(categoryTasks, item.legacyKey)) continue;
    const resolution = resolveTask(category, item.legacyKey, reverse, categoryLabels, catalogue, dynamicCatalogue, true, getIdentityIndex);
    if (!resolution.task) continue; // Conflicting decoders remain quarantined.
    const pending = [];
    migrateStatuses(member, { chunkinfo: { [item.source]: { [category]: { [item.legacyKey]: categoryTasks[item.legacyKey] } } } },
      reverse, categoryLabels, catalogue, dynamicCatalogue, pending, provenance, counts, getIdentityIndex);
    if (!pending.length) unresolved.splice(position, 1);
  }
}

function migrateNotes(member, map, warnings, counts) {
  const migrateNoteObject = (rawNotes, source) => {
    if (!record(rawNotes)) return;
    member.notes ??= {};
    for (const [rawChunk, rawNote] of Object.entries(rawNotes)) {
      const chunkId = String(decodeKey(rawChunk));
      if (!/^[1-9]\d*$/.test(chunkId) || !Number.isSafeInteger(Number(chunkId))) {
        warnings.push(`${member.name ?? member.id}’s original map has a ${source === 'chunkNotes' ? 'chunk' : source} note for unsupported chunk number ${chunkId}; it stays in the saved original-picker copy.`);
        continue;
      }
      if (typeof rawNote !== 'string') {
        warnings.push(`${member.name ?? member.id}’s original map has a ${source === 'chunkNotes' ? 'chunk' : source} note that is not text for chunk ${chunkId}; it stays in the saved original-picker copy.`);
        continue;
      }
      if (!Object.hasOwn(member.notes, chunkId)) member.notes[chunkId] = decodeLegacyText(rawNote);
      counts.notes += 1;
    }
    if (!Object.keys(member.notes).length) delete member.notes;
  };
  migrateNoteObject(map?.chunks?.stickeredNotes, 'sticker');
  migrateNoteObject(map?.chunkNotes, 'chunkNotes');
  if (typeof map?.chunkNotes !== 'string' && !record(map?.chunkNotes) && map?.chunkNotes !== undefined && map.chunkNotes !== null) {
    warnings.push(`${member.name ?? member.id}’s original map has a map-wide note with no whole chunk number; it stays in the saved original-picker copy.`);
  }
}

function migrateJournal(member, map, warnings, counts) {
  if (typeof map.chunkNotes !== 'string' || Object.hasOwn(member, 'journal')) return;
  const journal = decodeLegacyText(map.chunkNotes);
  if (journal.length > 10_000) {
    warnings.push(`${member.name ?? member.id}’s original map journal exceeds 10000 characters; it stays in the saved original-picker copy.`);
    return;
  }
  // Keep an explicit empty source value, so a later import never revives it.
  member.journal = journal;
  counts.journals += 1;
}

function migrateSections(member, map, warnings, counts) {
  const manualSections = decodedObject(map?.chunkinfo?.manualSections);
  if (!record(manualSections)) return;
  member.sectionOverrides ??= {};
  for (const [base, sections] of Object.entries(manualSections)) {
    if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !record(sections)) {
      warnings.push(`${member.name ?? member.id}’s original map has invalid section access choices for chunk ${base}; they stay in the saved original-picker copy.`);
      continue;
    }
    for (const [section, accessible] of Object.entries(sections)) {
      if (!/^(?:0|[1-9]\d*)$/.test(section) || !Number.isSafeInteger(Number(section)) || typeof accessible !== 'boolean') {
        warnings.push(`${member.name ?? member.id}’s original map has invalid access choice for section ${base}-${section}; it stays in the saved original-picker copy.`);
        continue;
      }
      const id = `${base}-${section}`;
      if (!Object.hasOwn(member.sectionOverrides, id)) member.sectionOverrides[id] = accessible;
      counts.sectionOverrides += 1;
    }
  }
  if (!Object.keys(member.sectionOverrides).length) delete member.sectionOverrides;
}

function migrateRules(member, map, warnings, counts) {
  if (!record(map?.rules)) return;
  member.taskRules ??= {};
  for (const [rawRuleId, value] of Object.entries(map.rules)) {
    const ruleId = String(decodeKey(rawRuleId));
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean'
      && !(typeof value === 'number' && Number.isFinite(value))) {
      warnings.push(`${member.name ?? member.id}’s original map has rule ${ruleId} with a value that is not text, a number or On/Off; it stays in the saved original-picker copy.`);
      continue;
    }
    if (!Object.hasOwn(member.taskRules, ruleId)) member.taskRules[ruleId] = cloneJson(value);
    counts.taskRules += 1;
  }
  if (!Object.keys(member.taskRules).length) delete member.taskRules;
}

function migrateAccessControls(member, map, warnings, counts) {
  const areas = decodedObject(map?.chunkinfo?.manualAreas);
  if (record(areas)) for (const [area, value] of Object.entries(areas)) {
    if (!area.trim() || typeof value !== 'boolean') { warnings.push(`${member.name ?? member.id}’s original map has invalid access choice for area ${area}; it stays in the saved original-picker copy.`); continue; }
    member.areaOverrides ??= {};
    if (!Object.hasOwn(member.areaOverrides, area)) member.areaOverrides[area] = value;
    counts.areaOverrides += 1;
  }
  const backlogs = decodedObject(map?.chunkinfo?.backloggedSources);
  if (record(backlogs)) for (const [rawKind, names] of Object.entries(backlogs)) {
    const kind = rawKind.toLowerCase();
    if (!SOURCE_KINDS.has(kind) || !record(names)) { warnings.push(`${member.name ?? member.id}’s original map has unsupported item-source backlog type ${rawKind}; it stays in the saved original-picker copy.`); continue; }
    for (const [name, value] of Object.entries(names)) {
      if (!name.trim() || typeof value !== 'boolean') { warnings.push(`${member.name ?? member.id}’s original map has invalid backlog choice for ${kind} source ${name}; it stays in the saved original-picker copy.`); continue; }
      member.sourceBacklogs ??= {};
      member.sourceBacklogs[kind] ??= {};
      if (!Object.hasOwn(member.sourceBacklogs[kind], name)) member.sourceBacklogs[kind][name] = value;
      counts.sourceBacklogs += 1;
    }
  }
}

/**
 * Migrate gameplay facts preserved by importLegacyMaps into the authored schema.
 * The original state and all state.legacy.maps payloads remain unchanged.
 */
export function migrateGameplay(state, options = {}) {
  if (!record(state)) throw new TypeError('state must be an object');
  return migrateOwnedGameplay(cloneJson(state), options);
}

/** Trusted storage preparation already owns a detached state. */
export function migrateOwnedGameplay(state, { definitions, taskMap, catalogue, dynamicCatalogue, taskMapHistory } = {}) {
  if (!record(state)) throw new TypeError('state must be an object');
  const next = state;
  next.tasks ??= [];
  next.members ??= [];
  // Without tombstones or task-map rows the merge equals the history's own
  // mappings, which are only read: skip copying every historical label.
  const contributes = value => value !== null && value !== undefined && Object.keys(value).length > 0;
  const historicalMap = !contributes(taskMapHistory?.tombstones) && !contributes(taskMap) && record(taskMapHistory?.mappings)
    ? taskMapHistory.mappings : { ...taskMapHistory?.tombstones, ...taskMapHistory?.mappings, ...taskMap };
  let reverse;
  const getReverse = () => {
    if (reverse) return reverse;
    reverse = reverseTaskMap(historicalMap);
    for (const conflict of taskMapHistory?.conflicts ?? []) for (const id of conflict.ids ?? []) {
      if (typeof id !== 'string' || typeof conflict.label !== 'string') continue;
      reverse.set(id, [...new Set([...(reverse.get(id) ?? []), normalized(conflict.label)])]);
    }
    return reverse;
  };
  const taskIndex = catalogueIndex(next, { definitions, catalogue, dynamicCatalogue }, getReverse);
  const dynamicIndex = dynamicCatalogueIndex(dynamicCatalogue);
  let progressIdentityIndex;
  const getProgressIdentityIndex = () => progressIdentityIndex ??= buildIdentityIndex([
    ...taskIndex.values(), ...catalogueArray(catalogue), ...dynamicIndex.values(),
  ], { savedRegistry: next.identityRegistry, taskMap: historicalMap, history: taskMapHistory });
  let categoryLabels;
  // Authored references can survive a catalogue rebuild independently of any
  // legacy conversion. Hydrating them does not import or revive a checkmark.
  for (const member of next.members) for (const id of new Set([...(member.completedTasks ?? []), ...Object.keys(member.taskStatus ?? {})])) {
    if (!taskIndex.has(id) && dynamicIndex.has(id)) taskIndex.set(id, cloneJson(dynamicIndex.get(id)));
  }
  const previous = next.legacy?.gameplayMigration;
  const warnings = cloneJson(Array.isArray(previous?.warnings) ? previous.warnings : []).map(warning => String(warning)
    .replace(/Could not migrate ([^ ]+) (.+?) for member ([^:]+): (.+?)\./g, (_, source, task, memberId, reason) => `Could not import ${({ checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' })[source] ?? source} ${task} for ${next.members.find(member => member.id === memberId)?.name ?? memberId}: ${({ 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' })[reason] ?? reason}.`)
    .replace(/Unresolved saved task ID ([^ ]+) at (.+); the original record is preserved for review\./g, (_, id, path) => `Saved task ${next.tasks.find(task => task.id === id)?.label ?? id} at ${path} could not be matched; the original record is kept for review.`)
    .replace(/Map ([^ ]+) has /g, (_, id) => `${next.members.find(member => member.sourceMapId === id)?.name ?? id}’s original map has `)
    .replace(/Member ([^ ]+) references missing legacy map ([^.]+)\./g, (_, id, mapId) => `${next.members.find(member => member.id === id)?.name ?? id}’s original map ${mapId} is missing from this save.`)
    .replaceAll('it remains in legacy data.', 'it stays in the saved original-picker copy.')
    .replaceAll('unsupported chunk key', 'unsupported chunk number')
    .replaceAll('map-wide chunkNotes document with no base chunk key', 'map-wide note with no whole chunk number')
    .replaceAll('malformed manual section data', 'invalid section access choices')
    .replaceAll('malformed manual section', 'invalid section access choice')
    .replaceAll('malformed manual area', 'invalid area access choice')
    .replaceAll('non-primitive rule', 'invalid rule value for')
    .replaceAll('Task identity collisions establish a new undo boundary; the complete preceding history is retained in migration archives.', 'Different saved task records match the same task. Undo now starts after this import; all earlier History is kept in the saved import archive.')
    .replaceAll('task identity conflict(s) were preserved in migration provenance; explicit canonical fields take precedence.', 'conflicting saved task records are kept in the import details; values saved directly under the current task take precedence.')
    .replaceAll('task identity conflict(s) remain in migration provenance for review.', 'conflicting saved task records remain in the import details for review.'));
  const unresolved = cloneJson(previous?.unresolved ?? []);
  const provenance = new Map((previous?.taskStatusProvenance ?? []).map(entry => [`${entry.memberId}\u0000${entry.taskId}`, cloneJson(entry)]));
  const migratedMembers = cloneJson(Array.isArray(previous?.migratedMembers) ? previous.migratedMembers : []).filter(record);
  const journalMigratedMembers = cloneJson(Array.isArray(previous?.journalMigratedMembers) ? previous.journalMigratedMembers : []).filter(record);
  const counts = { challengeCompleted: 0, backlogged: 0, favorite: 0, notes: 0, journals: 0,
    sectionOverrides: 0, taskRules: 0, areaOverrides: 0, sourceBacklogs: 0 };
  const maps = next.legacy?.maps ?? {};

  for (const member of next.members) {
    if (member.sourceMapId === null || member.sourceMapId === undefined) continue;
    const map = maps[member.sourceMapId];
    if (!record(map)) {
      warnings.push(`${member.name ?? member.id}’s original map ${member.sourceMapId} is missing from this save.`);
      continue;
    }
    if (!journalMigratedMembers.some(entry => entry.memberId === member.id && entry.sourceMapId === member.sourceMapId)) {
      migrateJournal(member, map, warnings, counts);
      journalMigratedMembers.push({ memberId: member.id, sourceMapId: member.sourceMapId });
      const stale = `${member.name ?? member.id}’s original map has a map-wide note with no whole chunk number; it stays in the saved original-picker copy.`;
      if (typeof map.chunkNotes === 'string') for (let index = warnings.length - 1; index >= 0; index--) if (warnings[index] === stale) warnings.splice(index, 1);
    }
    if (hasGameplayMigration(next, member)) {
      if (unresolved.some(item => item.memberId === member.id && item.sourceMapId === member.sourceMapId)) {
        categoryLabels ??= definitionsByCategory({ definitions }, taskIndex, dynamicIndex);
        reprojectVerifiedProgress(member, map, getReverse(), categoryLabels, taskIndex, dynamicIndex, unresolved, provenance, counts, getProgressIdentityIndex);
      }
      if (migratedMembers.some(entry => entry.memberId === member.id && entry.sourceMapId === member.sourceMapId)) continue;
    }
    if (!hasGameplayMigration(next, member)) {
      categoryLabels ??= definitionsByCategory({ definitions }, taskIndex, dynamicIndex);
      migrateStatuses(member, map, getReverse(), categoryLabels, taskIndex, dynamicIndex, unresolved, provenance, counts, getProgressIdentityIndex);
      migrateNotes(member, map, warnings, counts);
      migrateSections(member, map, warnings, counts);
      migrateRules(member, map, warnings, counts);
    }
    migrateAccessControls(member, map, warnings, counts);
    migratedMembers.push({ memberId: member.id, sourceMapId: member.sourceMapId });
  }

  next.tasks = [...taskIndex.values()];
  const retainedUnresolved = new Set(unresolved.map(item => `${item.memberId}\u0000${item.source}\u0000${item.category}\u0000${item.legacyKey}`));
  for (const item of previous?.unresolved ?? []) {
    if (retainedUnresolved.has(`${item.memberId}\u0000${item.source}\u0000${item.category}\u0000${item.legacyKey}`)) continue;
    const stale = `Could not migrate ${item.source} ${item.category}/${item.legacyKey} for member ${item.memberId}: ${item.reason}.`;
    for (let position = warnings.length - 1; position >= 0; position--) if (warnings[position] === stale || warnings[position] === `Could not import ${({ checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' })[item.source] ?? item.source} ${item.category}/${item.legacyKey} for ${next.members.find(member => member.id === item.memberId)?.name ?? item.memberId}: ${({ 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' })[item.reason] ?? item.reason}.`) warnings.splice(position, 1);
  }
  const migrationRecord = {
    ...previous,
    schemaVersion: 2,
    progressAliasesVersion: 1,
    migratedMembers,
    journalMigratedMembers,
    imported: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, (previous?.imported?.[key] ?? previous?.report?.imported?.[key] ?? 0) + value])),
    unresolved: cloneJson(unresolved),
    taskStatusProvenance: [...provenance.values()].map(entry => ({ ...entry, sources: [...entry.sources].sort() })),
  };
  if (next.legacy || unresolved.length || provenance.size) {
    next.legacy ??= {};
    next.legacy.gameplayMigration = migrationRecord;
  }
  for (const item of unresolved) warnings.push(`Could not import ${({ checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' })[item.source] ?? item.source} ${item.category}/${item.legacyKey} for ${next.members.find(member => member.id === item.memberId)?.name ?? item.memberId}: ${({ 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' })[item.reason] ?? item.reason}.`);
  migrationRecord.warnings = [...new Set(warnings)];

  const catalogueTasks = next.tasks.length;
  const ordinaryCatalogue = catalogueArray(catalogue);
  const identities = migrateOwnedTaskIdentities(next, { catalogue: [...ordinaryCatalogue, ...dynamicIndex.values()], taskMap: historicalMap, history: taskMapHistory,
    projectCatalogueTask: (task, position) => position < ordinaryCatalogue.length ? task : dynamicIndex.project(task) });
  return { state: identities.state, warnings: [...new Set([...migrationRecord.warnings, ...identities.warnings])], report: {
    catalogueTasks,
    imported: cloneJson(migrationRecord.imported),
    unresolved: cloneJson(unresolved),
    taskStatusProvenance: cloneJson(migrationRecord.taskStatusProvenance),
    identities: identities.report,
  } };
}

function savedRecords(members) {
  return members.flatMap(member => [
    ...(member.completedTasks ?? []).map(id => ({ memberId: member.id, kind: 'completion', id, value: true })),
    ...Object.entries(member.taskStatus ?? {}).map(([id, value]) => ({ memberId: member.id, kind: 'status', id, value })),
    ...Object.entries(member.taskAlternatives ?? {}).flatMap(([category, groups]) => Object.entries(groups).filter(([, id]) => id !== null)
      .map(([group, id]) => ({ memberId: member.id, kind: 'alternative', category, group, id, value: id }))),
  ]);
}

/** Cheap alias lookup for already persisted registries. Ambiguity is never guessed. */
export function resolveSavedTaskId(registry, id, category) {
  const result = resolveIdentity(id, registry, category);
  return result.status === 'resolved' ? result.id : id;
}

/** Full authored identity resolution for server and direct calculations. */
export function projectMemberTaskFacts(state, member, catalogue = []) {
  return projectFacts(state, member, catalogue, { resolveIdentity, savedAliases: state.identityRegistry?.aliases ?? {} });
}

/**
 * Project saved identities onto the permanent catalogue without losing evidence.
 * Raw legacy maps remain untouched. A changed projection archives complete original
 * task rows, members and undo history; unresolved records retain their original key.
 */
export function migrateTaskIdentities(state, { catalogue = [], taskMap, history } = {}) {
  return migrateOwnedTaskIdentities(cloneJson(state), { catalogue, taskMap, history });
}

function referencedIdentityCatalogue(state, catalogue, taskMap, history, projectCatalogueTask) {
  const wanted = new Set(), idLike = value => typeof value === 'string' && (value.startsWith('rs3:') || value.startsWith('t_'));
  let automaticAlternative = false;
  const visit = value => {
    if (idLike(value)) wanted.add(value);
    if (Array.isArray(value)) { for (const child of value) visit(child); }
    else if (record(value)) {
      if (typeof value.id === 'string') wanted.add(value.id);
      if (typeof value.taskId === 'string') wanted.add(value.taskId);
      if (value.path?.[0] === 'taskStatus' && typeof value.path[1] === 'string') wanted.add(value.path[1]);
      if (value.path?.[0] === 'taskAlternatives') for (const side of [value.before, value.after]) {
        if (side?.exists && typeof side.value === 'string') wanted.add(side.value);
      }
      for (const [key, child] of Object.entries(value)) {
        if (idLike(key)) wanted.add(key);
        if (key === 'completedTasks' && Array.isArray(child)) for (const id of child) wanted.add(id);
        if (key === 'taskStatus' && record(child)) for (const id of Object.keys(child)) wanted.add(id);
        if (key === 'taskAlternatives' && record(child)) for (const groups of Object.values(child)) for (const id of Object.values(groups)) {
          if (id === null) automaticAlternative = true; else wanted.add(id);
        }
        visit(child);
      }
      if (value.type === 'set-task-alternative' && value.taskId === null
        || value.path?.[0] === 'taskAlternatives' && [value.before, value.after].some(side => side?.exists && side.value === null)) automaticAlternative = true;
    }
  };
  visit({ tasks: state.tasks, members: state.members, history: state.history, identityRegistry: state.identityRegistry });
  // Automatic choices need the complete old-category -> current-category map.
  if (automaticAlternative) return { catalogue: projectCatalogueTask ? catalogue.map(projectCatalogueTask) : catalogue };
  for (const [alias, ids] of Object.entries(state.identityRegistry?.aliases ?? {})) {
    wanted.add(alias); for (const id of Array.isArray(ids) ? ids : [ids]) wanted.add(id);
  }
  for (const map of Object.values(state.legacy?.maps ?? {})) for (const [rawCategory, groups] of Object.entries(map?.chunkinfo?.altChallenges ?? {})) {
    if (!record(groups)) continue;
    for (const choice of Object.values(groups)) if (typeof choice === 'string') {
      const decoded = normalized(decodeLegacyText(choice));
      wanted.add(idLike(decoded) ? decoded : legacyTaskId(normalized(decodeKey(rawCategory)), decoded));
    }
  }
  // References can pass through another old code established by an earlier
  // decoder source. Collect the reachable labels regardless of source order;
  // buildIdentityIndex still applies the decoder mappings in their original order.
  // Scan the decoder sources for reachable old codes only: indexing every label
  // of the complete history allocates far more than the few codes a save names.
  let pending = new Set([...wanted].filter(id => typeof id === 'string' && id.startsWith('t_')));
  while (pending.size) {
    const reached = new Set();
    const addMappingLabel = (label, id) => {
      if (typeof label !== 'string' || typeof id !== 'string' || !pending.has(id)) return;
      label = normalized(label);
      if (!wanted.has(label)) { wanted.add(label); if (label.startsWith('t_')) reached.add(label); }
    };
    for (const mappings of [taskMap, history?.current, history?.historical, history?.mappings, history?.tombstones]) {
      const rows = mappings ?? {};
      for (const label of Object.keys(rows)) addMappingLabel(label, rows[label]);
    }
    for (const conflict of history?.conflicts ?? []) for (const id of conflict.ids ?? []) addMappingLabel(conflict.label, id);
    pending = reached;
  }
  // A historical generated display ID may have obsolete rate/quantity text.
  // Its semantic subjects still need the current row's complete metadata.
  for (const id of [...wanted]) for (const target of resolveIdentity(id, state.identityRegistry).candidates) wanted.add(target);
  const wantedLegacyReferences = canonicalLegacyReferences(wanted);
  // Retain EVERY candidate for a referenced alias, including unsaved competing
  // objectives. Unreferenced potential goals need no metadata/alias index here.
  const selected = [];
  for (const [position, task] of catalogue.entries()) if (wanted.has(task.id) || wanted.has(task.rawLabel) || (task.aliases ?? []).some(alias => wanted.has(alias))
    || referencedLegacyId(wantedLegacyReferences, task) !== undefined
    || !isPermanentId(task.id) && wanted.has(permanentTaskId(task.category, task.rawLabel ?? task.label))) {
    selected.push(projectCatalogueTask ? projectCatalogueTask(task, position) : task);
  }
  return { ids: wanted, catalogue: selected };
}

// migrateGameplay already owns a complete clone. Avoid cloning its whole state
// again while retaining the pure public migration APIs and exact archives.
function migrateOwnedTaskIdentities(next, { catalogue = [], taskMap, history, projectCatalogueTask } = {}) {
  const reservedIds = new Set([...(next.tasks ?? []).map(task => task.id), ...Object.keys(next.identityRegistry?.entries ?? {})]);
  let customNumber = 1;
  const allocateCustomId = () => {
    let id;
    do { id = `rs3:task:custom:${(customNumber++).toString(16).padStart(8, '0')}`; } while (reservedIds.has(id));
    reservedIds.add(id); return id;
  };
  const historicalRows = (next.history ?? []).flatMap(event => [
    ...(event.command?.task ? [event.command.task] : []), ...(event.undo?.tasks ?? []),
    ...(event.undo?.taskChanges ?? []).flatMap(change => [change.before, change.after].filter(side => side?.exists).map(side => side.value)),
  ]);
  const { catalogue: referencedCatalogue, ids: referencedIds } = referencedIdentityCatalogue(next, catalogue, taskMap, history, projectCatalogueTask);
  const allRows = [...historicalRows, ...(next.tasks ?? []), ...referencedCatalogue].map(task => {
    if (!task.customIdentity || isPermanentId(task.id)) return task;
    const saved = resolveSavedTaskId(next.identityRegistry, task.id, task.category);
    const id = isPermanentId(saved) ? saved : allocateCustomId();
    return { ...task, id, kind: 'task', aliases: [...new Set([task.id, ...(task.aliases ?? [])])] };
  });
  const index = buildIdentityIndex(allRows, { savedRegistry: next.identityRegistry, taskMap, history, mappingIds: referencedIds });
  const previous = next.provenance?.taskIdentityMigration ?? {};
  const conversions = [], unresolved = cloneJson((previous.unresolved ?? []).filter(item => item.source === 'legacy-alternative')), conflicts = [], warnings = [];
  const legacyAlternativeMembers = cloneJson(previous.legacyAlternativeMembers ?? []);
  const original = { tasks: cloneJson(next.tasks ?? []), members: cloneJson(next.members ?? []), history: cloneJson(next.history ?? []),
    ...(next.identityRegistry ? { identityRegistry: cloneJson(next.identityRegistry) } : {}) };
  // A definition can supply both its label alias and its explicit permanent row.
  // Only unreferenced, equivalent catalogue duplicates are harmless: never infer
  // equivalence for personal facts or sparse undo guards. Scan references once.
  const referencedRows = new Set();
  const retainReferences = value => {
    if (typeof value === 'string') {
      referencedRows.add(value);
      const result = index.resolve(value);
      for (const id of result.candidates ?? []) referencedRows.add(id);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { retainReferences(key); retainReferences(child); }
    }
  };
  retainReferences({ members: next.members, history: next.history, taskClaims: next.taskClaims,
    finishLine: next.finishLine, groupGoals: next.groupGoals });
  const catalogueUndo = (next.history ?? []).some(event => event.undo?.tasks || event.undo?.taskChanges);
  const rows = new Map();
  const knownRows = new Map(allRows.map(task => [task.id, task]));
  const currentRows = new Map(catalogue.map((task, position) => [task.id, projectCatalogueTask ? position : task]));
  const currentTask = id => {
    const value = currentRows.get(id);
    return projectCatalogueTask && value !== undefined ? projectCatalogueTask(catalogue[value], value) : value;
  };
  const currentAlternativeCategory = (category, id = null) => {
    if (typeof id === 'string' && (id.startsWith('custom:') || id.startsWith('rs3:task:custom:'))) return category;
    const preference = { completedTasks: [], taskAlternatives: { [category]: { identity: id } } };
    const projected = projectMemberTaskFacts(next, preference, allRows).taskAlternatives;
    return Object.keys(projected)[0] ?? category;
  };
  const resolve = (id, path, category, ensureRow = false) => {
    const qualifiedCategory = category ?? knownRows.get(id)?.category;
    const result = index.resolve(id, qualifiedCategory ? { category: qualifiedCategory } : undefined);
    const target = result.status === 'resolved' ? result.id : id;
    if (target !== id) conversions.push({ path, originalId: id, permanentId: target });
    const placeholder = knownRows.get(id)?.label?.startsWith('[Unresolved task ID]');
    if (result.status !== 'resolved' && (!knownRows.has(id) || placeholder || id.startsWith('t_') || id.startsWith('rs3:') && !isPermanentId(id))
      && !(placeholder && path.startsWith('tasks[') && (previous.unresolved ?? []).some(item => item.originalId === id))) {
      unresolved.push({ path, originalId: id, reason: result.status, candidates: result.candidates ?? [] });
    }
    if (ensureRow && !rows.has(target)) {
      const task = knownRows.get(target) ?? knownRows.get(id) ?? index.lookup(target);
      rows.set(target, task ? { id: target, label: task.label, category: currentTask(target)?.category ?? index.lookup(target)?.category ?? task.category ?? category ?? 'Unresolved' }
        : { id: target, label: `[Unresolved task ID] ${id}`, category: category ?? 'Unresolved' });
    }
    return target;
  };
  const rewriteRows = (tasks, path) => {
    // Catalogue upgrades contain both the preceding label IDs and the current
    // permanent rows. Group their originals once: scanning and resolving the
    // entire catalogue for every collision makes that ordinary upgrade quadratic.
    const originalsById = new Map();
    const resolvedRows = tasks.map((task, position) => {
      const id = resolve(task.id, `${path}[${position}].id`, task.category);
      const originals = originalsById.get(id) ?? [];
      originals.push(task.id); originalsById.set(id, originals);
      return { task, id };
    });
    const result = new Map();
    for (const { task, id } of resolvedRows) {
      const custom = id.startsWith('custom:') || id.startsWith('rs3:task:custom:');
      const row = { id, label: task.label, category: !custom && isPermanentId(id) ? currentTask(id)?.category ?? index.lookup(id)?.category ?? task.category : task.category,
        ...Object.fromEntries((custom ? ['completionIds', 'skill', 'level', 'memberIds'] : []).filter(field => task[field] !== undefined).map(field => [field, cloneJson(task[field])])) };
      if (result.has(id)) {
        const harmless = path === 'tasks' && !catalogueUndo
          && JSON.stringify(result.get(id)) === JSON.stringify(row)
          && !referencedRows.has(id) && originalsById.get(id).every(originalId => !referencedRows.has(originalId));
        if (!harmless) conflicts.push({ path, permanentId: id, reason: 'multiple saved catalogue rows', originalIds: originalsById.get(id) });
      }
      // A row already carrying its permanent key is the authored authority.
      if (!result.has(id) || id === task.id) result.set(id, row);
    }
    return [...result.values()];
  };
  for (const task of rewriteRows(next.tasks ?? [], 'tasks')) rows.set(task.id, task);
  const rewriteMember = (member, path, ensureRows = true) => {
    member.completedTasks = [...new Set((member.completedTasks ?? []).map((id, i) => resolve(id, `${path}.completedTasks[${i}]`, undefined, ensureRows)))];
    if (member.taskStatus) {
      const status = Object.create(null);
      const entries = Object.entries(member.taskStatus).sort(([a], [b]) => Number(index.resolve(a).id === a) - Number(index.resolve(b).id === b));
      for (const [id, value] of entries) {
        const target = resolve(id, `${path}.taskStatus[${JSON.stringify(id)}]`, undefined, ensureRows);
        if (status[target] && Object.keys(value).some(field => Object.hasOwn(status[target], field) && JSON.stringify(status[target][field]) !== JSON.stringify(value[field]))) {
          conflicts.push({ path: `${path}.taskStatus`, originalId: id, permanentId: target, reason: 'conflicting alias status fields', preservedValue: cloneJson(value) });
        }
        status[target] = { ...(status[target] ?? {}), ...value };
      }
      member.taskStatus = Object.fromEntries(Object.entries(status));
    }
    if (member.taskAlternatives) {
      for (const [category, groups] of Object.entries(member.taskAlternatives)) for (const [group, id] of Object.entries(groups)) {
        if (id !== null) groups[group] = resolve(id, `${path}.taskAlternatives[${JSON.stringify(category)}][${JSON.stringify(group)}]`, category, ensureRows);
      }
      const projected = projectMemberTaskFacts(next, member, allRows).taskAlternatives;
      for (const [category, groups] of Object.entries(member.taskAlternatives)) for (const [group, id] of Object.entries(groups)) if (id !== null) {
        const currentCategory = currentTask(id)?.category ?? index.lookup(id)?.category ?? category;
        if (currentCategory !== category && Object.hasOwn(member.taskAlternatives[currentCategory] ?? {}, group) && member.taskAlternatives[currentCategory][group] !== id) {
          conflicts.push({ path: `${path}.taskAlternatives`, originalId: id, permanentId: id, category, currentCategory, group, reason: 'conflicting renamed-category alternatives' });
        }
      }
      member.taskAlternatives = projected;
    }
  };
  for (const [i, member] of (next.members ?? []).entries()) rewriteMember(member, `members[${i}]`);
  for (const member of next.members ?? []) {
    if (member.sourceMapId == null || legacyAlternativeMembers.some(entry => entry.memberId === member.id && entry.sourceMapId === member.sourceMapId)) continue;
    const raw = next.legacy?.maps?.[member.sourceMapId]?.chunkinfo?.altChallenges;
    if (!record(raw)) continue;
    for (const [rawCategory, groups] of Object.entries(raw)) {
      const category = normalized(decodeKey(rawCategory));
      if (!record(groups)) continue;
      for (const [rawGroup, choice] of Object.entries(groups)) {
        const group = normalized(decodeKey(rawGroup));
        if (Object.hasOwn(member.taskAlternatives?.[category] ?? {}, group)) continue;
        const path = `legacy.maps[${JSON.stringify(member.sourceMapId)}].chunkinfo.altChallenges[${JSON.stringify(rawCategory)}][${JSON.stringify(rawGroup)}]`;
        if (typeof choice !== 'string' || !choice.trim() || ['__proto__', 'prototype', 'constructor'].includes(category) || ['__proto__', 'prototype', 'constructor'].includes(group)) {
          unresolved.push({ path, source: 'legacy-alternative', originalId: cloneJson(choice), reason: 'invalid saved alternative', candidates: [] }); continue;
        }
        const decoded = normalized(decodeLegacyText(choice));
        const id = decoded.startsWith('rs3:') || decoded.startsWith('t_') ? decoded : legacyTaskId(category, decoded);
        const resolution = index.resolve(id, { category });
        if (resolution.status !== 'resolved') {
          unresolved.push({ path, source: 'legacy-alternative', originalId: choice, reason: resolution.status, candidates: resolution.candidates }); continue;
        }
        member.taskAlternatives ??= {}; member.taskAlternatives[category] ??= {};
        member.taskAlternatives[category][group] = resolve(id, path, category, true);
        if (choice !== resolution.id) conversions.push({ path, originalId: choice, permanentId: resolution.id, source: 'legacy-alternative' });
      }
    }
    legacyAlternativeMembers.push({ memberId: member.id, sourceMapId: member.sourceMapId });
  }
  for (const [i, event] of (next.history ?? []).entries()) {
    const path = `history[${i}]`;
    if (typeof event.command?.taskId === 'string') event.command.taskId = resolve(event.command.taskId, `${path}.command.taskId`, event.command.category);
    if (event.command?.type === 'set-task-alternative') event.command.category = currentAlternativeCategory(event.command.category, event.command.taskId);
    if (event.command?.type === 'add-task' && event.command.task) event.command.task = rewriteRows([event.command.task], `${path}.command.task`)[0];
    if (event.undo?.members) for (const [j, member] of event.undo.members.entries()) rewriteMember(member, `${path}.undo.members[${j}]`, false);
    if (event.undo?.tasks) event.undo.tasks = rewriteRows(event.undo.tasks, `${path}.undo.tasks`);
    for (const change of event.undo?.memberChanges ?? []) for (const patch of change.changes ?? []) {
      if (patch.path?.[0] === 'taskStatus' && patch.path.length === 2) patch.path[1] = resolve(patch.path[1], `${path}.undo.memberChanges.taskStatus`);
      const oldAlternativeCategory = patch.path?.[0] === 'taskAlternatives' && patch.path.length > 1 ? patch.path[1] : null;
      const alternativeCategories = new Set();
      for (const side of [patch.before, patch.after]) if (side?.exists && patch.kind === 'value') {
        if (patch.path?.[0] === 'completedTasks') side.value = [...new Set(side.value.map(id => resolve(id, `${path}.undo.completedTasks`)))];
        if (oldAlternativeCategory !== null) {
          if (side.value !== null) side.value = resolve(side.value, `${path}.undo.taskAlternatives`, oldAlternativeCategory);
          alternativeCategories.add(currentAlternativeCategory(oldAlternativeCategory, side.value));
        }
      }
      if (oldAlternativeCategory !== null) {
        if (!alternativeCategories.size) alternativeCategories.add(currentAlternativeCategory(oldAlternativeCategory));
        if (alternativeCategories.size === 1) patch.path[1] = [...alternativeCategories][0];
        else conflicts.push({ path: `${path}.undo.taskAlternatives`, category: oldAlternativeCategory,
          categories: [...alternativeCategories], reason: 'ambiguous renamed-category undo path' });
      }
    }
    for (const change of event.undo?.taskChanges ?? []) {
      change.id = resolve(change.id, `${path}.undo.taskChanges.id`);
      for (const side of [change.before, change.after]) if (side?.exists) side.value = rewriteRows([side.value], `${path}.undo.taskChanges.value`)[0];
    }
  }
  next.tasks = [...rows.values()];
  if (conflicts.length && next.history?.length) {
    // Merging formerly distinct catalogue rows/status keys can invalidate sparse
    // after-value guards or catalogue positions. Retain the complete old history
    // in the archive and establish an explicit boundary instead of guessing undo.
    next.history = [];
    warnings.push('Different saved task records match the same task. Undo now starts after this import; all earlier History is kept in the saved import archive.');
  }
  // Persist only materialized objectives plus already saved entries. Potential
  // generated catalogues can contain hundreds of thousands of unselected rows.
  const retainedIds = new Set([...rows.keys(), ...Object.keys(next.identityRegistry?.entries ?? {})]);
  // Decoder-only competing targets keep unresolved aliases ambiguous after
  // portable restore, without materializing an unsaved gameplay objective.
  for (const item of unresolved) for (const id of item.candidates ?? []) if (isPermanentId(id)) retainedIds.add(id);
  for (const task of historicalRows) {
    const resolution = index.resolve(task.id, { category: task.category });
    if (resolution.status === 'resolved') retainedIds.add(resolution.id);
    else if (isPermanentId(task.id)) retainedIds.add(task.id);
  }
  const compactRegistry = index.snapshot(retainedIds);
  const entries = Object.fromEntries(Object.entries(compactRegistry.entries).map(([id, value]) => [id, { ...value, kind: value.kind ?? 'task' }]));
  const aliases = compactRegistry.aliases;
  const knownTargets = new Map();
  for (const [alias, targets] of Object.entries(aliases)) {
    const targetIds = Array.isArray(targets) ? targets : [targets];
    const missingTargets = targetIds.filter(target => {
      if (!knownTargets.has(target)) knownTargets.set(target, !!index.lookup(target));
      return !knownTargets.get(target);
    });
    // Multiple known targets are valid category-qualified decoders. Ambiguity
    // is quarantined when an actual saved fact has insufficient context.
    if (missingTargets.length) unresolved.push({ path: `identityRegistry.aliases[${JSON.stringify(alias)}]`, source: 'identity-registry',
      originalId: alias, originalTargets: cloneJson(targets), reason: 'unresolved alias target', candidates: targetIds.filter(target => !missingTargets.includes(target)) });
  }
  next.identityRegistry = { schemaVersion: 1, entries, aliases, unresolved: cloneJson(unresolved) };
  const changed = JSON.stringify(original.tasks.map(({ id, label, category }) => ({ id, label, category }))) !== JSON.stringify(next.tasks)
    || JSON.stringify(original.members) !== JSON.stringify(next.members) || JSON.stringify(original.history) !== JSON.stringify(next.history);
  const originalRecords = savedRecords(original.members), activeRecords = savedRecords(next.members);
  const recordKey = record => JSON.stringify([record.memberId, record.kind, record.id, record.category ?? null, record.group ?? null]);
  const activeRecordIndex = new Map(activeRecords.map(record => [recordKey(record), record]));
  const preservedActive = originalRecords.filter(record => {
    const result = index.resolve(record.id, record.category ? { category: record.category } : undefined);
    const id = result.status === 'resolved' ? result.id : record.id;
    const active = activeRecordIndex.get(recordKey({ ...record, id }));
    return active && (record.kind === 'alternative' || JSON.stringify(active.value) === JSON.stringify(record.value));
  }).length;
  const preservedArchived = changed ? originalRecords.length - preservedActive : 0;
  const conservation = { recordsBefore: originalRecords.length, recordsAfter: activeRecords.length,
    recordsPreservedInActiveState: preservedActive, recordsPreservedInArchives: preservedArchived,
    lostRecords: originalRecords.length - preservedActive - preservedArchived };
  if (changed || unresolved.length || conflicts.length || previous.schemaVersion || legacyAlternativeMembers.length) {
    const archives = cloneJson(previous.archives ?? []);
    if (changed) archives.push({ revision: next.revision, ...original });
    const report = { ...previous, schemaVersion: 1, ...(!previous.schemaVersion || changed ? conservation : {}),
      conversions: [...(previous.conversions ?? []), ...conversions], unresolved, conflicts: [...(previous.conflicts ?? []), ...conflicts], archives, legacyAlternativeMembers };
    next.provenance = { ...next.provenance, taskIdentityMigration: report };
  }
  for (const item of unresolved) warnings.push(`Saved task ${next.tasks.find(task => task.id === item.originalId)?.label ?? item.originalId} at ${item.path} could not be matched; the original record is kept for review.`);
  if (conflicts.length) warnings.push(`${conflicts.length} conflicting saved task records are kept in the import details; values saved directly under the current task take precedence.`);
  return { state: next, warnings, report: { ...conservation, conversions, unresolved, conflicts } };
}
