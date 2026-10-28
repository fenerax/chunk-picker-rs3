import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { REQUIRED_CHECKS, carryLocalInputs, evaluateChecks, prepareSwap, probeChain, treeEntries, verifyExport } from '../scripts/release/pc/quick-build.mjs';
import { assertCompatibleStep, deriveSavedIdentityAdditions } from '../scripts/private-companion/release-compatibility.mjs';
import { compatibilityReports, syntheticAdditions, syntheticCore } from './helpers/release-compatibility.mjs';
import { fileURLToPath } from 'node:url';

const run = (name, conclusion, id = 1, status = 'completed') => ({ id, name, status, conclusion, app: { slug: 'github-actions' }, completed_at: '2026-10-21T12:00:00Z' });
// Every required job green, with `name` replaced (or dropped when `replacement` is absent).
const greenExcept = (name, replacement) => REQUIRED_CHECKS.flatMap((check, index) =>
  check !== name ? [run(check, 'success', 100 + index)] : replacement ? [replacement] : []);

test('every GitHub job is required, including the coverage, gallery and rehearsal jobs', () => {
  assert.deepEqual([...REQUIRED_CHECKS].sort(), ['coverage', 'gallery', 'rehearsal (ubuntu-latest)',
    'rehearsal (windows-latest)', 'secrets', 'test', 'windows']);
});

test('GitHub checks pass only when every required job is green', () => {
  assert.equal(evaluateChecks(greenExcept()).ok, true);
  for (const name of REQUIRED_CHECKS) {
    const missing = evaluateChecks(greenExcept(name));
    assert.deepEqual([missing.ok, missing.missing], [false, [name]]);
  }
  const failing = evaluateChecks(greenExcept('test', run('test', 'failure')));
  assert.deepEqual([failing.ok, failing.failing], [false, ['test']]);
  const pending = evaluateChecks(greenExcept('test', run('test', null, 1, 'in_progress')));
  assert.deepEqual([pending.ok, pending.pending], [false, ['test']]);
  // A required job may not be skipped; an extra workflow's job may.
  assert.equal(evaluateChecks(greenExcept('coverage', run('coverage', 'skipped'))).ok, false);
  assert.equal(evaluateChecks([...greenExcept(), run('extra', 'skipped')]).ok, true);
  // Other apps' checks are not ours to judge.
  assert.equal(evaluateChecks([...greenExcept(), { ...run('lint', 'failure'), app: { slug: 'other' } }]).ok, true);
});

test('a rerun replaces its earlier attempt, in either direction', () => {
  const base = greenExcept('test');
  assert.equal(evaluateChecks([...base, run('test', 'failure', 1), run('test', 'success', 9)]).ok, true);
  assert.equal(evaluateChecks([...base, run('test', 'success', 1), run('test', 'failure', 9)]).ok, false);
});

test('the exported core must equal its commit exactly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-test-'));
  try {
    const repo = path.join(root, 'repo'), out = path.join(root, 'out');
    await mkdir(path.join(repo, 'app'), { recursive: true });
    await writeFile(path.join(repo, 'app', 'server.mjs'), 'export {};\r\n');
    await writeFile(path.join(repo, 'README.md'), 'hello\n');
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args]);
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'fixture');
    const entries = treeEntries(repo, 'HEAD');
    assert.deepEqual(entries.map(entry => entry.path).sort(), ['README.md', 'app/server.mjs']);
    await mkdir(path.join(out, 'app'), { recursive: true });
    await writeFile(path.join(out, 'app', 'server.mjs'), 'export {};\r\n');
    await writeFile(path.join(out, 'README.md'), 'hello\n');
    await verifyExport(out, entries);
    await writeFile(path.join(out, 'README.md'), 'hello\r\n');
    await assert.rejects(verifyExport(out, entries), /differs from its commit/);
    await writeFile(path.join(out, 'README.md'), 'hello\n');
    await writeFile(path.join(out, 'extra.txt'), 'x');
    await assert.rejects(verifyExport(out, entries), /differs from its commit/);
    await rm(path.join(out, 'extra.txt'));
    await rm(path.join(out, 'README.md'));
    await assert.rejects(verifyExport(out, entries), /missing files/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('local data inputs are carried from the live pack only when every byte matches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-test-'));
  try {
    const live = path.join(root, 'live'), maps = path.join(root, 'maps'), game = path.join(root, 'game');
    await mkdir(path.join(live, 'local-map'), { recursive: true }); await mkdir(path.join(live, 'local-game', 'cache'), { recursive: true });
    await writeFile(path.join(live, 'local-map', 'pins.json'), 'pins'); await writeFile(path.join(live, 'local-game', 'cache', 'a.gz'), 'gz');
    const record = (file, bytes) => ({ path: file, bytes: bytes.length, sha256: sha256(bytes), kind: 'input' });
    const manifest = { files: [record('local-map/pins.json', 'pins'), record('local-game/cache/a.gz', 'gz'), record('app/data/x.json', 'x')] };
    const carried = await carryLocalInputs(manifest, live, maps, game);
    assert.deepEqual(carried.map(row => row.path), ['local-map/pins.json', 'local-game/cache/a.gz']);
    assert.equal(await readFile(path.join(maps, 'pins.json'), 'utf8'), 'pins');
    assert.equal(await readFile(path.join(game, 'cache', 'a.gz'), 'utf8'), 'gz');
    await writeFile(path.join(live, 'local-map', 'pins.json'), 'changed');
    await assert.rejects(carryLocalInputs(manifest, live, path.join(root, 'maps2'), path.join(root, 'game2')), /differs from the live pack/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Two release folders whose data packs carry the given dataset digests, and a
// save binding for the first. Only what the save check reads before its probes.
async function releasePair(root, liveDigest, candidateDigest) {
  const dataDir = path.join(root, 'save');
  const encode = value => JSON.stringify(value, null, 2) + '\n';
  const pin = async (file, text) => { await writeFile(file, text); return { path: file, sha256: sha256(text) }; };
  const release = async (name, digest) => {
    const dir = path.join(root, name); await mkdir(dir);
    const config = { coreRoot: process.cwd(), dataDir,
      packs: { data: await pin(path.join(dir, 'data.json'), encode({ requires: { datasetId: 'duo-legacy', datasetContractVersion: 1 }, datasetDigest: digest, ruleContractHash: 'r' })) },
      profile: await pin(path.join(dir, 'profile.json'), encode({ datasetId: 'duo-legacy', datasetDigest: digest, ruleContractHash: 'r' })),
      selection: await pin(path.join(dir, 'selection.json'), '{}') };
    const configPin = await pin(path.join(dir, 'config.json'), encode(config));
    await writeFile(path.join(dir, 'pointer.json'), encode({ schemaVersion: 2, releaseId: name, config: configPin }));
    return { dir, configPin };
  };
  const live = await release('live', liveDigest), candidate = await release('candidate', candidateDigest);
  await writeFile(path.join(root, 'current.json'), await readFile(path.join(live.dir, 'pointer.json')));
  await writeFile(dataDir + '.dataset.json', encode({ schemaVersion: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, digest: liveDigest, requiresPack: true }));
  return { live, candidate, current: path.join(root, 'current.json'), binding: dataDir + '.dataset.json' };
}

test('the go-live save check needs no binding change for the same data, and a transition for different data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-test-'));
  try {
    await mkdir(path.join(root, 'same'));
    const same = await releasePair(path.join(root, 'same'), 'a'.repeat(64), 'a'.repeat(64));
    assert.deepEqual(await prepareSwap({ current: same.current, releaseDir: same.candidate.dir }), { binding: null });

    await mkdir(path.join(root, 'changed'));
    const changed = await releasePair(path.join(root, 'changed'), 'a'.repeat(64), 'b'.repeat(64));
    await assert.rejects(prepareSwap({ current: changed.current, releaseDir: changed.candidate.dir }), /neither release has a transition/);

    // A transition whose old side is not the binding the save has now refuses before any probe.
    const bytes = digest => Buffer.from(JSON.stringify({ schemaVersion: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, digest, requiresPack: true }, null, 2) + '\n');
    const side = digest => ({ datasetId: 'duo-legacy', datasetContractVersion: 1, digest, bindingSha256: sha256(bytes(digest)) });
    const plan = { schemaVersion: 1, oldConfig: changed.live.configPin, newConfig: changed.candidate.configPin, old: side('a'.repeat(64)), new: side('b'.repeat(64)),
      oldBindingBase64: bytes('a'.repeat(64)).toString('base64'), newBindingBase64: bytes('b'.repeat(64)).toString('base64') };
    await writeFile(path.join(changed.candidate.dir, 'pack-transition.json'), JSON.stringify(plan));
    await writeFile(changed.binding, bytes('c'.repeat(64)));
    await assert.rejects(prepareSwap({ current: changed.current, releaseDir: changed.candidate.dir }), /not the one the live release uses/);
    // Altered binding bytes in the plan refuse too.
    await writeFile(path.join(changed.candidate.dir, 'pack-transition.json'), JSON.stringify({ ...plan, newBindingBase64: bytes('d'.repeat(64)).toString('base64') }));
    await assert.rejects(prepareSwap({ current: changed.current, releaseDir: changed.candidate.dir }), /binding bytes differ/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('derive and strictly validate the four newly authored saved identities', () => {
  const { before, after } = compatibilityReports();
  assert.deepEqual(deriveSavedIdentityAdditions(before, after), syntheticAdditions);
  assert.deepEqual(assertCompatibleStep(before, after, { forward: true }), syntheticAdditions);
  assert.doesNotThrow(() => assertCompatibleStep(after, after));
  assert.throws(() => assertCompatibleStep(before, after), /identities/);
  assert.throws(() => assertCompatibleStep(before, after, { forward: true, declaredAdditions: [] }), /reviewed list/);
});

for (const change of ['existing resolution', 'removed key', 'already authored target', 'non-resolved addition', 'code identities', 'implicit authored key']) {
  test(`derivation refuses ${change}`, () => {
    const { before, after } = structuredClone(compatibilityReports());
    const key = syntheticAdditions[0].key;
    if (change === 'existing resolution') after.saved['rs3:task:existing'].id = key;
    if (change === 'removed key') delete after.saved['rs3:task:existing'];
    if (change === 'already authored target') before.datasetAuthored[key] = key;
    if (change === 'non-resolved addition') after.saved[key].status = 'unresolved';
    if (change === 'code identities') after.authored = { ids: [], aliases: {} };
    if (change === 'implicit authored key') before.datasetAuthoredKeys[key] = key;
    assert.throws(() => deriveSavedIdentityAdditions(before, after), /identit|addition/);
  });
}

test('quick-build chain derives only on forward and proves rollback and re-forward in child probes', async t => {
  const local = fileURLToPath(new URL('../.local/', import.meta.url)); await mkdir(local, { recursive: true });
  const scratch = await mkdtemp(path.join(local, 'quick-additions-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const old = path.join(scratch, 'old'), candidate = path.join(scratch, 'candidate'), save = path.join(scratch, 'save');
  await syntheticCore(old); await syntheticCore(candidate, { additions: true }); await mkdir(save);
  await writeFile(path.join(save, 'state.json'), JSON.stringify({ members: [{ id: 'synthetic' }] }));
  const config = coreRoot => ({ coreRoot, nodePath: process.execPath, packsDir: scratch,
    selection: { path: 'synthetic' }, profile: { path: 'synthetic', sha256: '0'.repeat(64) }, addons: { path: 'synthetic', sha256: '0'.repeat(64) } });
  const steps = [old, candidate, old, candidate].map((core, index) => ({ name: String(index), config: config(core), binding: '{}' }));
  const proof = await probeChain(fileURLToPath(new URL('../', import.meta.url)), save, steps);
  assert.deepEqual(proof.savedIdentityAdditions, syntheticAdditions);
  assert.deepEqual(proof.probes.map(row => [row.saved, row.history, row.lostRecords]), [[1, 1, 0], [5, 2, 0], [5, 2, 0], [5, 2, 0]]);
  assert.deepEqual(JSON.parse(await readFile(path.join(save, 'state.json'))), { members: [{ id: 'synthetic' }] });
  const { before, after } = compatibilityReports();
  for (const index of [2, 3]) {
    let call = 0;
    const probe = async () => {
      const report = structuredClone(call ? after : before);
      if (call++ === index) report.saved.extra = { status: 'resolved', id: 'extra', candidates: ['extra'] };
      return report;
    };
    await assert.rejects(probeChain(fileURLToPath(new URL('../', import.meta.url)), save, steps, undefined, { probe }), /identities/);
  }
});
