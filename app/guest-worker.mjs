// This worker has no store, registry, sidecar, integration or telemetry owner.
import { parentPort, workerData } from 'node:worker_threads';
import { createGroupState, applyCommand, exportBackup, importBackup } from './core/state.mjs';
import { createRuleRegistry, evaluateRollPool } from './core/rules.mjs';
import { buildWorld, surfaceCoordinates } from './data/world.mjs';
import { createTaskEngine } from './tasks/engine.mjs';
import { selectPresentedTasks } from './tasks/presentation.mjs';
import { selectedDataset } from './dataset-runtime.mjs';
import { assertWorkerHeapLimit } from './tasks/worker-limits.mjs';
import { prepareWorkerDefinitions } from './dataset-pipeline.mjs';

assertWorkerHeapLimit();
const allowedCommands = new Set(['set-chunk', 'set-note', 'roll', 'unlock-selection', 'pick-for-me',
  'unlock-both', 'cancel-roll', 'undo', 'set-rule', 'set-task-rule', 'set-task-status', 'complete-task', 'set-skill-levels']);
const { datasetOptions, input } = workerData;
const definitions = prepareWorkerDefinitions(workerData.definitions, selectedDataset, workerData.preparedDatasetStages, datasetOptions);
const registry = createRuleRegistry();
let engine;
const getEngine = () => engine ??= createTaskEngine(definitions, { dataset: selectedDataset, ...datasetOptions });
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
  if (input.operation === 'how') {
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 512) throw new Error('task');
    parentPort.postMessage({ how: getEngine().how(state, memberId, input.taskId) });
  } else if (input.operation === 'tasks') {
    const result = getEngine().evaluate(state, memberId);
    const presented = selectPresentedTasks(result, state, memberId, definitions);
    parentPort.postMessage({ tasks: presented.tasks.map(({ id, label, category, status, explanation, personalCompleted, challengeSatisfied }) =>
      ({ id, label, category, status, explanation, completed: personalCompleted || challengeSatisfied })) });
  } else {
    const world = buildWorld(definitions, { dataset: selectedDataset, ...datasetOptions });
    if (input.operation === 'command') {
      const command = input.command;
      if (!command || !allowedCommands.has(command.type) || command.memberId !== undefined && command.memberId !== memberId) throw new Error('command');
      // Task checks register the existing engine's canonical row in the save.
      const taskCatalogue = ['complete-task', 'set-task-status'].includes(command.type)
        ? getEngine().catalogue.map(({ level, ...row }) => row) : undefined;
      state = applyCommand(state, command, { world, registry, taskCatalogue, expectedRevision: state.revision });
    }
    const pool = evaluateRollPool(world, state, memberId, registry);
    const result = { backup: exportBackup(state, registry), pool };
    if (input.operation === 'new' || input.operation === 'load') {
      result.chunks = [...world.chunks].flatMap(([id, record]) => {
        const position = surfaceCoordinates(id);
        return position ? [{ id, ...position, label: record.name ?? id }] : [];
      });
      result.rules = registry.definitions.map(({ candidates, exclude, ...metadata }) => metadata);
      result.settings = registry.resolve(state.rules);
    }
    parentPort.postMessage(result);
  }
} catch {
  // Never transport validation exceptions: they may contain submitted values.
  parentPort.postMessage({ error: 'The guest save or action could not be used. Choose a solo backup from this dataset, or reload and try again.' });
}
