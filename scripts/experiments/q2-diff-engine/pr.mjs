// PR entrypoint. The caller must already have both histories locally.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { validateEngineReport, MIN_HARVEST_PAIRS, MIN_HARVEST_RESULTS } from './inputs.mjs';
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
// Keep the uploaded artifact compact: no result values or captured states.
export function prReport({ reference = null, candidate = null, relevant = null, report, supervisor, exitCode = 0, durationMs, failure = null }) {
  if (relevant !== false && exitCode === 0) {
    validateEngineReport(report);
    if (supervisor?.complete !== true || supervisor.exitCode !== 0) throw Error('Incomplete engine differential supervisor');
  }
  return { format: 'q2-pr-diff-v1', status: exitCode !== 0 ? 'failed' : relevant === false ? 'not relevant' : 'passed',
    reference, candidate, exitCode, pairsCompared: report?.requestPairs ?? 0, differences: report?.differences ?? 0,
    resultPairs: report?.resultPairs ?? 0, errorPairs: report?.errorPairs ?? 0,
    harvestPairs: report?.sources?.harvest ?? 0, harvestResults: report?.successfulSources?.harvest ?? 0,
    floors: { pairs: MIN_HARVEST_PAIRS, results: MIN_HARVEST_RESULTS },
    firstDifference: report?.firstDifference ? { requestType: report.firstDifference.requestType, path: report.firstDifference.path } : null,
    durationMs, sampledTreePeakRSSBytes: supervisor?.sampledTreePeakRSSBytes ?? 0,
    failure: failure ?? report?.failure?.kind ?? supervisor?.interrupted ?? supervisor?.error ?? supervisor?.cleanupError ?? null };
}
export function prSummary(report) {
  return `### Q2 engine differential: ${report.status}\n\n`
    + (report.status === 'not relevant' ? 'Not relevant: no calculator input or code paths changed.\n\n' : '')
    + `Reference (merge base): \`${report.reference}\`\n\nPR head: \`${report.candidate}\`\n\n`
    + `Pairs compared: ${report.pairsCompared}; differences: ${report.differences}.\n\n`
    + `Harvest: ${report.harvestPairs} pairs (minimum ${report.floors.pairs}), ${report.harvestResults} results (minimum ${report.floors.results}).\n\n`
    + (report.firstDifference ? `First difference: \`${report.firstDifference.requestType}\`, \`${report.firstDifference.path}\`.\n\n` : '')
    + (report.failure ? `Failure: ${report.failure.replaceAll('`', '').replaceAll('\\n', ' ')}\n\n` : '')
    + `Exit: ${report.exitCode}; wall: ${Math.round(report.durationMs)} ms; peak group RSS: ${report.sampledTreePeakRSSBytes} bytes.\n`;
}
async function main() {
  requireNode(); publicEnvironment();
  const { values: opts, tokens } = parseArgs({ tokens: true, options: Object.fromEntries([
    'base-ref', 'head-ref', 'out', 'cases', 'request-ms', 'wall-ms', 'rss-mib', 'outer-ms', 'tree-rss-mib',
  ].map(name => [name, { type: 'string' }])) });
  if (!opts['base-ref'] || !opts.out) throw Error('--base-ref and --out required; both histories must be present (no fetch is performed)');
  const began = performance.now(), out = path.resolve(opts.out);
  await mkdir(out); // Refuse stale output, including an earlier attempt's report.
  const context = { exitCode: 14 };
  try {
    const git = async (...args) => (await execute('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 ** 2 })).stdout.trim();
    const base = await git('rev-parse', '--verify', `${opts['base-ref']}^{commit}`), head = await git('rev-parse', '--verify', `${opts['head-ref'] ?? 'HEAD'}^{commit}`);
    const reference = await git('merge-base', base, head), files = (await git('diff', '--name-only', reference, head)).split('\n');
    Object.assign(context, { reference, candidate: head });
    const show = ref => async file => { try { return await git('show', `${ref}:${file}`); } catch { return undefined; } };
    const closure = new Set([...await importClosure(show(reference), CALCULATOR_ROOTS), ...await importClosure(show(head), CALCULATOR_ROOTS)]);
    context.relevant = calculatorChanged(files, closure);
    if (!context.relevant) context.exitCode = 0;
    else {
      const args = tokens.filter(token => !['base-ref', 'head-ref', 'out'].includes(token.name)).flatMap(token => ['--' + token.name, token.value]);
      const comparison = path.join(out, 'comparison');
      const child = spawn(process.execPath, [fileURLToPath(new URL('./supervise.mjs', import.meta.url)), '--reference-ref', reference,
        '--candidate-ref', head, '--out', comparison, ...args], { cwd: ROOT, stdio: 'inherit' });
      const term = () => child.kill('SIGTERM'), int = () => child.kill('SIGINT');
      process.on('SIGTERM', term); process.on('SIGINT', int);
      try { const [code] = await once(child, 'close'); context.exitCode = code ?? 128; }
      finally { process.off('SIGTERM', term); process.off('SIGINT', int); }
      const read = async file => {
        try { return JSON.parse(await readFile(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
      context.report = await read(path.join(comparison, 'campaign/report.json'));
      context.supervisor = await read(path.join(comparison, 'supervisor.json'));
    }
    // Revalidate independently, including both harvest floors, before success.
    prReport({ ...context, durationMs: performance.now() - began });
  } catch (error) { context.exitCode = 14; context.failure = error.message; }
  const report = prReport({ ...context, durationMs: performance.now() - began });
  const summary = prSummary(report);
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(out, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify(report)); process.exitCode = report.exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 14; });
