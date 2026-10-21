// Capability evidence for executable release tooling. Candidate payload identity
// belongs to lane receipts and the separate live-base compatibility receipt.
import path from 'node:path';
import os from 'node:os';
import { readFile, lstat, mkdir, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digestValue, hashTree, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { regularInput } from './file-test-evidence.mjs';
import { gatePolicyDigest } from './release-evidence.mjs';
import { retryPolicyIdentity, resolveRetryPolicy } from './retry-policy.mjs';
import { literalModuleReferences } from './tooling-module-graph.mjs';
import { executableToolingBytes } from './tooling-executable-input.mjs';
import { additionalToolingContractTests } from './tooling-contract-catalog.mjs';
import { computedToolingTargets } from './tooling-computed-imports.mjs';
import { toolingSmokeChecks, toolingSmokeScope } from './tooling-smoke.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const json = async file => JSON.parse((await regularInput(file)).toString('utf8').replace(/^\uFEFF/, ''));
const inside = (root, file) => { const rel = path.relative(root, file); return !rel || !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
const slash = value => value.split(path.sep).join('/');
const optional = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

// These are subprocess/computed-import edges, beside ordinary static and literal
// dynamic imports. Application imports from a candidate are an explicit boundary:
// they are checked by exact-pair lanes, never made part of a tooling certificate.
export const toolingEntryPoints = Object.freeze([
  'tools/release-v2.mjs', 'tools/companion-check.mjs', 'tools/gallery-check.mjs',
  'tools/cutover-runbook.mjs',
  'tools/gallery-browser-check.mjs', 'tools/verify-install.mjs', 'tools/verify-github-evidence.mjs',
  'tools/release-early.mjs', 'tools/release-practice.mjs', 'tools/post-merge-private.mjs',
  'checks/private-source/scripts/test.mjs', 'checks/private-source/scripts/test-selection.mjs',
  'committed-core-tooling/scripts/test.mjs', 'committed-core-tooling/scripts/test-selection.mjs',
  'checks/private-source/scripts/adaptive-test-runner.mjs',
  'checks/private-source/scripts/build-private-addon.mjs', 'checks/private-source/scripts/build-dataset-profile.mjs',
  'checks/private-source/scripts/perf/cdp.mjs',
  'checks/private-source/scripts/private-companion/release-identity.mjs',
  'checks/private-source/scripts/public-export/scan.mjs', 'checks/private-source/scripts/public-export/fingerprints.mjs'
]);
// This required floor is executable policy and always remains in the capability
// hash. Additional literal assertion registrations are current-run inputs.
export const mandatoryToolingContractTests = Object.freeze([
  'release-pipeline-v2.test.mjs', 'release-runtime-v2.test.mjs', 'release-pack-upgrade-v2.test.mjs',
  'release-identity-v2.test.mjs', 'release-admission-v2.test.mjs', 'release-text-v2.test.mjs',
  'release-legacy-rollback.test.mjs', 'tooling-certificate.test.mjs', 'retry-policy.test.mjs',
  'live-payload-rules.test.mjs', 'live-base-compatibility.test.mjs', 'live-base-drift.test.mjs',
  'tooling-contracts.test.mjs', 'postmerge-retry-policy.test.mjs', 'tooling-smoke.test.mjs', 'owned-child-processes.test.mjs',
  'lane-test-evidence.test.mjs', 'lane-test-cleanup.test.mjs', 'lane-test-tooling.test.mjs', 'lane-test-splicing.test.mjs',
  'lane-test-peers.test.mjs', 'lane-test-integrity.test.mjs', 'lane-test-inputs.test.mjs', 'lane-test-fast.test.mjs',
  'postmerge-pair-worker.test.mjs', 'postmerge-pair-status.test.mjs', 'postmerge-pair-lane.test.mjs',
  'practice-reuse-store.test.mjs', 'practice-reuse-retry.test.mjs', 'private-drift.test.mjs', 'core-overlay-guard.test.mjs', 'test-selection-contract.test.mjs', 'cdp-scratch-port.test.mjs'
]);
export { additionalToolingContractTests };
export const toolingContractTests = Object.freeze([...mandatoryToolingContractTests, ...additionalToolingContractTests]);
if (new Set(toolingContractTests).size !== toolingContractTests.length
    || toolingContractTests.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(name))) throw Error('Tooling contract registrations must be unique test filenames.');

/** Follow dependencies by content, including a helper whose name says "test".
 * Bare non-builtin modules and paths escaping the kit fail closed. Every source
 * module's executable bytes are pinned; literal assertion registry interiors
 * are omitted only in capability mode. Raw focused-contract identities retain
 * them. Introducing a computed loader changes its key and
 * requires a reviewed update of the explicit subprocess edges above. */
export async function executableToolingClosure(kit, { entries = toolingEntryPoints, payloadBoundary = true } = {}) {
  kit = path.resolve(kit);
  const manifest = await json(path.join(kit, 'kit.json')).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  const readDependency = async (file, name) => {
    if (name.startsWith('committed-core-tooling/')) {
      if (!/^[a-f0-9]{40}$/.test(manifest.coreRevision ?? '')) throw Error('Exact core tooling revision required.');
      const coreRepo = manifest.toolingCoreRepo ?? 'C:/Users/User/Projects/chunk-picker-rs3-core';
      if (!path.isAbsolute(coreRepo)) throw Error('Tooling core object repository must be absolute.');
      const bytes = execFileSync('git', ['--no-optional-locks', '-C', coreRepo, 'show', manifest.coreRevision + ':' + name.slice('committed-core-tooling/'.length)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 ** 2, timeout: 10000 });
      return { bytes, origin: 'committed-core-tooling' };
    }
    try { return { bytes: await regularInput(file), origin: 'kit' }; }
    catch (error) {
      // The private tree is an additive complement. Runner helpers absent from
      // it come from the staged exact core commit. Pin their bytes, not that
      // feature commit's SHA, so an unchanged helper survives feature releases.
      const prefix = 'checks/private-source/';
      if (error.code !== 'ENOENT' || !name.startsWith(prefix + 'scripts/') || !/^[a-f0-9]{40}$/.test(manifest.coreRevision ?? '')) throw error;
      const coreName = name.slice(prefix.length), coreRepo = manifest.toolingCoreRepo ?? 'C:/Users/User/Projects/chunk-picker-rs3-core';
      if (!path.isAbsolute(coreRepo)) throw Error('Tooling core object repository must be absolute.');
      const bytes = execFileSync('git', ['--no-optional-locks', '-C', coreRepo, 'show', manifest.coreRevision + ':' + coreName],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 ** 2, timeout: 10000 });
      return { bytes, origin: 'committed-core-tooling' };
    }
  };
  const files = new Map(), pending = [...entries];
  while (pending.length) {
    const name = pending.pop(), file = path.resolve(kit, name);
    if (!inside(kit, file)) throw Error('Tooling dependency escapes kit.');
    const portable = slash(path.relative(kit, file));
    if (files.has(portable)) continue;
    const { bytes, origin } = await readDependency(file, portable);
    files.set(portable, { path: portable, sha256: sha(payloadBoundary ? executableToolingBytes(portable, bytes) : bytes), origin });
    if (!/\.[cm]?js$/.test(file)) continue;
    const source = bytes.toString('utf8');
    const { references, strings, computed } = literalModuleReferences(source);
    if (payloadBoundary) for (const expression of computed) pending.push(...computedToolingTargets(portable, expression));
    for (const ref of references) {
      if (ref.startsWith('node:')) continue;
      if (!ref.startsWith('.')) throw Error('Unmodeled tooling module dependency.');
      const resolved = path.resolve(path.dirname(file), ref);
      if (!inside(kit, resolved)) throw Error('Tooling dependency escapes kit.');
      const relative = slash(path.relative(kit, resolved));
      // Builder imports are contracts with candidate application modules.
      if (payloadBoundary && ['checks/private-source/app/', 'committed-core-tooling/app/'].some(prefix => relative.startsWith(prefix))) continue;
      pending.push(relative);
    }
    // Literal child-process tool paths (ordinary imports above cover their helpers).
    if (payloadBoundary) for (const value of strings) if (/^tools\/[a-zA-Z0-9._/-]+\.mjs$/.test(value)) pending.push(value);
  }
  // Operator scripts use dot-sourcing, script blocks and computed command paths.
  // Treat the executable operator directory as one conservative closure node.
  const walk = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + '/' + entry.name, file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Linked tooling dependency refused.');
      if (entry.isDirectory()) await walk(file, name);
      else if (/\.(?:ps1|psm1|mjs|cjs|js|json)$/i.test(name) && !/\.(?:test|spec)\.[^.]+$/.test(name)) {
        files.set(name, { path: name, sha256: sha(await regularInput(file)) });
      }
    }
  };
  await walk(path.join(kit, 'operator'), 'operator');
  for (const name of ['checks/private-source/scripts/public-export/placeholder-provenance.json',
    'checks/private-source/scripts/public-export/reviewed-exceptions.json', 'tools/approved-workflows.json', 'tools/approved-neutral-workflow.json']) {
    if (await optional(path.join(kit, name))) files.set(name, { path: name, sha256: sha(await regularInput(path.join(kit, name))) });
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function executableOnPath(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const output = execFileSync(command, [name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  const file = output.trim().split(/\r?\n/)[0];
  if (!path.isAbsolute(file)) throw Error('Toolchain executable unavailable.');
  return file;
}

export async function toolingIdentity(kit, { entries, platformIdentity } = {}) {
  if (!path.isAbsolute(kit ?? '')) throw Error('Absolute tooling kit required.');
  const manifest = await json(path.join(kit, 'kit.json'));
  const closure = await executableToolingClosure(kit, entries ? { entries } : {}), wrappers = {};
  for (const lane of ['heavy', 'light']) {
    const record = manifest.locks?.[lane], file = record?.path ?? path.join(kit, 'operator/with-' + lane + '.ps1');
    const digest = sha(await regularInput(file));
    if (record && record.sha256 !== digest) throw Error('Tooling wrapper pin changed.');
    // External wrappers are supported only as self-contained scripts. Dot-source
    // or call-operator script dependencies require an in-kit pinned operator tree.
    if (!inside(path.resolve(kit), path.resolve(file)) && /(?:^|[;\r\n])\s*\.\s+["'$]|\&\s*["'][^"']+\.ps1/i.test((await regularInput(file)).toString('utf8'))) throw Error('External wrapper dependency must be pinned inside the kit.');
    wrappers[lane] = digest;
  }
  const browserPath = manifest.browser?.path ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = { executable: sha(await readFile(browserPath)) };
  if (path.basename(browserPath).toLowerCase() === 'chrome.exe' && path.basename(path.dirname(browserPath)).toLowerCase() === 'application') {
    // Chrome's executable loads versioned DLL/resource files beside itself.
    // Hash those installed bytes too; never visit a browser profile directory.
    const tree = await hashTree(path.dirname(browserPath));
    browser.dependencies = tree.files.filter(row => /\.(?:exe|dll|pak|bin|dat|manifest|json)$/i.test(row.path)).map(row => ({ path: row.path, sha256: row.sha256 }));
  }
  let platform = platformIdentity;
  if (!platform) {
    const binaries = {};
    for (const [name, file] of Object.entries({ node: process.execPath, git: executableOnPath('git'),
      ...(process.platform === 'win32' ? { powershell: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') } : {}) })) {
      binaries[name] = sha(await readFile(file));
    }
    // Scratch home/temp locations are transport, not execution behavior.
    const env = sanitizeExecutionEnvironment();
    for (const key of Object.keys(env)) if (/^(?:TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)) delete env[key];
    let windowsBuild = null, powershellRuntime = null;
    if (process.platform === 'win32') {
      const runtime = JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-Command', "$v=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; @{build=([string]$v.CurrentBuildNumber+'.'+[string]$v.UBR);psVersion=[string]$PSVersionTable.PSVersion;clrVersion=[string][Environment]::Version;core=[Environment].Assembly.Location;system=[ComponentModel.Win32Exception].Assembly.Location;shell=[Management.Automation.PSObject].Assembly.Location;compiler=(Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe')} | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }));
      windowsBuild = runtime.build;
      if (!/^\d+\.\d+$/.test(windowsBuild)) throw Error('Windows build identity unavailable.');
      powershellRuntime = { psVersion: runtime.psVersion, clrVersion: runtime.clrVersion, assemblies: {} };
      for (const name of ['core', 'system', 'shell', 'compiler']) powershellRuntime.assemblies[name] = sha(await readFile(runtime[name]));
      const clr = path.join(path.dirname(runtime.core), 'clr.dll');
      if (await optional(clr)) powershellRuntime.assemblies.clr = sha(await readFile(clr));
    }
    platform = { platform: process.platform, arch: process.arch, osRelease: os.release(), osVersion: os.version(), windowsBuild, powershellRuntime,
      node: process.version, versions: process.versions, binaries, environment: Object.fromEntries(Object.entries(env).map(([name, value]) => [name, sha(value)])) };
  }
  const identity = { schema: 'rs3-tooling-identity-v2', closure, wrappers, browser, platform, gatePolicyDigest,
    retryPolicy: { version: retryPolicyIdentity, enabled: resolveRetryPolicy({}, manifest) }, concurrency: manifest.concurrency ?? 6, memoryAdmission: manifest.memoryAdmission ?? null,
    corpus: (await hashTree(path.join(kit, 'release-gate/corpus'))).digest };
  return { ...identity, digest: digestValue(identity) };
}

export function classifyToolingChanges(before, after, changedPaths = []) {
  const executableChanged = before.digest !== after.digest;
  const assertions = changedPaths.filter(name => /(?:^|\/)(?:tests\/|[^/]+\.(?:test|spec)\.)/.test(name));
  const toolingDocs = changedPaths.some(name => /^(?:tools|operator|checks\/private-source\/scripts\/private-companion)\/.*\.(?:md|txt)$/i.test(name));
  const focused = toolingDocs ? toolingContractTests.map(name => 'tests/' + name) : assertions;
  return { needsCertificate: executableChanged, practiceRuns: executableChanged ? 1 : 0,
    focusedContractTests: focused, reason: executableChanged ? 'executable-tooling-input-changed' : 'executable-tooling-identical' };
}

export async function safeEvidenceRoot(directory) {
  if (!path.isAbsolute(directory ?? '')) throw Error('Certificate evidence root must be absolute.');
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = await optional(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('Certificate evidence refuses linked or non-directory ancestors.');
    if (current === path.dirname(current)) break;
  }
}
const certificateFile = (directory, digest) => path.join(path.resolve(directory), 'tooling-certificates', digest + '.json');
async function revocation(directory, digest) {
  const file = path.join(path.resolve(directory), 'tooling-revocations', digest + '.json');
  if (await optional(file)) { await regularInput(file); throw Error('Tooling certificate revoked.'); }
}
function verifyCertificate(record, digest, now) {
  const { digest: checksum, ...body } = record;
  if (record.schema !== 'rs3-tooling-certificate-v2' || checksum !== digestValue(body) || record.toolingDigest !== digest
    || record.passed !== true || record.waiver || !Number.isFinite(Date.parse(record.completedAt)) || Date.parse(record.completedAt) > now
    || !Number.isFinite(Date.parse(record.startedAt)) || Date.parse(record.startedAt) > Date.parse(record.completedAt)
    || record.validation?.passed !== true || record.validation.cleanupVerified !== true || !hex(record.validation.inputDigest)
    || record.validation.inputDigest !== digest || !Array.isArray(record.validation.checks) || !record.validation.checks.length
    || record.validation.scope !== toolingSmokeScope
    || digestValue(record.validation.checks.map(row => row.name)) !== digestValue(['focused-tooling-contracts', ...toolingSmokeChecks])
    || record.validation.checks.some(check => check.passed !== true || !hex(check.evidenceDigest))) throw Error('Tooling certificate incomplete or corrupt.');
}

export async function assertToolingCertificate({ kit, evidenceDir, now = Date.now(), identityOptions }) {
  if (!Number.isFinite(now)) throw Error('Certificate clock invalid.');
  await safeEvidenceRoot(evidenceDir);
  const identity = await toolingIdentity(kit, identityOptions), filename = certificateFile(evidenceDir, identity.digest);
  await revocation(evidenceDir, identity.digest);
  if (await optional(filename + '.pending')) throw Error('Tooling certificate validation pending.');
  if ((await lstat(filename)).size > 2 * 1024 ** 2) throw Error('Tooling certificate oversized.');
  const record = await json(filename);
  verifyCertificate(record, identity.digest, now);
  return { filename, record, toolingDigest: identity.digest };
}

const attemptSchema = 'rs3-tooling-certificate-attempt-v1';
async function claimCertificateAttempt(pending) {
  const claim = () => writeFile(pending, JSON.stringify({ schema: attemptSchema, ownerPid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  try { return await claim(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  // An interrupted issuer left its marker. Only a provably dead owner is moved aside.
  await recoverDeadToolingCertificateAttempt(pending);
  try { return await claim(); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Another tooling certificate attempt claimed the marker during recovery.'); throw error; }
}
/** Mirrors recoverDeadLiveBaseAttempt: never replaces a live or unknown owner,
 * serializes recoverers with an exclusive file and keeps the old marker as
 * `.failed-<uuid>` evidence. Markers before v1 recorded only `pid`. */
export async function recoverDeadToolingCertificateAttempt(pending) {
  if (!path.isAbsolute(pending ?? '') || !path.basename(pending).endsWith('.json.pending')) throw Error('Explicit tooling certificate pending path required.');
  const recovery = pending + '.recovery';
  try { await writeFile(recovery, JSON.stringify({ ownerPid: process.pid, token: randomUUID() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A tooling certificate recovery is active or was interrupted: ' + recovery); throw error; }
  try {
    const bytes = await regularInput(pending);
    let attempt;
    try { attempt = JSON.parse(bytes.toString('utf8')); } catch { attempt = null; }
    const ownerPid = attempt?.schema === attemptSchema ? attempt.ownerPid : attempt?.pid;
    if (!Number.isInteger(ownerPid) || ownerPid < 1) throw Error('Tooling certificate attempt owner cannot be established: ' + pending);
    try { process.kill(ownerPid, 0); throw Error('Tooling certificate attempt owner ' + ownerPid + ' is still alive; recovery refused.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (sha(await regularInput(pending)) !== sha(bytes)) throw Error('Tooling certificate attempt changed during recovery.');
    const retained = pending + '.failed-' + randomUUID(); await rename(pending, retained);
    return { recovered: true, retained, ownerPid };
  } finally { await unlink(recovery); }
}

/** Validation callback is an in-process test seam;the CLI has no accept/waive
 * switch. Publish once with wx, rehash after validation, and honour revocations
 * before and after execution. A second caller reuses the same certificate. */
export async function issueToolingCertificate({ kit, evidenceDir, validate, identityOptions }) {
  await safeEvidenceRoot(evidenceDir);
  const identity = await toolingIdentity(kit, identityOptions), filename = certificateFile(evidenceDir, identity.digest);
  await revocation(evidenceDir, identity.digest);
  if (await optional(filename)) return { ...await assertToolingCertificate({ kit, evidenceDir, identityOptions }), reused: true };
  if (typeof validate !== 'function') throw Error('Tooling certificate requires executable validation.');
  const directory = path.dirname(filename); await safeEvidenceRoot(directory); await mkdir(directory, { recursive: true });
  const lock = filename + '.pending';
  // A pending/failing issuer never authorizes a stale pass or another issuer.
  await claimCertificateAttempt(lock);
  const startedAt = new Date().toISOString();
  let record;
  try {
    const validation = await validate(identity);
    if ((await toolingIdentity(kit, identityOptions)).digest !== identity.digest) throw Error('Tooling changed during certificate validation.');
    await revocation(evidenceDir, identity.digest);
    const body = { schema: 'rs3-tooling-certificate-v2', passed: true, toolingDigest: identity.digest,
      policy: 'content-bound-no-calendar-expiry-live-base-separate-v2', identity, validation, startedAt, completedAt: new Date().toISOString() };
    record = { ...body, digest: digestValue(body) };
    verifyCertificate(record, identity.digest, Date.now());
  } catch (error) {
    // A failed attempt publishes nothing; keep its marker aside as evidence.
    await rename(lock, filename + '.pending.failed-' + randomUUID());
    throw error;
  }
  await writeFile(filename, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // Keep successful/failed attempt evidence; moving the marker is atomic.
  await rename(lock, filename + '.completed-' + randomUUID());
  return { filename, record, toolingDigest: identity.digest, reused: false };
}

export async function revokeToolingCertificate({ evidenceDir, toolingDigest, reason }) {
  if (!hex(toolingDigest) || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw Error('Revocation requires a digest and reason.');
  await safeEvidenceRoot(evidenceDir);
  const filename = path.join(path.resolve(evidenceDir), 'tooling-revocations', toolingDigest + '.json');
  await safeEvidenceRoot(path.dirname(filename)); await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify({ schema: 'rs3-tooling-revocation-v1', toolingDigest, reason, revokedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { filename, revoked: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]?.slice(2);
      if (!['kit', 'evidence-dir', 'digest', 'reason'].includes(key) || !args[index + 1] || options[key]) throw Error('Certificate arguments invalid.');
      options[key] = args[index + 1];
    }
    if (command === 'revoke') console.log(JSON.stringify(await revokeToolingCertificate({ evidenceDir: options['evidence-dir'], toolingDigest: options.digest, reason: options.reason })));
    else if (command === 'inspect') console.log(JSON.stringify({ toolingDigest: (await toolingIdentity(options.kit)).digest }));
    else if (command === 'assert') console.log(JSON.stringify({ accepted: true, toolingDigest: (await assertToolingCertificate({ kit: options.kit, evidenceDir: options['evidence-dir'] })).toolingDigest }));
    else throw Error('Use inspect, assert or revoke. Issue through release-practice.');
  } catch { console.error('Tooling certificate refused.'); process.exitCode = 1; }
}
