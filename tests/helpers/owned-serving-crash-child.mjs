import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { retainOwnedServingRelease, verifyOwnedServingConfiguration, selectOwnedServingPicker } from '../../app/storage/owned-serving.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
const [root, seam, failure] = process.argv.slice(2);
const crash = point => { if (point !== seam) return; if (failure === 'exit') process.exit(71); throw new Error('Synthetic seam interruption'); };
const release = JSON.parse(await readFile(path.join(root, 'seed.json')));
release.releaseBytes = Buffer.from(await readFile(path.join(root, 'seed-base.json')));
try {
  const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [path.join(root, 'group')], crash });
  if (seam === 'serving-pin-selected') {
    const verified = await verifyOwnedServingConfiguration({ ...config, crash }, { dataset: selectedDataset, deletionRoots: [path.join(root, 'group')] });
    await selectOwnedServingPicker(verified, 'synthetic-picker', path.join(root, 'group'));
  }
  process.exitCode = 73;
} catch (error) { if (error.message !== 'Synthetic seam interruption') throw error; process.exitCode = 72; }
