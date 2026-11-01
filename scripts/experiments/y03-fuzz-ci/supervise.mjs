// Independent outer watchdog. Children share one owned process group. A CI
// container additionally disposes of the tree if this supervisor gets SIGKILL.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';
import { publicEnvironment, requireNode, hash } from './semantic.mjs';
import { validateReport } from './validate-report.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export function killGroup(pid, signal = 'SIGKILL') {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
export async function cleanupOwned(out) {
  let owned;
  try { owned = JSON.parse(await readFile(path.join(out, 'owned.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const scratch = path.join(path.resolve(out), 'owned');
  if (owned.scratch !== scratch || !Array.isArray(owned.worktrees)
    || owned.worktrees.some(root => !['reference', 'candidate'].some(name => root === path.join(scratch, name)))) throw Error('Invalid owned paths');
  for (const root of owned.worktrees.reverse()) {
    if (existsSync(root)) execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', root], { stdio: 'pipe', timeout: 10000 });
  }
  await rm(scratch, { recursive: true, force: true });
}
async function main() {
  requireNode(); publicEnvironment();
  const { values: opts, tokens } = parseArgs({ tokens: true, options: Object.fromEntries([
    'out', 'profile', 'reference-ref', 'candidate-ref', 'outer-ms', 'fault', 'cases', 'request-ms', 'shrink-attempts', 'wall-ms', 'rss-mib', 'replay',
  ].map(name => [name, { type: 'string' }])) });
  const out = path.resolve(opts.out), campaign = path.join(out, 'campaign');
  const outerMs = Number(opts['outer-ms'] ?? (opts.profile === 'deep' ? 720000 : 180000));
  if (!Number.isSafeInteger(outerMs) || outerMs < 50 || outerMs > 720000) throw Error('Invalid outer budget');
  const began = performance.now();
  await mkdir(out);
  const log = openSync(path.join(out, 'campaign.log'), 'wx');
  const args = tokens.filter(token => !['out', 'outer-ms'].includes(token.name)).flatMap(token => ['--' + token.name, token.value]);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url)), '--out', campaign, ...args], {
    detached: true, cwd: ROOT, stdio: ['ignore', log, log],
  });
  closeSync(log);
  const record = { pid: child.pid, processGroup: child.pid, outerMs, complete: false };
  await writeFile(path.join(out, 'supervisor.json'), JSON.stringify(record) + '\n');
  let interrupted;
  const abort = signal => { interrupted ??= signal; killGroup(child.pid); };
  const term = () => abort('SIGTERM'), int = () => abort('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', int);
  const timer = setTimeout(() => abort('deadline'), outerMs);
  let exitCode = 14;
  try {
    const [code, signal] = await once(child, 'close');
    record.coordinatorDurationMs = performance.now() - began;
    exitCode = interrupted === 'deadline' ? 124 : interrupted ? 143 : code ?? 128;
    Object.assign(record, { childExit: code, signal, interrupted: interrupted ?? null, exitCode });
    // Only ordinary smoke/deep campaigns use the strict acceptance gate. Fault
    // probes deliberately fail; their integration tests inspect the reports.
    if (exitCode === 0) {
      const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
      const report = JSON.parse(await readFile(path.join(campaign, 'report.json'), 'utf8'));
      validateReport(report, { harnessCommit: git('rev-parse', 'HEAD'),
        commits: [opts['reference-ref'], opts['candidate-ref']].map(ref => git('rev-parse', '--verify', `${ref}^{commit}`)),
        profile: opts.profile ?? 'smoke', coordinatorDurationMs: record.coordinatorDurationMs, adapterSHA256: hash(await readFile(new URL('./bridge.mjs', import.meta.url), 'utf8')) });
      record.complete = true;
    }
  } catch (error) { record.error = error.message; exitCode = error.exitCode ?? 14; }
  finally {
    clearTimeout(timer);
    killGroup(child.pid); // Includes any surviving bridge after coordinator exit.
    try { await cleanupOwned(campaign); }
    catch (error) { record.cleanupError = error.message; exitCode = 14; record.complete = false; }
    process.off('SIGTERM', term); process.off('SIGINT', int);
    record.exitCode = exitCode;
    await writeFile(path.join(out, 'supervisor.json'), JSON.stringify(record, null, 2) + '\n');
  }
  process.exitCode = exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 14; });
