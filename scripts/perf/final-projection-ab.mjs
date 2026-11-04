// Sequential, balanced interleaved A/B trials; inputs stay in copied /tmp saves.
// Each arm gets a fresh parent/calculator. Warm operations remain inside each trial.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const median = values => { const a = [...values].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export function summary(values) { return { n: values.length, median: median(values), min: Math.min(...values), max: Math.max(...values) }; }
export function pairedComparison(pairs, draws = 10000) {
  if (!pairs.length || pairs.some(pair => pair.length !== 2 || pair.some(value => !Number.isFinite(value)))) throw new TypeError('PairsError');
  let seed = 0x5eed1234;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const changes = [];
  for (let draw = 0; draw < draws; draw++) {
    const sample = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)]);
    changes.push(median(sample.map(p => p[1])) - median(sample.map(p => p[0])));
  }
  changes.sort((a, b) => a - b);
  const reference = summary(pairs.map(p => p[0])), candidate = summary(pairs.map(p => p[1]));
  return { reference, candidate, difference: candidate.median - reference.median,
    percent: 100 * (candidate.median / reference.median - 1),
    pairedBootstrap95: [changes[Math.floor(draws * .025)], changes[Math.floor(draws * .975)]] };
}
export function summarizeTrials(trials) {
  const metrics = {};
  for (const population of ['preview', 'mixed', 'member1']) {
    const grouped = new Map();
    for (const trial of trials.filter(t => t.population === population)) {
      if (!grouped.has(trial.block)) grouped.set(trial.block, {});
      grouped.get(trial.block)[trial.arm] = trial.report;
    }
    const pairs = [...grouped.values()].filter(pair => pair.reference && pair.candidate);
    if (!pairs.length) continue;
    const walk = (left, right, keys = []) => {
      if (typeof left === 'number' && typeof right === 'number') {
        const values = pairs.map(pair => ['reference', 'candidate'].map(arm => keys.reduce((v, k) => v?.[k], pair[arm])));
        if (values.every(pair => pair.every(Number.isFinite))) metrics[[population, ...keys].join('.')] = pairedComparison(values);
      } else if (left && right && typeof left === 'object' && !Array.isArray(left)) {
        for (const key of Object.keys(left)) if (Object.hasOwn(right, key)) walk(left[key], right[key], [...keys, key]);
      }
    };
    // Only measured latencies/memory: no counts, output hashes or private identifiers.
    for (const key of ['startup', 'requests', 'idle', 'idleRSS', 'peakRSS']) walk(pairs[0].reference[key], pairs[0].candidate[key], [key]);
  }
  return metrics;
}
async function main() {
  const { values: args } = parseArgs({ options: { 'data-dir': { type: 'string' }, out: { type: 'string' }, runs: { type: 'string', default: '10' }, populations: { type: 'string', default: 'preview,mixed,member1' } } });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
  const runs = Number(args.runs), populations = args.populations.split(',');
  if (!args.out?.startsWith('/tmp/') || !args['data-dir']?.startsWith('/tmp/') || !Number.isInteger(runs) || runs < 10 || populations.some(p => !['preview', 'mixed', 'member1'].includes(p))) throw Error('OptionsError');
  await mkdir(args.out, { recursive: true });
  const dataDir = await realpath(args['data-dir']);
  if (!dataDir.startsWith('/tmp/')) throw Error('InputLocationError');
  const inputFileHash = createHash('sha256').update(await readFile(path.join(dataDir, 'state.json'))).digest('hex');
  const file = path.join(args.out, 'measurements.json');
  let prior;
  try { prior = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceHashes = {};
  for (const name of ['engine', 'obligation-cache', 'unknown-drop-warnings']) sourceHashes[name] = createHash('sha256').update(await readFile(new URL(`../../app/tasks/${name}.mjs`, import.meta.url))).digest('hex');
  if (prior && (prior.inputFileHash !== inputFileHash || JSON.stringify(prior.sourceHashes) !== JSON.stringify(sourceHashes))) throw Error('SourceChangedError');
  const report = prior ?? { node: process.version, runs, order: 'paired AB, BA alternating; fresh parent and process calculator per arm', sourceHashes, inputFileHash, trials: [] };
  report.runs = Math.max(report.runs, runs); report.complete = false;
  for (let block = 0; block < runs; block++) for (const population of populations) {
    for (const arm of block % 2 ? ['candidate', 'reference'] : ['reference', 'candidate']) {
      if (report.trials.some(t => t.block === block && t.population === population && t.arm === arm)) continue;
      const traceDir = path.join(args.out, `startup-${population}-${block}-${arm}`);
      await mkdir(traceDir, { recursive: true });
      const argv = population === 'preview' ? [fileURLToPath(new URL('./preview-engine.mjs', import.meta.url)), '--trial', '--data-dir', args['data-dir']]
        : ['--import', new URL('./profile-stack/bootstrap.mjs', import.meta.url).href, fileURLToPath(new URL('./hotspots-engine.mjs', import.meta.url)), '--trial', '--data-dir', args['data-dir'], '--result-hashes', ...(population === 'member1' ? ['--fresh-member', '1'] : [])];
      const child = spawn(process.execPath, argv, { cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, RS3_FINAL_PROJECTION: arm === 'reference' ? '0' : '1', RS3_PROFILE: '1', RS3_PROFILE_DIR: traceDir, RS3_ENGINE_PROFILE_PROBE: '0', RS3_ENGINE_HEAP_PROFILE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-8192); });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      if (code) { console.error(JSON.stringify({ population, block, arm, code, errorHash: createHash('sha256').update(stderr).digest('hex') })); throw Error('TrialError'); }
      const trialReport = JSON.parse(stdout), first = report.trials[0]?.report;
      if (first && ['datasetHash', 'sourceHash', 'stateHash'].some(key => trialReport[key] !== first[key])) throw Error('InputChangedError');
      report.trials.push({ population, block, arm, report: trialReport });
      await writeFile(`${file}.tmp`, JSON.stringify(report, null, 2)); await rename(`${file}.tmp`, file);
      console.error(JSON.stringify({ completed: report.trials.length, population, block, arm }));
    }
  }
  report.metrics = summarizeTrials(report.trials); report.complete = true;
  await writeFile(`${file}.tmp`, JSON.stringify(report, null, 2)); await rename(`${file}.tmp`, file);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ error: error.name })); process.exitCode = 1; });
