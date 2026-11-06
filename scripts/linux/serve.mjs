import { openApplication, operatorSettings, readRelease, assertOperatorService } from './runtime.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { noLinks, assertReleased } from './files.mjs';
import { reconcileBeforeStart } from './reconcile-plugin-suppression.mjs';

try {
  const settings = await operatorSettings();
  const release = await readRelease(settings.current, settings.dataDir);
  assertOperatorService(settings, release);
  for (const file of [path.join(settings.dataDir, 'state.json'), ...(!settings.multiPicker ? [path.join(settings.dataDir, 'access-token')] : []), settings.dataDir + '.dataset.json']) {
    await noLinks(file);
    if (!(await readFile(file)).length) throw new Error('Existing complete bound store required.');
  }
  let app, stopping = false;
  const stop = async () => { stopping = true; if (app) await app.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // Run the installed current tools against real stores before loading even a
  // frozen runtime. Compatibility probes on disposable copies cannot do this.
  await reconcileBeforeStart({ settings, assertStopped: () => assertReleased(settings.dataDir) });
  app = await openApplication(release.config, settings.dataDir);
  if (stopping) await app.close();
  else { await app.ready; process.stdout.write('Picker ready.\n'); }
} catch { process.stderr.write('Picker startup refused.\n'); process.exitCode = 1; }
