import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { definitions, makeState, requestsFor } from './generator.mjs';
import { normalize, differences, signature, hash, EXIT, NORMALIZATION, requireNode, publicEnvironment } from './semantic.mjs';
import { Client, Failure } from './client.mjs';
import { shrink } from './shrink.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
async function main() {
  requireNode(); publicEnvironment();
  const began = performance.now();
  const { values: opts } = parseArgs({ options: {
    ...Object.fromEntries(['profile', 'out', 'reference-ref', 'candidate-ref', 'reference-adapter', 'candidate-adapter', 'cases', 'seed', 'fault', 'replay', 'request-ms', 'wall-ms', 'rss-mib', 'shrink-attempts'].map(key => [key, { type: 'string' }])),
    help: { type: 'boolean' },
  } });
  if (opts.help) { console.log('See scripts/experiments/y03-fuzz-ci/README.md. Explicit local --reference-ref and --candidate-ref are required except for recorded-ref replay.'); return; }
  const profile = opts.profile ?? 'smoke';
  if (!['smoke', 'deep'].includes(profile)) throw Error('Invalid profile');
  const integer = (key, fallback, min, max) => { const n = Number(opts[key] ?? fallback); if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid ' + key); return n; };
  const count = integer('cases', profile === 'smoke' ? 2 : 12, 1, 512);
  const seeds = opts.seed === undefined ? profile === 'smoke' ? [19003, 19004] : [19003, 19004, 19005] : [integer('seed', 19003, 0, 0xffffffff)];
  const limits = { requestMs: integer('request-ms', 5000, 50, 60000), wallMs: integer('wall-ms', profile === 'smoke' ? 110000 : 600000, 100, 1800000),
    rssBytes: integer('rss-mib', 1024, 1, 8192) * 1024 * 1024, shrinkAttempts: integer('shrink-attempts', 12, 0, 100),
    sampleMs: 20, bridgeOldGenerationMiB: 256, workerOldGenerationMiB: 512 };
  const fixture = opts.replay ? JSON.parse(await readFile(opts.replay, 'utf8')) : null;
  if (fixture && (fixture.format !== 'y03-public-replay-v1' || !Array.isArray(fixture.frames) || !fixture.frames.length)) throw Error('Invalid replay format');
  const fault = opts.fault ?? fixture?.fault ?? 'none';
  if (!['none', 'mismatch', 'timeout', 'crash'].includes(fault)) throw Error('Invalid fault');
  const modes = [opts['reference-adapter'] ?? fixture?.adapters?.[0] ?? 'cold', opts['candidate-adapter'] ?? fixture?.adapters?.[1] ?? 'warm'];
  if (modes.some(mode => !['cold', 'warm'].includes(mode))) throw Error('Invalid adapter');
  const resolve = ref => {
    if (!ref) throw Error('Both explicit calculator refs required');
    return git('rev-parse', '--verify', `${ref}^{commit}`);
  };
  const head = git('rev-parse', 'HEAD');
  const commits = [resolve(opts['reference-ref'] ?? fixture?.commits?.[0]), resolve(opts['candidate-ref'] ?? fixture?.commits?.[1])];
  if (fixture && fixture.commits.some((sha, i) => sha !== commits[i])) throw Error('Replay refs differ from recorded refs');
  const out = opts.out ? path.resolve(opts.out) : await mkdtemp(path.join(tmpdir(), 'y03-results-'));
  if (opts.out) await mkdir(out); // Refuse to overwrite evidence.
  const scratch = path.join(out, 'owned');
  await mkdir(scratch);
  const roots = [], worktrees = [];
  const deadline = began + limits.wallMs;
  const sourceFiles = ['bridge.mjs', 'client.mjs', 'generator.mjs', 'run.mjs', 'semantic.mjs', 'shrink.mjs', 'supervise.mjs', 'validate-report.mjs'];
  const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(new URL(name, import.meta.url), 'utf8'))])));
  const report = { format: 'y03-report-v1', node: process.version, harnessCommit: head, harnessSourceSHA256: hash(sources), sources,
    harnessDirty: Boolean(git('status', '--porcelain', '--untracked-files=all', '--', 'scripts/experiments/y03-fuzz-ci')),
    commits, adapters: modes.map(mode => `worker-${mode}-v1`), profile, seeds, requestedCases: count, limits, fault,
    completedCases: 0, requestPairs: 0, requests: {}, views: {}, replayPairs: 0, faultControlPairs: 0, differences: 0,
    nondeterministicFields: 0, errors: 0, exitCode: 0, complete: false,
    peakRSSBytes: [0, 0], sampledTreePeakRSSBytes: 0, sideDurationMs: [0, 0], pairOrder: { AB: 0, BA: 0 }, failures: [],
    normalization: NORMALIZATION, adapterSHA256: sources['bridge.mjs'] };
  let clients = [], sequence = [], raw = fixture?.definitions ?? definitions(), ordinal = 0;
  const manifest = [], outputHashes = [];
  report.definitionsSHA256 = hash(raw);
  const checkpoint = async () => {
    report.durationMs = performance.now() - began;
    await writeFile(path.join(out, 'report.pending'), JSON.stringify(report, null, 2) + '\n');
    await rename(path.join(out, 'report.pending'), path.join(out, 'report.json'));
  };
  const witness = kind => ({ format: 'y03-public-replay-v1', harnessCommit: head, commits, adapters: modes, definitions: raw, fault, frames: sequence, expected: { kind } });
  async function close() {
    for (let side = 0; side < clients.length; side++) {
      const failure = await clients[side].close();
      if (failure && report.exitCode === 0) {
        report.exitCode = failure.code; report.complete = false; report.errors++;
        report.failures.push({ kind: failure.kind, side, retirement: true });
      }
      report.peakRSSBytes[side] = Math.max(report.peakRSSBytes[side], clients[side].peakRSSBytes);
    }
    clients = [];
  }
  async function connect() {
    await close();
    clients = roots.map((root, i) => new Client(root, modes[i], scratch, limits, () => {
      report.sampledTreePeakRSSBytes = Math.max(report.sampledTreePeakRSSBytes,
        process.memoryUsage.rss() + clients.reduce((sum, client) => sum + client.currentRSSBytes, 0));
    }));
    const ready = [];
    for (const client of clients) ready.push(await client.send({ init: true, definitions: raw }, deadline));
    report.engines ??= ready;
    if (ready[0].datasetDigest !== ready[1].datasetDigest) throw new Failure('invalid', { datasetMismatch: true });
    for (const engine of ready) for (const kind of ['evaluate', 'predict', 'death-estimates', 'chunk-planning', 'sandbox', 'area-check', 'how-task', 'roll-pool', 'prepare-rules']) {
      if (!engine.ready || !engine.supports?.includes(kind)) throw new Failure('invalid', { missingSupport: kind });
    }
  }
  async function pair(frame, injected = 'none', record = true) {
    const values = [], durations = [0, 0], order = ordinal++ % 2 ? [1, 0] : [0, 1];
    if (record) report.pairOrder[order[0] ? 'BA' : 'AB']++;
    for (const side of order) {
      const at = performance.now();
      try { values[side] = normalize(await clients[side].request(frame.replay && modes[side] === 'warm' ? undefined : frame.state, frame.request, deadline, side === 1 ? injected : 'none')); }
      catch (error) { if (error instanceof Failure) error.detail.side = side; throw error; }
      durations[side] = performance.now() - at;
      if (!values[side] || values[side].error || values[side].cancelled || values[side].result?.cancelled) throw new Failure('engineError', { side });
    }
    const paths = differences(...values);
    if (record) for (let side = 0; side < 2; side++) report.sideDurationMs[side] += durations[side];
    return { values, paths, durations };
  }
  function mismatch(result) { return new Failure('mismatch', { paths: result.paths, hashes: result.values.map(hash) }); }
  await checkpoint();
  try {
    // Even HEAD runs from a clean committed tree. Untracked/ignored application
    // files and .local selectors in the harness checkout cannot enter the oracle.
    for (const [side, commit] of commits.entries()) {
      if (side === 1 && commit === commits[0]) { roots[1] = roots[0]; continue; }
      roots[side] = path.join(scratch, side ? 'candidate' : 'reference');
      worktrees.push(roots[side]);
      await writeFile(path.join(out, 'owned.json'), JSON.stringify({ scratch, worktrees }) + '\n');
      git('worktree', 'add', '--detach', roots[side], commit);
    }
    for (const name of ['packs', 'maps', 'data', 'parent-packs', 'parent-maps', 'parent-data']) await mkdir(path.join(scratch, name));
    process.env.RS3_DATASET = 'duo-legacy'; process.env.RS3_PACKS_DIR = path.join(scratch, 'parent-packs');
    process.env.RS3_MAP_ASSETS_DIR = path.join(scratch, 'parent-maps'); process.env.RS3_GAME_DATA_DIR = path.join(scratch, 'parent-data');
    const [{ createGroupState, validateState }, { taskId }, { createTaskReuseFingerprint }] = await Promise.all([
      import(pathToFileURL(path.join(roots[0], 'app/core/state.mjs'))), import(pathToFileURL(path.join(roots[0], 'app/tasks/engine.mjs'))),
      import(pathToFileURL(path.join(roots[0], 'app/tasks/unlock-reuse.mjs'))),
    ]);
    for (const key of ['RS3_DATASET', 'RS3_PACKS_DIR', 'RS3_MAP_ASSETS_DIR', 'RS3_GAME_DATA_DIR']) delete process.env[key];
    const fingerprint = createTaskReuseFingerprint();
    const cases = fixture ? [...Map.groupBy(fixture.frames, frame => frame.caseId ?? 0).values()] : Array.from({ length: count }, (_, i) => {
      const seed = seeds[Math.floor(i * seeds.length / count)], state = makeState(i, seed, raw, createGroupState, taskId);
      validateState(state);
      return requestsFor(state, raw, i).map(request => {
        const input = fingerprint(state);
        return { caseId: i, state, request: { ...request, pickerId: 'synthetic-picker-' + i % 2, input, snapshotKey: JSON.stringify([state.revision, input]) } };
      });
    });
    for (const frames of cases) manifest.push({ stateSHA256: hash(frames[0].state), requestsSHA256: hash(frames.map(frame => frame.request)) });
    report.statesSHA256 = hash(cases.map(frames => hash(frames[0].state)));
    report.corpusSHA256 = hash(manifest);
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ commits, sources, seeds, manifest }, null, 2) + '\n');
    await checkpoint();
    await connect();
    let failedFrame, failure;
    outer: for (const frames of cases) {
      const baselines = [];
      for (const frame of frames) {
        validateState(frame.state); sequence.push(frame);
        try {
          const inject = !frame.replay && fault !== 'none' && frame.request.type === 'evaluate' && frame.request.resultView === 'full';
          if (inject) { const control = await pair(frame); report.faultControlPairs++; if (control.paths.length) throw mismatch(control); }
          const result = await pair(frame, inject ? fault : 'none');
          report.requestPairs++; report.requests[frame.request.type] = (report.requests[frame.request.type] ?? 0) + 1;
          if (frame.request.resultView) report.views[frame.request.resultView] = (report.views[frame.request.resultView] ?? 0) + 1;
          report.differences += result.paths.length;
          if (result.paths.length) throw mismatch(result);
          if (frame.baselineHashes && result.values.some((value, i) => hash(value) !== frame.baselineHashes[i])) throw new Failure('noise');
          outputHashes.push(result.values.map(hash)); baselines.push({ frame, values: result.values });
        } catch (error) { failedFrame = frame; failure = error; break outer; }
      }
      for (const { frame, values } of baselines.reverse()) {
        const replay = { ...frame, replay: true, baselineHashes: values.map(hash) };
        sequence.push(replay);
        const result = [];
        for (const side of [1, 0]) {
          const at = performance.now();
          result[side] = normalize(await clients[side].request(modes[side] === 'warm' ? undefined : frame.state, replay.request, deadline));
          report.sideDurationMs[side] += performance.now() - at;
          if (!result[side] || result[side].error || result[side].cancelled || result[side].result?.cancelled) throw new Failure('engineError', { side, replay: true });
          report.nondeterministicFields += differences(values[side], result[side]).length;
        }
        report.replayPairs++;
        if (report.nondeterministicFields) throw new Failure('noise');
      }
      report.completedCases++; await checkpoint();
    }
    if (failure) {
      if (!(failure instanceof Failure)) throw failure;
      report.exitCode = failure.code; report.errors += failure.kind !== 'mismatch' ? 1 : 0;
      report.failures.push({ kind: failure.kind, ...failure.detail });
      const replay = witness(failure.kind);
      replay.expected.target = signature(failure.detail.paths?.[0] ?? '/');
      await writeFile(path.join(out, 'failure.json'), JSON.stringify(replay, null, 2) + '\n');
      await checkpoint(); // Preserve the complete prefix before any reduction.
      const target = replay.expected.target;
      const accepts = async state => {
        try {
          await connect();
          const input = fingerprint(state), frame = { state, request: { ...failedFrame.request, input, snapshotKey: JSON.stringify([state.revision, input]) } };
          const result = await pair(frame, fault, false);
          return failure.kind === 'mismatch' && result.paths.some(p => signature(p) === target);
        } catch (error) { if (error.kind === 'budget') throw error; return error.kind === failure.kind && error.detail.side === failure.detail.side; }
      };
      const isolated = await accepts(failedFrame.state);
      report.shrink = { isolated, attempts: 0, censored: false };
      if (isolated && limits.shrinkAttempts) {
        const reduced = await shrink(failedFrame.state, failedFrame.request, accepts, validateState, limits.shrinkAttempts);
        report.shrink = { isolated, attempts: reduced.attempts, censored: reduced.censored, originalBytes: JSON.stringify(failedFrame.state).length, reducedBytes: JSON.stringify(reduced.state).length };
        const input = fingerprint(reduced.state);
        replay.frames = [{ state: reduced.state, request: { ...failedFrame.request, input, snapshotKey: JSON.stringify([reduced.state.revision, input]) } }];
        await writeFile(path.join(out, 'reduced.json'), JSON.stringify(replay, null, 2) + '\n');
      }
    }
    report.resultSHA256 = hash(outputHashes);
    report.complete = report.exitCode === 0 && !failure && report.completedCases === cases.length;
    if (performance.now() > deadline) throw new Failure('budget');
  } catch (error) {
    const kind = error instanceof Failure ? error.kind : 'invalid';
    report.exitCode = EXIT[kind]; report.errors++; report.failures.push({ kind, ...(error.detail ?? {}) }); report.complete = false;
    if (sequence.length) await writeFile(path.join(out, 'failure.json'), JSON.stringify(witness(kind), null, 2) + '\n');
  } finally {
    await close();
    report.sideTimingMs = report.sideDurationMs.map(total => ({ total }));
    report.parentPeakRSSBytes = process.resourceUsage().maxRSS * 1024;
    await checkpoint();
    try {
      for (const worktree of worktrees.reverse()) git('worktree', 'remove', '--force', worktree);
      await rm(scratch, { recursive: true, force: true });
    } catch {
      report.exitCode = EXIT.invalid; report.complete = false; report.errors++;
      report.failures.push({ kind: 'invalid', cleanup: true });
    }
    if (performance.now() > deadline && report.exitCode === 0) {
      report.exitCode = EXIT.budget; report.complete = false; report.errors++;
      report.failures.push({ kind: 'budget', cleanup: true });
    }
    await checkpoint();
  }
  console.log(JSON.stringify({ out, ...Object.fromEntries(['exitCode', 'complete', 'completedCases', 'requestPairs', 'replayPairs', 'differences', 'nondeterministicFields', 'durationMs', 'peakRSSBytes'].map(key => [key, report[key]])) }));
  process.exitCode = report.exitCode;
}
main().catch(error => { console.error(error.message); process.exitCode = EXIT.invalid; });
