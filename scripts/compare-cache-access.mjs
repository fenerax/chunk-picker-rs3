import { selectedDataset } from '../app/dataset-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { isCustomTask, personalCustomTaskRows } from '../app/web/custom-tasks-model.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { evaluateRollPool, reachableSections, partnerConnections, createRuleRegistry, effectiveSectionOverrides } from '../app/core/rules.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import { buildAccessIndex } from '../app/tasks/access.mjs';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress.mjs';
import { originalSettings } from '../app/data/settings.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { selectPresentedTasks, buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { createCollectionEngine, selectCollectionGoals } from '../app/tasks/collection.mjs';
import { decodeLegacyText, hasGameplayMigration } from '../app/tasks/migration.mjs';
import { createTaskPinChecker, selectTaskFilters } from '../app/web/task-filters-model.mjs';
import { readScreenGraph, screenFunctionSource } from '../tests/browser-screen-harness.mjs';

const renderSource = screenFunctionSource(await readScreenGraph(), 'renderTasks');
const sorted = values => [...values].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

/** Exercise the actual browser renderer without DOM/network startup. The
 * default controls match a freshly loaded UI and its saved hideChecked setting. */
export function observeTaskViews(state, memberId, result, controls = {}) {
  const member = state.members.find(owner => owner.id === memberId);
  const prefs = { ...originalSettings, hideChecked: true, ...state.legacy?.maps?.[member.sourceMapId]?.settings, ...member.preferences };
  const registry = createRuleRegistry();
  const facts = createTaskFactsIndex(state, memberId, registry, { tasks: result.tasks, completionGroups: result.collectionPlanning?.completionGroups ?? {} });
  const nodes = new Map(), views = {}, taskListRows = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { id, checked: false, value: '', replaceChildren() {} }); return nodes.get(id); };
  node('hide-completed').checked = controls.hideCompleted ?? prefs.hideChecked;
  node('show-all').checked = controls.showAll ?? false;
  node('show-blocked').checked = controls.showBlocked ?? false;
  node('task-filter').value = controls.filter ?? '';
  const context = createContext({ state, memberId, result, taskHover: undefined, duoHovers: new Map(), duoTaskView: undefined, duoInspectionCache: undefined, copyLists: undefined, tickActiveTasks: undefined, duoEnabled: () => false, member: () => member, preferences: () => prefs,
    sandbox: { active: false }, isCustomTask, personalCustomTaskRows,
    createTaskPinChecker, activeTaskFilters: () => ({ select(rows, options, { search = '' } = {}) {
      const selected = selectTaskFilters(rows, { ...options, filters: controls.taskFilters }).rows;
      return search ? selected.filter(task => `${task.label} ${task.category}`.toLowerCase().includes(search)) : selected;
    } }),
    $: node, map: {}, renderLegend() {}, list: value => value,
    // This snapshot renderer has no live foreground lifecycle or advisories.
    foregroundSettled: () => false, deathChunks: undefined, mapTaskCounts: undefined, groupGoals: undefined, renderCompleted() {},
    taskRenderGeneration: 0, taskListRows, taskRenderDone: Promise.resolve(), paintTaskJobs: () => Promise.resolve(true),
    taskFacts: task => facts.get(task.id, task.completionIds), taskFactsCache: facts, goalProgress,
    grouped: (target, rows) => { views[target.id] = Array.from(rows, row => row.id); } });
  runInContext(`${renderSource}\nrenderTasks();`, context);
  // Closed disclosures defer DOM rows; their cached membership still supplies
  // the comparison's completed and backlog views without changing UI controls.
  views['backlog-tasks'] = Array.from(taskListRows.get('backlog-tasks') ?? [], row => row.id);
  views['completed-tasks'] = Array.from(taskListRows.get('completed-tasks') ?? [], row => row.id);
  return { controls: { hideCompleted: node('hide-completed').checked, showAll: node('show-all').checked, showBlocked: node('show-blocked').checked, filter: node('task-filter').value },
    active: views['active-tasks'], backlog: views['backlog-tasks'], completed: views['completed-tasks'],
    countLabel: node('task-count').textContent, activeCount: views['active-tasks'].length,
    backlogCount: views['backlog-tasks'].length, completedCount: views['completed-tasks'].length };
}

/** Mirrors worker.evaluateFull's production collection/equipment/presentation
 * sequence, including restored saved derived rows. A focused test checks this
 * against the real worker, rather than assuming engine.evaluate is the UI. */
export function createComparisonEvaluator(definitions, cacheWalking, { reviewedOverlays } = {}) {
  const policy = reviewedOverlays === undefined ? {} : { reviewedOverlays };
  const engine = createTaskEngine(definitions, { dataset: selectedDataset, cacheWalking, ...policy }), collectionEngine = createCollectionEngine(definitions, { dataset: selectedDataset });
  const equipmentCatalogue = buildEquipmentCatalogue(definitions), equipmentNames = Object.keys(definitions.equipment ?? {});
  const equipmentById = new Map(equipmentCatalogue.map((row, index) => [row.id, equipmentNames[index]]));
  const derivedIds = new Set([...equipmentCatalogue, ...collectionEngine.catalogue].map(row => row.id));
  return (state, memberId) => {
    const member = state.members.find(owner => owner.id === memberId);
    const savedIds = [...new Set([...Object.keys(member.taskStatus ?? {}), ...member.completedTasks ?? []])];
    const result = engine.evaluate(state, memberId, { ownItemQueries: savedIds.filter(id => equipmentById.has(id)).map(id => equipmentById.get(id)) });
    const collection = collectionEngine.evaluate(state, memberId, result, { obligationQueries: savedIds });
    result.tasks.push(...collection.tasks);
    result.collectionPlanning = { completionGroups: collection.completionGroups, obligationIds: collection.obligationIds, diagnostics: collection.diagnostics, coverage: collection.coverage };
    result.diagnostics.push(...collection.diagnostics);
    const equipment = evaluateEquipment(result, state, memberId, definitions);
    const legacyRules = hasGameplayMigration(state, member) ? {} : Object.fromEntries(Object.entries(state.legacy?.maps?.[member.sourceMapId]?.rules ?? {}).map(([key, value]) => [decodeLegacyText(key), value]));
    const rules = { ...legacyRules, ...state.taskRules, ...member.taskRules };
    const dutyEquipment = [false, 'false', 0].includes(rules['Show Best in Slot Tasks'])
      ? evaluateEquipment(result, { ...state, members: state.members.map(owner => owner.id === memberId ? { ...owner, taskRules: { ...owner.taskRules, 'Show Best in Slot Tasks': true } } : owner) }, memberId, definitions) : equipment;
    result.presentation = selectCollectionGoals(selectPresentedTasks({ ...result, tasks: [...result.tasks, ...equipment.tasks] }, state, memberId, definitions), state, memberId);
    result.presentation.alternatives = { ...result.presentation.alternatives, ...equipment.alternatives };
    const visible = new Set(equipment.catalogue.map(task => task.id));
    const hidden = dutyEquipment.catalogue.filter(task => !visible.has(task.id)).map(task => ({ ...task, hidden: true, hiddenReasons: [...task.hiddenReasons ?? [], 'Hidden by the Show Best in Slot Tasks display setting.'] }));
    result.tasks = [...new Map([...result.tasks, ...equipment.catalogue, ...hidden].map(task => [task.id, task])).values()];
    const present = new Set(result.tasks.map(task => task.id)), ownSaved = new Set(collection.obligationIds), ownItems = new Set(result.ownItemOrigins);
    result.tasks.push(...state.tasks.filter(task => savedIds.includes(task.id) && derivedIds.has(task.id) && !present.has(task.id)).map(task => {
      const own = ownSaved.has(task.id) || ownItems.has(equipmentById.get(task.id));
      const detail = own ? 'The defining source is on this member’s own map; current requirements, rules or backlog prevent an active goal.' : 'No defining source on this member’s own reachable map.';
      return { ...task, obligation: own, hidden: !own, hiddenReasons: own ? [] : ['Outside the current own obligation map.'], status: 'blocked', explanation: detail, blockers: [{ kind: 'access', detail }], sources: [] };
    }));
    result.activityInfo = buildActivityInfo(result, state, memberId, definitions);
    result.metrics.availableCount = result.tasks.filter(task => task.status === 'available' && task.obligation !== false).length;
    return result;
  };
}

const requirementFields = ['Chunks', 'Sections', 'Areas', 'Objects', 'NPCs', 'Monsters', 'Shops', 'Items', 'Tasks', 'Skills', 'SkillsNeeded', 'Requirements'];
function taskSummary(task, result, selected) {
  const custom = task.id.startsWith('custom:');
  return { id: task.id, label: custom ? '[Saved custom task]' : task.label, category: task.category, level: task.level,
    status: task.status, obligation: task.obligation !== false, hidden: !!task.hidden, hiddenReasons: task.hiddenReasons ?? [],
    personalCompleted: !!task.personalCompleted, challengeSatisfied: !!task.challengeSatisfied,
    blockers: task.blockers ?? [], sources: task.sources ?? [], explanation: custom ? undefined : task.explanation,
    requirements: Object.fromEntries(requirementFields.filter(key => Object.hasOwn(task.record ?? {}, key)).map(key => [key, task.record[key]])),
    suppression: result.presentation.suppressed?.[task.id] ?? [], selected: selected.has(task.id) };
}

export function buildComparisonSnapshot(definitions, state, cacheWalking, { reviewedOverlays } = {}) {
  const policy = reviewedOverlays === undefined ? {} : { reviewedOverlays };
  const world = buildWorld(definitions, { dataset: selectedDataset, cacheWalking, ...policy }), evaluate = createComparisonEvaluator(definitions, cacheWalking, policy);
  const taskWorld = buildAccessIndex(definitions, { dataset: selectedDataset, cacheWalking, ...policy }).world;
  const members = state.members.map((member, index) => {
    const pool = evaluateRollPool(world, state, member.id), result = evaluate(state, member.id);
    for (const scope of ['access', 'obligationAccess']) {
      if (!result[scope].locations) throw new Error('Comparison requires serialized source locations.');
      for (const [key, value] of Object.entries(result[scope])) if (Array.isArray(value) && key !== 'diagnostics') result[scope][key] = sorted(value);
      result[scope].locations = Object.fromEntries(Object.entries(result[scope].locations).sort().map(([key, values]) => [key, sorted(values)]));
    }
    const selected = new Set(result.presentation.tasks.map(task => task.id));
    const personalTravel = evaluatePartnerConnections(taskWorld, { ...state, members: [member] }, member.id,
      { sectionsByMember: { [member.id]: taskWorld.cacheWalking ? result.obligationAccess.components : result.obligationAccess.sections }, sectionOverrides: effectiveSectionOverrides(state, member) });
    return { member: `Member${index + 1}`, pool: pool.eligible.map(entry => ({ ...entry, name: world.chunks.get(entry.id)?.name })), excluded: pool.excluded,
      sections: reachableSections(world, state, member.id), partner: result.partnerConnections,
      rollPartner: partnerConnections(world, state, member.id), personalTravelNodes: personalTravel.reachable,
      access: result.access, obligationAccess: result.obligationAccess,
      availableTaskCount: result.metrics.availableCount,
      tasks: result.tasks.map(task => taskSummary(task, result, selected)), presentedTasks: result.presentation.tasks.map(task => task.id),
      presentationDiagnostics: result.presentation.diagnostics, diagnostics: result.diagnostics,
      ui: { default: observeTaskViews(state, member.id, result), showCompleted: observeTaskViews(state, member.id, result, { hideCompleted: false }),
        showAll: observeTaskViews(state, member.id, result, { showAll: true }), showBlocked: observeTaskViews(state, member.id, result, { showBlocked: true }) },
      activityTraining: result.activityInfo.skills.map(skill => ({ ...skill,
        primaryMethods: skill.primaryMethods.map(row => row.id), availableTasks: skill.availableTasks.map(row => row.id), nonPrimaryMethods: skill.nonPrimaryMethods.map(row => row.id),
        blockedTasks: skill.blockedTasks.map(row => row.id), selectedGoals: skill.selectedGoals.map(row => row.id) })),
      training: Object.fromEntries(Object.entries(result.training).map(([skill, value]) => [skill, Object.fromEntries(['level', 'cap', 'primary', 'passiveLevel', 'viaPartners', 'primaryOverride', 'manualPrimary', 'passiveOverride', 'maxOverride'].map(key => [key, value[key]]))])) };
  });
  // Do not export user names, account names, map IDs, notes, history or raw save.
  const identities = new Map(state.members.flatMap((member, index) => [member.id, member.name, member.runescapeName, member.sourceMapId].filter(value => typeof value === 'string' && value).map(value => [value, `Member${index + 1}`])));
  const narrativeNames = state.members.flatMap((member, index) => [member.name, member.runescapeName].filter(value => typeof value === 'string' && value.length > 1).map(value => [value, `Member${index + 1}`])).sort((a, b) => b[0].length - a[0].length);
  const anonymize = value => {
    if (typeof value === 'string') {
      if (identities.has(value)) return identities.get(value);
      for (const [name, alias] of narrativeNames) value = value.split(name).join(alias);
      return value;
    }
    if (Array.isArray(value)) return value.map(anonymize);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, anonymize(child)])) : value;
  };
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), cacheWalking,
    definitionSha256: createHash('sha256').update(JSON.stringify(definitions)).digest('hex'),
    baseline: 'Corrected retained definitions with cache walking disabled; same immutable input state and current task/presentation rules.',
    cacheProvenance: world.cacheWalking ? { cache: world.cacheWalking.provenance, policy: world.cacheWalking.policyProvenance } : null,
    cacheStateSha256: world.cacheWalking ? createHash('sha256').update(JSON.stringify({ mapping: world.cacheWalking.mapping,
      components: [...world.cacheWalking.components], topology: [...world.cacheWalking.topology].map(([base, sections]) => [base, [...sections]]) })).digest('hex') : null,
    members: anonymize(members) };
}

async function main() {
  const values = process.argv.slice(2), args = {};
  if (values.length % 2) throw new Error('Options require values.');
  for (let i = 0; i < values.length; i += 2) {
    if (!['--state', '--output', '--cache-walking'].includes(values[i])) throw new Error('Unknown comparison option.');
    args[values[i]] = values[i + 1];
  }
  if (!args['--state'] || !args['--output']) throw new Error('Use --state PRIVATE_COPY --output IGNORED_REPORT [--cache-walking false|true|both]');
  const mode = args['--cache-walking'] ?? 'both';
  if (!['false', 'true', 'both'].includes(mode)) throw new Error('--cache-walking must be false, true or both.');
  const inputPath = path.resolve(args['--state']), outputPath = path.resolve(args['--output']);
  const localRoot = fileURLToPath(new URL('../.local/', import.meta.url));
  const relativeOutput = path.relative(localRoot, outputPath);
  if (inputPath.toLowerCase() === outputPath.toLowerCase() || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Output must be a distinct ignored file under this worktree .local/.');
  const bytes = await fs.readFile(inputPath), input = JSON.parse(bytes), state = input.state ?? input;
  const definitions = JSON.parse(await fs.readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const saved = JSON.stringify(state), sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const snapshot = enabled => ({ ...buildComparisonSnapshot(definitions, state, enabled), sourceSha256 });
  const report = mode === 'both' ? { schemaVersion: 2, before: snapshot(false), after: snapshot(true) } : snapshot(mode === 'true');
  if (saved !== JSON.stringify(state) || !bytes.equals(await fs.readFile(inputPath))) throw new Error('Comparison input changed during evaluation.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log('Anonymous derived comparison written. Input unchanged; no private state printed.');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
