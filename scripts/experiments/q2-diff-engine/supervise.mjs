// Independent wall/RSS watchdog for the entire owned process group, including harvest.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { openSync, closeSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { requireNode, publicEnvironment } from '../y03-fuzz-ci/semantic.mjs';
import { killGroup } from '../y03-fuzz-ci/supervise.mjs';
import { cleanupOwned } from './cleanup.mjs';
import { budget } from './run.mjs';
import { validateEngineReport } from './inputs.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export function groupRSS(group) {
  let total = 0;
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      if (Number(fields[2]) === group) total += Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
  return total;
}
export async function supervise({ argv = process.argv.slice(2), clock = { setTimeout, clearTimeout, setInterval, clearInterval },
  execute = spawn, signals = process, environment = process.env, memory = groupRSS, stopGroup = killGroup, checkRuntime = requireNode } = {}) {
  checkRuntime(); publicEnvironment(environment);
  const { values: opts, tokens } = parseArgs({ args: argv, tokens: true, options: Object.fromEntries([
    'out', 'reference-ref', 'candidate-ref', 'candidate-patch', 'cases', 'request-ms', 'wall-ms', 'rss-mib', 'outer-ms', 'tree-rss-mib',
  ].map(name => [name, { type: 'string' }])) });
  if (!opts.out) throw Error('--out required');
  const outerMs = budget(opts['outer-ms'], 900000, 50, 900000), rssBytes = budget(opts['tree-rss-mib'], 2048, 1, 16384) * 1024 ** 2;
  const out = path.resolve(opts.out), campaign = path.join(out, 'campaign'), began = performance.now();
  await mkdir(out);
  const log = openSync(path.join(out, 'campaign.log'), 'wx');
  const args = tokens.filter(token => !['out', 'outer-ms', 'tree-rss-mib'].includes(token.name)).flatMap(token => ['--' + token.name, token.value]);
  const child = execute(process.execPath, ['--max-old-space-size=512', fileURLToPath(new URL('./run.mjs', import.meta.url)), '--out', campaign, ...args],
    { detached: true, cwd: ROOT, stdio: ['ignore', log, log], env: environment });
  closeSync(log);
  const record = { format: 'q2-supervisor-v1', processGroup: child.pid, outerMs, rssBytes, sampledTreePeakRSSBytes: 0, complete: false };
  await writeFile(path.join(out, 'supervisor.json'), JSON.stringify(record));
  let interrupted, monitorError;
  const abort = reason => { interrupted ??= reason; stopGroup(child.pid); };
  const term = () => abort('SIGTERM'), int = () => abort('SIGINT');
  signals.on('SIGTERM', term); signals.on('SIGINT', int);
  const timer = clock.setTimeout(() => abort('deadline'), outerMs);
  const monitor = clock.setInterval(() => {
    try {
      const bytes = memory(child.pid); record.sampledTreePeakRSSBytes = Math.max(record.sampledTreePeakRSSBytes, bytes);
      if (bytes > rssBytes) abort('memory');
    } catch (error) { monitorError = error.message; abort('monitor'); }
  }, 50);
  try {
    const [code, signal] = await once(child, 'close');
    record.childExit = code; record.signal = signal; record.interrupted = interrupted ?? null;
    record.exitCode = interrupted === 'deadline' ? 124 : interrupted === 'memory' ? 13 : interrupted === 'monitor' ? 14 : interrupted ? 143 : code ?? 128;
    if (monitorError) record.monitorError = monitorError;
    if (record.exitCode === 0) {
      const report = JSON.parse(await readFile(path.join(campaign, 'report.json'), 'utf8'));
      validateEngineReport(report); record.complete = true;
    }
  } catch (error) { record.exitCode = 14; record.error = error.message; }
  finally {
    clock.clearTimeout(timer); clock.clearInterval(monitor); stopGroup(child.pid);
    try { await cleanupOwned(campaign); }
    catch (error) { record.exitCode = 14; record.complete = false; record.cleanupError = error.message; }
    signals.off('SIGTERM', term); signals.off('SIGINT', int);
    record.durationMs = performance.now() - began;
    await writeFile(path.join(out, 'supervisor.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify({ out, ...record })); return record.exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) supervise().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 14; });
