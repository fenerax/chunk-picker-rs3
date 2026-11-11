import { prepareOwnedServingRelease } from '../../app/storage/owned-serving.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { fixtureMigration } from '../../scripts/perf/capacity/fixture-migration.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { catalogue } from '../../scripts/perf/capacity/model.mjs';
export async function releaseFixture() {
  const definitions = catalogue({ chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1, aliases: 100 });
  const inputs = { definitions, taskMap: {}, taskMapHistory: {}, catalogue: createTaskEngine(definitions).catalogue, dynamicCatalogue: [] };
  const { migrateState } = fixtureMigration(inputs, selectedDataset);
  const release = await prepareOwnedServingRelease({ dataset: selectedDataset, migrateState });
  return { release, inputs, migrateState };
}
