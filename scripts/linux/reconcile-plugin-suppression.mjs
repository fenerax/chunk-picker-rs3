import { isMain } from '../release/vps/entrypoint.mjs';
import path from 'node:path';
import { noLinks } from './files.mjs';
import { reconcileStoppedPluginSuppression } from '../../app/storage/store.mjs';

export async function reconcileForRollback(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new TypeError('An absolute stopped-store directory is required.');
  await noLinks(dataDir);
  await reconcileStoppedPluginSuppression({ dataDir });
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('A stopped-store directory is required.');
    await reconcileForRollback(process.argv[2]);
    process.stdout.write('Plugin replay suppression reconciled for rollback.\n');
  } catch {
    process.stderr.write('Rollback refused: plugin replay suppression reconciliation failed. Keep the writer stopped.\n');
    process.exitCode = 1;
  }
}
