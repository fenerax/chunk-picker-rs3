// Runs on a disposable store copy in a child process. Portable recovery has no
// listener; compatibility serves tasks on the pack check's loopback scratch port.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openApplication, runtimeEnvironment } from './runtime.mjs';
import { probe as packProbe } from '../private-companion/release-pack-check.mjs';
import { encode, json } from './files.mjs';

export async function probe(config, dataDir, output) {
  const app = await openApplication(config, dataDir, { probe: true });
  try {
    const document = await app.store.backup();
    const { importBackup } = await import(pathToFileURL(path.join(config.coreRoot, 'app/core/state.mjs')).href);
    importBackup(document);
    if (document.format !== 'rs3-chunk-picker' || !document.state?.members?.length) throw new Error('Full portable backup required.');
    await writeFile(output, encode(document), { flag: 'wx', mode: 0o600 });
  } finally { await app.close(); }
}
export async function compatibilityProbe(config, dataDir, output) {
  const environment = runtimeEnvironment(config, { probe: true });
  for (const key of Object.keys(process.env)) if (/^RS3_|^NODE_(?:OPTIONS|PATH)$/.test(key)) delete process.env[key];
  Object.assign(process.env, environment);
  // Exercise the same retention settings as the deployed writer.
  const retention = Object.fromEntries(Object.entries({ backupDays: config.runtimeOptions?.backupDays,
    historyEntries: config.runtimeOptions?.historyEntries }).filter(([, value]) => value != null));
  await packProbe(config.coreRoot, dataDir, output, { retention });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [configFile, dataDir, output, mode = 'portable'] = process.argv.slice(2);
    await readFile(path.join(dataDir, 'state.json')); // Never initialize an empty store.
    if (!['portable', 'compatibility'].includes(mode)) throw new Error('Unknown recovery probe.');
    await (mode === 'compatibility' ? compatibilityProbe : probe)(await json(configFile), dataDir, output);
  } catch { process.stderr.write('Recovery probe refused.\n'); process.exitCode = 1; }
}
