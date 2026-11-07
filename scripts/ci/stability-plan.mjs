// Hosted first-attempt proof; selection deliberately covers direct entry edits only.
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classifyTest, discoverTestEntries, discoverTests, isTestEntryFile } from '../test-selection.mjs';

export const CANARY = 'tests/test-selection.test.mjs';
export const PR_BUDGET = 200;
const detectorLanes = new Map([
  ['tests/y03-fuzz-ci-integration.test.mjs', 'differential-only'],
  ['tests/q2-diff-engine-integration.test.mjs', 'engine-differential-only'],
]);
// These entries exercise native Windows contracts and have no Linux cases.
// Report their proof on Windows; an all-skipped Linux run is never proof.
export const WINDOWS_ONLY = new Set([
  'backup-status.private', 'operations', 'operations-degraded', 'operations-forced',
  'operations-graceful', 'operations-owner', 'operator-cutover', 'operator-frozen-bundle',
  'private-live-swap', 'release-admission-v2', 'release-run-ci-powershell',
  'release-runtime-v2', 'restore-picker.private', 'watchdog-core',
].map(name => `tests/${name}.test.mjs`));
const entryName = file => typeof file === 'string' && file.startsWith('tests/') && !file.slice(6).includes('/') ? file.slice(6) : null;
const tooling = file => /^scripts\/ci\/stability-(plan|run|summary|counts)\.mjs$/.test(file)
  || ['.github/workflows/stability.yml', '.github/windows-slice/run.ps1',
    'scripts/test-classification.mjs', 'scripts/test-discovery.mjs', 'scripts/test-selection.mjs'].includes(file);

// Read the slice's authoritative declarative list without importing its CLI.
export function windowsSlice(source) {
  const body = source.match(/export const windowsFiles = \[([\s\S]*?)\];/)?.[1];
  if (body === undefined || body.replace(/'[^']+'\s*,?/g, '').trim()) throw Error('Windows slice list format changed');
  return [...body.matchAll(/'([^']+)'/g)].map(([, name]) => 'tests/' + name);
}

export function requireSupportedLane(file, classify = classifyTest) {
  const lane = classify(entryName(file));
  if (!['quick', 'full-only'].includes(lane) && detectorLanes.get(file) !== lane)
    throw Error(`loop not supported for this lane (${lane}): ${JSON.stringify(file)}`);
  return detectorLanes.get(file) === lane ? 'detector' : 'ordinary';
}

export function planStability({ changed = [], inventory, windows = [], files, repetitions = 50, os = 'linux', classify = classifyTest }) {
  const manual = files !== undefined;
  if (!Number.isInteger(Number(repetitions)) || Number(repetitions) < 1 || Number(repetitions) > 50) throw Error('Repetitions must be 1–50');
  if (!['linux', 'windows', 'both'].includes(os)) throw Error('OS must be linux, windows or both');
  const available = new Set(inventory);
  let selected = manual ? files.split(/[\s,]+/).filter(Boolean) : changed.filter(file => isTestEntryFile(entryName(file)));
  if (manual && !selected.length) throw Error('Supply at least one test entry file');
  for (const file of selected) {
    const name = entryName(file);
    if (!isTestEntryFile(name) || !available.has(file)) throw Error(`Unknown test entry file: ${JSON.stringify(file)}`);
    // Discovery accepts arbitrary basenames. Fail visibly for names this loop's
    // portable path / comma-whitespace dispatch syntax cannot represent safely.
    if (/[\\\s,|\u0000-\u001f\u007f]/.test(name)) throw Error(`Cannot plan test entry filename: ${JSON.stringify(file)}`);
    requireSupportedLane(file, classify);
    if (detectorLanes.has(file) && manual && os !== 'linux') throw Error('Detector stability requires Linux: ' + file);
  }
  selected = [...new Set(selected)].sort();
  const pairs = selected.flatMap(file => (manual
    ? os === 'both' ? ['linux', 'windows'] : [os]
    : WINDOWS_ONLY.has(file) ? ['windows'] : windows.includes(file) ? ['linux', 'windows'] : ['linux']).map(os => ({ file, os, requested: Number(repetitions) })));
  if (!manual && changed.some(tooling) && !selected.includes(CANARY)) {
    if (!available.has(CANARY)) throw Error('Stability canary missing');
    requireSupportedLane(CANARY, classify);
    pairs.push({ file: CANARY, os: 'linux', requested: 5 });
  }
  if (pairs.length > PR_BUDGET) throw Error('Over 200 file/OS pairs: split the PR and dispatch smaller file lists');
  if (manual && pairs.length * Number(repetitions) > PR_BUDGET) throw Error('Dispatch exceeds 200 repetitions: use smaller file lists');
  const perPair = pairs.length ? Math.floor(PR_BUDGET / pairs.length) : 0;
  const targets = pairs.map(pair => ({ ...pair, repetitions: Math.min(pair.requested, perPair) }));
  const systems = [...new Set(targets.map(pair => pair.os))];
  const include = [];
  for (const os of systems) for (const lane of ['ordinary', 'detector']) {
    const attempts = targets.filter(pair => pair.os === os && requireSupportedLane(pair.file, classify) === lane).flatMap(({ file, repetitions }) =>
      Array.from({ length: repetitions }, (_, i) => ({ file, repetition: i + 1, total: repetitions })));
    const count = Math.min(10, attempts.length);
    const shards = Array.from({ length: count }, (_, i) => ({ id: `${lane === 'detector' ? 'detector-' : ''}${os}-${i + 1}`, os,
      ...(lane === 'detector' ? { lane } : {}), runner: os === 'linux' ? 'ubuntu-latest' : 'windows-latest', attempts: [] }));
    attempts.forEach((attempt, i) => shards[i % count].attempts.push(attempt));
    include.push(...shards);
  }
  return { schema: 'rs3-stability-plan-v1', targets, reduced: targets.some(t => t.repetitions < t.requested), matrix: { include } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  let changed = [];
  if (event.pull_request) {
    const base = git(['merge-base', event.pull_request.base.sha, event.pull_request.head.sha]);
    // Select PR edits only; execute them on the ordinary CI merge checkout.
    changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', '-z', base, event.pull_request.head.sha], { encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  // Keep the ordinary suite's metadata/port audit. Dedicated lanes are discovered
  // too, but explicitly refused until their CI environments are supported.
  await discoverTests(undefined, 'full');
  const plan = planStability({ changed, inventory: (await discoverTestEntries()).map(name => 'tests/' + name),
    windows: windowsSlice(await readFile('.github/windows-slice/run.mjs', 'utf8')),
    ...(event.pull_request ? {} : { files: event.inputs?.files ?? '', repetitions: event.inputs?.repetitions ?? 50, os: event.inputs?.os ?? 'linux' }) });
  Object.assign(plan, { sha: git(['rev-parse', 'HEAD']), runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
  await writeFile('stability-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const ordinary = { include: plan.matrix.include.filter(task => task.lane !== 'detector') };
  const detectors = { include: plan.matrix.include.filter(task => task.lane === 'detector') };
  await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(ordinary)}\ndetector-matrix=${JSON.stringify(detectors)}\nhas-loop=${ordinary.include.length > 0}\nhas-detectors=${detectors.include.length > 0}\nhas-work=${plan.targets.length > 0}\n`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Stability plan\n\n${plan.targets.length} file/OS pairs; ${plan.reduced ? 'REDUCED proof (200-attempt PR cap); dispatch each file for 50 before landing.' : 'Full requested repetitions.'}\n\nDirectly changed entry files only; helper-only edits need manual dispatch.\n`);
}
