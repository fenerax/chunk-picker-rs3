// A no-op release rehearsal has its own scratch deployment envelope. It never
// adopts a live save, credential, origin, process owner or current-pointer path.
import path from 'node:path';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashTree, digestValue } from './release-identity.mjs';
import { gatePolicyDigest, defaultEvidenceDirectory } from './release-evidence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inside = (root, target) => { const rel = path.relative(path.resolve(root), path.resolve(target)); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

async function ordinary(target, absent = false) {
  if (!path.isAbsolute(target ?? '')) throw Error('Practice requires absolute paths.');
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory() && current !== path.resolve(target) || stat.isFile() && stat.nlink !== 1) throw Error('Practice refuses linked paths.');
      if (path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('Practice requires canonical paths.');
    } catch (error) { if (!absent || error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
async function pin(file) { await ordinary(file); return { path: file, sha256: sha(await readFile(file)) }; }
async function pinned(record) {
  if (!record || !hex(record.sha256)) throw Error('Practice requires a pinned file.');
  const actual = await pin(record.path);
  if (actual.sha256 !== record.sha256) throw Error('Practice input pin changed.');
  return record.path;
}

/** Stable across relocation and kit timestamps; all actual pipeline source bytes
 * and pinned wrapper bytes count. A fresh kit with identical tooling can reuse it. */
export async function practiceToolingDigest(kit) {
  return (await (await import('./tooling-certificate.mjs')).toolingIdentity(kit)).digest;
}

/** Shared adapter for any ordinary lane executed while certifying tooling. */
export async function practiceLaneOptions(options = {}, manifest = {}) {
  return { ...options, 'retry-once-in-isolation': (await import('./retry-policy.mjs')).resolveRetryPolicy(options, manifest) };
}

export async function readPracticeLive(current) {
  await ordinary(current);
  const pointer = await json(current);
  if (pointer.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(pointer.releaseId ?? '')) throw Error('Practice current pointer is invalid.');
  const configFile = await pinned(pointer.config), config = await json(configFile), release = path.dirname(configFile);
  const manifest = await json(path.join(release, 'release.json'));
  if (!/^[a-f0-9]{40}$/.test(manifest.revision ?? '') || manifest.releaseId !== pointer.releaseId || path.resolve(config.coreRoot) !== path.join(release, 'core')) throw Error('Practice requires an immutable live release.');
  for (const field of ['coreRoot', 'packsDir', 'dataDir', 'nodePath']) await ordinary(config[field]);
  await pinned(config.addons); await pinned(config.profile);
  return { current, pointer, config, configFile, release, manifest };
}

/** Snapshot immutable live references, never live save/credential/origin bytes. */
export async function payloadIdentity(current) {
  const files = {};
  for (const [name, file] of Object.entries({ config: current.configFile, manifest: path.join(current.release, 'release.json'),
    receipt: path.join(current.release, 'companion.json'), profile: current.config.profile.path, nodeExecutable: current.config.nodePath })) files[name] = (await pin(file)).sha256;
  const trees = {};
  for (const [name, root] of Object.entries({ core: current.config.coreRoot, packs: current.config.packsDir, addons: path.dirname(current.config.addons.path), text: path.join(current.release, 'text') })) trees[name] = (await hashTree(root)).digest;
  return { digest: digestValue({ schema: 'rs3-practice-live-payload-v1', revision: current.manifest.revision, files, trees }), revision: current.manifest.revision, liveConfigSha256: files.config };
}
export async function practiceLiveIdentity(live) {
  const current = await readPracticeLive(live.current);
  if (current.configFile !== live.configFile || current.pointer.config.sha256 !== live.pointer.config.sha256 || current.manifest.revision !== live.manifest.revision) throw Error('Practice current reference changed during inspection.');
  const payload = await payloadIdentity(current);
  if (payload.liveConfigSha256 !== current.pointer.config.sha256) throw Error('Practice live configuration changed during inspection.');
  return { digest: digestValue({ schema: 'rs3-practice-live-pair-v1', payload: payload.digest, pointer: (await pin(live.current)).sha256 }), revision: payload.revision,
    livePayloadDigest: payload.digest, liveConfigSha256: payload.liveConfigSha256 };
}

export const practicePhases = Object.freeze(['preflight', 'prepare', 'gates', 'helper dry run', 'rollback dry run']);

/** All exact lanes use the ordinary evidence store. Adapted live inputs remain
 * distinct through the existing complete lane keys, never a second lane engine.
 * The diagnostic input key here does not grant any test authority. */
export async function practiceLaneDirectory({ evidenceDir, kit, toolingDigest, liveIdentity, toleratedRegistrations = [], inventoryProof = null }) {
  if (!path.isAbsolute(evidenceDir ?? '') || !hex(toolingDigest) || !hex(liveIdentity?.digest)) throw Error('Practice lane inputs are invalid.');
  const trees = {};
  for (const name of ['checks/private-source', 'packs']) trees[name] = (await hashTree(path.join(kit, name))).digest;
  const key = digestValue({ schema: 'rs3-practice-lanes-v1', toolingDigest, livePairDigest: liveIdentity.digest, trees,
    toleratedRegistrations: [...toleratedRegistrations].sort((a, b) => digestValue(a).localeCompare(digestValue(b))), inventoryProof, gatePolicyDigest });
  const directory = path.resolve(evidenceDir);
  await ordinary(directory, true);
  return { directory, key };
}

/** Certificate adapters that execute an ordinary lane use its existing keys and
 * publisher. Tiny tooling fixtures never become a product-lane receipt. */
export async function practiceFileLane({ evidenceDir, ...lane }) {
  if (!path.isAbsolute(evidenceDir ?? '')) throw Error('Practice lane evidence root must be absolute.');
  return (await import('./file-test-lane.mjs')).runFileLane({ ...lane, directory: evidenceDir });
}

/** Adapter boundary permits tiny fixtures without invoking real gates/helpers. */
export async function runPractice({ live, output, toolingDigest, steps }) {
  if (!hex(toolingDigest) || !steps || practicePhases.some(name => typeof steps[name] !== 'function') || typeof steps.identity !== 'function') throw Error('Practice adapters are incomplete.');
  const startedAt = new Date().toISOString(), before = await steps.identity(live), phases = [];
  if (!hex(before?.digest)) throw Error('Practice live identity is invalid.');
  const context = { live, output, toolingDigest, phases, liveIdentityBefore: before, toleratedRegistrations: [] };
  let failure;
  try {
    for (const name of practicePhases) {
      const started = performance.now();
      const result = await steps[name](context);
      if (result?.passed !== true) throw Error('Practice phase did not verify: ' + name);
      phases.push({ name, passed: true, milliseconds: performance.now() - started });
    }
  } catch (error) { failure = error; }
  const after = await steps.identity(live);
  if (after?.digest !== before.digest) throw Error('Practice live identity changed; acceptance refused.');
  if (failure) throw failure;
  const body = { schema: 'rs3-release-practice-v1', status: 'no-op verified', phases, toolingDigest, gatePolicyDigest,
    livePairDigest: before.digest, revision: before.revision, liveIdentityBefore: before.digest, liveIdentityAfter: after.digest,
    ...(before.liveConfigSha256 ? { liveConfigSha256: before.liveConfigSha256, livePayloadDigest: before.livePayloadDigest } : {}),
    toleratedRegistrations: context.toleratedRegistrations,
    ...(context.practiceGateEvidence ? { practiceGateEvidence: context.practiceGateEvidence } : {}),
    ...(context.practiceInventoryProof ? { practiceInventoryProof: context.practiceInventoryProof } : {}),
    startedAt, completedAt: new Date().toISOString() };
  return { ...body, digest: digestValue(body) };
}

/** Preparation guard. Legacy callers may identify their pinned previous config
 * without a --current flag; that route rehashes the complete immutable payload. */
export async function assertPracticeAcceptance({ kit, current, evidenceDir, previousConfig, now = Date.now() }) {
  const directory = path.resolve(evidenceDir ?? defaultEvidenceDirectory(kit));
  const { assertToolingCertificate } = await import('./tooling-certificate.mjs');
  const { assertToolingContracts } = await import('./tooling-contracts.mjs');
  const certificate = await assertToolingCertificate({ kit, evidenceDir: directory, now });
  await assertToolingContracts({ kit, evidenceDir: directory, toolingDigest: certificate.toolingDigest });
  const { assertLiveBaseCompatibility } = await import('./live-base-compatibility.mjs');
  const compatibility = await assertLiveBaseCompatibility({ kit, current, previousConfig, evidenceDir: directory, toolingDigest: certificate.toolingDigest, now });
  return { ...certificate, compatibility };
}

/** Standalone tooling validation, ahead of a feature release. A certificate hit
 * skips its practice; changed assertions can still require focused contracts.
 * The bounded live check never substitutes for strict candidate test lanes. */
export async function practiceRelease(options, dependencies = {}) {
  for (const field of ['current', 'output', 'kit', 'repo']) if (!path.isAbsolute(options[field] ?? '')) throw Error('Practice requires --current, --output, --kit and --repo absolute paths.');
  const kit = path.resolve(options.kit), output = path.resolve(options.output);
  const live = await readPracticeLive(options.current);
  const protectedRoots = [kit, live.release, live.config.coreRoot, live.config.packsDir, live.config.dataDir,
    live.config.dataDir + '.dataset.json', live.config.publicOriginFile, live.current].filter(Boolean);
  for (const root of protectedRoots) if (inside(root, output) || inside(output, root)) throw Error('Practice output overlaps live or tooling inputs.');
  await ordinary(output, true);
  if (await exists(output)) throw Error('Practice output must be absent.');
  const evidenceDir = path.resolve(options['evidence-dir'] ?? defaultEvidenceDirectory(kit));
  for (const root of protectedRoots) if (inside(root, evidenceDir) || inside(evidenceDir, root)) throw Error('Practice evidence overlaps live or tooling inputs.');
  await mkdir(output);
  // Focused contracts follow the same flaky-file policy the CLI resolved for the gates.
  const retryOnceInIsolation = options['retry-once-in-isolation'];
  const { issueToolingCertificate, toolingIdentity } = await import('./tooling-certificate.mjs');
  const { runToolingContracts } = await import('./tooling-contracts.mjs');
  let contracts;
  const validate = dependencies.validate ?? (async identity => {
    contracts = await runToolingContracts({ kit, evidenceDir, output: path.join(output, 'contracts'), toolingDigest: identity.digest, retryOnceInIsolation });
    const { runToolingSmoke } = await import('./tooling-smoke.mjs');
    const smoke = await runToolingSmoke({ kit, current: options.current, repo: options.repo, evidenceDir,
      output: path.join(output, 'tooling-smoke'), toolingDigest: identity.digest });
    return { passed: true, cleanupVerified: true, inputDigest: identity.digest, checks: [...contracts.record.checks, ...smoke.checks], scope: smoke.scope };
  });
  const certificate = await issueToolingCertificate({ kit, evidenceDir, validate });
  // The test assertion digest is not the capability digest. Rechecking a changed
  // contract cannot grant or revoke capability by itself.
  if (!contracts && !dependencies.validate) contracts = await runToolingContracts({ kit, evidenceDir, output: path.join(output, 'contracts'), toolingDigest: certificate.toolingDigest, retryOnceInIsolation });
  const { checkLiveBaseCompatibility, assertLiveBaseCompatibility } = await import('./live-base-compatibility.mjs');
  let compatibility;
  try { compatibility = await assertLiveBaseCompatibility({ kit, current: options.current, evidenceDir, toolingDigest: certificate.toolingDigest }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!compatibility) {
    const { createLivePayloadContext, reopenLivePayloadContext } = await import('./live-payload-rules.mjs');
    const liveSource = path.join(path.resolve(live.release, '../..'), 'checks/private-source');
    const proof = await createLivePayloadContext({ liveSource, liveCore: live.config.coreRoot, liveRevision: live.manifest.revision });
    const livePayloadContext = await reopenLivePayloadContext(proof);
    compatibility = await (dependencies.compatibility ?? checkLiveBaseCompatibility)({ kit, current: options.current, repo: options.repo,
      evidenceDir, output: path.join(output, 'live-base'), livePayloadContext });
  }
  if ((await toolingIdentity(kit)).digest !== certificate.toolingDigest) throw Error('Practice tooling changed; final acceptance refused.');
  const report = { schema: 'rs3-tooling-practice-v2', passed: true, toolingDigest: certificate.toolingDigest,
    certificate: certificate.filename, practiceRuns: certificate.reused ? 0 : 1, certificateReused: certificate.reused,
    focusedContracts: contracts ? { reused: contracts.reused, evidence: contracts.filename } : null,
    compatibilityDigest: compatibility.digest, output };
  await save(path.join(output, 'practice-report.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Practice library: release-v2.mjs release --practice --kit ABS --current ABS --repo ABS --output ABSENT_SCRATCH');
  else { console.error('Invoke practice through release-v2.mjs release --practice.'); process.exitCode = 1; }
}
