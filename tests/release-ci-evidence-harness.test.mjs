// Synthetic CLI/network harness: no server, credentials, external fetch or live state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyEvidence, verifyOfflineEvidence, verifyOnlineEvidence, readEvidenceArchive }
  from '../scripts/release/verify-ci-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = marker => String(marker).repeat(64);
const clone = value => structuredClone(value);
const result = { verified: true, scope: 'portable-checks', releaseReady: false };
const refused = error => error instanceof Error && error.message === 'CI evidence refused.';
const counts = (passed = 1, skipped = 0) => ({ tests: passed + skipped, passed, failed: 0, cancelled: 0, skipped, todo: 0 });

function fixture() {
  const files = ['tests/fixture-one.test.mjs', 'tests/fixture-two.test.mjs'];
  const inventory = sha(JSON.stringify(files));
  const choice = kind => ({ id: `fixture-${kind}`, version: '1.0.0', sha256: hash(4) });
  const evidence = {
    schema: 'rs3-release-ci-evidence-v1', repository: 'fenerax/chunk-picker-rs3',
    candidate: { commit: '1'.repeat(40), tree: '2'.repeat(40), testInventorySha256: inventory },
    workflow: { path: '.github/workflows/release-check.yml', sourceCommit: '3'.repeat(40),
      runId: '123', attempt: '2', event: 'workflow_dispatch', ref: 'refs/heads/fixture-branch' },
    inputs: { packPinSha256: hash(4), packs: [{ name: 'fixture-pack.tar.gz', sha256: hash(5), bytes: 123 }],
      selection: { data: choice('data'), rulesText: choice('rules-text'), art: choice('art') },
      savePinSha256: hash(6), saveArchiveSha256: hash(7), saveStateSha256: hash(8) },
    lanes: ['linux', 'windows'].map(os => ({ os, node: 'v24.1.0', gates: [
      { name: 'source-tests', status: 'pass', inventorySha256: inventory, counts: counts(3, 1),
        files: files.map((file, index) => ({ file, passed: true, counts: counts(index ? 1 : 2, index ? 0 : 1) })) },
      { name: 'pack-integrity', status: 'pass' }, { name: 'scrubbed-save-startup', status: 'pass' },
      ...(os === 'linux' ? [{ name: 'secret-scan', status: 'pass' }] : [])
    ] })),
    blockedGates: ['kit-practice', 'kit-gallery', 'kit-copied-startup', 'kit-install',
      'kit-pack-transition', 'kit-text-lane', 'pc-freeze', 'pc-activation']
  };
  const expected = clone({ candidate: evidence.candidate, workflow: evidence.workflow, inputs: evidence.inputs });
  return { evidence, expected };
}

// Minimal independent ZIP writer, covering both artifact encodings and descriptors.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(bytes, { deflate = false, descriptor = false, name = 'release-ci-evidence.json', flags = 0, entries = 1 } = {}) {
  const nameBytes = Buffer.from(name), payload = deflate ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  const checksum = crc32(bytes), method = deflate ? 8 : 0, allFlags = flags | (descriptor ? 8 : 0);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(allFlags, 6);
  local.writeUInt16LE(method, 8); local.writeUInt16LE(nameBytes.length, 26);
  if (!descriptor) {
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(bytes.length, 22);
  }
  const trailer = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(checksum, 4);
    trailer.writeUInt32LE(payload.length, 8); trailer.writeUInt32LE(bytes.length, 12);
  }
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(allFlags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  const centralOffset = local.length + nameBytes.length + payload.length + trailer.length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries, 8); end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, payload, trailer, central, nameBytes, end]);
}

function onlineFixture({ mutateRun, mutateArtifact, mutateListing, archive, mutateArchive, responseFor } = {}) {
  const { evidence, expected } = fixture();
  archive ??= zip(Buffer.from(JSON.stringify(evidence)), { deflate: true, descriptor: true });
  const run = { id: 123, run_attempt: 2, path: expected.workflow.path, head_sha: expected.workflow.sourceCommit,
    event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_branch: 'fixture-branch',
    repository: { id: 456, full_name: 'fenerax/chunk-picker-rs3' },
    head_repository: { id: 456, full_name: 'fenerax/chunk-picker-rs3' } };
  const artifact = { id: 789, name: 'release-ci-evidence-2', expired: false, size_in_bytes: archive.length,
    digest: `sha256:${sha(archive)}`, workflow_run: { id: 123, repository_id: 456, head_repository_id: 456,
      head_sha: run.head_sha, head_branch: run.head_branch } };
  mutateRun?.(run); mutateArtifact?.(artifact);
  const listing = { total_count: 1, artifacts: [clone(artifact)] };
  mutateListing?.(listing);
  if (mutateArchive) archive = mutateArchive(Buffer.from(archive));
  const calls = [];
  const downloadUrl = ['https:', '', 'fixture-download.example', 'fixture-archive'].join('/');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const custom = responseFor?.(url, options);
    if (custom) return custom;
    if (url === downloadUrl) return new Response(archive);
    const target = new URL(url);
    assert.equal(target.hostname, 'api.github.com');
    assert.equal(options.redirect, 'manual');
    const base = '/repos/fenerax/chunk-picker-rs3/actions';
    if (target.pathname === `${base}/runs/123/attempts/2`) return Response.json(run);
    if (target.pathname === `${base}/runs/123/artifacts`) return Response.json(listing);
    if (target.pathname === `${base}/artifacts/789`) return Response.json(artifact);
    if (target.pathname === `${base}/artifacts/789/zip`) return new Response(null, { status: 302, headers: { location: downloadUrl } });
    assert.fail('Unexpected synthetic fixture request');
  };
  return { expected, calls, fetchImpl };
}

test('independently pinned portable checks pass with partial skips and a distinct approved workflow commit', () => {
  const { evidence, expected } = fixture();
  assert.deepEqual(verifyEvidence(evidence, expected), result);
  const bytes = Buffer.from(JSON.stringify(evidence));
  assert.deepEqual(verifyOfflineEvidence(bytes, sha(bytes), expected), result);
  const reordered = clone(expected);
  reordered.inputs.selection = { art: expected.inputs.selection.art, data: expected.inputs.selection.data,
    rulesText: expected.inputs.selection.rulesText };
  assert.deepEqual(verifyEvidence(evidence, reordered), result);
});

test('push evidence requires an approved release tag and the same candidate/workflow source', () => {
  const { evidence, expected } = fixture();
  evidence.workflow = expected.workflow = { ...expected.workflow, event: 'push', ref: 'refs/tags/release-fixture',
    sourceCommit: expected.candidate.commit };
  assert.deepEqual(verifyEvidence(evidence, expected), result);
  evidence.workflow = expected.workflow = { ...expected.workflow, ref: 'refs/heads/release-fixture' };
  assert.throws(() => verifyEvidence(evidence, expected), refused);
});

test('every independently approved candidate, workflow and input binding must match', () => {
  const changes = [
    value => { value.candidate.commit = '9'.repeat(40); },
    value => { value.candidate.tree = '9'.repeat(40); },
    value => { value.candidate.testInventorySha256 = hash(9); },
    value => { value.workflow.sourceCommit = '9'.repeat(40); },
    value => { value.workflow.runId = '999'; },
    value => { value.workflow.attempt = '3'; },
    value => { value.workflow.ref = 'refs/heads/fixture-other'; },
    value => { value.inputs.packPinSha256 = hash(9); },
    value => { value.inputs.packs[0].sha256 = hash(9); },
    value => { value.inputs.packs[0].bytes++; },
    value => { value.inputs.selection.art.sha256 = hash(9); },
    value => { value.inputs.savePinSha256 = hash(9); },
    value => { value.inputs.saveArchiveSha256 = hash(9); },
    value => { value.inputs.saveStateSha256 = hash(9); }
  ];
  for (const change of changes) {
    const { evidence, expected } = fixture(); change(evidence);
    assert.throws(() => verifyEvidence(evidence, expected), refused);
  }
});

test('an editable summary and its own checksum do not replace the independent offline digest', () => {
  const { evidence, expected } = fixture(), original = Buffer.from(JSON.stringify(evidence));
  const changed = Buffer.from(`${original.toString()} `);
  assert.throws(() => verifyOfflineEvidence(changed, sha(original), expected), refused);
  assert.throws(() => verifyOfflineEvidence(original, '', expected), refused);
  assert.throws(() => verifyOfflineEvidence(original, 'fixture-checksum.txt', expected), refused);
  assert.throws(() => verifyOfflineEvidence(Buffer.from('fixture-invalid-json'), sha(Buffer.from('fixture-invalid-json')), expected), refused);
});

test('empty or malformed independent expectations cannot authorize skipped assets', () => {
  const changes = [
    value => { delete value.candidate.testInventorySha256; },
    value => { value.inputs.packs = []; },
    value => { value.inputs.packs[0].bytes = 0; },
    value => { value.inputs.packs.push(clone(value.inputs.packs[0])); },
    value => { value.inputs.selection = null; },
    value => { delete value.inputs.selection.rulesText; },
    value => { value.inputs.savePinSha256 = null; },
    value => { value.inputs.saveArchiveSha256 = null; },
    value => { value.inputs.saveStateSha256 = null; },
    value => { value.workflow.runId = '0123'; },
    value => { value.workflow.path = '.github/workflows/fixture-other.yml'; },
    value => { value.workflow.event = 'pull_request'; },
    value => { value.unapproved = true; }
  ];
  for (const change of changes) {
    const { evidence, expected } = fixture(); change(expected);
    assert.throws(() => verifyEvidence(evidence, expected), refused);
  }
  const { evidence } = fixture();
  assert.throws(() => verifyEvidence(evidence, {}), refused);
});

test('missing, duplicate and unknown lanes or gates, and every non-pass status, refuse approval', () => {
  const changes = [
    value => { value.lanes.pop(); },
    value => { value.lanes[1] = clone(value.lanes[0]); },
    value => { value.lanes[1].os = 'fixture-os'; },
    value => { value.lanes[1].node = 'v22.1.0'; },
    value => { value.lanes[1].gates.pop(); },
    value => { value.lanes[0].gates.pop(); },
    value => { value.lanes[1].gates[1] = clone(value.lanes[1].gates[0]); },
    value => { value.lanes[0].gates[0].name = 'fixture-unknown'; },
    ...['fail', 'skipped', 'blocked'].map(status => value => { value.lanes[0].gates[1].status = status; }),
    value => { value.blockedGates.pop(); },
    value => { value.blockedGates[0] = value.blockedGates[1]; },
    value => { value.releaseReady = true; }
  ];
  for (const change of changes) {
    const { evidence, expected } = fixture(); change(evidence);
    assert.throws(() => verifyEvidence(evidence, expected), refused);
  }
});

test('source counts, complete independently approved inventory, and per-file passes are mandatory', () => {
  const changes = [
    gate => { delete gate.counts; }, gate => { delete gate.files; }, gate => { gate.files = []; },
    gate => { gate.counts.tests++; }, gate => { gate.counts.failed = 1; },
    gate => { gate.counts.cancelled = 1; }, gate => { gate.counts.todo = 1; },
    gate => { gate.counts.skipped = -1; }, gate => { gate.counts.tests = 1.5; },
    gate => { gate.files[0].counts.tests = 0; }, gate => { gate.files[0].passed = false; },
    gate => { gate.files[0].counts.passed++; }, gate => { gate.files.push(clone(gate.files[0])); },
    gate => { gate.files[0].file = 'tests/../fixture-one.test.mjs'; },
    gate => { gate.files[0].file = 'fixture-one.test.mjs'; },
    gate => { gate.files[0].file = 'tests\\fixture-one.test.mjs'; },
    gate => { delete gate.inventorySha256; }, gate => { gate.inventorySha256 = hash(9); },
    gate => { gate.files.pop(); gate.counts = counts(2, 1); }
  ];
  for (const change of changes) {
    const { evidence, expected } = fixture(); change(evidence.lanes[1].gates[0]);
    assert.throws(() => verifyEvidence(evidence, expected), refused);
  }
  // Even identical omissions on both OSes cannot redefine the approved inventory.
  const { evidence, expected } = fixture();
  for (const lane of evidence.lanes) {
    lane.gates[0].files.pop(); lane.gates[0].counts = counts(2, 1);
    lane.gates[0].inventorySha256 = sha(JSON.stringify([lane.gates[0].files[0].file]));
  }
  assert.throws(() => verifyEvidence(evidence, expected), refused);
});

test('a platform-specific skipped file requires actual passing tests on the other OS', () => {
  const { evidence, expected } = fixture();
  const source = evidence.lanes[0].gates[0];
  source.files[0].counts = counts(0, 3);
  source.counts = counts(1, 3);
  assert.deepEqual(verifyEvidence(evidence, expected), result);
  evidence.lanes[1].gates[0] = clone(source);
  assert.throws(() => verifyEvidence(evidence, expected), refused);
});

test('ZIP supports stored and deflated data with or without an artifact descriptor', () => {
  const bytes = Buffer.from(JSON.stringify(fixture().evidence));
  for (const deflate of [false, true]) for (const descriptor of [false, true]) {
    assert.deepEqual(readEvidenceArchive(zip(bytes, { deflate, descriptor })), bytes);
  }
});

test('ZIP refuses traversal, duplicate members, encryption, invalid sizes, CRC and compression bombs', () => {
  const bytes = Buffer.from(JSON.stringify(fixture().evidence));
  for (const options of [{ name: '../release-ci-evidence.json' }, { name: '/release-ci-evidence.json' },
    { entries: 2 }, { flags: 1 }, { flags: 64 }]) {
    assert.throws(() => readEvidenceArchive(zip(bytes, options)), refused);
  }
  const original = zip(bytes);
  const central = original.readUInt32LE(original.length - 6);
  const corruptions = [
    value => { value[30 + 'release-ci-evidence.json'.length] ^= 1; },
    value => { value.writeUInt32LE(0xffffffff, central + 24); },
    value => { value.writeUInt32LE(0xffffffff, central + 20); },
    value => { value.writeUInt32LE(1, central + 42); },
    value => { value.writeUInt16LE(2, central + 10); },
    value => { value.writeUInt16LE(0xa000, central + 40); },
    value => { value.writeUInt32LE(1, 22); }
  ];
  for (const corrupt of corruptions) {
    const archive = Buffer.from(original); corrupt(archive);
    assert.throws(() => readEvidenceArchive(archive), refused);
  }
  assert.throws(() => readEvidenceArchive(Buffer.concat([original, Buffer.from('fixture-trailing')])), refused);
  assert.throws(() => readEvidenceArchive(original.subarray(0, original.length - 1)), refused);
  const bomb = zip(Buffer.alloc(4 * 1024 * 1024 + 1, 1), { deflate: true });
  // Lie about the expected size as well: the inflater itself still has an output bound.
  const bombCentral = bomb.readUInt32LE(bomb.length - 6);
  bomb.writeUInt32LE(1, 22); bomb.writeUInt32LE(1, bombCentral + 24);
  assert.throws(() => readEvidenceArchive(bomb), refused);
});

test('online metadata binds workflow source separately and sends credentials only to the API', async () => {
  const fake = onlineFixture();
  assert.deepEqual(await verifyOnlineEvidence({ ...fake, runId: '123', attempt: '2', token: 'fixture-auth' }), result);
  assert.equal(fake.calls.length, 5);
  for (const call of fake.calls) {
    const isApi = new URL(call.url).hostname === 'api.github.com';
    assert.equal(call.options.headers.Authorization, isApi ? 'Bearer fixture-auth' : undefined);
  }
});

test('public online reads work without a token and never use artifact-provided download URLs', async () => {
  const fake = onlineFixture({
    mutateArtifact: value => { value.archive_download_url = 'fixture-untrusted-download'; },
    mutateListing: value => { value.total_count++; value.artifacts.push({ ...clone(value.artifacts[0]), name: 'release-ci-evidence-1' }); }
  });
  assert.deepEqual(await verifyOnlineEvidence({ ...fake, runId: '123', attempt: '2', token: '' }), result);
  assert.ok(fake.calls.every(call => call.options.headers.Authorization === undefined));
});

test('online verifier refuses wrong run/repository/workflow/source/ref/event/status/attempt metadata', async () => {
  const changes = [
    value => { value.id++; }, value => { value.run_attempt++; },
    value => { value.path = '.github/workflows/fixture-other.yml'; },
    value => { value.head_sha = '1'.repeat(40); }, value => { value.event = 'push'; },
    value => { value.head_branch = 'fixture-other'; }, value => { value.status = 'in_progress'; },
    value => { value.conclusion = 'failure'; }, value => { value.repository.full_name = 'fixture/fixture'; },
    value => { value.head_repository.id++; }, value => { value.head_repository.full_name = 'fixture/fixture'; }
  ];
  for (const mutateRun of changes) {
    const fake = onlineFixture({ mutateRun });
    await assert.rejects(verifyOnlineEvidence({ ...fake, runId: '123', attempt: '2', token: '' }), refused);
    assert.equal(fake.calls.length, 1);
  }
});

test('online artifacts must be unique, unexpired, associated with the run, and digest-bound', async () => {
  const changes = [
    value => { value.expired = true; }, value => { value.digest = null; },
    value => { value.digest = `sha256:${hash(9)}`; }, value => { value.workflow_run.id++; },
    value => { value.workflow_run.repository_id++; }, value => { value.workflow_run.head_repository_id++; },
    value => { value.workflow_run.head_sha = '9'.repeat(40); },
    value => { value.workflow_run.head_branch = 'fixture-other'; }, value => { value.size_in_bytes = 0; }
  ];
  for (const mutateArtifact of changes) {
    const fake = onlineFixture({ mutateArtifact });
    await assert.rejects(verifyOnlineEvidence({ ...fake, runId: '123', attempt: '2', token: '' }), refused);
  }
  for (const mutateListing of [
    value => { value.total_count = 0; value.artifacts = []; },
    value => { value.artifacts[0].name = 'release-ci-evidence-1'; },
    value => { value.total_count = 2; value.artifacts.push(clone(value.artifacts[0])); },
    value => { value.total_count = 101; }, value => { value.total_count = 2; }
  ]) {
    const fake = onlineFixture({ mutateListing });
    await assert.rejects(verifyOnlineEvidence({ ...fake, runId: '123', attempt: '2', token: '' }), refused);
  }
  const tampered = onlineFixture({ mutateArchive: value => { value[0] ^= 1; return value; } });
  await assert.rejects(verifyOnlineEvidence({ ...tampered, runId: '123', attempt: '2', token: '' }), refused);
  const other = fixture().evidence;
  other.candidate.tree = '9'.repeat(40);
  const authenticatedMismatch = onlineFixture({ archive: zip(Buffer.from(JSON.stringify(other))) });
  await assert.rejects(verifyOnlineEvidence({ ...authenticatedMismatch, runId: '123', attempt: '2', token: '' }), refused);
});

test('online responses, redirects and API errors fail closed with fixed, non-sensitive errors', async () => {
  const fake = onlineFixture();
  await assert.rejects(verifyOnlineEvidence({ ...fake, runId: '123', attempt: '3', token: '' }), refused);
  assert.equal(fake.calls.length, 0);
  const cases = [
    () => new Response('fixture-sensitive-error', { status: 403 }),
    () => new Response(null, { status: 302, headers: { location: 'fixture-untrusted-redirect' } }),
    () => new Response('fixture', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1))
  ];
  for (const responseFor of cases) {
    const bad = onlineFixture({ responseFor });
    await assert.rejects(verifyOnlineEvidence({ ...bad, runId: '123', attempt: '2', token: 'fixture-auth' }), refused);
  }
  for (const location of ['http:', 'file:'].map(scheme => `${scheme}//fixture.example/fixture`)) {
    const bad = onlineFixture({ responseFor: url => url.endsWith('/zip')
      ? new Response(null, { status: 302, headers: { location } }) : undefined });
    await assert.rejects(verifyOnlineEvidence({ ...bad, runId: '123', attempt: '2', token: 'fixture-auth' }), refused);
  }
  const throwing = onlineFixture();
  throwing.fetchImpl = async () => { throw new Error('fixture-sensitive-error'); };
  await assert.rejects(verifyOnlineEvidence({ ...throwing, runId: '123', attempt: '2', token: 'fixture-auth' }), refused);
});

test('offline CLI requires an independent digest and emits only scoped success or generic refusal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fixture-ci-evidence-'));
  try {
    const { evidence, expected } = fixture(), bytes = Buffer.from(JSON.stringify(evidence));
    const file = path.join(directory, 'fixture-summary.json'), expect = path.join(directory, 'fixture-expect.json');
    await writeFile(file, bytes); await writeFile(expect, JSON.stringify(expected));
    const script = fileURLToPath(new URL('../scripts/release/verify-ci-evidence.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [script, '--expect', expect, ...args],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const accepted = run(['--file', file, '--sha256', sha(bytes)]);
    assert.equal(accepted.status, 0); assert.equal(accepted.stderr, '');
    assert.deepEqual(JSON.parse(accepted.stdout), result);
    for (const args of [['--file', file], ['--file', file, '--sha256', hash(9)],
      ['--file', file, '--sha256', sha(bytes), '--attempt', '2'], ['--fixture-unknown', 'fixture-value']]) {
      const rejected = run(args);
      assert.equal(rejected.status, 1); assert.equal(rejected.stdout, '');
      assert.equal(rejected.stderr.trim(), 'CI evidence refused.');
      assert.ok(!rejected.stderr.includes(directory));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
