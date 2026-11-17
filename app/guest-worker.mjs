// This worker has no store, registry, sidecar, integration or telemetry owner.
import { parentPort, workerData } from 'node:worker_threads';
import { createGroupState, applyCommand, exportBackup, importBackup, getUndoEligibility } from './core/state.mjs';
import { createRuleRegistry, evaluateRollPool, partnerConnections } from './core/rules.mjs';
import { buildWorld, surfaceCoordinates } from './data/world.mjs';
import { createTaskEngine } from './tasks/engine.mjs';
import { selectPresentedTasks } from './tasks/presentation.mjs';
import { selectedDataset, datasetJSON } from './dataset-runtime.mjs';
import { assertWorkerHeapLimit } from './tasks/worker-limits.mjs';
import { prepareWorkerDefinitions } from './dataset-pipeline.mjs';
import { projectDisplayWorld } from './display-world.mjs';
import { evaluateEquipment, buildCurrentBiS } from './tasks/equipment.mjs';
import { buildActivityInfo } from './tasks/activity.mjs';
import { createCollectionEngine, selectCollectionGoals } from './tasks/collection.mjs';
import { taskWhyDisplay } from './tasks/task-why-display.mjs';
import { chunkSectionsPayload } from './core/chunk-sections.mjs';
import { predictChunk, previewRuleProfile } from './core/planning.mjs';
import { configureAutomaticTransport } from './core/automatic-transport.mjs';
import { evaluateTransportRoutes } from './core/transport-access.mjs';
import { personalTeleportRows } from './core/teleport-returns.mjs';
import { projectTeleportRoute } from './teleports-response.mjs';
import { buildChunkPlanningIndex } from './tasks/chunk-planning-index.mjs';
import { projectPlayTask } from './play-view.mjs';
import { buildWhyChain } from './tasks/why-chain.mjs';
import { backlogSearchTasks } from './tasks/backlog-search.mjs';
import { computeRollStats } from './core/roll-stats.mjs';
import { buildXpChoiceCatalogue, buildXpChoiceView } from './core/xp-choices.mjs';

assertWorkerHeapLimit();
const allowedCommands = new Set(['set-chunk', 'set-note', 'roll', 'unpick', 'unlock-selection', 'pick-for-me',
  'unlock-both', 'cancel-roll', 'undo', 'set-rule', 'set-task-rule', 'set-task-status', 'complete-task', 'set-skill-levels',
  'set-preference', 'set-profile', 'reset-task-rule', 'set-task-alternative', 'set-primary-override', 'set-rule-review', 'setup-start',
  'clear-backlog', 'clear-challenge-ticks', 'tick-active-tasks', 'add-task', 'update-task', 'delete-task', 'set-journal',
  'set-starting-chunk', 'random-start', 'set-section', 'set-area', 'set-source-backlog', 'set-teleport', 'delete-teleport',
  'set-teleport-override', 'set-transport-facts', 'set-boss-unlock', 'set-slayer-lock', 'set-obtained-equipment',
  'set-chunk-colour', 'rename-chunk-colour', 'set-sticker', 'add-sticker', 'update-sticker', 'remove-sticker', 'clear-stickers',
  'set-finish-line-item', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom',
  'set-xp-choices']);
const { datasetOptions, input } = workerData;
const definitions = prepareWorkerDefinitions(workerData.definitions, selectedDataset, workerData.preparedDatasetStages, datasetOptions);
const registry = createRuleRegistry();
const membersStartBanks = await datasetJSON('app/data/members-start-banks.2026-10-12.v1.json');
let engine;
const getEngine = () => engine ??= createTaskEngine(definitions, { dataset: selectedDataset, ...datasetOptions });
let world;
const getWorld = () => {
  if (!world) { world = buildWorld(definitions, { dataset: selectedDataset, ...datasetOptions }); configureAutomaticTransport(world, { definitions, engine: getEngine() }); }
  return world;
};
function evaluate(state, memberId) {
  const result = getEngine().evaluate(state, memberId);
  result.memberId = memberId; result.stateRevision = state.revision;
  const collection = createCollectionEngine(definitions, { dataset: selectedDataset }).evaluate(state, memberId, result);
  result.tasks.push(...collection.tasks);
  result.collectionPlanning = { completionGroups: collection.completionGroups, obligationIds: collection.obligationIds,
    diagnostics: collection.diagnostics, coverage: collection.coverage };
  result.diagnostics.push(...collection.diagnostics);
  const equipment = evaluateEquipment(result, state, memberId, definitions);
  result.presentation = selectCollectionGoals(selectPresentedTasks({ ...result, tasks: [...result.tasks, ...equipment.tasks] }, state, memberId, definitions), state, memberId);
  result.presentation.alternatives = { ...result.presentation.alternatives, ...equipment.alternatives };
  result.tasks = [...new Map([...result.tasks, ...equipment.catalogue].map(task => [task.id, task])).values()];
  result.equipmentPlanning = { obligationIds: equipment.tasks.map(task => task.id), loadouts: equipment.loadouts,
    recommendations: equipment.recommendations, specialist: equipment.specialist, diagnostics: equipment.diagnostics, coverage: equipment.coverage };
  result.currentBiS = buildCurrentBiS(result, equipment, state, memberId, definitions);
  result.activityInfo = buildActivityInfo(result, state, memberId, definitions);
  result.metrics.availableCount = result.tasks.filter(task => task.status === 'available' && task.obligation !== false).length;
  return result;
}
const stamp = { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest };
function readSave(backup) {
  const state = importBackup(backup, registry);
  if (state.members.length !== 1) throw new Error('solo');
  const saved = state.provenance?.dataset;
  if (!saved || saved.id !== stamp.id || saved.contractVersion !== stamp.contractVersion || saved.digest !== stamp.digest) throw new Error('dataset');
  return state;
}
try {
  let state;
  if (input.operation === 'new') {
    state = createGroupState([{ id: 'guest', name: 'Explorer' }], registry);
    state.provenance = { dataset: stamp };
  } else state = readSave(input.backup);
  const memberId = state.members[0].id;
  if (input.operation === 'roll-stats') {
    parentPort.postMessage({ rollStats: { ...computeRollStats(state), stateRevision: state.revision } });
  } else if (input.operation === 'xp-choices') {
    parentPort.postMessage({ xpChoices: { ...buildXpChoiceView(state, memberId, buildXpChoiceCatalogue(definitions, getEngine().catalogue)), stateRevision: state.revision } });
  } else if (input.operation === 'backlog-search') {
    const taskIds = Object.keys(state.members[0].taskStatus ?? {}).filter(id => state.members[0].taskStatus[id].backlogged);
    parentPort.postMessage({ backlog: { memberId, stateRevision: state.revision, tasks: backlogSearchTasks({
      definitions, catalogue: getEngine().catalogue, dynamicCatalogue: evaluate(state, memberId).tasks, registry: state.identityRegistry, taskIds,
    }) } });
  } else if (input.operation === 'map-info') {
    const [pins, edges] = await Promise.all([import('./data/map-pin-details.mjs'), import('./data/map-connections.mjs')]);
    parentPort.postMessage({ mapInfo: { schemaVersion: 1, pinDetails: pins.MAP_PIN_DETAILS,
      connections: edges.mapConnectionsPayload({ f2p: state.rules['content.f2p'] !== false }) } });
  } else if (input.operation === 'why-chain') {
    const selector = input.selector;
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)
      || Object.keys(selector).some(key => !['taskId', 'master', 'assignment'].includes(key))
      || Object.values(selector).some(value => typeof value !== 'string' || !value || value.length > 512)
      || (selector.taskId ? Object.keys(selector).length !== 1 : !selector.master || !selector.assignment)) throw new Error('selector');
    parentPort.postMessage({ chain: { ...buildWhyChain(evaluate(state, memberId), definitions, selector), memberId, stateRevision: state.revision } });
  } else if (input.operation === 'profile-preview') {
    parentPort.postMessage({ profile: { ...previewRuleProfile(state, input.profile, memberId, registry), stateRevision: state.revision } });
  } else if (input.operation === 'how') {
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 512) throw new Error('task');
    parentPort.postMessage({ how: getEngine().how(state, memberId, input.taskId, { context: { stateRevision: state.revision, memberId } }) });
  } else if (input.operation === 'tasks') {
    const result = evaluate(state, memberId);
    const presented = result.presentation;
    parentPort.postMessage({ tasks: presented.tasks.map(({ id, label, category, status, explanation, personalCompleted, challengeSatisfied }) =>
      ({ id, label, category, status, explanation, completed: personalCompleted || challengeSatisfied })), result });
  } else if (input.operation === 'why') {
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 512) throw new Error('task');
    parentPort.postMessage({ why: taskWhyDisplay(evaluate(state, memberId), input.taskId, memberId, state.revision) });
  } else if (input.operation === 'chunk-planning') {
    if (typeof input.chunkId !== 'string' || !/^\d{1,8}(?:-\d{1,4})?$/.test(input.chunkId)) throw new Error('chunk');
    const world = getWorld();
    if (!world.chunks.has(input.chunkId) && !world.areas?.has(input.chunkId)) throw new Error('chunk');
    const result = evaluate(state, memberId), index = buildChunkPlanningIndex(definitions, result, world);
    const rows = [...(index.byLocation.get(input.chunkId)?.values() ?? [])].map(({ task, evidence }) => ({
      task: { ...projectPlayTask(task, { retainHiddenDisplay: true }),
        ...(task.record?.ClueTier !== undefined ? { record: { ClueTier: task.record.ClueTier } } : {}) }, evidence }));
    parentPort.postMessage({ planning: { format: 'chunk-planning-v1', memberId, stateRevision: state.revision,
      chunkId: input.chunkId, rows, clueLocations: index.clueLocations.get(input.chunkId) ?? [], access: result.access } });
  } else if (input.operation === 'chunk-sections') {
    if (typeof input.chunkId !== 'string' || !/^\d{1,8}$/.test(input.chunkId)) throw new Error('chunk');
    parentPort.postMessage({ sections: chunkSectionsPayload(getWorld(), input.chunkId) });
  } else if (input.operation === 'predict') {
    if (typeof input.chunkId !== 'string' || !/^\d{1,8}$/.test(input.chunkId)) throw new Error('chunk');
    parentPort.postMessage({ prediction: { ...predictChunk(state, memberId, input.chunkId, { world: getWorld(), engine: getEngine(), registry }),
      memberId, stateRevision: state.revision } });
  } else if (input.operation === 'teleports') {
    const world = getWorld(), automatic = state.rules['travel.automatic'] === true;
    const travel = evaluateTransportRoutes(world, automatic ? state : { ...state, rules: { ...state.rules, 'travel.automatic': true } }, memberId);
    const rows = travel.map(row => projectTeleportRoute(row, world));
    parentPort.postMessage({ teleports: { stateRevision: state.revision, memberId, automatic, rows,
      personalTeleports: personalTeleportRows(world, state, memberId, automatic ? travel : []).map(({ id, available, reason }) => ({ id, available, reason })),
      counts: { usable: rows.filter(row => row.available).length, total: rows.length } } });
  } else {
    const world = getWorld();
    if (input.operation === 'command') {
      const command = input.command;
      if (!command || !allowedCommands.has(command.type) || command.memberId !== undefined && command.memberId !== memberId) throw new Error('command');
      // Task checks register the existing engine's canonical row in the save.
      const taskCatalogue = ['complete-task', 'set-task-status', 'tick-active-tasks', 'set-task-alternative', 'set-xp-choices'].includes(command.type)
        ? evaluate(state, memberId).tasks.map(row => Object.fromEntries(
          ['id', 'label', 'category', 'rawLabel', 'aliases', 'kind', 'objectiveKind', 'sourceId', 'itemId', 'completionIds']
            .filter(key => row[key] !== undefined).map(key => [key, row[key]]))) : undefined;
      const xpChoiceCatalogue = command.type === 'set-xp-choices' ? buildXpChoiceCatalogue(definitions, getEngine().catalogue) : undefined;
      state = applyCommand(state, command, { world, registry, taskCatalogue, xpChoiceCatalogue, membersStartBanks, expectedRevision: state.revision });
    }
    const pool = { ...evaluateRollPool(world, state, memberId, registry),
      partnerConnections: partnerConnections(world, state, memberId, registry) };
    const result = { backup: exportBackup(state, registry), pool };
    const latest = getUndoEligibility(state, undefined, { registry });
    result.coordination = { stateRevision: state.revision, history: [], ownUndo: null,
      latestUndo: { ...latest, event: state.history.find(event => event.revision === latest.undoRevision) ?? null } };
    if (input.operation === 'new' || input.operation === 'load') {
      result.chunks = [...world.chunks].flatMap(([id, record]) => {
        const position = surfaceCoordinates(id);
        return position ? [{ id, ...position, label: record.name ?? id }] : [];
      });
      result.rules = registry.definitions.map(({ candidates, exclude, ...metadata }) => metadata);
      result.settings = registry.resolve(state.rules);
      result.bootstrap = { definitions, world: projectDisplayWorld(world), membersStartBanks, rules: {
        definitions: result.rules, defaults: registry.defaults, cacheResources: selectedDataset.capabilities.cacheResources,
        cacheArchaeology: selectedDataset.capabilities.cacheArchaeology } };
    }
    parentPort.postMessage(result);
  }
} catch {
  // Never transport validation exceptions: they may contain submitted values.
  parentPort.postMessage({ error: 'The guest save or action could not be used. Choose a solo backup from this dataset, or reload and try again.' });
}
