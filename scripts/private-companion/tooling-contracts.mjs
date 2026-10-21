// Focused executable contracts are separate from capability certificates. An
// assertion-only edit reruns these checks without invalidating the certificate.
import path from 'node:path';
import { mkdir, writeFile, readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { digestValue, hashTree, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { regularInput } from './file-test-evidence.mjs';
import { mandatoryToolingContractTests, executableToolingClosure, safeEvidenceRoot } from './tooling-certificate.mjs';
import { moduleTokens } from './tooling-module-graph.mjs';
import { runOwnedCommand } from './owned-child-processes.mjs';
import { prepareToolingContractWorkspace } from './tooling-contract-workspace.mjs';
import { resolveRetryPolicy, retryPolicyIdentity } from './retry-policy.mjs';
import { retryFailedFilesOnce } from './retry-failed-files.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contractName = name => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(name);
function literalRegistration(tokens, start, name) {
  let i = start;
  const take = value => {
    const token = tokens[i++];
    if (!token || ['string', 'template', 'regexp'].includes(token.kind) || token.value !== value) throw Error('Tooling contract catalog must use a literal frozen array.');
  };
  for (const value of ['export', 'const', name, '=', 'Object', '.', 'freeze', '(', '[']) take(value);
  const names = [];
  while (tokens[i]?.value !== ']') {
    const token = tokens[i++];
    if (token?.kind !== 'string' || token.escaped || !contractName(token.value)) throw Error('Tooling contract catalog requires literal test filenames.');
    names.push(token.value);
    if (tokens[i]?.value === ']') break;
    take(',');
  }
  take(']'); take(')');
  if (tokens[i]?.value === ';') i++;
  if (new Set(names).size !== names.length) throw Error('Tooling contract catalog has duplicate registrations.');
  return { names, end: i };
}
async function selectedContractCatalog(kit) {
  const relative = 'tools/tooling-contract-catalog.mjs', file = path.join(kit, relative);
  const bytes = await regularInput(file), tokens = moduleTokens(bytes.toString('utf8'));
  const registration = literalRegistration(tokens, 0, 'additionalToolingContractTests');
  if (registration.end !== tokens.length) throw Error('Tooling contract catalog contains unsupported executable code.');
  const certificate = moduleTokens((await regularInput(path.join(kit, 'tools/tooling-certificate.mjs'))).toString('utf8'));
  const floors = [];
  for (let i = 0; i < certificate.length; i++) if (certificate[i].kind === 'identifier' && certificate[i].value === 'export'
      && certificate[i + 1]?.value === 'const' && certificate[i + 2]?.value === 'mandatoryToolingContractTests') {
    floors.push(literalRegistration(certificate, i, 'mandatoryToolingContractTests').names);
  }
  if (floors.length !== 1 || JSON.stringify(floors[0]) !== JSON.stringify(mandatoryToolingContractTests)) throw Error('Selected kit mandatory tooling contract floor differs from its consumer.');
  const names = [...mandatoryToolingContractTests, ...registration.names];
  if (new Set(names).size !== names.length) throw Error('Tooling contract catalog duplicates the mandatory floor.');
  return { names, input: { path: relative, mode: (await lstat(file)).mode & 0o777, sha256: sha(bytes) } };
}
// These contracts also read/copy scripts without importing them. Runtime
// contracts parse every top-level PowerShell file, so additions join this floor.
export const toolingContractSupportScripts = Object.freeze([
  'Cutover-Live.ps1', 'Cutover-Process.ps1', 'Install-ReleaseV2.ps1', 'InstallV2-Common.ps1',
  'Legacy-Stop.ps1', 'Managed-ReleaseV2.ps1', 'Operator-Common.ps1', 'Register-CoreTasks.ps1',
  'ReleaseV2-Common.ps1', 'Resource-Admission.ps1', 'Restore-CoreTasks.ps1', 'Rollback-Core.ps1',
  'Rollback-Live.ps1', 'Ship-Core.ps1', 'Start-Core.ps1', 'Stop-Core.ps1', 'Task-Common.ps1',
  'Watch-Core.ps1', 'Watchdog-Common.ps1', 'with-heavy.ps1', 'with-light.ps1',
  'companion-check.mjs', 'release-worker.mjs',
]);
async function rawSupportInputs(source) {
  const directory = path.join(source, 'scripts/private-companion');
  const discover = async () => (await readdir(directory, { withFileTypes: true }))
    .filter(row => /\.(?:ps1|psm1)$/i.test(row.name)).map(row => row.name).sort();
  const discovered = await discover(), names = [...new Set([...toolingContractSupportScripts, ...discovered])].sort();
  const rows = [];
  for (const name of names) {
    const file = path.join(directory, name), before = await lstat(file), bytes = await regularInput(file), after = await lstat(file);
    for (const key of ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs', 'nlink']) {
      if (before[key] !== after[key]) throw Error('Focused support script changed while reading.');
    }
    rows.push({ path: 'scripts/private-companion/' + name, mode: after.mode & 0o777, sha256: sha(bytes) });
  }
  if (JSON.stringify(discovered) !== JSON.stringify(await discover())) throw Error('Focused support script set changed while reading.');
  return rows;
}
async function kitManifest(kit) {
  try { return JSON.parse((await regularInput(path.join(kit, 'kit.json'))).toString('utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return {}; }
}
export async function toolingContractIdentity(kit) {
  const source = path.join(kit, 'checks/private-source'), files = [], catalog = await selectedContractCatalog(kit);
  for (const name of catalog.names) {
    const file = path.join(source, 'tests', name);
    try { files.push({ path: 'tests/' + name, sha256: sha(await regularInput(file)) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; throw Error('Required tooling contract is absent: ' + name); }
  }
  const dependencies = await executableToolingClosure(kit, { entries: files.map(row => 'checks/private-source/' + row.path), payloadBoundary: false });
  const manifest = await kitManifest(kit);
  // Keep the exact core selector and its helper bytes separate from workspace
  // dependencies: they invalidate assertions without hydrating virtual files.
  const rawCommittedCore = manifest.coreRevision === undefined ? [] : (await executableToolingClosure(kit, {
    entries: ['committed-core-tooling/scripts/test-selection.mjs'], payloadBoundary: false,
  })).filter(row => row.path.startsWith('committed-core-tooling/'));
  const rawSupport = await rawSupportInputs(source);
  const fixtures = {};
  for (const name of ['helpers', 'fixtures']) {
    try { fixtures[name] = (await (await import('./release-identity.mjs')).hashTree(path.join(source, 'tests', name))).digest; }
    catch (error) { if (!/could not be read/.test(error.message)) throw error; fixtures[name] = null; }
  }
  const documentation = [];
  const docs = async directory => {
    let rows;
    try { rows = await readdir(directory, { withFileTypes: true }); }
    catch(error) { if(error.code === 'ENOENT') return; throw error; }
    for(const row of rows) {
      const file = path.join(directory, row.name);
      if(row.isSymbolicLink()) throw Error('Linked tooling documentation refused.');
      if(row.isDirectory()) await docs(file);
      else if(/\.(?:md|txt)$/i.test(row.name)) documentation.push({ path: path.relative(kit,file).split(path.sep).join('/'), sha256: sha(await regularInput(file)) });
    }
  };
  for(const relative of ['tools','operator','checks/private-source/scripts/private-companion']) await docs(path.join(kit,relative));
  documentation.sort((a,b)=>a.path.localeCompare(b.path));
  const body = { schema: 'rs3-tooling-contract-input-v2', catalog: catalog.input, files, dependencies, rawCommittedCore, rawSupport, fixtures, documentation };
  return { ...body, digest: digestValue(body) };
}
const completePass = log => /\b(?:fail 0|failed 0)\b/.test(log) && !/\b(?:cancelled|skipped) [1-9]/.test(log);
/** Selected contract files named by node's spec failure summary, or null when
 * any failure or cancellation cannot be pinned to one selected file. */
export function failedContractFiles(stdout, cwd, selected) {
  const text = String(stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');
  const count = name => Number(text.match(new RegExp('^ℹ ' + name + ' (\\d+)$', 'm'))?.[1] ?? NaN);
  if (!(count('fail') + count('cancelled') >= 1) || count('skipped') !== 0) return null;
  const start = text.lastIndexOf('\n✖ failing tests:\n');
  if (start < 0) return null;
  const lines = text.slice(start + 1).split('\n').slice(1);
  const entries = lines.filter(line => line.startsWith('✖ ')), locations = lines.map(line => line.match(/^test at (.+):\d+:\d+$/)?.[1]).filter(Boolean);
  if (!entries.length || entries.length !== locations.length) return null;
  const key = name => process.platform === 'win32' ? path.resolve(cwd, name).toLowerCase() : path.resolve(cwd, name);
  const byPath = new Map(selected.map(name => [key(name), name])), files = new Set();
  for (const location of locations) { const file = byPath.get(key(location)); if (!file) return null; files.add(file); }
  return [...files];
}
const receiptPath =(evidenceDir, toolingDigest, contractDigest) => path.join(evidenceDir, 'tooling-contracts', toolingDigest + '-' + contractDigest + '.json');
export async function assertToolingContracts({ kit, evidenceDir, toolingDigest }) {
  await safeEvidenceRoot(evidenceDir);
  const identity = await toolingContractIdentity(kit), filename = receiptPath(evidenceDir, toolingDigest, identity.digest);
  const record = JSON.parse((await regularInput(filename)).toString('utf8'));
  const { digest, ...body } = record;
  if (digest !== digestValue(body) || record.schema !== 'rs3-tooling-contract-pass-v1' || record.passed !== true || record.cleanupVerified !== true
    || record.toolingDigest !== toolingDigest || record.contractDigest !== identity.digest || !/^[a-f0-9]{64}$/.test(record.workspace?.digest ?? '')
    || !/^[a-f0-9]{64}$/.test(record.workspace?.treeDigest ?? '') || !Array.isArray(record.checks) || !record.checks.length) throw Error('Focused tooling contract proof differs.');
  return { filename, record };
}

/** A certificate hit can still require a focused run after an assertion edit.
 * No full payload lane is run or relabeled as a tooling contract. */
export async function runToolingContracts({ kit, evidenceDir, output, toolingDigest, retryOnceInIsolation }, dependencies = {}) {
  const identity = await toolingContractIdentity(kit);
  try { return { ...await assertToolingContracts({ kit, evidenceDir, toolingDigest }), reused: true }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const relative = path.relative(path.resolve(kit), path.resolve(output)), reverse = path.relative(path.resolve(output), path.resolve(kit));
  const contained = name => !name || !path.isAbsolute(name) && name !== '..' && !name.startsWith('..' + path.sep);
  if (contained(relative) || contained(reverse)) throw Error('Focused contract output overlaps its immutable kit.');
  await safeEvidenceRoot(output);
  const workspace = await prepareToolingContractWorkspace({ kit, output: path.join(output, 'workspace'), identity });
  // Same policy as the gates: the kit.json default, an explicit switch wins.
  const retryEnabled = resolveRetryPolicy({ retryOnceInIsolation }, await kitManifest(kit));
  const exec = dependencies.exec ?? runOwnedCommand;
  const execution = async temp => {
    await mkdir(temp, { recursive: true });
    const env = sanitizeExecutionEnvironment(process.env, { overrides: { TEMP: temp, TMP: temp, TMPDIR: temp,
      RS3_TEST_SCRATCH_ROOT: temp, RS3_DRIFT_TEST_ROOT: temp, RS3_WORKER_IDLE_MS: '20000' } });
    return { cwd: workspace.cwd, env, windowsHide: true, timeout: 30 * 60000, maxBuffer: 32 * 1024 ** 2 };
  };
  const unchanged = async when => { if ((await hashTree(workspace.cwd)).digest !== workspace.treeDigest) throw Error('Focused contract workspace changed ' + when + '.'); };
  // The spec reporter is pinned because failedContractFiles reads its summary.
  const contractArgs = files => ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files];
  const startedAt = new Date().toISOString(), began = performance.now();
  let result, failure;
  await unchanged('before execution');
  try { result = await exec(process.execPath, contractArgs(identity.files.map(row => row.path)), await execution(path.join(output, 'temp'))); }
  catch (error) { result = error; failure = true; }
  const log = String(result.stdout ?? '') + String(result.stderr ?? ''), logs = [log];
  await writeFile(path.join(output, 'tooling-contracts.log'), log, { flag: 'wx', mode: 0o600 });
  await unchanged('during execution');
  let retry = null;
  if (failure) {
    // Only a clean failing exit qualifies: no timeout, leak or unverified
    // cleanup, and every failure pinned to a selected contract file.
    const failed = retryEnabled && result.cleanupVerified === true && result.timedOut !== true && result.forcedDescendants === 0 && result.code === 1
      ? failedContractFiles(result.stdout ?? '', workspace.cwd, identity.files.map(row => row.path)) : null;
    if (!failed) throw Error('Focused tooling contracts failed; certificate refused.');
    let attempt = 0;
    retry = await retryFailedFilesOnce({ enabled: true,
      result: { passed: false, exitCode: 1, aborted: false, wallMs: performance.now() - began,
        files: identity.files.map(row => ({ file: row.path, passed: !failed.includes(row.path) })) },
      runIsolated: async (files, options) => {
        if (files.length !== 1 || options?.maxConcurrency !== 1) throw Error('Isolated contract retry requires one file at concurrency 1.');
        const index = ++attempt, retryStarted = performance.now();
        await unchanged('before an isolated retry');
        let observed, crashed = false;
        try { observed = await exec(process.execPath, contractArgs(files), await execution(path.join(output, 'retry-' + index, 'temp'))); }
        catch (error) { observed = error; crashed = true; }
        const retryLog = String(observed.stdout ?? '') + String(observed.stderr ?? ''); logs.push(retryLog);
        await writeFile(path.join(output, 'tooling-contracts.retry-' + index + '.log'), retryLog, { flag: 'wx', mode: 0o600 });
        await unchanged('during an isolated retry');
        const passed = !crashed && observed.cleanupVerified === true && completePass(retryLog);
        return { passed, exitCode: passed ? 0 : 1, aborted: false, wallMs: performance.now() - retryStarted, files: [{ file: files[0], passed }] };
      } });
    if (retry.passed !== true) throw Error('Focused tooling contracts failed again in isolation; certificate refused.');
  } else {
    if (result.cleanupVerified !== true) throw Error('Focused contract child cleanup is unverified.');
    if (!completePass(log)) throw Error('Focused contract completion is not a complete pass.');
  }
  if ((await toolingContractIdentity(kit)).digest !== identity.digest) throw Error('Focused contract inputs changed during execution.');
  const flakyFiles = retry?.flakyFiles ?? [];
  const checks = [{ name: 'focused-tooling-contracts', passed: true, evidenceDigest: sha(logs.join('\n')), files: identity.files.length, ...(retry ? { flakyFiles } : {}) }];
  const body = { schema: 'rs3-tooling-contract-pass-v1', passed: true, cleanupVerified: true, toolingDigest,
    contractDigest: identity.digest, workspace: { digest: workspace.digest, treeDigest: workspace.treeDigest, materialized: workspace.materialized },
    checks, retryPolicy: { version: retryPolicyIdentity, enabled: retryEnabled }, flakyFiles,
    milliseconds: performance.now() - began, startedAt, completedAt: new Date().toISOString() };
  const record = { ...body, digest: digestValue(body) }, filename = receiptPath(evidenceDir, toolingDigest, identity.digest);
  await safeEvidenceRoot(path.dirname(filename)); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { filename, record, reused: false };
}
