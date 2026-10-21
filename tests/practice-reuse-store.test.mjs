import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { practiceLaneDirectory, practiceFileLane } from '../scripts/private-companion/release-practice.mjs';
import { runFileLane } from '../scripts/private-companion/file-test-lane.mjs';
import { fixture } from './lane-test-fixture.mjs';

// This test creates no live/practice release. All data is below the job root.
const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir();
test('practice uses ordinary evidence store and diagnostic input key binds adapted inputs', async t => {
  assert.ok(scratch && path.isAbsolute(scratch), 'isolated job scratch is required');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'practice-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = async name => {
    const kit = path.join(root, name);
    await mkdir(path.join(kit, 'checks/private-source/tests'), { recursive: true });
    await mkdir(path.join(kit, 'packs'), { recursive: true });
    await writeFile(path.join(kit, 'checks/private-source/tests/peer.test.mjs'), 'synthetic source');
    await writeFile(path.join(kit, 'packs/selection.json'), '{}');
    return kit;
  };
  const kit = await fixture('one'), copy = await fixture('two');
  const inputs = { evidenceDir: path.join(root, 'evidence'), kit, toolingDigest: 'a'.repeat(64), liveIdentity: { digest: 'b'.repeat(64) } };
  const first = await practiceLaneDirectory(inputs);
  assert.equal((await practiceLaneDirectory({ ...inputs, kit: copy })).directory, first.directory);
  assert.equal(first.directory, inputs.evidenceDir);
  for (const patch of [{ toolingDigest: 'c'.repeat(64) }, { liveIdentity: { digest: 'c'.repeat(64) } },
    { toleratedRegistrations: [{ name: 'missing.test.mjs', sha256: 'd'.repeat(64) }] }, { inventoryProof: { kitSha256: 'e'.repeat(64) } }]) {
    assert.notEqual((await practiceLaneDirectory({ ...inputs, ...patch })).key, first.key);
  }
  const registrations = [{ name: 'a' }, { name: 'b' }];
  assert.equal((await practiceLaneDirectory({ ...inputs, toleratedRegistrations: registrations })).key,
    (await practiceLaneDirectory({ ...inputs, toleratedRegistrations: registrations.toReversed() })).key);
  await writeFile(path.join(kit, 'checks/private-source/tests/peer.test.mjs'), 'changed source');
  assert.notEqual((await practiceLaneDirectory(inputs)).key, first.key);
  await assert.rejects(practiceLaneDirectory({ ...inputs, evidenceDir: 'relative' }), /invalid/);
});

test('practice-produced exact lane evidence is consumed by ordinary release lane engine with zero fresh files', async t => {
  const f = await fixture(t);
  const practiceStore = await practiceLaneDirectory({ evidenceDir: f.directory, kit: f.kit,
    toolingDigest: 'a'.repeat(64), liveIdentity: { digest: 'b'.repeat(64) } });
  const first = await practiceFileLane({ ...f.options, evidenceDir: practiceStore.directory, runId: 'tooling-practice-shared-inputs' });
  assert.equal(first.summary.fresh, 2);
  const release = await runFileLane({ ...f.options, runId: 'ordinary-release' });
  assert.equal(release.summary.fresh, 0);
  assert.equal(release.summary.reused, 2);
  assert.deepEqual(release.summary.sourceRunIds, ['tooling-practice-shared-inputs']);
  assert.equal(f.calls.length, 1, 'one shared engine executes the lane once');
});
