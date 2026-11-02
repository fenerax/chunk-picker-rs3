// Opt-in PR entrypoint. The caller must already have both histories locally.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requireNode, publicEnvironment } from '../y03-fuzz-ci/semantic.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), execute = promisify(execFile);
// `closure` holds every app module reachable through relative imports from the
// calculator roots at either ref, so shared helpers outside these folders count.
export function calculatorChanged(files, closure = new Set()) {
  return files.some(file => ((/^app\/(?:tasks\/|core\/|training\/|data\/|datasets\/|dataset[^/]*\.mjs$|open-[^/]*\.mjs$|(?:sandbox|play-view|duo-play-view)\.mjs$)/.test(file)
    || /^reference\//.test(file) || closure.has(file))
    && !['app/data/changelog.json', 'app/data/roadmap.json'].includes(file)));
}
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
export async function importClosure(show, roots) {
  const seen = new Set(), queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const source = await show(file);
    if (source === undefined) continue;
    seen.add(file);
    for (const [, spec] of source.matchAll(IMPORT)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (target.startsWith('app/') && /\.(?:mjs|js|json)$/.test(target)) queue.push(target);
    }
  }
  return seen;
}
const CALCULATOR_ROOTS = ['app/tasks/worker.mjs', 'app/tasks/engine.mjs', 'app/tasks/calculator-pool.mjs', 'app/tasks/scheduler.mjs', 'app/tasks/process-worker.mjs'];
async function main() {
  requireNode(); publicEnvironment();
  const { values: opts, tokens } = parseArgs({ tokens: true, options: Object.fromEntries([
    'base-ref', 'head-ref', 'out', 'cases', 'request-ms', 'wall-ms', 'rss-mib', 'outer-ms', 'tree-rss-mib',
  ].map(name => [name, { type: 'string' }])) });
  if (!opts['base-ref'] || !opts.out) throw Error('--base-ref and --out required; both histories must be present (no fetch is performed)');
  const git = async (...args) => (await execute('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 ** 2 })).stdout.trim();
  const base = await git('rev-parse', '--verify', `${opts['base-ref']}^{commit}`), head = await git('rev-parse', '--verify', `${opts['head-ref'] ?? 'HEAD'}^{commit}`);
  const reference = await git('merge-base', base, head), files = (await git('diff', '--name-only', reference, head)).split('\n');
  const show = ref => async file => { try { return await git('show', `${ref}:${file}`); } catch { return undefined; } };
  const closure = new Set([...await importClosure(show(reference), CALCULATOR_ROOTS), ...await importClosure(show(head), CALCULATOR_ROOTS)]);
  if (!calculatorChanged(files, closure)) { console.log(JSON.stringify({ skipped: true, reason: 'No calculator input or code paths changed', reference, candidate: head })); return; }
  const args = tokens.filter(token => !['base-ref', 'head-ref', 'out'].includes(token.name)).flatMap(token => ['--' + token.name, token.value]);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./supervise.mjs', import.meta.url)), '--reference-ref', reference,
    '--candidate-ref', head, '--out', opts.out, ...args], { cwd: ROOT, stdio: 'inherit' });
  const term = () => child.kill('SIGTERM'), int = () => child.kill('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', int);
  try { const [code] = await once(child, 'close'); process.exitCode = code ?? 128; }
  finally { process.off('SIGTERM', term); process.off('SIGINT', int); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 14; });
