// Read-only admission. In particular, gh writes neither an artifact nor a token
// to disk: the bounded ZIP goes straight to the existing verifier in memory.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvidenceArchive, verifyOnlineEvidence } from '../verify-ci-evidence.mjs';

const REPO = 'fenerax/chunk-picker-rs3';
const ROOT = `repos/${REPO}/actions`;
const CONSUMER = 'scripts/private-companion/release-ci-consumer.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const requireThat = (condition, gate) => { if (!condition) throw new Error(`${gate} refused.`); };
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(value) && !value.includes('..');
const numberId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
const inside = (root, target) => { const rel = path.relative(root, target); return !rel || rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

export function runReadOnly(executable, args, maxBuffer = 8 * 1024 ** 2) {
  return execFileSync(executable, args, { windowsHide: true, timeout: 60000, maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GIT_OPTIONAL_LOCKS: '0' } });
}

export async function regularPath(filename, { absent = false, directory = false } = {}) {
  requireThat(typeof filename === 'string' && path.isAbsolute(filename), 'paths');
  let target;
  for (let cursor = filename; ; cursor = path.dirname(cursor)) {
    try {
      const stat = await lstat(cursor);
      requireThat(!stat.isSymbolicLink(), 'paths');
      if (cursor === filename) target = stat;
      else requireThat(stat.isDirectory(), 'paths');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  if (absent) requireThat(!target, 'fresh-kit');
  else requireThat(target && (directory ? target.isDirectory() : target.isFile()), 'paths');
}

async function bytes(filename, limit = 4 * 1024 ** 2) {
  await regularPath(filename);
  const stat = await lstat(filename);
  requireThat(stat.size > 0 && stat.size <= limit, 'inputs');
  const value = await readFile(filename);
  requireThat(value.length <= limit, 'inputs');
  return value;
}

export async function preflight(options, { run = runReadOnly, kitState = options.goLive ? 'frozen' : 'absent' } = {}) {
  requireThat(identifier(options.release) && identifier(options.kit) && identifier(options.expectLive)
    && /^[a-f0-9]{40}$/.test(options.candidateCommit ?? '')
    && (options.runId === 'latest' || numberId(options.runId)), 'inputs');
  for (const key of ['checkout', 'current', 'kitsRoot', 'workRoot', 'evidenceDir', 'expectedEvidence', 'request', 'clock', 'watchdogLog', 'node', 'ps'])
    requireThat(typeof options[key] === 'string' && path.isAbsolute(options[key]), 'paths');
  const kitDir = path.join(options.kitsRoot, `relpipe-v2-staged-${options.kit}`);
  const workDir = path.join(options.workRoot, options.release, options.kit);
  // Neither fresh output may contain, replace or sit inside any other input.
  const inputs = ['checkout', 'current', 'evidenceDir', 'expectedEvidence', 'request', 'clock', 'watchdogLog', 'node', 'ps'].map(key => options[key]);
  requireThat(!inside(kitDir, workDir) && !inside(workDir, kitDir), 'paths');
  for (const output of [kitDir, workDir]) for (const input of inputs)
    requireThat(!inside(input, output) && !inside(output, input), 'paths');
  await regularPath(options.checkout, { directory: true });
  const currentBytes = await bytes(options.current);
  const pointer = JSON.parse(currentBytes);
  requireThat(pointer.releaseId === options.expectLive, 'live-id');
  requireThat(typeof pointer.config?.path === 'string' && path.isAbsolute(pointer.config.path), 'live-pointer');
  const previous = path.dirname(pointer.config.path);
  requireThat(!inside(kitDir, previous) && !inside(previous, kitDir)
    && !inside(workDir, previous) && !inside(previous, workDir), 'paths');
  await regularPath(kitDir, { absent: kitState === 'absent', directory: true });
  // Work is also single-use: stale downloads or source exports cannot be reused.
  await regularPath(workDir, { absent: kitState === 'absent', directory: true });
  for (const key of ['clock', 'watchdogLog', 'node', 'ps']) await regularPath(options[key]);
  const requestBytes = await bytes(options.request);
  const request = JSON.parse(requestBytes);
  requireThat(identifier(request.releaseId) && request.releaseId.startsWith(`${options.release}-`), 'request');
  const candidatePath = path.join(kitDir, 'releases', request.releaseId);
  const expectedBytes = await bytes(options.expectedEvidence);
  const expected = JSON.parse(expectedBytes);
  const git = (...args) => run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', options.checkout, ...args]);
  // status normally runs configured clean/process filters. Disable those as
  // well as fsmonitor, so candidate admission cannot launch checkout hooks.
  const configNames = git('config', '--null', '--list', '--name-only').toString('utf8').split('\0');
  const filterDrivers = new Set(configNames.map(name => /^filter\.(.+)\.[^.]+$/.exec(name)?.[1]).filter(Boolean));
  const filterOptions = [...filterDrivers].flatMap(name => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]);
  requireThat(git('rev-parse', 'HEAD').toString().trim() === options.candidateCommit
    && git(...filterOptions, 'status', '--porcelain', '--ignore-submodules=all').length === 0, 'candidate');
  const tree = git('rev-parse', `${options.candidateCommit}^{tree}`).toString().trim();
  const entries = git('ls-tree', '-r', '-z', options.candidateCommit).toString('utf8').split('\0').filter(Boolean);
  requireThat(entries.length > 0 && entries.every(entry => /^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry)), 'candidate');
  // discoverTests(full) currently inventories the immediate tests directory.
  // Git objects, rather than importing candidate code, keep preflight read-only.
  const names = entries.map(entry => entry.split('\t')[1]);
  const files = names.filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name)).sort();
  requireThat(files.length > 0 && canonical(expected.candidate) === canonical({ commit: options.candidateCommit, tree,
    testInventorySha256: hash(JSON.stringify(files)) }), 'candidate');
  const pinBytes = git('show', `${options.candidateCommit}:.github/packs/pack-pin.json`);
  const saveBytes = git('show', `${options.candidateCommit}:.github/packs/save-pin.json`);
  const pin = JSON.parse(pinBytes), save = JSON.parse(saveBytes);
  requireThat(pin.schema === 'rs3-ci-pack-pin-v1' && typeof pin.tag === 'string' && pin.assets?.length > 0
    && save.schema === 'rs3-ci-save-pin-v1' && typeof save.tag === 'string' && save.asset
    && expected.inputs?.packPinSha256 === hash(pinBytes) && expected.inputs?.savePinSha256 === hash(saveBytes)
    && expected.inputs?.saveArchiveSha256 === save.asset.sha256
    && canonical(expected.inputs?.packs) === canonical(pin.assets)
    && canonical(expected.inputs?.selection) === canonical(pin.selection), 'pins');
  requireThat(expected.workflow?.path === '.github/workflows/release-check.yml'
    && numberId(expected.workflow.runId) && numberId(expected.workflow.attempt), 'workflow');
  const gh = endpoint => run(options.gh || 'gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint,
    '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28']);
  let runId = options.runId;
  if (runId === 'latest') {
    // For a dispatch whose workflow source differs from the candidate, use an
    // explicit run ID. GitHub's head_sha filter describes the workflow source.
    requireThat(expected.workflow.sourceCommit === options.candidateCommit, 'latest-run');
    const listing = JSON.parse(gh(`${ROOT}/workflows/release-check.yml/runs?status=success&head_sha=${options.candidateCommit}&per_page=100`));
    requireThat(Array.isArray(listing.workflow_runs), 'latest-run');
    const selected = listing.workflow_runs.find(item => item.path === expected.workflow.path
      && item.head_sha === options.candidateCommit && item.status === 'completed' && item.conclusion === 'success');
    requireThat(selected && numberId(String(selected.id)), 'latest-run');
    runId = String(selected.id);
  }
  requireThat(runId === expected.workflow.runId, 'run-id');
  const latestAttempt = JSON.parse(gh(`${ROOT}/runs/${runId}`));
  requireThat(String(latestAttempt.id) === runId && String(latestAttempt.run_attempt) === expected.workflow.attempt
    && latestAttempt.status === 'completed' && latestAttempt.conclusion === 'success', 'run-attempt');
  let archive, artifact;
  const fetchImpl = async url => {
    const target = new URL(url);
    requireThat(target.origin === 'https://api.github.com' && target.pathname.startsWith(`/${ROOT}/`), 'github');
    const endpoint = target.pathname.slice(1) + target.search;
    const body = gh(endpoint);
    if (/\/artifacts\/[0-9]+\/zip$/.test(target.pathname)) archive = body;
    else if (/\/artifacts\/[0-9]+$/.test(target.pathname)) artifact = JSON.parse(body);
    return new Response(body);
  };
  const verified = await verifyOnlineEvidence({ expected, runId, attempt: expected.workflow.attempt, fetchImpl, token: undefined });
  const evidenceBytes = readEvidenceArchive(archive);
  const consumerAvailable = names.includes(CONSUMER);
  if (consumerAvailable) await regularPath(path.join(options.checkout, CONSUMER));
  if (kitState !== 'absent') {
    const manifest = JSON.parse(await bytes(path.join(candidatePath, 'release.json')));
    requireThat(manifest.revision === options.candidateCommit && manifest.releaseId === request.releaseId, 'staged-candidate');
    if (kitState === 'frozen') await regularPath(path.join(candidatePath, 'frozen-bundle.json'));
    // Do not inherit the old runner's first-match selection ambiguity.
    const { readdir } = await import('node:fs/promises');
    const siblings = (await readdir(path.join(kitDir, 'releases'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${options.release}-`));
    requireThat(siblings.length === 1 && siblings[0].name === request.releaseId, 'staged-candidate');
  }
  // Detect a moving pointer even during a network-only preflight.
  requireThat(hash(await bytes(options.current)) === hash(currentBytes), 'live-pointer');
  return { schema: 'rs3-release-ci-pc-inputs-v1', ...verified, runId, attempt: expected.workflow.attempt,
    releaseId: request.releaseId, kitDir, workDir, candidatePath, previous, consumerAvailable,
    currentPointerSha256: hash(currentBytes), requestSha256: hash(requestBytes), expectedSha256: hash(expectedBytes),
    evidenceSha256: hash(evidenceBytes), artifact: { id: artifact.id, digest: artifact.digest },
    expected, evidence: JSON.parse(evidenceBytes) };
}

export const consumerRelativePath = CONSUMER;

// JSON stdin avoids command-line quoting and avoids writing a preflight config.
async function main() {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; requireThat(input.length <= 12 * 1024 ** 2, 'inputs'); }
  const options = JSON.parse(input);
  const action = process.argv[2];
  requireThat(['preflight', 'stage', 'admit'].includes(action), 'inputs');
  if (action === 'preflight') console.log(JSON.stringify(await preflight(options)));
  else {
    const { consume } = await import('./ci-consumer.mjs');
    console.log(JSON.stringify(await consume(action, options)));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // No native stderr, JSON values, machine paths or credentials escape.
    const message = /^[a-z-]+ refused\.$/.test(error.message) ? error.message : 'CI inputs refused.';
    console.error(message); process.exitCode = 1;
  });
}
