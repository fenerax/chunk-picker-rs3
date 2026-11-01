// Reproducible synthetic before/after focus measurements. Requires an external
// Playwright installation; adds no npm dependencies. START is an explicit commit.
// RS3_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
//   node scripts/perf/duo-focus-browser.mjs <START> [pairs=3]
// Counts leaf journeys, excluding node:test's aggregate parent failure. Runtime
// includes browser/server setup and failing assertions; it is not a speed benchmark.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [start, count = '3'] = process.argv.slice(2), pairs = Number(count);
if (!/^[a-f0-9]{40}$/.test(start ?? '') || !Number.isInteger(pairs) || pairs < 1 || !process.env.RS3_PLAYWRIGHT_MODULE) {
  throw Error('Supply a full START SHA, positive pair count and RS3_PLAYWRIGHT_MODULE.');
}
if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw Error('Node 24.20+ required.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = await mkdtemp(path.join(tmpdir(), 'duo-focus-baseline-'));
const results = [];
try {
  for (const name of ['duo-task-view', 'duo-coordination', 'screen-startup', 'screen-map']) {
    await writeFile(path.join(baseline, `${name}.mjs`), execFileSync('git', ['show', `${start}:app/web/${name}.mjs`], { cwd: root }));
  }
  for (let pair = 0; pair < pairs; pair++) for (const version of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
    const began = performance.now();
    const env = { ...process.env, RS3_DATASET: 'open-f2p', RS3_TASK_WORKER_MODE: 'process' };
    for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE']) delete env[key];
    delete env.RS3_FOCUS_BASELINE_WEB;
    if (version === 'before') env.RS3_FOCUS_BASELINE_WEB = baseline;
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-skip-pattern=delayed coordination', 'tests/duo-focus-browser.test.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const passed = (output.match(/^    ok \d+ - /gm) ?? []).length, failed = (output.match(/^    not ok \d+ - /gm) ?? []).length;
    if (passed + failed !== 20) throw Error(`Expected 20 leaf journeys, got ${passed + failed}.\n${output}\n${stderr}`);
    if (version === 'before' && (output.match(/actual: false/g) ?? []).length !== failed) throw Error(`Baseline failed outside the expected focus assertions.\n${output}\n${stderr}`);
    const result = { pair: pair + 1, version, passed, failed, durationMs: Math.round(performance.now() - began) };
    results.push(result); console.log(JSON.stringify(result));
    if (version === 'after' && code !== 0) throw Error(`After regression failed.\n${output}\n${stderr}`);
  }
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted.at(-1) };
  };
  for (const version of ['before', 'after']) {
    const rows = results.filter(row => row.version === version);
    console.log(JSON.stringify({ version, failedJourneys: stats(rows.map(row => row.failed)), durationMs: stats(rows.map(row => row.durationMs)) }));
  }
} finally { await rm(baseline, { recursive: true, force: true }); }
