import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BACKUP_FORMAT, SCHEMA_VERSION, validateOwnedState } from '../../app/core/state.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { applyEquipmentCorrections } from '../../app/data/equipment-corrections.mjs';
import { applyCacheShops } from '../../app/data/cache-shops.mjs';
import { loadChunkSectionIndex } from '../../app/core/chunk-sections.mjs';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { createGameplayFingerprint } from '../../app/storage/gameplay-fingerprint.mjs';
import { buildIdentityIndex, legacyTaskId } from '../../app/tasks/identity.mjs';
import { decodeLegacyText, hasGameplayMigration, hasCurrentProgressAliasMigration, migrateOwnedGameplay, resolveSavedTaskId, stripTaskMarkup } from '../../app/tasks/migration.mjs';
import { normalizeOriginalMap } from '../../app/integrations/original-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonCopy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read the copied save and verified sidecars, without opening the writable store,
 * reading invitations, acquiring locks, compacting history or starting a server. */
export async function readCopiedState(dataDir, registry = createRuleRegistry()) {
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  const document = JSON.parse(bytes.toString('utf8'));
  if (document.format !== BACKUP_FORMAT || document.schemaVersion !== SCHEMA_VERSION) throw new TypeError('Unsupported copied-save format.');
  if (document.storage !== undefined) {
    const storage = document.storage;
    if (!object(storage) || storage.schemaVersion !== 1 || !object(storage.fields)
      || Object.keys(storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new TypeError('Invalid static storage metadata.');
    const directory = await realpath(path.join(dataDir, 'static'));
    for (const [key, reference] of Object.entries(storage.fields)) {
      const match = /^static-([a-f0-9]{64})\.json\.gz$/.exec(reference?.id ?? '');
      if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
        || !match || reference.sha256 !== match[1] || Object.keys(reference).some(name => !['id', 'sha256'].includes(name))) throw new TypeError(`Invalid static field reference: ${key}`);
      const file = await realpath(path.join(directory, reference.id));
      if (path.dirname(file) !== directory) throw new TypeError(`Static field escapes copied directory: ${key}`);
      const fieldBytes = gunzipSync(await readFile(file));
      if (digest(fieldBytes) !== reference.sha256) throw new TypeError(`Static field checksum mismatch: ${key}`);
      document.state[key] = JSON.parse(fieldBytes.toString('utf8'));
    }
  }
  return { state: validateOwnedState(document.state, registry), source: {
    stateSha256: digest(bytes), revision: document.state.revision,
    staticFields: Object.keys(document.storage?.fields ?? {}),
    history: 'Active history only; archived undo/history is unnecessary for read-only evaluation.',
  } };
}

/** Map exact category/label or historical codes. No label similarity matching,
 * category guessing, or selection of an ambiguous identity is permitted. */
export function createParityIdentityLookup({ state, catalogue = [], dynamicCatalogue = [], taskMap = {}, history } = {}) {
  const index = buildIdentityIndex([...(state?.tasks ?? []), ...catalogue, ...dynamicCatalogue], {
    savedRegistry: state?.identityRegistry, taskMap, history,
  });
  return {
    lookup: id => jsonCopy(index.lookup(id)),
    resolveOriginal(row) {
      if (!object(row) || typeof row.category !== 'string' || !row.category) throw new TypeError('Original task resolution requires a category.');
      const raw = row.id ?? row.rawLabel ?? row.label;
      if (typeof raw !== 'string' || !raw) throw new TypeError('Original task resolution requires an ID or raw label.');
      const decoded = decodeLegacyText(raw);
      const category = decodeLegacyText(row.category);
      const alias = decoded.startsWith('t_') || decoded.startsWith('rs3:') ? decoded : legacyTaskId(category, decoded);
      const resolution = index.resolve(alias, { category });
      return jsonCopy({ ...resolution, originalId: raw, category,
        ...(resolution.status === 'resolved' ? { task: index.lookup(resolution.id) } : {}) });
    },
  };
}

/** Selected and unlocked are independent evidence. Retained original records
 * are not synchronized or overlaid with the authored member's current lists. */
export function originalMapState(state, memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const raw = state.legacy?.maps?.[member.sourceMapId];
  const warnings = [];
  const original = raw ? normalizeOriginalMap(raw, member.sourceMapId, warnings) : null;
  return jsonCopy({ memberId, sourceMapId: member.sourceMapId,
    saved: { unlocked: member.unlocked, selected: member.selected, pendingRoll: member.pendingRoll, blacklisted: member.blacklisted },
    original: original ? { unlocked: original.unlocked, selected: original.selected, pendingRoll: original.pendingRoll,
      blacklisted: original.blacklisted, taskRules: original.taskRules } : null, warnings });
}

/** Keep all own rows and explicit status/suppression reasons. Reachable training
 * ceilings are planning results; observed progress remains separate. */
export function summarizeMemberResult(result, state, memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const active = new Set((result.presentation?.tasks ?? []).map(row => row.id));
  const summarize = row => ({ id: row.id, category: row.category, label: stripTaskMarkup(row.label), rawLabel: row.rawLabel ?? null,
    obligation: row.obligation !== false, status: row.status, active: active.has(row.id), hidden: !!row.hidden,
    primary: !!row.primary, primaryMethod: row.primaryMethod ?? null,
    requiredLevel: row.level ?? row.record?.Level ?? null,
    effectiveLevel: result.presentation?.effectiveLevels?.[row.id] ?? row.level ?? row.record?.Level ?? null,
    skillRequirements: { ...(row.record?.Skills ?? {}),
      ...Object.fromEntries((row.equipRequirements ?? []).map(({ skill, level }) => [skill, level])) },
    personalCompleted: !!row.personalCompleted, challengeSatisfied: !!row.challengeSatisfied,
    savedStatus: jsonCopy(member.taskStatus?.[row.id]), blockers: row.blockers ?? [],
    hiddenReasons: row.hiddenReasons ?? [], suppressionReasons: result.presentation?.suppressed?.[row.id] ?? [],
    explanation: row.explanation ?? null, sources: row.sources ?? [], equipmentName: row.equipmentName ?? null });
  const tasks = (result.tasks ?? []).filter(row => row.obligation !== false).map(summarize);
  return jsonCopy({ memberId, sourceMapId: member.sourceMapId, revision: state.revision,
    savedStatuses: member.taskStatus ?? {},
    chunks: originalMapState(state, memberId), tasks,
    activeTasks: tasks.filter(row => row.active), eligibleTasks: tasks.filter(row => row.status === 'available'),
    otherAccessibleTasks: (result.tasks ?? []).filter(row => row.obligation === false).map(summarize),
    equipment: (result.equipment ?? []).filter(row => row.obligation !== false),
    currentBiS: result.currentBiS ?? null, equipmentPlanning: result.equipmentPlanning ?? null,
    training: result.training ?? {}, points: result.points ?? {},
    presentation: { effectiveLevels: result.presentation?.effectiveLevels ?? {}, alternatives: result.presentation?.alternatives ?? {},
      diagnostics: result.presentation?.diagnostics ?? [], coverage: result.presentation?.coverage ?? null },
    diagnostics: result.diagnostics ?? [], coverage: result.coverage ?? null,
    metrics: { ownRows: tasks.length, activeRows: tasks.filter(row => row.active).length,
      eligibleRows: tasks.filter(row => row.status === 'available').length, engine: result.metrics ?? null },
  });
}

/** Uses the authored app's complete worker pipeline and the copied save as-is.
 * Any required migration is detached and reported; nothing is persisted. Paths
 * for optional real game-data geometry are explicit, never guessed from main. */
export async function loadLocalParityModel({ dataDir = path.join(ROOT, '.local', 'duo'),
  gameDataDir = path.join(ROOT, '.local', 'game-data'), mapAssetsDir = path.join(ROOT, '.local', 'map-assets'),
  deadlineMs = 120000 } = {}) {
  const [loaded, rawDefinitions, taskMap, history] = await Promise.all([
    readCopiedState(dataDir), readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8').then(JSON.parse),
    readFile(path.join(ROOT, 'reference/original-picker/tasksMap.json'), 'utf8').then(JSON.parse),
    readFile(path.join(ROOT, 'app', 'data', 'legacy-task-history.json'), 'utf8').then(JSON.parse),
  ]);
  const definitions = applyCacheShops(applyEquipmentCorrections(rawDefinitions));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const geometry = await loadChunkSectionIndex(gameDataDir, ROOT, world, { dataset: selectedDataset });
  const scheduler = await createTaskScheduler({ deadlineMs, startupDeadlineMs: deadlineMs,
    workerData: { definitions, datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
      world: { chunks: world.chunks, surface: world.surface }, extraRules: [] } });
  try {
    let state = loaded.state;
    const registered = new Set(state.tasks.map(row => row.id));
    const current = scheduler.catalogue.every(row => registered.has(row.id)) && state.identityRegistry?.schemaVersion === 1 && hasCurrentProgressAliasMigration(state)
      && state.members.every(member => member.sourceMapId == null || state.legacy?.gameplayMigration?.schemaVersion >= 2 && hasGameplayMigration(state, member))
      && state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
        && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)));
    const migration = current ? { reused: true, warnings: [] } : migrateOwnedGameplay(state, {
      definitions, catalogue: scheduler.catalogue, dynamicCatalogue: scheduler.dynamicCatalogue, taskMap, taskMapHistory: history });
    if (!current) state = migration.state;
    const identity = createParityIdentityLookup({ state, catalogue: scheduler.catalogue, dynamicCatalogue: scheduler.dynamicCatalogue, taskMap, history });
    return {
      state, members: state.members.map(({ id, name, sourceMapId }) => ({ id, name, sourceMapId })),
      source: { ...loaded.source, gameDataDir: path.resolve(gameDataDir), mapAssetsDir: path.resolve(mapAssetsDir),
        geometry: { components: geometry.components.size, reason: geometry.reason ?? null, provenance: geometry.provenance },
        assetUse: 'Game-data geometry is verified for provenance; map assets are presentation-only and do not change task evaluation.',
        migration: { reused: current, warnings: migration.warnings, report: migration.report ?? null } },
      ...identity,
      originalMap: memberId => originalMapState(state, memberId),
      async evaluate(memberId, { state: scenario = state } = {}) {
        // Fresh fingerprints also support caller-owned mutable counterfactuals.
        // The worker's snapshot key needs the input as well as scheduler key.
        const input = createGameplayFingerprint()(scenario);
        const evaluation = await scheduler.evaluate(scenario, memberId, 'evaluate', undefined,
          `${memberId}:${input}`, input);
        return evaluation.result;
      },
      async summarize(memberId, options = {}) {
        const scenario = options.state ?? state;
        const input = createGameplayFingerprint()(scenario);
        const evaluation = await scheduler.evaluate(scenario, memberId, 'evaluate', undefined,
          `${memberId}:${input}`, input);
        return summarizeMemberResult(evaluation.result, scenario, memberId);
      },
      close: () => scheduler.close(),
    };
  } catch (error) { await scheduler.close(); throw error; }
}
