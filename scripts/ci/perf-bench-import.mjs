// One isolated app module graph per import, with errors deliberately redacted.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readdir, mkdir, readFile } from 'node:fs/promises';
import { safeDiagnostic, DIAGNOSTIC_PREFIX } from '../perf/diagnostics.mjs';

export async function prepareImport({ checkout, save, dataDir, datasetId = process.env.RS3_DATASET }, { load = url => import(url), read = readFile } = {}) {
  const options = { dataDir, host: '127.0.0.1', port: 8968,
    loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false };
  if (datasetId === 'open-f2p') {
    // Starter datasets expose backup restoration through importBackup rather than
    // the legacy original-sync startup flag. This path is for tiny smoke inputs.
    const { importBackup } = await load(pathToFileURL(path.join(checkout, 'app/core/state.mjs')).href);
    options.initialState = importBackup(JSON.parse(await read(save, 'utf8')));
  } else options.initialImport = save;
  return options;
}

async function main() {
  let app;
  try {
    const [checkout, save, dataDir] = process.argv.slice(2);
    if (!checkout || !save || !dataDir) throw Error('Missing import arguments.');
    await mkdir(dataDir, { recursive: true });
    if ((await readdir(dataDir)).length) throw Error('Import destination is not empty.');
    for (const key of ['RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
    const { createServer } = await import(pathToFileURL(path.join(checkout, 'app/server.mjs')).href);
    app = await createServer(await prepareImport({ checkout, save, dataDir }));
    await app.close();
  } catch (error) {
    await app?.close().catch(() => {});
    console.error(DIAGNOSTIC_PREFIX + JSON.stringify(safeDiagnostic(error, { stage: 'import' }))); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
