// Isolated imports keep local/private RS3 environment and module caches out.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Startup diagnostics can include invite credentials. Only the parent summary is public.
console.log = console.info = console.warn = console.error = () => {};
const [command, input] = process.argv.slice(2);
const load = file => import(pathToFileURL(file).href);
try {
  if (command === 'build') {
    const core = path.join(input, 'core');
    const { buildDatasetProfile } = await load(path.join(core, 'scripts/build-dataset-profile.mjs'));
    const { buildPrivateAddon } = await load(path.join(core, 'scripts/build-private-addon.mjs'));
    await buildDatasetProfile({ sourceRoot: core, packsDir: path.join(input, 'packs'), output: path.join(input, 'profile.json') });
    await buildPrivateAddon({ sourceRoot: core, output: path.join(input, 'addons') });
  } else if (command === 'seed') {
    const config = JSON.parse(await readFile(input, 'utf8'));
    const { createServer } = await load(path.join(config.coreRoot, 'app/server.mjs'));
    // The same two-chunk synthetic definitions used by release-early's copied
    // startup. No imported save, fixture member identity, or gameplay is read.
    const app = await createServer({ dataDir: config.dataDir, host: '127.0.0.1', port: config.port,
      loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false,
      definitions: { chunks: { 12341: {}, 12342: {} }, challenges: {}, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] }, taskMap: {} });
    await app.close();
  } else throw Error('Runtime command refused.');
} catch { process.exitCode = 1; }
