// Synthetic-only slice 7b. Full measurements are refused outside hosted CI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { constants, setPriority, cpus, hostname, platform, release, totalmem } from 'node:os';
import { parseArgs } from 'node:util';
import { MiB } from './owned-acceptance/metrics.mjs';
import { shapes, rounds, SEED } from './owned-acceptance/profile.mjs';
import { childProcesses, command, runTrial } from './owned-acceptance/processes.mjs';
import { lifecycleSummary, trialFailure } from './owned-acceptance/lifecycle.mjs';
import { compare, formats } from './owned-acceptance/comparison.mjs';
import { acceptanceScope, scopeDecision } from './owned-acceptance/scope.mjs';
export { shapes } from './owned-acceptance/profile.mjs';

const self = fileURLToPath(import.meta.url), repository = fileURLToPath(new URL('../../', import.meta.url));
export function summary(report) {
  if (report.selectedFormat) return [
    `${report.selectedFormat} ${report.smoke ? 'SMOKE ONLY' : 'MEASUREMENT ONLY'}; no acceptance claim until both formats are compared.`,
    `${report.results.length} completed trial(s); ${report.failures.length} failed process(es); see results.json.`,
    ...lifecycleSummary(report)].join('\n');
  const f2 = report.results.find(row => row.mode === 'format2');
  if (!f2 || report.failures.length) return [`INCOMPLETE ${report.smoke ? 'SMOKE' : 'ACCEPTANCE'}; no acceptance claim. ${report.failures.length} failed process(es); see results.json.`,
    ...lifecycleSummary(report)].join('\n');
  return [`${report.smoke ? 'SMOKE ONLY; no acceptance claim' : f2.decision.status}: ${f2.shape.groups} synthetic groups retained, seed ${report.seed}.`,
    `Format 2 max attributable group ${(f2.decision.perGroupBytes.max / MiB).toFixed(2)} MiB; peak post-GC group heap ${(f2.decision.maximumGroupHeapBytes / MiB).toFixed(2)} MiB.`,
    `Base writes after publication: ${f2.allPostPublicationIO.baseWrites}; command errors: ${f2.errors.length}.`,
    `Open wall p95 ${f2.times.open.wallMs.p95.toFixed(1)} ms; everyday p95 ${f2.speedBar.everyday.measured.wallMs.p95.toFixed(1)} ms; calculator p95 ${f2.times.calculator.wallMs.p95.toFixed(1)} ms (speed targets advisory).`,
    `Five fresh runs per OS are required; this file is one run. ${report.equivalent ? 'Format fixtures/final states match.' : 'Format comparison incomplete or different.'}`,
    ...(report.comparisonErrors ?? []), ...lifecycleSummary(report)].join('\n');
}

export async function comparison({ output, format, smoke = false, spotCheck = false, snapshots = false,
  scope = process.env.ACCEPTANCE_SCOPE ?? 'diagnostic', signal, onReady }) {
  signal?.throwIfAborted();
  acceptanceScope(scope);
  smoke ||= spotCheck;
  if (format !== undefined && !formats.includes(format)) throw new Error('Use --format format1 or --format format2.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 20) throw new Error('Use Node 24.20+ within 24.x.');
  if (!smoke && process.env.GITHUB_ACTIONS !== 'true') throw new Error('50-group measurements run only in hosted CI; locally run the smoke test.');
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'started.json'), JSON.stringify({ startedAt: new Date().toISOString() }), { flag: 'wx' });
  const report = { format: 'owned-acceptance-7b', schemaVersion: 1, smoke, snapshots, scope, spotCheck, selectedFormat: format ?? null,
    seed: SEED, memoryProfile: 'budget-672',
    commit: (await command('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', signal, windowsHide: true })).trim(),
    runtime: { node: process.versions.node, v8: process.versions.v8, arch: process.arch },
    host: { hostname: hostname(), os: platform(), release: release(), cpu: cpus()[0]?.model, cpuCount: cpus().length, ramBytes: totalmem() },
    ci: { run: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, freshRun: process.env.ACCEPTANCE_FRESH_RUN ?? null },
    results: [], failures: [], limitations: [
      'Synthetic topology, dependencies and alias distributions; no private saves or user traffic.',
      'Store/scheduler/session seams; no HTTP server, authentication, browser or plugin protocol.',
      'Both formats explicitly use the opt-in budget-672 cache profile; no group handle or session is evicted.',
      'Temporary heap peaks are sampled lower bounds plus process OS maxRSS high-water marks, not exact allocation maxima.',
      'Serial operation CPU includes probe overhead; simultaneous per-request CPU is null, with process-tree CPU reported for the batch.',
      'Heap deltas include all measured isolates and hidden WeakMap graphs; incremental attribution can include allocator/GC noise.',
    ] };
  for (const mode of format ? [format] : formats) {
    signal?.throwIfAborted();
    const modeDir = path.join(output, mode), probes = path.join(modeDir, 'probes');
    await mkdir(probes, { recursive: true });
    const root = await mkdtemp(path.join(modeDir, 'synthetic-stores-'));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RS3_') || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
    Object.assign(env, { ACCEPTANCE_SCOPE: scope, RS3_MEMORY_PROFILE: 'budget-672', RS3_DATASET: 'open-f2p', RS3_ACCEPTANCE_PROBE_DIR: probes, RS3_ACCEPTANCE_STORE_ROOT: root,
      RS3_WORKER_MEMORY_PROBE_IMPORT: new URL('./owned-acceptance/probe.mjs', import.meta.url).href });
    if (onReady) env.RS3_ACCEPTANCE_NOTIFY_READY = '1';
    try {
      const code = await runTrial(self, ['--child', mode, '--out', modeDir, '--root', root, ...(smoke ? ['--smoke'] : []),
        ...(spotCheck ? ['--spot-check'] : []), ...(snapshots ? ['--snapshots'] : [])],
          { cwd: repository, env, execArgv: ['--expose-gc', '--import', env.RS3_WORKER_MEMORY_PROBE_IMPORT],
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true }, { signal, onReady });
      const result = JSON.parse(await readFile(path.join(modeDir, 'result.json'), 'utf8'));
      report.results.push(result);
      if (code !== 0) throw new Error(`${mode} process failed.`);
      if (snapshots && mode === 'format2') {
        const { attributeSnapshots } = await import('./owned-acceptance/attribution.mjs');
        (report.snapshotAttribution ??= {})[mode] = await attributeSnapshots(result, modeDir);
      }
    } catch (error) {
      signal?.throwIfAborted();
      let failure = trialFailure(mode, error);
      try { failure = JSON.parse(await readFile(path.join(modeDir, 'failure.json'), 'utf8')); }
      catch (cause) { if (cause.code !== 'ENOENT') failure.evidenceError = cause.message; }
      report.failures.push(failure);
    } finally {
      // Exact mkdtemp-owned directory only; no input paths or links are accepted.
      await rm(root, { recursive: true, force: true });
    }
  }
  if (format) report.equivalent = false;
  else compare(report);
  report.summary = summary(report);
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  await writeFile(path.join(output, 'summary.txt'), report.summary + '\n', { flag: 'wx' });
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, root: { type: 'string' }, child: { type: 'string' },
    format: { type: 'string' },
    smoke: { type: 'boolean', default: false }, 'spot-check': { type: 'boolean', default: false }, snapshots: { type: 'boolean', default: false } } });
  if (values['spot-check']) values.smoke = true;
  if (!values.out) throw new Error('--out is required; there is no input/save option.');
  if (values.child) {
    if (!['format1', 'format2'].includes(values.child) || !values.root || (!values.smoke && process.env.GITHUB_ACTIONS !== 'true')) throw new Error('Invalid internal trial.');
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
    const controller = new AbortController(), processes = childProcesses(controller.signal);
    const abort = () => controller.abort();
    const message = input => { if (input?.kind === 'acceptance-abort') abort(); };
    process.on('message', message); process.once('disconnect', abort);
    try {
      const { trial } = await import('./owned-acceptance/trial.mjs');
      const profile = values['spot-check'] ? 'spotCheck' : values.smoke ? 'smoke' : 'acceptance';
      const result = await trial({ root: values.root, mode: values.child, shape: shapes[profile], rounds: rounds[profile],
        signal: controller.signal, forkProcess: processes.fork,
        smoke: values.smoke, snapshots: values.snapshots && values.child === 'format2' });
      controller.signal.throwIfAborted();
      result.decision = scopeDecision(result.decision, process.env.ACCEPTANCE_SCOPE ?? 'diagnostic');
      await writeFile(path.join(values.out, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    } catch (error) {
      if (!controller.signal.aborted)
        await writeFile(path.join(values.out, 'failure.json'), JSON.stringify(trialFailure(values.child, error), null, 2), { flag: 'wx' });
      throw error;
    } finally {
      controller.abort(); await processes.close();
      process.off('message', message); process.off('disconnect', abort);
      if (process.connected) process.disconnect();
    }
  } else {
    const report = await comparison({ output: path.resolve(values.out), format: values.format, smoke: values.smoke,
      spotCheck: values['spot-check'], snapshots: values.snapshots });
    console.log(report.summary);
    if (report.failures.length || !values.smoke && (report.results.some(result => result.errors.length || result.allPostPublicationIO.baseWrites !== 0)
      || values.format !== 'format1' && !(report.results.find(result => result.mode === 'format2')?.decision.gatePassed
        ?? report.results.find(result => result.mode === 'format2')?.decision.acceptanceClaim))) process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) main().catch(error => { console.error(error); process.exitCode = 1; });
