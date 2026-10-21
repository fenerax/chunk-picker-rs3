// Phase B importer: every refusal path of verifyNeutralEvidence against a fake
// GitHub API. Nothing here reaches the network; ghGet is checked separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyNeutralEvidence, ghGet, ghArgs, NeutralRefusal, PREFIX } from '../scripts/private-companion/neutral-evidence.mjs';

const policy = JSON.parse(await readFile(new URL('../scripts/private-companion/approved-neutral-workflow.json', import.meta.url), 'utf8'));
const privateSha = 'a'.repeat(40), coreSha = 'c'.repeat(40), key = 'e'.repeat(64);
const now = Date.parse('2026-10-20T20:00:00Z');
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const workflowBytes = Buffer.from('name: Private neutral lane\n');
const helperBytes = { 'tools/lib/source-lib.mjs': Buffer.from('export {};\n'), 'tools/lib/real-values.mjs': Buffer.from('export const x = 1;\n') };
const testPolicy = () => ({ ...structuredClone(policy),
  approvedWorkflowSha256: [createHash('sha256').update(workflowBytes).digest('hex')],
  runnerBlobs: Object.entries(helperBytes).map(([path, bytes]) => ({ path, sha: blobSha(bytes) })) });
const expected = () => ({ privateSha, coreSha, key, files: ['alpha.test.mjs', 'beta.test.mjs'], packs: 'packs' });
const counts = { tests: 3, suites: 0, passed: 3, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
const record = () => ({ schema: 'rs3-neutral-run-v1', mode: 'allowlist', packs: 'packs', privateSha, coreSha, node: 'v24.20.0', key,
  files: [{ file: 'alpha.test.mjs', passed: true, flaky: false, counts }, { file: 'beta.test.mjs', passed: true, flaky: false, counts }], passed: true });

function world() {
  const repository = { id: 1426411428, full_name: 'fenerax/chunk-picker-rs3-private-src' };
  const run = { id: 77, run_attempt: 1, workflow_id: 390918573, path: '.github/workflows/private-neutral-lane.yml',
    repository, head_repository: repository, event: 'workflow_dispatch', head_branch: 'main',
    actor: { login: 'fenerax', type: 'User' }, triggering_actor: { login: 'fenerax', type: 'User' },
    display_title: `neutral allowlist core ${coreSha}`, head_sha: privateSha, head_commit: { id: privateSha },
    status: 'completed', conclusion: 'success', created_at: '2026-10-20T19:00:00Z', updated_at: '2026-10-20T19:20:00Z' };
  const steps = ['Set up job', 'Checkout private tree', 'Resolve the pair', 'Checkout paired core', 'Set up Node 24.20.0',
    'Restore packs', 'Fetch packs', 'Save packs', 'Neutral lane', 'Keep the summary', 'Complete job']
    .map((name, index) => ({ name, number: index + 1, status: 'completed', conclusion: ['Fetch packs', 'Save packs'].includes(name) ? 'skipped' : 'success' }));
  const job = { id: 900, name: 'neutral-lane', run_id: 77, run_attempt: 1, head_sha: privateSha, status: 'completed', conclusion: 'success',
    labels: ['ubuntu-latest'], runner_group_id: 0, runner_group_name: 'GitHub Actions', steps };
  return { repo: { ...repository, private: true }, workflow: { id: 390918573, path: run.path, state: 'active' },
    list: { total_count: 1, workflow_runs: [structuredClone(run)] }, run, attempt: structuredClone(run), final: null,
    jobs: { total_count: 1, jobs: [job] }, files: { [run.path]: workflowBytes, ...helperBytes },
    log: [`2026-10-20T19:10:00.0000000Z Node v24.20.0; 2 selected`, `2026-10-20T19:19:00.0000000Z ${JSON.stringify({ neutralLane: record() })}`, ''].join('\n') };
}
function fakeGet(w) {
  return async (endpoint, { raw = false } = {}) => {
    const tail = endpoint.slice(PREFIX.length);
    if (tail === '') return w.repo;
    if (tail === '/actions/workflows/390918573') return w.workflow;
    if (tail.startsWith('/actions/workflows/390918573/runs?')) return w.list;
    const runMatch = /^\/actions\/runs\/(\d+)(\/attempts\/1)?$/.exec(tail);
    if (runMatch && runMatch[1] !== '77') return w.extra[runMatch[1]];
    if (runMatch && runMatch[2]) return w.attempt;
    if (runMatch) { w.calls = (w.calls ?? 0) + 1; return w.final && w.calls > 1 ? w.final : w.run; }
    if (tail.startsWith('/actions/runs/77/attempts/1/jobs?')) return w.jobs;
    if (tail === '/actions/jobs/900/logs') { assert.equal(raw, true); return w.log; }
    const content = /^\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(tail);
    if (content && w.files[content[1]]) return { type: 'file', path: content[1], encoding: 'base64', content: w.files[content[1]].toString('base64'), sha: w.blob?.[content[1]] ?? blobSha(w.files[content[1]]) };
    throw Error('unexpected endpoint ' + tail);
  };
}
const verify = (w, change = {}) => verifyNeutralEvidence({ ...expected(), ...change.expected }, { get: fakeGet(w), policy: change.policy ?? testPolicy(), now: change.now ?? now });
const refuses = async (code, mutate, change) => {
  const w = world(); mutate?.(w);
  await assert.rejects(verify(w, change), error => error instanceof NeutralRefusal && error.code === code, code);
};
const both = (w, f) => { f(w.run); f(w.attempt); };
const relog = (w, f) => { const r = record(); f(r); w.log = `2026-10-20T19:19:00.0000000Z ${JSON.stringify({ neutralLane: r })}\n`; };

test('a passing allowlist dispatch for the exact pair verifies into a receipt', async () => {
  const receipt = await verify(world());
  assert.equal(receipt.schema, 'rs3-neutral-import-v1');
  assert.equal(receipt.source.runId, 77);
  assert.deepEqual(receipt.files.map(row => row.file), ['alpha.test.mjs', 'beta.test.mjs']);
  assert.equal(receipt.key, key);
  assert.equal(Date.parse(receipt.expiresAt) - Date.parse(receipt.verifiedAt), 300000);
});

test('a dispatch on the neutral/<privateSha> branch is accepted', async () => {
  const w = world(); both(w, run => { run.head_branch = `neutral/${privateSha}`; });
  assert.equal((await verify(w)).source.branch, `neutral/${privateSha}`);
});

test('the PC-computed expectations must be complete', async () => {
  await refuses('full-private-and-core-sha-required', null, { expected: { privateSha: 'abc' } });
  await refuses('pc-key-required', null, { expected: { key: 'nope' } });
  await refuses('sorted-unique-files-required', null, { expected: { files: ['beta.test.mjs', 'alpha.test.mjs'] } });
  await refuses('sorted-unique-files-required', null, { expected: { files: [] } });
  await refuses('pack-mode-required', null, { expected: { packs: 'maybe' } });
});

test('policy pins are enforced', async () => {
  await refuses('invalid-approved-policy', null, { policy: { ...testPolicy(), workflowId: 1 } });
  await refuses('invalid-approved-policy', null, { policy: { ...testPolicy(), receiptTTLSeconds: 3600 } });
  await refuses('invalid-approved-policy', null, { policy: { ...testPolicy(), actor: 'claude' } });
  await refuses('revoked-sha', null, { policy: { ...testPolicy(), revokedSHAs: [privateSha] } });
  await refuses('revoked-sha', null, { policy: { ...testPolicy(), revokedSHAs: [coreSha] } });
  await refuses('invalid-or-revoked-run', null, { policy: { ...testPolicy(), revokedRunIds: [77] } });
  await refuses('revoked-run-period', null, { policy: { ...testPolicy(), revokedBefore: '2026-10-20T19:30:00Z' } });
});

test('repository and workflow identity', async () => {
  await refuses('wrong-repository', w => { w.repo.id = 1; });
  await refuses('wrong-repository', w => { w.repo.private = false; });
  await refuses('wrong-or-disabled-workflow', w => { w.workflow.state = 'disabled_manually'; });
});

test('run selection: the newest run for the pair wins and must exist', async () => {
  await refuses('missing-run', w => { w.list.workflow_runs = []; });
  await refuses('missing-run', w => { w.list.workflow_runs[0].display_title = `neutral allowlist core ${'d'.repeat(40)}`; });
  await refuses('missing-run', w => { w.list.workflow_runs[0].display_title = `neutral candidates core ${coreSha}`; });
  await refuses('run-list-truncated', w => { w.list.total_count = 101; });
  // A newer failed run hides an older green one.
  await refuses('run-not-successful', w => {
    w.list.workflow_runs.push({ ...w.list.workflow_runs[0], id: 78 }); w.list.total_count = 2;
    w.extra = { 78: { ...structuredClone(w.run), id: 78, conclusion: 'failure' } };
  });
});

test('run checks: event, branch, actor, head, outcome and age', async () => {
  await refuses('wrong-event-or-branch', w => both(w, run => { run.event = 'push'; }));
  await refuses('wrong-event-or-branch', w => both(w, run => { run.head_branch = 'claude/neutral-lane'; }));
  await refuses('wrong-event-or-branch', w => both(w, run => { run.head_branch = `neutral/${'b'.repeat(40)}`; }));
  await refuses('unapproved-actor', w => both(w, run => { run.actor = { login: 'claude[bot]', type: 'Bot' }; }));
  await refuses('unapproved-actor', w => both(w, run => { run.triggering_actor = { login: 'someone', type: 'User' }; }));
  await refuses('wrong-head-sha', w => both(w, run => { run.head_commit = { id: 'b'.repeat(40) }; }));
  await refuses('run-not-successful', w => both(w, run => { run.conclusion = 'failure'; }));
  await refuses('wrong-run-repository', w => both(w, run => { run.head_repository = { id: 5, full_name: 'someone/fork' }; }));
  await refuses('stale-or-invalid-run-time', null, { now: now + 8 * 86400000 });
  await refuses('invalid-attempt', w => { w.run.run_attempt = 0; });
});

test('workflow bytes and runner helpers are pinned', async () => {
  await refuses('unapproved-workflow-bytes', w => { w.files['.github/workflows/private-neutral-lane.yml'] = Buffer.from('name: changed\n'); });
  await refuses('inconsistent-pinned-blob', w => { w.blob = { '.github/workflows/private-neutral-lane.yml': 'f'.repeat(40) }; });
  await refuses('unapproved-runner-helper', w => { w.files['tools/lib/source-lib.mjs'] = Buffer.from('export const changed = 1;\n'); });
});

test('the job: one GitHub-hosted job, every required step green and in order', async () => {
  await refuses('missing-or-extra-jobs', w => { w.jobs.jobs.push({ ...w.jobs.jobs[0], id: 901 }); w.jobs.total_count = 2; });
  await refuses('invalid-jobs-count', w => { w.jobs.total_count = 0; });
  await refuses('wrong-job-sha-or-attempt', w => { w.jobs.jobs[0].head_sha = 'b'.repeat(40); });
  await refuses('job-not-successful', w => { w.jobs.jobs[0].conclusion = 'failure'; });
  await refuses('unapproved-runner', w => { w.jobs.jobs[0].labels = ['self-hosted']; });
  await refuses('unapproved-runner', w => { w.jobs.jobs[0].runner_group_id = 3; });
  await refuses('unsuccessful-or-skipped-step', w => { w.jobs.jobs[0].steps.find(step => step.name === 'Neutral lane').conclusion = 'skipped'; });
  await refuses('missing-duplicate-or-reordered-required-step', w => { w.jobs.jobs[0].steps = w.jobs.jobs[0].steps.filter(step => step.name !== 'Checkout paired core'); });
  await refuses('missing-duplicate-or-reordered-required-step', w => {
    const steps = w.jobs.jobs[0].steps, a = steps.find(step => step.name === 'Resolve the pair'), b = steps.find(step => step.name === 'Checkout private tree');
    [a.number, b.number] = [b.number, a.number];
  });
  await refuses('duplicate-step-number', w => { w.jobs.jobs[0].steps[2].number = 2; });
  await refuses('pack-steps-differ', w => { w.jobs.jobs[0].steps.find(step => step.name === 'Restore packs').conclusion = 'skipped'; });
  await refuses('pack-steps-differ', null, { expected: { packs: 'no-packs' } });
});

test('the record must be one line and equal what the PC computed', async () => {
  await refuses('missing-or-ambiguous-record', w => { w.log = 'nothing here\n'; });
  await refuses('missing-or-ambiguous-record', w => { w.log += w.log; });
  await refuses('invalid-record', w => { w.log = '{"neutralLane":{oops\n'; });
  await refuses('record-not-a-passing-allowlist-run', w => relog(w, r => { r.mode = 'candidates'; }));
  await refuses('record-not-a-passing-allowlist-run', w => relog(w, r => { r.passed = false; }));
  await refuses('record-pair-differs', w => relog(w, r => { r.coreSha = 'd'.repeat(40); }));
  await refuses('record-pair-differs', w => relog(w, r => { r.privateSha = 'b'.repeat(40); }));
  await refuses('record-node-differs', w => relog(w, r => { r.node = 'v24.21.0'; }));
  await refuses('record-packs-differ', w => relog(w, r => { r.packs = 'no-packs'; }));
  await refuses('record-key-differs', w => relog(w, r => { r.key = 'f'.repeat(64); }));
  await refuses('record-files-differ', w => relog(w, r => { r.files.pop(); }));
  await refuses('record-files-differ', w => relog(w, r => { r.files.push({ ...r.files[0], file: 'gamma.test.mjs' }); }));
  await refuses('record-file-not-clean', w => relog(w, r => { r.files[0].counts = { ...counts, skipped: 1 }; }));
  await refuses('record-file-not-clean', w => relog(w, r => { r.files[1].counts = { ...counts, todo: 1 }; }));
  await refuses('record-file-not-clean', w => relog(w, r => { r.files[1].counts = { ...counts, tests: 0, passed: 0 }; }));
});

test('a rerun that lands during validation is refused', async () => {
  await refuses('run-changed-during-validation', w => { w.final = { ...structuredClone(w.run), updated_at: '2026-10-20T19:25:00Z' }; });
});

test('ghGet refuses anything off its allowlist before calling gh', async () => {
  for (const endpoint of ['repos/fenerax/chunk-picker-rs3', `${PREFIX}/actions/workflows/390825634`, `${PREFIX}/contents/app/server.mjs?ref=${privateSha}`,
    `${PREFIX}/actions/workflows/390918573/runs?event=push&head_sha=${privateSha}&per_page=100&page=1`, `${PREFIX}/actions/artifacts`, 'https://example.com'])
    await assert.rejects(ghGet(endpoint), error => error.code === 'endpoint-not-allowed', endpoint);
});

test('only the raw log read lets gh pass escape sequences through', () => {
  const log = `/actions/jobs/1/logs`;
  assert.deepEqual(ghArgs(log, { raw: true }), ['api', '--hostname', 'github.com', '--method', 'GET', '--allow-escape-sequences', log]);
  assert.deepEqual(ghArgs(PREFIX), ['api', '--hostname', 'github.com', '--method', 'GET', PREFIX]);
});
