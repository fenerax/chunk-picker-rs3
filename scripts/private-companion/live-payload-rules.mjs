// Prior-live handling belongs to a pinned rehearsal context. Ordinary release
// inputs never acquire this context through a CLI flag or environment variable.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hashTree, digestValue, captureInputIdentity } from './release-identity.mjs';
import { reviewCoreOverlays, coreOverlaySha256 } from './core-overlay-guard.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw Error(message); };
const contexts = new WeakMap();
const sameRoot = (a, b) => typeof a === 'string' && typeof b === 'string' && path.isAbsolute(a) && path.isAbsolute(b)
  && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const contracts = new Set(['tests/release-pipeline-v2.test.mjs', 'tests/test-selection.test.mjs']);
export const livePayloadToolingPath = name => name.startsWith('scripts/') || contracts.has(name);
const toolingPath = livePayloadToolingPath;
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

/** Adding a rule never grants a legacy exemption implicitly. Its detector and
 * any grandfather reason must be declared together and reviewed as tooling. */
export function defineLivePayloadRule({ id, capability, priorLive = { treatment: 'must-satisfy' } }) {
  if (typeof id !== 'string' || !id || typeof capability !== 'string' || !capability
      || !['must-satisfy', 'grandfather'].includes(priorLive?.treatment)
      || priorLive.treatment === 'grandfather' && (typeof priorLive.reason !== 'string' || !priorLive.reason.trim())) fail('Live payload rule declaration refused.');
  return freeze({ id, capability, priorLive: { ...priorLive } });
}

export const livePayloadRules = freeze([
  defineLivePayloadRule({ id: 'core-test-overlay-review', capability: 'live-overlay-manifest', priorLive: {
    treatment: 'grandfather', reason: 'The unchanged live private test overlays predate explicit core-overlay review. Rehearsal retains the exact live core and private bytes; this is no review of a candidate overlay.' } }),
  defineLivePayloadRule({ id: 'registered-test-inventory', capability: 'live-test-registration', priorLive: {
    treatment: 'grandfather', reason: 'The tooling registration refers to a pinned tooling test absent from both original live test inventories. Rehearsal preserves the original live tests.' } }),
  defineLivePayloadRule({ id: 'declared-tooling-contract-overlay', capability: 'pinned-tooling-contract-substitution', priorLive: {
    treatment: 'grandfather', reason: 'Only the declared tooling contract slots are replaced by pinned branch tooling while the live application payload and core remain exact. This is no review of an ordinary candidate overlay.' } }),
]);
const rulesDigest = digestValue(livePayloadRules);
const rule = id => livePayloadRules.find(value => value.id === id) ?? fail('Unknown live payload rule: ' + id);
const state = context => contexts.get(context) ?? fail('Live payload capability refused.');
const map = tree => new Map(tree.files.map(file => [file.path, file]));
async function manifestBytes(kit) {
  if (!path.isAbsolute(kit ?? '')) fail('Absolute tooling kit required.');
  const file = path.join(kit, 'kit.json');
  const identity = await captureInputIdentity({ components: [{ name: 'manifest', file }] });
  const bytes = await readFile(file);
  if (sha(bytes) !== identity.components[0].files[0].sha256) fail('Live payload tooling manifest changed during inspection.');
  return bytes;
}
function toolingCoreTests(manifest, coreRepo) {
  if (manifest.coreRevision == null) return [];
  if (!path.isAbsolute(coreRepo ?? '') || !/^[a-f0-9]{40}$/.test(manifest.coreRevision)) fail('Live payload tooling core pin refused.');
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', coreRepo, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 ** 2 }).toString();
  if (git('rev-parse', '--verify', manifest.coreRevision + '^{commit}').trim() !== manifest.coreRevision) fail('Live payload tooling core pin unavailable.');
  return git('ls-tree', '-rz', manifest.coreRevision, '--', 'tests').split('\0')
    .map(row => /^(?:100644|100755) blob [a-f0-9]{40}\t(tests\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs)$/.exec(row)?.[1]).filter(Boolean);
}

async function snapshot(root) {
  if (!path.isAbsolute(root ?? '')) fail('Absolute live payload roots required.');
  return hashTree(path.resolve(root));
}
function lineage(live, source, tooling) {
  const expected = new Map([...live].filter(([name]) => !toolingPath(name)));
  if (tooling) { for (const [name, file] of tooling) if (toolingPath(name)) expected.set(name, file); }
  else { for (const [name, file] of live) if (toolingPath(name)) expected.set(name, file); }
  if (expected.size !== source.size || [...expected].some(([name, file]) => source.get(name)?.sha256 !== file.sha256)) fail('Practice source is not the exact live payload with declared tooling substitutions.');
}

/** This proof is data, not authority. Every consumer reopens its roots and
 * verifies the full digests and allowed source substitutions before use. */
export async function createLivePayloadContext({ liveSource, liveCore, liveRevision, source = liveSource, toolingInputs, liveIdentity = null }) {
  if (!/^[a-f0-9]{40}$/.test(liveRevision ?? '') || liveIdentity !== null && !hex(liveIdentity.digest)) fail('Exact live payload identity required.');
  const original = await snapshot(liveSource), core = await snapshot(liveCore);
  const target = sameRoot(source, liveSource) ? original : await snapshot(source);
  let tooling;
  if (toolingInputs !== undefined) {
    if (toolingInputs.schema !== 'rs3-practice-inputs-v1' || !path.isAbsolute(toolingInputs.kit ?? '') || !hex(toolingInputs.kitSha256)) fail('Live payload tooling proof refused.');
    const payload = await manifestBytes(toolingInputs.kit);
    const manifest = JSON.parse(payload.toString('utf8').replace(/^\uFEFF/, ''));
    const tree = await snapshot(path.join(toolingInputs.kit, 'checks/private-source'));
    if (manifest.schemaVersion !== 2 || sha(payload) !== toolingInputs.kitSha256 || tree.digest !== manifest.sourceTreeDigest) fail('Live payload tooling identity differs.');
    toolingCoreTests(manifest, toolingInputs.coreRepo);
    tooling = { root: path.join(toolingInputs.kit, 'checks/private-source'), digest: tree.digest,
      kit: toolingInputs.kit, kitSha256: toolingInputs.kitSha256, coreRepo: toolingInputs.coreRepo ?? null };
    lineage(map(original), map(target), map(tree));
  } else lineage(map(original), map(target));
  const body = { schema: 'rs3-practice-live-payload-v1', rulesDigest, liveRevision,
    liveSource: { root: path.resolve(liveSource), digest: original.digest }, liveCore: { root: path.resolve(liveCore), digest: core.digest },
    source: { root: path.resolve(source), digest: target.digest }, tooling: tooling ?? null, liveIdentity };
  const proof = freeze({ ...body, digest: digestValue(body) });
  // Repeat the input reads before handing a proof to another process.
  await reopenLivePayloadContext(proof);
  return proof;
}

export async function reopenLivePayloadContext(proof, { source, core, revision } = {}) {
  if (!proof || proof.schema !== 'rs3-practice-live-payload-v1') fail('Live payload proof required.');
  const { digest, ...body } = proof;
  if (!hex(digest) || digestValue(body) !== digest || proof.rulesDigest !== rulesDigest
      || !/^[a-f0-9]{40}$/.test(proof.liveRevision ?? '') || proof.liveIdentity !== null && !hex(proof.liveIdentity?.digest)) fail('Live payload proof identity differs.');
  const original = await snapshot(proof.liveSource?.root), originalCore = await snapshot(proof.liveCore?.root);
  const targetRoot = source ?? proof.source?.root;
  const target = sameRoot(targetRoot, proof.liveSource?.root) ? original : await snapshot(targetRoot);
  if (original.digest !== proof.liveSource.digest || originalCore.digest !== proof.liveCore.digest || target.digest !== proof.source?.digest) fail('Live payload proof input changed.');
  let tooling, introducedTests = new Set();
  if (proof.tooling !== null) {
    tooling = await snapshot(proof.tooling?.root);
    const payload = await manifestBytes(proof.tooling.kit);
    const manifest = JSON.parse(payload.toString('utf8').replace(/^\uFEFF/, ''));
    if (manifest.schemaVersion !== 2 || sha(payload) !== proof.tooling.kitSha256 || tooling.digest !== proof.tooling.digest
        || manifest.sourceTreeDigest !== tooling.digest
        || path.resolve(proof.tooling.root) !== path.resolve(proof.tooling.kit, 'checks/private-source')) fail('Live payload tooling changed.');
    introducedTests = new Set([...tooling.files.map(file => file.path), ...toolingCoreTests(manifest, proof.tooling.coreRepo)]);
  }
  lineage(map(original), map(target), tooling && map(tooling));
  const capability = Object.freeze({});
  contexts.set(capability, { proof: freeze(JSON.parse(JSON.stringify(proof))), live: map(original), core: map(originalCore), source: map(target), toolingFiles: tooling ? map(tooling) : null, introducedTests });
  await assertLivePayloadTarget(capability, { core, revision });
  return capability;
}

export async function assertLivePayloadTarget(context, { source, core, revision } = {}) {
  const { proof } = state(context);
  if (revision !== undefined && revision !== proof.liveRevision) fail('Live payload revision differs.');
  if (source !== undefined && (await snapshot(source)).digest !== proof.source.digest) fail('Live payload practice source differs.');
  if (core !== undefined && (await snapshot(core)).digest !== proof.liveCore.digest) fail('Live payload core differs.');
  return true;
}

/** A context can grandfather only a rule's own introduced capability. Unknown
 * rules fail closed; absent context and established live capabilities are strict. */
export function liveRuleHandling(context, id, subject) {
  const declaration = rule(id);
  if (context === undefined) return { rule: id, treatment: 'must-satisfy' };
  const s = state(context);
  let established;
  if (declaration.capability === 'live-overlay-manifest') established = s.live.has('tests/core-overlays.json');
  else if (declaration.capability === 'live-test-registration') {
    if (typeof subject !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(subject)) fail('Live registration subject refused.');
    established = s.live.has('tests/' + subject) || s.core.has('tests/' + subject) || !s.introducedTests.has('tests/' + subject);
  } else if (declaration.capability === 'pinned-tooling-contract-substitution') {
    const original = s.live.get(subject), target = s.source.get(subject), branch = s.toolingFiles?.get(subject);
    established = s.live.has('tests/core-overlays.json') || !contracts.has(subject) || !s.core.has(subject)
      || !original || !target || !branch || target.sha256 !== branch.sha256 || target.sha256 === original.sha256;
  } else fail('Unknown live payload capability.');
  return established || declaration.priorLive.treatment !== 'grandfather'
    ? { rule: id, treatment: 'must-satisfy' }
    : { rule: id, ...declaration.priorLive, identity: s.proof.digest, revision: s.proof.liveRevision,
      liveSourceDigest: s.proof.liveSource.digest, liveCoreDigest: s.proof.liveCore.digest };
}

export function livePayloadProof(context) { return state(context).proof; }

export function reviewLivePayloadOverlays({ livePayload, ...options }) {
  const findings = reviewCoreOverlays(options), tolerated = [];
  const handling = liveRuleHandling(livePayload, 'core-test-overlay-review');
  if (livePayload === undefined) return { findings, tolerated };
  const s = state(livePayload);
  const remaining = findings.filter(finding => {
    const name = finding.path, live = s.live.get(name), core = s.core.get(name), target = s.source.get(name);
    // Missing review is the sole introduced obligation. Each allowed input has
    // its own pinned lineage; invalid/stale review, core drift and undeclared
    // candidate bytes remain findings.
    if (finding.id !== 'overlay-unreviewed' || !live || !core || !target || sha(options.coreFiles.get(name)) !== core.sha256) return true;
    if (handling.treatment === 'grandfather' && live.sha256 === target.sha256) {
      tolerated.push({ ...handling, path: name, coreSha256: coreOverlaySha256(options.coreFiles.get(name)),
        liveCoreSha256: core.sha256, privateSha256: live.sha256, input: 'unchanged-live-overlay' });
      return false;
    }
    const contract = liveRuleHandling(livePayload, 'declared-tooling-contract-overlay', name), branch = s.toolingFiles?.get(name);
    if (contract.treatment !== 'grandfather' || !branch || branch.sha256 !== target.sha256) return true;
    tolerated.push({ ...contract, path: name, coreSha256: coreOverlaySha256(options.coreFiles.get(name)), liveCoreSha256: core.sha256,
      livePrivateSha256: live.sha256, privateSha256: target.sha256, targetPrivateSha256: target.sha256,
      branchToolingSha256: branch.sha256, branchKitSha256: s.proof.tooling.kitSha256, input: 'declared-tooling-contract-substitution' });
    return false;
  });
  return { findings: remaining, tolerated };
}
