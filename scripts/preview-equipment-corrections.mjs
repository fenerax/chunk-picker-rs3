import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateState } from '../app/core/state.mjs';
import { applyMetadataCorrections } from '../app/data/metadata-corrections.mjs';
import { applyEquipmentCorrections } from '../app/data/equipment-corrections.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { evaluateEquipment, buildCurrentBiS, buildEquipmentCatalogue } from '../app/tasks/equipment.mjs';
import { decodeLegacyText, hasGameplayMigration } from '../app/tasks/migration.mjs';
import { loadPreviewState } from './preview-metadata-corrections.mjs';

const root = new URL('../', import.meta.url);
const unique = values => [...new Set(values)].sort();
const fields = (value, names) => Object.fromEntries(names.map(name => [name, value?.[name] ?? null]));
// Cache linkage records provenance; adding it alone does not change a gear goal.
const behavioralMetadata = record => Object.fromEntries(Object.entries(record ?? {}).filter(([field]) => field !== 'cacheIdentity'));

function differences(before = {}, after = {}) {
  return unique([...Object.keys(before), ...Object.keys(after)]).flatMap(field => {
    const beforeExists = Object.hasOwn(before, field), afterExists = Object.hasOwn(after, field);
    if (beforeExists === afterExists && isDeepStrictEqual(before[field], after[field])) return [];
    return [{ field, before: beforeExists ? before[field] : null, after: afterExists ? after[field] : null,
      ...(!beforeExists || !afterExists ? { beforeExists, afterExists } : {}) }];
  });
}

function recommendation(row) {
  return { name: row.equipment.name, score: row.score, mode: row.loadoutMode ?? null,
    alternatives: row.alternatives ?? [], comparison: row.comparison ?? null,
    requirements: row.equipment.data?.requirements ?? {}, maintenance: row.equipment.data?.charges ?? null,
    sources: row.equipment.sources ?? [],
    ...fields(row, ['sourceAccess', 'challenge']) };
}

/** Multiple selected weapon modes can recommend different items in one slot. */
function slotChanges(before = [], after = []) {
  const index = values => {
    const groups = new Map();
    for (const row of values) {
      const key = `${row.style}\u0000${row.slot}`;
      const group = groups.get(key) ?? { style: row.style, slot: row.slot, items: [] };
      group.items.push(recommendation(row)); groups.set(key, group);
    }
    return groups;
  };
  const prior = index(before), current = index(after);
  return unique([...prior.keys(), ...current.keys()]).flatMap(key => {
    const old = prior.get(key), next = current.get(key);
    if (isDeepStrictEqual(old?.items ?? [], next?.items ?? [])) return [];
    return [{ style: (next ?? old).style, slot: (next ?? old).slot,
      before: old?.items ?? [], after: next?.items ?? [] }];
  });
}

function loadoutChanges(before = [], after = []) {
  const prior = new Map(before.map(row => [row.style, row])), current = new Map(after.map(row => [row.style, row]));
  return unique([...prior.keys(), ...current.keys()]).flatMap(style => {
    const old = prior.get(style) ?? null, next = current.get(style) ?? null;
    return isDeepStrictEqual(old, next) ? [] : [{ style, before: old, after: next }];
  });
}

function specialistChanges(before = {}, after = {}) {
  const comparison = name => ({
    slots: slotChanges(before[name]?.recommendations, after[name]?.recommendations),
    loadouts: loadoutChanges(before[name]?.loadouts, after[name]?.loadouts),
    changes: differences(fields(before[name], ['enabled', 'coverage']), fields(after[name], ['enabled', 'coverage'])),
  });
  return { tank: comparison('tank'), weight: comparison('weight'),
    changes: differences(fields(before, ['skilling', 'relics', 'misc', 'upgradePaths', 'coverage']),
      fields(after, ['skilling', 'relics', 'misc', 'upgradePaths', 'coverage'])) };
}

function viewChanges(before = {}, after = {}) {
  return { slots: slotChanges(before.recommendations, after.recommendations),
    loadouts: loadoutChanges(before.loadouts, after.loadouts),
    specialist: specialistChanges(before.specialist, after.specialist),
    changes: differences(fields(before, ['diagnostics', 'coverage']), fields(after, ['diagnostics', 'coverage'])) };
}

const taskFields = ['label', 'rawLabel', 'status', 'hidden', 'hiddenReasons', 'blockers', 'obligation',
  'personalCompleted', 'challengeSatisfied', 'equipmentGoals', 'equipRequirements', 'maintenance', 'sources', 'explanation', 'record'];
function taskSnapshot(task, planning, dutyPlanning) {
  if (!task) return {};
  return { ...fields(task, taskFields), obligation: task.obligation !== false, hidden: !!task.hidden,
    hiddenReasons: task.hiddenReasons ?? [], blockers: task.blockers ?? [],
    selected: planning.tasks.some(row => row.id === task.id),
    obligationSelected: dutyPlanning.tasks.some(row => row.id === task.id),
    alternatives: dutyPlanning.alternatives[task.id] ?? [],
    scores: dutyPlanning.recommendations.filter(row => row.equipment.name === task.equipmentName)
      .map(row => ({ style: row.style, slot: row.slot, mode: row.loadoutMode ?? null, score: row.score })) };
}

function evaluation(engine, definitions, state, memberId) {
  const equipmentNames = Object.keys(definitions.equipment ?? {});
  const equipmentById = new Map(buildEquipmentCatalogue(definitions).map((row, index) => [row.id, equipmentNames[index]]));
  const member = state.members.find(owner => owner.id === memberId);
  const savedIds = new Set([...Object.keys(member.taskStatus ?? {}), ...member.completedTasks ?? []]);
  const result = engine.evaluate(state, memberId, {
    ownItemQueries: [...savedIds].filter(id => equipmentById.has(id)).map(id => equipmentById.get(id)),
  });
  const planning = evaluateEquipment(result, state, memberId, definitions);
  const legacyRules = hasGameplayMigration(state, member) ? {} : Object.fromEntries(Object.entries(state.legacy?.maps?.[member.sourceMapId]?.rules ?? {})
    .map(([key, value]) => [decodeLegacyText(key), value]));
  const equipmentRules = { ...legacyRules, ...state.taskRules, ...member.taskRules };
  let dutyPlanning = planning;
  if ([false, 'false', 0].includes(equipmentRules['Show Best in Slot Tasks'])) {
    const dutyState = { ...state, members: state.members.map(owner => owner.id === memberId
      ? { ...owner, taskRules: { ...owner.taskRules, 'Show Best in Slot Tasks': true } } : owner) };
    dutyPlanning = evaluateEquipment(result, dutyState, memberId, definitions);
  }
  const visibleIds = new Set(planning.catalogue.map(task => task.id));
  const hiddenDuties = dutyPlanning.catalogue.filter(task => !visibleIds.has(task.id)).map(task => ({ ...task,
    hidden: true, hiddenReasons: [...(task.hiddenReasons ?? []), 'Hidden by the Show Best in Slot Tasks display setting.'] }));
  result.tasks = [...new Map([...result.tasks, ...planning.catalogue, ...hiddenDuties].map(task => [task.id, task])).values()];
  const present = new Set(result.tasks.map(task => task.id)), ownItems = new Set(result.ownItemOrigins);
  // Match the worker's equipment-only saved-derived fallback. Source ownership
  // is checked independently of today's equipability, rules and backlog.
  result.tasks.push(...state.tasks.filter(task => savedIds.has(task.id) && equipmentById.has(task.id) && !present.has(task.id)).map(task => {
    const own = ownItems.has(equipmentById.get(task.id));
    const detail = own ? 'The defining source is on this member’s own map; current requirements, rules or backlog prevent an active goal.'
      : 'No defining source on this member’s own reachable map.';
    return { ...task, obligation: own, hidden: !own, hiddenReasons: own ? [] : ['Outside the current own obligation map.'],
      status: 'blocked', explanation: detail, blockers: [{ kind: 'access', detail }], sources: [] };
  }));
  // Match the worker's personal-source view without creating ownership facts.
  const personalResult = { ...result, equipment: result.equipment.filter(row => row.obligation !== false) };
  const currentBiS = buildCurrentBiS(result, planning, state, memberId, definitions, personalResult);
  const tasks = new Map();
  for (const task of result.tasks.filter(row => equipmentById.has(row.id))) {
    if (tasks.has(task.id)) throw new TypeError(`Duplicate generated equipment task ID: ${task.id}`);
    tasks.set(task.id, { ...task, equipmentName: equipmentById.get(task.id) });
  }
  return { planning, dutyPlanning, currentBiS, tasks };
}

/** Pure equipment-only comparison over the same personal facts, topology,
 * resource overlays, travel tables and task metadata on both sides.
 * Custom overlays are isolated: supplying either input suppresses the other
 * default dataset. The runtime overlay is applied once, including presentation.
 */
export function previewEquipmentCorrections({ state, definitions, corrections, weights, engineOptions = {} }) {
  const validated = validateState(state);
  const baseline = engineOptions.metadataCorrections === false ? definitions : applyMetadataCorrections(definitions);
  const custom = corrections !== undefined || weights !== undefined;
  const correctionRows = corrections?.corrections ?? corrections;
  const weightRows = weights?.records ?? weights;
  const corrected = applyEquipmentCorrections(baseline, custom
    ? { corrections: correctionRows ?? [], weights: weightRows ?? [], identities: [] } : {});
  const options = { cacheWalking: selectedDataset.capabilities.cacheWalking, ...engineOptions, metadataCorrections: false, equipmentCorrections: false };
  const beforeEngine = createTaskEngine(baseline, { dataset: selectedDataset, ...options }), afterEngine = createTaskEngine(corrected, { dataset: selectedDataset, ...options });
  const equipmentMetadata = unique([...Object.keys(baseline.equipment ?? {}), ...Object.keys(corrected.equipment ?? {})])
    .flatMap(name => {
      const changes = differences(behavioralMetadata(baseline.equipment?.[name]), behavioralMetadata(corrected.equipment?.[name]));
      return changes.length ? [{ name, changes }] : [];
    });
  const members = validated.members.map(member => {
    const before = evaluation(beforeEngine, baseline, validated, member.id);
    const after = evaluation(afterEngine, corrected, validated, member.id);
    const ids = unique([...before.tasks.keys(), ...after.tasks.keys()]);
    const tasks = ids.flatMap(id => {
      const old = before.tasks.get(id), next = after.tasks.get(id), task = next ?? old;
      const metadata = differences(behavioralMetadata(baseline.equipment?.[task.equipmentName]), behavioralMetadata(corrected.equipment?.[task.equipmentName]));
      const availability = differences(taskSnapshot(old, before.planning, before.dutyPlanning), taskSnapshot(next, after.planning, after.dutyPlanning));
      if (!metadata.length && !availability.length) return [];
      return [{ id, name: task.equipmentName, label: task.label,
        status: { before: old?.status ?? null, after: next?.status ?? null },
        ...(!old || !next ? { presence: { before: !!old, after: !!next } } : {}), metadata, availability }];
    });
    return { id: member.id, name: member.name, checkedTaskCount: ids.length, changedTaskCount: tasks.length, tasks,
      currentBiS: { obtainable: viewChanges(before.currentBiS.obtainable, after.currentBiS.obtainable),
        personallyRecordedObtainable: viewChanges(before.currentBiS.owned.recordedBest, after.currentBiS.owned.recordedBest),
        changes: differences(fields(before.currentBiS, ['accessPolicy', 'completionScope', 'importedSelections', 'coverage']),
          fields(after.currentBiS, ['accessPolicy', 'completionScope', 'importedSelections', 'coverage'])),
        recordedObtained: differences({ items: before.currentBiS.owned.recordedObtained }, { items: after.currentBiS.owned.recordedObtained }) } };
  });
  return { revision: validated.revision, equipmentMetadata, members,
    scope: 'Read-only comparison of obtainable recommendations and personally recorded obtainable gear; current possession and equipped slots remain unconfirmed.' };
}

export function formatPreview(report) {
  const lines = [`Equipment correction preview (state revision ${report.revision})`, report.scope];
  const describe = changes => {
    for (const change of changes) {
      const value = (side, exists) => exists === false ? '(absent)' : JSON.stringify(side);
      lines.push(`    ${change.field}: ${value(change.before, change.beforeExists)} -> ${value(change.after, change.afterExists)}`);
    }
  };
  for (const item of report.equipmentMetadata) { lines.push(`  metadata: ${item.name}`); describe(item.changes); }
  for (const member of report.members) {
    lines.push('', `${member.name} (${member.id}): ${member.changedTaskCount} changed / ${member.checkedTaskCount} checked generated equipment tasks`);
    for (const [label, view] of [['Obtainable Current BiS', member.currentBiS.obtainable],
      ['Personally recorded obtainable Current BiS', member.currentBiS.personallyRecordedObtainable]]) {
      lines.push(`  ${label}: ${view.slots.length} changed slots, ${view.loadouts.length} changed coupled loadouts`);
      for (const slot of view.slots) {
        lines.push(`    ${slot.style} / ${slot.slot}`);
        lines.push(`      before: ${JSON.stringify(slot.before)}`, `      after: ${JSON.stringify(slot.after)}`);
      }
      for (const loadout of view.loadouts) {
        lines.push(`    ${loadout.style} coupled loadouts`);
        lines.push(`      before: ${JSON.stringify(loadout.before)}`, `      after: ${JSON.stringify(loadout.after)}`);
      }
      describe(view.changes);
      // Tank/weight slots and loadouts also occur in the main recommendation
      // list; coverage and other specialist changes need their own output.
      for (const kind of ['tank', 'weight']) {
        if (view.specialist[kind].changes.length) { lines.push(`    ${kind} specialist`); describe(view.specialist[kind].changes); }
      }
      if (view.specialist.changes.length) { lines.push('    specialist comparisons'); describe(view.specialist.changes); }
    }
    describe(member.currentBiS.changes);
    if (member.currentBiS.recordedObtained.length) { lines.push('  Personal obtain records'); describe(member.currentBiS.recordedObtained); }
    for (const task of member.tasks) {
      lines.push(`  BiS: ${task.label} [${task.id}]`);
      lines.push(`    status: ${task.status.before} -> ${task.status.after}`);
      if (task.presence) lines.push(`    presence: ${task.presence.before} -> ${task.presence.after}`);
      lines.push('    metadata'); describe(task.metadata);
      lines.push('    availability / goals / scores'); describe(task.availability);
    }
  }
  return lines.join('\n');
}

const usage = 'Usage: node scripts/preview-equipment-corrections.mjs --state PATH [--definitions PATH] [--corrections PATH] [--weights PATH] [--no-cache-walking] [--synthetic-definitions] [--json]';
export async function runPreviewCli(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') { process.stdout.write(`${usage}\n`); return; }
    if (flag === '--no-cache-walking') {
      if (options.noCacheWalking) throw new TypeError(usage);
      options.noCacheWalking = true; continue;
    }
    if (flag === '--synthetic-definitions') {
      if (options.syntheticDefinitions) throw new TypeError(usage);
      options.syntheticDefinitions = true; continue;
    }
    if (flag === '--json') {
      if (options.json) throw new TypeError(usage);
      options.json = true; continue;
    }
    if (!['--state', '--definitions', '--corrections', '--weights'].includes(flag)
      || !args[index + 1] || args[index + 1].startsWith('--') || options[flag.slice(2)]) throw new TypeError(usage);
    options[flag.slice(2)] = args[++index];
  }
  if (!options.state || (options.syntheticDefinitions && !options.definitions)) throw new TypeError(usage);
  const state = await loadPreviewState(options.state);
  const definitions = JSON.parse(await readFile(options.definitions ?? new URL('rs3-chunkpicker-chunkinfo-export.json', root), 'utf8'));
  const corrections = options.corrections ? JSON.parse(await readFile(options.corrections, 'utf8')) : undefined;
  const weights = options.weights ? JSON.parse(await readFile(options.weights, 'utf8')) : undefined;
  const report = previewEquipmentCorrections({ state, definitions, corrections, weights,
    engineOptions: { ...(options.noCacheWalking ? { cacheWalking: false } : {}),
      ...(options.syntheticDefinitions ? { reviewedOverlays: false } : {}) } });
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatPreview(report)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreviewCli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
