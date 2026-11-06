// Migration proof, not a second test registry. Run against the old selector's
// exact commit: node scripts/ci/compare-test-classification.mjs <base revision>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = process.argv[2];
if (!base || base.startsWith('-') || process.argv.length !== 3) throw Error('Usage: node scripts/ci/compare-test-classification.mjs <base revision>');
const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 ** 2 });
const revision = git('rev-parse', '--verify', base + '^{commit}').trim();
const beforeSource = git('show', revision + ':scripts/test-selection.mjs');
// Only the old selector module is evaluated, never a test or application module.
const old = await import('data:text/javascript;base64,' + Buffer.from(beforeSource.replace("'./test-port-check.mjs'",
  JSON.stringify(new URL('../test-port-check.mjs', import.meta.url).href))).toString('base64'));
const files = git('ls-tree', '-r', '--name-only', '-z', revision, '--', 'tests').split('\0')
  .filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name)).map(name => name.slice(6)).sort();
const now = (await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
const started = performance.now();
const current = await import(pathToFileURL(path.join(root, 'scripts/test-selection.mjs')).href);
const selection = await current.readTestSelection();
const classificationMs = performance.now() - started;
const discoveryStarted = performance.now();
assert.deepEqual(await current.discoverTests(undefined, 'full'), selection.selectTests(now, 'full'));
const discoveryMs = performance.now() - discoveryStarted;
const suiteNames = ['quick', 'full', 'differential', 'engine-differential'];
const suites = Object.fromEntries(suiteNames.map(suite => [suite, new Set(old.selectTests(files, suite))]));
const newSuites = Object.fromEntries(suiteNames.map(suite => [suite, new Set(selection.selectTests(now, suite))]));
const windowsList = source => [.../export const windowsFiles = \[([\s\S]*?)\];/.exec(source)[1]
  .matchAll(/'([^']+)'/g)].map(match => match[1]);
const windowsFile = '.github/windows-slice/run.mjs';
const oldWindows = new Set(windowsList(git('show', revision + ':' + windowsFile)));
const newWindows = new Set(windowsList(await readFile(path.join(root, windowsFile), 'utf8')));
const boundList = source => [.../export const windowsBoundTests = Object.freeze\(\[([\s\S]*?)\]\)/.exec(source)[1]
  .matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual(boundList(await readFile(path.join(root, 'scripts/private-companion/neutral-lane.mjs'), 'utf8')),
  boundList(git('show', revision + ':scripts/private-companion/neutral-lane.mjs')));
assert.deepEqual([...newWindows], [...oldWindows]);
const oldFixedPorts = new Set([.../const reviewedFixedPortTests = new Set\(\[([^\]]+)\]/.exec(beforeSource)[1]
  .matchAll(/'([^']+)'/g)].map(match => match[1]));
// Preserve undefined environment entries: they remove variables from the lane.
const serialPolicy = policy => Object.fromEntries(Object.entries(policy).map(([key, value]) =>
  [key, key === 'env' ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, val]) => [name, val === undefined ? { unset: true } : { value: val }]) : value]));
const describe = (name, module, memberships, windows, fixedPorts) => ({
  classification: module.classifyTest(name), suites: suiteNames.filter(suite => memberships[suite].has(name)),
  policy: serialPolicy(module.testRunPolicy(name)),
  lanes: [...(memberships.full.has(name) ? ['test'] : []), ...(memberships.differential.has(name) ? ['differential'] : []),
    ...(memberships['engine-differential'].has(name) ? ['engine-differential (opt-in)'] : []), ...(windows.has(name) ? ['windows'] : [])],
  reviewedFixedPorts: fixedPorts.has(name),
});
const differences = [];
for (const key of ['quickTests', 'soloTests', 'openF2PTests', 'differentialTests', 'engineDifferentialTests']) {
  assert.deepEqual([...current[key]].sort(), [...old[key]].sort(), `Exported ${key} policy differs`);
}
for (const name of files) {
  const before = describe(name, old, suites, oldWindows, oldFixedPorts);
  const after = describe(name, selection, newSuites, newWindows, current.reviewedFixedPortTests);
  try { assert.ok(now.includes(name), 'file removed'); assert.deepEqual(after, before); }
  catch { differences.push({ name, before, after }); }
}
// The workflow graph, runner commands, Windows environment and lane options stay
// byte-for-byte equal. This complements the per-entrypoint comparison above.
for (const file of ['.github/workflows/test.yml', '.github/workflows/differential.yml', windowsFile,
  '.github/windows-slice/run.ps1', 'scripts/test.mjs']) {
  if ((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n') !== git('show', revision + ':' + file).replaceAll('\r\n', '\n')) {
    differences.push({ file, reason: 'CI commands or lane options changed' });
  }
}
for (const suite of suiteNames) for (const env of [{}, { RS3_TEST_CONCURRENCY: '1' }, { RS3_TEST_CONCURRENCY: '6' }, { RS3_TEST_CONCURRENCY: '7' }]) {
  assert.equal(current.concurrencyFor(suite, env), old.concurrencyFor(suite, env));
  assert.deepEqual(current.adaptiveOptionsFor(suite, env), old.adaptiveOptionsFor(suite, env));
}
console.log(JSON.stringify({ base: revision, compared: files.length, added: now.filter(name => !files.includes(name)),
  suites: Object.fromEntries(suiteNames.map(suite => [suite, suites[suite].size])), windows: oldWindows.size,
  solo: old.soloTests.size, openF2P: old.openF2PTests.size, classificationMs: Number(classificationMs.toFixed(2)),
  discoveryWithPortAuditMs: Number(discoveryMs.toFixed(2)), differences }, null, 2));
assert.deepEqual(differences, [], 'Migration changes existing classification or runner behavior');
assert.ok(classificationMs < 1000, `Classification took ${classificationMs.toFixed(2)} ms (limit 1000 ms)`);
