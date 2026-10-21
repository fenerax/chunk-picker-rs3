// Off-PC Phase B (2026-10-20): imports a "Private neutral lane" Actions run as
// release evidence for the neutral files. Same shape as evidence-lib.mjs: only
// fresh `gh api` GETs on an endpoint allowlist, a pinned repository, workflow id
// and workflow bytes, the newest run for the exact (private, core) pair, and one
// record line from the job log that must equal what the PC computed itself.
// A saved file, a pasted record, a Claude cloud session's output or any other
// copy is never accepted: the only input is the GitHub API at release time.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { digestValue } from './release-identity.mjs';
import { openSources, readAllowlist, eligibleFiles, packIdentity, neutralKey } from './neutral-lane.mjs';

export const REPOSITORY = 'fenerax/chunk-picker-rs3-private-src';
export const PREFIX = `repos/${REPOSITORY}`;
const WORKFLOW_ID = 390918573, REPOSITORY_ID = 1426411428, WORKFLOW_PATH = '.github/workflows/private-neutral-lane.yml';
const requiredSteps = ['Checkout private tree', 'Resolve the pair', 'Checkout paired core', 'Set up Node 24.20.0', 'Neutral lane'];
const packSteps = ['Restore packs', 'Fetch packs', 'Save packs'];
// run.mjs imports these from the checkout; tools/ is outside the private export, so outside the key.
const runnerPaths = ['tools/lib/source-lib.mjs', 'tools/lib/real-values.mjs'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hex40 = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);

export class NeutralRefusal extends Error {
  constructor(code) { super(`Neutral lane evidence refused: ${code}.`); this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new NeutralRefusal(code); };

// Job logs always carry terminal escape sequences (runner colours), and gh 2.x
// refuses to print those unless told to. The log is parsed, never printed.
export const ghArgs = (endpoint, { raw = false } = {}) =>
  ['api', '--hostname', 'github.com', '--method', 'GET', ...(raw ? ['--allow-escape-sequences'] : []), endpoint];

// No arbitrary host, path, method, URL, header or shell is accepted here.
export async function ghGet(endpoint, { raw = false } = {}) {
  const tail = endpoint === PREFIX ? '' : endpoint.startsWith(PREFIX + '/') ? endpoint.slice(PREFIX.length) : null;
  const allowed = tail !== null && (tail === '' || tail === `/actions/workflows/${WORKFLOW_ID}`
    || new RegExp(`^/actions/workflows/${WORKFLOW_ID}/runs\\?event=workflow_dispatch&head_sha=[a-f0-9]{40}&per_page=100&page=1$`).test(tail)
    || /^\/actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*(?:\/jobs\?per_page=100&page=[1-9][0-9]*)?)?$/.test(tail)
    || /^\/actions\/jobs\/[1-9][0-9]*\/logs$/.test(tail)
    || /^\/contents\/(?:\.github\/workflows\/private-neutral-lane\.yml|tools\/lib\/(?:source-lib|real-values)\.mjs)\?ref=[a-f0-9]{40}$/.test(tail));
  requireThat(allowed, 'endpoint-not-allowed');
  return new Promise((resolve, reject) => {
    execFile('gh', ghArgs(endpoint, { raw }), {
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      // gh stderr and child-process errors can contain authentication/URL details.
      if (error) return reject(new NeutralRefusal('github-api-unavailable'));
      if (raw) return resolve(stdout);
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new NeutralRefusal('github-api-invalid-json')); }
    });
  });
}

export async function loadNeutralPolicy() {
  return JSON.parse(await readFile(new URL('./approved-neutral-workflow.json', import.meta.url), 'utf8'));
}

/** What the PC computed on its own: the pair, the key and the eligible files. */
export function validateExpected(expected) {
  requireThat(expected && hex40(expected.privateSha) && hex40(expected.coreSha), 'full-private-and-core-sha-required');
  requireThat(typeof expected.key === 'string' && /^[a-f0-9]{64}$/.test(expected.key), 'pc-key-required');
  requireThat(Array.isArray(expected.files) && expected.files.length > 0
    && expected.files.every(file => typeof file === 'string' && /^[A-Za-z0-9._-]+\.test\.mjs$/.test(file))
    && sameList(expected.files, [...new Set(expected.files)].sort()), 'sorted-unique-files-required');
  requireThat(['packs', 'no-packs'].includes(expected.packs), 'pack-mode-required');
}

function validatePolicy(policy) {
  const uniqueArray = (value, predicate) => Array.isArray(value) && value.every(predicate) && new Set(value).size === value.length;
  requireThat(policy && policy.schema === 'rs3-approved-neutral-policy-v1' && policy.repository === REPOSITORY
    && policy.repositoryId === REPOSITORY_ID && policy.workflowId === WORKFLOW_ID && policy.path === WORKFLOW_PATH
    && policy.node === 'v24.20.0' && typeof policy.id === 'string' && /^[a-z0-9-]+$/.test(policy.id)
    && sameList(policy.requiredSteps, requiredSteps) && sameList(policy.packSteps, packSteps)
    && policy.actor === 'fenerax' && sameList(policy.branches, ['main', 'neutral/<privateSha>'])
    && uniqueArray(policy.approvedWorkflowSha256, value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    && policy.approvedWorkflowSha256.length > 0 && policy.approvedWorkflowSha256.length <= 128
    && Array.isArray(policy.runnerBlobs) && sameList(policy.runnerBlobs.map(pin => pin?.path), runnerPaths)
    && policy.runnerBlobs.every(pin => hex40(pin.sha))
    && uniqueArray(policy.revokedSHAs, hex40) && uniqueArray(policy.revokedRunIds, positive)
    && (policy.revokedBefore === null || typeof policy.revokedBefore === 'string' && Number.isFinite(Date.parse(policy.revokedBefore)))
    && Number.isSafeInteger(policy.maxRunAgeSeconds) && policy.maxRunAgeSeconds > 0 && policy.maxRunAgeSeconds <= 30 * 86400
    && policy.receiptTTLSeconds === 300, 'invalid-approved-policy');
}

export async function verifyNeutralEvidence(expected, { get = ghGet, policy, now = Date.now() } = {}) {
  validateExpected(expected);
  policy ??= await loadNeutralPolicy();
  validatePolicy(policy);
  requireThat(Number.isFinite(now), 'invalid-clock');
  const { privateSha, coreSha } = expected;
  requireThat(!policy.revokedSHAs.includes(privateSha) && !policy.revokedSHAs.includes(coreSha), 'revoked-sha');
  const repo = await get(PREFIX);
  requireThat(repo.id === policy.repositoryId && repo.full_name === REPOSITORY && repo.private === true, 'wrong-repository');
  const workflow = await get(`${PREFIX}/actions/workflows/${policy.workflowId}`);
  requireThat(workflow.id === policy.workflowId && workflow.path === policy.path && workflow.state === 'active', 'wrong-or-disabled-workflow');

  // The newest dispatch for this exact pair wins; never an older green one after a newer failure.
  const title = `neutral allowlist core ${coreSha}`;
  const list = await get(`${PREFIX}/actions/workflows/${policy.workflowId}/runs?event=workflow_dispatch&head_sha=${privateSha}&per_page=100&page=1`);
  requireThat(Array.isArray(list.workflow_runs) && Number.isSafeInteger(list.total_count), 'invalid-run-list');
  requireThat(list.total_count <= 100, 'run-list-truncated');
  const runs = list.workflow_runs.filter(run => run.head_sha === privateSha && run.event === 'workflow_dispatch' && run.display_title === title);
  requireThat(runs.length > 0, 'missing-run');
  runs.sort((a, b) => b.id - a.id);
  const runId = runs[0].id;
  requireThat(positive(runId) && !policy.revokedRunIds.includes(runId), 'invalid-or-revoked-run');
  const latest = await get(`${PREFIX}/actions/runs/${runId}`);
  const attempt = latest.run_attempt;
  requireThat(positive(attempt), 'invalid-attempt');
  const run = await get(`${PREFIX}/actions/runs/${runId}/attempts/${attempt}`);
  const identity = value => value?.id === policy.repositoryId && value?.full_name === REPOSITORY;
  const branchOk = name => name === 'main' || name === `neutral/${privateSha}`;
  const checkRun = value => {
    requireThat(value.id === runId && value.run_attempt === attempt && value.workflow_id === policy.workflowId
      && value.path === policy.path, 'wrong-workflow-run-or-attempt');
    requireThat(identity(value.repository) && identity(value.head_repository), 'wrong-run-repository');
    // Claude cloud sessions push claude/* branches and act through an app: neither passes.
    requireThat(value.event === 'workflow_dispatch' && branchOk(value.head_branch), 'wrong-event-or-branch');
    requireThat(value.actor?.login === policy.actor && value.actor?.type === 'User'
      && value.triggering_actor?.login === policy.actor && value.triggering_actor?.type === 'User', 'unapproved-actor');
    requireThat(value.display_title === title, 'wrong-run-title');
    requireThat(value.head_sha === privateSha && value.head_commit?.id === privateSha, 'wrong-head-sha');
    requireThat(value.status === 'completed' && value.conclusion === 'success', 'run-not-successful');
    const completed = Date.parse(value.updated_at), created = Date.parse(value.created_at);
    requireThat(Number.isFinite(completed) && Number.isFinite(created) && completed >= created
      && completed <= now + 60000 && created <= now + 60000
      && now - completed <= policy.maxRunAgeSeconds * 1000, 'stale-or-invalid-run-time');
    requireThat(!policy.revokedBefore || created >= Date.parse(policy.revokedBefore), 'revoked-run-period');
  };
  checkRun(latest); checkRun(run);

  // Workflow bytes and the runner helpers outside the key, read at the run's commit.
  const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const contents = async name => {
    const value = await get(`${PREFIX}/contents/${name}?ref=${privateSha}`);
    requireThat(value.type === 'file' && value.path === name && value.encoding === 'base64' && typeof value.content === 'string', 'missing-pinned-bytes');
    const bytes = Buffer.from(value.content, 'base64');
    requireThat(value.sha === blobSha(bytes), 'inconsistent-pinned-blob');
    return { bytes, sha: value.sha };
  };
  const workflowFile = await contents(policy.path);
  const workflowSha256 = sha256(workflowFile.bytes);
  requireThat(policy.approvedWorkflowSha256.includes(workflowSha256), 'unapproved-workflow-bytes');
  for (const pin of policy.runnerBlobs) requireThat((await contents(pin.path)).sha === pin.sha, 'unapproved-runner-helper');

  const jobs = [];
  for (let page = 1; ; page++) {
    requireThat(page <= 5, 'jobs-pagination-limit');
    const result = await get(`${PREFIX}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
    requireThat(Array.isArray(result.jobs) && Number.isSafeInteger(result.total_count) && result.total_count >= 0, 'invalid-jobs-response');
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) { requireThat(jobs.length === result.total_count, 'invalid-jobs-count'); break; }
    requireThat(result.jobs.length === 100, 'incomplete-jobs-pagination');
  }
  requireThat(jobs.length === 1, 'missing-or-extra-jobs');
  const [job] = jobs;
  requireThat(job.name === 'neutral-lane' && positive(job.id) && job.run_id === runId && job.run_attempt === attempt
    && job.head_sha === privateSha, 'wrong-job-sha-or-attempt');
  requireThat(job.status === 'completed' && job.conclusion === 'success', 'job-not-successful');
  requireThat(Array.isArray(job.labels) && job.labels.length === 1 && job.labels[0] === 'ubuntu-latest'
    && job.runner_group_id === 0 && job.runner_group_name === 'GitHub Actions', 'unapproved-runner');
  requireThat(Array.isArray(job.steps) && job.steps.every(step => step.status === 'completed' && Number.isSafeInteger(step.number)
    && (step.conclusion === 'success' || step.conclusion === 'skipped' && packSteps.includes(step.name))), 'unsuccessful-or-skipped-step');
  requireThat(new Set(job.steps.map(step => step.number)).size === job.steps.length, 'duplicate-step-number');
  let previous = 0;
  for (const name of policy.requiredSteps) {
    const steps = job.steps.filter(step => step.name === name);
    requireThat(steps.length === 1 && steps[0].number > previous && steps[0].conclusion === 'success', 'missing-duplicate-or-reordered-required-step');
    previous = steps[0].number;
  }
  // With packs, the restore step ran (a cache hit skips only the fetch and the save).
  const restore = job.steps.filter(step => step.name === 'Restore packs');
  requireThat(restore.length === 1 && restore[0].conclusion === (expected.packs === 'packs' ? 'success' : 'skipped'), 'pack-steps-differ');

  const log = await get(`${PREFIX}/actions/jobs/${job.id}/logs`, { raw: true });
  requireThat(typeof log === 'string', 'missing-job-log');
  const lines = log.split(/\r?\n/).map(line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '')).filter(line => line.startsWith('{"neutralLane":'));
  requireThat(lines.length === 1, 'missing-or-ambiguous-record');
  let record; try { record = JSON.parse(lines[0]).neutralLane; } catch { throw new NeutralRefusal('invalid-record'); }
  requireThat(record?.schema === 'rs3-neutral-run-v1' && record.mode === 'allowlist' && record.passed === true, 'record-not-a-passing-allowlist-run');
  requireThat(record.privateSha === privateSha && record.coreSha === coreSha, 'record-pair-differs');
  requireThat(record.node === policy.node, 'record-node-differs');
  requireThat(record.packs === expected.packs, 'record-packs-differ');
  requireThat(record.key === expected.key, 'record-key-differs');
  const rows = Array.isArray(record.files) ? record.files : [];
  requireThat(sameList(rows.map(row => row?.file), expected.files), 'record-files-differ');
  requireThat(rows.every(row => row.passed === true && row.counts && row.counts.tests > 0 && row.counts.failed === 0
    && row.counts.skipped === 0 && row.counts.todo === 0 && row.counts.cancelled === 0), 'record-file-not-clean');

  // Close the rerun/revocation race after collecting every attempt-bound observation.
  const finalRun = await get(`${PREFIX}/actions/runs/${runId}`);
  checkRun(finalRun);
  requireThat(finalRun.updated_at === latest.updated_at && finalRun.run_attempt === latest.run_attempt, 'run-changed-during-validation');
  return {
    schema: 'rs3-neutral-import-v1', verified: true, lane: 'private-neutral',
    source: { repositoryId: policy.repositoryId, repository: REPOSITORY, workflowId: policy.workflowId, path: policy.path,
      runId, attempt, event: 'workflow_dispatch', branch: run.head_branch, privateSha, coreSha,
      url: `https://github.com/${REPOSITORY}/actions/runs/${runId}/attempts/${attempt}` },
    policy: { id: policy.id, digest: digestValue(policy), workflowSha256, runnerBlobDigest: digestValue(policy.runnerBlobs) },
    key: record.key, packs: record.packs, node: record.node,
    files: rows.map(row => ({ file: row.file, flaky: row.flaky === true, counts: row.counts })),
    jobId: job.id, logSha256: sha256(log), recordDigest: digestValue(record),
    verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + policy.receiptTTLSeconds * 1000).toISOString(),
    provenance: { transport: 'gh-api-get', fresh: true, attemptSpecificJobs: true, logs: 'github-job-endpoint',
      record: 'pinned-workflow-job-log', inputs: 'pc-computed-key' },
  };
}

/** The PC side, computed from the release's own inputs only: which files the
 * Actions run may stand in for, whether it needed packs, and the key it must print.
 * inventory is the full private inventory (basenames); packsRoot holds selection.json. */
export async function planNeutral({ core, privateSource, packsRoot, inventory, node = 'v24.20.0' }) {
  const view = await openSources({ core, privateSource });
  const { allowlist, sha256 } = await readAllowlist(view);
  if (!allowlist) return { files: [], refused: [], reason: 'no-allowlist' };
  const plan = await eligibleFiles(view, allowlist, inventory);
  if (!plan.files.length) return { files: [], refused: plan.refused, reason: 'nothing-eligible' };
  const needsPacks = plan.files.some(file => plan.verdicts.get(file).needsPacks || allowlist.files.find(entry => entry.file === file).qualifiedWith === 'packs');
  const { key } = await neutralKey({ view, node, packs: needsPacks ? await packIdentity(packsRoot) : null, files: plan.files });
  return { files: plan.files, refused: plan.refused, packs: needsPacks ? 'packs' : 'no-packs', key, allowlistSha256: sha256, verdicts: plan.verdicts };
}