// Runs on a disposable store copy in a child process, without a listener.
// The selected release's own decoder validates its portable export.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openApplication } from './runtime.mjs';
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [configFile, dataDir, output] = process.argv.slice(2);
    await readFile(path.join(dataDir, 'state.json')); // Never initialize an empty store.
    await probe(await json(configFile), dataDir, output);
  } catch { process.stderr.write('Recovery probe refused.\n'); process.exitCode = 1; }
}
