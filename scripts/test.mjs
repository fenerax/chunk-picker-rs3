import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverTests, concurrencyFor } from './test-selection.mjs';

const suite = process.argv[2] ?? 'full';
const environment = { ...process.env, RS3_DATASET: 'open-f2p' };
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR',
  'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete environment[key];
const options = process.argv.slice(3);
if (options.some(option => option !== '--list')) throw new Error('Only --list is supported');
const files = await discoverTests(undefined, suite);
console.log(`${suite}: ${files.length} test files`);
if (options.includes('--list')) {
  console.log(files.map(name => `tests/${name}`).join('\n'));
} else {
  const concurrency = concurrencyFor(suite);
  const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files.map(name => `tests/${name}`)], {
    env: environment,
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', windowsHide: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
