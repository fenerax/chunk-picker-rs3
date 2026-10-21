import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataset } from '../app/datasets.mjs';
import { bindDatasetStorage } from '../app/dataset-binding.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, names = { '--data-dir': 'dataDir', '--packs-dir': 'packsDir', '--selection': 'selectionPath' };
  for (let index = 2; index < process.argv.length; index++) {
    const name = names[process.argv[index]];
    if (!name || !process.argv[index + 1]) throw new TypeError('Use --data-dir, with optional --packs-dir and --selection.');
    options[name] = process.argv[++index];
  }
  if (!options.dataDir) throw new TypeError('Choose a storage directory with --data-dir.');
  const dataset = await resolveDataset(options);
  await bindDatasetStorage(options.dataDir, dataset);
  console.log(`Storage bound to ${dataset.id}, contract ${dataset.contractVersion}, digest ${dataset.digest}. Save files unchanged.`);
}
