import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const workflow = await readFile(new URL('../.github/workflows/release-check.yml', import.meta.url), 'utf8');
const block = start => {
  const tail = workflow.slice(workflow.indexOf(start) + start.length);
  return tail.slice(0, tail.indexOf('\n          NODE')).split('\n').map(line => line.replace(/^          /, '')).join('\n');
};
const driver = block('cat > "$RUNNER_TEMP/release-ci-driver.mjs" <<\'NODE\'\n');
const collector = block('node --input-type=module <<\'NODE\'\n');
const run = (args, options = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...options });

test('both embedded hosted JavaScript programs parse as Node modules', () => {
  for (const source of [driver, collector]) {
    assert(source.includes('import '));
    const result = run(['--check', '--input-type=module'], { input: source });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('Windows owner adapter parses without executing native changes', { skip: process.platform !== 'win32' }, () => {
  const marker = '          if ($IsWindows) {';
  const source = workflow.slice(workflow.indexOf(marker), workflow.indexOf('      - name: Keep lane evidence'))
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$source = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors); if ($errors.Count) { exit 1 }'],
  { input: source, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0);
});

async function fixture(t, { pin = null, os = 'linux' } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'release-ci-fixture-'));
  t.after(async () => {
    const target = path.resolve(base), parent = path.resolve(tmpdir());
    assert.equal(path.dirname(target), parent);
    assert(path.basename(target).startsWith('release-ci-fixture-'));
    await rm(target, { recursive: true, force: true });
  });
  const root = path.join(base, 'checkout'), temp = path.join(base, 'temp');
  await mkdir(root); await mkdir(temp);
  const write = async (name, source) => {
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source);
  };
  const counts = { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  await write('.github/packs/pack-pin.json', JSON.stringify({ schema: 'rs3-ci-pack-pin-v1', tag: null, selection: null, assets: [] }));
  await write('.github/packs/fetch-packs.mjs', `export const readPin = () => (${JSON.stringify(pin)});`);
  await write('scripts/test-selection.mjs', "export const discoverTests = async () => ['synthetic-fixture.test.mjs'];");
  await write('scripts/private-companion/release-evidence.mjs', 'export const laneEnvironment = async () => ({ ...process.env });');
  await write('scripts/secret-scan/scan.mjs', 'process.exitCode = 0;');
  await write('tests/browser-screen-harness.mjs', 'export const syntheticFixture = true;');
  await write('scripts/adaptive-test-runner.mjs', `export const runAdaptive = async ({files}) => ({passed:true, summary:{counts:${JSON.stringify(counts)}}, files:files.map(file=>({file,passed:true,summary:{counts:${JSON.stringify(counts)}}}))});`);
  execFileSync('git', ['init', '-q', root], { windowsHide: true });
  execFileSync('git', ['-C', root, '-c', 'core.autocrlf=false', 'add', '.'], { windowsHide: true });
  execFileSync('git', ['-C', root, '-c', 'user.name=fenerax', '-c', 'user.email=fenerax@users.noreply.github.com', 'commit', '-q', '--allow-empty', '-m', 'Synthetic fixture'],
    { windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: 'fenerax', GIT_AUTHOR_EMAIL: 'fenerax@users.noreply.github.com', GIT_COMMITTER_NAME: 'fenerax', GIT_COMMITTER_EMAIL: 'fenerax@users.noreply.github.com' } });
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  const file = path.join(base, 'driver.mjs'); await writeFile(file, driver);
  const result = run([file], { cwd: root, env: { ...process.env, RUNNER_TEMP: temp, CANDIDATE_INPUT: commit, LANE_OS: os,
    WORKFLOW_SOURCE: commit, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/fixture',
    GITHUB_STEP_SUMMARY: path.join(base, 'summary.md') } });
  return { result, summary: JSON.parse(await readFile(path.join(temp, 'release-ci/lane.json'), 'utf8')) };
}

test('empty pins visibly skip assets while running the discovered source inventory', async t => {
  const { result, summary } = await fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(summary.lane.gates.find(gate => gate.name === 'pack-integrity').status, 'skipped');
  assert.equal(summary.lane.gates.find(gate => gate.name === 'scrubbed-save-startup').status, 'skipped');
  assert.equal(summary.lane.gates.find(gate => gate.name === 'source-tests').counts.passed, 2);
  assert.equal(summary.lane.gates.find(gate => gate.name === 'secret-scan').status, 'pass');
  assert.equal(summary.inputs.selection, null);
  assert.match(result.stdout, /No packs pinned/);
});

test('a failing pinned asset command cannot turn into a skipped gate', async t => {
  const { result, summary } = await fixture(t, { pin: { tag: 'synthetic-fixture', assets: [], selection: {} } });
  assert.equal(result.status, 1);
  assert.equal(summary.lane.gates.find(gate => gate.name === 'pack-integrity').status, 'fail');
  assert.equal(summary.lane.gates.find(gate => gate.name === 'source-tests').status, 'pass');
});
