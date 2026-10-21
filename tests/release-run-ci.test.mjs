// Synthetic PC admission only: no real Git, GitHub, kits or installed paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { preflight } from '../scripts/release/pc/ci-inputs.mjs';
import { consume } from '../scripts/release/pc/ci-consumer.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => String(value).repeat(64);
const commit = '1'.repeat(40), tree = '2'.repeat(40);
const root = 'repos/fenerax/chunk-picker-rs3/actions';
const counts = () => ({ tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// One stored root member, generated independently of the production reader.
function zip(bytes) {
  const name = Buffer.from('release-ci-evidence.json');
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  const crc = crc32(bytes);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}

async function snapshot(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name), relative = path.relative(directory, target);
      if (entry.isDirectory()) { result.push([relative, 'directory']); await visit(target); }
      else result.push([relative, sha(await readFile(target))]);
    }
  }
  await visit(directory);
  return result;
}

async function fixture(t, { sameSource = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-ci-pc-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['checkout', 'kits', 'work', 'evidence', 'previous', 'inputs', 'bin'])
    await mkdir(path.join(directory, name));
  const options = { release: 'rel-fixture', kit: 'r-fixture', expectLive: 'rel-old', candidateCommit: commit,
    runId: '123', checkout: path.join(directory, 'checkout'), current: path.join(directory, 'inputs/current.json'),
    kitsRoot: path.join(directory, 'kits'), workRoot: path.join(directory, 'work'), evidenceDir: path.join(directory, 'evidence'),
    expectedEvidence: path.join(directory, 'inputs/expected.json'), request: path.join(directory, 'inputs/request.json'),
    clock: path.join(directory, 'bin/clock.mjs'), watchdogLog: path.join(directory, 'inputs/watchdog.log'),
    node: path.join(directory, 'bin/node.exe'), ps: path.join(directory, 'bin/powershell.exe'), gh: 'fixture-gh' };
  const files = ['tests/fixture-a.test.mjs', 'tests/fixture-b.test.mjs'];
  const choice = kind => ({ id: `fixture-${kind}`, version: '1.0.0', sha256: hex(4) });
  const pin = { schema: 'rs3-ci-pack-pin-v1', tag: 'fixture-assets',
    assets: [{ name: 'fixture-pack.tar.gz', sha256: hex(5), bytes: 123 }],
    selection: { data: choice('data'), rulesText: choice('rules'), art: choice('art') } };
  const save = { schema: 'rs3-ci-save-pin-v1', tag: 'fixture-assets',
    asset: { name: 'fixture-save.json', sha256: hex(7), bytes: 456 } };
  const pinBytes = Buffer.from(JSON.stringify(pin)), saveBytes = Buffer.from(JSON.stringify(save));
  const expected = { candidate: { commit, tree, testInventorySha256: sha(JSON.stringify(files)) },
    workflow: { path: '.github/workflows/release-check.yml', sourceCommit: sameSource ? commit : '3'.repeat(40),
      runId: '123', attempt: '2', event: 'workflow_dispatch', ref: 'refs/heads/fixture' },
    inputs: { packPinSha256: sha(pinBytes), packs: pin.assets, selection: pin.selection,
      savePinSha256: sha(saveBytes), saveArchiveSha256: save.asset.sha256, saveStateSha256: hex(8) } };
  const evidence = { schema: 'rs3-release-ci-evidence-v1', repository: 'fenerax/chunk-picker-rs3',
    ...structuredClone(expected), lanes: ['linux', 'windows'].map(os => ({ os, node: 'v24.20.0', gates: [
      { name: 'source-tests', status: 'pass', inventorySha256: expected.candidate.testInventorySha256,
        counts: { ...counts(), tests: 2, passed: 2 }, files: files.map(file => ({ file, passed: true, counts: counts() })) },
      { name: 'pack-integrity', status: 'pass' }, { name: 'scrubbed-save-startup', status: 'pass' },
      ...(os === 'linux' ? [{ name: 'secret-scan', status: 'pass' }] : [])
    ] })), blockedGates: ['kit-practice', 'kit-gallery', 'kit-copied-startup', 'kit-install',
      'kit-pack-transition', 'kit-text-lane', 'pc-freeze', 'pc-activation'] };
  const runRecord = { id: 123, run_attempt: 2, path: expected.workflow.path,
    head_sha: expected.workflow.sourceCommit, event: expected.workflow.event, head_branch: 'fixture',
    status: 'completed', conclusion: 'success', repository: { id: 456, full_name: evidence.repository },
    head_repository: { id: 456, full_name: evidence.repository } };
  const state = { pinBytes, saveBytes, dirty: '', filters: [], entries: [...files, '.github/packs/pack-pin.json', '.github/packs/save-pin.json'],
    runRecord, latestRun: structuredClone(runRecord), latestRuns: [structuredClone(runRecord)], missingArtifact: false,
    archive: null, artifactDigest: null };
  const calls = [];
  const run = (executable, args) => {
    calls.push({ executable, args });
    if (executable === 'git') {
      assert.deepEqual(args.slice(0, 7), ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', options.checkout]);
      const command = args.slice(7);
      if (command[0] === 'config') return Buffer.from(state.filters.join('\0'));
      while (command[0] === '-c') command.splice(0, 2);
      if (command[0] === 'rev-parse') return Buffer.from(command[1] === 'HEAD' ? commit : tree);
      if (command[0] === 'status') return Buffer.from(state.dirty);
      if (command[0] === 'ls-tree') return Buffer.from(state.entries.map(name => `100644 blob ${'9'.repeat(40)}\t${name}\0`).join(''));
      if (command[0] === 'show' && command[1].endsWith(':.github/packs/pack-pin.json')) return state.pinBytes;
      if (command[0] === 'show' && command[1].endsWith(':.github/packs/save-pin.json')) return state.saveBytes;
      assert.fail(`Unexpected synthetic git command: ${command[0]}`);
    }
    assert.equal(executable, 'fixture-gh');
    assert.deepEqual(args.slice(0, 6), ['api', '--hostname', 'github.com', '--method', 'GET', args[5]]);
    const endpoint = args[5];
    const archive = state.archive ?? zip(Buffer.from(JSON.stringify(evidence)));
    const artifact = { id: 789, name: 'release-ci-evidence-2', expired: false, size_in_bytes: archive.length,
      digest: state.artifactDigest ?? `sha256:${sha(archive)}`, workflow_run: { id: 123, repository_id: 456,
        head_repository_id: 456, head_sha: runRecord.head_sha, head_branch: 'fixture' } };
    let value;
    if (endpoint.startsWith(`${root}/workflows/`)) value = { workflow_runs: state.latestRuns };
    else if (endpoint === `${root}/runs/123`) value = state.latestRun;
    else if (endpoint === `${root}/runs/123/attempts/2`) value = runRecord;
    else if (endpoint === `${root}/runs/123/artifacts?per_page=100`)
      value = { total_count: state.missingArtifact ? 0 : 1, artifacts: state.missingArtifact ? [] : [artifact] };
    else if (endpoint === `${root}/artifacts/789`) value = artifact;
    else if (endpoint === `${root}/artifacts/789/zip`) return archive;
    else assert.fail('Unexpected synthetic GitHub endpoint');
    return Buffer.from(JSON.stringify(value));
  };
  await writeFile(options.current, JSON.stringify({ releaseId: options.expectLive,
    config: { path: path.join(directory, 'previous/config.json'), sha256: hex(6) } }));
  await writeFile(options.request, JSON.stringify({ releaseId: 'rel-fixture-candidate' }));
  await writeFile(options.expectedEvidence, JSON.stringify(expected));
  for (const key of ['clock', 'watchdogLog', 'node', 'ps']) await writeFile(options[key], 'fixture-only');
  return { directory, options, expected, evidence, state, calls, run };
}

test('preflight authenticates portable checks without a consumer and makes no writes', async t => {
  const f = await fixture(t), before = await snapshot(f.directory);
  const result = await preflight(f.options, { run: f.run });
  assert.equal(result.verified, true); assert.equal(result.scope, 'portable-checks');
  assert.equal(result.releaseReady, false); assert.equal(result.consumerAvailable, false);
  assert.equal(result.runId, '123'); assert.equal(result.attempt, '2');
  assert.equal(result.releaseId, 'rel-fixture-candidate');
  assert.equal(result.evidenceSha256, sha(Buffer.from(JSON.stringify(f.evidence))));
  assert.deepEqual(await snapshot(f.directory), before);
  assert.ok(f.calls.every(call => ['git', 'fixture-gh'].includes(call.executable)));
  assert.ok(f.calls.filter(call => call.executable === 'fixture-gh').every(call => call.args[4] === 'GET'));
});

test('a missing immutable summary artifact refuses without writes', async t => {
  const f = await fixture(t); f.state.missingArtifact = true;
  const before = await snapshot(f.directory);
  await assert.rejects(preflight(f.options, { run: f.run }), /CI evidence refused/);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('authenticated evidence still must match independent expectations', async t => {
  const f = await fixture(t); f.evidence.candidate.tree = 'a'.repeat(40);
  await assert.rejects(preflight(f.options, { run: f.run }), /CI evidence refused/);
});

test('tampered artifact ZIP cannot replace bytes covered by trusted metadata', async t => {
  const f = await fixture(t), original = zip(Buffer.from(JSON.stringify(f.evidence)));
  f.state.artifactDigest = `sha256:${sha(original)}`;
  f.state.archive = Buffer.from(original); f.state.archive[30] ^= 1;
  await assert.rejects(preflight(f.options, { run: f.run }), /CI evidence refused/);
});

test('wrong expected live ID refuses before invoking Git or GitHub', async t => {
  const f = await fixture(t); f.options.expectLive = 'rel-other';
  await assert.rejects(preflight(f.options, { run: f.run }), /live-id refused/);
  assert.equal(f.calls.length, 0);
});

test('an explicit run ID must equal the independently approved run', async t => {
  const f = await fixture(t); f.options.runId = '124';
  await assert.rejects(preflight(f.options, { run: f.run }), /run-id refused/);
  assert.ok(f.calls.every(call => call.executable === 'git'));
});

test('a rerun invalidates approval for an older attempt', async t => {
  const f = await fixture(t); f.state.latestRun.run_attempt = 3;
  await assert.rejects(preflight(f.options, { run: f.run }), /run-attempt refused/);
  assert.equal(f.calls.filter(call => call.executable === 'fixture-gh').length, 1);
});

test('attempt-specific GitHub metadata must agree with the approval', async t => {
  const f = await fixture(t); f.state.runRecord.run_attempt = 3;
  await assert.rejects(preflight(f.options, { run: f.run }), /CI evidence refused/);
});

test('latest resolves one matching successful run before exact verification', async t => {
  const f = await fixture(t, { sameSource: true }); f.options.runId = 'latest';
  f.state.latestRuns.unshift({ ...f.state.latestRun, id: 999, conclusion: 'failure' });
  const result = await preflight(f.options, { run: f.run });
  assert.equal(result.runId, '123');
  assert.match(f.calls.find(call => call.executable === 'fixture-gh').args[5], /head_sha=1{40}/);
});

test('latest cannot silently select a newer unapproved successful run', async t => {
  const f = await fixture(t, { sameSource: true }); f.options.runId = 'latest';
  f.state.latestRuns.unshift({ ...f.state.latestRun, id: 999 });
  await assert.rejects(preflight(f.options, { run: f.run }), /run-id refused/);
});

test('latest requires an explicit run for a distinct workflow-source commit', async t => {
  const f = await fixture(t); f.options.runId = 'latest';
  await assert.rejects(preflight(f.options, { run: f.run }), /latest-run refused/);
  assert.ok(f.calls.every(call => call.executable === 'git'));
});

test('dirty candidate checkout refuses before network admission', async t => {
  const f = await fixture(t); f.state.dirty = ' M fixture.txt\n';
  await assert.rejects(preflight(f.options, { run: f.run }), /candidate refused/);
  assert.ok(f.calls.every(call => call.executable === 'git'));
});

test('committed pin bytes must match independent expectation digests', async t => {
  const f = await fixture(t); f.state.pinBytes = Buffer.concat([f.state.pinBytes, Buffer.from('\n')]);
  await assert.rejects(preflight(f.options, { run: f.run }), /pins refused/);
  assert.ok(f.calls.every(call => call.executable === 'git'));
});

test('empty committed assets and stale kit directories refuse without creating work', async t => {
  const f = await fixture(t);
  const pin = JSON.parse(f.state.pinBytes); pin.assets = []; f.state.pinBytes = Buffer.from(JSON.stringify(pin));
  await assert.rejects(preflight(f.options, { run: f.run }), /pins refused/);
  const g = await fixture(t);
  await mkdir(path.join(g.options.kitsRoot, `relpipe-v2-staged-${g.options.kit}`));
  const before = await snapshot(g.directory);
  await assert.rejects(preflight(g.options, { run: g.run }), /fresh-kit refused/);
  assert.deepEqual(await snapshot(g.directory), before); assert.equal(g.calls.length, 0);
});

test('PowerShell runner parses without executing any statement', { skip: process.platform !== 'win32' }, () => {
  const runner = fileURLToPath(new URL('../scripts/release/pc/release-run-ci.ps1', import.meta.url));
  const command = '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:RS3_FIXTURE_RUNNER,[ref]$tokens,[ref]$errors); if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 10000, encoding: 'utf8', env: { ...process.env, RS3_FIXTURE_RUNNER: runner }
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('portable approval cannot stage without the explicit consumer, and creates no files', async t => {
  const f = await fixture(t);
  const approved = await preflight(f.options, { run: f.run });
  const before = await snapshot(f.directory);
  await assert.rejects(consume('stage', { ...f.options, approved }, { run: f.run }), /consumer-integration refused/);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('changed approval cannot reach the consumer boundary', async t => {
  const f = await fixture(t);
  const approved = await preflight(f.options, { run: f.run });
  approved.currentPointerSha256 = hex(9);
  const before = await snapshot(f.directory);
  await assert.rejects(consume('stage', { ...f.options, approved }, { run: f.run }), /changed-inputs refused/);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('preflight disables configured clean/process filters as well as fsmonitor', async t => {
  const f = await fixture(t);
  f.state.filters = ['filter.fixture.clean', 'filter.fixture.process', 'filter.fixture.required'];
  await preflight(f.options, { run: f.run });
  const status = f.calls.find(call => call.executable === 'git' && call.args.includes('status'));
  for (const option of ['core.fsmonitor=false', 'core.untrackedCache=false', 'filter.fixture.clean=', 'filter.fixture.process=', 'filter.fixture.required=false'])
    assert.ok(status.args.includes(option));
});

test('a consumer filename without the versioned operations grants no staging authority', async t => {
  const f = await fixture(t);
  const name = 'scripts/private-companion/release-ci-consumer.mjs';
  const moduleBytes = Buffer.from('export const contract = { schema: "fixture-unsupported" };\n');
  await mkdir(path.join(f.options.checkout, 'scripts/private-companion'), { recursive: true });
  await writeFile(path.join(f.options.checkout, name), moduleBytes);
  f.state.entries.push(name);
  const run = (executable, args) => executable === 'git' && args.at(-2) === 'show' && args.at(-1).endsWith(`:${name}`)
    ? moduleBytes : f.run(executable, args);
  const approved = await preflight(f.options, { run });
  const before = await snapshot(f.directory);
  await assert.rejects(consume('stage', { ...f.options, approved }, { run }), /consumer-integration refused/);
  assert.deepEqual(await snapshot(f.directory), before);
});
