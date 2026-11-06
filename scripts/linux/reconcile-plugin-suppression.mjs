import { isMain } from '../release/vps/entrypoint.mjs';
import path from 'node:path';
import { noLinks, exists, json } from './files.mjs';
import { reconcileStoppedPluginSuppression } from '../../app/storage/store.mjs';
import { registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { pickerPath } from './service-checkpoint.mjs';

export async function reconcileForRollback(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new TypeError('An absolute stopped-store directory is required.');
  await noLinks(dataDir);
  await reconcileStoppedPluginSuppression({ dataDir });
}

export async function reconcileBeforeStart({ settings, assertStopped }) {
  try {
    await assertStopped();
    const directories = new Set();
    if (!settings.multiPicker) directories.add(settings.dataDir);
    else {
      const file = path.join(settings.multiPicker.registryDir, 'registry.json');
      await noLinks(file);
      const document = registryRecoveryDocument(await json(file));
      if (await exists(path.join(settings.dataDir, 'state.json'))) directories.add(settings.dataDir);
      for (const picker of document.pickers.filter(p => p.lifecycle === 'active')) {
        const dataDir = pickerPath(settings, picker);
        if (picker.provisioning === 'reserved' && !await exists(path.join(dataDir, 'state.json'))) continue;
        directories.add(dataDir);
      }
    }
    for (const dataDir of directories) await reconcileForRollback(dataDir);
    await assertStopped();
  } catch (cause) {
    throw Object.assign(new Error('Plugin replay reconciliation failed; keep the runtime stopped.', { cause }), { code: 'PLUGIN_RECONCILIATION_FAILED' });
  }
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
