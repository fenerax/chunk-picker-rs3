// Dataset load profile: one fresh process per run, stage marks from the loader,
// heap peaks from V8's GC trace and the kernel's resident high-water mark.
//
//   node scripts/perf/dataset-load.mjs --companion <scale-dataset output> [--runs 3] [--root <source tree>] [--cpu-prof]
//   node scripts/perf/dataset-load.mjs --open-f2p [--runs 3]
//
// Companion runs need the shared heavy-work wrapper; RS3_PERF_COMPANION_ROOT
// may name the companion instead of --companion. --root profiles another
// source tree (a base checkout needs the traceDatasetLoad marks for stage
// detail inside resolveDataset). No server, storage, network or save.
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { requireHeavyLock } from './inputs.mjs';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
const flag = name => process.argv.includes(`--${name}`);
const mib = bytes => Math.round(bytes / 1048576 * 10) / 10;
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]; };
const resultPrefix = 'DATASET_LOAD_RESULT ';

async function child() {
  const root = path.resolve(option('root') ?? '.');
  const load = file => import(pathToFileURL(path.join(root, file)));
  const marks = [];
  const mark = stage => {
    const memory = process.memoryUsage();
    marks.push({ stage, at: performance.now(), heapUsed: memory.heapUsed, external: memory.external,
      arrayBuffers: memory.arrayBuffers, rss: memory.rss, maxRss: process.resourceUsage().maxRSS * 1024 });
  };
  mark('start');
  const datasets = await load('app/datasets.mjs');
  datasets.traceDatasetLoad?.(mark);
  const runtime = await load('app/dataset-runtime.mjs');
  mark('runtime');
  const pipeline = await load('app/dataset-pipeline.mjs');
  mark('module-data');
  const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
  const input = await loadDatasetInputs(runtime.selectedDataset);
  mark('definition-inputs');
  const parsed = JSON.parse(input.definitionBytes.toString('utf8'));
  const taskMap = JSON.parse(input.taskBytes.toString('utf8'));
  mark('definitions-parse');
  const prepared = pipeline.prepareServerDefinitions(parsed, runtime.selectedDataset);
  mark('corrections-overlays');
  const values = await runtime.materializeDatasetValues();
  for (const key of Object.keys(values)) runtime.datasetValue(key);
  mark('values-freeze');
  globalThis.gc?.();
  mark('retained');
  const tasks = Object.values(prepared.challenges).reduce((total, rows) => total + Object.keys(rows).length, 0);
  process.stdout.write(`${resultPrefix}${JSON.stringify({ marks, digest: runtime.selectedDataset.digest, tasks, taskMap: Object.keys(taskMap).length })}\n`);
}

// "[pid:0x…]    123 ms: Mark-Compact 412.3 (430.1) -> 380.1 (420.0) MB, …"
const gcLine = /^\[[^\]]*\]\s+([\d.]+) ms: (Scavenge|Mark-Compact|Minor Mark-Sweep|Mark-Sweep)[^\d]*([\d.]+) \(([\d.]+)\) -> ([\d.]+)/;
function summarize(output) {
  const line = output.split('\n').find(row => row.startsWith(resultPrefix));
  if (!line) throw new Error(`Profile run failed:\n${output.slice(-4000)}`);
  const result = JSON.parse(line.slice(resultPrefix.length));
  const collections = output.split('\n').map(row => gcLine.exec(row)).filter(Boolean).map(match => ({ at: Number(match[1]), before: Number(match[3]) * 1048576 }));
  const stages = [];
  for (let index = 1; index < result.marks.length; index++) {
    const from = result.marks[index - 1], to = result.marks[index];
    const peak = Math.max(from.heapUsed, to.heapUsed, ...collections.filter(row => row.at > from.at && row.at <= to.at).map(row => row.before));
    stages.push({ stage: to.stage, ms: to.at - from.at, heapPeak: peak, heapEnd: to.heapUsed, external: to.external,
      arrayBuffers: to.arrayBuffers, rss: to.rss, maxRss: to.maxRss });
  }
  const loaded = stages.filter(row => row.stage !== 'retained');
  return { digest: result.digest, tasks: result.tasks, stages, total: loaded.reduce((sum, row) => sum + row.ms, 0),
    heapPeak: Math.max(...loaded.map(row => row.heapPeak)), maxRss: Math.max(...loaded.map(row => row.maxRss)),
    externalPeak: Math.max(...loaded.map(row => row.external)), retainedHeap: stages.at(-1).heapEnd, retainedRss: stages.at(-1).rss };
}

async function companionEnvironment(directory) {
  const receipt = JSON.parse(await readFile(path.join(directory, 'companion.json'), 'utf8'));
  return { RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(directory, receipt.profile.path),
    RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(directory, 'packs'),
    RS3_PACK_SELECTION: path.join(directory, 'selection.json') };
}

function run(environment, extra = []) {
  const script = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['--trace-gc', '--expose-gc', ...extra, script, '--child', ...process.argv.slice(2)],
      { env: environment, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    let output = '';
    processHandle.stdout.on('data', chunk => { output += chunk; });
    processHandle.on('error', reject);
    processHandle.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Profile run exited ${code}:\n${output.slice(-4000)}`)));
  });
}

// Self time by function from a V8 CPU profile, grouped into load work kinds.
function cpuSummary(profile) {
  const self = new Map(), byId = new Map(profile.nodes.map(node => [node.id, node]));
  profile.samples.forEach((id, index) => {
    const node = byId.get(id), name = node.callFrame.functionName || node.callFrame.url.split('/').at(-1) || '(anonymous)';
    self.set(name, (self.get(name) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  const kinds = { hash: /^(update|digest|sha|hash|createHash|sha256RepositoryText)$/, parse: /^parse$/, validate: /^(feed|checkJsonSyntax|end)$/,
    read: /^(read|readSync|readFileSync|tryReadSync|readFileHandle|_read|readFile)$/, decode: /^(toString|utf8Slice|decode)$/,
    clone: /^(structuredClone|decodeDatasetValue|encodeDatasetValue|decodeValues|fromEntries)$/, copy: /^(concat|from|allocUnsafe|set)$/,
    freeze: /^(freeze|isFrozen)$/, stringify: /^stringify$/, compare: /^(isDeepStrictEqual|innerDeepEqual|keyCheck|objEquiv)$/, gc: /^\(garbage collector\)$/ };
  const grouped = Object.fromEntries(Object.keys(kinds).map(kind => [kind, 0]));
  for (const [name, ms] of self) {
    const kind = Object.entries(kinds).find(([, pattern]) => pattern.test(name))?.[0];
    if (kind) grouped[kind] += ms;
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  return { grouped: Object.fromEntries(Object.entries(grouped).map(([kind, ms]) => [kind, Math.round(ms)])), top };
}

async function main() {
  const runs = Number(option('runs') ?? 3);
  const environment = { ...process.env };
  for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON',
    'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR', 'NODE_OPTIONS']) delete environment[key];
  const companion = option('companion') ?? process.env.RS3_PERF_COMPANION_ROOT;
  if (flag('open-f2p')) environment.RS3_DATASET = 'open-f2p';
  else if (companion) { await requireHeavyLock(); Object.assign(environment, await companionEnvironment(path.resolve(companion))); }
  else throw new Error('Pass --companion <directory> or --open-f2p.');
  const results = [];
  for (let index = 0; index < runs; index++) results.push(summarize(await run(environment)));
  if (new Set(results.map(row => row.digest)).size !== 1) throw new Error('Runs selected different datasets.');
  const stages = results[0].stages.map(({ stage }, index) => ({ stage,
    ...Object.fromEntries(['ms', 'heapPeak', 'heapEnd', 'external', 'maxRss'].map(key => [key, median(results.map(row => row.stages[index][key]))])) }));
  const summary = { root: path.resolve(option('root') ?? '.'), runs, digest: results[0].digest, tasks: results[0].tasks,
    totalMs: Math.round(median(results.map(row => row.total))), heapPeakMiB: mib(median(results.map(row => row.heapPeak))),
    maxRssMiB: mib(median(results.map(row => row.maxRss))), externalPeakMiB: mib(median(results.map(row => row.externalPeak))),
    retainedHeapMiB: mib(median(results.map(row => row.retainedHeap))), retainedRssMiB: mib(median(results.map(row => row.retainedRss))),
    stages: stages.map(row => ({ stage: row.stage, ms: Math.round(row.ms), heapPeakMiB: mib(row.heapPeak), heapEndMiB: mib(row.heapEnd),
      externalMiB: mib(row.external), rssHighWaterMiB: mib(row.maxRss) })) };
  if (flag('cpu-prof')) {
    const directory = await mkdtemp(path.join(tmpdir(), 'dataset-load-prof-'));
    try {
      await run(environment, ['--cpu-prof', `--cpu-prof-dir=${directory}`]);
      const [file] = (await readdir(directory)).filter(name => name.endsWith('.cpuprofile'));
      summary.cpu = cpuSummary(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (flag('child')) await child(); else await main();
