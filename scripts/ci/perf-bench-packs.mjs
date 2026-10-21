// Fetch the same verified packs as test.yml, explicitly from the public repo.
// Child environment assignment avoids relying on overriding a GitHub default env.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [checkout, destination] = process.argv.slice(2);
if (!checkout || !destination) throw Error('Usage: perf-bench-packs.mjs <checkout> <packs work dir>');
const result = spawnSync(process.execPath, [path.join(root, '.github/packs/fetch-packs.mjs'), checkout, destination], {
  env: { ...process.env, GITHUB_REPOSITORY: 'fenerax/chunk-picker-rs3' }, stdio: 'inherit', windowsHide: true,
});
if (result.error || result.status !== 0) process.exitCode = 1;
