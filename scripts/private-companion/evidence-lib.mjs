import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const REPOSITORY = 'fenerax/chunk-picker-rs3';
export const PREFIX = `repos/${REPOSITORY}`;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha256(JSON.stringify(value));
const hex40 = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const requiredSteps = ['Checkout exact SHA', 'Set up Node 24', 'Verify public checkout identity', 'Public quick', 'Public full'];
const runnerPaths = ['package.json', 'scripts/test.mjs', 'scripts/test-selection.mjs', 'scripts/test-run-environment.mjs', 'scripts/test-port-check.mjs'];
export class EvidenceRefusal extends Error {
  constructor(code) { super(`Hosted public evidence refused: ${code}.`); this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new EvidenceRefusal(code); };

// No arbitrary host, path, method, URL, header or shell is accepted here.
export async function ghGet(endpoint, { raw = false } = {}) {
  const tail = endpoint === PREFIX ? '' : endpoint.startsWith(PREFIX + '/') ? endpoint.slice(PREFIX.length) : null;
  const allowed = tail !== null && (tail === '' || /^\/actions\/workflows\/385300184$/.test(tail)
    || /^\/actions\/workflows\/385300184\/runs\?event=push&head_sha=[a-f0-9]{40}(?:&branch=[A-Za-z0-9%._/-]+)?&per_page=100&page=1$/.test(tail)
    || /^\/actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*(?:\/jobs\?per_page=100&page=[1-9][0-9]*)?)?$/.test(tail)
    || /^\/actions\/jobs\/[1-9][0-9]*\/logs$/.test(tail)
    || /^\/contents\/\.github\/workflows\/test\.yml\?ref=[a-f0-9]{40}$/.test(tail)
    || /^\/git\/commits\/[a-f0-9]{40}$/.test(tail)
    || /^\/git\/trees\/[a-f0-9]{40}\?recursive=1$/.test(tail));
  requireThat(allowed, 'endpoint-not-allowed');
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint], {
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      // gh stderr and child-process errors can contain authentication/URL details.
      if (error) return reject(new EvidenceRefusal('github-api-unavailable'));
      if (raw) return resolve(stdout);
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new EvidenceRefusal('github-api-invalid-json')); }
    });
  });
}

export async function loadPolicy() {
  return JSON.parse(await readFile(new URL('./approved-workflows.json', import.meta.url), 'utf8'));
}

export function validateArguments({ sha, ref, runId, attempt }) {
  requireThat(hex40(sha), 'full-lowercase-sha-required');
  if (ref !== undefined) {
    requireThat(typeof ref === 'string' && /^refs\/heads\/(?:main|checked-candidate\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(ref)
      && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.endsWith('.') && !ref.includes('@{'), 'approved-branch-ref-required');
  }
  requireThat(runId === undefined || positive(runId), 'invalid-run-id');
  requireThat(attempt === undefined || positive(attempt) && positive(runId), 'attempt-requires-run-id');
}

export async function verifyHostedEvidence(options, { get = ghGet, policy, now = Date.now() } = {}) {
  validateArguments(options);
  policy ??= await loadPolicy();
  requireThat(Number.isFinite(now), 'invalid-clock');
  const uniqueArray = (value, predicate) => Array.isArray(value) && value.every(predicate) && new Set(value).size === value.length;
  requireThat(policy && policy.schema === 'rs3-approved-hosted-policy-v1' && policy.repository === REPOSITORY
    && policy.repositoryId === 1420195470 && policy.workflowId === 385300184
    && policy.path === '.github/workflows/test.yml' && policy.nodeMajor === 24
    && typeof policy.id === 'string' && /^[a-z0-9-]+$/.test(policy.id)
    && Array.isArray(policy.requiredOS) && JSON.stringify(policy.requiredOS) === JSON.stringify(['ubuntu-latest', 'windows-latest'])
    && Array.isArray(policy.requiredSteps) && JSON.stringify(policy.requiredSteps) === JSON.stringify(requiredSteps)
    && uniqueArray(policy.approvedWorkflowSha256, value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    && policy.approvedWorkflowSha256.length > 0 && policy.approvedWorkflowSha256.length <= 128
    && Array.isArray(policy.runnerBlobs) && policy.runnerBlobs.length >= runnerPaths.length
    && policy.runnerBlobs.every(pin => pin && typeof pin.path === 'string' && /^(?:package\.json|scripts\/[a-z0-9.-]+\.mjs)$/.test(pin.path) && hex40(pin.sha))
    && new Set(policy.runnerBlobs.map(pin => pin.path)).size === policy.runnerBlobs.length
    && runnerPaths.every(name => policy.runnerBlobs.some(pin => pin.path === name))
    && uniqueArray(policy.revokedSHAs, hex40) && uniqueArray(policy.revokedRunIds, positive)
    && (policy.revokedBefore === null || typeof policy.revokedBefore === 'string' && Number.isFinite(Date.parse(policy.revokedBefore)))
    && Number.isSafeInteger(policy.maxRunAgeSeconds) && policy.maxRunAgeSeconds > 0
    && policy.receiptTTLSeconds === 300, 'invalid-approved-policy');
  const policyDigest = digest(policy);
  requireThat(!policy.revokedSHAs.includes(options.sha), 'revoked-sha');
  const repo = await get(PREFIX);
  requireThat(repo.id === policy.repositoryId && repo.full_name === REPOSITORY, 'wrong-repository');
  const workflow = await get(`${PREFIX}/actions/workflows/${policy.workflowId}`);
  requireThat(workflow.id === policy.workflowId && workflow.path === policy.path && workflow.state === 'active', 'wrong-or-disabled-workflow');
  let runId = options.runId;
  if (!runId) {
    const query = `event=push&head_sha=${options.sha}${options.ref ? '&branch=' + encodeURIComponent(options.ref.slice(11)) : ''}&per_page=100&page=1`;
    const result = await get(`${PREFIX}/actions/workflows/${policy.workflowId}/runs?${query}`);
    requireThat(Array.isArray(result.workflow_runs) && Number.isSafeInteger(result.total_count), 'invalid-run-list');
    requireThat(result.total_count <= 100, 'run-list-truncated-specify-run');
    const runs = result.workflow_runs.filter(run => run.head_sha === options.sha && run.event === 'push'
      && (!options.ref || run.head_branch === options.ref.slice(11)));
    requireThat(runs.length > 0, 'missing-run');
    runs.sort((a, b) => b.id - a.id);
    runId = runs[0].id; // Never fall back to an older green run after a newer failure.
  }
  requireThat(positive(runId) && !policy.revokedRunIds.includes(runId), 'invalid-or-revoked-run');
  const latest = await get(`${PREFIX}/actions/runs/${runId}`);
  const attempt = options.attempt ?? latest.run_attempt;
  requireThat(positive(attempt) && latest.run_attempt === attempt, 'wrong-or-superseded-attempt');
  const run = await get(`${PREFIX}/actions/runs/${runId}/attempts/${attempt}`);
  const branch = options.ref ?? `refs/heads/${run.head_branch}`;
  validateArguments({ sha: options.sha, ref: branch, runId, attempt });
  const identity = value => value?.id === policy.repositoryId && value?.full_name === REPOSITORY;
  const checkRun = value => {
    requireThat(value.id === runId && value.run_attempt === attempt && value.workflow_id === policy.workflowId
      && value.path === policy.path, 'wrong-workflow-run-or-attempt');
    requireThat(identity(value.repository) && identity(value.head_repository), 'wrong-run-repository');
    requireThat(value.event === 'push' && value.head_branch === branch.slice(11), 'wrong-event-or-branch');
    requireThat(value.head_sha === options.sha && value.head_commit?.id === options.sha, 'wrong-head-sha');
    requireThat(value.status === 'completed' && value.conclusion === 'success', 'run-not-successful');
    const completed = Date.parse(value.updated_at), created = Date.parse(value.created_at);
    requireThat(Number.isFinite(completed) && Number.isFinite(created) && completed >= created
      && completed <= now + 60000 && created <= now + 60000
      && now - completed <= policy.maxRunAgeSeconds * 1000, 'stale-or-invalid-run-time');
    requireThat(!policy.revokedBefore || created >= Date.parse(policy.revokedBefore), 'revoked-run-period');
  };
  checkRun(latest); checkRun(run);
  const contents = await get(`${PREFIX}/contents/${policy.path}?ref=${options.sha}`);
  requireThat(contents.type === 'file' && contents.path === policy.path && contents.encoding === 'base64'
    && typeof contents.content === 'string', 'missing-workflow-bytes');
  const workflowBytes = Buffer.from(contents.content, 'base64');
  const workflowSha256 = sha256(workflowBytes);
  requireThat(policy.approvedWorkflowSha256.includes(workflowSha256), 'unapproved-workflow-bytes');
  const workflowBlobSha = createHash('sha1').update(`blob ${workflowBytes.length}\0`).update(workflowBytes).digest('hex');
  requireThat(contents.sha === workflowBlobSha, 'inconsistent-workflow-blob');
  const commit = await get(`${PREFIX}/git/commits/${options.sha}`);
  requireThat(commit.sha === options.sha && hex40(commit.tree?.sha), 'wrong-commit-or-tree');
  const tree = await get(`${PREFIX}/git/trees/${commit.tree.sha}?recursive=1`);
  requireThat(tree.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree), 'missing-or-truncated-tree');
  const rows = tree.tree.map(({ path, mode, type, sha, size }) => ({ path, mode, type, sha, ...(size === undefined ? {} : { size }) }));
  requireThat(rows.every(row => typeof row.path === 'string' && hex40(row.sha))
    && new Set(rows.map(row => row.path)).size === rows.length, 'invalid-tree-inventory');
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireThat(rows.some(row => row.path === policy.path && row.sha === workflowBlobSha && row.type === 'blob'
    && row.mode === '100644'), 'workflow-not-in-candidate-tree');
  for (const pin of policy.runnerBlobs) {
    requireThat(rows.some(row => row.path === pin.path && row.sha === pin.sha && row.mode === '100644' && row.type === 'blob'), 'unapproved-public-runner');
  }
  const blobs = rows.filter(row => row.type === 'blob');
  requireThat(!rows.some(row => row.path === '.npmrc' || /(^|\/)node_modules(?:\/|$)/.test(row.path)
    || row.mode === '160000'), 'unapproved-npm-or-submodule-input');
  // The pinned selector readdir()s this directory and runs every direct *.test.mjs.
  const tests = blobs.filter(row => /^tests\/[^/]+\.test\.mjs$/.test(row.path));
  requireThat(tests.length > 0 && tests.every(row => row.mode === '100644'), 'missing-or-unsafe-test-inventory');
  const jobs = [];
  for (let page = 1; ; page++) {
    requireThat(page <= 20, 'jobs-pagination-limit');
    const result = await get(`${PREFIX}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
    requireThat(Array.isArray(result.jobs) && Number.isSafeInteger(result.total_count) && result.total_count >= 0, 'invalid-jobs-response');
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) { requireThat(jobs.length === result.total_count, 'invalid-jobs-count'); break; }
    requireThat(result.jobs.length === 100, 'incomplete-jobs-pagination');
  }
  requireThat(jobs.length === policy.requiredOS.length && new Set(jobs.map(job => job.id)).size === jobs.length, 'missing-or-extra-required-jobs');
  const requiredJobs = [];
  for (const os of policy.requiredOS) {
    const matches = jobs.filter(job => job.name === `Public full (${os})`);
    requireThat(matches.length === 1, 'missing-or-duplicate-required-job');
    const job = matches[0];
    requireThat(positive(job.id) && job.run_id === runId && job.run_attempt === attempt && job.head_sha === options.sha, 'wrong-job-sha-or-attempt');
    requireThat(job.status === 'completed' && job.conclusion === 'success', 'job-not-successful');
    requireThat(Array.isArray(job.labels) && job.labels.length === 1 && job.labels[0] === os
      && job.runner_group_id === 0 && job.runner_group_name === 'GitHub Actions', 'unapproved-runner');
    requireThat(Array.isArray(job.steps) && job.steps.length >= policy.requiredSteps.length, 'missing-steps');
    requireThat(job.steps.every(step => step.status === 'completed' && step.conclusion === 'success'
      && Number.isSafeInteger(step.number)), 'unsuccessful-or-skipped-step');
    requireThat(new Set(job.steps.map(step => step.number)).size === job.steps.length, 'duplicate-step-number');
    let previous = 0;
    for (const name of policy.requiredSteps) {
      const steps = job.steps.filter(step => step.name === name);
      requireThat(steps.length === 1 && steps[0].number > previous, 'missing-duplicate-or-reordered-required-step');
      previous = steps[0].number;
    }
    const log = await get(`${PREFIX}/actions/jobs/${job.id}/logs`, { raw: true });
    requireThat(typeof log === 'string', 'missing-job-log');
    const records = log.split(/\r?\n/).map(line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '')).filter(line => /^\{"checkoutSha":/.test(line));
    requireThat(records.length === 1, 'missing-or-ambiguous-checkout-provenance');
    let record; try { record = JSON.parse(records[0]); } catch { throw new EvidenceRefusal('invalid-checkout-provenance'); }
    requireThat(record.checkoutSha === options.sha && record.treeSha === commit.tree.sha && record.nodeMajor === 24, 'wrong-checkout-tree-or-node');
    requiredJobs.push({ id: job.id, name: job.name, os, nodeMajor: 24, checkoutSha: record.checkoutSha,
      treeSha: record.treeSha, fullStep: 'Public full', conclusion: 'success', logSha256: sha256(log) });
  }
  // Close the rerun/revocation race after collecting every attempt-bound observation.
  const finalRun = await get(`${PREFIX}/actions/runs/${runId}`);
  checkRun(finalRun);
  requireThat(finalRun.updated_at === latest.updated_at && finalRun.run_attempt === latest.run_attempt, 'run-changed-during-validation');
  return {
    schema: 'rs3-hosted-public-v1', verified: true, lane: 'public-full',
    source: { repositoryId: policy.repositoryId, repository: REPOSITORY, workflowId: policy.workflowId, path: policy.path,
      runId, attempt, event: 'push', branch, headSha: options.sha, treeSha: commit.tree.sha,
      url: `https://github.com/${REPOSITORY}/actions/runs/${runId}/attempts/${attempt}` },
    policy: { id: policy.id, digest: policyDigest, workflowSha256, runnerBlobInventoryDigest: digest(policy.runnerBlobs) },
    publicInventory: { digest: digest(blobs), testDigest: digest(tests), testCount: tests.length, blobCount: blobs.length },
    requiredJobs, verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + policy.receiptTTLSeconds * 1000).toISOString(),
    provenance: { transport: 'gh-api-get', fresh: true, attemptSpecificJobs: true, logs: 'github-job-endpoint',
      checkout: 'pinned-workflow-assertion-and-job-log', tree: 'github-git-commit-and-recursive-tree', revocation: 'local-approved-policy-plus-fresh-run-state' },
  };
}
