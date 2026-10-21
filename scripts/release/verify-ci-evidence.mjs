// Independent expectations and an authenticated digest are both required.
// This approves portable checks only; the installed release still has PC gates.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const REPOSITORY = 'fenerax/chunk-picker-rs3';
const WORKFLOW = '.github/workflows/release-check.yml';
const API_HOST = 'api.github.com';
const API_ROOT = `https://${API_HOST}/repos/${REPOSITORY}`;
const SUMMARY_NAME = 'release-ci-evidence.json';
const MAX_JSON = 4 * 1024 * 1024;
const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_API = 2 * 1024 * 1024;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const COUNT_KEYS = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
const GATES = ['source-tests', 'pack-integrity', 'scrubbed-save-startup', 'secret-scan'];
const BLOCKED = ['kit-practice', 'kit-gallery', 'kit-copied-startup', 'kit-install',
  'kit-pack-transition', 'kit-text-lane', 'pc-freeze', 'pc-activation'];
const refusal = () => new Error('CI evidence refused.');
const requireThat = condition => { if (!condition) throw refusal(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const identifier = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && positive(Number(value));
const hex = (value, pattern = HEX64) => typeof value === 'string' && pattern.test(value);
const named = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value) && !value.includes('..');

function keys(value, required, optional = []) {
  requireThat(object(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validateBindings(value) {
  keys(value, ['candidate', 'workflow', 'inputs']);
  const { candidate, workflow, inputs } = value;
  keys(candidate, ['commit', 'tree', 'testInventorySha256']);
  requireThat(hex(candidate.commit, HEX40) && hex(candidate.tree, HEX40) && hex(candidate.testInventorySha256));
  keys(workflow, ['path', 'sourceCommit', 'runId', 'attempt', 'event', 'ref']);
  requireThat(workflow.path === WORKFLOW && hex(workflow.sourceCommit, HEX40)
    && identifier(workflow.runId) && identifier(workflow.attempt)
    && ['push', 'workflow_dispatch'].includes(workflow.event)
    && typeof workflow.ref === 'string' && workflow.ref.length <= 256
    && /^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(workflow.ref)
    && !workflow.ref.includes('..'));
  if (workflow.event === 'push') requireThat(/^refs\/tags\/release-[A-Za-z0-9._-]+$/.test(workflow.ref)
    && workflow.sourceCommit === candidate.commit);
  keys(inputs, ['packPinSha256', 'packs', 'selection', 'savePinSha256', 'saveArchiveSha256', 'saveStateSha256']);
  requireThat(hex(inputs.packPinSha256) && hex(inputs.savePinSha256) && hex(inputs.saveArchiveSha256)
    && hex(inputs.saveStateSha256) && Array.isArray(inputs.packs) && inputs.packs.length > 0 && inputs.packs.length <= 100);
  const names = new Set();
  for (const pack of inputs.packs) {
    keys(pack, ['name', 'sha256', 'bytes']);
    requireThat(named(pack.name) && !names.has(pack.name) && hex(pack.sha256) && positive(pack.bytes));
    names.add(pack.name);
  }
  keys(inputs.selection, ['data', 'rulesText', 'art'], ['schemaVersion']);
  if (Object.hasOwn(inputs.selection, 'schemaVersion')) requireThat(inputs.selection.schemaVersion === 1);
  for (const kind of ['data', 'rulesText', 'art']) {
    const choice = inputs.selection[kind];
    keys(choice, ['id', 'version', 'sha256']);
    requireThat(named(choice.id) && named(choice.version) && hex(choice.sha256));
  }
}

function validateCounts(counts, allowSkippedFile = false) {
  keys(counts, COUNT_KEYS);
  requireThat(COUNT_KEYS.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
    && positive(counts.tests) && (allowSkippedFile || positive(counts.passed))
    && counts.failed === 0 && counts.cancelled === 0 && counts.todo === 0
    && counts.tests === counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo);
}

/** An expectation file is a separately approved local record, never artifact-derived. */
export function verifyEvidence(evidence, expected) {
  try {
    validateBindings(expected);
    keys(evidence, ['schema', 'repository', 'candidate', 'workflow', 'inputs', 'lanes', 'blockedGates']);
    requireThat(evidence.schema === 'rs3-release-ci-evidence-v1' && evidence.repository === REPOSITORY);
    const bindings = { candidate: evidence.candidate, workflow: evidence.workflow, inputs: evidence.inputs };
    validateBindings(bindings);
    requireThat(canonical(bindings) === canonical(expected));
    requireThat(Array.isArray(evidence.blockedGates) && evidence.blockedGates.length === BLOCKED.length
      && new Set(evidence.blockedGates).size === BLOCKED.length
      && BLOCKED.every(name => evidence.blockedGates.includes(name)));
    requireThat(Array.isArray(evidence.lanes) && evidence.lanes.length === 2);
    const operatingSystems = new Set();
    const executedFiles = new Set();
    let inventory;
    for (const lane of evidence.lanes) {
      keys(lane, ['os', 'node', 'gates']);
      requireThat(['linux', 'windows'].includes(lane.os) && !operatingSystems.has(lane.os)
        && typeof lane.node === 'string' && /^v24\.\d+\.\d+$/.test(lane.node)
        && Array.isArray(lane.gates) && lane.gates.length >= 3 && lane.gates.length <= GATES.length);
      operatingSystems.add(lane.os);
      const gates = new Set();
      for (const gate of lane.gates) {
        keys(gate, ['name', 'status'], ['reason', 'counts', 'files', 'inventorySha256']);
        requireThat(GATES.includes(gate.name) && !gates.has(gate.name) && gate.status === 'pass');
        gates.add(gate.name);
        if (Object.hasOwn(gate, 'reason')) requireThat(typeof gate.reason === 'string'
          && /^[a-z]+(?:-[a-z]+)*$/.test(gate.reason) && gate.reason.length <= 80);
        if (Object.hasOwn(gate, 'counts')) validateCounts(gate.counts);
        if (gate.name !== 'source-tests') {
          requireThat(!Object.hasOwn(gate, 'files') && !Object.hasOwn(gate, 'inventorySha256'));
          continue;
        }
        validateCounts(gate.counts);
        requireThat(hex(gate.inventorySha256) && gate.inventorySha256 === expected.candidate.testInventorySha256
          && Array.isArray(gate.files) && gate.files.length > 0 && gate.files.length <= 10000);
        const files = new Set();
        const total = Object.fromEntries(COUNT_KEYS.map(key => [key, 0]));
        for (const file of gate.files) {
          keys(file, ['file', 'passed', 'counts']);
          requireThat(typeof file.file === 'string' && /^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs$/.test(file.file)
            && !file.file.includes('..') && !files.has(file.file) && file.passed === true);
          files.add(file.file);
          validateCounts(file.counts, true);
          if (file.counts.passed > 0) executedFiles.add(file.file);
          for (const key of COUNT_KEYS) total[key] += file.counts[key];
        }
        requireThat(COUNT_KEYS.every(key => Number.isSafeInteger(total[key]) && total[key] === gate.counts[key]));
        const names = JSON.stringify([...files].sort());
        requireThat(digest(names) === gate.inventorySha256 && (inventory === undefined || names === inventory));
        inventory = names;
      }
      requireThat(GATES.slice(0, lane.os === 'linux' ? 4 : 3).every(name => gates.has(name)));
    }
    requireThat(JSON.parse(inventory).every(file => executedFiles.has(file)));
    return { verified: true, scope: 'portable-checks', releaseReady: false };
  } catch { throw refusal(); }
}

function parseJson(bytes) {
  requireThat(bytes.length > 0 && bytes.length <= MAX_JSON);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** The checksum must arrive through an independent trusted channel, not a sidecar. */
export function verifyOfflineEvidence(bytes, sha256, expected) {
  try {
    requireThat(Buffer.isBuffer(bytes) && bytes.length <= MAX_JSON && hex(sha256) && digest(bytes) === sha256);
    return verifyEvidence(parseJson(bytes), expected);
  } catch { throw refusal(); }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
  return index >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// No paths are written. A v4 artifact for this contract has exactly one member.
export function readEvidenceArchive(archive) {
  try {
    requireThat(Buffer.isBuffer(archive) && archive.length >= 22 && archive.length <= MAX_ARCHIVE);
    let end = -1;
    for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset--) {
      if (archive.readUInt32LE(offset) === 0x06054b50
        && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) { end = offset; break; }
    }
    requireThat(end >= 0 && archive.readUInt16LE(end + 4) === 0 && archive.readUInt16LE(end + 6) === 0
      && archive.readUInt16LE(end + 8) === 1 && archive.readUInt16LE(end + 10) === 1);
    const centralSize = archive.readUInt32LE(end + 12), central = archive.readUInt32LE(end + 16);
    requireThat(central + centralSize === end && centralSize >= 46 && central + 46 <= end
      && archive.readUInt32LE(central) === 0x02014b50);
    const flags = archive.readUInt16LE(central + 8), method = archive.readUInt16LE(central + 10);
    const checksum = archive.readUInt32LE(central + 16), compressed = archive.readUInt32LE(central + 20);
    const size = archive.readUInt32LE(central + 24), nameLength = archive.readUInt16LE(central + 28);
    const extraLength = archive.readUInt16LE(central + 30), commentLength = archive.readUInt16LE(central + 32);
    const attributes = archive.readUInt32LE(central + 38), mode = attributes >>> 16;
    requireThat((flags & ~0x080e) === 0 && [0, 8].includes(method) && size > 0 && size <= MAX_JSON
      && compressed <= MAX_ARCHIVE && archive.readUInt16LE(central + 34) === 0
      && archive.readUInt32LE(central + 42) === 0 && !(attributes & 0x10)
      && (!(mode & 0xf000) || (mode & 0xf000) === 0x8000)
      && 46 + nameLength + extraLength + commentLength === centralSize);
    const name = archive.subarray(central + 46, central + 46 + nameLength);
    requireThat(name.equals(Buffer.from(SUMMARY_NAME)));
    function extras(start, length) {
      const stop = start + length;
      while (start < stop) {
        requireThat(start + 4 <= stop);
        const type = archive.readUInt16LE(start), length = archive.readUInt16LE(start + 2);
        requireThat(type !== 1 && type !== 0x9901 && start + 4 + length <= stop);
        start += 4 + length;
      }
    }
    extras(central + 46 + nameLength, extraLength);
    requireThat(central >= 30 && archive.readUInt32LE(0) === 0x04034b50
      && archive.readUInt16LE(6) === flags && archive.readUInt16LE(8) === method);
    const localNameLength = archive.readUInt16LE(26), localExtraLength = archive.readUInt16LE(28);
    const data = 30 + localNameLength + localExtraLength;
    requireThat(data + compressed <= central && archive.subarray(30, 30 + localNameLength).equals(name));
    extras(30 + localNameLength, localExtraLength);
    if (flags & 8) {
      let descriptor = data + compressed;
      if (descriptor + 4 <= central && archive.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      requireThat(descriptor + 12 === central && archive.readUInt32LE(descriptor) === checksum
        && archive.readUInt32LE(descriptor + 4) === compressed && archive.readUInt32LE(descriptor + 8) === size);
    } else requireThat(data + compressed === central && archive.readUInt32LE(14) === checksum
      && archive.readUInt32LE(18) === compressed && archive.readUInt32LE(22) === size);
    const payload = archive.subarray(data, data + compressed);
    let bytes = payload;
    if (method === 8) {
      const result = inflateRawSync(payload, { maxOutputLength: MAX_JSON, info: true });
      requireThat(result.engine.bytesWritten === compressed);
      bytes = result.buffer;
    }
    requireThat(bytes.length === size && crc32(bytes) === checksum);
    return bytes;
  } catch { throw refusal(); }
}

async function boundedResponse(response, limit) {
  const length = response.headers.get('content-length');
  requireThat(length === null || (/^\d+$/.test(length) && Number(length) <= limit));
  requireThat(response.body !== null);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireThat(size <= limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function validateRun(run, expected) {
  const workflow = expected.workflow;
  requireThat(object(run) && String(run.id) === workflow.runId && positive(run.id)
    && run.run_attempt === Number(workflow.attempt) && run.path === WORKFLOW
    && run.head_sha === workflow.sourceCommit && run.event === workflow.event
    && run.status === 'completed' && run.conclusion === 'success'
    && run.head_branch === workflow.ref.replace(/^refs\/(?:heads|tags)\//, '')
    && object(run.repository) && run.repository.full_name === REPOSITORY && positive(run.repository.id)
    && object(run.head_repository) && run.head_repository.full_name === REPOSITORY
    && run.head_repository.id === run.repository.id);
}

function validateArtifact(artifact, run, artifactName) {
  requireThat(object(artifact) && positive(artifact.id) && artifact.name === artifactName && artifact.expired === false
    && positive(artifact.size_in_bytes) && artifact.size_in_bytes <= MAX_ARCHIVE
    && typeof artifact.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.digest)
    && object(artifact.workflow_run) && artifact.workflow_run.id === run.id
    && artifact.workflow_run.repository_id === run.repository.id
    && artifact.workflow_run.head_repository_id === run.repository.id
    && artifact.workflow_run.head_sha === run.head_sha && artifact.workflow_run.head_branch === run.head_branch);
}

/** HTTPS API metadata supplies the trusted ZIP digest; redirects never carry API credentials off-host. */
export async function verifyOnlineEvidence({ expected, runId, attempt,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, fetchImpl = globalThis.fetch }) {
  try {
    validateBindings(expected);
    requireThat(identifier(runId) && identifier(attempt) && runId === expected.workflow.runId
      && attempt === expected.workflow.attempt && typeof fetchImpl === 'function');
    const request = async (url, limit, redirects = false) => {
      for (let hop = 0; hop <= 3; hop++) {
        const target = new URL(url);
        requireThat(target.protocol === 'https:' && !target.username && !target.password && !target.port);
        const api = target.hostname === API_HOST;
        const headers = { Accept: api ? 'application/vnd.github+json' : 'application/octet-stream' };
        if (api) {
          headers['X-GitHub-Api-Version'] = '2022-11-28';
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetchImpl(target.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          requireThat(redirects && hop < 3 && response.headers.get('location'));
          await response.body?.cancel();
          url = new URL(response.headers.get('location'), target).href;
          continue;
        }
        requireThat(response.status === 200);
        return boundedResponse(response, limit);
      }
      throw refusal();
    };
    const json = async url => parseJson(await request(url, MAX_API));
    const run = await json(`${API_ROOT}/actions/runs/${runId}/attempts/${attempt}`);
    validateRun(run, expected);
    const artifactName = `release-ci-evidence-${expected.workflow.attempt}`;
    const listing = await json(`${API_ROOT}/actions/runs/${runId}/artifacts?per_page=100`);
    requireThat(object(listing) && Number.isSafeInteger(listing.total_count) && listing.total_count > 0
      && listing.total_count <= 100 && Array.isArray(listing.artifacts) && listing.artifacts.length === listing.total_count);
    const matches = listing.artifacts.filter(artifact => object(artifact) && artifact.name === artifactName);
    requireThat(matches.length === 1);
    validateArtifact(matches[0], run, artifactName);
    const artifact = await json(`${API_ROOT}/actions/artifacts/${matches[0].id}`);
    validateArtifact(artifact, run, artifactName);
    requireThat(artifact.id === matches[0].id && artifact.digest === matches[0].digest);
    const archive = await request(`${API_ROOT}/actions/artifacts/${artifact.id}/zip`, MAX_ARCHIVE, true);
    requireThat(digest(archive) === artifact.digest.slice(7));
    return verifyEvidence(parseJson(readEvidenceArchive(archive)), expected);
  } catch { throw refusal(); }
}

async function boundedFile(file) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile() && stat.size <= MAX_JSON);
    const bytes = Buffer.alloc(MAX_JSON + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    requireThat(length <= MAX_JSON);
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

async function main(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    requireThat(['--expect', '--file', '--sha256', '--run-id', '--attempt'].includes(args[index])
      && !flags.has(args[index]) && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--'));
    flags.set(args[index], args[index + 1]);
  }
  requireThat(flags.has('--expect'));
  const expected = parseJson(await boundedFile(flags.get('--expect')));
  let result;
  if (flags.has('--file')) {
    requireThat(flags.size === 3 && flags.has('--sha256'));
    result = verifyOfflineEvidence(await boundedFile(flags.get('--file')), flags.get('--sha256'), expected);
  } else {
    requireThat(flags.size === 3 && flags.has('--run-id') && flags.has('--attempt'));
    result = await verifyOnlineEvidence({ expected, runId: flags.get('--run-id'), attempt: flags.get('--attempt') });
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('CI evidence refused.'); process.exitCode = 1; });
}
