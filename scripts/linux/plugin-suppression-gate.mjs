import path from 'node:path';
import { noLinks, exists, json, assertReleased } from './files.mjs';
import { prepareStoppedPluginSuppression } from '../../app/storage/plugin-replay-checkpoint.mjs';
import { publishPluginHandledSidecars } from '../../app/storage/plugin-handled-sidecars.mjs';
import { registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { pickerPath } from './service-checkpoint.mjs';

export async function reconcileBeforeStart(settings) {
  const prepared = [];
  try {
    const directories = new Set();
    if (!settings.multiPicker) directories.add(settings.dataDir);
    else {
      const file = path.join(settings.multiPicker.registryDir, 'registry.json');
      await noLinks(file);
      const document = registryRecoveryDocument(await json(file));
      directories.add(settings.dataDir);
      for (const picker of document.pickers.filter(p => p.lifecycle === 'active')) {
        const dataDir = pickerPath(settings, picker);
        directories.add(dataDir);
      }
    }
    // Validate every store before publishing any sidecar. A later invalid
    // picker must not leave earlier pickers changed on a refused start.
    for (const dataDir of directories) {
      if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new TypeError('An absolute stopped-store directory is required.');
      await noLinks(await exists(dataDir) ? dataDir : path.dirname(dataDir));
      await assertReleased(dataDir);
      // Fresh stores need no checkpoint. The replay-specific reader also
      // accepts unrelated/empty checkpoint shapes, while refusing real orphaned
      // decisions or evidence that cannot be reconciled with its roster.
      if (!await exists(dataDir)) continue;
      prepared.push(await prepareStoppedPluginSuppression({ dataDir }));
    }
    await publishPluginHandledSidecars(prepared.flatMap(entry => entry.publications));
  } catch (cause) {
    throw Object.assign(new Error('Plugin replay reconciliation failed; keep the runtime stopped.', { cause }), { code: 'PLUGIN_RECONCILIATION_FAILED' });
  } finally { for (const entry of prepared.reverse()) await entry.release(); }
}
