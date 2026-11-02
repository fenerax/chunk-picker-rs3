import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { cleanupOwned } from './cleanup.mjs';
import { Client, Failure } from '../y03-fuzz-ci/client.mjs';
import { requireNode, publicEnvironment, EXIT } from '../y03-fuzz-ci/semantic.mjs';
import { options, operations, sha, verifyInputs, resultValue, compareValues, validateEngineReport } from './inputs.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), execute = promisify(execFile);
export function budget(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw Error('Invalid budget');
  return number;
}
async function main() {
  requireNode(); publicEnvironment();
  const { values: opts } = parseArgs({ options: Object.fromEntries([
    'out', 'reference-ref', 'candidate-ref', 'candidate-patch', 'cases', 'request-ms', 'wall-ms', 'rss-mib',
  ].map(name => [name, { type: 'string' }])) });
  const began = performance.now();
  const limits = { wallMs: budget(opts['wall-ms'], 780000, 100, 850000), requestMs: budget(opts['request-ms'], 10000, 50, 60000),
    rssBytes: budget(opts['rss-mib'], 768, 1, 8192) * 1024 ** 2 };
  const count = budget(opts.cases, 12, 2, 512), deadline = began + limits.wallMs;
  const command = async (program, args, extra = {}) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Failure('budget');
    return (await execute(program, args, { encoding: 'utf8', timeout: Math.min(60000, Math.ceil(remaining)), maxBuffer: 8 * 1024 ** 2, ...extra })).stdout.trim();
  };
  const git = (...args) => command('git', ['-C', ROOT, ...args]);
  if (!opts.out || !opts['reference-ref'] || !opts['candidate-ref']) throw Error('Explicit --out, --reference-ref and --candidate-ref required');
  const commits = [];
  for (const ref of [opts['reference-ref'], opts['candidate-ref']]) commits.push(await git('rev-parse', '--verify', `${ref}^{commit}`));
  const out = path.resolve(opts.out), scratch = path.join(out, 'owned');
  await mkdir(out); await mkdir(scratch);
  const report = { format: 'q2-engine-diff-v1', commits, node: process.version, limits, cases: count,
    resultPairs: 0, errorPairs: 0, successfulRequests: {}, successfulSources: {}, complete: false, inputsVerified: false, requestPairs: 0, expectedPairs: 0, differences: 0, firstDifference: null,
    errors: 0, exitCode: 0, requests: {}, sources: {}, engines: [], inputSHA256: [], peakRSSBytes: [0, 0], sideDurationMs: [0, 0] };
  const roots = [], worktrees = []; let clients = [], activeDataset;
  const checkpoint = async () => { report.durationMs = performance.now() - began; await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); };
  async function close() {
    for (const [i, client] of clients.entries()) {
      const failure = await client.close(); report.peakRSSBytes[i] = Math.max(report.peakRSSBytes[i], client.peakRSSBytes);
      if (failure) throw failure;
    }
    clients = [];
  }
  report.harnessCommit = await git('rev-parse', 'HEAD');
  report.harnessSources = {};
  for (const name of (await readdir(new URL('./', import.meta.url))).filter(name => name.endsWith('.mjs')).sort()) {
    report.harnessSources[name] = sha(await readFile(new URL(name, import.meta.url)));
  }
  for (const name of ['client.mjs', 'semantic.mjs']) report.harnessSources['y03/' + name] = sha(await readFile(new URL('../y03-fuzz-ci/' + name, import.meta.url)));
  for (const name of ['compare.mjs', 'volatile.json', 'capture-fixtures.mjs', 'fixture-state.mjs', 'fixture-tools.mjs']) report.harnessSources['calc-check/' + name] = sha(await readFile(new URL('../../../tools/calc-check/' + name, import.meta.url)));
  await checkpoint();
  try {
    // Record both owned paths once, atomically, before adding either worktree:
    // a kill mid-write must never leave a registered worktree without a receipt.
    for (const i of commits.keys()) { roots[i] = path.join(scratch, i ? 'candidate' : 'reference'); worktrees.push(roots[i]); }
    const receipt = path.join(out, 'owned.json');
    await writeFile(receipt + '.tmp', JSON.stringify({ scratch, worktrees })); await rename(receipt + '.tmp', receipt);
    for (const [i, commit] of commits.entries()) await git('worktree', 'add', '--detach', roots[i], commit);
    if (opts['candidate-patch']) {
      const patch = await readFile(opts['candidate-patch']); report.candidatePatchSHA256 = sha(patch);
      await command('git', ['-C', roots[1], 'apply', '--', path.resolve(opts['candidate-patch'])]);
    }
    for (const name of ['packs', 'maps', 'data']) await mkdir(path.join(scratch, name));
    const corpusFile = path.join(scratch, 'corpus.json');
    await command(process.execPath, [fileURLToPath(new URL('./corpus.mjs', import.meta.url)), roots[0], scratch, corpusFile, String(count)],
      { timeout: Math.max(1, Math.ceil(deadline - performance.now())) });
    const corpusBytes = await readFile(corpusFile), corpus = JSON.parse(corpusBytes);
    report.corpusSHA256 = sha(corpusBytes); report.harvest = { testFiles: corpus.harvestTests, ...corpus.coverage };
    report.expectedPairs = corpus.groups.reduce((n, group) => n + group.frames.length, 0);
    await checkpoint();
    async function connect(group) {
      if (activeDataset !== group.datasetId) await close();
      activeDataset = group.datasetId;
      if (!clients.length) clients = roots.map(root => new Client(root, 'warm', scratch, limits, () => {}, new URL('./bridge.mjs', import.meta.url)));
      const ready = [];
      for (const client of clients) ready.push(await client.send({ init: true, datasetId: group.datasetId,
        definitionBytes: group.definitionBytes, datasetOptions: options, extraRules: group.extraRules }, deadline));
      for (const value of ready) if (!value.ready || operations.some(type => !value.supports?.includes(type))) throw new Failure('invalid', { support: true });
      const inputsSHA256 = verifyInputs(ready[0].inputs, ready[1].inputs);
      return { ready, inputsSHA256 };
    }
    // Check every selected public dataset before issuing any corpus request.
    // Definition bytes, extra rules and options are then rechecked per bundle.
    report.datasetInputsSHA256 = [];
    for (const group of new Map(corpus.groups.map(group => [group.datasetId, group])).values()) {
      const { inputsSHA256 } = await connect(group);
      report.datasetInputsSHA256.push(inputsSHA256);
    }
    await close(); report.inputsVerified = true;
    for (const group of corpus.groups) {
      const { ready, inputsSHA256 } = await connect(group);
      report.engines.push(ready.map(value => ({ datasetDigest: value.datasetDigest })));
      report.inputSHA256.push(inputsSHA256);
      for (const frame of group.frames) {
        const values = [];
        for (const side of report.requestPairs % 2 ? [1, 0] : [0, 1]) {
          const at = performance.now();
          const value = await clients[side].request(frame.state, frame.request, deadline);
          report.sideDurationMs[side] += performance.now() - at;
          if (!value || value.cancelled || value.result?.cancelled) throw new Failure('engineError', { requestType: frame.request.type });
          if (value.error && group.source === 'synthetic') throw new Failure('engineError', { requestType: frame.request.type });
          values[side] = resultValue(value, frame.request.type, ready[side].datasetDigest, inputsSHA256);
        }
        const differences = compareValues(...values);
        report.requestPairs++; report.requests[frame.request.type] = (report.requests[frame.request.type] ?? 0) + 1;
        report.sources[group.source] = (report.sources[group.source] ?? 0) + 1;
        report.differences += differences.length;
        if (values.some(value => value.error)) report.errorPairs++;
        else {
          report.resultPairs++;
          report.successfulRequests[frame.request.type] = (report.successfulRequests[frame.request.type] ?? 0) + 1;
          report.successfulSources[group.source] = (report.successfulSources[group.source] ?? 0) + 1;
        }
        if (differences.length) {
          report.firstDifference = { requestType: frame.request.type, ...differences[0] };
          throw new Failure('mismatch');
        }
      }
      await checkpoint();
    }
    report.inputsVerified = true; report.complete = true;
  } catch (error) {
    report.exitCode = error instanceof Failure ? error.code : EXIT.invalid;
    report.errors += report.exitCode === EXIT.mismatch ? 0 : 1;
    report.failure = error instanceof Failure ? { kind: error.kind, ...error.detail } : { kind: 'invalid', message: error.message };
    report.complete = false;
  } finally {
    // Always retire both sides, even if one reports a retirement failure.
    for (const [i, client] of clients.entries()) {
      const failure = await client.close(); report.peakRSSBytes[i] = Math.max(report.peakRSSBytes[i], client.peakRSSBytes);
      if (failure && !report.exitCode) { report.exitCode = failure.code; report.errors++; report.complete = false; }
    }
    try { await cleanupOwned(out); }
    catch (error) { report.exitCode = EXIT.invalid; report.errors++; report.complete = false; report.cleanupError = error.message; }
    report.parentPeakRSSBytes = process.resourceUsage().maxRSS * 1024;
    if (performance.now() > deadline && !report.exitCode) { report.exitCode = EXIT.budget; report.errors++; report.complete = false; }
    await checkpoint();
  }
  if (!report.exitCode) validateEngineReport(report);
  console.log(JSON.stringify({ out, ...Object.fromEntries(['complete', 'exitCode', 'requestPairs', 'differences', 'firstDifference', 'durationMs', 'peakRSSBytes', 'failure'].map(key => [key, report[key]])) })); process.exitCode = report.exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = EXIT.invalid; });
