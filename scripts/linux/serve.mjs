import { openApplication, operatorSettings, readRelease } from './runtime.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { noLinks } from './files.mjs';

try {
  const settings = await operatorSettings();
  const release = await readRelease(settings.current, settings.dataDir);
  for (const file of [path.join(settings.dataDir, 'state.json'), path.join(settings.dataDir, 'access-token'), settings.dataDir + '.dataset.json']) {
    await noLinks(file);
    if (!(await readFile(file)).length) throw new Error('Existing complete bound store required.');
  }
  let app, stopping = false;
  const stop = async () => { stopping = true; if (app) await app.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  app = await openApplication(release.config, settings.dataDir);
  if (stopping) await app.close();
  else { await app.ready; process.stdout.write('Picker ready.\n'); }
} catch { process.stderr.write('Picker startup refused.\n'); process.exitCode = 1; }
