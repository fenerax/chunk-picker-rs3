// Phase B split lane: the hook in runFileLane and verifyFileLane. Synthetic lane fixture;
// the Actions import is a stand-in callback, its own refusals live in neutral-evidence-reuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFileLane, verifyFileLane } from '../scripts/private-companion/file-test-lane.mjs';
import { fixture } from './lane-test-fixture.mjs';

const receipt = { source: { runId: 1, attempt: 1 }, policy: { id: 'synthetic' }, key: 'k'.repeat(64), packs: null, node: 'v24.20.0', recordDigest: 'd'.repeat(64), verifiedAt: '2026-10-20T00:00:00.000Z' };
const remote = { files: ['tests/b.test.mjs'], receipt };
const fresh = async () => ({ files: ['tests/b.test.mjs'], receipt });

test('neutral files leave the PC run, and both sources together verify fresh and retained', async t => {
  const f = await fixture(t); const seen = [];
  const split = await runFileLane({ ...f.options, runId: 'split', neutral: async (plans, due) => { seen.push([plans.map(p => p.file), due]); return remote; } });
  assert.deepEqual(seen, [[['tests/a.test.mjs', 'tests/b.test.mjs'], { fresh: ['tests/a.test.mjs', 'tests/b.test.mjs'], ranHere: [] }]],
    'the hook sees the full inventory and which files are due here');
  assert.deepEqual(f.calls, [['tests/a.test.mjs']]);
  assert.deepEqual(split.files.map(file => file.file), ['tests/a.test.mjs']);
  assert.deepEqual(split.neutral, remote);
  assert.equal(split.summary.neutral, 1);
  const asked = [];
  await verifyFileLane({ ...f.options, item: split, verifyNeutral: async (neutral, context) => { asked.push(context); return fresh(); } });
  await verifyFileLane({ ...f.options, item: split, retained: true, verifyNeutral: fresh });
  assert.deepEqual(asked, [{ inventory: ['tests/a.test.mjs', 'tests/b.test.mjs'], retained: false, ranHere: ['tests/a.test.mjs'] }],
    'witnesses are the local files whose proofs come from this run');
});

test('a refused import runs every file here; early phases never ask', async t => {
  const f = await fixture(t);
  const local = await runFileLane({ ...f.options, runId: 'refused', neutral: async () => null });
  assert.deepEqual(f.calls, [['tests/a.test.mjs', 'tests/b.test.mjs']]);
  assert.equal(local.neutral, undefined);
  await verifyFileLane({ ...f.options, item: local });
  const g = await fixture(t);
  await runFileLane({ ...g.options, runId: 'early', only: ['tests/a.test.mjs'], force: true, phase: 'previous', neutral: () => { throw Error('Early phases must not ask for neutral evidence.'); } });
});

test('the hook refuses a neutral file that was not due to run fresh here', async t => {
  const f = await fixture(t);
  await assert.rejects(runFileLane({ ...f.options, runId: 'stray', neutral: async () => ({ files: ['tests/b.test.mjs', 'tests/gone.test.mjs'], receipt }) }), /not due to run fresh here/);
});

test('split verification refuses a missing verifier, a wrong lane, overlap, gaps and changed imports', async t => {
  const f = await fixture(t);
  const split = await runFileLane({ ...f.options, runId: 'split', neutral: async () => remote });
  const verify = (item, extra = {}) => verifyFileLane({ ...f.options, item, verifyNeutral: fresh, ...extra });
  await assert.rejects(verify(split, { verifyNeutral: undefined }), /needs its fresh verifier/);
  await assert.rejects(verify(split, { lane: 'public-full' }), /needs its fresh verifier/);
  await assert.rejects(verify({ ...split, neutral: { ...remote, files: ['tests/b.test.mjs', 'tests/a.test.mjs'] } }), /overlap or repeat/);
  await assert.rejects(verify({ ...split, neutral: { ...remote, files: ['tests/b.test.mjs', 'tests/b.test.mjs'] } }), /overlap or repeat/);
  await assert.rejects(verify({ ...split, neutral: { ...remote, files: [] } }), /overlap or repeat/);
  await assert.rejects(verify({ ...split, files: [] }), /inventory changed/, 'a dropped local proof leaves a gap');
  await assert.rejects(verify({ ...split, summary: { ...split.summary, runId: undefined } }), /run id missing/);
  const witnesses = [];
  await verify({ ...split, summary: { ...split.summary, runId: 'another-run' } }, { verifyNeutral: async (neutral, { ranHere }) => { witnesses.push(ranHere); return fresh(); } });
  assert.deepEqual(witnesses, [[]], 'proofs from another run never witness');
  await assert.rejects(verify(split, { verifyNeutral: async () => null }), /identity changed/);
  await assert.rejects(verify(split, { verifyNeutral: async () => ({ files: ['tests/b.test.mjs'], receipt: { ...receipt, recordDigest: 'e'.repeat(64) } }) }), /identity changed/);
  await assert.rejects(verify(split, { verifyNeutral: async () => ({ files: ['tests/b.test.mjs'], receipt: { ...receipt, key: 'x'.repeat(64) } }) }), /identity changed/);
  await assert.rejects(verify(split, { verifyNeutral: async () => ({ files: [], receipt }) }), /identity changed/);
  await assert.rejects(verify(split, { verifyNeutral: async () => { throw Error('Run revoked.'); } }), /Run revoked/);
});
