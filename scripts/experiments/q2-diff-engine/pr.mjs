// Opt-in PR entrypoint. The caller must already have both histories locally.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requireNode, publicEnvironment } from '../y03-fuzz-ci/semantic.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), execute = promisify(execFile);
export function calculatorChanged(files) {
  return files.some(file => /^app\/(?:tasks\/|core\/|training\/|data\/|datasets\/|dataset[^/]*\.mjs$|open-[^/]*\.mjs$|(?:sandbox|play-view|duo-play-view)\.mjs$)/.test(file)
    && !['app/data/changelog.json', 'app/data/roadmap.json'].includes(file));
}
async function main() {
  requireNode(); publicEnvironment();
  const { values: opts, tokens } = parseArgs({ tokens: true, options: Object.fromEntries([
    'base-ref', 'head-ref', 'out', 'cases', 'request-ms', 'wall-ms', 'rss-mib', 'outer-ms', 'tree-rss-mib',
  ].map(name => [name, { type: 'string' }])) });
  if (!opts['base-ref'] || !opts.out) throw Error('--base-ref and --out required; both histories must be present (no fetch is performed)');
  const git = async (...args) => (await execute('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000 })).stdout.trim();
  const base = await git('rev-parse', '--verify', `${opts['base-ref']}^{commit}`), head = await git('rev-parse', '--verify', `${opts['head-ref'] ?? 'HEAD'}^{commit}`);
  const reference = await git('merge-base', base, head), files = (await git('diff', '--name-only', reference, head)).split('\n');
  if (!calculatorChanged(files)) { console.log(JSON.stringify({ skipped: true, reason: 'No calculator input or code paths changed', reference, candidate: head })); return; }
  const args = tokens.filter(token => !['base-ref', 'head-ref', 'out'].includes(token.name)).flatMap(token => ['--' + token.name, token.value]);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./supervise.mjs', import.meta.url)), '--reference-ref', reference,
    '--candidate-ref', head, '--out', opts.out, ...args], { cwd: ROOT, stdio: 'inherit' });
  const term = () => child.kill('SIGTERM'), int = () => child.kill('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', int);
  try { const [code] = await once(child, 'close'); process.exitCode = code ?? 128; }
  finally { process.off('SIGTERM', term); process.off('SIGINT', int); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 14; });
